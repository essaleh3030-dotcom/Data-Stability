// pages/upload.js — Redirects to the dashboard (Upload is now a tab inside the main app)
import { useEffect } from 'react';

export default function UploadRedirect() {
  useEffect(() => {
    window.location.replace('/#upload');
  }, []);
  return <div style={{ padding: 40, textAlign: 'center' }}>Redirecting…</div>;
}
