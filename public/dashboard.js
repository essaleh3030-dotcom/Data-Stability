// dashboard.js — Client-side dashboard logic (ported from Dashboard.html <script>)
// Only change from original: google.script.run → fetch('/api/...')

var PALETTE = [
  '#1a73e8','#34a853','#ea4335','#fbbc05','#9c27b0',
  '#00bcd4','#ff5722','#607d8b','#795548','#4caf50'
];

// Inline plugin — draws value + delta arrow on line & bar charts
var TrendLabels = {
  id: 'trendLabels',
  afterDatasetsDraw: function(chart) {
    var type  = chart.config.type;
    if (type !== 'line' && type !== 'bar') return;
    if (chart.options._cmpChart) return;
    var ctx   = chart.ctx;
    var multi = chart.data.datasets.length > 1;
    var isHbar = chart.options.indexAxis === 'y';

    chart.data.datasets.forEach(function(ds, di) {
      var meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach(function(pt, i) {
        var v = ds.data[i];
        if (v == null) return;
        var val = Math.round(v * 100) / 100;
        var prev = i > 0 ? ds.data[i - 1] : null;

        var deltaTxt = '', deltaColor = '#5f6368';
        if (prev !== null) {
          var d = Math.round((v - prev) * 100) / 100;
          if (d > 0)      { deltaTxt = '▲ +' + d;  deltaColor = '#0f9d58'; }
          else if (d < 0) { deltaTxt = '▼ ' + d;   deltaColor = '#d93025'; }
          else            { deltaTxt = '▬ 0'; }
        }

        var valColor = ds.borderColor || ds.backgroundColor || '#202124';
        ctx.save();

        if (type === 'line') {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.font = 'bold ' + (multi ? 14 : 16) + 'px Arial';
          ctx.fillStyle = valColor;
          ctx.fillText(val, pt.x, pt.y - 8);
          if (!multi && deltaTxt) {
            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = deltaColor;
            ctx.fillText(deltaTxt, pt.x, pt.y - 28);
          }
        } else {
          if (isHbar) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold ' + (multi ? 12 : 14) + 'px Arial';
            ctx.fillStyle = valColor;
            ctx.fillText(val, pt.x + 6, pt.y);
            if (!multi && deltaTxt) {
              ctx.font = 'bold 11px Arial';
              ctx.fillStyle = deltaColor;
              var w = ctx.measureText(val + '').width;
              ctx.fillText(deltaTxt, pt.x + 6 + w + 8, pt.y);
            }
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = 'bold ' + (multi ? 12 : 14) + 'px Arial';
            ctx.fillStyle = valColor;
            ctx.fillText(val, pt.x, pt.y - 6);
            if (!multi && deltaTxt) {
              ctx.font = 'bold 11px Arial';
              ctx.fillStyle = deltaColor;
              ctx.fillText(deltaTxt, pt.x, pt.y - 22);
            }
          }
        }
        ctx.restore();
      });
    });
  }
};

var allRows   = [];
var eventCols = [];
var charts    = {};

var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

var GRANULARITY = {
  month:   { label: 'Month',            keyFn: monthKey   },
  quarter: { label: 'Quarter',          keyFn: quarterKey },
  half:    { label: 'Half-Year',        keyFn: halfKey    },
  all:     { label: 'All Months (Jan–Dec)', keyFn: monthNameKey }
};

// ── Boot ─────────────────────────────────────────────────────────────────────
function setLoadingMsg(m) {
  var el = document.getElementById('loading-msg');
  if (el) el.textContent = m;
}

window.initDashboard = function() {
  if (!window.Chart) {
    showError('Chart.js failed to load.');
    return;
  }
  Chart.register(TrendLabels);

  setLoadingMsg('Fetching data…');
  var t0 = Date.now();

  fetch('/api/data')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      setLoadingMsg('Parsing response (' + ((Date.now()-t0)/1000).toFixed(1) + 's)…');

      if (data.error) { showError(data.error); return; }

      allRows   = data.rows || [];
      eventCols = data.eventCols || [];
      setLoadingMsg('Rendering ' + allRows.length + ' rows…');

      if (data.debug && (data.debug.missingEventCols.length || !data.debug.hasTotalCol)) {
        var banner = document.createElement('div');
        banner.style.cssText = 'margin:12px 24px;padding:12px 16px;background:#fef7e0;border-left:4px solid #f9ab00;border-radius:4px;font-size:13px;color:#5f6368;';
        banner.innerHTML =
          '<strong>⚠ Header mismatch on sheet "' + data.debug.sheet + '"</strong><br>' +
          (data.debug.missingEventCols.length ? 'Missing event columns: <code>' + data.debug.missingEventCols.join(', ') + '</code><br>' : '') +
          (!data.debug.hasTotalCol ? 'Missing <code>total_duels</code> column.<br>' : '') +
          'Headers: <code>' + data.debug.headers.join(' | ') + '</code>';
        document.body.insertBefore(banner, document.getElementById('loading'));
      }

      initViewState();
      buildCompFilter();
      buildWeekFilter();
      buildMatchFilter();
      renderAll();

      document.getElementById('loading').style.display = 'none';
      document.getElementById('app').style.display     = 'block';
    })
    .catch(function(err) { showError(String(err)); });
};

// ── Multi-select filters ─────────────────────────────────────────────────────
var selCompetitions = {};
var selWeeks        = {};
var selMatches      = {};
var allMatchIds     = [];

window.toggleMS = function(id) {
  document.getElementById(id).classList.toggle('open');
};
document.addEventListener('click', function(ev) {
  document.querySelectorAll('.ms.open').forEach(function(el) {
    if (!el.contains(ev.target)) el.classList.remove('open');
  });
});

