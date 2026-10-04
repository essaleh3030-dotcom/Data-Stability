// pages/api/collectors.js — Reads from Supabase (Half Collector + dashboard_before + reviewed_matches + dashboard_current)
import { createClient } from '@supabase/supabase-js';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 120_000;

function weekStart(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
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

    const [collRows, bRows, revRows, aRows] = await Promise.all([
      fetchAll(supabase, 'Half Collector'),
      fetchAll(supabase, 'dashboard_before'),
      fetchAll(supabase, 'reviewed_matches'),
      fetchAll(supabase, 'dashboard_current'),
    ]);

    // Join collectors with before data
    const beforeData = {};
    for (const r of bRows) {
      const key = `${r.match_id}_${r.part_id}`;
      beforeData[key] = {
        total: Number(r.total_duels) || 0,
        competition: String(r.competition || '').trim(),
        date: r.collection_completion ? new Date(r.collection_completion).toISOString().slice(0, 10) : null,
      };
    }

    const assignments = {};
    for (const r of collRows) {
      const key = `${r.matchid}_${r.partid}`;
      const bd = beforeData[key];
      assignments[key] = {
        hr_code: String(r.hr_code || '').trim(),
        full_name: String(r.full_name || '').trim(),
        week: bd && bd.date ? weekStart(bd.date) : null,
        date: bd ? bd.date : null,
      };
    }

    // Reviewed keys (data_updated = Yes)
    const reviewedKeys = {};
    for (const r of revRows) {
      const upd = String(r.data_updated || '').trim().toLowerCase();
      if (upd === 'yes' || upd === 'true' || upd === '1') {
        reviewedKeys[`${r.match_id}_${r.part_id}`] = true;
      }
    }

    // After data for reviewed parts
    const afterData = {};
    for (const r of aRows) {
      const key = `${r.match_id}_${r.part_id}`;
      if (!reviewedKeys[key]) continue;
      afterData[key] = { total: Number(r.total_duels) || 0 };
    }

    // Build Collector Parts Overview
    const collectorMap = {};
    for (const [key, assign] of Object.entries(assignments)) {
      const before = beforeData[key];
      if (!before) continue;
      if (!assign.hr_code) continue;

      if (!collectorMap[assign.hr_code]) {
        collectorMap[assign.hr_code] = {
          hr_code: assign.hr_code,
          full_name: assign.full_name,
          totalParts: 0,
          under20: 0, from20to30: 0, from30to40: 0, from40to50: 0,
          from50to60: 0, from60to80: 0, from80to100: 0, over100: 0,
          parts: [],
        };
      }
      const c = collectorMap[assign.hr_code];
      c.totalParts++;
      const duels = before.total;
      if (duels < 20) c.under20++;
      else if (duels < 30) c.from20to30++;
      else if (duels < 40) c.from30to40++;
      else if (duels < 50) c.from40to50++;
      else if (duels < 60) c.from50to60++;
      else if (duels <= 80) c.from60to80++;
      else if (duels <= 100) c.from80to100++;
      else c.over100++;

      c.parts.push({
        match_id: key.split('_')[0],
        part_id: key.split('_')[1],
        total_duels: duels,
        competition: before.competition,
        week: assign.week,
      });
    }
    const collectorsOverview = Object.values(collectorMap).sort((a, b) => b.totalParts - a.totalParts);

    // Weekly overview
    const weekMap = {};
    for (const [key, assign] of Object.entries(assignments)) {
      const before = beforeData[key];
      if (!before) continue;
      const w = assign.week || 'Unknown';
      if (!weekMap[w]) {
        weekMap[w] = { week: w, totalParts: 0, under20: 0, from20to30: 0, from30to40: 0, from40to50: 0, from50to60: 0, from60to80: 0, from80to100: 0, over100: 0 };
      }
      const wk = weekMap[w];
      wk.totalParts++;
      const duels = before.total;
      if (duels < 20) wk.under20++;
      else if (duels < 30) wk.from20to30++;
      else if (duels < 40) wk.from30to40++;
      else if (duels < 50) wk.from40to50++;
      else if (duels < 60) wk.from50to60++;
      else if (duels <= 80) wk.from60to80++;
      else if (duels <= 100) wk.from80to100++;
      else wk.over100++;
    }
    const weeklyOverview = Object.values(weekMap).sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));

    // Reviewed Duels Added
    const reviewedParts = [];
    const reviewCollectorMap = {};
    for (const key of Object.keys(reviewedKeys)) {
      const assign = assignments[key];
      if (!assign) continue;
      const before = beforeData[key];
      const after = afterData[key];
      if (!before) continue;

      const beforeTotal = before.total;
      const afterTotal = after ? after.total : beforeTotal;
      const diff = afterTotal - beforeTotal;

      reviewedParts.push({
        match_id: key.split('_')[0],
        part_id: key.split('_')[1],
        hr_code: assign.hr_code,
        full_name: assign.full_name,
        competition: before.competition,
        week: assign.week,
        date: assign.date,
        beforeTotal, afterTotal, diff,
      });

      if (!reviewCollectorMap[assign.hr_code]) {
        reviewCollectorMap[assign.hr_code] = {
          hr_code: assign.hr_code,
          full_name: assign.full_name,
          reviewedParts: 0,
          totalDuelsAdded: 0,
        };
      }
      const rc = reviewCollectorMap[assign.hr_code];
      rc.reviewedParts++;
      rc.totalDuelsAdded += diff;
    }

    const reviewCollectorSummary = Object.values(reviewCollectorMap)
      .map((c) => ({
        ...c,
        avgDuelsAdded: c.reviewedParts > 0 ? Math.round(c.totalDuelsAdded / c.reviewedParts * 10) / 10 : 0,
      }))
      .sort((a, b) => b.reviewedParts - a.reviewedParts);

    const result = {
      collectorsOverview,
      weeklyOverview,
      reviewedParts: reviewedParts.sort((a, b) => {
        if (a.hr_code !== b.hr_code) return a.hr_code.localeCompare(b.hr_code);
        return a.match_id.localeCompare(b.match_id);
      }),
      reviewCollectorSummary,
      totalAssignedParts: Object.keys(assignments).length,
      totalMatchedParts: collectorsOverview.reduce((s, c) => s + c.totalParts, 0),
      totalReviewedParts: reviewedParts.length,
    };

    _cache = result;
    _cacheTime = Date.now();
    res.status(200).json(result);
  } catch (err) {
    console.error('collectors API error:', err);
    res.status(500).json({ error: err.message });
  }
}
