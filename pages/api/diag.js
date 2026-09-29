// pages/api/diag.js — Per-call timeout diagnostic
import { getSheetValues, findDashboardSheet } from '../../lib/sheets';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms`)), ms)),
  ]);
}

async function timed(name, fn, timeoutMs = 6000) {
  const t0 = Date.now();
  try {
    const result = await withTimeout(fn(), timeoutMs, name);
    const ms = Date.now() - t0;
    return { name, ms, ok: true, rows: Array.isArray(result) ? result.length : String(result).slice(0, 100) };
  } catch (e) {
    const ms = Date.now() - t0;
    return { name, ms, ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  const BEFORE_ID = process.env.BEFORE_SHEET_ID;
  const AFTER_ID = process.env.AFTER_SHEET_ID;
  const ASSIGN_ID = process.env.ASSIGNMENTS_SHEET_ID;

  const t0 = Date.now();

  // Run all 4 calls in parallel — each has its own 6s timeout
  const tests = await Promise.all([
    timed('assignments', () => getSheetValues(ASSIGN_ID, '')),
    timed('before-dashname', () => findDashboardSheet(BEFORE_ID)),
    timed('before-reviewed', () => getSheetValues(BEFORE_ID, 'Reviewed Matches')),
    timed('after-dashname', () => findDashboardSheet(AFTER_ID)),
  ]);

  res.status(200).json({
    env: {
      BEFORE_ID: BEFORE_ID ? BEFORE_ID.slice(0, 10) + '...' : 'MISSING',
      AFTER_ID: AFTER_ID ? AFTER_ID.slice(0, 10) + '...' : 'MISSING',
      ASSIGN_ID: ASSIGN_ID ? ASSIGN_ID.slice(0, 10) + '...' : 'MISSING',
      HAS_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    },
    totalMs: Date.now() - t0,
    tests,
  });
}
