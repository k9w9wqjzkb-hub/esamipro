document.addEventListener('DOMContentLoaded', () => {
    let exams = JSON.parse(localStorage.getItem('blood_db')) || [];
    let dict = JSON.parse(localStorage.getItem('param_dict')) || [
        { name: 'Glucosio', unit: 'mg/dL', min: 70, max: 100, color: 'bg-blue' },
        { name: 'Colesterolo', unit: 'mg/dL', min: 150, max: 200, color: 'bg-red' },
        { name: 'Sideremia', unit: 'µg/dL', min: 60, max: 160, color: 'bg-orange' },
        { name: 'Vitamina D', unit: 'ng/mL', min: 30, max: 100, color: 'bg-purple' }
    ];

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
        };
    });

    const renderDictList = () => {
        const list = document.getElementById('dictionaryList');
        list.innerHTML = dict.map(p => `<div class="history-item"><span>${p.name} (${p.unit})</span> <i class="fas fa-check-circle" style="color:var(--success)"></i></div>`).join('');
        const select = document.getElementById('examParamSelect');
        select.innerHTML = '<option value="">Scegli parametro...</option>' + dict.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
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
        render(); // Aggiorna Home
        e.target.reset();
    };

    document.getElementById('examForm').onsubmit = (e) => {
        e.preventDefault();
        const pName = document.getElementById('examParamSelect').value;
        const config = dict.find(d => d.name === pName);
        exams.push({
            id: Date.now(),
            date: document.getElementById('examDate').value,
            param: pName,
            val: parseFloat(document.getElementById('examValue').value),
            unit: config.unit, min: config.min, max: config.max
        });
        localStorage.setItem('blood_db', JSON.stringify(exams));
        document.getElementById('examModal').style.display = 'none';
        render();
        e.target.reset();
    };

    function render() {
        const grid = document.getElementById('keyMetricsGrid');
        grid.innerHTML = dict.slice(0,4).map(p => {
            const last = exams.filter(e => e.param === p.name).sort((a,b) => new Date(b.date) - new Date(a.date))[0];
            const val = last ? `${last.val} <small>${last.unit}</small>` : '--';
            const isOut = last && ((last.min && last.val < last.min) || (last.max && last.val > last.max));
            return `<div class="metric-card ${p.color}" style="${isOut ? 'border-left-color:var(--danger)' : ''}">
                <label>${p.name}</label>
                <div style="font-size:22px; font-weight:800; margin:8px 0">${val}</div>
                <small style="font-weight:700; color:${isOut ? 'var(--danger)' : 'rgba(0,0,0,0.4)'}">${isOut ? 'FUORI RANGE' : (last ? 'NORMALE' : 'NESSUN DATO')}</small>
            </div>`;
        }).join('');
    }

    let tChart = null;
    function renderTrendPage() {
        const sel = document.getElementById('trendParamSelector');
        const unique = [...new Set(exams.map(e => e.param))];
        sel.innerHTML = unique.map(u => `<option value="${u}">${u}</option>`).join('');
        sel.onchange = () => {
            const pts = exams.filter(e => e.param === sel.value).sort((a,b) => new Date(a.date) - new Date(b.date));
            if(tChart) tChart.destroy();
            tChart = new Chart(document.getElementById('mainTrendChart').getContext('2d'), {
                type: 'line',
                data: {
                    labels: pts.map(p => p.date),
                    datasets: [{ label: sel.value, data: pts.map(p => p.val), borderColor: '#007AFF', tension: 0.3, fill: true, backgroundColor: 'rgba(0,122,255,0.05)' }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        };
        if(unique.length) sel.dispatchEvent(new Event('change'));
    }

    function renderHistory() {
        const hist = document.getElementById('historyList');
        hist.innerHTML = exams.sort((a,b) => new Date(b.date) - new Date(a.date)).map(e => `
            <div class="history-item">
                <div><b>${e.param}</b><br><small>${e.date}</small></div>
                <div>${e.val} ${e.unit} <i class="fas fa-trash-alt" onclick="delEx(${e.id})" style="color:var(--danger); margin-left:15px"></i></div>
            </div>
        `).join('') || '<p style="text-align:center; color:gray">Nessun esame salvato.</p>';
    }

    window.delEx = (id) => { if(confirm('Eliminare questo record?')) { exams = exams.filter(e => e.id !== id); localStorage.setItem('blood_db', JSON.stringify(exams)); render(); renderHistory(); } };

    document.querySelector('.add-exam-btn').onclick = () => document.getElementById('examModal').style.display = 'block';
    document.querySelector('.close-button').onclick = () => document.getElementById('examModal').style.display = 'none';

    render();
    renderDictList();
});