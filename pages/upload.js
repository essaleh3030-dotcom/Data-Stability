// pages/upload.js — CSV Uploader page
import { useState } from 'react';

const TABLES = [
  {
    id: 'Base | Before',
    label: 'Base | Before',
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
  },
  {
    id: 'Base | Current',
    label: 'Base | Current',
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
  },
  {
    id: 'Extra | Before',
    label: 'Extra | Before',
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
  },
  {
    id: 'Extra | Current',
    label: 'Extra | Current',
    columns: ['event_match_id', 'event_part_id', 'tornado_event', 'events_count'],
    conflictCols: ['event_match_id', 'event_part_id', 'tornado_event'],
  },
  {
    id: 'matches',
    label: 'Matches',
    columns: ['match_id', 'match_name', 'competition', 'collection_completion'],
    conflictCols: ['match_id'],
  },
  {
    id: 'reviewed_matches',
    label: 'Reviewed Matches',
    columns: ['match_id', 'part_id', 'code', 'reviewer_name', 'team', 'review_date', 'data_updated'],
    conflictCols: ['match_id', 'part_id'],
  },
  {
    id: 'Half Collector',
    label: 'Half Collector',
    columns: ['matchid', 'partid', 'hr_code', 'full_name'],
    conflictCols: ['matchid', 'partid', 'hr_code'],
  },
];

export default function Upload() {
  const [selectedTable, setSelectedTable] = useState(TABLES[0].id);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const current = TABLES.find((t) => t.id === selectedTable);

  async function handleUpload() {
    if (!file) {
      setStatus('⚠️ Please choose a CSV file first.');
      return;
    }
    setBusy(true);
    setStatus('Uploading…');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('table', selectedTable);
      const res = await fetch('/api/upload-csv', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setStatus('❌ Error: ' + (data.error || res.status));
      } else {
        setStatus(`✅ Done.`);
        setResult(data);
      }
    } catch (e) {
      setStatus('❌ Error: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 720, margin: '40px auto', padding: 20 }}>
      <h1 style={{ marginBottom: 8 }}>CSV Uploader</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Pick a table, upload a CSV. Duplicates (based on key columns) are skipped automatically.
      </p>

      <label style={{ display: 'block', marginTop: 24, fontWeight: 'bold' }}>Target table</label>
      <select
        value={selectedTable}
        onChange={(e) => setSelectedTable(e.target.value)}
        disabled={busy}
        style={{ width: '100%', padding: 10, fontSize: 14, marginTop: 6, borderRadius: 6, border: '1px solid #ccc' }}
      >
        {TABLES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      <div style={{ marginTop: 16, padding: 12, background: '#f6f8fa', borderRadius: 6, fontSize: 13 }}>
        <div><strong>Required CSV columns (in any order):</strong></div>
        <div style={{ fontFamily: 'monospace', marginTop: 4 }}>{current.columns.join(', ')}</div>
        <div style={{ marginTop: 8 }}><strong>Dedupe key:</strong></div>
        <div style={{ fontFamily: 'monospace', marginTop: 4 }}>{current.conflictCols.join(' + ')}</div>
      </div>

      <label style={{ display: 'block', marginTop: 24, fontWeight: 'bold' }}>CSV file</label>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={busy}
        style={{ marginTop: 6, display: 'block' }}
      />

      <button
        onClick={handleUpload}
        disabled={busy || !file}
        style={{
          marginTop: 24,
          padding: '12px 24px',
          background: busy ? '#999' : '#1a73e8',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 'bold',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Uploading…' : 'Upload CSV'}
      </button>

      {status && (
        <div style={{ marginTop: 20, padding: 12, background: '#eef', borderRadius: 6 }}>
          {status}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12, padding: 12, background: '#efffef', borderRadius: 6, fontSize: 14 }}>
          <div>📥 Rows parsed: <strong>{result.parsed}</strong></div>
          <div>✅ Rows upserted: <strong>{result.upserted}</strong></div>
          {result.skipped > 0 && <div>⏭️ Rows skipped (duplicates): <strong>{result.skipped}</strong></div>}
          {result.errors > 0 && <div>❌ Rows failed: <strong>{result.errors}</strong></div>}
        </div>
      )}
    </div>
  );
}
