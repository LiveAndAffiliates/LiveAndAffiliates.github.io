if (typeof Chart === 'undefined') {
  document.body.innerHTML = '<div style="padding:60px;text-align:center;color:#e9edf6;font-family:sans-serif">' +
    '<h2>Could not load the charting library (Chart.js via CDN).</h2>' +
    '<p style="color:#8b96ac">Check your connection or try reloading the page.</p></div>';
  throw new Error('Chart.js failed to load');
}

let LIVE_DATA = [];
let AFF_DATA = [];

const SUBS = ["SEM","SELA","SAMCOL","SEASA","SEPR","SECH","SEDA"];
const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const YEARS = ["2025","2026"];
const YEAR_COLORS = {"2025":"#5b6b8c", "2026": null}; // 2026 uses accent color per view

const state = {
  subs: new Set(SUBS),
  year: "all",
  quarters: new Set(), // empty = Full Year (no quarter filter); otherwise one or more of Q1-Q4
  view: "live"
};

const fmtUSD = (v) => {
  if (Math.abs(v) >= 1e6) return "$" + (v/1e6).toFixed(2) + "M";
  if (Math.abs(v) >= 1e3) return "$" + (v/1e3).toFixed(1) + "K";
  return "$" + v.toFixed(0);
};
const fmtNum = (v) => {
  if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1) + "K";
  return Math.round(v).toLocaleString('en-US');
};
const fmtFull = (v) => "$" + Math.round(v).toLocaleString('en-US');

Chart.defaults.color = '#8b96ac';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = '#1a2233';

// ---------- View switcher ----------
function buildViewSwitch(){
  const tabs = document.querySelectorAll('.view-tab');
  tabs.forEach(t => {
    t.onclick = () => {
      state.view = t.dataset.view;
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('viewLive').classList.toggle('active', state.view === 'live');
      document.getElementById('viewAffiliate').classList.toggle('active', state.view === 'affiliate');
      renderAll();
    };
  });
}

// ---------- Filter builders ----------
function buildSubPills(){
  const el = document.getElementById('subPills');
  el.innerHTML = '';
  SUBS.forEach(s => {
    const p = document.createElement('div');
    p.className = 'pill active';
    p.dataset.sub = s;
    p.innerHTML = `<span class="dot"></span>${s}`;
    p.onclick = () => {
      if(state.subs.has(s)){
        if(state.subs.size === 1) return;
        state.subs.delete(s);
        p.classList.remove('active');
      } else {
        state.subs.add(s);
        p.classList.add('active');
      }
      renderAll();
    };
    el.appendChild(p);
  });
}