function buildCompFilter() {
  var seen = {};
  allRows.forEach(function(r) { seen[r.competition] = true; });
  var list = Object.keys(seen).sort();
  var panel = document.getElementById('compMSPanel');
  panel.innerHTML =
    '<div class="ms-header">' +
      '<button onclick="msAll(\'comp\',true)">All</button>' +
      '<button onclick="msAll(\'comp\',false)">None</button>' +
    '</div>' +
    list.map(function(c) {
      var id = 'c_' + c.replace(/[^a-z0-9]/gi, '_');
      return '<label class="ms-item"><input type="checkbox" id="' + id + '" value="' + c.replace(/"/g,'&quot;') + '" onchange="onCompChange(this)" checked> ' + c + '</label>';
    }).join('');
  list.forEach(function(c) { selCompetitions[c] = true; });
  updateCompBtn();
}

window.onCompChange = function(cb) {
  if (cb.checked) selCompetitions[cb.value] = true;
  else            delete selCompetitions[cb.value];
  updateCompBtn();
  buildWeekFilter();
  buildMatchFilter();
  renderAll();
};

window.msAll = function(kind, on) {
  if (kind === 'comp') {
    document.querySelectorAll('#compMSPanel input[type=checkbox]').forEach(function(cb) {
      cb.checked = on;
      if (on) selCompetitions[cb.value] = true;
      else    delete selCompetitions[cb.value];
    });
    updateCompBtn();
    buildWeekFilter();
    buildMatchFilter();
  } else if (kind === 'week') {
    document.querySelectorAll('#weekMSPanel input[type=checkbox]').forEach(function(cb) {
      cb.checked = on;
      if (on) selWeeks[cb.value] = true;
      else    delete selWeeks[cb.value];
    });
    updateWeekBtn();
  } else if (kind === 'match') {
    document.querySelectorAll('#matchMSPanel input[type=checkbox]').forEach(function(cb) {
      cb.checked = on;
      if (on) selMatches[cb.value] = true;
      else    delete selMatches[cb.value];
    });
    updateMatchBtn();
  }
  renderAll();
};

function updateCompBtn() {
  var n = Object.keys(selCompetitions).length;
  var total = document.querySelectorAll('#compMSPanel input').length;
  var btn = document.getElementById('compMSBtn');
  btn.textContent = (n === 0 || n === total) ? 'All Competitions' :
    (n === 1 ? Object.keys(selCompetitions)[0] : n + ' selected');
}
function updateWeekBtn() {
  var n = Object.keys(selWeeks).length;
  var total = document.querySelectorAll('#weekMSPanel input').length;
  var btn = document.getElementById('weekMSBtn');
  btn.textContent = (n === 0 || n === total) ? 'All Weeks' :
    (n === 1 ? Object.keys(selWeeks)[0] : n + ' selected');
}

function buildWeekFilter() {
  var compFiltered = compFilterRows(allRows);
  var matches = combineHalves(compFiltered);
  var seen = {};
  matches.forEach(function(r) { seen[weekKey(r)] = true; });
  var list = Object.keys(seen).sort();

  var previous = Object.keys(selWeeks);
  selWeeks = {};
  list.forEach(function(w) {
    if (previous.length === 0 || previous.indexOf(w) >= 0) selWeeks[w] = true;
  });
  if (Object.keys(selWeeks).length === 0) list.forEach(function(w) { selWeeks[w] = true; });

  var panel = document.getElementById('weekMSPanel');
  panel.innerHTML =
    '<div class="ms-header">' +
      '<button onclick="msAll(\'week\',true)">All</button>' +
      '<button onclick="msAll(\'week\',false)">None</button>' +
    '</div>' +
    list.map(function(w) {
      return '<label class="ms-item"><input type="checkbox" value="' + w + '" onchange="onWeekChange(this)" ' + (selWeeks[w] ? 'checked' : '') + '> ' + w + '</label>';
    }).join('');
  updateWeekBtn();
}

window.onWeekChange = function(cb) {
  if (cb.checked) selWeeks[cb.value] = true;
  else            delete selWeeks[cb.value];
  updateWeekBtn();
  renderAll();
};

function buildMatchFilter() {
  var compRows = compFilterRows(allRows);
  var seen = {};
  compRows.forEach(function(r) { if (r.match_id) seen[r.match_id] = true; });
  allMatchIds = Object.keys(seen).sort();

  var kept = {};
  Object.keys(selMatches).forEach(function(m) {
    if (allMatchIds.indexOf(m) >= 0) kept[m] = true;
  });
  selMatches = kept;

  renderMatchList('');
  updateMatchBtn();
}

function renderMatchList(query) {
  var q = String(query || '').trim().toLowerCase();
  var list = q ? allMatchIds.filter(function(m) { return m.toLowerCase().indexOf(q) >= 0; }) : allMatchIds;
  var el = document.getElementById('matchMSList');
  var cap = 500;
  var shown = list.slice(0, cap);
  el.innerHTML = shown.map(function(m) {
    return '<label class="ms-item"><input type="checkbox" value="' + m + '"' +
           (selMatches[m] ? ' checked' : '') + ' onchange="onMatchChange(this)"> ' + m + '</label>';
  }).join('') + (list.length > cap ? '<div style="padding:6px 12px;color:#5f6368;font-size:11px;">' + (list.length - cap) + ' more not shown.</div>' : '');
}

window.onMatchSearch = function(q) { renderMatchList(q); };
window.onMatchChange = function(cb) {
  if (cb.checked) selMatches[cb.value] = true;
  else            delete selMatches[cb.value];
  updateMatchBtn();
  renderAll();
};

window.applyMatchPaste = function() {
  var raw = document.getElementById('matchSearch').value;
  var ids = raw.split(/[\s,;]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (!ids.length) return;
  selMatches = {};
  ids.forEach(function(id) { if (allMatchIds.indexOf(id) >= 0) selMatches[id] = true; });
  renderMatchList('');
  updateMatchBtn();
  renderAll();
};

window.clearMatchFilter = function() {
  selMatches = {};
  document.getElementById('matchSearch').value = '';
  renderMatchList('');
  updateMatchBtn();
  renderAll();
};

function updateMatchBtn() {
  var n = Object.keys(selMatches).length;
  var btn = document.getElementById('matchMSBtn');
  btn.textContent = (n === 0) ? 'All Matches (' + allMatchIds.length + ')'
    : (n === 1 ? 'Match ' + Object.keys(selMatches)[0] : n + ' matches selected');
}

function compFilterRows(rows) {
  var picked = Object.keys(selCompetitions);
  var total  = document.querySelectorAll('#compMSPanel input').length;
  if (picked.length === 0 || picked.length === total) return rows;
  return rows.filter(function(r) { return selCompetitions[r.competition]; });
}

function filteredRows() {
  var rows = compFilterRows(allRows);
  var mKeys = Object.keys(selMatches);
  if (mKeys.length > 0) {
    rows = rows.filter(function(r) { return selMatches[r.match_id]; });
  }
  var matches = combineHalves(rows);
  var wkKeys = Object.keys(selWeeks);
  var wkAll  = document.querySelectorAll('#weekMSPanel input').length;
  if (wkKeys.length > 0 && wkKeys.length !== wkAll) {
    matches = matches.filter(function(r) { return selWeeks[weekKey(r)]; });
  }
  return matches;
}

function combineHalves(rows) {
  var byMatch = {};
  var order = [];
  rows.forEach(function(r) {
    var key = r.match_id || (r.competition + '|' + r.dateStr);
    if (!byMatch[key]) {
      order.push(key);
      var evts = {};
      eventCols.forEach(function(e) { evts[e] = 0; });
      byMatch[key] = {
        match_id: r.match_id, competition: r.competition,
        y: r.y, m: r.m, d: r.d, dateStr: r.dateStr,
        events: evts, total_duels: 0
      };
    }
    var m = byMatch[key];
    if (r.dateStr > m.dateStr) { m.dateStr = r.dateStr; m.y = r.y; m.m = r.m; m.d = r.d; }
    eventCols.forEach(function(e) { m.events[e] += (r.events[e] || 0); });
    m.total_duels += (r.total_duels || 0);
  });
  return order.map(function(k) { return byMatch[k]; });
}

// ── View switch ──────────────────────────────────────────────────────────────
window.switchView = function(id) {
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-view') === id);
  });
  document.querySelectorAll('.view-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'panel-' + id);
  });
  if (id === 'comparison') setTimeout(renderComparison, 50);
  if (id === 'cmptable') setTimeout(renderCmpTablePage, 50);
  if (id === 'cmpcomp') setTimeout(renderCmpCompPage, 50);
  if (id === 'collectors') setTimeout(renderCollectorsTab, 50);
};

var viewState = {
  weekly:  { chartType: 'line', events: {} },
  monthly: { chartType: 'line', events: {} }
};
var tableState = { mode: 'avg', sortCol: 'competition', sortDir: 'asc', highestMode: false };

function initViewState() {
  ['weekly','monthly'].forEach(function(v) {
    eventCols.forEach(function(e) { viewState[v].events[e] = true; });
  });
}

function humanLabel(e) {
  return e.replace(/-/g,' ').replace(/_/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
}

// ── Panel builder ────────────────────────────────────────────────────────────
function buildPanelInto(elemId, prefix, unitLabel) {
  var panel = document.getElementById(elemId);
  var st    = viewState[prefix];

  var typeBtns = ['line','bar','hbar'].map(function(t) {
    var lbl = t === 'line' ? 'Line' : t === 'bar' ? 'Bar (V)' : 'Bar (H)';
    var active = st.chartType === t ? ' active' : '';
    return '<button class="type-btn' + active + '" data-type="' + t +
           '" onclick="setChartType(\'' + prefix + '\',\'' + t + '\')">' + lbl + '</button>';
  }).join('');

  var evtChips = eventCols.map(function(e, i) {
    var on = st.events[e] !== false;
    var color = PALETTE[i % PALETTE.length];
    return '<label class="evt-chip' + (on ? ' on' : '') + '" style="--c:' + color + '">' +
           '<input type="checkbox"' + (on ? ' checked' : '') + ' data-evt="' + e + '"' +
           ' onchange="toggleEvent(\'' + prefix + '\',\'' + e + '\',this.checked)"> ' +
           humanLabel(e) + '</label>';
  }).join('');

  panel.innerHTML =
    '<div class="view-toolbar">' +
      '<div class="tb-group"><span class="tb-label">Chart:</span>' + typeBtns + '</div>' +
      '<div class="tb-group evt-filter"><span class="tb-label">Events:</span>' +
        '<button class="mini-btn" onclick="toggleAllEvents(\'' + prefix + '\',true)">All</button>' +
        '<button class="mini-btn" onclick="toggleAllEvents(\'' + prefix + '\',false)">None</button>' +
        evtChips +
      '</div>' +
    '</div>' +
    '<div style="padding:0 24px;"><div class="summary" id="' + prefix + '-summary"></div></div>' +
    '<div style="padding:0 24px 24px;"><div class="charts-grid">' +
      '<div class="chart-card span2">' +
        '<h3>Average Duels per Match — by ' + unitLabel + '</h3>' +
        '<div class="chart-wrap-lg"><canvas id="' + prefix + '-avg"></canvas></div>' +
      '</div>' +
      eventCols.map(function(e) {
        return '<div class="chart-card" data-evt-card="' + e + '">' +
          '<h3>' + humanLabel(e) + ' — Avg / Match</h3>' +
          '<div class="chart-wrap"><canvas id="' + prefix + '-evt-' + e + '"></canvas></div>' +
        '</div>';
      }).join('') +
    '</div></div>';
}

window.setChartType = function(prefix, type) {
  viewState[prefix].chartType = type;
  renderAll();
};
window.toggleEvent = function(prefix, evt, on) {
  viewState[prefix].events[evt] = on;
  renderAll();
};
window.toggleAllEvents = function(prefix, on) {
  eventCols.forEach(function(e) { viewState[prefix].events[e] = on; });
  renderAll();
};

// ── Aggregation ──────────────────────────────────────────────────────────────
function weekKey(r) {
  var d = new Date(r.y, r.m - 1, r.d);
  var sun = new Date(d);
  sun.setDate(d.getDate() - d.getDay());
  var y = sun.getFullYear();
  var m = String(sun.getMonth() + 1).padStart(2, '0');
  var day = String(sun.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function monthKey(r) { return r.y + '-' + String(r.m).padStart(2, '0'); }
function quarterKey(r) { return r.y + '-Q' + Math.ceil(r.m / 3); }
function halfKey(r) { return r.y + '-H' + (r.m <= 6 ? 1 : 2); }
function monthNameKey(r) { return String(r.m).padStart(2, '0') + '-' + MONTH_NAMES[r.m - 1]; }

function aggregate(rows, keyFn) {
  var order = [], buckets = {};
  rows.forEach(function(r) {
    var k = keyFn(r);
    if (!buckets[k]) {
      order.push(k);
      buckets[k] = { total_duels: 0, matches: 0 };
      eventCols.forEach(function(e) { buckets[k][e] = 0; });
    }
    buckets[k].total_duels += r.total_duels;
    buckets[k].matches     += 1;
    eventCols.forEach(function(e) { buckets[k][e] += (r.events[e] || 0); });
  });
  var labels = order.slice().sort();
  var eventTotals = {}, avgEvents = {};
  eventCols.forEach(function(e) {
    eventTotals[e] = labels.map(function(l) { return buckets[l][e]; });
    avgEvents[e]   = labels.map(function(l) {
      return buckets[l].matches ? buckets[l][e] / buckets[l].matches : 0;
    });
  });
  return {
    labels: labels,
    eventTotals: eventTotals,
    avgEvents: avgEvents,
    totalDuels: labels.map(function(l) { return buckets[l].total_duels; }),
    matchCounts: labels.map(function(l) { return buckets[l].matches; }),
    avgTotal: labels.map(function(l) {
      return buckets[l].matches ? buckets[l].total_duels / buckets[l].matches : 0;
    })
  };
}

function renderSummary(containerId, rows, agg) {
  var el = document.getElementById(containerId);
  var totalDuels = rows.reduce(function(s, r) { return s + r.total_duels; }, 0);
  var nMatches   = rows.length;
  var avgDuels   = nMatches ? totalDuels / nMatches : 0;
  el.innerHTML = statCard(avgDuels.toFixed(2), 'Avg Duels / Match') +
    statCard(nMatches.toLocaleString(), 'Matches') +
    statCard(agg.labels.length, 'Periods') +
    eventCols.map(function(e, i) {
      var sum = rows.reduce(function(s, r) { return s + (r.events[e] || 0); }, 0);
      var avg = nMatches ? sum / nMatches : 0;
      return statCard(avg.toFixed(2), 'Avg ' + humanLabel(e), PALETTE[i % PALETTE.length]);
    }).join('');
}
function statCard(val, label, color) {
  return '<div class="stat-card"><div class="val" style="color:' + (color||'#1a73e8') + '">' +
    val + '</div><div class="lbl">' + label + '</div></div>';
}

function upsert(id, config) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  var el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, config);
}

var COMMON_HAXIS = { ticks: { maxRotation: 45, font: { size: 13 } }, offset: true };
var COMMON_YAXIS = { beginAtZero: true, ticks: { font: { size: 13 } } };

function niceMax(arrays) {
  var max = 0;
  arrays.forEach(function(a) { a.forEach(function(v) { if (v > max) max = v; }); });
  if (max <= 0) return 10;
  var withPad = max * 1.3;
  var mag = Math.pow(10, Math.floor(Math.log10(withPad)));
  var norm = withPad / mag;
  var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function trendChart(type, labels, data, color, label, totals, matches) {
  var arr    = data.map(function(v) { return Math.round(v * 100) / 100; });
  var isLine = type === 'line';
  var isHbar = type === 'hbar';
  var vMax   = niceMax([arr]);
  var ds = isLine
    ? { label: label, data: arr, borderColor: color, backgroundColor: color + '00',
        fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2, pointBackgroundColor: color }
    : { label: label, data: arr, backgroundColor: color + 'cc', borderColor: color, borderWidth: 1 };
  var yScale = Object.assign({}, COMMON_YAXIS, { max: vMax });
  return {
    type: isLine ? 'line' : 'bar',
    data: { labels: labels, datasets: [ds] },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: isHbar ? 'y' : 'x',
      layout: { padding: { top: 40, right: 20, left: 14, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: function(ctx) {
            var i = ctx.dataIndex;
            var avg = isHbar ? ctx.parsed.x : ctx.parsed.y;
            var t   = totals  ? totals[i]  : null;
            var m   = matches ? matches[i] : null;
            var out = 'Avg: ' + Number(avg).toFixed(2);
            if (t !== null) out += '   |   Total: ' + Math.round(t).toLocaleString();
            if (m !== null) out += '   (' + m + ' matches)';
            return out;
          }
        }}
      },
      scales: isHbar
        ? { x: yScale, y: COMMON_HAXIS }
        : { x: COMMON_HAXIS, y: yScale }
    }
  };
}

