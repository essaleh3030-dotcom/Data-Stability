# Duels Dashboard — Next.js + Google Sheets API

Standalone version of the Duels Dashboard, migrated from Google Apps Script to Next.js for faster performance.

## Setup Steps

### 1. Create a Google Cloud Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable
4. Create a Service Account: IAM & Admin → Service Accounts → Create
5. Download the JSON key file
6. **Share both spreadsheets with the service account email** (the `client_email` in the JSON file) — give it "Viewer" access

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Then either:
- **Option A** (local dev): Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account-key.json` and place the downloaded JSON key in the project root
- **Option B** (Vercel deploy): Set `GOOGLE_SERVICE_ACCOUNT_KEY` to the full JSON content (paste the entire file as one line)

### 3. Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 4. Deploy to Vercel

```bash
npx vercel
```

Or connect the GitHub repo to Vercel. Set these environment variables in Vercel dashboard:

- `GOOGLE_SERVICE_ACCOUNT_KEY` — the full JSON key content
- `BEFORE_SHEET_ID` — `1ryJmYnG7lJOYpgSiS1_gp9FFn-lMun3OokK2Okb_lnc`
- `AFTER_SHEET_ID` — `1CfxZXaRCuxpnawnlIdqyzRnlFcuI7_ncPtCSUamTpLo`

## Architecture

```
pages/
  index.js          — React wrapper that loads the dashboard HTML + JS
  api/
    data.js         — /api/data endpoint (replaces getData() in Code.gs)
    comparison.js   — /api/comparison endpoint (replaces getComparisonData())
lib/
  sheets.js         — Google Sheets API client (service account auth)
public/
  dashboard.js      — All client-side chart/table/filter logic (vanilla JS)
```

The API routes include a short in-memory cache (1-2 minutes) so repeated page loads don't hit the Sheets API every time.

## What Changed from Apps Script

| Before (Apps Script) | After (Next.js) |
|---|---|
| `google.script.run.getData()` | `fetch('/api/data')` |
| `google.script.run.getComparisonData()` | `fetch('/api/comparison')` |
| `SpreadsheetApp.openById()` | Google Sheets API v4 via `googleapis` npm package |
| HtmlService serves the page | Next.js serves the page (much faster) |
| No caching | API responses cached in-memory for 1-2 min |
| Cold start ~3-5s | Vercel cold start ~200ms |
