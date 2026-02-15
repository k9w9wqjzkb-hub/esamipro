document.addEventListener('DOMContentLoaded', () => {
    // Database
    let reports = JSON.parse(localStorage.getItem('blood_reports_v2')) || [];
    let dict = JSON.parse(localStorage.getItem('param_dict')) || [
        { name: 'Glucosio', unit: 'mg/dL', min: 70, max: 100, color: 'bg-blue' },
        { name: 'Colesterolo', unit: 'mg/dL', min: 150, max: 200, color: 'bg-red' },
        { name: 'Sideremia', unit: 'µg/dL', min: 60, max: 160, color: 'bg-orange' },
        { name: 'Vitamina D', unit: 'ng/mL', min: 30, max: 100, color: 'bg-purple' }
    ];

    let tempExams = [];
    const mainAddBtn = document.getElementById('mainAddBtn');

    // --- NAVIGAZIONE ---
    function showView(target) {
        document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
        document.getElementById(`view-${target}`).style.display = 'block';
        
        document.querySelectorAll('.tab-item').forEach(t => {
            t.classList.toggle('active', t.dataset.view === target);
        });

        if (mainAddBtn) {
            mainAddBtn.style.display = (target === 'dashboard') ? 'block' : 'none';
        }

        if(target === 'trends') renderTrendPage();
        if(target === 'history') renderHistory();
        if(target === 'dashboard') renderDashboard();
        if(target === 'settings') renderDictList();
    }

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.onclick = (e) => { e.preventDefault(); showView(tab.dataset.view); };
    });

    // --- GESTIONE MODAL STRUMENTI (INGRANAGGIO) ---
    const toolsModal = document.getElementById('toolsModal');
    const btnTools = document.getElementById('btnTools');
    const closeTools = document.querySelector('.close-tools');

    if (btnTools) {
        btnTools.onclick = () => toolsModal.style.display = 'block';
    }
    if (closeTools) {
        closeTools.onclick = () => toolsModal.style.display = 'none';
    }

    // Funzione export JSON
    window.exportJSON = () => {
        const data = { reports, dict };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_esami_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    };

    // Funzione import JSON
    window.importJSON = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.reports && data.dict) {
                    if (confirm("Attenzione: questo sovrascriverà tutti i dati attuali. Vuoi procedere?")) {
                        localStorage.setItem('blood_reports_v2', JSON.stringify(data.reports));
                        localStorage.setItem('param_dict', JSON.stringify(data.dict));
                        location.reload();
                    }
                } else { alert("File di backup non valido."); }
            } catch (err) { alert("Errore nel caricamento del file."); }
        };
        reader.readAsText(file);
    };

    // Funzione export CSV
    window.exportCSV = () => {
        let csv = "Data,Luogo,Parametro,Valore,Unita\n";
        reports.forEach(r => {
            r.exams.forEach(e => {
                csv += `${r.date},"${r.location.replace(/"/g, '""')}",${e.param},${e.val},${e.unit}\n`;
            });
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_esami_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    // --- GESTIONE DIZIONARIO ---
    window.renderDictList = () => {
        const list = document.getElementById('dictionaryList');
        if(!list) return;
        list.innerHTML = `<h3 class="section-title" style="font-size:18px">Parametri Salvati</h3>` + 
            dict.map((p, index) => `
                <div class="report-card" style="padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; background:white">
                    <div>
                        <b>${p.name}</b> <small style="color:gray">(${p.unit})</small>
                        <br><small>Range: ${p.min !== null ? p.min : 'N/A'} - ${p.max !== null ? p.max : 'N/A'}</small>
                    </div>
                    <div style="display:flex; gap:15px">
                        <i class="fas fa-edit" onclick="editDictItem(${index})" style="color:var(--ios-blue); cursor:pointer"></i>
                        <i class="fas fa-trash" onclick="deleteDictItem(${index})" style="color:var(--danger); cursor:pointer"></i>
                    </div>
                </div>
            `).join('');

        const select = document.getElementById('examParamSelect');
        if(select) {
            select.innerHTML = '<option value="">Scegli...</option>' + 
                dict.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        }
    };

    window.editDictItem = (index) => {
        const p = dict[index];
        const newName = prompt("Nome parametro:", p.name);
        if (newName === null) return;
        const newUnit = prompt("Unità di misura:", p.unit);
        const newMin = prompt("Minimo:", p.min !== null ? p.min : "");
        const newMax = prompt("Massimo:", p.max !== null ? p.max : "");

        dict[index] = {
            ...p,
            name: newName,
            unit: newUnit,
            min: newMin === "" ? null : parseFloat(newMin),
            max: newMax === "" ? null : parseFloat(newMax)
        };
        saveDict();
    };

    window.deleteDictItem = (index) => {
        if(confirm(`Eliminare "${dict[index].name}"?`)) {
            dict.splice(index, 1);
            saveDict();
        }
    };

    function saveDict() {
        localStorage.setItem('param_dict', JSON.stringify(dict));
        renderDictList();
    }

    document.getElementById('paramConfigForm').onsubmit = (e) => {
        e.preventDefault();
        dict.push({
            name: document.getElementById('confName').value,
            unit: document.getElementById('confUnit').value,
            min: parseFloat(document.getElementById('confMin').value) || null,
            max: parseFloat(document.getElementById('confMax').value) || null,
            color: 'bg-blue'
        });
        saveDict();
        e.target.reset();
    };

    // --- AGGIUNTA REFERTO ---
    if (mainAddBtn) {
        mainAddBtn.onclick = () => {
            document.getElementById('examModal').style.display = 'block';
            renderDictList(); 
        };
    }

    document.querySelector('.close-button').onclick = () => {
        document.getElementById('examModal').style.display = 'none';
        tempExams = [];
        renderTempList();
    };

    document.getElementById('btnAddRow').onclick = () => {
        const name = document.getElementById('examParamSelect').value;
        const val = parseFloat(document.getElementById('examValue').value);
        if(!name || isNaN(val)) return alert("Inserisci parametro e valore");
        const config = dict.find(d => d.name === name);
        tempExams.push({ param: name, val: val, unit: config.unit });
        renderTempList();
        document.getElementById('examValue').value = '';
    };

    function renderTempList() {
        const container = document.getElementById('tempExamsList');
        if(!container) return;
        container.innerHTML = tempExams.map((e, i) => `
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px; background:white; padding:8px; border-radius:8px">
                <span>${e.param}: <b>${e.val} ${e.unit}</b></span>
                <i class="fas fa-minus-circle" onclick="removeTemp(${i})" style="color:var(--danger)"></i>
            </div>
        `).join('') || '<span style="color:gray; font-size:12px">Aggiungi parametri...</span>';
    }

    window.removeTemp = (i) => { tempExams.splice(i,1); renderTempList(); };

    document.getElementById('reportForm').onsubmit = (e) => {
        e.preventDefault();
        if(tempExams.length === 0) return alert("Aggiungi almeno un esame");
        reports.push({
            id: Date.now(),
            date: document.getElementById('reportDate').value,
            location: document.getElementById('reportLocation').value,
            exams: [...tempExams]
        });
        localStorage.setItem('blood_reports_v2', JSON.stringify(reports));
        tempExams = [];
        document.getElementById('examModal').style.display = 'none';
        e.target.reset();
        renderTempList();
        renderDashboard();
    };

    // --- DASHBOARD & STORICO ---
    function renderDashboard() {
        const grid = document.getElementById('keyMetricsGrid');
        if(!grid) return;
        grid.innerHTML = dict.slice(0,6).map(p => {
            const allValues = [];
            reports.forEach(r => {
                const found = r.exams.find(ex => ex.param === p.name);
                if(found) allValues.push({ val: found.val, date: r.date });
            });
            const last = allValues.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
            const valStr = last ? `${last.val} <small>${p.unit}</small>` : '--';
            const isOut = last && ((p.min !== null && last.val < p.min) || (p.max !== null && last.val > p.max));
            return `
                <div class="metric-card ${p.color}" style="${isOut ? 'border-left-color:var(--danger)' : ''}">
                    <label>${p.name}</label>
                    <div style="font-size:20px; font-weight:800; margin:8px 0">${valStr}</div>
                    <small style="color:${isOut ? 'var(--danger)' : 'var(--gray)'}">${isOut ? 'FUORI RANGE' : (last ? 'NORMALE' : 'NO DATI')}</small>
                </div>`;
        }).join('');
    }

    function renderHistory() {
        const hist = document.getElementById('historyList');
        if(!hist) return;
        hist.innerHTML = reports.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => `
            <div class="report-card">
                <div class="report-header" onclick="toggleReport(${r.id})">
                    <div><b>${r.location}</b><br><small>${r.date}</small></div>
                    <i class="fas fa-chevron-down" style="color:var(--ios-blue)"></i>
                </div>
                <div id="det-${r.id}" class="report-details" style="display:none; padding:15px; background:#fafafa">
                    ${r.exams.map(e => `
                        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:0.5px solid #eee">
                            <span>${e.param}</span><b>${e.val} ${e.unit}</b>
                        </div>
                    `).join('')}
                    <button style="color:var(--danger); background:none; border:none; width:100%; padding-top:15px; font-weight:600; cursor:pointer" onclick="delReport(${r.id})">Elimina Report</button>
                </div>
            </div>
        `).join('') || '<p style="text-align:center; color:gray">Vuoto</p>';
    }

    window.toggleReport = (id) => {
        const d = document.getElementById(`det-${id}`);
        if(d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };

    window.delReport = (id) => {
        if(confirm("Eliminare report?")) {
            reports = reports.filter(r => r.id !== id);
            localStorage.setItem('blood_reports_v2', JSON.stringify(reports));
            renderHistory();
            renderDashboard();
        }
    };

    // --- TRENDS ---
    let tChart = null;
    function renderTrendPage() {
        const sel = document.getElementById('trendParamSelector');
        if(!sel) return;
        sel.innerHTML = dict.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
        sel.onchange = () => {
            const pts = [];
            reports.forEach(r => {
                const f = r.exams.find(e => e.param === sel.value);
                if(f) pts.push({ x: r.date, y: f.val });
            });
            pts.sort((a,b) => new Date(a.x) - new Date(b.x));
            const ctx = document.getElementById('mainTrendChart').getContext('2d');
            if(tChart) tChart.destroy();
            tChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: pts.map(p => p.x),
                    datasets: [{ label: sel.value, data: pts.map(p => p.y), borderColor: '#007AFF', tension: 0.3, fill: true, backgroundColor: 'rgba(0,122,255,0.1)' }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        };
        sel.dispatchEvent(new Event('change'));
    }

    showView('dashboard');
});