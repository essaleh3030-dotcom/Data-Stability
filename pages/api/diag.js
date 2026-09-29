// pages/api/diag.js — Diagnostic endpoint to test each Google Sheets call
import { getSheetValues, findDashboardSheet } from '../../lib/sheets';

export default async function handler(req, res) {
  const BEFORE_ID = process.env.BEFORE_SHEET_ID;
  const AFTER_ID = process.env.AFTER_SHEET_ID;
  const ASSIGN_ID = process.env.ASSIGNMENTS_SHEET_ID;

  const results = {
    env: {
      BEFORE_ID: BEFORE_ID ? BEFORE_ID.slice(0, 8) + '...' : 'MISSING',
      AFTER_ID: AFTER_ID ? AFTER_ID.slice(0, 8) + '...' : 'MISSING',
      ASSIGN_ID: ASSIGN_ID ? ASSIGN_ID.slice(0, 8) + '...' : 'MISSING',
    },
    tests: [],
  };

  async function timed(name, fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const ms = Date.now() - t0;
      results.tests.push({ name, ms, ok: true, rows: Array.isArray(result) ? result.length : String(result).slice(0, 100) });
    } catch (e) {
      const ms = Date.now() - t0;
      results.tests.push({ name, ms, ok: false, error: e.message });
    }
  }

  const t0 = Date.now();

  if (req.query.mode === 'parallel') {
    // Run all in parallel
    await Promise.all([
      timed('assignments', () => getSheetValues(ASSIGN_ID, '')),
      timed('before-dashname', () => findDashboardSheet(BEFORE_ID)),
      timed('before-reviewed', () => getSheetValues(BEFORE_ID, 'Reviewed Matches')),
      timed('after-dashname', () => findDashboardSheet(AFTER_ID)),
    ]);
  } else {
    // Run sequentially
    await timed('assignments', () => getSheetValues(ASSIGN_ID, ''));
    await timed('before-dashname', () => findDashboardSheet(BEFORE_ID));
    await timed('before-reviewed', () => getSheetValues(BEFORE_ID, 'Reviewed Matches'));
    await timed('after-dashname', () => findDashboardSheet(AFTER_ID));
  }

  results.totalMs = Date.now() - t0;
  res.status(200).json(results);
}
