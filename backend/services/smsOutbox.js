const { Op } = require('sequelize');
const { randomUUID } = require('node:crypto');
const { eligibleRecipient } = require('../utils/sms');
const { getSmsConfig, createHttpSmsClient, SmsProviderError } = require('./httpSms');
const error = (message, status = 409) => Object.assign(new Error(message), { status });
const plain = row => row?.get ? row.get({ plain: true }) : row;
const createSmsOutboxService = ({ DocumentModel, SmsNotificationModel, config = getSmsConfig,
  provider = createHttpSmsClient(), now = () => new Date(), notify = () => {}, spacingMs }) => {
  const db = DocumentModel?.sequelize;
  let dispatchTimer, pollTimer, dispatchBusy = false, pollingBusy = false;
  const currentRecipient = doc => eligibleRecipient(plain(doc));
  const changed = () => notify(['senderNotifications']);
  const requeue = async (id, authorize) => {
    if (!config().ready) throw error('SMS is paused. Configure and enable httpSMS before queueing a message.');
    const snapshot = await SmsNotificationModel.findByPk(id);
    if (!snapshot) throw error('SMS notification not found.', 404);
    const result = await db.transaction(async transaction => {
      // Every mutation uses document -> outbox lock order, including preference changes.
      const doc = await DocumentModel.findByPk(snapshot.documentId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!doc || !await authorize(doc.id, transaction)) throw error('Document not found or not visible to your office.', 404);
      const row = await SmsNotificationModel.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw error('SMS notification not found.', 404);
      if (currentRecipient(doc) !== row.recipient) throw error('Current SMS consent or recipient does not match this message.');
      if (!['Paused', 'Failed'].includes(row.status) || !row.retryable || row.providerMessageId) throw error('This SMS cannot be resent safely. Check its delivery status.');
      if (row.attempts >= 5) throw error('This SMS has reached its five-attempt limit.', 429);
      if (row.expiresAt <= now()) throw error('This SMS has expired. Create a new document update instead.');
      if (row.lastAttemptAt && now() - row.lastAttemptAt < 60000) throw error('Wait one minute before retrying this SMS.', 429);
      await row.update({ status: 'Queued', errorMessage: '', nextPollAt: null }, { transaction });
      return plain(row);
    });
    changed(); return result;
  };
  const claim = async (id) => db.transaction(async transaction => {
    // Serializes dispatch admission across backend processes without holding a lock during HTTP.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('digipath-http-sms-dispatch'))", { transaction });
    const last = await SmsNotificationModel.findOne({ where: { lastAttemptAt: { [Op.ne]: null } }, order: [['lastAttemptAt', 'DESC']], transaction });
    if (last?.lastAttemptAt && now() - last.lastAttemptAt < (spacingMs ?? config().minIntervalMs ?? 6000)) return null;
    const snapshot = await SmsNotificationModel.findByPk(id, { transaction });
    if (!snapshot) return null;
    const doc = await DocumentModel.findByPk(snapshot.documentId, { transaction, lock: transaction.LOCK.UPDATE });
    const row = await SmsNotificationModel.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row || row.status !== 'Queued') return null;
    if (!doc || currentRecipient(doc) !== row.recipient) {
      await row.update({ status: 'Cancelled', retryable: false, errorMessage: 'Current SMS consent or recipient changed.' }, { transaction });
      return null;
    }
    if (row.expiresAt <= now() || row.attempts >= 5) {
      await row.update({ status: 'Expired', retryable: false }, { transaction }); return null;
    }
    const cfg = config();
    if (!cfg.ready) return null;
    await row.update({ status: 'Sending', attempts: row.attempts + 1,
      requestId: randomUUID(), senderNumber: cfg.from, sim: cfg.sim,
      lastAttemptAt: now(), nextPollAt: new Date(now().getTime() + 60000), retryable: false, errorMessage: '' }, { transaction });
    return plain(row);
  });
  const saveOutcome = async (notification, updates) => {
    const allowed = updates.status === 'Accepted' || updates.status === 'Unknown'
      ? ['Sending', 'Unknown', 'Accepted'] : ['Sending', 'Unknown', 'Accepted', 'Sent'];
    await SmsNotificationModel.update(updates, { where: { id: notification.id, requestId: notification.requestId,
      status: { [Op.in]: allowed } } });
    changed();
  };
  const outcome = (result) => ({ ...result, retryable: false,
    nextPollAt: ['Accepted', 'Sent', 'Unknown'].includes(result.status)
      ? new Date(now().getTime() + (result.status === 'Unknown' ? 60000 : 15000)) : null });
  const dispatch = async id => {
    const notification = await claim(id);
    if (!notification) return false;
    changed();
    let result;
    try { result = await provider.send(notification, config()); }
    catch (failure) {
      const retryable = failure instanceof SmsProviderError && failure.retryable;
      result = { status: retryable ? 'Failed' : 'Unknown', retryable,
        errorMessage: failure instanceof SmsProviderError ? failure.message : 'SMS delivery is unconfirmed. Check status before retrying.',
        nextPollAt: retryable ? null : new Date(now().getTime() + 60000) };
      await saveOutcome(notification, result); return true;
    }
    // A DB failure after provider acceptance leaves Sending; never make it retryable.
    await saveOutcome(notification, outcome(result));
    return true;
  };
  const reconcile = async notification => {
    if (!notification.requestId) return;
    const cfg = { ...config(), from: notification.senderNumber, sim: notification.sim };
    try {
      const result = await provider.reconcile(notification, cfg);
      if (result) await saveOutcome(notification, outcome(result));
      else await saveOutcome(notification, { status: 'Unknown', retryable: false,
        errorMessage: 'No unique provider result was found. Delivery remains unconfirmed; resending is blocked.',
        nextPollAt: new Date(now().getTime() + 60000) });
    } catch {
      // Reading status cannot establish failure to send. Keep the last confirmed state.
      await SmsNotificationModel.update({ nextPollAt: new Date(now().getTime() + 60000),
        errorMessage: 'Provider status is temporarily unavailable. No SMS was resubmitted.' }, {
        where: { id: notification.id, requestId: notification.requestId, status: notification.status },
      });
    }
  };
  const pollTick = async () => {
    if (pollingBusy || !config().ready) return;
    pollingBusy = true;
    try {
      await SmsNotificationModel.update({ status: 'Expired', retryable: false }, {
        where: { expiresAt: { [Op.lte]: now() }, status: { [Op.in]: ['Queued', 'Paused'] } },
      });
      await SmsNotificationModel.update({ status: 'Unknown', retryable: false,
        errorMessage: 'An interrupted send needs provider reconciliation. Resending is blocked.' }, {
        where: { status: 'Sending', lastAttemptAt: { [Op.lte]: new Date(now().getTime() - 60000) } },
      });
      const polling = await SmsNotificationModel.findAll({ where: {
        status: { [Op.in]: ['Accepted', 'Sent', 'Unknown'] }, nextPollAt: { [Op.lte]: now() },
      }, order: [['nextPollAt', 'ASC']], limit: 3 });
      for (const row of polling) {
        const item = plain(row);
        if (item.expiresAt <= now()) {
          await SmsNotificationModel.update({ nextPollAt: null, errorMessage: item.status === 'Sent' ? '' : 'Delivery remains unconfirmed after the tracking window. Resending is blocked.' }, { where: { id: item.id, requestId: item.requestId } });
        } else await reconcile(item);
      }
    } finally { pollingBusy = false; }
  };
  const dispatchTick = async () => {
    if (dispatchBusy || !config().ready) return;
    dispatchBusy = true;
    try {
      const next = await SmsNotificationModel.findOne({ where: { status: 'Queued' }, order: [['sequence', 'ASC']] });
      if (next) await dispatch(next.id);
    } finally { dispatchBusy = false; }
  };
  const tick = async () => { await Promise.all([dispatchTick(), pollTick()]); };
  const workerError = () => console.error('SMS worker check failed; pending outcomes retained.');
  return {
    requeue, dispatch, reconcile, tick, dispatchTick, pollTick,
    start() {
      if (dispatchTimer || !config().ready) return;
      // A slow historical status GET must never hold up a new registration's POST.
      dispatchTimer = setInterval(() => dispatchTick().catch(workerError), 1000);
      pollTimer = setInterval(() => pollTick().catch(workerError), 5000);
      dispatchTimer.unref(); pollTimer.unref();
      dispatchTick().catch(workerError);
    },
    stop() { clearInterval(dispatchTimer); clearInterval(pollTimer); dispatchTimer = pollTimer = null; },
  };
};
const serializeSms = row => {
  const item = plain(row);
  return { id: item.id, documentId: item.documentId, trackingNumber: item.trackingNumber,
    channel: 'sms', provider: 'httpsms', eventType: item.eventType, recipient: item.recipient,
    subject: item.subject, message: item.message, status: item.status, errorMessage: item.errorMessage || '',
    createdAt: item.createdAt, sentAt: item.sentAt, deliveredAt: item.deliveredAt,
    canRetry: ['Paused', 'Failed'].includes(item.status) && item.retryable && item.attempts < 5 && new Date(item.expiresAt) > new Date(),
    metadata: { deliveryAttempts: item.attempts } };
};
module.exports = { createSmsOutboxService, serializeSms };
