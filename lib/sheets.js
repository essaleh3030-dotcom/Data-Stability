// lib/sheets.js — Google Sheets API client (service account auth)
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let _auth = null;

function getAuth() {
  if (_auth) return _auth;

  let credentials;

  // Option A: inline JSON from env var
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }
  // Option B: path to key file
  else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    const keyPath = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
    credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } else {
    throw new Error(
      'Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env'
    );
  }

  _auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return _auth;
}

/**
 * Read all values from a sheet tab.
 * @param {string} spreadsheetId
 * @param {string} sheetName  — tab name, or empty to read the first sheet
 * @returns {Promise<string[][]>} 2D array of cell values (strings)
 */
async function getSheetValues(spreadsheetId, sheetName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // If no sheet name, get metadata first to find the first sheet
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    sheetName = meta.data.sheets[0].properties.title;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });

  return res.data.values || [];
}

/**
 * Get spreadsheet metadata (sheet names).
 */
async function getSpreadsheetMeta(spreadsheetId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data;
}

/**
 * Find the best "data" sheet by scoring header matches.
 */
async function findDataSheet(spreadsheetId, eventCols) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheetNames = meta.sheets.map((s) => s.properties.title);
  const auth = getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  function norm(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');
  }
  const wantEvents = eventCols.map(norm);

  let best = null;
  let bestScore = -1;

  for (const name of sheetNames) {
    // Read just the first row
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${name}'!1:1`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const headers = (res.data.values || [[]])[0].map(norm);
    if (!headers.includes('competition') || !headers.includes('collection_completion')) continue;

    let score = 0;
    wantEvents.forEach((e) => { if (headers.includes(e)) score++; });
    if (headers.includes('total_duels')) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/**
 * Find "Dashboard" sheet by name (case-insensitive).
 */
async function findDashboardSheet(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheet = meta.sheets.find(
    (s) => s.properties.title.toLowerCase() === 'dashboard'
  );
  return sheet ? sheet.properties.title : null;
}

module.exports = {
  getSheetValues,
  getSpreadsheetMeta,
  findDataSheet,
  findDashboardSheet,
};
