// pages/api/data.js — replaces getData() from Code.gs
import { getSheetValues, findDataSheet } from '../../lib/sheets';

const EVENT_COLS = [
  'dribble', 'fifty-fifty', 'hold-up-duel', 'leg-stretch-duel',
  'positioning-duel', 'separation-duel', 'shield', 'tackle',
  'aerial_won', 'step-in',
];

// In-memory cache (survives across requests in the same serverless instance)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

export default async function handler(req, res) {
  // Allow GET only
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Serve from cache if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(_cache);
  }

  try {
    const ssId = process.env.AFTER_SHEET_ID;
    if (!ssId) return res.status(500).json({ error: 'AFTER_SHEET_ID not configured' });

    const sheetName = await findDataSheet(ssId, EVENT_COLS);
    if (!sheetName) return res.status(404).json({ error: 'Data sheet not found.' });

    const values = await getSheetValues(ssId, sheetName);
    if (!values.length) return res.status(404).json({ error: 'Sheet is empty.' });

    const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');
    const headers = values[0].map(norm);
    const idx = (n) => headers.indexOf(norm(n));

    const matchIdIdx = idx('match_id');
    const compIdx = idx('competition');
    const dateIdx = idx('collection_completion');
    const totalIdx = idx('total_duels');
    const eventIdxs = EVENT_COLS.map((e) => idx(e));

    if (compIdx < 0 || dateIdx < 0) {
      return res.status(400).json({
        error: `Required columns not found.\nSheet: "${sheetName}"\nHeaders: ${headers.join(' | ')}`,
      });
    }

    const missing = [];
    EVENT_COLS.forEach((e, j) => { if (eventIdxs[j] < 0) missing.push(e); });

    const EXCLUDE_MATCHES = { '1523381': true };

    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const comp = String(row[compIdx] || '').trim();
      if (!comp) continue;
      const mid = matchIdIdx >= 0 ? String(row[matchIdIdx] ?? '') : '';
      if (EXCLUDE_MATCHES[mid]) continue;

      const dv = row[dateIdx];
      let date;
      if (typeof dv === 'number') {
        // Excel serial date → JS Date
        date = new Date(Math.round((dv - 25569) * 86400 * 1000));
      } else {
        date = new Date(String(dv));
      }
      if (!date || isNaN(date.getTime())) continue;

      const y = date.getUTCFullYear();
      const m = date.getUTCMonth() + 1;
      const d = date.getUTCDate();
      const pad = (n) => String(n).padStart(2, '0');

      const events = {};
      EVENT_COLS.forEach((e, j) => {
        events[e] = Number(row[eventIdxs[j]]) || 0;
      });

      rows.push({
        match_id: mid,
        competition: comp,
        y, m, d,
        dateStr: `${y}-${pad(m)}-${pad(d)}`,
        events,
        total_duels: totalIdx >= 0 ? (Number(row[totalIdx]) || 0) : 0,
      });
    }

    const result = {
      rows,
      eventCols: EVENT_COLS,
      debug: {
        sheet: sheetName,
        headers,
        rowCount: rows.length,
        missingEventCols: missing,
        hasTotalCol: totalIdx >= 0,
      },
    };

    // Cache
    _cache = result;
    _cacheTime = Date.now();

    res.status(200).json(result);
  } catch (err) {
    console.error('getData error:', err);
    res.status(500).json({ error: err.message });
  }
}
