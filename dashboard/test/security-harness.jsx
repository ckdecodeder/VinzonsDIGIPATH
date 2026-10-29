import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProtectedImage from '../src/components/ProtectedImage';
import PdfFitPreview from '../src/components/PdfFitPreview';
import { bootstrapApiBase } from '../src/api/apiBase';
import { downloadAttachment } from '../src/utils/attachmentDownload';
import '../src/index.css';

async function start() {
  if (!import.meta.env.DEV) throw new Error('Synthetic harness is development-only.');
  const config = await (await fetch('/test/config')).json();
  sessionStorage.setItem('dp_authToken', config.syntheticToken);
  await bootstrapApiBase();
  function Harness() {
    const [version, setVersion] = useState(1), [status, setStatus] = useState('Authorized synthetic session'), [metrics, setMetrics] = useState(null);
    const refresh = async () => setMetrics(await (await fetch('/test/metrics')).json());
    const expire = () => { sessionStorage.removeItem('dp_authToken'); setStatus('Expired synthetic session'); setVersion(v => v + 1); };
    const restore = () => { sessionStorage.setItem('dp_authToken', config.syntheticToken); setStatus('Authorized synthetic session'); setVersion(v => v + 1); };
    return <main style={{ padding: 28, maxWidth: 1040, margin: 'auto' }}>
      <h1>Synthetic protected-scan acceptance</h1><p>In-memory test identity and synthetic files only. No production database or hardware.</p>
      <p role="status">{status}</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button onClick={expire}>Expire test session</button><button onClick={restore}>Restore test session</button>
        <button onClick={refresh}>Read request counts</button>
        <button onClick={async () => { try { await downloadAttachment({ name: 'synthetic.png', type: 'image/png', url: '/uploads/scans/synthetic.png' }); setStatus('Synthetic download prepared'); } catch (error) { setStatus(error.message); } }}>Download protected image</button>
      </div>
      {metrics && <pre>{JSON.stringify(metrics)}</pre>}
      <section key={version} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div><h2>Authorized image</h2><ProtectedImage src={'/uploads/scans/synthetic.png?v=' + version} alt="Synthetic protected image" style={{ width: 180, height: 180, imageRendering: 'pixelated' }} /></div>
        <div><h2>Authorized PDF</h2><PdfFitPreview src={'/uploads/scans/synthetic.pdf?v=' + version} alt="Synthetic protected PDF" /></div>
      </section>
    </main>;
  }
  createRoot(document.getElementById('root')).render(<Harness />);
}
start().catch(error => { document.getElementById('root').textContent = error.message; });
