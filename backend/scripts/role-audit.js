require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api`;

const stamp = Date.now();
const created = {
  documentId: null,
  transmissionId: null,
  returnTransmissionId: null,
  archiveId: null,
};

const request = async (path, options = {}, token = null, expectedStatus = null) => {
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

  if (expectedStatus && res.status !== expectedStatus) {
    throw new Error(`${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${res.status}: ${data?.message || text}`);
  }

  if (!expectedStatus && !res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${res.status}): ${data?.message || text}`);
  }

  return data;
};

const requestBinary = async (path, token = null, expectedStatus = null) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const bytes = Buffer.from(await res.arrayBuffer());

  if (expectedStatus && res.status !== expectedStatus) {
    throw new Error(`GET ${path} expected ${expectedStatus}, got ${res.status}.`);
  }

  if (!expectedStatus && !res.ok) {
    throw new Error(`GET ${path} failed (${res.status}).`);
  }

  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    size: bytes.length,
  };
};

const login = async (username, password) => {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!data.token) throw new Error(`Login for ${username} did not return a token.`);
  return data;
};

const cleanup = async (adminToken) => {
  const referenceIds = [
    created.documentId,
    created.transmissionId,
    created.returnTransmissionId,
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
    created.returnTransmissionId ? `/transmissions/${created.returnTransmissionId}` : null,
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
  const admin = await login(process.env.AUDIT_ADMIN_USERNAME || 'admin', process.env.AUDIT_ADMIN_PASSWORD || 'admin123');
  const mayor = await login(process.env.AUDIT_MAYOR_USERNAME || 'mayor', process.env.AUDIT_MAYOR_PASSWORD || 'mayor123');
  const receptionist = await login(process.env.AUDIT_RECEPTIONIST_USERNAME || 'receptionist', process.env.AUDIT_RECEPTIONIST_PASSWORD || 'recep123');
  const adminToken = admin.token;
  const mayorToken = mayor.token;
  const receptionistToken = receptionist.token;
  const today = new Date().toISOString().split('T')[0];

  const doc = await request('/documents', {
    method: 'POST',
    body: JSON.stringify({
      subject: `Role audit intake ${stamp}`,
      documentDirection: 'Incoming',
      status: 'For Signing',
      intakeStatus: 'Approved',
      priorityLevel: 'normal',
      dateReceived: today,
      documentTypeId: 'DT-001',
      originOfficeId: 'OFF-002',
      currentOfficeId: 'OFF-002',
      senderName: 'Role Audit Sender',
      remarks: 'Created by role audit script.',
    }),
  }, receptionistToken);
  created.documentId = doc.id;

  if (doc.status !== 'For Signing' || doc.intakeStatus !== 'Pending Review') {
    throw new Error(`Receptionist-created documents must preserve starting workflow status and start Pending Review. Got ${doc.status}/${doc.intakeStatus}.`);
  }
  if (doc.originOfficeId !== receptionist.user.officeId || doc.currentOfficeId !== receptionist.user.officeId) {
    throw new Error('Receptionist-created documents must be pinned to the receptionist assigned office.');
  }

  await request('/users', {}, receptionistToken, 403);
  await request('/users', {}, mayorToken);
  await request('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: `mayor-forged-user-${stamp}`,
      password: 'password123',
      fname: 'Forged',
      lname: 'User',
      role: 'Receptionist',
    }),
  }, mayorToken, 403);
  await request('/documents', {
    method: 'POST',
    body: JSON.stringify({
      subject: `Mayor direct intake attempt ${stamp}`,
      documentDirection: 'Incoming',
      documentTypeId: 'DT-001',
      originOfficeId: 'OFF-001',
      currentOfficeId: 'OFF-001',
    }),
  }, mayorToken, 403);
  await request('/logs', {
    method: 'POST',
    body: JSON.stringify({ action: 'forged_log_attempt' }),
  }, receptionistToken, 403);
  await request('/device-events', {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'DEV-001', eventType: 'device_heartbeat' }),
  }, receptionistToken, 403);
  await request(`/documents/${doc.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ intakeStatus: 'Approved' }),
  }, receptionistToken, 403);
  await request(`/documents/${doc.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...doc, intakeStatus: 'Approved' }),
  }, receptionistToken, 403);
  await request(`/documents/${doc.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...doc, status: 'Signed' }),
  }, receptionistToken, 403);
  await request(`/documents/${doc.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...doc, verifiedBy: receptionist.user.id }),
  }, receptionistToken, 403);
  await request('/transmissions', {
    method: 'POST',
    body: JSON.stringify({
      documentId: doc.id,
      fromOfficeId: doc.currentOfficeId,
      toOfficeId: 'OFF-002',
      transmissionDate: today,
      transmissionType: 'Internal',
    }),
  }, receptionistToken, 400);

  await request(`/documents/${doc.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ intakeStatus: 'Rejected' }),
  }, mayorToken, 400);
  const rejectedDoc = await request(`/documents/${doc.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ intakeStatus: 'Rejected', rejectionReason: 'Role audit rejection reason.' }),
  }, mayorToken);
  if (rejectedDoc.intakeStatus !== 'Rejected' || !rejectedDoc.rejectionReason) {
    throw new Error('Mayor rejection did not store the rejection reason.');
  }
  await request('/transmissions', {
    method: 'POST',
    body: JSON.stringify({
      documentId: doc.id,
      fromOfficeId: doc.currentOfficeId,
      toOfficeId: 'OFF-002',
      transmissionDate: today,
      transmissionType: 'Internal',
    }),
  }, mayorToken, 400);
  const resubmittedDoc = await request(`/documents/${doc.id}/resubmit`, {
    method: 'POST',
  }, receptionistToken);
  if (resubmittedDoc.intakeStatus !== 'Pending Review' || resubmittedDoc.rejectionReason) {
    throw new Error('Rejected document resubmission did not return it to pending review.');
  }

  const approvedDoc = await request(`/documents/${doc.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ intakeStatus: 'Approved' }),
  }, mayorToken);

  if (approvedDoc.intakeStatus !== 'Approved' || approvedDoc.verifiedBy !== mayor.user.id) {
    throw new Error('Mayor approval did not mark the document as approved with verifier metadata.');
  }
  await request(`/documents/${doc.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...approvedDoc, status: 'Archived' }),
  }, mayorToken, 400);

  const transmission = await request('/transmissions', {
    method: 'POST',
    body: JSON.stringify({
      documentId: doc.id,
      fromOfficeId: doc.currentOfficeId,
      toOfficeId: 'OFF-002',
      transmissionDate: today,
      transmissionType: 'Internal',
    }),
  }, mayorToken);
  created.transmissionId = transmission.id;

  const rfidTag = `RFID-AUDIT-${stamp}`;
  await request('/devices/events', {
    method: 'POST',
    headers: { 'x-device-key': process.env.DEVICE_API_KEY || 'dev-device-key-change-me' },
    body: JSON.stringify({
      deviceId: 'DEV-001',
      eventType: 'rfid_detected',
      documentId: doc.id,
      officeId: 'OFF-002',
      rfidTag,
      details: 'Role audit RFID location update.',
    }),
  });

  const detectedDoc = await request(`/documents/${doc.id}`, {}, mayorToken);
  if (detectedDoc.currentOfficeId !== 'OFF-002' || detectedDoc.rfidTag !== rfidTag || detectedDoc.lastDetectedOfficeId !== 'OFF-002') {
    throw new Error('RFID detection did not update document location and RFID metadata.');
  }

  await request(`/transmissions/${transmission.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      receivedBy: receptionist.user.id,
      receivedAt: new Date().toISOString(),
    }),
  }, receptionistToken, 404);

  await request(`/transmissions/${transmission.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      receivedBy: admin.user.id,
      receivedAt: new Date().toISOString(),
    }),
  }, mayorToken);

  const receivedDoc = await request(`/documents/${doc.id}`, {}, mayorToken);
  if (receivedDoc.status !== 'For Signing') {
    throw new Error(`Receiving a transmission must restore the starting For Signing status. Got ${receivedDoc.status}.`);
  }
  await request('/transmissions', {
    method: 'POST',
    body: JSON.stringify({
      documentId: doc.id,
      fromOfficeId: 'OFF-002',
      toOfficeId: 'OFF-003',
      transmissionDate: today,
      transmissionType: 'Internal',
    }),
  }, receptionistToken, 403);
  await request(`/documents/${doc.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      remarks: 'Origin receptionist should not edit after transfer.',
    }),
  }, receptionistToken, 403);

  const signedDoc = await request(`/documents/${doc.id}/process-note`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'sign_document',
      note: 'Role audit signed by approval user.',
    }),
  }, mayorToken);
  if (signedDoc.status !== 'Signed') {
    throw new Error('Signing action did not move For Signing document to Signed.');
  }

  const returnTransmission = await request('/transmissions', {
    method: 'POST',
    body: JSON.stringify({
      documentId: doc.id,
      fromOfficeId: signedDoc.currentOfficeId,
      toOfficeId: 'OFF-003',
      transmissionDate: today,
      transmissionType: 'Internal',
    }),
  }, mayorToken);
  created.returnTransmissionId = returnTransmission.id;

  await request(`/transmissions/${returnTransmission.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      receivedBy: admin.user.id,
      receivedAt: new Date().toISOString(),
    }),
  }, mayorToken);

  const returnedSignedDoc = await request(`/documents/${doc.id}`, {}, mayorToken);
  if (returnedSignedDoc.status !== 'Signed' || returnedSignedDoc.currentOfficeId !== 'OFF-003') {
    throw new Error('Routing a Signed document must restore Signed status at the destination office.');
  }

  const archive = await request('/archives', {
    method: 'POST',
    body: JSON.stringify({
      documentId: returnedSignedDoc.id,
      date: today,
    }),
  }, mayorToken);
  created.archiveId = archive.id;

  await request('/device', {}, adminToken);
  await request('/devices/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'DEV-001' }),
  }, null, 401);

  const report = await requestBinary('/reports/export?category=documents', adminToken);
  if (!report.contentType.includes('wordprocessingml.document') || report.size < 1000) {
    throw new Error(`Official report export did not return a valid DOCX. Type=${report.contentType} size=${report.size}`);
  }
  await requestBinary('/reports/export?category=documents', receptionistToken);
  await requestBinary('/reports/export?category=activity', receptionistToken, 403);

  console.log('Workflow and role audit passed.');
  console.log(`Checked document lifecycle: ${doc.id}`);
  console.log('Checked receptionist restrictions: users, forged logs, device events, approval, intake update, verification metadata, status update, pre-approval routing, foreign-office receiving visibility, current-office routing, post-transfer editing.');
  console.log('Checked Mayor approval/rejection/resubmission/sign/return/archive path, RFID location updates, read-only user visibility, and Admin-only management/intake boundaries.');
  console.log('Checked official DOCX report export and Receptionist activity-report restriction.');

  await cleanup(adminToken);
};

run().catch((err) => {
  console.error('Workflow and role audit failed:', err.message);
  process.exitCode = 1;
});