function avgTotalChart(type, agg, evtOn) {
  var isLine = type === 'line';
  var isHbar = type === 'hbar';
  var arrays = [];
  var totalsMap = {};
  var datasets = eventCols.map(function(e, i) {
    if (evtOn[e] === false) return null;
    var color = PALETTE[i % PALETTE.length];
    var arr = agg.avgEvents[e].map(function(v){return Math.round(v*100)/100;});
    arrays.push(arr);
    totalsMap[humanLabel(e)] = agg.eventTotals[e];
    return isLine
      ? { label: humanLabel(e), data: arr, borderColor: color,
          backgroundColor: color + '00', fill: false, tension: 0.3,
          pointRadius: 3, borderWidth: 2, pointBackgroundColor: color }
      : { label: humanLabel(e), data: arr,
          backgroundColor: color + 'cc', borderColor: color, borderWidth: 1 };
  }).filter(Boolean);
  var vMax = niceMax(arrays);
  var yScale = Object.assign({}, COMMON_YAXIS, { max: vMax });
  return {
    type: isLine ? 'line' : 'bar',
    data: { labels: agg.labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: isHbar ? 'y' : 'x',
      layout: { padding: { top: 40, right: 20, left: 14, bottom: 4 } },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } },
        tooltip: { callbacks: {
          label: function(ctx) {
            var v = isHbar ? ctx.parsed.x : ctx.parsed.y;
            var t = totalsMap[ctx.dataset.label] ? totalsMap[ctx.dataset.label][ctx.dataIndex] : null;
            var s = ctx.dataset.label + ' — Avg: ' + Number(v).toFixed(2);
            if (t !== null) s += ' | Total: ' + Math.round(t).toLocaleString();
            return s;
          },
          title: function(ctxs) {
            if (!ctxs.length) return '';
            var i = ctxs[0].dataIndex;
            var m = agg.matchCounts[i];
            return ctxs[0].label + '  (' + m + ' matches)';
          }
        }}
      },
      scales: isHbar
        ? { x: yScale, y: COMMON_HAXIS }
        : { x: COMMON_HAXIS, y: yScale }
    }
  };
}

// ── Render everything ────────────────────────────────────────────────────────
function renderAll() {
  var rows = filteredRows();
  buildPanelInto('panel-weekly', 'weekly', 'Week');
  renderPanel('weekly', rows, aggregate(rows, weekKey));

  var gran = document.getElementById('monthlyGranularity').value;
  var g    = GRANULARITY[gran];
  buildPanelInto('monthly-body', 'monthly', g.label);
  renderPanel('monthly', rows, aggregate(rows, g.keyFn));

  renderCompetitionTable(rows);

  if (document.getElementById('panel-comparison').classList.contains('active')) renderComparison();
  if (document.getElementById('panel-cmptable').classList.contains('active')) renderCmpTablePage();
  if (document.getElementById('panel-cmpcomp').classList.contains('active')) renderCmpCompPage();
}

// ── Competition table ────────────────────────────────────────────────────────
window.setTableMode = function(mode) {
  tableState.mode = mode;
  document.getElementById('tblModeAvg').classList.toggle('active',   mode === 'avg');
  document.getElementById('tblModeTotal').classList.toggle('active', mode === 'total');
  renderCompetitionTable(filteredRows());
};
window.sortByHighestEvent = function() {
  tableState.highestMode = !tableState.highestMode;
  renderCompetitionTable(filteredRows());
};
window.sortTable = function(col) {
  if (tableState.sortCol === col) {
    tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    tableState.sortCol = col;
    tableState.sortDir = col === 'competition' ? 'asc' : 'desc';
  }
  renderCompetitionTable(filteredRows());
};

function renderCompetitionTable(rows) {
  var body = document.getElementById('table-body');
  if (!rows.length) { body.innerHTML = '<p style="padding:16px;color:#5f6368;">No data.</p>'; return; }
  var byComp = {};
  rows.forEach(function(r) {
    if (!byComp[r.competition]) {
      var evts = {};
      eventCols.forEach(function(e) { evts[e] = 0; });
      byComp[r.competition] = { matches: 0, events: evts, total_duels: 0 };
    }
    var c = byComp[r.competition];
    c.matches += 1;
    c.total_duels += r.total_duels;
    eventCols.forEach(function(e) { c.events[e] += (r.events[e] || 0); });
  });

  var comps = Object.keys(byComp);
  var mode  = tableState.mode;
  var getVal = function(comp, e) {
    var c = byComp[comp];
    if (mode === 'total') return c.events[e];
    return c.matches ? c.events[e] / c.matches : 0;
  };
  var getTotalDuels = function(comp) {
    var c = byComp[comp];
    if (mode === 'total') return c.total_duels;
    return c.matches ? c.total_duels / c.matches : 0;
  };

  var col = tableState.sortCol, dir = tableState.sortDir === 'asc' ? 1 : -1;
  comps.sort(function(a, b) {
    var va, vb;
    if (col === 'competition') { va = a; vb = b; }
    else if (col === '__matches') { va = byComp[a].matches; vb = byComp[b].matches; }
    else if (col === '__total') { va = getTotalDuels(a); vb = getTotalDuels(b); }
    else { va = getVal(a, col); vb = getVal(b, col); }
    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  });

  function arrow(c) { return tableState.sortCol === c ? '<span class="arrow">' + (tableState.sortDir === 'asc' ? '▲' : '▼') + '</span>' : ''; }
  var pfx  = mode === 'total' ? 'Total ' : 'Avg ';
  var last = mode === 'total' ? 'Total Duels' : 'Avg Duels / Match';
  var head =
    '<th onclick="sortTable(\'competition\')">Competition' + arrow('competition') + '</th>' +
    '<th onclick="sortTable(\'__matches\')">Matches' + arrow('__matches') + '</th>' +
    eventCols.map(function(e) {
      return '<th onclick="sortTable(\'' + e + '\')">' + pfx + humanLabel(e) + arrow(e) + '</th>';
    }).join('') +
    '<th onclick="sortTable(\'__total\')">' + last + arrow('__total') + '</th>';

  var rowsHtml = comps.map(function(comp) {
    var vals = eventCols.map(function(e) { return getVal(comp, e); });
    var maxIdx = 0;
    vals.forEach(function(v, i) { if (v > vals[maxIdx]) maxIdx = i; });
    return '<tr>' +
      '<td>' + comp + '</td>' +
      '<td>' + byComp[comp].matches + '</td>' +
      eventCols.map(function(e, i) {
        var v = vals[i];
        var cls = tableState.highestMode && i === maxIdx ? ' class="highest"' : '';
        return '<td' + cls + '>' + fmtNum(v) + '</td>';
      }).join('') +
      '<td>' + fmtNum(getTotalDuels(comp)) + '</td>' +
    '</tr>';
  }).join('');

  var totalMatches = comps.reduce(function(s, c) { return s + byComp[c].matches; }, 0);
  var overallEvents = eventCols.map(function(e) {
    var sum = comps.reduce(function(s, c) { return s + byComp[c].events[e]; }, 0);
    return mode === 'total' ? sum : (totalMatches ? sum / totalMatches : 0);
  });
  var overallTotalDuels = comps.reduce(function(s, c) { return s + byComp[c].total_duels; }, 0);
  var overallShow = mode === 'total' ? overallTotalDuels : (totalMatches ? overallTotalDuels / totalMatches : 0);
  var footLabel = mode === 'total' ? 'Overall Total' : 'Overall Average';
  var foot = '<tr><td>' + footLabel + '</td><td>' + totalMatches + '</td>' +
    overallEvents.map(function(v) { return '<td>' + fmtNum(v) + '</td>'; }).join('') +
    '<td>' + fmtNum(overallShow) + '</td></tr>';

  body.innerHTML =
    '<button class="export-btn" onclick="exportTableCsv(\'comp-table\',\'table-by-competition\')">&#x2913; Export CSV</button>' +
    '<div class="table-wrap"><table class="stats-table" id="comp-table">' +
    '<thead><tr>' + head + '</tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '<tfoot>' + foot + '</tfoot>' +
    '</table></div>';
}

