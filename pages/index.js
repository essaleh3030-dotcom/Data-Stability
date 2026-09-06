import Head from 'next/head';
import { useEffect } from 'react';

export default function Dashboard() {
  useEffect(() => {
    // Chart.js is loaded via CDN <script> in Head — init once available
    const interval = setInterval(() => {
      if (window.Chart && window.initDashboard) {
        clearInterval(interval);
        window.initDashboard();
      }
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Head>
        <title>Duels Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" />
        <script src="/dashboard.js" defer />
      </Head>
      <div id="dashboard-root" dangerouslySetInnerHTML={{ __html: DASHBOARD_HTML }} />
    </>
  );
}

// The entire dashboard markup + script, ported from Dashboard.html
// Only change: google.script.run → fetch('/api/...')
const DASHBOARD_HTML = `
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    background: #f1f3f4;
    color: #202124;
    min-height: 100vh;
  }
  .header {
    background: #1a73e8;
    color: #fff;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    box-shadow: 0 2px 6px rgba(0,0,0,.2);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .header h1 { font-size: 18px; font-weight: 600; white-space: nowrap; }
  .header label { font-size: 13px; white-space: nowrap; }
  .ms { position: relative; display: inline-block; }
  .ms-btn {
    background: #fff; color: #202124; border: none; border-radius: 4px;
    padding: 6px 12px; font-size: 13px; min-width: 220px; max-width: 320px;
    cursor: pointer; text-align: left;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ms-panel {
    display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
    background: #fff; border: 1px solid #dadce0; border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
    max-height: 320px; width: 320px; overflow-y: auto; padding: 8px 0; z-index: 200;
  }
  .ms.open .ms-panel { display: block; }
  .ms-item {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 12px; font-size: 12px; color: #202124; cursor: pointer;
  }
  .ms-item:hover { background: #f1f3f4; }
  .ms-item input { margin: 0; }
  .ms-header {
    display: flex; gap: 6px; padding: 4px 10px 8px;
    border-bottom: 1px solid #e0e0e0; margin-bottom: 4px;
  }
  .ms-header button {
    font-size: 11px; padding: 3px 10px; border: 1px solid #dadce0;
    background: #f8f9fa; border-radius: 10px; cursor: pointer;
  }
  .tabs {
    background: #fff;
    border-bottom: 2px solid #e0e0e0;
    padding: 0 24px;
    display: flex;
  }
  .tab {
    padding: 10px 24px; cursor: pointer; font-size: 14px; font-weight: 500;
    color: #5f6368; border-bottom: 3px solid transparent;
    margin-bottom: -2px; transition: color .15s; user-select: none;
  }
  .tab:hover { color: #1a73e8; }
  .tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
  .view-panel { display: none; padding: 24px; }
  .view-panel.active { display: block; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-card {
    background: #fff; border-radius: 8px; padding: 12px 20px;
    border: 1px solid #e0e0e0; min-width: 140px; text-align: center;
  }
  .stat-card .val { font-size: 24px; font-weight: 700; color: #1a73e8; }
  .stat-card .lbl { font-size: 11px; color: #80868b; margin-top: 2px; }
  .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .chart-card {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;
  }
  .chart-card.span2 { grid-column: 1 / -1; }
  .chart-card h3 {
    font-size: 12px; font-weight: 600; color: #5f6368;
    text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px;
  }
  .chart-wrap { position: relative; height: 320px; }
  .chart-wrap-lg { position: relative; height: 400px; }
  #loading {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 80px 0; gap: 16px;
    color: #5f6368; font-size: 14px;
  }
  .spinner {
    width: 40px; height: 40px;
    border: 3px solid #e0e0e0; border-top-color: #1a73e8;
    border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #error-box {
    display: none; margin: 24px; padding: 16px 20px;
    background: #fce8e6; border-left: 4px solid #d93025;
    border-radius: 4px; color: #d93025; font-size: 14px;
  }
  .stats-table {
    width: 100%; border-collapse: collapse; font-size: 12px; background: #fff;
    border-radius: 8px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(0,0,0,.06); border: 1px solid #e0e0e0;
  }
  .stats-table th, .stats-table td {
    padding: 8px 10px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;
  }
  .stats-table th:first-child, .stats-table td:first-child { text-align: left; }
  .stats-table thead th {
    background: #f8f9fa; color: #5f6368; font-weight: 600;
    cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 5;
  }
  .stats-table thead th:hover { background: #e8f0fe; color: #1a73e8; }
  .stats-table thead th .arrow { font-size: 10px; margin-left: 4px; color: #1a73e8; }
  .stats-table tbody tr:hover { background: #f8f9fa; }
  .stats-table tfoot td {
    background: #e8f0fe; font-weight: 700; color: #1a73e8;
    border-top: 2px solid #1a73e8;
    position: sticky; bottom: 0; z-index: 4;
  }
  .stats-table .highest { background: #fef7e0; font-weight: 700; color: #b06000; }
  .table-wrap { overflow-x: auto; }
  .view-toolbar {
    padding: 16px 24px 8px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .tb-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tb-label { font-size: 12px; font-weight: 600; color: #5f6368; margin-right: 4px; }
  .type-btn {
    padding: 5px 12px; font-size: 12px; border: 1px solid #dadce0;
    background: #fff; border-radius: 4px; cursor: pointer; font-weight: 500;
  }
  .type-btn.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
  .mini-btn {
    padding: 3px 10px; font-size: 11px; border: 1px solid #dadce0;
    background: #f8f9fa; border-radius: 10px; cursor: pointer;
  }
  .evt-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; font-size: 11px; border-radius: 12px; cursor: pointer;
    border: 1px solid #dadce0; background: #f8f9fa; user-select: none;
  }
  .evt-chip.on { background: var(--c); color: #fff; border-color: var(--c); }
  .evt-chip input { margin: 0; cursor: pointer; }
  @media (max-width: 700px) {
    .charts-grid { grid-template-columns: 1fr; }
    .chart-card.span2 { grid-column: 1; }
  }
</style>

<!-- Header -->
<div class="header">
  <h1>📊 Duels Dashboard</h1>
  <label>Competition:</label>
  <div class="ms" id="compMS">
    <button class="ms-btn" type="button" onclick="toggleMS('compMS')" id="compMSBtn">All Competitions</button>
    <div class="ms-panel" id="compMSPanel"></div>
  </div>
  <label>Week:</label>
  <div class="ms" id="weekMS">
    <button class="ms-btn" type="button" onclick="toggleMS('weekMS')" id="weekMSBtn">All Weeks</button>
    <div class="ms-panel" id="weekMSPanel"></div>
  </div>
  <label>Match ID:</label>
  <div class="ms" id="matchMS">
    <button class="ms-btn" type="button" onclick="toggleMS('matchMS')" id="matchMSBtn">All Matches</button>
    <div class="ms-panel" id="matchMSPanel">
      <div class="ms-header" style="flex-direction:column;align-items:stretch;gap:6px;">
        <input type="text" id="matchSearch" placeholder="Search or paste IDs (comma-separated) — Enter to apply"
               oninput="onMatchSearch(this.value)"
               onkeydown="if(event.key==='Enter'){event.preventDefault();applyMatchPaste();}"
               style="padding:5px 8px;font-size:12px;border:1px solid #dadce0;border-radius:4px;width:100%;">
        <div style="display:flex;gap:6px;">
          <button onclick="clearMatchFilter()">Clear (show all)</button>
          <button onclick="applyMatchPaste()">Apply typed IDs</button>
        </div>
        <div style="font-size:11px;color:#5f6368;padding:2px 2px 0;">Empty = all matches.</div>
      </div>
      <div id="matchMSList"></div>
    </div>
  </div>
</div>

<div id="error-box"></div>
<div id="loading">
  <div class="spinner"></div>
  <span id="loading-msg">Loading data…</span>
</div>

<div id="app" style="display:none;">
  <div class="tabs">
    <div class="tab active" data-view="weekly"  onclick="switchView('weekly')">Weekly</div>
    <div class="tab"        data-view="monthly" onclick="switchView('monthly')">Monthly</div>
    <div class="tab"        data-view="table"   onclick="switchView('table')">Table by Competition</div>
    <div class="tab"        data-view="comparison" onclick="switchView('comparison')">Reviewed Matches</div>
    <div class="tab"        data-view="cmptable"   onclick="switchView('cmptable')">Comparison Table</div>
    <div class="tab"        data-view="cmpcomp"    onclick="switchView('cmpcomp')">Competition Comparison</div>
  </div>
  <div id="panel-weekly" class="view-panel active"></div>
  <div id="panel-monthly" class="view-panel">
    <div style="padding:16px 24px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <label for="monthlyGranularity" style="font-weight:500;font-size:13px;">Group by:</label>
      <select id="monthlyGranularity" onchange="renderAll()"
              style="padding:6px 12px;border:1px solid #dadce0;border-radius:4px;font-size:13px;min-width:200px;cursor:pointer;">
        <option value="month">Month</option>
        <option value="quarter">Quarter</option>
        <option value="half">Half-Year</option>
        <option value="all">All Months Combined</option>
      </select>
    </div>
    <div id="monthly-body"></div>
  </div>
  <div id="panel-table" class="view-panel">
    <div style="padding:16px 24px 8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <label style="font-weight:500;font-size:13px;">Mode:</label>
      <div class="tb-group">
        <button class="type-btn active" id="tblModeAvg" onclick="setTableMode('avg')">Average</button>
        <button class="type-btn" id="tblModeTotal" onclick="setTableMode('total')">Total</button>
      </div>
      <button class="mini-btn" onclick="sortByHighestEvent()">Sort by highest event</button>
    </div>
    <div id="table-body" style="padding:0 24px 24px;"></div>
  </div>
  <div id="panel-comparison" class="view-panel"></div>
  <div id="panel-cmptable" class="view-panel"></div>
  <div id="panel-cmpcomp" class="view-panel"></div>
</div>
`;
