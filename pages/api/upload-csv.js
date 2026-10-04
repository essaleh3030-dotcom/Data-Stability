// pages/api/upload-csv.js — CSV upload handler
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import Papa from 'papaparse';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false, // formidable handles multipart/form-data
  },
};

// Table definitions (must match pages/upload.js)
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
    // Accept ISO strings or common formats; return null on invalid
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return s;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 }); // 20 MB
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var' });
  }

  try {
    const { fields, files } = await parseForm(req);
    const tableName = Array.isArray(fields.table) ? fields.table[0] : fields.table;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!tableName || !TABLES[tableName]) {
      return res.status(400).json({ error: 'Invalid table name: ' + tableName });
    }
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const schema = TABLES[tableName];
    const csvText = fs.readFileSync(file.filepath, 'utf8');

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors.length > 0) {
      console.error('CSV parse errors:', parsed.errors.slice(0, 3));
    }

    const rows = parsed.data;
    if (!rows.length) {
      return res.status(400).json({ error: 'CSV has no data rows' });
    }

    // Validate headers
    const headers = parsed.meta.fields || [];
    const missing = schema.columns.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `CSV missing required columns: ${missing.join(', ')}. Found headers: ${headers.join(', ')}`,
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

    // De-dupe within the CSV itself (based on conflict keys)
    const seen = new Set();
    const deduped = [];
    for (const r of cleaned) {
      const key = schema.conflictCols.map((c) => String(r[c])).join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    const skippedInCsv = cleaned.length - deduped.length;

    // Upsert in batches of 500 to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let upserted = 0;
    let errors = 0;
    const errorMessages = [];
    const BATCH = 500;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH);
      const { error, count } = await supabase
        .from(tableName)
        .upsert(batch, {
          onConflict: schema.conflictCols.join(','),
          ignoreDuplicates: true, // skip if conflict (don't update)
          count: 'exact',
        });
      if (error) {
        errors += batch.length;
        if (errorMessages.length < 3) errorMessages.push(error.message);
      } else {
        upserted += (count ?? batch.length);
      }
    }

    res.status(200).json({
      table: tableName,
      parsed: rows.length,
      deduped_in_csv: deduped.length,
      skipped: skippedInCsv,
      upserted,
      errors,
      errorMessages: errorMessages.length ? errorMessages : undefined,
    });
  } catch (err) {
    console.error('upload-csv error:', err);
    res.status(500).json({ error: err.message });
  }
}