function fmtNum(v) {
  if (!isFinite(v)) return '—';
  if (tableState.mode === 'total') return Math.round(v).toLocaleString();
  return (Math.round(v * 100) / 100).toFixed(2);
}

function renderPanel(prefix, rows, agg) {
  var st = viewState[prefix];
  renderSummary(prefix + '-summary', rows, agg);
  var selected = eventCols.filter(function(e) { return st.events[e] !== false; });
  var avgSel = agg.labels.map(function(_, i) {
    return selected.reduce(function(s, e) { return s + (agg.avgEvents[e][i] || 0); }, 0);
  });
  var totSel = agg.labels.map(function(_, i) {
    return selected.reduce(function(s, e) { return s + (agg.eventTotals[e][i] || 0); }, 0);
  });
  upsert(prefix + '-avg',
    trendChart(st.chartType, agg.labels, avgSel,
      '#1a73e8', 'Selected Events', totSel, agg.matchCounts));

  eventCols.forEach(function(e, i) {
    var card = document.querySelector('#panel-' + (prefix === 'monthly' ? 'monthly' : 'weekly') +
                                       ' [data-evt-card="' + e + '"]');
    var on = st.events[e] !== false;
    if (card) card.style.display = on ? '' : 'none';
    if (!on) { if (charts[prefix + '-evt-' + e]) { charts[prefix + '-evt-' + e].destroy(); delete charts[prefix + '-evt-' + e]; } return; }
    upsert(prefix + '-evt-' + e,
      trendChart(st.chartType, agg.labels, agg.avgEvents[e],
        PALETTE[i % PALETTE.length], humanLabel(e),
        agg.eventTotals[e], agg.matchCounts));
  });
}

