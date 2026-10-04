// pages/api/refresh-dashboards.js — Refresh materialized views after bulk upload
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const t0 = Date.now();
    const { error } = await supabase.rpc('refresh_dashboards');
    if (error) return res.status(500).json({ error: 'Supabase: ' + error.message });

    res.status(200).json({ ok: true, ms: Date.now() - t0 });
  } catch (err) {
    console.error('refresh error:', err);
    res.status(500).json({ error: err.message });
  }
}