function buildYearSeg(){
  const el = document.getElementById('yearSeg');
  el.innerHTML = '';
  const opts = [["all","All"], ["2025","2025"], ["2026","2026"]];
  opts.forEach(([val,label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if(val === state.year) b.classList.add('active');
    b.onclick = () => {
      state.year = val;
      [...el.children].forEach(c=>c.classList.remove('active'));
      b.classList.add('active');
      renderAll();
    };
    el.appendChild(b);
  });
}

function buildQuarterSeg(){
  const el = document.getElementById('quarterSeg');
  el.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.textContent = 'Full Year';
  if(state.quarters.size === 0) allBtn.classList.add('active');
  allBtn.onclick = () => {
    state.quarters.clear();
    buildQuarterSeg();
    renderAll();
  };
  el.appendChild(allBtn);

  ["Q1","Q2","Q3","Q4"].forEach(q => {
    const b = document.createElement('button');
    b.textContent = q;
    if(state.quarters.has(q)) b.classList.add('active');
    b.onclick = () => {
      // Multi-select: toggle this quarter on/off without clearing the others.
      // Selecting nothing is equivalent to Full Year (no quarter filter).
      if(state.quarters.has(q)) state.quarters.delete(q);
      else state.quarters.add(q);
      buildQuarterSeg();
      renderAll();
    };
    el.appendChild(b);
  });
}

document.getElementById('resetBtn').onclick = () => {
  state.subs = new Set(SUBS);
  state.year = 'all';
  state.quarters = new Set();
  buildSubPills();
  buildYearSeg();
  buildQuarterSeg();
  renderAll();
};

// ---------- Filtering ----------
function filterLive({respectQuarter=true, respectYear=true} = {}){
  return LIVE_DATA.filter(r =>
    state.subs.has(r.sub) &&
    (!respectYear || state.year === 'all' || String(r.year) === state.year) &&
    (!respectQuarter || state.quarters.size === 0 || state.quarters.has(r.quarter))
  );
}
function filterAff({respectQuarter=true, respectYear=true} = {}){
  return AFF_DATA.filter(r =>
    state.subs.has(r.sub) &&
    (!respectYear || state.year === 'all' || String(r.year) === state.year) &&
    (!respectQuarter || state.quarters.size === 0 || state.quarters.has(r.quarter))
  );
}

function monthYearKey(year, month){
  return year * 12 + MONTH_ORDER.indexOf(month);
}
function monthYearLabel(year, month){
  return month + " '" + String(year).slice(2);
}
function weekKey(year, week){
  if(!week) return null;
  const n = parseInt(String(week).replace(/\D/g,''), 10);
  if(isNaN(n)) return null;
  return year * 100 + n;
}
function weekLabel(key){
  const year = Math.floor(key/100), w = key % 100;
  return "S" + String(w).padStart(2,'0') + " '" + String(year).slice(2);
}

// ---------- Charts ----------
let charts = {};
function destroyChart(id){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
}

// ---------- KPIs ----------
function renderKPIs(){
  if(state.view === 'live') renderLiveKPIs(); else renderAffKPIs();
}

function renderLiveKPIs(){
  const liveF = filterLive();
  const liveRev = liveF.reduce((a,r)=>a+r.revenue,0);
  const liveTarget = liveF.reduce((a,r)=>a+r.target,0);
  const views = liveF.reduce((a,r)=>a+r.views,0);
  const attain = liveTarget > 0 ? (liveRev/liveTarget*100) : 0;

  const cards = [
    {label:"Live Revenue", value: fmtUSD(liveRev), sub: fmtFull(liveRev), accent:"var(--live)"},
    {label:"Live Target", value: fmtUSD(liveTarget), sub: fmtFull(liveTarget), accent:"#8b96ac"},
    {label:"Target Attainment", value: attain.toFixed(1)+"%", sub: attain>=100 ? "above target" : "below target", accent: attain>=100?"var(--good)":"var(--danger)", subClass: attain>=100?"good":"bad"},
    {label:"Total Views", value: fmtNum(views), sub: liveF.length + " lives", accent:"#8b96ac"},
    {label:"Lives in Period", value: liveF.length, sub: "recorded events", accent:"var(--live)"},
    {label:"Avg Revenue / Live", value: liveF.length ? fmtUSD(liveRev/liveF.length) : "—", sub: "per event", accent:"var(--live)"},
  ];
  paintKPIs(cards);
}

function renderAffKPIs(){
  const affF = filterAff();
  const affRev = affF.reduce((a,r)=>a+r.revenue,0);
  const partners = {};
  affF.forEach(r => { partners[r.partner] = (partners[r.partner]||0) + r.revenue; });
  const partnerEntries = Object.entries(partners).filter(([,v])=>v>0);
  const nPartners = partnerEntries.length;
  const top = partnerEntries.sort((a,b)=>b[1]-a[1])[0];
  const months = new Set(affF.map(r => r.year+'-'+r.month));
  const avgMonth = months.size ? affRev/months.size : 0;
  const avgPartner = nPartners ? affRev/nPartners : 0;

  const cards = [
    {label:"Affiliate Revenue", value: fmtUSD(affRev), sub: fmtFull(affRev), accent:"var(--aff)"},
    {label:"Avg Revenue / Month", value: fmtUSD(avgMonth), sub: months.size + " months in period", accent:"var(--aff)"},
    {label:"Active Partners", value: nPartners, sub: "with revenue > 0", accent:"#8b96ac"},
    {label:"Top Partner", value: top ? fmtUSD(top[1]) : "—", sub: top ? top[0] : "—", accent:"var(--aff)"},
    {label:"Avg Ticket / Partner", value: fmtUSD(avgPartner), sub: "revenue / active partners", accent:"#8b96ac"},
    {label:"Months with Data", value: months.size, sub: "in filtered period", accent:"#8b96ac"},
  ];
  paintKPIs(cards);
}

function paintKPIs(cards){
  const el = document.getElementById('kpiRow');
  el.innerHTML = '';
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'kpi';
    d.style.setProperty('--accent', c.accent);
    d.innerHTML = `
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub ${c.subClass||''}">${c.sub}</div>
    `;
    el.appendChild(d);
  });
}