// ── Generic sortable table utility ───────────────────────────────────────────
function attachSortHandlers(container) {
  var tables = container.querySelectorAll('table');
  tables.forEach(function(table) {
    var ths = table.querySelectorAll('thead th[data-col]');
    if (ths.length === 0) {
      var allThs = table.querySelectorAll('thead tr:first-child th');
      allThs.forEach(function(th, idx) {
        th.setAttribute('data-col', idx);
        th.style.cursor = 'pointer';
        if (!th.textContent.match(/⇅/)) th.textContent += ' ⇅';
      });
      ths = table.querySelectorAll('thead th[data-col]');
    }
    ths.forEach(function(th) {
      th.addEventListener('click', function() {
        var col = parseInt(th.getAttribute('data-col'));
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var asc = th.getAttribute('data-sort') !== 'asc';
        ths.forEach(function(t) { t.removeAttribute('data-sort'); });
        th.setAttribute('data-sort', asc ? 'asc' : 'desc');
        rows.sort(function(a, b) {
          var aCell = a.cells[col], bCell = b.cells[col];
          if (!aCell || !bCell) return 0;
          var aVal = aCell.textContent.replace(/[▲▼▬+, ]/g, '').trim();
          var bVal = bCell.textContent.replace(/[▲▼▬+, ]/g, '').trim();
          var aNum = parseFloat(aVal), bNum = parseFloat(bVal);
          if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
          return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        });
        rows.forEach(function(r) { tbody.appendChild(r); });
      });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── COMPARISON VIEW (Reviewed Matches) ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
var CMP_EVENTS = [];
var CMP_ALL_LABELS = [], CMP_ALL_COUNTS = [], CMP_ALL_PART_COUNTS = [];
var CMP_ALL_BEFORE = { avgTotal: [], events: {} };
var CMP_ALL_AFTER  = { avgTotal: [], events: {} };
var CMP_PART_DETAILS = [];
var CMP_TOTAL_PARTS = 0, CMP_TOTAL_MATCHES = 0;
var CMP_COMPETITION_DATA = {};
var cmpDataLoaded = false, cmpDataLoading = false;

var cmpChartType = 'line';
var cmpCharts = {};
var cmpEvOn = {};

// ── Fetch comparison data — now via fetch() instead of google.script.run ────
function loadComparisonData(callback) {
  if (cmpDataLoaded) { callback(); return; }
  if (cmpDataLoading) return;
  cmpDataLoading = true;

  var panel = document.getElementById('panel-comparison');
  panel.innerHTML = '<div style="text-align:center;padding:60px;color:#5f6368;"><div class="spinner" style="margin:0 auto 16px;"></div>Loading comparison data…</div>';

  fetch('/api/comparison')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { panel.innerHTML = '<div style="padding:24px;color:#ea4335;">⚠ ' + d.error + '</div>'; cmpDataLoading = false; return; }
      CMP_EVENTS = d.eventCols || [];
      CMP_ALL_LABELS = d.labels || [];
      CMP_ALL_COUNTS = d.counts || [];
      CMP_ALL_PART_COUNTS = d.partCounts || [];
      CMP_ALL_BEFORE = d.before || { avgTotal: [], events: {} };
      CMP_ALL_AFTER  = d.after  || { avgTotal: [], events: {} };
      CMP_PART_DETAILS = d.partDetails || [];
      CMP_TOTAL_PARTS = d.totalParts || 0;
      CMP_TOTAL_MATCHES = d.totalMatches || 0;
      CMP_COMPETITION_DATA = d.competitionData || {};
      CMP_EVENTS.forEach(function(e) { if (cmpEvOn[e] === undefined) cmpEvOn[e] = true; });
      cmpDataLoaded = true;
      cmpDataLoading = false;
      callback();
    })
    .catch(function(e) {
      panel.innerHTML = '<div style="padding:24px;color:#ea4335;">⚠ ' + e.message + '</div>';
      cmpDataLoading = false;
    });
}

function cmpFiltered() {
  var wkKeys = Object.keys(selWeeks);
  var wkAll  = document.querySelectorAll('#weekMSPanel input').length;
  var useAll = (wkKeys.length === 0 || wkKeys.length === wkAll);
  var idx = [];
  for (var i = 0; i < CMP_ALL_LABELS.length; i++) {
    if (useAll || selWeeks[CMP_ALL_LABELS[i]]) idx.push(i);
  }
  var labels = idx.map(function(i){ return CMP_ALL_LABELS[i]; });
  var counts = idx.map(function(i){ return CMP_ALL_COUNTS[i]; });
  var pCounts = idx.map(function(i){ return (CMP_ALL_PART_COUNTS[i]) || 0; });
  var bAvg   = idx.map(function(i){ return CMP_ALL_BEFORE.avgTotal[i]; });
  var aAvg   = idx.map(function(i){ return CMP_ALL_AFTER.avgTotal[i]; });
  var bEvts  = {}, aEvts = {};
  CMP_EVENTS.forEach(function(e){
    bEvts[e] = idx.map(function(i){ return (CMP_ALL_BEFORE.events[e] || [])[i] || 0; });
    aEvts[e] = idx.map(function(i){ return (CMP_ALL_AFTER.events[e] || [])[i] || 0; });
  });
  var totalN = pCounts.reduce(function(a,b){return a+b;},0);
  return { labels:labels, counts:counts, partCounts:pCounts, totalN:totalN, bAvg:bAvg, aAvg:aAvg, bEvts:bEvts, aEvts:aEvts };
}

function buildCmpPanel() {
  var panel = document.getElementById('panel-comparison');
  var typeBtns = ['line','bar','hbar'].map(function(t){
    var lbl = t==='line'?'Line':t==='bar'?'Bar (V)':'Bar (H)';
    var a = cmpChartType===t?' active':'';
    return '<button class="type-btn'+a+'" onclick="setCmpChart(\''+t+'\')">'+lbl+'</button>';
  }).join('');

  var evtChips = CMP_EVENTS.map(function(e,i){
    var on = cmpEvOn[e];
    var c = PALETTE[i%PALETTE.length];
    return '<label class="evt-chip'+(on?' on':'')+'" style="--c:'+c+'">'+
      '<input type="checkbox"'+(on?' checked':'')+' onchange="toggleCmpEvt(\''+e+'\',this.checked)"> '+
      humanLabel(e)+'</label>';
  }).join('');

  panel.innerHTML =
    '<div class="view-toolbar">'+
      '<div class="tb-group"><span class="tb-label">Chart:</span>'+typeBtns+'</div>'+
      '<div class="tb-group evt-filter"><span class="tb-label">Events:</span>'+
        '<button class="mini-btn" onclick="cmpToggleAll(true)">All</button>'+
        '<button class="mini-btn" onclick="cmpToggleAll(false)">None</button>'+
        evtChips+
      '</div>'+
    '</div>'+
    '<div style="padding:0 24px;"><div class="summary" id="cmp-stats"></div></div>'+
    '<div style="padding:0 24px;">'+
      '<div style="display:flex;gap:16px;margin:8px 0;font-size:12px;color:#5f6368;">'+
        '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:#ea4335;display:inline-block;"></span> Before</span>'+
        '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:#1a73e8;display:inline-block;"></span> After</span>'+
      '</div>'+
    '</div>'+
    '<div style="padding:0 24px 24px;"><div class="charts-grid">'+
      '<div class="chart-card span2">'+
        '<h3>Average Total Duels per Part — by Week</h3>'+
        '<div class="chart-wrap-lg"><canvas id="cmpMainChart"></canvas></div>'+
      '</div>'+
      CMP_EVENTS.map(function(e){
        return '<div class="chart-card" data-cmp-card="'+e+'" style="'+(cmpEvOn[e]?'':'display:none')+'">'+
          '<h3>'+humanLabel(e)+' — Before vs After</h3>'+
          '<div class="chart-wrap"><canvas id="cmpM-'+e+'"></canvas></div>'+
        '</div>';
      }).join('')+
    '</div></div>';
}

// ── Comparison label plugin ─────────────────────────────────────────────────
var CmpLabelsPlugin = {
  id: 'cmpLabels',
  afterDatasetsDraw: function(chart) {
    if (!chart.options._cmpChart) return;
    var ctx = chart.ctx;
    var meta0 = chart.getDatasetMeta(0);
    var meta1 = chart.getDatasetMeta(1);
    if (!meta0 || !meta1) return;
    var isH = chart.options.indexAxis === 'y';

    for (var i = 0; i < meta0.data.length; i++) {
      var p0 = meta0.data[i], p1 = meta1.data[i];
      if (!p0 || !p1) continue;
      var bVal = chart.data.datasets[0].data[i];
      var aVal = chart.data.datasets[1].data[i];
      if (bVal == null || aVal == null) continue;

      var diff = aVal - bVal;
      var arrow = diff > 0 ? ' ▲' : diff < 0 ? ' ▼' : '';
      var arrowClr = diff > 0 ? '#34a853' : diff < 0 ? '#ea4335' : '#80868b';

      if (isH) {
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ea4335';
        ctx.fillText(Number(bVal).toFixed(1), p0.x + 6, p0.y);
        ctx.fillStyle = '#1a73e8';
        ctx.fillText(Number(aVal).toFixed(1) + arrow, p1.x + 6, p1.y);
      } else {
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ea4335';
        ctx.fillText(Number(bVal).toFixed(1), p0.x, p0.y + 16);
        ctx.fillStyle = '#1a73e8';
        ctx.fillText(Number(aVal).toFixed(1), p1.x, p1.y - 20);
        ctx.fillStyle = arrowClr;
        var diffTxt = (diff > 0 ? '+' : '') + diff.toFixed(1) + arrow;
        ctx.fillText(diffTxt, p1.x, p1.y - 34);
      }
    }
  },
  afterDraw: function(chart) {
    if (!chart.options._showPartsCounts) return;
    var ctx = chart.ctx;
    var f = cmpFiltered();
    ctx.save();
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#80868b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var xScale = chart.scales.x;
    for (var i = 0; i < f.counts.length; i++) {
      var xPos = xScale.getPixelForTick(i);
      var yPos = xScale.bottom + 2;
      ctx.fillText('(' + f.partCounts[i] + ' parts)', xPos, yPos);
    }
    ctx.restore();
  }
};

// Register after Chart.js loads — called from initDashboard
function registerCmpPlugin() {
  if (window.Chart) Chart.register(CmpLabelsPlugin);
}

function cmpMkChart(id, type, lbls, datasets, yMax, showParts){
  if(cmpCharts[id]) cmpCharts[id].destroy();
  var cv = document.getElementById(id);
  if(!cv) return;
  var isH = type === 'hbar';
  var yScale = Object.assign({}, COMMON_YAXIS, { max: yMax });
  cmpCharts[id] = new Chart(cv.getContext('2d'), {
    type: isH ? 'bar' : type === 'bar' ? 'bar' : 'line',
    data: {labels: lbls, datasets: datasets},
    options: {
      _cmpChart: true,
      _showPartsCounts: !!showParts,
      indexAxis: isH ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false,
      interaction: {mode:'index', intersect:false},
      layout: { padding: { top: 40, right: 20, left: 14, bottom: showParts ? 36 : 4 } },
      plugins: {
        legend: {display:true, position:'bottom', labels:{font:{size:10}, boxWidth:12, padding:16}},
        tooltip: {
          callbacks: {
            label: function(ctx){
              var v = isH ? ctx.parsed.x : ctx.parsed.y;
              return ctx.dataset.label + ' — Avg: ' + Number(v).toFixed(1);
            },
            afterBody: function(items){ var i=items[0].dataIndex; var f=cmpFiltered(); return 'Parts: '+f.partCounts[i]+' ('+f.counts[i]+' matches)'; }
          }
        }
      },
      scales: isH
        ? { x: yScale, y: COMMON_HAXIS }
        : { x: COMMON_HAXIS, y: yScale }
    }
  });
}

function cmpDS(label, data, color, type){
  var isLine = type === 'line';
  return isLine
    ? { label:label, data:data, borderColor:color, backgroundColor:color+'00', fill:false, tension:0.3, pointRadius:4, borderWidth:2, pointBackgroundColor:color }
    : { label:label, data:data, backgroundColor:color+'cc', borderColor:color, borderWidth:1 };
}

function renderCmpCharts(){
  var f = cmpFiltered();
  var anyOn = CMP_EVENTS.some(function(e){ return cmpEvOn[e]; });
  var mainCard = document.querySelector('.chart-card.span2');
  if(!anyOn){
    if(mainCard) mainCard.style.display = 'none';
  } else {
    if(mainCard) mainCard.style.display = '';
    var bSum = f.labels.map(function(){ return 0; });
    var aSum = f.labels.map(function(){ return 0; });
    CMP_EVENTS.forEach(function(e){
      if(!cmpEvOn[e]) return;
      for(var i=0; i<f.labels.length; i++){
        bSum[i] += f.bEvts[e][i] || 0;
        aSum[i] += f.aEvts[e][i] || 0;
      }
    });
    var yMax = niceMax([bSum, aSum]);
    cmpMkChart('cmpMainChart', cmpChartType, f.labels,
      [cmpDS('Before', bSum, '#ea4335', cmpChartType),
       cmpDS('After',  aSum, '#1a73e8', cmpChartType)], yMax, true);
  }
  CMP_EVENTS.forEach(function(e){
    var card = document.querySelector('[data-cmp-card="'+e+'"]');
    if(card) card.style.display = cmpEvOn[e] ? '' : 'none';
    if(!cmpEvOn[e]) return;
    var yM = niceMax([f.bEvts[e], f.aEvts[e]]);
    cmpMkChart('cmpM-'+e, 'line', f.labels,
      [cmpDS('Before', f.bEvts[e], '#ea4335', 'line'),
       cmpDS('After',  f.aEvts[e], '#1a73e8', 'line')], yM, false);
  });
}

function renderCmpStats(){
  var f = cmpFiltered();
  if(f.totalN === 0){ document.getElementById('cmp-stats').innerHTML = ''; return; }
  var bA = f.bAvg.reduce(function(s,v,i){return s+v*f.partCounts[i];},0)/f.totalN;
  var aA = f.aAvg.reduce(function(s,v,i){return s+v*f.partCounts[i];},0)/f.totalN;
  var diff = aA - bA;
  var pct = bA > 0 ? ((diff/bA)*100).toFixed(0) : '0';
  var sign = diff >= 0 ? '+' : '';
  document.getElementById('cmp-stats').innerHTML =
    '<div class="stat-card"><div class="val" style="color:#1a73e8">'+CMP_TOTAL_MATCHES+'</div><div class="lbl">Reviewed Matches</div></div>'+
    '<div class="stat-card"><div class="val" style="color:#5f6368">'+CMP_TOTAL_PARTS+'</div><div class="lbl">Reviewed Parts</div></div>'+
    '<div class="stat-card"><div class="val" style="color:#ea4335">'+bA.toFixed(1)+'</div><div class="lbl">Avg Before / Part</div></div>'+
    '<div class="stat-card"><div class="val" style="color:#1a73e8">'+aA.toFixed(1)+'</div><div class="lbl">Avg After / Part</div></div>'+
    '<div class="stat-card"><div class="val" style="color:#34a853">'+sign+diff.toFixed(1)+'</div><div class="lbl">Change ('+sign+pct+'%)</div></div>';
}

// ── Comparison Table — 1 table per event ─────────────────────────────────────
function renderCmpTablePage(){
  loadComparisonData(function(){
    var panel = document.getElementById('panel-cmptable');
    var f = cmpFiltered();
    if(f.totalN === 0){ panel.innerHTML = '<div style="padding:24px;color:#5f6368;">No data.</div>'; return; }

    var parts = CMP_PART_DETAILS.slice().sort(function(a,b){ return b.diff - a.diff; });

    var evtRows = CMP_EVENTS.map(function(e){
      var bA = +(f.bEvts[e].reduce(function(s,v,i){return s+v*f.partCounts[i];},0)/f.totalN).toFixed(1);
      var aA = +(f.aEvts[e].reduce(function(s,v,i){return s+v*f.partCounts[i];},0)/f.totalN).toFixed(1);
      var d = +(aA-bA).toFixed(1);
      var p = bA>0 ? +((d/bA)*100).toFixed(0) : 0;
      return {e:e, bA:bA, aA:aA, d:d, p:p};
    });
    var maxD = Math.max.apply(null, evtRows.map(function(r){return r.d;}));

    var html = '<div style="padding:24px;">'+
      '<h2 style="font-size:16px;font-weight:600;margin-bottom:16px;">Event Comparison — '+CMP_TOTAL_MATCHES+' Reviewed Matches ('+CMP_TOTAL_PARTS+' parts)</h2>'+
      '<button class="export-btn" onclick="exportTableCsv(\'cmp-evt-avg-table\',\'reviewed-event-avg\')">&#x2913; Export Event Avg CSV</button> '+
      '<button class="export-btn" onclick="exportTableCsv(\'cmp-parts-table\',\'reviewed-parts-detail\')">&#x2913; Export Parts CSV</button>'+
      '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-top:12px;">';

    html += '<div style="flex:1;min-width:340px;">'+
      '<h3 style="font-size:13px;font-weight:600;color:#5f6368;margin-bottom:8px;">Average per Part (Before → After)</h3>'+
      '<div class="table-wrap"><table class="stats-table" id="cmp-evt-avg-table">'+
      '<thead><tr>'+['Event','Before','After','Diff','%'].map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr></thead><tbody>';
    html += evtRows.map(function(r){
      var hi = r.d===maxD?' class="highest"':'';
      var arr = r.d>0?'▲':r.d<0?'▼':'▬';
      var clr = r.d>0?'color:#34a853':r.d<0?'color:#ea4335':'color:#80868b';
      return '<tr><td style="text-align:left;font-weight:600">'+humanLabel(r.e)+'</td>'+
        '<td style="color:#ea4335">'+r.bA+'</td><td style="color:#1a73e8">'+r.aA+'</td>'+
        '<td'+hi+' style="'+clr+'">'+arr+' '+(r.d>0?'+':'')+r.d+'</td>'+
        '<td style="'+clr+'">'+(r.d>=0?'+':'')+r.p+'%</td></tr>';
    }).join('');
    var bT = evtRows.reduce(function(s,r){return s+r.bA;},0).toFixed(1);
    var aT = evtRows.reduce(function(s,r){return s+r.aA;},0).toFixed(1);
    var tD = (aT-bT).toFixed(1);
    var tP = bT>0?((tD/bT)*100).toFixed(0):0;
    html += '</tbody><tfoot><tr><td style="text-align:left">Total</td><td style="color:#ea4335">'+bT+'</td><td style="color:#1a73e8">'+aT+'</td><td style="color:#34a853">▲ +'+tD+'</td><td style="color:#34a853">+'+tP+'%</td></tr></tfoot>';
    html += '</table></div></div>';

    html += '<div style="flex:1;min-width:340px;display:flex;flex-direction:column;">'+
      '<h3 style="font-size:13px;font-weight:600;color:#5f6368;margin-bottom:8px;">Total Duels per Part (Before → After)</h3>'+
      '<div style="flex:1;overflow-y:auto;max-height:450px;border:1px solid #e0e0e0;border-radius:8px 8px 0 0;">'+
      '<table class="stats-table" id="cmp-parts-table" style="border-radius:0;border:none;box-shadow:none;">'+
      '<thead style="position:sticky;top:0;background:#fff;z-index:1;"><tr><th>Match</th><th>Part</th><th>Week</th><th>Before</th><th>After</th><th>Diff</th></tr></thead><tbody>';
    var pBTotal = 0, pATotal = 0;
    parts.forEach(function(p){
      pBTotal += p.beforeTotal; pATotal += p.afterTotal;
      var clr = p.diff>0?'color:#34a853':p.diff<0?'color:#ea4335':'color:#80868b';
      var arr = p.diff>0?'▲':p.diff<0?'▼':'▬';
      html += '<tr><td>'+p.matchId+'</td><td>'+p.partId+'</td><td>'+p.week+'</td>'+
        '<td style="color:#ea4335">'+p.beforeTotal+'</td><td style="color:#1a73e8">'+p.afterTotal+'</td>'+
        '<td style="'+clr+'">'+arr+' '+(p.diff>0?'+':'')+p.diff+'</td></tr>';
    });
    var pDTotal = pATotal - pBTotal;
    var pDClr = pDTotal>0?'color:#34a853':pDTotal<0?'color:#ea4335':'color:#80868b';
    html += '</tbody></table></div>'+
      '<table class="stats-table" style="border-radius:0 0 8px 8px;border:none;box-shadow:none;border-top:none;">'+
      '<tfoot><tr><td colspan="3" style="text-align:left;font-weight:700;">Total ('+parts.length+' parts)</td>'+
      '<td style="color:#ea4335;font-weight:700;">'+pBTotal+'</td>'+
      '<td style="color:#1a73e8;font-weight:700;">'+pATotal+'</td>'+
      '<td style="'+pDClr+';font-weight:700;">'+(pDTotal>0?'+':'')+pDTotal+'</td></tr></tfoot>'+
      '</table></div>';
    html += '</div>';

    html += '<h2 style="font-size:16px;font-weight:600;margin:32px 0 16px;">Per-Event Breakdown — Each Part</h2>'+
      '<div style="display:flex;flex-wrap:wrap;gap:24px;">';

    CMP_EVENTS.forEach(function(e){
      var eTotalB = 0, eTotalA = 0;
      parts.forEach(function(p){ eTotalB += (p.beforeEvents[e]||0); eTotalA += (p.afterEvents[e]||0); });
      var eTotalD = eTotalA - eTotalB;
      var eDClr = eTotalD>0?'color:#34a853':eTotalD<0?'color:#ea4335':'color:#80868b';

      html += '<div style="flex:0 0 calc(50% - 12px);min-width:0;display:flex;flex-direction:column;">'+
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:8px;">'+humanLabel(e)+
        ' <span style="font-weight:400;font-size:12px;'+eDClr+'">Total diff: '+(eTotalD>0?'+':'')+eTotalD+'</span></h3>'+
        '<div style="flex:1;overflow-y:auto;max-height:350px;border:1px solid #e0e0e0;border-radius:8px 8px 0 0;">'+
        '<table class="stats-table" style="font-size:12px;border-radius:0;border:none;box-shadow:none;">'+
        '<thead style="position:sticky;top:0;background:#fff;z-index:1;"><tr><th>Match</th><th>Part</th><th>Week</th>'+
        '<th style="color:#ea4335;">Before</th><th style="color:#1a73e8;">After</th><th>Diff</th></tr></thead><tbody>';

      parts.forEach(function(p){
        var bv = (p.beforeEvents && p.beforeEvents[e]) || 0;
        var av = (p.afterEvents && p.afterEvents[e]) || 0;
        var dv = av - bv;
        var clr = dv>0?'color:#34a853':dv<0?'color:#ea4335':'color:#80868b';
        var arr = dv>0?'▲':dv<0?'▼':'';
        html += '<tr><td>'+p.matchId+'</td><td>'+p.partId+'</td><td>'+p.week+'</td>'+
          '<td>'+bv+'</td><td>'+av+'</td>'+
          '<td style="'+clr+'">'+arr+(dv>0?'+':'')+dv+'</td></tr>';
      });

      html += '</tbody></table></div>'+
        '<table class="stats-table" style="font-size:12px;border-radius:0 0 8px 8px;border:none;box-shadow:none;border-top:none;">'+
        '<tfoot><tr><td colspan="3" style="text-align:left;font-weight:700;">Total</td>'+
        '<td style="color:#ea4335;font-weight:700;">'+eTotalB+'</td>'+
        '<td style="color:#1a73e8;font-weight:700;">'+eTotalA+'</td>'+
        '<td style="'+eDClr+';font-weight:700;">'+(eTotalD>0?'+':'')+eTotalD+'</td></tr></tfoot>'+
        '</table></div>';
    });

    html += '</div></div>';
    panel.innerHTML = html;
    attachSortHandlers(panel);
  });
}

// ── Competition Comparison ───────────────────────────────────────────────────
function renderCmpCompPage(){
  loadComparisonData(function(){
    var panel = document.getElementById('panel-cmpcomp');
    var compKeys = Object.keys(CMP_COMPETITION_DATA).sort();
    if(compKeys.length === 0){ panel.innerHTML = '<div style="padding:24px;color:#5f6368;">No competition data.</div>'; return; }

    var html = '<div style="padding:24px;">'+
      '<h2 style="font-size:16px;font-weight:600;margin-bottom:16px;">Comparison by Competition — '+CMP_TOTAL_MATCHES+' Reviewed Matches ('+CMP_TOTAL_PARTS+' parts)</h2>'+
      '<button class="export-btn" onclick="exportTableCsv(\'compCompTable\',\'competition-comparison\')">&#x2913; Export CSV</button>'+
      '<div class="table-wrap"><table class="stats-table" id="compCompTable">'+
      '<thead><tr>'+
      '<th data-col="0" style="text-align:left;cursor:pointer;">Competition ⇅</th>'+
      '<th data-col="1" style="cursor:pointer;">Matches ⇅</th>'+
      '<th data-col="2" style="cursor:pointer;">Parts ⇅</th>'+
      '<th data-col="3" style="cursor:pointer;color:#ea4335;">Before Avg ⇅</th>'+
      '<th data-col="4" style="cursor:pointer;color:#1a73e8;">After Avg ⇅</th>'+
      '<th data-col="5" style="cursor:pointer;">Diff ⇅</th>'+
      '<th data-col="6" style="cursor:pointer;">% ⇅</th>'+
      '<th data-col="7" style="cursor:pointer;color:#ea4335;">Before Total ⇅</th>'+
      '<th data-col="8" style="cursor:pointer;color:#1a73e8;">After Total ⇅</th>'+
      '<th data-col="9" style="cursor:pointer;">Total Diff ⇅</th>'+
      '</tr></thead><tbody>';

    compKeys.forEach(function(c){
      var cd = CMP_COMPETITION_DATA[c];
      var d = +(cd.aAvg - cd.bAvg).toFixed(1);
      var p = cd.bAvg>0 ? +((d/cd.bAvg)*100).toFixed(0) : 0;
      var td = cd.aTotal - cd.bTotal;
      var clr = d>0?'color:#34a853':d<0?'color:#ea4335':'color:#80868b';
      var arr = d>0?'▲':d<0?'▼':'▬';
      html += '<tr><td style="text-align:left;font-weight:600;">'+c+'</td>'+
        '<td>'+cd.matchCount+'</td><td>'+cd.partCount+'</td>'+
        '<td style="color:#ea4335">'+cd.bAvg+'</td><td style="color:#1a73e8">'+cd.aAvg+'</td>'+
        '<td style="'+clr+'">'+arr+' '+(d>0?'+':'')+d+'</td>'+
        '<td style="'+clr+'">'+(d>=0?'+':'')+p+'%</td>'+
        '<td style="color:#ea4335">'+cd.bTotal+'</td><td style="color:#1a73e8">'+cd.aTotal+'</td>'+
        '<td style="'+clr+'">'+(td>0?'+':'')+td+'</td></tr>';
    });
    html += '</tbody></table></div>';

    compKeys.forEach(function(c){
      var cd = CMP_COMPETITION_DATA[c];
      var d = +(cd.aAvg - cd.bAvg).toFixed(1);
      html += '<h3 style="font-size:14px;font-weight:600;margin:24px 0 8px;">'+c+' — Event Breakdown (Avg per Part)</h3>'+
        '<div class="table-wrap"><table class="stats-table" style="font-size:12px;">'+
        '<thead><tr><th style="text-align:left;">Event</th><th style="color:#ea4335;">Before</th><th style="color:#1a73e8;">After</th><th>Diff</th></tr></thead><tbody>';
      CMP_EVENTS.forEach(function(e){
        var bv = cd.bEvents[e] || 0;
        var av = cd.aEvents[e] || 0;
        var dv = +(av - bv).toFixed(1);
        var ec = dv>0?'color:#34a853':dv<0?'color:#ea4335':'color:#80868b';
        var ea = dv>0?'▲':dv<0?'▼':'▬';
        html += '<tr><td style="text-align:left;font-weight:600;">'+humanLabel(e)+'</td>'+
          '<td style="color:#ea4335">'+bv+'</td><td style="color:#1a73e8">'+av+'</td>'+
          '<td style="'+ec+'">'+ea+' '+(dv>0?'+':'')+dv+'</td></tr>';
      });
      html += '<tr style="font-weight:600;"><td style="text-align:left;">Total</td>'+
        '<td style="color:#ea4335">'+cd.bAvg+'</td><td style="color:#1a73e8">'+cd.aAvg+'</td>'+
        '<td style="'+(d>0?'color:#34a853':d<0?'color:#ea4335':'color:#80868b')+'">'+(d>0?'+':'')+d+'</td></tr>';
      html += '</tbody></table></div>';
    });

    html += '</div>';
    panel.innerHTML = html;
    attachSortHandlers(panel);
  });
}

window.setCmpChart = function(t){
  cmpChartType = t;
  buildCmpPanel();
  renderCmpStats();
  renderCmpCharts();
};
window.toggleCmpEvt = function(e, on){
  cmpEvOn[e] = on;
  renderCmpCharts();
};
window.cmpToggleAll = function(on){
  CMP_EVENTS.forEach(function(e){ cmpEvOn[e] = on; });
  buildCmpPanel();
  renderCmpStats();
  renderCmpCharts();
};

function renderComparison(){
  loadComparisonData(function(){
    buildCmpPanel();
    renderCmpStats();
    renderCmpCharts();
  });
}

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  var el = document.getElementById('error-box');
  el.style.display = 'block';
  el.textContent = '⚠  ' + msg;
}

// ── Collectors Tab ──────────────────────────────────────────────────────────
var collectorsData = null;
var collectorsLoaded = false;

function loadCollectorsData(cb) {
  if (collectorsData) { cb(); return; }
  fetch('/api/collectors')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { showError('Collectors: ' + data.error); return; }
      collectorsData = data;
      collectorsLoaded = true;
      cb();
    })
    .catch(function(e) { showError('Collectors fetch failed: ' + e.message); });
}

