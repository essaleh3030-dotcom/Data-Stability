// pages/api/data.js — Reads from Supabase (dashboard_current view) instead of Google Sheets
import { createClient } from '@supabase/supabase-js';

const EVENT_COLS = [
  'dribble', 'fifty-fifty', 'hold-up-duel', 'leg-stretch-duel',
  'positioning-duel', 'separation-duel', 'shield', 'tackle',
  'aerial_won', 'step-in',
];

const EXCLUDE_MATCHES = { '1523381': true };

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

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

    // Paginate through dashboard_current view
    const all = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('dashboard_current')
        .select('*')
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: 'Supabase: ' + error.message });
      if (!data || !data.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const rows = [];
    for (const r of all) {
      const comp = String(r.competition || '').trim();
      if (!comp) continue;
      const mid = String(r.match_id ?? '');
      if (EXCLUDE_MATCHES[mid]) continue;

      const dv = r.collection_completion;
      if (!dv) continue;
      const date = new Date(dv);
      if (!date || isNaN(date.getTime())) continue;

      const y = date.getUTCFullYear();
      const m = date.getUTCMonth() + 1;
      const d = date.getUTCDate();
      const pad = (n) => String(n).padStart(2, '0');

      const events = {};
      EVENT_COLS.forEach((e) => { events[e] = Number(r[e]) || 0; });

      rows.push({
        match_id: mid,
        competition: comp,
        y, m, d,
        dateStr: `${y}-${pad(m)}-${pad(d)}`,
        events,
        total_duels: Number(r.total_duels) || 0,
      });
    }

    const result = {
      rows,
      eventCols: EVENT_COLS,
      debug: {
        source: 'supabase:dashboard_current',
        rowCount: rows.length,
        rawCount: all.length,
        missingEventCols: [],
        hasTotalCol: true,
      },
    };

    _cache = result;
    _cacheTime = Date.now();
    res.status(200).json(result);
  } catch (err) {
    console.error('data API error:', err);
    res.status(500).json({ error: err.message });
  }
}