// ---------- Live: Monthly evolution (revenue by subsidiary, stacked, vs combined target) ----------
const SUB_COLORS = {
  SEM:"#2fe0c8", SELA:"#4f8dfd", SAMCOL:"#f5a623", SEASA:"#ef5da0",
  SEPR:"#9b7bea", SECH:"#57d97a", SEDA:"#ff7b54"
};

function renderLiveMonthlyChart(){
  const liveAll = filterLive({respectQuarter:false});
  const keys = new Set(liveAll.map(r => monthYearKey(r.year, r.month)));
  const sortedKeys = [...keys].sort((a,b)=>a-b);
  const labels = sortedKeys.map(k => monthYearLabel(Math.floor(k/12), MONTH_ORDER[k%12]));

  // Only the currently-selected subsidiaries get a bar series, in a fixed
  // order so a sub's color/position stays stable as filters change.
  const activeSubs = SUBS.filter(s => state.subs.has(s));

  const revBySubKey = {};
  activeSubs.forEach(s => { revBySubKey[s] = {}; sortedKeys.forEach(k => revBySubKey[s][k] = 0); });
  const targetByKey = {};
  sortedKeys.forEach(k => targetByKey[k] = 0);

  liveAll.forEach(r => {
    const k = monthYearKey(r.year, r.month);
    if(revBySubKey[r.sub]) revBySubKey[r.sub][k] += r.revenue;
    targetByKey[k] += r.target;
  });

  const subDatasets = activeSubs.map(s => ({
    type:'bar',
    label: s,
    data: sortedKeys.map(k => revBySubKey[s][k]),
    backgroundColor: SUB_COLORS[s] || '#8b96ac',
    borderRadius: 2,
    stack: 'revenue',
    order: 2,
  }));

  destroyChart('liveMonthly');
  const ctx = document.getElementById('liveMonthlyChart');
  charts['liveMonthly'] = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        ...subDatasets,
        {type:'line', label:'Target (combined)', data: sortedKeys.map(k=>targetByKey[k]), borderColor:'#e9edf6', borderDash:[4,3], pointRadius:0, borderWidth:1.5, tension:.3, order:1},
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{ display:true, position:'top', align:'start', labels:{boxWidth:10, boxHeight:10, padding:12, usePointStyle:false} },
        tooltip:{callbacks:{label:(c)=>` ${c.dataset.label}: ${fmtFull(c.parsed.y)}`}}
      },
      scales:{
        x:{ grid:{display:false}, stacked:true },
        y:{ grid:{color:'#161d2c'}, ticks:{callback:(v)=>fmtNum(v)}, stacked:true }
      }
    }
  });
}

