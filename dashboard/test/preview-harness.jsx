// Synthetic-only fixture: no authentication, API, file upload or hardware calls.
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentPreviewModal from '../src/components/DocumentPreviewModal';
import { useDocumentPreview } from '../src/hooks/useDocumentPreview';
import '../src/index.css';

const mode = new URLSearchParams(location.search).get('state') || 'ready';
const doc = { id: 'SYNTHETIC', subject: 'Synthetic document preview', trackingNumber: 'SYNTHETIC-001',
  status: 'Received', currentOfficeId: 'SOURCE', documentTypeId: 'TYPE', timeline: [] };
let fail = mode === 'error';
const load = async (id, { signal }) => {
  if (mode === 'loading') await new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
  });
  if (fail) throw new Error('Document details could not be refreshed. Please retry.');
  return { ...doc, id };
};
function Harness() {
  const [id, setId] = useState('SYNTHETIC');
  const close = useCallback(() => setId(null), []);
  const preview = useDocumentPreview(id, 'SYNTHETIC-USER', 0, load, close);
  return <main className="page-content"><h1>Synthetic preview check</h1>
    <button className="btn btn-primary" onClick={() => setId('SYNTHETIC')}>Open document</button>
    {id && <DocumentPreviewModal doc={preview.document} loading={preview.loading} refreshError={preview.error}
      onRetry={() => { fail = false; preview.retry(); }} onClose={close}
      offices={[{ id: 'SOURCE', name: 'Synthetic source office' }]} documentTypes={[{ id: 'TYPE', category: 'Synthetic' }]} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);
