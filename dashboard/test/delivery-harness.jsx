// Development-only browser fixture. No login, API, database, uploads, or Pi access.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentList from '../src/pages/DocumentList.jsx';
import AppModal from '../src/components/AppModal.jsx';
import { documentService } from '../src/api/documentService.js';
import { receiveDocumentWithConfirmation } from '../src/utils/receiveDocument.js';
import '../src/index.css';

const layoutCheck = new URLSearchParams(window.location.search).get('layout') === 'multi-office';
const offices = layoutCheck ? [
  "Mayor's Office", 'Municipal Planning & Development', 'Municipal Engineering',
  'Municipal Treasurer', 'Municipal Health Office', 'Municipal Assessor',
  'Municipal Agriculture', 'Municipal Social Welfare & Development',
].map((name, index) => ({ id: index ? `DEST-${index}` : 'SOURCE', name }))
  : ['SOURCE', 'FIRST', 'SECOND', 'THIRD'].map((id) => ({ id, name: `${id} office` }));
const layoutDeliveries = layoutCheck ? offices.slice(1).map((office, index) => ({
  id: `LAYOUT-${index}`, transmissionId: `LAYOUT-${index}`, documentId: 'SYNTHETIC-DOC',
  toOfficeId: office.id, recipientOfficeId: office.id, fromOfficeId: 'SOURCE',
  active: index !== 5, primary: index === 0, deliveryGroupId: 'LAYOUT-GROUP',
  receivedBy: index === 5 ? 'SYNTHETIC-RECEIVER' : null,
  receivedAt: index === 5 ? '2026-10-29T14:17:29.000Z' : null,
  transmissionDate: '2026-10-29T13:00:00.000Z',
})) : [];
const initialDocument = {
  id: 'SYNTHETIC-DOC', trackingNumber: 'SYNTHETIC-001', subject: 'Multiple office delivery check',
  status: layoutCheck ? 'In Transit' : 'Received', intakeStatus: 'Approved', documentDirection: 'Outgoing',
  documentTypeId: 'TEST-TYPE', currentOfficeId: 'SOURCE', originOfficeId: 'SOURCE',
  dateReceived: '2026-10-29', sendHistory: layoutDeliveries, timeline: [], routePlan: ['SOURCE'],
};
function Harness() {
  const [doc, setDoc] = useState(initialDocument);
  const docRef = useRef(doc); docRef.current = doc;
  documentService.getById = async () => structuredClone(docRef.current);
  const [transmissions, setTransmissions] = useState(layoutDeliveries);
  const [officeId, setOfficeId] = useState('SOURCE');
  const [dialog, setDialog] = useState(null);
  const [mutations, setMutations] = useState(0);
  const [failNext, setFailNext] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = { id: `USER-${officeId}`, role: 'Office', officeId, fname: officeId, lname: 'Reviewer' };
  const confirm = (options) => new Promise((resolve) => setDialog({ ...options,
    onConfirm: () => { setDialog(null); resolve(true); }, onCancel: () => { setDialog(null); resolve(false); },
  }));
  const receive = async (id, updates) => {
    if (busy) return null;
    setBusy(true); setError('');
    try {
      return await receiveDocumentWithConfirmation({
        transmission: transmissions.find((item) => item.id === id), document: doc,
        currentUser: user, office: offices.find((item) => item.id === officeId), updates,
      }, { confirm, save: async (transmissionId, payload) => {
        if (failNext) { setFailNext(false); throw new Error('Synthetic connection failure. Please retry.'); }
        const receivedAt = new Date().toISOString();
        const saved = { ...transmissions.find((item) => item.id === transmissionId), receivedBy: payload.receivedBy, receivedAt };
        setTransmissions((items) => items.map((item) => item.id === saved.id ? saved : item));
        setDoc((previous) => {
          const entry = previous.sendHistory.find((item) => item.transmissionId === transmissionId);
          return { ...previous, updatedAt: receivedAt,
            ...(entry.primary ? { currentOfficeId: entry.toOfficeId, destinationOfficeId: entry.toOfficeId, status: 'Received' } : {}),
            sendHistory: previous.sendHistory.map((item) => item === entry ? { ...item, active: false, receivedBy: payload.receivedBy, receivedAt } : item),
          };
        });
        setMutations((value) => value + 1);
        return saved;
      } });
    } catch (issue) { setError(issue.message); throw issue; }
    finally { setBusy(false); }
  };
  return <>
    <div style={{ padding: '1rem', background: 'var(--surface)' }}>
      <strong>Synthetic browser check — no API or database writes</strong>{' '}
      <label>Viewing office <select aria-label="Viewing office" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
        {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
      </select></label>{' '}
      <label><input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} /> Fail next receipt</label>
      <p role="status">Deliveries: {transmissions.length} · Saved receipts: {mutations} · Custody: {doc.currentOfficeId}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <DocumentList documents={[doc]} transmissions={transmissions} offices={offices} users={[user]} currentUser={user} currentRole="office"
      focusDocumentId={layoutCheck ? doc.id : ''}
      documentTypes={[{ id: 'TEST-TYPE', category: 'Synthetic test' }]} onNotify={(notice) => setError(notice.message)}
      onReceiveTransmission={receive} onSendDocument={async (id, destinations) => {
        const created = destinations.map((toOfficeId, index) => ({ id: `TEST-TRN-${index}`, documentId: id, toOfficeId, fromOfficeId: doc.currentOfficeId, sentBy: user.id, receivedBy: null, transmissionDate: '2026-10-29' }));
        setTransmissions(created);
        setDoc((previous) => ({ ...previous, status: 'In Transit', updatedAt: new Date().toISOString(), destinationOfficeId: destinations[0],
          sendHistory: created.map((item, index) => ({ ...item, transmissionId: item.id, recipientOfficeId: item.toOfficeId, active: true, primary: index === 0, deliveryGroupId: 'TEST-GROUP' })),
        }));
      }} />
    <AppModal open={Boolean(dialog)} {...dialog} cancelLabel="Cancel" />
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