// ---------- Affiliate: Monthly evolution (revenue by subsidiary, stacked) ----------
function renderAffMonthlyChart(){
  const affAll = filterAff({respectQuarter:false});
  const keys = new Set(affAll.map(r => monthYearKey(r.year, r.month)));
  const sortedKeys = [...keys].sort((a,b)=>a-b);
  const labels = sortedKeys.map(k => monthYearLabel(Math.floor(k/12), MONTH_ORDER[k%12]));

  const activeSubs = SUBS.filter(s => state.subs.has(s));
  const revBySubKey = {};
  activeSubs.forEach(s => { revBySubKey[s] = {}; sortedKeys.forEach(k => revBySubKey[s][k] = 0); });

  affAll.forEach(r => {
    const k = monthYearKey(r.year, r.month);
    if(revBySubKey[r.sub]) revBySubKey[r.sub][k] += r.revenue;
  });

  const subDatasets = activeSubs.map(s => ({
    type:'bar',
    label: s,
    data: sortedKeys.map(k => revBySubKey[s][k]),
    backgroundColor: SUB_COLORS[s] || '#8b96ac',
    borderRadius: 2,
    stack: 'revenue',
  }));

  destroyChart('affMonthly');
  const ctx = document.getElementById('affMonthlyChart');
  charts['affMonthly'] = new Chart(ctx, {
    data: {
      labels,
      datasets: subDatasets
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{ display:true, position:'top', align:'start', labels:{boxWidth:10, boxHeight:10, padding:12, usePointStyle:false} },
        tooltip:{callbacks:{label:(c)=>` ${c.dataset.label}: ${fmtFull(c.parsed.y)}`}}
      },
      scales:{
        x:{ grid:{display:false}, stacked:true },
        y:{ grid:{color:'#161d2c'}, ticks:{callback:(v)=>fmtNum(v)}, stacked:true }
      }
    }
  });
}

// ---------- Live per-event revenue vs target ----------
function renderLiveTargetChart(){
  const liveF = filterLive().slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  destroyChart('liveTarget');
  const ctx = document.getElementById('liveTargetChart');
  if(liveF.length === 0) return;
  const labels = liveF.map(r => r.name.length>16 ? r.name.slice(0,15)+'…' : r.name);
  charts['liveTarget'] = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Revenue', data: liveF.map(r=>r.revenue), backgroundColor:'#2fe0c8cc', borderRadius:4},
        {label:'Target', data: liveF.map(r=>r.target), backgroundColor:'#8b96ac55', borderRadius:4},
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(c)=>` ${c.dataset.label}: ${fmtFull(c.parsed.y)}`}} },
      scales:{
        x:{ grid:{display:false}, ticks:{maxRotation:60, minRotation:60, autoSkip:true, maxTicksLimit:20, font:{size:9}} },
        y:{ grid:{color:'#161d2c'}, ticks:{callback:(v)=>fmtNum(v)} }
      }
    }
  });
}

// ---------- Quarterly comparison BY YEAR (reusable for live/affiliate) ----------
function renderQuarterYearChart(canvasId, chartKey, dataset, accentColorsByYear){
  const quarters = ['Q1','Q2','Q3','Q4'];
  const years = YEARS;
  const datasets = years.map((y, idx) => ({
    label: y,
    data: quarters.map(q => dataset.filter(r => String(r.year)===y && r.quarter===q).reduce((a,r)=>a+r.revenue,0)),
    backgroundColor: accentColorsByYear[idx],
    borderRadius: 5,
    maxBarThickness: 40
  }));

  destroyChart(chartKey);
  const ctx = document.getElementById(canvasId);
  charts[chartKey] = new Chart(ctx, {
    type:'bar',
    data:{ labels: quarters, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:true, position:'top', align:'end', labels:{boxWidth:9, boxHeight:9, padding:12, font:{size:11}} },
        tooltip:{callbacks:{label:(c)=>` ${c.dataset.label}: ${fmtFull(c.parsed.y)}`}}
      },
      scales:{
        x:{ grid:{display:false} },
        y:{ grid:{color:'#161d2c'}, ticks:{callback:(v)=>fmtNum(v)} }
      }
    }
  });
}

