/* iMieiEsami Pro – versione “Clinica PRO” (offline-first)
   Dati:
   - localStorage.blood_reports_v2: [{id,date,location,notes,exams:[{param,val}]}]
   - localStorage.param_dict: [{name,unit,min,max,color,decimals,direction,category,notes}]
*/

document.addEventListener('DOMContentLoaded', () => {
  // -------------------- STORAGE --------------------
  const LS_REPORTS = 'blood_reports_v2';
  const LS_DICT = 'param_dict';

  const DEFAULT_DICT = [
    { name: 'COLESTEROLO', unit: 'mg/dL', min: 120, max: 200, color: 'bg-orange', decimals: 0, direction: 'lower_better', category: 'Lipidi' },
    { name: 'COLESTEROLO HDL', unit: 'mg/dL', min: 40, max: 60, color: 'bg-orange', decimals: 0, direction: 'higher_better', category: 'Lipidi' },
    { name: 'COLESTEROLO LDL', unit: 'mg/dL', min: 0, max: 130, color: 'bg-orange', decimals: 0, direction: 'lower_better', category: 'Lipidi' },
    { name: 'TRIGLICERIDI', unit: 'mg/dL', min: 50, max: 150, color: 'bg-orange', decimals: 0, direction: 'lower_better', category: 'Lipidi' },
    { name: 'GLUCOSIO', unit: 'mg/dL', min: 70, max: 100, color: 'bg-blue', decimals: 0, direction: 'lower_better', category: 'Metabolismo', notes: 'A digiuno quando possibile.' },
    { name: 'LEUCOCITI', unit: '10^3/µL', min: 4, max: 10, color: 'bg-blue', decimals: 1, direction: 'range', category: 'Emocromo' },
    { name: 'EMOGLOBINA', unit: 'g/dL', min: 13, max: 17, color: 'bg-blue', decimals: 1, direction: 'range', category: 'Emocromo' },
    { name: 'VITAMINA D', unit: 'ng/mL', min: 30, max: 100, color: 'bg-purple', decimals: 0, direction: 'higher_better', category: 'Vitamine' }
  ];

  /** @type {Array<{id:string,date:string,location:string,notes?:string,exams:Array<{param:string,val:number}>}>} */
  let reports = safeJSON(localStorage.getItem(LS_REPORTS), []);
  /** @type {Array<any>} */
  let dict = safeJSON(localStorage.getItem(LS_DICT), DEFAULT_DICT);

  // Migrazione soft (aggiunge campi mancanti senza rompere dati vecchi)
  dict = dict.map((p) => ({
    decimals: 1,
    direction: 'range',
    category: 'Altro',
    ...p,
  }));

  // Stato UI
  let tempExams = [];
  let editingReportId = null;
  let tChart = null;

  const mainAddBtn = document.getElementById('mainAddBtn');
  const historyAddBtn = document.getElementById('historyAddBtn');

  // -------------------- PWA --------------------
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js');
    }
  } catch (_) {
    // no-op
  }
  // -------------------- SECURITY (PIN / Face ID) --------------------
  const LS_LOCK = 'lock_settings_v1';
  const lockEls = {
    screen: document.getElementById('lockScreen'),
    pinInput: document.getElementById('lockPinInput'),
    btnUnlock: document.getElementById('btnUnlock'),
    btnBioUnlock: document.getElementById('btnUnlockBiometric'),
    err: document.getElementById('lockError'),

    toggle: document.getElementById('lockEnabledToggle'),
    pinNew: document.getElementById('pinNew'),
    pinConfirm: document.getElementById('pinConfirm'),
    btnSavePin: document.getElementById('btnSavePin'),
    btnSetupBio: document.getElementById('btnSetupBiometric'),
    btnDisableBio: document.getElementById('btnDisableBiometric'),
    status: document.getElementById('securityStatus'),
  };

  function loadLockSettings() {
    return safeJSON(localStorage.getItem(LS_LOCK), {
      enabled: false,
      pinSaltB64: null,
      pinHashB64: null,
      bioEnabled: false,
      credIdB64: null,
    });
  }
  function saveLockSettings(s) {
    localStorage.setItem(LS_LOCK, JSON.stringify(s));
  }

  function isBiometricSupported() {
    return Boolean(window.PublicKeyCredential && window.isSecureContext);
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function randBuf(n = 32) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a.buffer;
  }

  async function hashPinPBKDF2(pin, saltBuf) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations: 120000 },
      keyMaterial,
      256
    );
    return bits;
  }

  function lockShow(message) {
    if (!lockEls.screen) return;
    lockEls.screen.style.display = 'flex';
    lockEls.screen.setAttribute('aria-hidden', 'false');
    if (lockEls.err) {
      if (message) {
        lockEls.err.style.display = 'block';
        lockEls.err.textContent = message;
      } else {
        lockEls.err.style.display = 'none';
        lockEls.err.textContent = '';
      }
    }
    if (lockEls.pinInput) {
      lockEls.pinInput.value = '';
      setTimeout(() => lockEls.pinInput.focus(), 50);
    }
  }

  function lockHide() {
    if (!lockEls.screen) return;
    lockEls.screen.style.display = 'none';
    lockEls.screen.setAttribute('aria-hidden', 'true');
  }

  function setUnlocked(val) {
    sessionStorage.setItem('lock_unlocked', val ? '1' : '0');
  }
  function isUnlocked() {
    return sessionStorage.getItem('lock_unlocked') === '1';
  }

  async function verifyPin(pin, settings) {
    if (!settings?.pinSaltB64 || !settings?.pinHashB64) return false;
    const salt = b64ToBuf(settings.pinSaltB64);
    const hash = await hashPinPBKDF2(pin, salt);
    return bufToB64(hash) === settings.pinHashB64;
  }

  function updateSecurityUI(settings) {
    if (!lockEls.toggle) return;
    lockEls.toggle.checked = Boolean(settings.enabled);

    const hasPin = Boolean(settings.pinHashB64 && settings.pinSaltB64);
    const bioOk = isBiometricSupported();

    if (lockEls.btnSetupBio) lockEls.btnSetupBio.style.display = (bioOk && hasPin && !settings.bioEnabled) ? 'block' : 'none';
    if (lockEls.btnDisableBio) lockEls.btnDisableBio.style.display = (settings.bioEnabled) ? 'block' : 'none';
    if (lockEls.btnBioUnlock) lockEls.btnBioUnlock.style.display = (settings.enabled && settings.bioEnabled && bioOk) ? 'block' : 'none';

    if (lockEls.status) {
      const parts = [];
      parts.push(`Blocco: ${settings.enabled ? 'ATTIVO' : 'DISATTIVATO'}`);
      parts.push(`PIN: ${hasPin ? 'impostato' : 'non impostato'}`);
      if (bioOk) parts.push(`Biometria: ${settings.bioEnabled ? 'attiva' : 'non attiva'}`);
      else parts.push('Biometria: non supportata (serve HTTPS / PWA)');
      lockEls.status.textContent = parts.join(' • ');
    }
  }

  async function setupOrChangePin() {
    const pin1 = (lockEls.pinNew?.value || '').trim();
    const pin2 = (lockEls.pinConfirm?.value || '').trim();
    if (pin1.length < 4) {
      alert('Il PIN deve avere almeno 4 cifre.');
      return;
    }
    if (pin1 !== pin2) {
      alert('I due PIN non coincidono.');
      return;
    }

    const settings = loadLockSettings();
    const salt = randBuf(16);
    const hash = await hashPinPBKDF2(pin1, salt);

    settings.pinSaltB64 = bufToB64(salt);
    settings.pinHashB64 = bufToB64(hash);
    settings.enabled = true;
    settings.bioEnabled = false;
    settings.credIdB64 = null;

    saveLockSettings(settings);
    if (lockEls.pinNew) lockEls.pinNew.value = '';
    if (lockEls.pinConfirm) lockEls.pinConfirm.value = '';
    updateSecurityUI(settings);
    alert('PIN salvato. Il blocco è ora attivo.');
  }

  async function setupBiometric() {
    const settings = loadLockSettings();
    if (!isBiometricSupported()) {
      alert('Biometria non supportata qui. Serve HTTPS o app installata (PWA).');
      return;
    }
    if (!settings.pinHashB64) {
      alert('Imposta prima un PIN.');
      return;
    }

    try {
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: new Uint8Array(randBuf(32)),
          rp: { name: 'iMieiEsami Pro' },
          user: { id: userId, name: 'utente', displayName: 'Utente' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required'
          },
          timeout: 60000,
          attestation: 'none',
        }
      });

      if (!cred) throw new Error('Credenziale non creata');
      settings.bioEnabled = true;
      settings.credIdB64 = bufToB64(cred.rawId);
      saveLockSettings(settings);
      updateSecurityUI(settings);
      alert('Face ID / Touch ID attivato.');
    } catch (e) {
      console.warn(e);
      alert('Non è stato possibile attivare la biometria.');
    }
  }

  function disableBiometric() {
    const settings = loadLockSettings();
    settings.bioEnabled = false;
    settings.credIdB64 = null;
    saveLockSettings(settings);
    updateSecurityUI(settings);
  }

  async function unlockWithBiometric() {
    const settings = loadLockSettings();
    if (!settings.bioEnabled || !settings.credIdB64) return false;
    if (!isBiometricSupported()) return false;

    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(randBuf(32)),
          allowCredentials: [{ type: 'public-key', id: b64ToBuf(settings.credIdB64) }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      return Boolean(assertion);
    } catch (e) {
      console.warn(e);
      return false;
    }
  }

  async function handleUnlock() {
    const settings = loadLockSettings();
    if (!settings.pinHashB64) {
      lockShow('Imposta un PIN in Config → Sicurezza.');
      return;
    }

    const pin = (lockEls.pinInput?.value || '').trim();
    const ok = await verifyPin(pin, settings);
    if (!ok) {
      lockShow('PIN errato.');
      return;
    }
    setUnlocked(true);
    lockHide();
  }

  async function initSecurity() {
    const settings = loadLockSettings();
    updateSecurityUI(settings);

    if (lockEls.toggle) {
      lockEls.toggle.onchange = () => {
        const s = loadLockSettings();
        s.enabled = Boolean(lockEls.toggle.checked);
        if (s.enabled && !s.pinHashB64) {
          alert('Prima imposta un PIN.');
          s.enabled = false;
          lockEls.toggle.checked = false;
        }
        saveLockSettings(s);
        updateSecurityUI(s);
      };
    }
    if (lockEls.btnSavePin) lockEls.btnSavePin.onclick = () => setupOrChangePin();
    if (lockEls.btnSetupBio) lockEls.btnSetupBio.onclick = () => setupBiometric();
    if (lockEls.btnDisableBio) lockEls.btnDisableBio.onclick = () => disableBiometric();

    if (lockEls.btnUnlock) lockEls.btnUnlock.onclick = () => handleUnlock();
    if (lockEls.pinInput) lockEls.pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUnlock(); });

    if (lockEls.btnBioUnlock) {
      lockEls.btnBioUnlock.onclick = async () => {
        const ok = await unlockWithBiometric();
        if (ok) { setUnlocked(true); lockHide(); }
        else lockShow('Sblocco biometrico non riuscito.');
      };
    }

    document.addEventListener('visibilitychange', () => {
      const s = loadLockSettings();
      if (!s.enabled) return;
      if (document.hidden) setUnlocked(false);
      else if (!isUnlocked()) lockShow();
    });

    if (settings.enabled && !isUnlocked()) {
      lockShow();
    }
  }


  // -------------------- ROUTING (SPA) --------------------
  function showView(target) {
    document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
    const targetView = document.getElementById(`view-${target}`);
    if (targetView) targetView.style.display = 'block';

    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.view === target));
    if (mainAddBtn) mainAddBtn.style.display = (target === 'dashboard') ? 'block' : 'none';

    if (target === 'trends') renderTrendPage();
    if (target === 'history') renderHistory();
    if (target === 'dashboard') renderDashboard();
    if (target === 'settings') renderDictList();
  }

  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.onclick = (e) => { e.preventDefault(); showView(tab.dataset.view); };
  });

  // -------------------- UTILS --------------------
  function safeJSON(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Normalizza nomi parametro per match robusto (spazi/underscore/punti/maiuscole)
  function normName(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/[._]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getParamConfig(name) {
    const key = normName(name);
    return dict.find(p => normName(p.name) === key) || null;
  }


  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function saveReports() {
    localStorage.setItem(LS_REPORTS, JSON.stringify(reports));
  }

  function saveDict() {
    localStorage.setItem(LS_DICT, JSON.stringify(dict));
  }

  function sortReportsDesc(arr) {
    return [...arr].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function fmt(val, decimals = 1) {
    // Visualizzazione coerente: mostra ESATTAMENTE i decimali configurati (0..4)
    if (val === null || val === undefined || !Number.isFinite(val)) return '--';
    const d = clamp(Number(decimals ?? 1), 0, 4);
    if (d === 0) return String(Math.round(Number(val)));
    return Number(val).toFixed(d);
  }

  function statusForValue(p, v) {
    const min = (p.min === '' || p.min === undefined) ? null : toNum(p.min);
    const max = (p.max === '' || p.max === undefined) ? null : toNum(p.max);
    if (v === null) return { state: 'NO_DATA', out: false };
    const low = (min !== null) && v < min;
    const high = (max !== null) && v > max;
    if (low) return { state: 'LOW', out: true };
    if (high) return { state: 'HIGH', out: true };
    return { state: 'NORMAL', out: false };
  }

  // Severità in base a “quanto” sei fuori range (percentuale rispetto al limite più vicino)
  function severityForValue(p, v) {
    const min = (p.min === '' || p.min === undefined) ? null : toNum(p.min);
    const max = (p.max === '' || p.max === undefined) ? null : toNum(p.max);
    if (v === null) return { label: '—', level: 'none', ratio: 0 };

    if (min !== null && v < min && min !== 0) {
      const ratio = (min - v) / Math.abs(min);
      return severityFromRatio(ratio);
    }
    if (max !== null && v > max && max !== 0) {
      const ratio = (v - max) / Math.abs(max);
      return severityFromRatio(ratio);
    }
    return { label: 'OK', level: 'none', ratio: 0 };
  }

  function severityFromRatio(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return { label: 'OK', level: 'none', ratio: 0 };
    if (ratio < 0.10) return { label: 'Leggera', level: 'light', ratio };
    if (ratio < 0.25) return { label: 'Moderata', level: 'moderate', ratio };
    return { label: 'Severa', level: 'severe', ratio };
  }

  function deltaInfo(valuesDesc) {
    // valuesDesc: [{date,val}, ...] ordinati DESC
    const last = valuesDesc[0]?.val ?? null;
    const prev = valuesDesc[1]?.val ?? null;
    if (last === null || prev === null) return { delta: null, pct: null };
    const d = last - prev;
    const pct = (prev === 0) ? null : (d / Math.abs(prev)) * 100;
    return { delta: d, pct };
  }

  function getAllValuesForParam(paramName) {
    const pts = [];
    for (const r of reports) {
      const row = r.exams?.find(e => normName(e.param) === normName(paramName));
      const v = row ? toNum(row.val) : null;
      if (v !== null) pts.push({ date: r.date, val: v, reportId: r.id });
    }
    pts.sort((a, b) => new Date(b.date) - new Date(a.date));
    return pts;
  }

  function generateSparkline(dataAsc, min, max) {
    // dataAsc: [{date,val}, ...] ordinati ASC
    if (!dataAsc?.length) return '<span style="color:var(--gray);font-size:10px">—</span>';

    const vals = dataAsc.map(d => d.val);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = (hi - lo) || 1;

    const safeMin = (min === null || min === undefined || min === '') ? null : toNum(min);
    const safeMax = (max === null || max === undefined || max === '') ? null : toNum(max);

    return dataAsc.map(d => {
      const h = 6 + Math.round(((d.val - lo) / span) * 18); // 6..24
      const out = (safeMin !== null && d.val < safeMin) || (safeMax !== null && d.val > safeMax);
      return `<span class="spark" style="height:${h}px; opacity:${out ? 1 : 0.7}; ${out ? 'background:var(--danger);' : ''}"></span>`;
    }).join('');
  }

  // -------------------- DASHBOARD --------------------
  function renderDashboard() {
    const grid = document.getElementById('keyMetricsGrid');
    const alertSection = document.getElementById('outOfRangeSection');
    const alertList = document.getElementById('outOfRangeList');
    const overall = document.getElementById('overallStatus');
    if (!grid) return;

    // indice generale (su TUTTO il dizionario)
    const anomalies = [];
    dict.forEach(p => {
      const history = getAllValuesForParam(p.name);
      const last = history[0]?.val ?? null;
      const st = statusForValue(p, last);
      if (st.out) anomalies.push({ p, last, st, sev: severityForValue(p, last), history });
    });

    if (overall) {
      const c = anomalies.length;
      const tone = (c === 0) ? 'ok' : (c <= 2 ? 'warn' : 'bad');
      overall.classList.remove('pill-ok', 'pill-warn', 'pill-bad');
      overall.classList.add(tone === 'ok' ? 'pill-ok' : tone === 'warn' ? 'pill-warn' : 'pill-bad');
      overall.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div>
            <div style="font-weight:800">Stato generale</div>
            <div style="font-size:12px; color:var(--gray)">
              ${c === 0 ? 'Nessuna anomalia rilevata' : `${c} anomali${c === 1 ? 'a' : 'e'} (ultimo valore per parametro)`}
            </div>
          </div>
          <div style="font-weight:900; font-size:14px">${c === 0 ? '🟢 OK' : (c <= 2 ? '🟡 Attenzione' : '🔴 Critico')}</div>
        </div>`;
    }

    // 6 card principali
    grid.innerHTML = dict.slice(0, 6).map(p => {
      const historyDesc = getAllValuesForParam(p.name);
      const last = historyDesc[0]?.val ?? null;
      const prev = historyDesc[1]?.val ?? null;
      const st = statusForValue(p, last);
      const sev = severityForValue(p, last);
      const { delta, pct } = deltaInfo(historyDesc);
      const sparkline = generateSparkline([...historyDesc].slice(0, 5).reverse(), p.min, p.max);

      const deltaTxt = (delta === null) ? 'Δ: —' : `Δ: ${delta > 0 ? '+' : ''}${fmt(delta, p.decimals)}${pct === null ? '' : ` (${fmt(pct, 1)}%)`}`;
      const sevTxt = st.out ? `• ${sev.label}` : '• OK';
      const subColor = st.out ? 'var(--danger)' : 'var(--success)';
      const cardDangerStyle = st.out ? 'border-left-color:var(--danger); background:#FFF9F9;' : '';

      return `
        <div class="metric-card ${p.color}" style="${cardDangerStyle}">
          <label>${escapeHTML(p.name)}</label>
          <div style="font-size:20px; font-weight:800; margin:5px 0">
            ${last !== null ? fmt(last, p.decimals) : '--'}
            <small style="font-size:11px; font-weight:400">${escapeHTML(p.unit || '')}</small>
          </div>
          <div style="height:25px; display:flex; align-items:flex-end; gap:2px; margin:5px 0">${sparkline}</div>
          <div class="metric-subrow">
            <small style="color:${subColor}; font-weight:800; font-size:9px">${st.out ? '● ANOMALO' : (last !== null ? '● NORMALE' : 'NO DATI')} ${sevTxt}</small>
            <small style="color:var(--gray); font-weight:800; font-size:9px">${prev !== null ? deltaTxt : 'Δ: —'}</small>
          </div>
        </div>`;
    }).join('');

    // Sezione anomalie dettagliata + condivisione
    if (alertSection && alertList) {
      let alertsHtml = '';
      let shareText = '*REPORT ANOMALIE ESAMI* 📄\n\n';
      anomalies
        .sort((a, b) => (a.sev.ratio ?? 0) < (b.sev.ratio ?? 0) ? 1 : -1)
        .forEach(({ p, last, st, sev, history }) => {
          const arrow = st.state === 'HIGH' ? '↑' : '↓';
          const { delta, pct } = deltaInfo(history);
          const dTxt = (delta === null) ? '' : ` | Δ ${delta > 0 ? '+' : ''}${fmt(delta, p.decimals)}${pct === null ? '' : ` (${fmt(pct, 1)}%)`}`;

          alertsHtml += `
            <div class="card-white" style="display:flex; justify-content:space-between; align-items:center; border-left:5px solid var(--danger); margin-bottom:8px">
              <div>
                <b>${escapeHTML(p.name)}</b><br>
                <small style="color:var(--gray)">Range: ${p.min ?? '—'}-${p.max ?? '—'} ${escapeHTML(p.unit || '')}</small><br>
                <small style="color:var(--gray); font-weight:800">Severità: ${sev.label}${dTxt}</small>
              </div>
              <div style="text-align:right; color:var(--danger)">
                <b style="font-size:16px">${fmt(last, p.decimals)} ${arrow}</b><br>
                <small style="font-size:9px; font-weight:900">${st.state === 'HIGH' ? 'SUPERIORE' : 'INFERIORE'}</small>
              </div>
            </div>`;

          shareText += `• ${p.name}: ${fmt(last, p.decimals)} ${p.unit || ''} ${arrow} (Range: ${p.min}-${p.max}, Severità: ${sev.label})${dTxt}\n`;
        });

      alertSection.style.display = anomalies.length > 0 ? 'block' : 'none';
      alertList.innerHTML = alertsHtml;

      const btnShare = document.getElementById('btnShareAnomalies');
      if (btnShare) {
        btnShare.onclick = () => {
          window.open(`whatsapp://send?text=${encodeURIComponent(shareText)}`);
        };
      }
    }
  }

  // -------------------- TRENDS --------------------
  function computeDeltaSeries(pointsAsc) {
    const out = [];
    for (let i = 0; i < pointsAsc.length; i++) {
      if (i === 0) out.push(null);
      else out.push(pointsAsc[i].y - pointsAsc[i - 1].y);
    }
    return out;
  }

  function movingAverage(pointsAsc, window = 3) {
    const out = [];
    for (let i = 0; i < pointsAsc.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = pointsAsc.slice(start, i + 1).map(p => p.y);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      out.push(avg);
    }
    return out;
  }

  function renderTrendPage() {
    const sel = document.getElementById('trendParamSelector');
    const modeSel = document.getElementById('trendMode');
    if (!sel) return;

    const prev = sel.value;
    sel.innerHTML = dict.map(u => `<option value="${escapeAttr(u.name)}">${escapeHTML(u.name)}</option>`).join('');
    if (prev && dict.some(d => d.name === prev)) sel.value = prev;

    const redraw = () => {
      const pName = sel.value;
      const pConfig = getParamConfig(pName);
      const pts = [];
      reports.forEach(r => {
        const f = r.exams?.find(e => normName(e.param) === normName(pName));
        if (f && toNum(f.val) !== null) pts.push({ x: r.date, y: toNum(f.val) });
      });
      pts.sort((a, b) => new Date(a.x) - new Date(b.x));

      const ctx = document.getElementById('mainTrendChart')?.getContext('2d');
      if (!ctx) return;
      if (tChart) tChart.destroy();

      const mode = modeSel?.value || 'values';
      let series = pts.map(p => p.y);
      let label = pName;

      if (mode === 'delta') {
        series = computeDeltaSeries(pts);
        label = `Δ ${pName}`;
      } else if (mode === 'ma3') {
        series = movingAverage(pts, 3);
        label = `Media mobile (3) – ${pName}`;
      }

      // Banda verde range min/max (se presenti)
      const hasMin = pConfig && pConfig.min !== null && pConfig.min !== '' && pConfig.min !== undefined;
      const hasMax = pConfig && pConfig.max !== null && pConfig.max !== '' && pConfig.max !== undefined;
      const minVal = hasMin ? Number(pConfig.min) : null;
      const maxVal = hasMax ? Number(pConfig.max) : null;

      /** @type {any[]} */
      const datasets = [];
      if (mode === 'values' && hasMin && hasMax && Number.isFinite(minVal) && Number.isFinite(maxVal)) {
        datasets.push({
          label: 'MIN',
          data: pts.map(() => minVal),
          borderColor: 'rgba(0,0,0,0)',
          pointRadius: 0,
          borderWidth: 0,
        });
        datasets.push({
          label: 'RANGE',
          data: pts.map(() => maxVal),
          borderColor: 'rgba(0,0,0,0)',
          backgroundColor: 'rgba(52, 199, 89, 0.14)',
          pointRadius: 0,
          borderWidth: 0,
          fill: '-1',
        });
      }

      datasets.push({
        label,
        data: series,
        borderColor: '#007AFF',
        tension: 0.3,
        fill: false,
        spanGaps: true,
      });

      tChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: pts.map(p => p.x),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 650, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (tt) => {
                  const v = tt.parsed?.y;
                  if (v === null || v === undefined) return '—';
                  const dec = pConfig?.decimals ?? 1;
                  return `${tt.dataset.label}: ${fmt(v, dec)} ${mode === 'values' ? (pConfig?.unit || '') : ''}`.trim();
                }
              }
            }
          },
          scales: {
            y: {
              grid: {
                color: (context) => {
                  if (mode !== 'values' || !pConfig) return 'rgba(0,0,0,0.05)';
                  if (context.tick?.value === Number(pConfig.min) || context.tick?.value === Number(pConfig.max)) return 'rgba(255, 59, 48, 0.35)';
                  return 'rgba(0,0,0,0.05)';
                },
                lineWidth: (context) => {
                  if (mode !== 'values' || !pConfig) return 1;
                  if (context.tick?.value === Number(pConfig.min) || context.tick?.value === Number(pConfig.max)) return 2;
                  return 1;
                }
              }
            }
          }
        }
      });
    };

    sel.onchange = redraw;
    if (modeSel) modeSel.onchange = redraw;
    redraw();
  }

  // -------------------- HISTORY --------------------
  function renderHistory() {
    const host = document.getElementById('historyList');
    if (!host) return;

    const sorted = sortReportsDesc(reports);
    if (sorted.length === 0) {
      host.innerHTML = `<div class="card-white"><b>Nessun referto salvato</b><br><small style="color:var(--gray)">Premi “+” in alto per inserire il primo referto.</small></div>`;
      return;
    }

    host.innerHTML = sorted.map(r => {
      const date = escapeHTML(r.date);
      const loc = escapeHTML(r.location || '—');
      const notes = (r.notes || '').trim();

      const rows = (r.exams || []).map(ex => {
        const p = getParamConfig(ex.param) || { name: ex.param, unit: '', min: null, max: null, decimals: 1 };
        const v = toNum(ex.val);
        const st = statusForValue(p, v);
        const sev = severityForValue(p, v);
        const hist = getAllValuesForParam(p.name);
        const idx = hist.findIndex(h => h.reportId === r.id);
        const cur = idx >= 0 ? hist[idx]?.val : null;
        const prev = idx >= 0 ? hist[idx + 1]?.val : null; // hist è DESC
        let dTxt = 'Δ —';
        if (cur !== null && prev !== null) {
          const d = cur - prev;
          const pct = prev === 0 ? null : (d / Math.abs(prev)) * 100;
          dTxt = `Δ ${d > 0 ? '+' : ''}${fmt(d, p.decimals)}${pct === null ? '' : ` (${fmt(pct, 1)}%)`}`;
        }

        const badge = st.out ? `<span class="badge badge-danger">${st.state === 'HIGH' ? 'ALTO' : 'BASSO'} • ${sev.label}</span>` : `<span class="badge badge-ok">OK</span>`;
        return `
          <div class="hist-row">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px">
              <div style="min-width:0">
                <b style="font-size:12px">${escapeHTML(p.name)}</b>
                <div style="font-size:11px; color:var(--gray)">Range: ${p.min ?? '—'}-${p.max ?? '—'} ${escapeHTML(p.unit || '')}</div>
              </div>
              <div style="text-align:right; white-space:nowrap">
                <div style="font-weight:900">${v !== null ? fmt(v, p.decimals) : '--'} <span style="font-size:11px; font-weight:600">${escapeHTML(p.unit || '')}</span></div>
                <div style="font-size:10px; color:var(--gray); font-weight:800">${dTxt}</div>
              </div>
            </div>
            <div style="margin-top:8px">${badge}</div>
          </div>`;
      }).join('');

      const details = `
        <div class="report-details" style="display:none" id="details-${escapeAttr(r.id)}">
          <div style="padding: 14px 16px">
            ${notes ? `<div class="note-box"><b>Note</b><br><small>${escapeHTML(notes)}</small></div>` : ''}
            ${rows || `<small style="color:var(--gray)">Nessun parametro nel referto.</small>`}
            <div style="display:flex; gap:10px; margin-top:12px">
              <button class="button secondary-button" style="flex:1" onclick="editReport('${escapeAttr(r.id)}')"><i class="fas fa-pen" style="margin-right:8px"></i>Modifica</button>
              <button class="button" style="flex:1; background: var(--danger); color:white" onclick="deleteReport('${escapeAttr(r.id)}')"><i class="fas fa-trash" style="margin-right:8px"></i>Elimina</button>
            </div>
          </div>
        </div>`;

      return `
        <div class="report-card">
          <div class="report-header" onclick="toggleReport('${escapeAttr(r.id)}')">
            <div>
              <div style="font-weight:900">${date}</div>
              <div style="font-size:12px; color:var(--gray)">${loc}</div>
            </div>
            <i class="fas fa-chevron-down" id="chev-${escapeAttr(r.id)}" style="color:var(--gray)"></i>
          </div>
          ${details}
        </div>`;
    }).join('');
  }

  window.toggleReport = (id) => {
    const el = document.getElementById(`details-${id}`);
    const chev = document.getElementById(`chev-${id}`);
    if (!el) return;
    const open = el.style.display === 'block';
    el.style.display = open ? 'none' : 'block';
    if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
  };

  window.deleteReport = (id) => {
    const ok = confirm('Eliminare questo referto?');
    if (!ok) return;
    reports = reports.filter(r => r.id !== id);
    saveReports();
    renderHistory();
    renderDashboard();
  };

  // -------------------- MODAL: REPORT --------------------
  const examModal = document.getElementById('examModal');
  const closeBtn = document.querySelector('#examModal .close-button');
  const reportForm = document.getElementById('reportForm');
  const reportDate = document.getElementById('reportDate');
  const reportLocation = document.getElementById('reportLocation');
  const reportNotes = document.getElementById('reportNotes');
  const tempExamsList = document.getElementById('tempExamsList');
  const examParamSelect = document.getElementById('examParamSelect');
  const examValue = document.getElementById('examValue');
  const btnAddRow = document.getElementById('btnAddRow');

  function openExamModal() {
    if (!examModal) return;
    examModal.style.display = 'block';
    syncParamSelect();
    renderTempList();
  }

  function closeExamModal() {
    if (!examModal) return;
    examModal.style.display = 'none';
    editingReportId = null;
    tempExams = [];
    if (reportForm) reportForm.reset();
    renderTempList();
  }

  function syncParamSelect() {
    if (!examParamSelect) return;
    examParamSelect.innerHTML = dict.map(p => `<option value="${escapeAttr(p.name)}">${escapeHTML(p.name)}</option>`).join('');
  }

  function renderTempList() {
    if (!tempExamsList) return;
    if (!tempExams.length) {
      tempExamsList.innerHTML = `<small style="color:var(--gray)">Nessuna riga inserita.</small>`;
      return;
    }
    tempExamsList.innerHTML = tempExams.map((e, idx) => {
      const p = getParamConfig(e.param);
      const unit = p?.unit || '';
      return `
        <div class="temp-row">
          <div style="min-width:0">
            <b style="font-size:12px">${escapeHTML(e.param)}</b>
            <div style="font-size:11px; color:var(--gray)">${fmt(e.val, p?.decimals ?? 1)} ${escapeHTML(unit)}</div>
          </div>
          <button type="button" class="icon-btn" onclick="removeTemp(${idx})"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');
  }

  window.removeTemp = (idx) => {
    tempExams.splice(idx, 1);
    renderTempList();
  };

  if (mainAddBtn) mainAddBtn.onclick = () => {
    editingReportId = null;
    tempExams = [];
    if (reportForm) reportForm.reset();
    openExamModal();
  };

  // “+” nello Storico (in alto)
  if (historyAddBtn) historyAddBtn.onclick = () => {
    openExamModal();
  };
  if (closeBtn) closeBtn.onclick = closeExamModal;

  window.onclick = (e) => {
    if (e.target === examModal) closeExamModal();
    if (e.target === toolsModal) closeTools();
    if (e.target === editDictModal) closeEditDict();
  };

  if (btnAddRow) {
    btnAddRow.onclick = () => {
      const param = examParamSelect?.value;
      const val = toNum(examValue?.value);
      if (!param || val === null) return;
      const existing = tempExams.find(x => x.param === param);
      if (existing) existing.val = val;
      else tempExams.push({ param, val });
      if (examValue) examValue.value = '';
      renderTempList();
    };
  }

  if (reportForm) {
    reportForm.onsubmit = (e) => {
      e.preventDefault();
      const date = reportDate?.value;
      const location = (reportLocation?.value || '').trim();
      const notes = (reportNotes?.value || '').trim();
      if (!date || !location) return;

      const exams = tempExams
        .filter(x => x.param && toNum(x.val) !== null)
        .map(x => ({ param: x.param, val: toNum(x.val) }));

      if (editingReportId) {
        const idx = reports.findIndex(r => r.id === editingReportId);
        if (idx >= 0) reports[idx] = { ...reports[idx], date, location, notes, exams };
      } else {
        reports.push({ id: uid(), date, location, notes, exams });
      }

      saveReports();
      closeExamModal();
      renderDashboard();
      renderHistory();
    };
  }

  window.editReport = (id) => {
    const r = reports.find(x => x.id === id);
    if (!r) return;
    editingReportId = id;
    tempExams = (r.exams || []).map(e => ({ param: e.param, val: toNum(e.val) })).filter(e => e.param && e.val !== null);
    if (reportDate) reportDate.value = r.date;
    if (reportLocation) reportLocation.value = r.location || '';
    if (reportNotes) reportNotes.value = r.notes || '';
    openExamModal();
  };

  // -------------------- SETTINGS: DICTIONARY --------------------
  const paramConfigForm = document.getElementById('paramConfigForm');
  const confName = document.getElementById('confName');
  const confUnit = document.getElementById('confUnit');
  const confMin = document.getElementById('confMin');
  const confMax = document.getElementById('confMax');
  const confCategory = document.getElementById('confCategory');
  const confDecimals = document.getElementById('confDecimals');
  const confDirection = document.getElementById('confDirection');

  function renderDictList() {
    const host = document.getElementById('dictionaryList');
    if (!host) return;

    if (!dict.length) {
      host.innerHTML = `<div class="card-white"><b>Nessun parametro</b><br><small style="color:var(--gray)">Aggiungine uno sopra.</small></div>`;
      return;
    }

    const items = [...dict].sort((a, b) => a.name.localeCompare(b.name));
    host.innerHTML = items.map(p => {
      const i = dict.findIndex(x => x.name === p.name);
      return `
        <div class="card-white" style="display:flex; justify-content:space-between; align-items:center; gap:10px">
          <div style="min-width:0">
            <b>${escapeHTML(p.name)}</b>
            <div style="font-size:12px; color:var(--gray)">${escapeHTML(p.category || 'Altro')} • Range: ${p.min ?? '—'}-${p.max ?? '—'} ${escapeHTML(p.unit || '')}</div>
          </div>
          <div style="display:flex; gap:10px; flex-shrink:0">
            <button class="icon-btn" title="Modifica" onclick="openEditDict(${i})"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" title="Elimina" onclick="deleteDict(${i})"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
    }).join('');
  }

  if (paramConfigForm) {
    paramConfigForm.onsubmit = (e) => {
      e.preventDefault();
      const name = (confName?.value || '').trim().toUpperCase();
      const unit = (confUnit?.value || '').trim();
      const min = confMin?.value === '' ? null : toNum(confMin?.value);
      const max = confMax?.value === '' ? null : toNum(confMax?.value);
      const category = (confCategory?.value || 'Altro').trim();
      const decimals = confDecimals?.value === '' ? 1 : clamp(Number(confDecimals?.value), 0, 4);
      const direction = (confDirection?.value || 'range').trim();

      if (!name || !unit) return;
      if (dict.find(d => d.name === name)) {
        alert('Parametro già esistente. Modificalo dalla lista.');
        return;
      }

      dict.push({ name, unit, min, max, color: pickColorByCategory(category), decimals, direction, category });
      saveDict();
      paramConfigForm.reset();
      renderDictList();
      renderDashboard();
    };
  }

  function pickColorByCategory(category) {
    const c = (category || '').toLowerCase();
    if (c.includes('lipid')) return 'bg-orange';
    if (c.includes('emo')) return 'bg-blue';
    if (c.includes('vita')) return 'bg-purple';
    if (c.includes('meta')) return 'bg-blue';
    return 'bg-blue';
  }

  window.deleteDict = (idx) => {
    const p = dict[idx];
    if (!p) return;
    const ok = confirm(`Eliminare il parametro “${p.name}”?`);
    if (!ok) return;
    dict.splice(idx, 1);
    saveDict();
    renderDictList();
    renderDashboard();
  };

  // -------------------- MODAL: EDIT PARAM --------------------
  const editDictModal = document.getElementById('editDictModal');
  const editDictForm = document.getElementById('editDictForm');
  const closeEditDictBtn = document.querySelector('.close-edit-dict');
  const editDictIndex = document.getElementById('editDictIndex');
  const editDictName = document.getElementById('editDictName');
  const editDictUnit = document.getElementById('editDictUnit');
  const editDictMin = document.getElementById('editDictMin');
  const editDictMax = document.getElementById('editDictMax');
  const editDictCategory = document.getElementById('editDictCategory');
  const editDictDecimals = document.getElementById('editDictDecimals');
  const editDictDirection = document.getElementById('editDictDirection');

  function openEditDictModal() {
    if (editDictModal) editDictModal.style.display = 'block';
  }
  function closeEditDict() {
    if (editDictModal) editDictModal.style.display = 'none';
  }
  if (closeEditDictBtn) closeEditDictBtn.onclick = closeEditDict;

  window.openEditDict = (idx) => {
    const p = dict[idx];
    if (!p) return;
    if (editDictIndex) editDictIndex.value = String(idx);
    if (editDictName) editDictName.value = p.name || '';
    if (editDictUnit) editDictUnit.value = p.unit || '';
    if (editDictMin) editDictMin.value = (p.min === null || p.min === undefined) ? '' : String(p.min);
    if (editDictMax) editDictMax.value = (p.max === null || p.max === undefined) ? '' : String(p.max);
    if (editDictCategory) editDictCategory.value = p.category || 'Altro';
    if (editDictDecimals) editDictDecimals.value = String(p.decimals ?? 1);
    if (editDictDirection) editDictDirection.value = p.direction || 'range';
    openEditDictModal();
  };

  if (editDictForm) {
    editDictForm.onsubmit = (e) => {
      e.preventDefault();
      const idx = Number(editDictIndex?.value);
      const p = dict[idx];
      if (!p) return;

      const oldName = p.name;
      const name = (editDictName?.value || '').trim().toUpperCase();
      const unit = (editDictUnit?.value || '').trim();
      const min = editDictMin?.value === '' ? null : toNum(editDictMin?.value);
      const max = editDictMax?.value === '' ? null : toNum(editDictMax?.value);
      const category = (editDictCategory?.value || 'Altro').trim();
      const decimals = editDictDecimals?.value === '' ? 1 : clamp(Number(editDictDecimals?.value), 0, 4);
      const direction = (editDictDirection?.value || 'range').trim();

      if (name !== oldName && dict.some(d => d.name === name)) {
        alert('Esiste già un parametro con questo nome.');
        return;
      }

      dict[idx] = { ...p, name, unit, min, max, category, decimals, direction, color: pickColorByCategory(category) };
      saveDict();
      closeEditDict();
      renderDictList();
      renderDashboard();

      if (name !== oldName) {
        reports = reports.map(r => ({
          ...r,
          exams: (r.exams || []).map(ex => ex.param === oldName ? { ...ex, param: name } : ex)
        }));
        saveReports();
      }
    };
  }

  // -------------------- TOOLS (BACKUP) --------------------
  const toolsModal = document.getElementById('toolsModal');
  const btnTools = document.getElementById('btnTools');
  const closeToolsBtn = document.querySelector('.close-tools');
  const importFile = document.getElementById('importFile');

  function openTools() {
    if (toolsModal) toolsModal.style.display = 'block';
  }
  function closeTools() {
    if (toolsModal) toolsModal.style.display = 'none';
  }
  if (btnTools) btnTools.onclick = openTools;
  if (closeToolsBtn) closeToolsBtn.onclick = closeTools;

  function download(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.exportJSON = () => {
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      dict,
      reports
    };
    download(`iMieiEsami_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  };

  window.importJSON = (ev) => {
    const file = ev?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || ''));
        if (payload?.dict && payload?.reports) {
          dict = (payload.dict || []).map(p => ({ decimals: 1, direction: 'range', category: 'Altro', ...p }));
          reports = (payload.reports || []).map(r => ({ ...r, id: r.id || uid() }));
          saveDict();
          saveReports();
          renderDashboard();
          renderHistory();
          renderDictList();
          alert('Backup importato ✅');
        } else {
          alert('File non valido.');
        }
      } catch {
        alert('Errore durante l’importazione.');
      } finally {
        if (importFile) importFile.value = '';
      }
    };
    reader.readAsText(file);
  };

  window.exportCSV = () => {
    const rows = [['date', 'location', 'notes', 'param', 'value', 'unit', 'min', 'max']];
    sortReportsDesc(reports).forEach(r => {
      (r.exams || []).forEach(ex => {
        const p = getParamConfig(ex.param) || {};
        rows.push([
          r.date,
          (r.location || '').replace(/\n/g, ' '),
          (r.notes || '').replace(/\n/g, ' '),
          ex.param,
          String(ex.val),
          p.unit || '',
          (p.min ?? ''),
          (p.max ?? '')
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(',')).join('\n');
    download(`iMieiEsami_export_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  };

  // -------------------- ESCAPERS --------------------
  function escapeHTML(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function escapeAttr(str) {
    // Non modificare il testo: serve solo per escapare HTML (evita mismatch tipo COLESTEROLO HDL)
    return escapeHTML(str);
  }

  
  // -------------------- SECURITY (PIN Lock) --------------------
  const LS_PIN_HASH = 'app_pin_hash_v1';
  const LS_LOCK_ENABLED = 'app_lock_enabled_v1';

  const lockEnabledToggle = document.getElementById('lockEnabledToggle');
  const pinNew = document.getElementById('pinNew');
  const pinConfirm = document.getElementById('pinConfirm');
  const btnSavePin = document.getElementById('btnSavePin');
  const securityStatus = document.getElementById('securityStatus');

  function setSecurityStatus(msg, tone = 'gray') {
    if (!securityStatus) return;
    securityStatus.textContent = msg;
    securityStatus.style.color = tone === 'danger' ? 'var(--danger)' : (tone === 'success' ? 'var(--success)' : 'var(--gray)');
  }

  async function hashPin(pin) {
    try {
      if (window.crypto?.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}
    // Fallback (non crittograficamente sicuro, ma evita crash se crypto non disponibile)
    let h = 0;
    for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) >>> 0;
    return String(h);
  }

  function hasPin() {
    const h = localStorage.getItem(LS_PIN_HASH);
    return !!(h && h.length >= 8);
  }

  function lockIsEnabled() {
    return localStorage.getItem(LS_LOCK_ENABLED) === '1' && hasPin();
  }

  function syncSecurityUI() {
    if (lockEnabledToggle) lockEnabledToggle.checked = lockIsEnabled();
    if (!hasPin()) setSecurityStatus('Imposta un PIN per attivare il blocco.', 'gray');
    else setSecurityStatus(lockIsEnabled() ? 'Blocco attivo ✅' : 'PIN salvato. Attiva “Blocco app” per richiedere lo sblocco.', 'success');
  }

  // Lock overlay (creato via JS per non modificare l'HTML)
  let lockOverlay = null;
  function ensureLockOverlay() {
    if (lockOverlay) return lockOverlay;
    const el = document.createElement('div');
    el.id = 'lockOverlay';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.55)', 'backdrop-filter:blur(8px)',
      'display:none', 'align-items:center', 'justify-content:center', 'padding:18px',
    ].join(';');

    el.innerHTML = `
      <div style="background:#fff; width:min(420px, 92vw); border-radius:22px; padding:18px; box-sizing:border-box; box-shadow:0 12px 30px rgba(0,0,0,0.25)">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <div style="font-weight:900; font-size:18px">Sblocca</div>
            <div style="color:var(--gray); font-size:12px; margin-top:2px">Inserisci il PIN per accedere</div>
          </div>
        </div>
        <div style="margin-top:14px">
          <input id="lockPinInput" type="password" inputmode="numeric" autocomplete="current-password"
                 placeholder="PIN" style="width:100%; padding:14px; border:1px solid #D1D1D6; border-radius:12px; font-size:16px; box-sizing:border-box">
          <button id="lockUnlockBtn" class="button primary-button" style="margin-top:10px">Sblocca</button>
          <small id="lockMsg" style="display:block; margin-top:10px; color:var(--gray); font-weight:700"></small>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    lockOverlay = el;

    const input = el.querySelector('#lockPinInput');
    const btn = el.querySelector('#lockUnlockBtn');
    const msg = el.querySelector('#lockMsg');

    async function tryUnlock() {
      const pin = String(input.value || '').trim();
      if (!pin) return;
      const stored = localStorage.getItem(LS_PIN_HASH) || '';
      const h = await hashPin(pin);
      if (h === stored) {
        msg.textContent = '';
        input.value = '';
        hideLock();
      } else {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'PIN errato';
        input.select?.();
      }
    }

    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); }
    });

    return el;
  }

  function showLock() {
    if (!lockIsEnabled()) return;
    ensureLockOverlay().style.display = 'flex';
    // chiudi eventuali modali aperte sotto
    try { if (examModal) examModal.style.display = 'none'; } catch {}
    try { if (toolsModal) toolsModal.style.display = 'none'; } catch {}
    try { if (editDictModal) editDictModal.style.display = 'none'; } catch {}
    // focus input
    setTimeout(() => {
      const i = lockOverlay?.querySelector('#lockPinInput');
      i?.focus?.();
    }, 50);
  }

  function hideLock() {
    if (!lockOverlay) return;
    lockOverlay.style.display = 'none';
  }

  function enforceLock() {
    if (lockIsEnabled()) showLock();
    else hideLock();
  }

  // Handlers UI Sicurezza
  if (btnSavePin) {
    btnSavePin.addEventListener('click', async () => {
      const a = String(pinNew?.value || '').trim();
      const b = String(pinConfirm?.value || '').trim();
      if (!/^[0-9]{4,8}$/.test(a)) {
        setSecurityStatus('Il PIN deve avere 4–8 cifre.', 'danger');
        return;
      }
      if (a !== b) {
        setSecurityStatus('I due PIN non coincidono.', 'danger');
        return;
      }
      const h = await hashPin(a);
      localStorage.setItem(LS_PIN_HASH, h);
      localStorage.setItem(LS_LOCK_ENABLED, '1'); // attiva blocco automaticamente
      if (pinNew) pinNew.value = '';
      if (pinConfirm) pinConfirm.value = '';
      syncSecurityUI();
      setSecurityStatus('PIN salvato ✅', 'success');
      enforceLock();
    });
  }

  if (lockEnabledToggle) {
    lockEnabledToggle.addEventListener('change', () => {
      if (lockEnabledToggle.checked) {
        if (!hasPin()) {
          lockEnabledToggle.checked = false;
          setSecurityStatus('Imposta prima un PIN.', 'danger');
          return;
        }
        localStorage.setItem(LS_LOCK_ENABLED, '1');
        setSecurityStatus('Blocco attivo ✅', 'success');
        enforceLock();
      } else {
        localStorage.setItem(LS_LOCK_ENABLED, '0');
        setSecurityStatus('Blocco disattivato.', 'gray');
        enforceLock();
      }
    });
  }

  // Lock all'avvio e quando torni in foreground
  window.addEventListener('pageshow', () => { syncSecurityUI(); enforceLock(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) enforceLock();
  });

  // -------------------- INIT --------------------
  (async () => {
    await initSecurity();
    showView('dashboard');
  })();
});
