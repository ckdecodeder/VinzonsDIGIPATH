const { createHash, randomUUID } = require('node:crypto');

const invalid = message => Object.assign(new Error(message), { status: 400 });
const normalizeSmsNumber = input => {
  let value = String(input || '').trim().replace(/[\s().-]/g, '');
  if (/^09\d{9}$/.test(value)) value = `+63${value.slice(1)}`;
  if (/^639\d{9}$/.test(value)) value = `+${value}`;
  if (!/^\+639\d{9}$/.test(value)) throw invalid('SMS requires a Philippine mobile number in 09 or +639 format.');
  return value;
};
const wantsSms = doc => doc.notifySender === true && doc.senderNotificationConsent === true
  && Array.isArray(doc.senderNotificationChannels) && doc.senderNotificationChannels.includes('sms');
const validateSmsPreferences = doc => {
  for (const key of ['notifySender', 'senderNotificationConsent']) {
    if (doc[key] !== undefined && doc[key] !== null && typeof doc[key] !== 'boolean') throw invalid(`${key} must be true or false.`);
  }
  if (doc.senderNotificationChannels !== undefined && (!Array.isArray(doc.senderNotificationChannels)
    || doc.senderNotificationChannels.some(value => !['sms', 'email'].includes(value)))) {
    throw invalid('Sender notification channels must be a list containing sms or email.');
  }
  if (wantsSms(doc) && String(doc.senderContact || '').trim()) doc.senderContact = normalizeSmsNumber(doc.senderContact);
  return doc;
};
const eligibleRecipient = doc => {
  if (!wantsSms(doc)) return null;
  try { return normalizeSmsNumber(doc.senderContact); } catch { return null; }
};
const labels = {
  document_received: 'Your document was registered.',
  document_scanned: 'Your document was scanned and registered.',
  document_approved: 'Your document was approved.',
  document_rejected: 'Your document was rejected. Please contact Reception.',
  document_resubmitted: 'Your document was resubmitted for review.',
  document_routed: 'Your document was sent to the selected offices.',
  transmission_received: 'An office confirmed receipt of your document.',
  document_for_signing: 'Your document was marked for signing.',
  document_for_signature: 'Your document was marked for signing.',
  document_for_filing: 'Your document was marked for filing.',
  document_signed: 'Your document was signed.',
  document_acknowledged: 'Your document was acknowledged.',
  returned_to_sender: 'Your document was returned. Please contact Reception.',
  document_archived: 'Your document was completed and archived.',
};
const aliases = { document_sent: 'document_routed', sign_document: 'document_signed',
  acknowledge_document: 'document_acknowledged', ready_for_signing: 'document_for_signing',
  ready_for_signature: 'document_for_signing', ready_for_filing: 'document_for_filing', hardware_scan: 'document_scanned' };
const buildSmsContent = (doc, eventType) => {
  // Fixed ASCII templates omit private subject/remarks/names/URLs and fit one SMS.
  const tracking = String(doc.trackingNumber || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  return `DigiPath ${tracking || 'document'}: ${labels[eventType] || 'Your document has an update.'}`.slice(0, 160);
};
const documentSmsEvents = (row, created) => {
  const doc = row.get({ plain: true });
  if (created) return [{ key: `registered:${doc.id}`, action: 'document_received', userId: doc.timeline?.[0]?.userId }];
  const previousIds = new Set((row.previous('timeline') || []).map(event => event.id));
  const added = (doc.timeline || []).filter(event => event.id && !previousIds.has(event.id));
  const events = added.map(event => ({ key: event.id, action: aliases[event.action] || event.action, userId: event.userId }))
    .filter(event => labels[event.action]);
  // One routing SMS per committed delivery batch, regardless of office count.
  let routed = false;
  const result = events.filter(event => event.action !== 'document_routed' || (!routed && (routed = true)));
  if (!result.length && !added.length) {
    let action;
    if (row.changed('intakeStatus')) action = ({ Approved: 'document_approved', Rejected: 'document_rejected', 'Pending Review': 'document_resubmitted' })[doc.intakeStatus];
    if (!action && row.changed('status')) action = `document_${String(doc.status).toLowerCase().replace(/ /g, '_')}`;
    if (labels[action]) result.push({ key: randomUUID(), action, userId: 'system' });
  }
  return result;
};
const installSmsDocumentHooks = ({ DocumentModel, SmsNotificationModel, ready }) => {
  const record = async (row, options, created) => {
    const doc = row.get({ plain: true });
    const recipient = eligibleRecipient(doc);
    const events = recipient ? documentSmsEvents(row, created) : [];
    const preferencesChanged = !created && ['senderContact', 'notifySender', 'senderNotificationConsent', 'senderNotificationChannels'].some(key => row.changed(key));
    if (!events.length && !preferencesChanged) return;
    if (!options.transaction) throw new Error('Document SMS events require a database transaction.');
    if (preferencesChanged) {
      const { Op } = require('sequelize');
      await SmsNotificationModel.update({ status: 'Cancelled', retryable: false, errorMessage: 'Contact or notification preferences changed.' }, {
        where: { documentId: doc.id, providerMessageId: null, status: { [Op.in]: ['Queued', 'Paused', 'Failed'] } }, transaction: options.transaction,
      });
    }
    const now = new Date();
    await SmsNotificationModel.bulkCreate(events.map(event => ({
      id: `SMS-${randomUUID()}`,
      eventKey: createHash('sha256').update(`${doc.id}:${event.key}:${event.action}`).digest('hex'),
      documentId: doc.id, trackingNumber: doc.trackingNumber, eventType: event.action,
      recipient, message: buildSmsContent(doc, event.action), subject: labels[event.action],
      status: ready() ? 'Queued' : 'Paused', retryable: true, createdBy: event.userId || 'system',
      createdAt: now, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    })), { transaction: options.transaction, ignoreDuplicates: true });
    options.transaction.afterCommit(() => {
      try { require('./realtime').broadcastDataInvalidate(['senderNotifications']); } catch { /* Reconnect/read refresh recovers missed invalidation. */ }
    });
  };
  DocumentModel.addHook('beforeValidate', 'smsPreferences', row => validateSmsPreferences(row));
  DocumentModel.addHook('afterCreate', 'smsOutbox', (row, options) => record(row, options, true));
  DocumentModel.addHook('afterUpdate', 'smsOutbox', (row, options) => record(row, options, false));
};
module.exports = { normalizeSmsNumber, wantsSms, validateSmsPreferences, eligibleRecipient, buildSmsContent, documentSmsEvents, installSmsDocumentHooks };
