// pages/api/comparison.js — replaces getComparisonData() from Code.gs
import { getSheetValues, findDashboardSheet } from '../../lib/sheets';

const EVENT_COLS = [
  'dribble', 'fifty-fifty', 'hold-up-duel', 'leg-stretch-duel',
  'positioning-duel', 'separation-duel', 'shield', 'tackle',
  'aerial_won', 'step-in',
];

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 120_000; // 2 minutes (heavier query)

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');
}

function parseDate(dv) {
  if (typeof dv === 'number') return new Date(Math.round((dv - 25569) * 86400 * 1000));
  const d = new Date(String(dv));
  return (!d || isNaN(d.getTime())) ? null : d;
}

function weekKey(date) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() - d.getDay()); // Sunday start
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(_cache);
  }

  try {
    const BEFORE_ID = process.env.BEFORE_SHEET_ID;
    const AFTER_ID = process.env.AFTER_SHEET_ID;
    if (!BEFORE_ID || !AFTER_ID) {
      return res.status(500).json({ error: 'BEFORE_SHEET_ID / AFTER_SHEET_ID not configured' });
    }

    // 1. Read "Reviewed Matches" from Before spreadsheet
    let revVals;
    try {
      revVals = await getSheetValues(BEFORE_ID, 'Reviewed Matches');
    } catch (e) {
      return res.status(500).json({ error: 'Cannot read Reviewed Matches: ' + e.message });
    }

    // Find header row
    let revHeaders = revVals[0]?.map(norm) || [];
    let revHeaderRow = 0;
    for (let r = 0; r < Math.min(revVals.length, 5); r++) {
      const h = revVals[r].map(norm);
      if (h.includes('match_name') || h.includes('data_updated?')) {
        revHeaders = h;
        revHeaderRow = r;
        break;
      }
    }

    let revUpdIdx = revHeaders.indexOf('data_updated?');
    if (revUpdIdx < 0) {
      for (let i = 0; i < revHeaders.length; i++) {
        if (revHeaders[i].includes('data_updated')) { revUpdIdx = i; break; }
      }
    }

    const reviewedKeys = {};
    for (let i = revHeaderRow + 1; i < revVals.length; i++) {
      const mid = String(revVals[i][0] || '').trim();
      const pid = String(revVals[i][1] || '').trim();
      const upd = revUpdIdx >= 0 ? String(revVals[i][revUpdIdx] || '').trim().toLowerCase() : '';
      if (mid && (upd === 'yes' || upd === 'true' || upd === '1')) {
        reviewedKeys[`${mid}_${pid}`] = true;
      }
    }

    const reviewedCount = Object.keys(reviewedKeys).length;
    if (reviewedCount === 0) {
      return res.status(200).json({ error: 'No reviewed matches found (Data Updated = Yes).' });
    }

    // 2. Read Before Dashboard
    const bDashName = await findDashboardSheet(BEFORE_ID);
    if (!bDashName) return res.status(500).json({ error: 'Dashboard not found in Before spreadsheet.' });
    const bVals = await getSheetValues(BEFORE_ID, bDashName);
    const bHeaders = bVals[0].map(norm);

    const bMidIdx = bHeaders.indexOf('match_id');
    const bPidIdx = bHeaders.indexOf('part_id');
    const bDateIdx = bHeaders.indexOf('collection_completion');
    const bTotalIdx = bHeaders.indexOf('total_duels');
    const bCompIdx = bHeaders.indexOf('competition');
    const bEventIdxs = {};
    EVENT_COLS.forEach((e) => { bEventIdxs[e] = bHeaders.indexOf(norm(e)); });

    // 3. Read After Dashboard — find second column set
    const aDashName = await findDashboardSheet(AFTER_ID);
    if (!aDashName) return res.status(500).json({ error: 'Dashboard not found in After spreadsheet.' });
    const aVals = await getSheetValues(AFTER_ID, aDashName);
    const aHeaders = aVals[0].map(norm);

    let aMidIdx2 = -1, aPidIdx2 = -1, aDateIdx2 = -1, aTotalIdx2 = -1;
    const aEventIdxs2 = {};
    let afterStart = -1;
    for (let i = bTotalIdx + 1; i < aHeaders.length; i++) {
      if (aHeaders[i] === 'match_id') { afterStart = i; aMidIdx2 = i; break; }
    }
    if (afterStart >= 0) {
      for (let i = afterStart; i < aHeaders.length; i++) {
        if (aHeaders[i] === 'part_id' && aPidIdx2 < 0) aPidIdx2 = i;
        if (aHeaders[i] === 'collection_completion' && aDateIdx2 < 0) aDateIdx2 = i;
        if (aHeaders[i] === 'total_duels' && aTotalIdx2 < 0) aTotalIdx2 = i;
        EVENT_COLS.forEach((e) => {
          if (aHeaders[i] === norm(e) && !aEventIdxs2[e]) aEventIdxs2[e] = i;
        });
      }
    }

    // 4. Before data lookup
    const beforeData = {};
    for (let i = 1; i < bVals.length; i++) {
      const mid = String(bVals[i][bMidIdx] || '').trim();
      const pid = String(bVals[i][bPidIdx] || '').trim();
      const key = `${mid}_${pid}`;
      if (!reviewedKeys[key]) continue;

      const date = parseDate(bVals[i][bDateIdx]);
      if (!date) continue;

      const evts = {};
      EVENT_COLS.forEach((e) => { evts[e] = Number(bVals[i][bEventIdxs[e]]) || 0; });

      beforeData[key] = {
        date,
        total: Number(bVals[i][bTotalIdx]) || 0,
        events: evts,
        competition: bCompIdx >= 0 ? String(bVals[i][bCompIdx] || '').trim() : '',
      };
    }

    // 5. After data lookup
    const afterData = {};
    if (aMidIdx2 >= 0) {
      for (let i = 1; i < aVals.length; i++) {
        const mid = String(aVals[i][aMidIdx2] || '').trim();
        const pid = String(aVals[i][aPidIdx2] || '').trim();
        const key = `${mid}_${pid}`;
        if (!reviewedKeys[key]) continue;

        const date = parseDate(aVals[i][aDateIdx2 >= 0 ? aDateIdx2 : bDateIdx]);
        const evts = {};
        EVENT_COLS.forEach((e) => { evts[e] = Number(aVals[i][aEventIdxs2[e]]) || 0; });

        afterData[key] = {
          date,
          total: aTotalIdx2 >= 0 ? (Number(aVals[i][aTotalIdx2]) || 0) : 0,
          events: evts,
        };
      }
    }

    // 6. Group by week (Sunday-start), track per-part counts
    const weekMap = {};
    const partDetails = [];

    for (const key of Object.keys(reviewedKeys)) {
      const b = beforeData[key], a = afterData[key];
      if (!b || !a) continue;
      const useDate = a.date || b.date;
      if (!useDate) continue;

      const wk = weekKey(useDate);
      const mid = key.split('_')[0];

      if (!weekMap[wk]) {
        weekMap[wk] = { partCount: 0, bTotal: 0, aTotal: 0, bEvents: {}, aEvents: {}, matchSet: {} };
      }
      const w = weekMap[wk];
      w.partCount++;
      w.matchSet[mid] = true;
      w.bTotal += b.total;
      w.aTotal += a.total;
      EVENT_COLS.forEach((e) => {
        w.bEvents[e] = (w.bEvents[e] || 0) + b.events[e];
        w.aEvents[e] = (w.aEvents[e] || 0) + a.events[e];
      });

      const diffEvts = {};
      EVENT_COLS.forEach((e) => { diffEvts[e] = a.events[e] - b.events[e]; });
      partDetails.push({
        matchId: mid,
        partId: key.split('_')[1],
        week: wk,
        competition: b.competition || '',
        beforeTotal: b.total,
        afterTotal: a.total,
        diff: a.total - b.total,
        beforeEvents: b.events,
        afterEvents: a.events,
        diffEvents: diffEvts,
      });
    }

    // 7. Weekly arrays (averages per PART)
    const weeks = Object.keys(weekMap).sort();
    const labels = [], matchCounts = [], partCounts = [];
    const beforeAvgTotal = [], afterAvgTotal = [];
    const beforeEvents = {}, afterEvents = {};
    EVENT_COLS.forEach((e) => { beforeEvents[e] = []; afterEvents[e] = []; });

    for (const wk of weeks) {
      const w = weekMap[wk];
      const nParts = w.partCount;
      const nMatches = Object.keys(w.matchSet).length;
      labels.push(wk);
      matchCounts.push(nMatches);
      partCounts.push(nParts);
      beforeAvgTotal.push(Math.round(w.bTotal / nParts * 10) / 10);
      afterAvgTotal.push(Math.round(w.aTotal / nParts * 10) / 10);
      EVENT_COLS.forEach((e) => {
        beforeEvents[e].push(Math.round((w.bEvents[e] || 0) / nParts * 10) / 10);
        afterEvents[e].push(Math.round((w.aEvents[e] || 0) / nParts * 10) / 10);
      });
    }

    // 8. Competition summary
    const compMap = {};
    for (const p of partDetails) {
      const c = p.competition || 'Unknown';
      if (!compMap[c]) {
        compMap[c] = { bTotal: 0, aTotal: 0, bEvents: {}, aEvents: {}, partCount: 0, matchSet: {} };
      }
      const cm = compMap[c];
      cm.partCount++;
      cm.matchSet[p.matchId] = true;
      cm.bTotal += p.beforeTotal;
      cm.aTotal += p.afterTotal;
      EVENT_COLS.forEach((e) => {
        cm.bEvents[e] = (cm.bEvents[e] || 0) + (p.beforeEvents[e] || 0);
        cm.aEvents[e] = (cm.aEvents[e] || 0) + (p.afterEvents[e] || 0);
      });
    }

    const competitionData = {};
    for (const c of Object.keys(compMap)) {
      const cm = compMap[c];
      const nP = cm.partCount;
      competitionData[c] = {
        matchCount: Object.keys(cm.matchSet).length,
        partCount: nP,
        bTotal: cm.bTotal,
        aTotal: cm.aTotal,
        bAvg: Math.round(cm.bTotal / nP * 10) / 10,
        aAvg: Math.round(cm.aTotal / nP * 10) / 10,
        bEvents: {},
        aEvents: {},
      };
      EVENT_COLS.forEach((e) => {
        competitionData[c].bEvents[e] = Math.round((cm.bEvents[e] || 0) / nP * 10) / 10;
        competitionData[c].aEvents[e] = Math.round((cm.aEvents[e] || 0) / nP * 10) / 10;
      });
    }

    const uniqueMatches = new Set(
      Object.keys(reviewedKeys).map((k) => k.split('_')[0])
    );

    const result = {
      labels,
      counts: matchCounts,
      partCounts,
      before: { avgTotal: beforeAvgTotal, events: beforeEvents },
      after: { avgTotal: afterAvgTotal, events: afterEvents },
      eventCols: EVENT_COLS,
      partDetails,
      competitionData,
      totalParts: reviewedCount,
      totalMatches: uniqueMatches.size,
    };

    _cache = result;
    _cacheTime = Date.now();

    res.status(200).json(result);
  } catch (err) {
    console.error('getComparisonData error:', err);
    res.status(500).json({ error: err.message });
  }
}
