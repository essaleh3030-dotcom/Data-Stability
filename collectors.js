// pages/api/collectors.js — collector parts overview + reviewed duels added
import { getSheetValues, findDashboardSheet } from '../../lib/sheets';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 120_000; // 2 minutes

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(_cache);
  }

  try {
    const BEFORE_ID = process.env.BEFORE_SHEET_ID;
    const AFTER_ID = process.env.AFTER_SHEET_ID;
    const ASSIGN_ID = process.env.ASSIGNMENTS_SHEET_ID;

    if (!BEFORE_ID || !AFTER_ID || !ASSIGN_ID) {
      return res.status(500).json({ error: 'Missing env vars: BEFORE_SHEET_ID, AFTER_SHEET_ID, or ASSIGNMENTS_SHEET_ID' });
    }

    // 1. Read assignments sheet
    const assignVals = await getSheetValues(ASSIGN_ID, '');
    if (!assignVals.length) return res.status(404).json({ error: 'Assignments sheet is empty' });

    const aHeaders = assignVals[0].map(norm);
    const aMatchIdx = aHeaders.indexOf('matchid');
    const aPartIdx = aHeaders.indexOf('partid');
    const aNameIdx = aHeaders.indexOf('full_name');
    const aHrIdx = aHeaders.indexOf('hr_code');

    if (aMatchIdx < 0 || aPartIdx < 0 || aNameIdx < 0 || aHrIdx < 0) {
      return res.status(400).json({
        error: `Assignments sheet missing required columns. Found: ${aHeaders.join(', ')}`,
      });
    }

    // Build assignments lookup: key = matchId_partId -> { hr_code, full_name }
    const assignments = {};
    for (let i = 1; i < assignVals.length; i++) {
      const row = assignVals[i];
      const mid = String(row[aMatchIdx] || '').trim();
      const pid = String(row[aPartIdx] || '').trim();
      const hrCode = String(row[aHrIdx] || '').trim();
      const fullName = String(row[aNameIdx] || '').trim();
      if (!mid || !pid || !hrCode) continue;
      assignments[`${mid}_${pid}`] = { hr_code: hrCode, full_name: fullName };
    }

    // 2. Read Before Dashboard to get total_duels per part
    const bDashName = await findDashboardSheet(BEFORE_ID);
    if (!bDashName) return res.status(500).json({ error: 'Dashboard not found in Before spreadsheet' });
    const bVals = await getSheetValues(BEFORE_ID, bDashName);
    const bHeaders = bVals[0].map(norm);

    const bMidIdx = bHeaders.indexOf('match_id');
    const bPidIdx = bHeaders.indexOf('part_id');
    const bTotalIdx = bHeaders.indexOf('total_duels');
    const bCompIdx = bHeaders.indexOf('competition');

    // Before data lookup: key = matchId_partId -> { total_duels, competition }
    const beforeData = {};
    for (let i = 1; i < bVals.length; i++) {
      const mid = String(bVals[i][bMidIdx] || '').trim();
      const pid = String(bVals[i][bPidIdx] || '').trim();
      if (!mid || !pid) continue;
      beforeData[`${mid}_${pid}`] = {
        total: bTotalIdx >= 0 ? (Number(bVals[i][bTotalIdx]) || 0) : 0,
        competition: bCompIdx >= 0 ? String(bVals[i][bCompIdx] || '').trim() : '',
      };
    }

    // 3. Read Reviewed Matches from Before spreadsheet
    let revVals;
    try {
      revVals = await getSheetValues(BEFORE_ID, 'Reviewed Matches');
    } catch (e) {
      revVals = [];
    }

    const reviewedKeys = {};
    if (revVals.length) {
      let revHeaders = revVals[0].map(norm);
      let revHeaderRow = 0;
      for (let r = 0; r < Math.min(revVals.length, 5); r++) {
        const h = revVals[r].map(norm);
        if (h.includes('match_name') || h.includes('data_updated?')) {
          revHeaders = h;
          revHeaderRow = r;
          break;
        }
      }
      let revUpdIdx = revHeaders.indexOf('data_updated?');
      if (revUpdIdx < 0) {
        for (let i = 0; i < revHeaders.length; i++) {
          if (revHeaders[i].includes('data_updated')) { revUpdIdx = i; break; }
        }
      }
      for (let i = revHeaderRow + 1; i < revVals.length; i++) {
        const mid = String(revVals[i][0] || '').trim();
        const pid = String(revVals[i][1] || '').trim();
        const upd = revUpdIdx >= 0 ? String(revVals[i][revUpdIdx] || '').trim().toLowerCase() : '';
        if (mid && (upd === 'yes' || upd === 'true' || upd === '1')) {
          reviewedKeys[`${mid}_${pid}`] = true;
        }
      }
    }

    // 4. Read After/Current Dashboard for reviewed parts
    let afterData = {};
    if (Object.keys(reviewedKeys).length > 0) {
      const aDashName = await findDashboardSheet(AFTER_ID);
      if (aDashName) {
        const aVals = await getSheetValues(AFTER_ID, aDashName);
        const aHdrs = aVals[0].map(norm);

        // Find the second column set (after columns R onward)
        let aMidIdx2 = -1, aPidIdx2 = -1, aTotalIdx2 = -1;
        const firstTotalIdx = aHdrs.indexOf('total_duels');
        for (let i = (firstTotalIdx >= 0 ? firstTotalIdx + 1 : 0); i < aHdrs.length; i++) {
          if (aHdrs[i] === 'match_id' && aMidIdx2 < 0) aMidIdx2 = i;
        }
        if (aMidIdx2 >= 0) {
          for (let i = aMidIdx2; i < aHdrs.length; i++) {
            if (aHdrs[i] === 'part_id' && aPidIdx2 < 0) aPidIdx2 = i;
            if (aHdrs[i] === 'total_duels' && aTotalIdx2 < 0) aTotalIdx2 = i;
          }
        }

        if (aMidIdx2 >= 0) {
          for (let i = 1; i < aVals.length; i++) {
            const mid = String(aVals[i][aMidIdx2] || '').trim();
            const pid = String(aVals[i][aPidIdx2] || '').trim();
            const key = `${mid}_${pid}`;
            if (!reviewedKeys[key]) continue;
            afterData[key] = {
              total: aTotalIdx2 >= 0 ? (Number(aVals[i][aTotalIdx2]) || 0) : 0,
            };
          }
        }
      }
    }

    // 5. Build View 1: Collector Parts Overview (Before data only)
    // For each assigned part, get before total_duels and classify into brackets
    const collectorMap = {}; // hr_code -> { full_name, parts: [...], brackets }

    for (const [key, assign] of Object.entries(assignments)) {
      const before = beforeData[key];
      if (!before) continue; // part not in Before dashboard, skip

      if (!collectorMap[assign.hr_code]) {
        collectorMap[assign.hr_code] = {
          hr_code: assign.hr_code,
          full_name: assign.full_name,
          totalParts: 0,
          under60: 0,
          from60to80: 0,
          from80to100: 0,
          over100: 0,
          parts: [],
        };
      }

      const c = collectorMap[assign.hr_code];
      c.totalParts++;

      const duels = before.total;
      if (duels < 60) c.under60++;
      else if (duels <= 80) c.from60to80++;
      else if (duels <= 100) c.from80to100++;
      else c.over100++;

      c.parts.push({
        match_id: key.split('_')[0],
        part_id: key.split('_')[1],
        total_duels: duels,
        competition: before.competition,
      });
    }

    const collectorsOverview = Object.values(collectorMap)
      .sort((a, b) => b.totalParts - a.totalParts);

    // 6. Build View 2: Reviewed Duels Added (Before vs Current)
    const reviewedParts = [];
    const reviewCollectorMap = {}; // hr_code -> { full_name, reviewedParts, totalDuelsAdded, partCount }

    for (const key of Object.keys(reviewedKeys)) {
      const assign = assignments[key];
      if (!assign) continue; // reviewed part not in assignments
      const before = beforeData[key];
      const after = afterData[key];
      if (!before) continue;

      const beforeTotal = before.total;
      const afterTotal = after ? after.total : beforeTotal;
      const diff = afterTotal - beforeTotal;

      reviewedParts.push({
        match_id: key.split('_')[0],
        part_id: key.split('_')[1],
        hr_code: assign.hr_code,
        full_name: assign.full_name,
        competition: before.competition,
        beforeTotal,
        afterTotal,
        diff,
      });

      if (!reviewCollectorMap[assign.hr_code]) {
        reviewCollectorMap[assign.hr_code] = {
          hr_code: assign.hr_code,
          full_name: assign.full_name,
          reviewedParts: 0,
          totalDuelsAdded: 0,
        };
      }
      const rc = reviewCollectorMap[assign.hr_code];
      rc.reviewedParts++;
      rc.totalDuelsAdded += diff;
    }

    // Compute average duels added per part
    const reviewCollectorSummary = Object.values(reviewCollectorMap)
      .map((c) => ({
        ...c,
        avgDuelsAdded: c.reviewedParts > 0
          ? Math.round(c.totalDuelsAdded / c.reviewedParts * 10) / 10
          : 0,
      }))
      .sort((a, b) => b.reviewedParts - a.reviewedParts);

    const result = {
      collectorsOverview,
      reviewedParts: reviewedParts.sort((a, b) => {
        if (a.hr_code !== b.hr_code) return a.hr_code.localeCompare(b.hr_code);
        return a.match_id.localeCompare(b.match_id);
      }),
      reviewCollectorSummary,
      totalAssignedParts: Object.keys(assignments).length,
      totalMatchedParts: collectorsOverview.reduce((s, c) => s + c.totalParts, 0),
      totalReviewedParts: reviewedParts.length,
    };

    _cache = result;
    _cacheTime = Date.now();
    res.status(200).json(result);
  } catch (err) {
    console.error('collectors API error:', err);
    res.status(500).json({ error: err.message });
  }
}
