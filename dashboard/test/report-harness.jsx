// Development-only browser check: Vite's production entry does not include this
// file. All records below are synthetic and no API, login or Pi is contacted.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReportsPage from '../src/pages/ReportsPage.jsx';
import '../src/index.css';

const count = Math.min(100000, Math.max(0, Number(new URLSearchParams(location.search).get('rows')) || 10000));
const logs = Array.from({ length: count }, (_, index) => ({
  id: `test-${index}`, userId: 'test-user', timestamp: '2026-10-28T10:00:00Z',
  action: 'document_updated', referenceId: `R${String(index).padStart(5, '0')}`,
  details: 'Synthetic activity for report verification. This entry checks wrapped details, page breaks and complete output across a very large historical activity report.',
}));
const user = { id: 'test-user', fname: 'Test Reviewer', lname: 'Peña', role: 'Admin' };
const users = [user];
function Heartbeat() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTicks((value) => value + 1), 250); return () => clearInterval(timer); }, []);
  return <p role="status">Synthetic test only: {count.toLocaleString()} records · Browser heartbeat: {ticks}</p>;
}
createRoot(document.getElementById('root')).render(<>
  <Heartbeat />
  <ReportsPage logs={logs} users={users} currentUser={user} currentRole="admin" />
</>);
