// pages/api/upload-csv.js — Accepts JSON batch of rows, upserts to Supabase
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

const BASE_SCHEMA = {
  columns: ['event_match_id', 'event_part_id', 'tornado_events', 'events_count'],
  conflictCols: ['event_match_id', 'event_part_id', 'tornado_events'],
  types: { event_match_id: 'int', event_part_id: 'int', tornado_events: 'text', events_count: 'int' },
  aliases: {
    event_match_id: ['event_match_id', 'match_id', 'eventmatchid'],
    event_part_id: ['event_part_id', 'part_id', 'eventpartid'],
    tornado_events: ['tornado_events', 'tornado_event', 'event', 'events'],
    events_count: ['events_count', 'events count', 'event_count', 'count'],
  },
};

const EXTRA_SCHEMA = {
  columns: ['event_match_id', 'event_part_id', 'tornado_extras', 'extras counter'],
  conflictCols: ['event_match_id', 'event_part_id', 'tornado_extras'],
  types: { event_match_id: 'int', event_part_id: 'int', tornado_extras: 'text', 'extras counter': 'int' },
  aliases: {
    event_match_id: ['event_match_id', 'match_id', 'eventmatchid'],
    event_part_id: ['event_part_id', 'part_id', 'eventpartid'],
    tornado_extras: ['tornado_extras', 'tornado_event', 'tornado_events', 'extras', 'event'],
    'extras counter': ['extras counter', 'extras_counter', 'events_count', 'events count', 'event_count', 'count'],
  },
};

const TABLES = {
  'Base | Before':   BASE_SCHEMA,
  'Base | Current':  BASE_SCHEMA,
  'Extra | Before':  EXTRA_SCHEMA,
  'Extra | Current': EXTRA_SCHEMA,
  'matches': {
    columns: ['match_id', 'match_name', 'competition', 'collection_completion'],
    conflictCols: ['match_id'],
    types: { match_id: 'int', match_name: 'text', competition: 'text', collection_completion: 'timestamp' },
    aliases: {
      match_id: ['match_id', 'matchid'],
      match_name: ['match_name', 'matchname', 'name'],
      competition: ['competition'],
      collection_completion: ['collection_completion', 'collection completion', 'completion_date'],
    },
  },
  'reviewed_matches': {
    columns: ['match_id', 'part_id', 'code', 'reviewer_name', 'team', 'review_date', 'data_updated'],
    conflictCols: ['match_id', 'part_id'],
    types: { match_id: 'int', part_id: 'int', code: 'text', reviewer_name: 'text', team: 'text', review_date: 'date', data_updated: 'text' },
    aliases: {
      match_id: ['match_id', 'matchid'],
      part_id: ['part_id', 'partid'],
      code: ['code'],
      reviewer_name: ['reviewer_name', 'reviewer name', 'reviewer'],
      team: ['team'],
      review_date: ['review_date', 'review date'],
      data_updated: ['data_updated', 'data updated', 'data_updated?', 'data updated?'],
    },
  },
  'Half Collector': {
    columns: ['matchid', 'partid', 'hr_code', 'full_name'],
    conflictCols: ['matchid', 'partid', 'hr_code'],
    types: { matchid: 'int', partid: 'int', hr_code: 'text', full_name: 'text' },
    aliases: {
      matchid: ['matchid', 'match_id'],
      partid: ['partid', 'part_id'],
      hr_code: ['hr_code', 'hrcode', 'hr code', 'code'],
      full_name: ['full_name', 'full name', 'name'],
    },
  },
};

function normHeader(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s\-_?]+/g, '_').replace(/_+$/g, '');
}

// Build a map { targetCol → actualCsvHeader } for a given row
function buildHeaderMap(schema, csvHeaders) {
  const normalized = {};
  csvHeaders.forEach((h) => { normalized[normHeader(h)] = h; });
  const map = {};
  const missing = [];
  for (const col of schema.columns) {
    const candidates = (schema.aliases && schema.aliases[col]) || [col];
    let found = null;
    for (const cand of candidates) {
      const n = normHeader(cand);
      if (normalized[n]) { found = normalized[n]; break; }
    }
    if (found) map[col] = found;
    else missing.push(col);
  }
  return { map, missing };
}

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

    // Build header map with aliasing (handles plural/space/case variations + ignores extra columns)
    const csvHeaders = Object.keys(rows[0]);
    const { map: headerMap, missing } = buildHeaderMap(schema, csvHeaders);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required columns: ${missing.join(', ')}. Found: ${csvHeaders.join(', ')}`,
      });
    }

    // Coerce types + pick only required columns using the header map
    const cleaned = rows.map((r) => {
      const o = {};
      for (const col of schema.columns) {
        o[col] = coerce(r[headerMap[col]], schema.types[col]);
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