window.renderCollectorsTab = function() {
  loadCollectorsData(function() {
    var panel = document.getElementById('panel-collectors');
    if (!panel || !collectorsData) return;

    var d = collectorsData;
    var html = '';
    var thStyle = 'background:#f8f9fa;position:sticky;top:0;z-index:2;';

    // Summary cards
    html += '<div class="summary">';
    html += '<div class="stat-card"><div class="val">' + d.totalMatchedParts + '</div><div class="lbl">Assigned Parts (matched)</div></div>';
    html += '<div class="stat-card"><div class="val">' + d.collectorsOverview.length + '</div><div class="lbl">Collectors</div></div>';
    html += '<div class="stat-card"><div class="val">' + d.totalReviewedParts + '</div><div class="lbl">Reviewed Parts</div></div>';
    html += '<div class="stat-card"><div class="val">' + d.reviewCollectorSummary.length + '</div><div class="lbl">Collectors Reviewed</div></div>';
    html += '</div>';

    // Two tables side by side
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">';

    // ── LEFT: Collector Parts Overview ──
    html += '<div style="flex:1;min-width:520px;">';
    html += '<h2 style="font-size:15px;font-weight:600;color:#202124;margin:0 0 8px;">Collector Parts Overview (Before Data)</h2>';
    html += '<button class="export-btn" onclick="exportTableCsv(\'collectors-overview-table\',\'collectors-overview\')">&#x2913; Export CSV</button>';
    html += '<div style="max-height:500px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;">';
    html += '<table class="stats-table" id="collectors-overview-table" style="border:none;border-radius:0;box-shadow:none;border-collapse:separate;border-spacing:0;">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + '">HR Code</th>';
    html += '<th style="' + thStyle + '">Name</th>';
    html += '<th style="' + thStyle + '">Total</th>';
    html += '<th style="' + thStyle + 'color:#d93025;">&lt;20</th>';
    html += '<th style="' + thStyle + 'color:#c62828;">20-30</th>';
    html += '<th style="' + thStyle + 'color:#e65100;">30-40</th>';
    html += '<th style="' + thStyle + 'color:#f9ab00;">40-60</th>';
    html += '<th style="' + thStyle + 'color:#ff8f00;">60-80</th>';
    html += '<th style="' + thStyle + 'color:#34a853;">80-100</th>';
    html += '<th style="' + thStyle + 'color:#1a73e8;">100+</th>';
    html += '</tr></thead><tbody>';

    var totals = { parts:0, u20:0, f20:0, f30:0, f40:0, f60:0, f80:0, o100:0 };
    d.collectorsOverview.forEach(function(c) {
      totals.parts += c.totalParts;
      totals.u20  += (c.under20 || 0);
      totals.f20  += (c.from20to30 || 0);
      totals.f30  += (c.from30to40 || 0);
      totals.f40  += (c.from40to60 || 0);
      totals.f60  += c.from60to80;
      totals.f80  += c.from80to100;
      totals.o100 += c.over100;

      function cc(v, clr) { return v > 0 ? ' style="color:'+clr+';font-weight:600;"' : ''; }
      html += '<tr>';
      html += '<td>' + esc(c.hr_code) + '</td>';
      html += '<td>' + esc(c.full_name) + '</td>';
      html += '<td>' + c.totalParts + '</td>';
      html += '<td' + cc(c.under20||0,'#d93025') + '>' + (c.under20||0) + '</td>';
      html += '<td' + cc(c.from20to30||0,'#c62828') + '>' + (c.from20to30||0) + '</td>';
      html += '<td' + cc(c.from30to40||0,'#e65100') + '>' + (c.from30to40||0) + '</td>';
      html += '<td' + cc(c.from40to60||0,'#f9ab00') + '>' + (c.from40to60||0) + '</td>';
      html += '<td' + cc(c.from60to80,'#ff8f00') + '>' + c.from60to80 + '</td>';
      html += '<td' + cc(c.from80to100,'#34a853') + '>' + c.from80to100 + '</td>';
      html += '<td' + cc(c.over100,'#1a73e8') + '>' + c.over100 + '</td>';
      html += '</tr>';
    });

    var footStyle = 'background:#e8f0fe;font-weight:700;color:#1a73e8;position:sticky;bottom:0;z-index:2;';
    html += '</tbody><tfoot><tr>';
    html += '<td style="' + footStyle + '" colspan="2">Total</td>';
    html += '<td style="' + footStyle + '">' + totals.parts + '</td>';
    html += '<td style="' + footStyle + '">' + totals.u20 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.f20 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.f30 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.f40 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.f60 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.f80 + '</td>';
    html += '<td style="' + footStyle + '">' + totals.o100 + '</td>';
    html += '</tr></tfoot></table></div>';
    html += '</div>';

    // ── RIGHT: Per-Collector Review Summary ──
    html += '<div style="flex:1;min-width:380px;">';
    html += '<h2 style="font-size:15px;font-weight:600;color:#202124;margin:0 0 8px;">Reviewed Duels Added (Before vs Current)</h2>';

    if (d.reviewCollectorSummary.length === 0) {
      html += '<p style="color:#5f6368;font-size:13px;">No reviewed parts found.</p>';
    } else {
      html += '<button class="export-btn" onclick="exportTableCsv(\'review-summary-table\',\'reviewed-collector-summary\')">&#x2913; Export CSV</button>';
      html += '<div style="max-height:500px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;">';
      html += '<table class="stats-table" id="review-summary-table" style="border:none;border-radius:0;box-shadow:none;border-collapse:separate;border-spacing:0;">';
      html += '<thead><tr>';
      html += '<th style="' + thStyle + '">HR Code</th>';
      html += '<th style="' + thStyle + '">Name</th>';
      html += '<th style="' + thStyle + '">Reviewed Parts</th>';
      html += '<th style="' + thStyle + '">Total Added</th>';
      html += '<th style="' + thStyle + '">Avg / Part</th>';
      html += '</tr></thead><tbody>';

      var rTotals = { parts: 0, duels: 0 };
      d.reviewCollectorSummary.forEach(function(c) {
        rTotals.parts += c.reviewedParts;
        rTotals.duels += c.totalDuelsAdded;

        var diffColor = c.totalDuelsAdded > 0 ? '#34a853' : (c.totalDuelsAdded < 0 ? '#d93025' : '#5f6368');
        html += '<tr>';
        html += '<td>' + esc(c.hr_code) + '</td>';
        html += '<td>' + esc(c.full_name) + '</td>';
        html += '<td>' + c.reviewedParts + '</td>';
        html += '<td style="color:' + diffColor + ';font-weight:600;">' + (c.totalDuelsAdded > 0 ? '+' : '') + c.totalDuelsAdded + '</td>';
        html += '<td style="color:' + diffColor + ';font-weight:600;">' + (c.avgDuelsAdded > 0 ? '+' : '') + c.avgDuelsAdded + '</td>';
        html += '</tr>';
      });

      var overallAvg = rTotals.parts > 0 ? Math.round(rTotals.duels / rTotals.parts * 10) / 10 : 0;
      var fs2 = 'background:#e8f0fe;font-weight:700;color:#1a73e8;position:sticky;bottom:0;z-index:2;';
      html += '</tbody><tfoot><tr>';
      html += '<td style="' + fs2 + '" colspan="2">Total</td>';
      html += '<td style="' + fs2 + '">' + rTotals.parts + '</td>';
      html += '<td style="' + fs2 + '">' + (rTotals.duels > 0 ? '+' : '') + rTotals.duels + '</td>';
      html += '<td style="' + fs2 + '">' + (overallAvg > 0 ? '+' : '') + overallAvg + '</td>';
      html += '</tr></tfoot></table></div>';
    }
    html += '</div>';
    html += '</div>'; // end flex row

    // ── Weekly Breakdown Table ──
    if (d.weeklyOverview && d.weeklyOverview.length > 0) {
      html += '<h3 style="font-size:13px;font-weight:600;color:#5f6368;margin:24px 0 8px;">Weekly Breakdown (Before Data)</h3>';
      html += '<button class="export-btn" onclick="exportTableCsv(\'weekly-overview-table\',\'weekly-overview\')">&#x2913; Export CSV</button>';
      html += '<div style="max-height:400px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;">';
      html += '<table class="stats-table" id="weekly-overview-table" style="border:none;border-radius:0;box-shadow:none;border-collapse:separate;border-spacing:0;">';
      html += '<thead><tr>';
      html += '<th style="' + thStyle + '">Week</th>';
      html += '<th style="' + thStyle + '">Total</th>';
      html += '<th style="' + thStyle + 'color:#d93025;">&lt;20</th>';
      html += '<th style="' + thStyle + 'color:#c62828;">20-30</th>';
      html += '<th style="' + thStyle + 'color:#e65100;">30-40</th>';
      html += '<th style="' + thStyle + 'color:#f9ab00;">40-60</th>';
      html += '<th style="' + thStyle + 'color:#ff8f00;">60-80</th>';
      html += '<th style="' + thStyle + 'color:#34a853;">80-100</th>';
      html += '<th style="' + thStyle + 'color:#1a73e8;">100+</th>';
      html += '</tr></thead><tbody>';

      var wTotals = { parts:0, u20:0, f20:0, f30:0, f40:0, f60:0, f80:0, o100:0 };
      d.weeklyOverview.forEach(function(w) {
        wTotals.parts += w.totalParts;
        wTotals.u20  += w.under20;
        wTotals.f20  += w.from20to30;
        wTotals.f30  += w.from30to40;
        wTotals.f40  += w.from40to60;
        wTotals.f60  += w.from60to80;
        wTotals.f80  += w.from80to100;
        wTotals.o100 += w.over100;

        function cc(v, clr) { return v > 0 ? ' style="color:'+clr+';font-weight:600;"' : ''; }
        html += '<tr>';
        html += '<td>' + esc(w.week) + '</td>';
        html += '<td>' + w.totalParts + '</td>';
        html += '<td' + cc(w.under20,'#d93025') + '>' + w.under20 + '</td>';
        html += '<td' + cc(w.from20to30,'#c62828') + '>' + w.from20to30 + '</td>';
        html += '<td' + cc(w.from30to40,'#e65100') + '>' + w.from30to40 + '</td>';
        html += '<td' + cc(w.from40to60,'#f9ab00') + '>' + w.from40to60 + '</td>';
        html += '<td' + cc(w.from60to80,'#ff8f00') + '>' + w.from60to80 + '</td>';
        html += '<td' + cc(w.from80to100,'#34a853') + '>' + w.from80to100 + '</td>';
        html += '<td' + cc(w.over100,'#1a73e8') + '>' + w.over100 + '</td>';
        html += '</tr>';
      });

      var wf = 'background:#e8f0fe;font-weight:700;color:#1a73e8;position:sticky;bottom:0;z-index:2;';
      html += '</tbody><tfoot><tr>';
      html += '<td style="' + wf + '">Total</td>';
      html += '<td style="' + wf + '">' + wTotals.parts + '</td>';
      html += '<td style="' + wf + '">' + wTotals.u20 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.f20 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.f30 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.f40 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.f60 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.f80 + '</td>';
      html += '<td style="' + wf + '">' + wTotals.o100 + '</td>';
      html += '</tr></tfoot></table></div>';
    }

    // ── Full-width: Per-Part Detail ──
    if (d.reviewCollectorSummary.length > 0) {
      html += '<h3 style="font-size:13px;font-weight:600;color:#5f6368;margin:24px 0 8px;">Per-Part Detail</h3>';
      html += '<button class="export-btn" onclick="exportTableCsv(\'review-detail-table\',\'reviewed-parts-detail\')">&#x2913; Export CSV</button>';
      html += '<div style="max-height:500px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;">';
      html += '<table class="stats-table" id="review-detail-table" style="border:none;border-radius:0;box-shadow:none;border-collapse:separate;border-spacing:0;">';
      html += '<thead><tr>';
      html += '<th style="' + thStyle + '">Match ID</th>';
      html += '<th style="' + thStyle + '">Part ID</th>';
      html += '<th style="' + thStyle + '">HR Code</th>';
      html += '<th style="' + thStyle + '">Name</th>';
      html += '<th style="' + thStyle + '">Competition</th>';
      html += '<th style="' + thStyle + '">Before Total</th>';
      html += '<th style="' + thStyle + '">After Total</th>';
      html += '<th style="' + thStyle + '">Diff</th>';
      html += '</tr></thead><tbody>';

      d.reviewedParts.forEach(function(p) {
        var diffColor = p.diff > 0 ? '#34a853' : (p.diff < 0 ? '#d93025' : '#5f6368');
        html += '<tr>';
        html += '<td>' + esc(p.match_id) + '</td>';
        html += '<td>' + esc(p.part_id) + '</td>';
        html += '<td>' + esc(p.hr_code) + '</td>';
        html += '<td>' + esc(p.full_name) + '</td>';
        html += '<td>' + esc(p.competition) + '</td>';
        html += '<td>' + p.beforeTotal + '</td>';
        html += '<td>' + p.afterTotal + '</td>';
        html += '<td style="color:' + diffColor + ';font-weight:600;">' + (p.diff > 0 ? '+' : '') + p.diff + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    panel.innerHTML = html;
    attachSortHandlers(panel);
  });
};

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── CSV Export (all views) ──────────────────────────────────────────────────
window.exportTableCsv = function(tableId, filename) {
  var table = document.getElementById(tableId);
  if (!table) { table = document.querySelector('#' + tableId + ' table') || document.querySelector('[data-export="' + tableId + '"]'); }
  if (!table) return;
  if (table.tagName !== 'TABLE') { table = table.querySelector('table'); }
  if (!table) return;

  var csv = [];
  var rows = table.querySelectorAll('tr');
  rows.forEach(function(row) {
    var cols = [];
    row.querySelectorAll('th, td').forEach(function(cell) {
      var text = cell.innerText.replace(/"/g, '""').replace(/\n/g, ' ');
      var colspan = parseInt(cell.getAttribute('colspan')) || 1;
      cols.push('"' + text + '"');
      for (var c = 1; c < colspan; c++) cols.push('""');
    });
    csv.push(cols.join(','));
  });

  var blob = new Blob(['﻿' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (filename || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Auto-register plugins when Chart.js is available
if (typeof window !== 'undefined') {
  var _waitChart = setInterval(function() {
    if (window.Chart) {
      clearInterval(_waitChart);
      registerCmpPlugin();
    }
  }, 50);
}
