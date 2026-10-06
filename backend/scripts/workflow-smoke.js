require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api`;
const username = process.env.SMOKE_USERNAME || 'admin';
const password = process.env.SMOKE_PASSWORD || 'admin123';
const receptionistUsername = process.env.SMOKE_RECEPTIONIST_USERNAME || 'receptionist';
const receptionistPassword = process.env.SMOKE_RECEPTIONIST_PASSWORD || 'recep123';
const keepData = process.env.SMOKE_KEEP_DATA === 'true';

const stamp = Date.now();
const created = {
  documentId: null,
  transmissionId: null,
  archiveId: null,
};

const request = async (path, options = {}, token = null) => {
  const { headers = {}, ...fetchOptions } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...fetchOptions,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${res.status}): ${data?.message || text}`);
  }

  return data;
};

const cleanup = async (adminToken) => {
  const referenceIds = [
    created.documentId,
    created.transmissionId,
    created.archiveId,
  ].filter(Boolean);
  try {
    const notifications = await request('/notifications', {}, adminToken);
    const notificationIds = notifications
      .filter((notification) => referenceIds.includes(notification.referenceId))
      .map((notification) => notification.id);

    for (const notificationId of notificationIds) {
      await request(`/notifications/${notificationId}`, { method: 'DELETE' }, adminToken);
    }
  } catch (err) {
    console.warn(`Notification cleanup warning: ${err.message}`);
  }

  const cleanupSteps = [
    created.archiveId ? `/archives/${created.archiveId}` : null,
    created.transmissionId ? `/transmissions/${created.transmissionId}` : null,
    created.documentId ? `/documents/${created.documentId}` : null,
  ].filter(Boolean);

  for (const path of cleanupSteps) {
    try {
      await request(path, { method: 'DELETE' }, adminToken);
    } catch (err) {
      console.warn(`Cleanup warning: ${err.message}`);
    }
  }
};

const run = async () => {
  let token = null;
  let trackingNumber = null;

  try {
    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    token = login.token;
    if (!token) throw new Error('Login did not return a token.');
    const receptionistLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: receptionistUsername, password: receptionistPassword }),
    });
    const receptionistToken = receptionistLogin.token;

    const documentId = `DOC-SMOKE-${stamp}`;
    trackingNumber = `TRK-SMOKE-${stamp}`;
    const today = new Date().toISOString().split('T')[0];

    const document = await request('/documents', {
      method: 'POST',
      body: JSON.stringify({
        id: documentId,
        trackingNumber,
        subject: `Smoke test workflow ${stamp}`,
        documentDirection: 'Incoming',
        status: 'For Filing',
        priorityLevel: 'normal',
        dateReceived: today,
        documentTypeId: 'DT-001',
        originOfficeId: 'OFF-001',
        currentOfficeId: 'OFF-001',
        senderName: 'Smoke Test Sender',
        remarks: 'Created by backend workflow smoke test.',
      }),
    }, receptionistToken);
    created.documentId = document.id;

    if (document.status !== 'For Filing' || document.intakeStatus !== 'Pending Review') {
      throw new Error(`Receptionist intake did not keep For Filing/Pending Review. Got ${document.status}/${document.intakeStatus}.`);
    }

    const approvedDocument = await request(`/documents/${document.id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ intakeStatus: 'Approved' }),
    }, token);
    if (approvedDocument.status !== 'For Filing' || approvedDocument.intakeStatus !== 'Approved') {
      throw new Error('Approval did not preserve the starting For Filing status.');
    }

    const publicTracking = await request(`/public/track/${trackingNumber}`);
    if (publicTracking.trackingNumber !== trackingNumber) {
      throw new Error('Public tracking lookup did not return the created document.');
    }

    const transmission = await request('/transmissions', {
      method: 'POST',
      body: JSON.stringify({
        id: `TRN-SMOKE-${stamp}`,
        documentId: document.id,
        fromOfficeId: 'OFF-001',
        toOfficeId: 'OFF-002',
        transmissionDate: today,
        transmissionType: 'Internal',
      }),
    }, token);
    created.transmissionId = transmission.id;

    await request(`/transmissions/${transmission.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        receivedBy: login.user.id,
        receivedAt: new Date().toISOString(),
      }),
    }, token);

    const acknowledgedDocument = await request(`/documents/${document.id}/process-note`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'acknowledge_document',
        note: 'Smoke test acknowledged for filing.',
      }),
    }, token);

    if (acknowledgedDocument.status !== 'Acknowledged') {
      throw new Error('Document action endpoint did not acknowledge the For Filing document.');
    }

    const archive = await request('/archives', {
      method: 'POST',
      body: JSON.stringify({
        id: `ARC-SMOKE-${stamp}`,
        documentId: acknowledgedDocument.id,
        userId: login.user.id,
        date: today,
      }),
    }, token);
    created.archiveId = archive.id;

    const notifications = await request('/notifications', {}, token);
    if (!Array.isArray(notifications)) {
      throw new Error('Notifications endpoint did not return a list.');
    }

    console.log('Workflow smoke test passed.');
    console.log(`Document: ${trackingNumber}`);
    console.log(`Transmission: ${transmission.id}`);
    console.log(`Archive: ${archive.id}`);
  } finally {
    if (token && !keepData) {
      await cleanup(token);
      console.log('Smoke test records cleaned up.');
    }
    if (keepData && trackingNumber) {
      console.log(`SMOKE_KEEP_DATA=true, kept smoke records for ${trackingNumber}.`);
    }
  }
};

run().catch((err) => {
  console.error('Workflow smoke test failed:', err.message);
  process.exitCode = 1;
});
