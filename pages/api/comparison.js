// pages/api/comparison.js — Reads from Supabase (dashboard_before + dashboard_current + reviewed_matches)
import { createClient } from '@supabase/supabase-js';

const EVENT_COLS = [
  'dribble', 'fifty-fifty', 'hold-up-duel', 'leg-stretch-duel',
  'positioning-duel', 'separation-duel', 'shield', 'tackle',
  'aerial_won', 'step-in',
];

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 120_000;

function parseDate(dv) {
  if (!dv) return null;
  const d = new Date(dv);
  return isNaN(d.getTime()) ? null : d;
}

function weekKey(date) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() - d.getDay()); // Sunday start
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function fetchAll(supabase, table) {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(_cache);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [revRows, bRows, aRows] = await Promise.all([
      fetchAll(supabase, 'reviewed_matches'),
      fetchAll(supabase, 'dashboard_before'),
      fetchAll(supabase, 'dashboard_current'),
    ]);

    // Only reviewed where data_updated = Yes
    const reviewedKeys = {};
    for (const r of revRows) {
      const upd = String(r.data_updated || '').trim().toLowerCase();
      if (upd === 'yes' || upd === 'true' || upd === '1') {
        reviewedKeys[`${r.match_id}_${r.part_id}`] = true;
      }
    }

    const reviewedCount = Object.keys(reviewedKeys).length;
    if (reviewedCount === 0) {
      return res.status(200).json({ error: 'No reviewed matches found (Data Updated = Yes).' });
    }

    // Build before/after lookups keyed by match_id_part_id, restricted to reviewed
    const beforeData = {};
    for (const r of bRows) {
      const key = `${r.match_id}_${r.part_id}`;
      if (!reviewedKeys[key]) continue;
      const date = parseDate(r.collection_completion);
      if (!date) continue;
      const evts = {};
      EVENT_COLS.forEach((e) => { evts[e] = Number(r[e]) || 0; });
      beforeData[key] = {
        date,
        total: Number(r.total_duels) || 0,
        events: evts,
        competition: String(r.competition || '').trim(),
      };
    }

    const afterData = {};
    for (const r of aRows) {
      const key = `${r.match_id}_${r.part_id}`;
      if (!reviewedKeys[key]) continue;
      const date = parseDate(r.collection_completion);
      const evts = {};
      EVENT_COLS.forEach((e) => { evts[e] = Number(r[e]) || 0; });
      afterData[key] = {
        date,
        total: Number(r.total_duels) || 0,
        events: evts,
      };
    }

    // Build weekly + part detail
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

    // Competition summary
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
    console.error('comparison API error:', err);
    res.status(500).json({ error: err.message });
  }
}