function renderLiveQuarterYearChart(){
  const liveAll = filterLive({respectQuarter:false, respectYear:false});
  renderQuarterYearChart('liveQuarterYearChart', 'liveQY', liveAll, ['#5b6b8c','#2fe0c8cc']);
}
function renderAffQuarterYearChart(){
  const affAll = filterAff({respectQuarter:false, respectYear:false});
  renderQuarterYearChart('affQuarterYearChart', 'affQY', affAll, ['#5b6b8c','#f5a623cc']);
}

// ---------- Weekly views chart (Live) ----------
function renderWeeklyViewsChart(){
  const liveAll = filterLive({respectQuarter:false}).filter(r => r.week);
  const byKey = {};
  liveAll.forEach(r => {
    const k = weekKey(r.year, r.week);
    if(k === null) return;
    byKey[k] = (byKey[k]||0) + r.views;
  });
  const sortedKeys = Object.keys(byKey).map(Number).sort((a,b)=>a-b);
  const labels = sortedKeys.map(weekLabel);

  destroyChart('weeklyViews');
  const ctx = document.getElementById('weeklyViewsChart');
  if(sortedKeys.length === 0) return;
  charts['weeklyViews'] = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[{
        label:'Views',
        data: sortedKeys.map(k=>byKey[k]),
        borderColor:'#2fe0c8', backgroundColor:'#2fe0c822',
        fill:true, tension:.25, pointRadius:2, pointBackgroundColor:'#2fe0c8', borderWidth:2
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(c)=>` Views: ${fmtNum(c.parsed.y)}`}} },
      scales:{
        x:{ grid:{display:false}, ticks:{maxRotation:60, minRotation:60, autoSkip:true, maxTicksLimit:26, font:{size:9}} },
        y:{ grid:{color:'#161d2c'}, ticks:{callback:(v)=>fmtNum(v)} }
      }
    }
  });
}

// ---------- Top partners (affiliate) ----------
function renderTopPartners(){
  const affF = filterAff();
  const byPartner = {};
  affF.forEach(r => { byPartner[r.partner] = (byPartner[r.partner]||0) + r.revenue; });
  const sorted = Object.entries(byPartner).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const max = sorted.length ? sorted[0][1] : 1;

  const el = document.getElementById('topPartners');
  if(sorted.length === 0){
    el.innerHTML = '<div class="empty-state">No data for the selected period</div>';
    return;
  }
  el.innerHTML = sorted.map(([name,val],i) => `
    <div class="rank-item">
      <div class="rank-num">${i+1}</div>
      <div class="rank-name" title="${name}">${name}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${Math.max(3,val/max*100)}%"></div></div>
      <div class="rank-value">${fmtUSD(val)}</div>
    </div>
  `).join('');
}

// ---------- Live table ----------
let tableSort = {key:'date', dir:1};
let tableSearch = '';

