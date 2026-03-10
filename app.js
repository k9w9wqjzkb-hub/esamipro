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
  const dashAddBtn = document.getElementById('dashAddBtn');

  // Saluto dinamico nella navbar
  function updateGreeting() {
    const el = document.getElementById('navGreeting');
    if (!el) return;
    const h = new Date().getHours();
    el.textContent = h < 12 ? 'Buongiorno 👋' : h < 18 ? 'Buon pomeriggio 👋' : 'Buonasera 👋';
  }
  updateGreeting();

  // -------------------- PWA --------------------
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js');
    }
  } catch (_) { /* no-op */ }

  // -------------------- ROUTING (SPA) --------------------
  function showView(target) {
    document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
    const targetView = document.getElementById(`view-${target}`);
    if (targetView) targetView.style.display = 'block';

    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.view === target));
    if (mainAddBtn) mainAddBtn.style.display = (target === 'dashboard') ? 'block' : 'none';
    if (dashAddBtn) dashAddBtn.style.display = (target === 'dashboard') ? 'flex' : 'none';

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

  function parseNum(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    // supporta virgola come separatore decimale
    const cleaned = s.replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function toNum(v) {
    return parseNum(v);
  }

  function normName(str) {
    return String(str ?? '')
      .toUpperCase()
      .replace(/[_]+/g, ' ')
      .replace(/[.]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getParamConfig(name) {
    const key = normName(name);
    return dict.find(p => normName(p.name) === key) || null;
  }

  function stepFromDecimals(dec) {
    const d = Number(dec);
    if (!Number.isFinite(d) || d <= 0) return 'any';
    return String(Math.pow(10, -d));
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
    if (val === null || val === undefined || !Number.isFinite(val)) return '--';
    const d = clamp(Number(decimals ?? 1), 0, 4);
    return Number(val).toFixed(d).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1');
  }

  function formatRange(p) {
    if (!p) return 'Range: ---';
    const d = clamp(Number(p.decimals ?? 1), 0, 4);
    const min = (p.min === '' || p.min === undefined) ? null : toNum(p.min);
    const max = (p.max === '' || p.max === undefined) ? null : toNum(p.max);

    if (min === null && max === null) return 'Range: ---';
    if (min !== null && max !== null) return `Range: ${fmt(min, d)}-${fmt(max, d)} ${p.unit || ''}`.trim();
    if (min !== null) return `Range: ≥ ${fmt(min, d)} ${p.unit || ''}`.trim();
    return `Range: ≤ ${fmt(max, d)} ${p.unit || ''}`.trim();
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

    // Calcola anomalie su tutto il dizionario
    const anomalies = [];
    dict.forEach(p => {
      const history = getAllValuesForParam(p.name);
      const last = history[0]?.val ?? null;
      const st = statusForValue(p, last);
      if (st.out) anomalies.push({ p, last, st, sev: severityForValue(p, last), history });
    });

    // ---- HERO: Stato generale ----
    if (overall) {
      const c = anomalies.length;
      const totalWithData = dict.filter(p => getAllValuesForParam(p.name).length > 0).length;
      const tone = c === 0 ? 'ok' : c <= 2 ? 'warn' : 'bad';
      const toneColor = tone === 'ok' ? 'var(--c-green)' : tone === 'warn' ? 'var(--c-orange)' : 'var(--c-red)';
      const toneColorRgb = tone === 'ok' ? '52,199,89' : tone === 'warn' ? '255,149,0' : '255,59,48';
      const icon = tone === 'ok' ? 'fa-circle-check' : tone === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-xmark';
      const lastReport = reports.length > 0 ? sortReportsDesc(reports)[0] : null;
      const lastDate = lastReport ? new Date(lastReport.date).toLocaleDateString('it-IT', { day:'numeric', month:'long', year:'numeric' }) : null;

      overall.className = '';
      overall.style.cssText = `
        margin-bottom: 16px;
        background: var(--surface);
        border-radius: var(--radius-xl);
        padding: 20px;
        border: 0.33px solid var(--separator);
        box-shadow: var(--shadow-md);
        overflow: hidden;
        position: relative;
      `;
      overall.innerHTML = `
        <div style="position:absolute;top:-20px;right:-20px;width:110px;height:110px;
          background:rgba(${toneColorRgb},0.08);border-radius:999px;pointer-events:none"></div>
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:52px;height:52px;border-radius:16px;
            background:rgba(${toneColorRgb},0.12);
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas ${icon}" style="font-size:24px;color:${toneColor}"></i>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:19px;font-weight:700;letter-spacing:-0.3px;color:var(--label)">
              ${c === 0 ? 'Tutto nella norma' : c === 1 ? '1 valore anomalo' : `${c} valori anomali`}
            </div>
            <div style="font-size:12px;color:var(--label2);margin-top:3px">
              ${totalWithData} parametr${totalWithData===1?'o':'i'} monitorati
              ${lastDate ? `· Ultimo referto ${lastDate}` : ''}
            </div>
          </div>
        </div>
        ${totalWithData > 0 ? `
        <div style="margin-top:16px;display:flex;gap:6px;align-items:center">
          <div style="flex:1;height:5px;background:var(--fill3);border-radius:999px;overflow:hidden">
            <div style="height:100%;width:${Math.round(((totalWithData-c)/Math.max(totalWithData,1))*100)}%;
              background:${toneColor};border-radius:999px;
              transition:width 0.6s cubic-bezier(0.34,1.56,0.64,1)"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${toneColor};flex-shrink:0">
            ${totalWithData > 0 ? Math.round(((totalWithData-c)/totalWithData)*100) : 100}% OK
          </span>
        </div>` : ''}
      `;
    }

    // ---- GRIGLIA: tutti i parametri, ordinati per severità poi alfabeticamente ----
    function getSortKey(p) {
      const h = getAllValuesForParam(p.name);
      const last = h[0]?.val ?? null;
      const st = statusForValue(p, last);
      const sev = severityForValue(p, last);
      if (!st.out) return last !== null ? 10 : 20; // normale con dati, poi senza dati
      if (sev.level === 'severe')   return 1;
      if (sev.level === 'moderate') return 2;
      if (sev.level === 'light')    return 3;
      return 4;
    }

    const orderedDict = [...dict].sort((a, b) => {
      const sk = getSortKey(a) - getSortKey(b);
      if (sk !== 0) return sk;
      return a.name.localeCompare(b.name, 'it'); // a parità di severità, ordine alfabetico
    });

    grid.innerHTML = orderedDict.map(p => {
      const historyDesc = getAllValuesForParam(p.name);
      const last  = historyDesc[0]?.val ?? null;
      const prev  = historyDesc[1]?.val ?? null;
      const st    = statusForValue(p, last);
      const { delta } = deltaInfo(historyDesc);

      // Colore accento della card
      const accentMap = {
        'bg-blue':   { color: '#007AFF', rgb: '0,122,255'   },
        'bg-orange': { color: '#FF9500', rgb: '255,149,0'   },
        'bg-purple': { color: '#AF52DE', rgb: '175,82,222'  },
        'bg-green':  { color: '#34C759', rgb: '52,199,89'   },
        'bg-teal':   { color: '#5AC8FA', rgb: '90,200,250'  },
        'bg-indigo': { color: '#5856D6', rgb: '88,86,214'   },
        'bg-red':    { color: '#FF3B30', rgb: '255,59,48'   },
      };
      const accent = st.out
        ? { color: '#FF3B30', rgb: '255,59,48' }
        : (accentMap[p.color] || { color: '#007AFF', rgb: '0,122,255' });

      // Trend arrow
      let trendIcon = '', trendColor = 'var(--label3)';
      if (delta !== null && prev !== null) {
        if (delta > 0) { trendIcon = '↑'; trendColor = st.out && st.state==='HIGH' ? 'var(--c-red)' : 'var(--c-green)'; }
        else if (delta < 0) { trendIcon = '↓'; trendColor = st.out && st.state==='LOW' ? 'var(--c-red)' : 'var(--c-green)'; }
        else { trendIcon = '→'; }
      }

      const svgSparkline = generateSVGSparkline(historyDesc.slice(0,8).reverse(), p.min, p.max, accent.color);

      const noData = last === null;
      const sev = severityForValue(p, last);

      // Data ultimo esame
      const lastDate = historyDesc[0]?.date
        ? new Date(historyDesc[0].date).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'2-digit' })
        : null;

      // Bordo: verde se normale con dati, colorato per severità se anomalo, grigio se no dati
      const cardBorder = noData
        ? '0.33px solid var(--separator)'
        : st.out
          ? (sev.level === 'severe'   ? '1.5px solid var(--c-red)'
           : sev.level === 'moderate' ? '1.5px solid var(--c-orange)'
           :                            '1.5px solid var(--c-yellow)')
          : '1.5px solid var(--c-green)';

      return `
        <div class="metric-card-v2" style="
          background: var(--surface);
          border-radius: var(--radius-lg);
          padding: 14px;
          border: ${cardBorder};
          box-shadow: var(--shadow-sm);
          display: flex; flex-direction: column; gap: 6px;
          min-height: 130px;
          opacity: ${noData ? '0.45' : '1'};
          position: relative; overflow: hidden;
          transition: transform 0.15s, box-shadow 0.15s;
          cursor: ${noData ? 'default' : 'pointer'};
        " ontouchstart="this.style.transform='scale(0.97)'" ontouchend="this.style.transform='scale(1)'">

          <!-- Sfondo accent -->
          <div style="position:absolute;bottom:-16px;right:-16px;width:72px;height:72px;
            border-radius:999px;background:rgba(${accent.rgb},0.08);pointer-events:none"></div>

          <!-- Header: nome + pallino stato -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <div style="font-size:10px;font-weight:700;color:var(--label2);
              text-transform:uppercase;letter-spacing:0.3px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">
              ${escapeHTML(p.name)}
            </div>
            ${!noData ? `<div style="width:7px;height:7px;border-radius:999px;
              background:${st.out ? 'var(--c-red)' : 'var(--c-green)'};flex-shrink:0"></div>` : ''}
          </div>

          <!-- Valore principale -->
          <div style="display:flex;align-items:baseline;gap:4px">
            <span style="font-size:${last !== null && String(fmt(last,p.decimals)).length > 5 ? '20' : '26'}px;
              font-weight:800;letter-spacing:-0.8px;
              color:${st.out ? 'var(--c-red)' : 'var(--label)'}">
              ${noData ? '—' : fmt(last, p.decimals)}
            </span>
            <span style="font-size:11px;font-weight:500;color:var(--label2)">
              ${escapeHTML(p.unit || '')}
            </span>
            ${trendIcon ? `<span style="font-size:12px;font-weight:700;color:${trendColor};margin-left:2px">${trendIcon}</span>` : ''}
          </div>

          <!-- Sparkline SVG -->
          <div style="flex:1;display:flex;align-items:flex-end">
            ${svgSparkline}
          </div>

          <!-- Footer: range + data -->
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
            <div style="font-size:9px;font-weight:600;color:var(--label3);letter-spacing:0.1px">
              ${noData ? 'Nessun dato' : (st.out ? `<span style="color:${sev.level==='severe'?'var(--c-red)':sev.level==='moderate'?'var(--c-orange)':'var(--c-yellow)'};font-weight:700">${st.state==='HIGH'?'↑ SOPRA':'↓ SOTTO'} RANGE</span>` : formatRange(p))}
            </div>
            ${lastDate ? `<div style="font-size:9px;color:var(--label3);font-weight:500;flex-shrink:0">${lastDate}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    // ---- SEZIONE ANOMALIE: rimossa, le info sono già nelle card ----
    if (alertSection) alertSection.style.display = 'none';
  }

  // ---- SVG Sparkline inline ----
  function generateSVGSparkline(dataAsc, min, max, accentColor) {
    if (!dataAsc || dataAsc.length === 0) return '';
    const W = 100, H = 32;
    const vals = dataAsc.map(d => d.val);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = (hi - lo) || 1;

    const safeMin = (min === null || min === undefined || min === '') ? null : toNum(min);
    const safeMax = (max === null || max === undefined || max === '') ? null : toNum(max);

    const xs = dataAsc.map((_, i) => dataAsc.length === 1 ? W/2 : Math.round((i / (dataAsc.length - 1)) * W));
    const ys = vals.map(v => Math.round(H - 2 - ((v - lo) / span) * (H - 6)));

    // Polyline path
    const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');

    // Area fill path
    const areaPath = `M${xs[0]},${H} ` + xs.map((x,i) => `L${x},${ys[i]}`).join(' ') + ` L${xs[xs.length-1]},${H} Z`;

    // Punti fuori range
    const dots = vals.map((v, i) => {
      const out = (safeMin !== null && v < safeMin) || (safeMax !== null && v > safeMax);
      return out ? `<circle cx="${xs[i]}" cy="${ys[i]}" r="2.5" fill="var(--c-red)"/>` : '';
    }).join('');

    const uid = `sp-${Math.random().toString(36).slice(2,7)}`;

    return `
      <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block">
        <defs>
          <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#${uid})"/>
        <polyline points="${pts}" fill="none" stroke="${accentColor}" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"/>
        ${dataAsc.length === 1 ? `<circle cx="${xs[0]}" cy="${ys[0]}" r="3" fill="${accentColor}"/>` : ''}
        ${dots}
        <circle cx="${xs[xs.length-1]}" cy="${ys[ys.length-1]}" r="2.5"
          fill="${accentColor}" stroke="var(--surface)" stroke-width="1.5"/>
      </svg>`;
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
    const sortedDict = [...dict].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    sel.innerHTML = sortedDict.map(u => `<option value="${escapeHTML(u.name)}">${escapeHTML(u.name)}</option>`).join('');
    if (prev && dict.some(d => d.name === prev)) sel.value = prev;

    const redraw = () => {
      const pName = sel.value;
      const pConfig = dict.find(d => d.name === pName);
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

      // Banda verde range min/max — logica originale che funzionava
      const hasMin = pConfig && pConfig.min !== null && pConfig.min !== '' && pConfig.min !== undefined;
      const hasMax = pConfig && pConfig.max !== null && pConfig.max !== '' && pConfig.max !== undefined;
      const minVal = hasMin ? Number(pConfig.min) : null;
      const maxVal = hasMax ? Number(pConfig.max) : null;

      // Se non ci sono punti, non possiamo disegnare nulla
      const xLabels = pts.length >= 2 ? pts.map(p => p.x)
                    : pts.length === 1 ? [pts[0].x, pts[0].x]
                    : [];
      const n = xLabels.length;

      const datasets = [];

      if (mode === 'values' && hasMin && hasMax && Number.isFinite(minVal) && Number.isFinite(maxVal) && n > 0) {
        datasets.push({
          label: 'MIN',
          data: Array(n).fill(minVal),
          borderColor: 'rgba(0,0,0,0)',
          pointRadius: 0,
          borderWidth: 0,
        });
        datasets.push({
          label: 'RANGE',
          data: Array(n).fill(maxVal),
          borderColor: 'rgba(0,0,0,0)',
          backgroundColor: 'rgba(52,199,89,0.14)',
          pointRadius: 0,
          borderWidth: 0,
          fill: '-1',
        });
      }

      const mainData = pts.length === 1 ? [series[0], series[0]] : series;
      datasets.push({
        label,
        data: mainData,
        borderColor: '#007AFF',
        backgroundColor: 'rgba(0,122,255,0.08)',
        tension: 0.35,
        fill: false,
        spanGaps: true,
        pointRadius: (ctx) => ctx.dataIndex === mainData.length - 1 ? 4 : 2,
        pointBackgroundColor: '#007AFF',
        pointBorderColor: 'white',
        pointBorderWidth: 1.5,
        pointHoverRadius: 6,
      });

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
      const tickColor = isDark ? 'rgba(235,235,245,0.4)' : 'rgba(60,60,67,0.4)';

      tChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: xLabels.length > 0 ? xLabels : pts.map(p => p.x),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? 'rgba(44,44,46,0.95)' : 'rgba(255,255,255,0.95)',
              titleColor: isDark ? '#fff' : '#000',
              bodyColor: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
              borderColor: isDark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)',
              borderWidth: 0.5,
              cornerRadius: 12,
              padding: 10,
              filter: (item) => !['MIN_BAND','MAX_BAND','ZERO_BAND'].includes(item.dataset.label),
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
            x: {
              grid: { color: gridColor },
              ticks: { color: tickColor, font: { size: 11 }, maxRotation: 0 }
            },
            y: {
              grid: {
                color: (context) => {
                  if (mode !== 'values' || !pConfig) return gridColor;
                  if (context.tick?.value === Number(pConfig.min) || context.tick?.value === Number(pConfig.max)) return 'rgba(255,59,48,0.3)';
                  return gridColor;
                },
                lineWidth: (context) => {
                  if (mode !== 'values' || !pConfig) return 1;
                  if (context.tick?.value === Number(pConfig.min) || context.tick?.value === Number(pConfig.max)) return 1.5;
                  return 1;
                }
              },
              ticks: { color: tickColor, font: { size: 11 } }
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
      host.innerHTML = `<div class="empty-state"><i class="fas fa-flask"></i><div style="font-weight:600;font-size:16px;color:var(--label)">Nessun referto</div><div style="font-size:13px;margin-top:4px">Premi + per inserire il primo referto.</div></div>`;
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
                <b style="font-size:13px;color:var(--label)">${escapeHTML(p.name)}</b>
                <div style="font-size:11px; color:var(--label2);margin-top:2px">${formatRange(p)}</div>
              </div>
              <div style="text-align:right; white-space:nowrap">
                <div style="font-weight:800;font-size:16px;color:var(--label)">${v !== null ? fmt(v, p.decimals) : '--'} <span style="font-size:11px; font-weight:500;color:var(--label2)">${escapeHTML(p.unit || '')}</span></div>
                <div style="font-size:10px; color:var(--label3); font-weight:700">${dTxt}</div>
              </div>
            </div>
            <div style="margin-top:8px">${badge}</div>
          </div>`;
      }).join('');

      const details = `
        <div class="report-details" style="display:none" id="details-${escapeAttr(r.id)}">
          <div style="padding: 14px 16px">
            ${notes ? `<div class="note-box"><b style="font-size:13px">Note</b><br><small style="color:var(--label2)">${escapeHTML(notes)}</small></div>` : ''}
            ${rows || `<small style="color:var(--label2)">Nessun parametro nel referto.</small>`}
            <div style="display:flex; gap:10px; margin-top:14px">
              <button class="button secondary-button" style="flex:1" onclick="editReport('${escapeAttr(r.id)}')"><i class="fas fa-pen" style="margin-right:8px"></i>Modifica</button>
              <button class="button" style="flex:1; background: var(--c-red); color:white" onclick="deleteReport('${escapeAttr(r.id)}')"><i class="fas fa-trash" style="margin-right:8px"></i>Elimina</button>
            </div>
          </div>
        </div>`;

      return `
        <div class="report-card">
          <div class="report-header" onclick="toggleReport('${escapeAttr(r.id)}')">
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--label)">${date}</div>
              <div style="font-size:12px; color:var(--label2);margin-top:2px">${loc} · ${(r.exams||[]).length} parametr${(r.exams||[]).length===1?'o':'i'}</div>
            </div>
            <i class="fas fa-chevron-right" id="chev-${escapeAttr(r.id)}" style="color:var(--label3);transition:transform 0.22s"></i>
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
    if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
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


  if (examParamSelect) examParamSelect.addEventListener('change', syncExamValueStep);

  function openExamModal() {
    if (!examModal) return;
    examModal.style.display = 'block';
    syncParamSelect();
    syncExamValueStep();
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
    examParamSelect.innerHTML = dict.map(p => `<option value="${escapeHTML(p.name)}">${escapeHTML(p.name)}</option>`).join('');
  }

  function syncExamValueStep() {
    if (!examValue || !examParamSelect) return;
    const p = getParamConfig(examParamSelect.value);
    const d = p?.decimals ?? 1;
    examValue.step = stepFromDecimals(d);
    // su iOS aiuta avere inputmode decimale
    examValue.inputMode = 'decimal';
  }


  function renderTempList() {
    if (!tempExamsList) return;
    if (!tempExams.length) {
      tempExamsList.innerHTML = `<div style="text-align:center;padding:14px 0;color:var(--label3);font-size:13px">Nessuna riga inserita</div>`;
      return;
    }
    tempExamsList.innerHTML = tempExams.map((e, idx) => {
      const p = dict.find(d => d.name === e.param);
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
  if (dashAddBtn) dashAddBtn.onclick = () => {
    editingReportId = null;
    tempExams = [];
    if (reportForm) reportForm.reset();
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


  // Step dinamico per supportare decimali (es. 0,026) e evitare arrotondamenti su iOS
  function syncConfigSteps() {
    const d = confDecimals?.value ?? 1;
    const step = stepFromDecimals(d);
    if (confMin) confMin.step = step;
    if (confMax) confMax.step = step;
  }
  if (confDecimals) {
    confDecimals.addEventListener('change', syncConfigSteps);
    confDecimals.addEventListener('input', syncConfigSteps);
  }
  // Imposta subito
  syncConfigSteps();

  function renderDictList() {
    const host = document.getElementById('dictionaryList');
    if (!host) return;

    if (!dict.length) {
      host.innerHTML = `<div class="empty-state"><i class="fas fa-list"></i><div style="font-size:15px;font-weight:600;color:var(--label)">Nessun parametro</div><div style="font-size:13px;margin-top:4px">Aggiungine uno sopra.</div></div>`;
      return;
    }

    const items = [...dict].sort((a, b) => a.name.localeCompare(b.name));
    // Group by category
    const categories = {};
    items.forEach(p => {
      const cat = p.category || 'Altro';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(p);
    });

    host.innerHTML = Object.entries(categories).map(([cat, params]) => `
      <div style="margin-bottom:20px">
        <p style="font-size:11px;font-weight:700;color:var(--label2);text-transform:uppercase;letter-spacing:0.4px;margin:0 0 8px 4px">${escapeHTML(cat)}</p>
        <div class="grouped-section">
          ${params.map(p => {
            const i = dict.findIndex(x => x.name === p.name);
            return `
              <div class="grouped-row">
                <div style="flex:1;min-width:0">
                  <div style="font-size:15px;font-weight:600;color:var(--label)">${escapeHTML(p.name)}</div>
                  <div style="font-size:12px;color:var(--label2)">${formatRange(p)}</div>
                </div>
                <button class="icon-btn" title="Modifica" onclick="openEditDict(${i})"><i class="fas fa-pen"></i></button>
                <button class="icon-btn" title="Elimina" onclick="deleteDict(${i})" style="color:var(--c-red)"><i class="fas fa-trash"></i></button>
              </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');
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


  function syncEditSteps() {
    const d = editDictDecimals?.value ?? 1;
    const step = stepFromDecimals(d);
    if (editDictMin) editDictMin.step = step;
    if (editDictMax) editDictMax.step = step;
  }
  if (editDictDecimals) {
    editDictDecimals.addEventListener('change', syncEditSteps);
    editDictDecimals.addEventListener('input', syncEditSteps);
  }

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

  
  // -------------------- SECURITY (PIN / FaceID placeholder) --------------------
  // Logica minimale e robusta. Non tocca import/export né i dati clinici.
  const LS_LOCK_ENABLED = 'ime_lock_enabled_v1';
  const LS_PIN_HASH = 'ime_pin_hash_v1';
  const LS_BIO_ENABLED = 'ime_bio_enabled_v1';

  const lockEnabledToggle = document.getElementById('lockEnabledToggle');
  const pinNew = document.getElementById('pinNew');
  const pinConfirm = document.getElementById('pinConfirm');
  const btnSavePin = document.getElementById('btnSavePin');
  const btnSetupBiometric = document.getElementById('btnSetupBiometric');
  const btnDisableBiometric = document.getElementById('btnDisableBiometric');
  const securityStatus = document.getElementById('securityStatus');

  function setSecurityStatus(msg = '', tone = 'neutral') {
    if (!securityStatus) return;
    securityStatus.textContent = msg;
    securityStatus.style.color =
      tone === 'ok'  ? 'var(--c-green)' :
      tone === 'bad' ? 'var(--c-red)' :
      'var(--label2)';
  }

  function getLockEnabled() { return localStorage.getItem(LS_LOCK_ENABLED) === '1'; }
  function setLockEnabled(v) { localStorage.setItem(LS_LOCK_ENABLED, v ? '1' : '0'); }
  function hasPin() { return !!localStorage.getItem(LS_PIN_HASH); }

  async function sha256(text) {
    try {
      if (window.crypto?.subtle) {
        const enc = new TextEncoder();
        const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}
    // fallback (non perfetto ma evita rotture su device vecchi)
    let h = 0;
    for (let i = 0; i < text.length; i++) { h = ((h << 5) - h) + text.charCodeAt(i); h |= 0; }
    return `h${Math.abs(h)}`;
  }

  async function savePin() {
    const a = (pinNew?.value || '').trim();
    const b = (pinConfirm?.value || '').trim();
    if (!a || !b) { setSecurityStatus('Inserisci e conferma il PIN.', 'bad'); return; }
    if (a !== b) { setSecurityStatus('I PIN non coincidono.', 'bad'); return; }
    if (!/^[0-9]{4,8}$/.test(a)) { setSecurityStatus('PIN non valido: usa 4–8 cifre.', 'bad'); return; }
    const hash = await sha256(a);
    localStorage.setItem(LS_PIN_HASH, hash);
    setLockEnabled(true);
    if (lockEnabledToggle) lockEnabledToggle.checked = true;
    if (pinNew) pinNew.value = '';
    if (pinConfirm) pinConfirm.value = '';
    setSecurityStatus('PIN salvato ✅', 'ok');
    syncBiometricButtons();
  }

  // -------------------- LOCK SCREEN --------------------
  const LS_UNLOCKED  = 'ime_unlocked_session_v1';
  const lockScreen   = document.getElementById('lockScreen');
  const lockPinInput = document.getElementById('lockPinInput');
  const lockError    = document.getElementById('lockError');
  const btnUnlock    = document.getElementById('btnUnlock');
  const btnUnlockBio = document.getElementById('btnUnlockBiometric');

  function isUnlocked() { return sessionStorage.getItem(LS_UNLOCKED) === '1'; }
  function setUnlocked(v) { sessionStorage.setItem(LS_UNLOCKED, v ? '1' : '0'); }

  function lockShow(msg = '') {
    if (!lockScreen) return;
    lockScreen.style.display = 'flex';
    if (lockError) lockError.textContent = msg;
    if (lockPinInput) { lockPinInput.value = ''; setTimeout(() => lockPinInput.focus(), 50); }
  }
  function lockHide() {
    if (!lockScreen) return;
    lockScreen.style.display = 'none';
    if (lockError) lockError.textContent = '';
  }

  async function verifyPinInput() {
    if (!getLockEnabled()) return true;
    const stored = localStorage.getItem(LS_PIN_HASH);
    if (!stored) { lockShow('Imposta un PIN in Config → Sicurezza.'); return false; }
    const pin = (lockPinInput?.value || '').trim();
    const hash = await sha256(pin);
    if (hash !== stored) { lockShow('PIN errato.'); return false; }
    setUnlocked(true);
    lockHide();
    return true;
  }

  function biometricAvailable() {
    return localStorage.getItem(LS_BIO_ENABLED) === '1' && Boolean(window.isSecureContext);
  }

  function enforceLockIfNeeded(reason = '') {
    if (!getLockEnabled() || !hasPin()) { lockHide(); return; }
    if (!isUnlocked()) lockShow(reason);
  }

  if (btnUnlock) btnUnlock.addEventListener('click', () => verifyPinInput());
  if (lockPinInput) lockPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyPinInput(); });

  if (btnUnlockBio) {
    btnUnlockBio.style.display = biometricAvailable() ? 'block' : 'none';
    btnUnlockBio.addEventListener('click', async () => {
      if (biometricAvailable()) { setUnlocked(true); lockHide(); }
      else { lockShow('Sblocco biometrico non disponibile.'); }
    });
  }

  if (getLockEnabled() && hasPin()) { setUnlocked(false); enforceLockIfNeeded(); }

  document.addEventListener('visibilitychange', () => {
    if (!getLockEnabled() || !hasPin()) return;
    if (document.hidden) setUnlocked(false);
    else enforceLockIfNeeded();
  });

  if (lockEnabledToggle) {
    lockEnabledToggle.addEventListener('change', () => {
      if (!getLockEnabled()) { setUnlocked(true); lockHide(); }
      if (btnUnlockBio) btnUnlockBio.style.display = biometricAvailable() ? 'block' : 'none';
    });
  }


  function syncBiometricButtons() {
    const enabled = localStorage.getItem(LS_BIO_ENABLED) === '1';
    const canShow = hasPin();
    if (btnSetupBiometric) btnSetupBiometric.style.display = (canShow && !enabled) ? 'block' : 'none';
    if (btnDisableBiometric) btnDisableBiometric.style.display = (canShow && enabled) ? 'block' : 'none';
  }

  // Init toggle + handlers
  if (lockEnabledToggle) {
    lockEnabledToggle.checked = getLockEnabled();
    lockEnabledToggle.addEventListener('change', () => {
      const want = lockEnabledToggle.checked;
      if (want && !hasPin()) {
        lockEnabledToggle.checked = false;
        setLockEnabled(false);
        setSecurityStatus('Prima salva un PIN per attivare il blocco.', 'bad');
        return;
      }
      setLockEnabled(want);
      setSecurityStatus(want ? 'Blocco attivo.' : 'Blocco disattivato.', want ? 'ok' : 'neutral');
      syncBiometricButtons();
    });
  }

  if (btnSavePin) btnSavePin.addEventListener('click', () => { savePin(); });

  // “Biometria” placeholder: salviamo solo il flag (FaceID reale via WebAuthn sarebbe un upgrade separato).
  if (btnSetupBiometric) btnSetupBiometric.addEventListener('click', () => {
    if (!hasPin()) { setSecurityStatus('Prima salva un PIN.', 'bad'); return; }
    localStorage.setItem(LS_BIO_ENABLED, '1');
    setSecurityStatus('Biometria segnata come attiva ✅', 'ok');
    syncBiometricButtons();
  });
  if (btnDisableBiometric) btnDisableBiometric.addEventListener('click', () => {
    localStorage.setItem(LS_BIO_ENABLED, '0');
    setSecurityStatus('Biometria disattivata.', 'neutral');
    syncBiometricButtons();
  });

  if (securityStatus) {
    setSecurityStatus(hasPin() ? (getLockEnabled() ? 'Blocco attivo.' : 'Blocco disattivato.') : 'Imposta un PIN per proteggere l’app.');
  }
  syncBiometricButtons();

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
        const p = dict.find(d => d.name === ex.param) || {};
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
    return escapeHTML(str).replace(/\s+/g, '_');
  }

  // -------------------- INIT --------------------
  showView('dashboard');
});
