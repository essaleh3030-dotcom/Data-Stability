// pages/api/upload-csv.js — Accepts JSON batch of rows, upserts to Supabase
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

const TABLES = {
  'Base | Before': {
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
    types: { event_match_id: 'int', event_part_id: 'int', tornado_event: 'text', events_count: 'int' },
  },
  'Base | Current': {
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
    types: { event_match_id: 'int', event_part_id: 'int', tornado_event: 'text', events_count: 'int' },
  },
  'Extra | Before': {
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
    types: { event_match_id: 'int', event_part_id: 'int', tornado_event: 'text', events_count: 'int' },
  },
  'Extra | Current': {
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
    types: { event_match_id: 'int', event_part_id: 'int', tornado_event: 'text', events_count: 'int' },
  },
  'matches': {
    columns: ['match_id', 'match_name', 'competition', 'collection_completion'],
    conflictCols: ['match_id'],
    types: { match_id: 'int', match_name: 'text', competition: 'text', collection_completion: 'timestamp' },
  },
  'reviewed_matches': {
    columns: ['match_id', 'part_id', 'code', 'reviewer_name', 'team', 'review_date', 'data_updated'],
    conflictCols: ['match_id', 'part_id'],
    types: { match_id: 'int', part_id: 'int', code: 'text', reviewer_name: 'text', team: 'text', review_date: 'date', data_updated: 'text' },
  },
  'Half Collector': {
    columns: ['matchid', 'partid', 'hr_code', 'full_name'],
    conflictCols: ['matchid', 'partid', 'hr_code'],
    types: { matchid: 'int', partid: 'int', hr_code: 'text', full_name: 'text' },
  },
};

function coerce(value, type) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (type === 'int') {
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  if (type === 'float') {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  if (type === 'date' || type === 'timestamp') {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var' });
  }

  try {
    const { table: tableName, rows } = req.body || {};

    if (!tableName || !TABLES[tableName]) {
      return res.status(400).json({ error: 'Invalid table name: ' + tableName });
    }
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'No rows provided' });
    }

    const schema = TABLES[tableName];

    // Validate headers from first row
    const headers = Object.keys(rows[0]);
    const missing = schema.columns.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`,
      });
    }

    // Coerce types + filter columns
    const cleaned = rows.map((r) => {
      const o = {};
      for (const col of schema.columns) {
        o[col] = coerce(r[col], schema.types[col]);
      }
      return o;
    });

    // De-dupe within this batch
    const seen = new Set();
    const deduped = [];
    for (const r of cleaned) {
      const key = schema.conflictCols.map((c) => String(r[c])).join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    const skippedInBatch = cleaned.length - deduped.length;

    // Upsert to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error, count } = await supabase
      .from(tableName)
      .upsert(deduped, {
        onConflict: schema.conflictCols.join(','),
        ignoreDuplicates: true,
        count: 'exact',
      });

    if (error) {
      return res.status(500).json({ error: 'Supabase: ' + error.message, received: rows.length });
    }

    res.status(200).json({
      received: rows.length,
      deduped: deduped.length,
      skippedInBatch,
      upserted: count ?? deduped.length,
    });
  } catch (err) {
    console.error('upload-csv error:', err);
    res.status(500).json({ error: err.message });
  }
}