function renderLiveTable(){
  let liveF = filterLive();
  if(tableSearch){
    const q = tableSearch.toLowerCase();
    liveF = liveF.filter(r => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
  }
  liveF = liveF.slice().sort((a,b) => {
    let av, bv;
    if(tableSort.key === 'attain'){
      av = a.target ? a.revenue/a.target : 0;
      bv = b.target ? b.revenue/b.target : 0;
    } else {
      av = a[tableSort.key]; bv = b[tableSort.key];
    }
    if(av == null) av = '';
    if(bv == null) bv = '';
    if(typeof av === 'string') return av.localeCompare(bv) * tableSort.dir;
    return (av - bv) * tableSort.dir;
  });

  document.getElementById('liveTableCount').textContent = `${liveF.length} lives in filtered period`;

  document.querySelectorAll('#viewLive thead th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === tableSort.key);
  });

  const body = document.getElementById('liveTableBody');
  if(liveF.length === 0){
    body.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhuma live encontrada</td></tr>`;
    return;
  }
  body.innerHTML = liveF.map(r => {
    const attain = r.target ? (r.revenue/r.target*100) : null;
    let badgeClass = 'warn';
    if(attain !== null){
      if(attain >= 100) badgeClass = 'good';
      else if(attain < 60) badgeClass = 'bad';
    }
    return `<tr>
      <td class="mono-cell">${r.sub}</td>
      <td>${r.name}</td>
      <td class="mono-cell">${r.date || '—'}</td>
      <td class="mono-cell">${r.week || '—'}</td>
      <td class="mono-cell">${r.quarter || '—'}</td>
      <td class="mono-cell">${fmtNum(r.views)}</td>
      <td class="mono-cell">${fmtFull(r.revenue)}</td>
      <td class="mono-cell">${fmtFull(r.target)}</td>
      <td>${attain !== null ? `<span class="badge ${badgeClass}">${attain.toFixed(0)}%</span>` : '—'}</td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('#viewLive thead th').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if(tableSort.key === key){ tableSort.dir *= -1; }
    else { tableSort = {key, dir: key==='date' ? 1 : -1}; }
    renderLiveTable();
  });
});
document.getElementById('liveSearch').addEventListener('input', (e) => {
  tableSearch = e.target.value;
  renderLiveTable();
});

// ---------- Master render ----------

