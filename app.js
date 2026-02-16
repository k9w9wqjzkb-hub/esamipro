document.addEventListener('DOMContentLoaded', () => {
    let reports = JSON.parse(localStorage.getItem('blood_reports_v2')) || [];
    let dict = JSON.parse(localStorage.getItem('param_dict')) || [
        { name: 'COLESTEROLO', unit: 'mg/dL', min: 120, max: 200, color: 'bg-orange' },
        { name: 'COLESTEROLO HDL', unit: 'mg/dL', min: 40, max: 60, color: 'bg-orange' },
        { name: 'COLESTEROLO LDL', unit: 'mg/dL', min: 0, max: 130, color: 'bg-orange' },
        { name: 'TRIGLICERIDI', unit: 'mg/dL', min: 50, max: 150, color: 'bg-orange' },
        { name: 'GLUCOSIO', unit: 'mg/dL', min: 70, max: 100, color: 'bg-blue' },
        { name: 'LEUCOCITI', unit: '10^3/µL', min: 4, max: 10, color: 'bg-blue' },
        { name: 'EMOGLOBINA', unit: 'g/dL', min: 13, max: 17, color: 'bg-blue' },
        { name: 'VITAMINA D', unit: 'ng/mL', min: 30, max: 100, color: 'bg-purple' }
    ];

    let tempExams = [];
    let editingReportId = null;
    const mainAddBtn = document.getElementById('mainAddBtn');

    function showView(target) {
        document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
        const targetView = document.getElementById(`view-${target}`);
        if(targetView) targetView.style.display = 'block';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.view === target));
        if (mainAddBtn) mainAddBtn.style.display = (target === 'dashboard') ? 'block' : 'none';

        if(target === 'trends') renderTrendPage();
        if(target === 'history') renderHistory();
        if(target === 'dashboard') renderDashboard();
        if(target === 'settings') renderDictList();
    }

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.onclick = (e) => { e.preventDefault(); showView(tab.dataset.view); };
    });

    // --- DASHBOARD (6 CARDS + ANOMALIE) ---
    function renderDashboard() {
        const grid = document.getElementById('keyMetricsGrid');
        const alertSection = document.getElementById('outOfRangeSection');
        const alertList = document.getElementById('outOfRangeList');
        if(!grid) return;

        // Render solo le prime 6 card
        grid.innerHTML = dict.slice(0,6).map(p => {
            const history = getAllValuesForParam(p.name);
            const last = history[0];
            const isOut = last && ((p.min !== null && last.val < p.min) || (p.max !== null && last.val > p.max));
            const sparkline = generateSparkline(history.slice(0,5).reverse(), p.min, p.max);

            return `
                <div class="metric-card ${p.color}" style="${isOut ? 'border-left-color:var(--danger); background:#FFF9F9;' : ''}">
                    <label>${p.name}</label>
                    <div style="font-size:20px; font-weight:800; margin:5px 0">${last ? last.val : '--'} <small style="font-size:11px; font-weight:400">${p.unit}</small></div>
                    <div style="height:25px; display:flex; align-items:flex-end; gap:2px; margin:5px 0">${sparkline}</div>
                    <small style="color:${isOut ? 'var(--danger)' : 'var(--success)'}; font-weight:700; font-size:9px">
                        ${isOut ? '● ANOMALO' : (last ? '● NORMALE' : 'NO DATI')}
                    </small>
                </div>`;
        }).join('');

        // Calcolo Anomalie per il report sottostante (controlla TUTTO il dizionario)
        let alertsHtml = "";
        let shareText = "*REPORT ANOMALIE ESAMI* 📄\n\n";
        let count = 0;
        dict.forEach(p => {
            const history = getAllValuesForParam(p.name);
            const last = history[0];
            if (last) {
                const tooLow = p.min !== null && last.val < p.min;
                const tooHigh = p.max !== null && last.val > p.max;

                if (tooLow || tooHigh) {
                    count++;
                    const arrow = tooHigh ? '↑' : '↓';
                    alertsHtml += `
                        <div class="card-white" style="display:flex; justify-content:space-between; align-items:center; border-left:5px solid var(--danger); margin-bottom:8px">
                            <div><b>${p.name}</b><br><small style="color:var(--gray)">Range: ${p.min}-${p.max} ${p.unit}</small></div>
                            <div style="text-align:right; color:var(--danger)">
                                <b style="font-size:16px">${last.val} ${arrow}</b><br>
                                <small style="font-size:9px; font-weight:700">${tooHigh ? 'SUPERIORE' : 'INFERIORE'}</small>
                            </div>
                        </div>`;
                    shareText += `• ${p.name}: ${last.val} ${p.unit} ${arrow} (Range: ${p.min}-${p.max})\n`;
                }
            }
        });

        if(alertSection) {
            alertSection.style.display = count > 0 ? 'block' : 'none';
            alertList.innerHTML = alertsHtml;
            document.getElementById('btnShareAnomalies').onclick = () => {
                window.open(`whatsapp://send?text=${encodeURIComponent(shareText)}`);
            };
        }
    }

    // --- GRAFICO CON LINEE DI RANGE ---
    let tChart = null;
    function renderTrendPage() {
        const sel = document.getElementById('trendParamSelector');
        if(!sel) return;
        sel.innerHTML = dict.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
        sel.onchange = () => {
            const pConfig = dict.find(d => d.name === sel.value);
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
                    datasets: [{ label: sel.value, data: pts.map(p => p.y), borderColor: '#007AFF', tension: 0.3, fill: false }]
                },
                options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 900,
            easing: 'easeOutQuart'
          },
          transitions: {
            active: { animation: { duration: 280, easing: 'easeOutQuart' } },
            resize: { animation: { duration: 250, easing: 'easeOutQuart' } }
          },
                    scales: {
                        y: {
                            grid: {
                                color: (context) => {
                                    if (pConfig && (context.tick.value === pConfig.min || context.tick.value === pConfig.max)) return 'rgba(255, 59, 48, 0.4)';
                                    return 'rgba(0,0,0,0.05)';
                                },
                                lineWidth: (context) => {
                                    if (pConfig && (context.tick.value === pConfig.min || context.tick.value === pConfig.max)) return 2;
                                    return 1;
                                }
                            }
                        }
                    }
                }
            });
        };
        sel.dispatchEvent(new Event('change'));
    }

    // Le restanti funzioni (Supporto, Modali, Dizionario, Backup, Storico) 
    // rimangono identiche per non rompere il lavoro precedente.
    // ... (copia le funzioni generate nell'ultimo passaggio per completare il file) ...
    
    // Esempio riassuntivo delle funzioni che devono restare:
    function generateSparkline(data, min, max) { /* ... */ }
    function getAllValuesForParam(name) { /* ... */ }
    window.exportJSON = () => { /* ... */ }
    window.editReport = (id) => { /* ... */ }
    // ...

    showView('dashboard');
});