document.addEventListener('DOMContentLoaded', () => {
    // Database raggruppato per report (Data + Luogo + Array Esami)
    let reports = JSON.parse(localStorage.getItem('blood_reports_v2')) || [];
    let dict = JSON.parse(localStorage.getItem('param_dict')) || [
        { name: 'Glucosio', unit: 'mg/dL', min: 70, max: 100, color: 'bg-blue' },
        { name: 'Colesterolo', unit: 'mg/dL', min: 150, max: 200, color: 'bg-red' },
        { name: 'Sideremia', unit: 'µg/dL', min: 60, max: 160, color: 'bg-orange' },
        { name: 'Vitamina D', unit: 'ng/mL', min: 30, max: 100, color: 'bg-purple' }
    ];

    let tempExams = [];

    // Navigazione
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.onclick = (e) => {
            e.preventDefault();
            const target = tab.dataset.view;
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById(`view-${target}`).style.display = 'block';
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if(target === 'trends') renderTrendPage();
            if(target === 'history') renderHistory();
            if(target === 'dashboard') render();
        };
    });

    // --- DIZIONARIO ---
    const renderDictList = () => {
        const list = document.getElementById('dictionaryList');
        if(list) list.innerHTML = dict.map(p => `<div class="history-item"><span>${p.name} (${p.unit})</span> <i class="fas fa-check-circle" style="color:var(--success)"></i></div>`).join('');
        const select = document.getElementById('examParamSelect');
        if(select) select.innerHTML = '<option value="">Scegli...</option>' + dict.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    };

    document.getElementById('paramConfigForm').onsubmit = (e) => {
        e.preventDefault();
        dict.push({
            name: document.getElementById('confName').value,
            unit: document.getElementById('confUnit').value,
            min: parseFloat(document.getElementById('confMin').value) || null,
            max: parseFloat(document.getElementById('confMax').value) || null,
            color: 'bg-blue'
        });
        localStorage.setItem('param_dict', JSON.stringify(dict));
        renderDictList();
        e.target.reset();
    };

    // --- AGGIUNTA RIGHE TEMPORANEE NEL MODAL ---
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
        container.innerHTML = tempExams.map((e, i) => `
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px">
                <span>${e.param}: <b>${e.val}</b></span>
                <i class="fas fa-times" onclick="removeTemp(${i})" style="color:red"></i>
            </div>
        `).join('') || 'Aggiungi parametri...';
    }

    window.removeTemp = (i) => { tempExams.splice(i,1); renderTempList(); };

    // --- SALVATAGGIO REPORT ---
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
        render();
    };

    // --- RENDERING HOME (ULTIMI VALORI) ---
    function render() {
        const grid = document.getElementById('keyMetricsGrid');
        grid.innerHTML = dict.slice(0,4).map(p => {
            const allValues = [];
            reports.forEach(r => {
                const found = r.exams.find(ex => ex.param === p.name);
                if(found) allValues.push({ val: found.val, date: r.date });
            });
            const last = allValues.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
            
            const valStr = last ? `${last.val} <small>${p.unit}</small>` : '--';
            const isOut = last && ((p.min && last.val < p.min) || (p.max && last.val > p.max));
            
            return `<div class="metric-card ${p.color}" style="${isOut ? 'border-left-color:var(--danger)' : ''}">
                <label>${p.name}</label>
                <div style="font-size:22px; font-weight:800; margin:8px 0">${valStr}</div>
                <small style="color:${isOut ? 'var(--danger)' : 'inherit'}">${isOut ? 'FUORI RANGE' : (last ? 'NORMALE' : 'NO DATI')}</small>
            </div>`;
        }).join('');
    }

    // --- STORICO A FISARMONICA ---
    function renderHistory() {
        const hist = document.getElementById('historyList');
        hist.innerHTML = reports.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => `
            <div class="report-card">
                <div class="report-header" onclick="toggleReport(${r.id})">
                    <div><b>${r.location}</b><br><small>${r.date}</small></div>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div id="det-${r.id}" class="report-details" style="display:none; padding:15px; background:#fff">
                    ${r.exams.map(e => `
                        <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:0.5px solid #eee">
                            <span>${e.param}</span><b>${e.val} ${e.unit}</b>
                        </div>
                    `).join('')}
                    <button class="btn-del" onclick="delReport(${r.id})">Elimina Report</button>
                </div>
            </div>
        `).join('') || '<p style="text-align:center">Vuoto</p>';
    }

    window.toggleReport = (id) => {
        const d = document.getElementById(`det-${id}`);
        d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };

    window.delReport = (id) => {
        if(confirm("Eliminare intero report?")) {
            reports = reports.filter(r => r.id !== id);
            localStorage.setItem('blood_reports_v2', JSON.stringify(reports));
            renderHistory();
            render();
        }
    };

    // --- TRENDS ---
    let tChart = null;
    function renderTrendPage() {
        const sel = document.getElementById('trendParamSelector');
        const unique = dict.map(d => d.name);
        sel.innerHTML = unique.map(u => `<option value="${u}">${u}</option>`).join('');
        sel.onchange = () => {
            const pts = [];
            reports.forEach(r => {
                const f = r.exams.find(e => e.param === sel.value);
                if(f) pts.push({ x: r.date, y: f.val });
            });
            pts.sort((a,b) => new Date(a.x) - new Date(b.x));

            if(tChart) tChart.destroy();
            tChart = new Chart(document.getElementById('mainTrendChart').getContext('2d'), {
                type: 'line',
                data: {
                    labels: pts.map(p => p.x),
                    datasets: [{ label: sel.value, data: pts.map(p => p.y), borderColor: '#007AFF', tension: 0.3 }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        };
        sel.dispatchEvent(new Event('change'));
    }

    document.querySelector('.add-exam-btn').onclick = () => document.getElementById('examModal').style.display = 'block';
    document.querySelector('.close-button').onclick = () => document.getElementById('examModal').style.display = 'none';

    render();
    renderDictList();
});