// ---------- Live: Results by subsidiary (summary table) ----------
function renderSubResultsTable(){
  const liveF = filterLive();
  const rows = SUBS.filter(s => state.subs.has(s)).map(s => {
    const rs = liveF.filter(r => r.sub === s);
    return {
      sub: s,
      sessions: rs.length,
      revenue: rs.reduce((a,r)=>a+r.revenue,0),
      views: rs.reduce((a,r)=>a+r.views,0),
    };
  });
  const tot = rows.reduce((a,r)=>({
    sessions:a.sessions+r.sessions, revenue:a.revenue+r.revenue, views:a.views+r.views
  }), {sessions:0, revenue:0, views:0});

  const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
  const body = document.getElementById('subResultsBody');
  body.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.sub}</strong></td>
      <td style="text-align:right">${fmtInt(r.sessions)}</td>
      <td style="text-align:right">${fmtFull(r.revenue)}</td>
      <td style="text-align:right">${fmtInt(r.views)}</td>
    </tr>`).join('') + `
    <tr style="font-weight:700;border-top:2px solid var(--border)">
      <td>TOTAL</td>
      <td style="text-align:right">${fmtInt(tot.sessions)}</td>
      <td style="text-align:right">${fmtFull(tot.revenue)}</td>
      <td style="text-align:right">${fmtInt(tot.views)}</td>
    </tr>`;
}

function renderAll(){
  renderKPIs();
  if(state.view === 'live'){
    renderLiveMonthlyChart();
    renderSubResultsTable();
    renderLiveTargetChart();
    renderLiveQuarterYearChart();
    renderWeeklyViewsChart();
    renderLiveTable();
  } else {
    renderAffMonthlyChart();
    renderAffQuarterYearChart();
    renderTopPartners();
  }
}

// ---------- Data loading ----------
// Primary source: the two normalized tabs of the "Live & Affiliates — Master"
// Google Sheet, published as CSV via the gviz/tq endpoint. That sheet is kept
// fresh by an Apps Script (refreshAll) that re-pulls the 7 subsidiary sheets
// on a schedule, so this dashboard reflects the latest data every time it's
// loaded (or whenever "Atualizar agora" is clicked), with no rebuild/redeploy
// needed.
//
// Fallback: if the sheet can't be reached (offline, sharing revoked, CDN for
// PapaParse blocked, etc.), the app falls back to the bundled
// data/live.json / data/affiliate.json snapshot so the dashboard still works.
//
// NOTE: this app must be served over HTTP(S) (not opened as a local file://).

const SHEET_ID = '1M54-wTMKnlXKl9f2Q42Lvf7Zi2jf29uT1KsAXmQnJsM';
const csvUrl = (sheetName) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;

function toNum(v){
  if(v === undefined || v === null || v === '') return 0;
  // The gviz/tq CSV export renders decimals using the spreadsheet's locale
  // (comma as decimal separator, no thousands separator on plain numeric
  // columns), e.g. "684090,09". Normalize before parsing.
  const n = Number(String(v).trim().replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function parseCsv(text){
  const result = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return result.data;
}

async function fetchSheetData(){
  const [liveCsv, affCsv] = await Promise.all([
    fetch(csvUrl('Live_normalized'), { cache: 'no-store' }).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); }),
    fetch(csvUrl('Affiliate_normalized'), { cache: 'no-store' }).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
  ]);

  const liveRows = parseCsv(liveCsv).map(r => ({
    sub: r.sub || '', div: r.div || '', name: r.name || '', date: r.date || '',
    year: toNum(r.year), week: r.week || '', month: r.month || '', quarter: r.quarter || '',
    views: toNum(r.views), revenue: toNum(r.revenue), target: toNum(r.target), units: toNum(r.units)
  })).filter(r => r.name && r.date);

  const affRows = parseCsv(affCsv).map(r => ({
    sub: r.sub || '', year: toNum(r.year), month: r.month || '', quarter: r.quarter || '',
    partner: r.partner || '', category: r.category || '',
    revenue: toNum(r.revenue), commission: r.commission === '' ? null : toNum(r.commission)
  })).filter(r => r.month);

  if(liveRows.length === 0 || affRows.length === 0) throw new Error('Planilha retornou 0 linhas');
  return { liveRows, affRows };
}

async function loadFromJsonFallback(){
  const [liveRes, affRes] = await Promise.all([
    fetch('data/live.json'),
    fetch('data/affiliate.json')
  ]);
  if(!liveRes.ok || !affRes.ok) throw new Error('HTTP ' + liveRes.status + '/' + affRes.status);
  LIVE_DATA = await liveRes.json();
  AFF_DATA = await affRes.json();
}

function setDataStatus(text, isError){
  const el = document.getElementById('dataStatus');
  if(el){
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : '';
  }
}

async function loadData(){
  try {
    const { liveRows, affRows } = await fetchSheetData();
    LIVE_DATA = liveRows;
    AFF_DATA = affRows;
    const now = new Date();
    setDataStatus('Live · updated at ' + now.toLocaleTimeString('en-US') + ' (' + LIVE_DATA.length + ' lives, ' + AFF_DATA.length + ' affiliate rows)', false);
  } catch (err) {
    console.error('Falha ao ler a planilha, usando snapshot local:', err);
    try {
      await loadFromJsonFallback();
      setDataStatus('Offline · showing local snapshot (spreadsheet unavailable)', true);
    } catch (err2) {
      console.error('Local snapshot also failed:', err2);
      document.body.innerHTML = '<div style="padding:60px;text-align:center;color:#e9edf6;font-family:sans-serif">' +
        '<h2>Could not load the data.</h2>' +
        '<p style="color:#8b96ac">Neither the spreadsheet nor the local snapshot (data/live.json / data/affiliate.json) responded. Detail: ' + err2.message + '</p></div>';
      throw err2;
    }
  }
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  setDataStatus('Updating…', false);
  await loadData();
  renderAll();
});

async function init(){
  try {
    await loadData();
    buildViewSwitch();
    buildSubPills();
    buildYearSeg();
    buildQuarterSeg();
    renderAll();
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;bottom:16px;right:16px;background:#2a1010;border:1px solid #ff6b6b;color:#ff6b6b;padding:12px 16px;border-radius:8px;font-family:monospace;font-size:12px;max-width:400px;">Erro ao inicializar o dashboard: ' + err.message + '</div>');
  }
}

init();
