const { buildSendTransition, buildReceiveTransition, canSendDocument } = require('./documentRouting');
const { createHttpError, normalizeWorkflowStatus } = require('./helpers');

// Lock the document first for every operation, then its transmissions. This serializes
// sends/receipts/cancellations across clients and commits history and deliveries together.
const createHandoffService = ({ DocumentModel, TransmissionModel }) => {
  const transaction = (work) => DocumentModel.sequelize.transaction(work);
  const lockDocument = async (id, tx) => {
    const row = await DocumentModel.findOne({ where: { id }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (!row) throw createHttpError('Document not found', 404);
    return row;
  };
  const withTimeline = (doc, updates, events) => ({
    ...updates,
    timeline: [...(doc.timeline || []), ...events],
  });

  const send = (options) => transaction(async (tx) => {
    const row = await lockDocument(options.documentId, tx);
    const doc = row.get({ plain: true });
    if (doc.currentOfficeId !== options.fromOfficeId) {
      throw createHttpError('Document custody changed. Refresh before sending.', 409);
    }
    if (!['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'].includes(normalizeWorkflowStatus(doc.status))) {
      throw createHttpError('Document is not ready to send. Refresh before sending.', 409);
    }
    const mayorOnly = options.toOfficeIds.length === 1 && options.toOfficeIds[0] === options.mayorsOfficeId;
    if (!canSendDocument({ requiresMayorApproval: options.requiresMayorApproval, mayorApprovalCleared: doc.mayorApprovalCleared }) && !mayorOnly) {
      throw createHttpError('Mayor approval must be recorded before routing this document onward');
    }
    if (doc.intakeStatus === 'Rejected' || (doc.intakeStatus === 'Pending Review' && !mayorOnly)) {
      throw createHttpError('Document must be approved before routing');
    }
    const pending = await TransmissionModel.findAll({ where: { documentId: doc.id }, transaction: tx });
    if (pending.some((item) => !item.get({ plain: true }).receivedBy)) {
      throw createHttpError('All pending office deliveries must be received before sending again', 409);
    }
    const transition = buildSendTransition({ ...options, document: doc });
    await TransmissionModel.bulkCreate(transition.transmissions, { transaction: tx });
    const events = transition.transmissions.map((trans) => options.eventFor(trans));
    await row.update(withTimeline(doc, transition.documentUpdates, events), { transaction: tx });
    return { document: row.get({ plain: true }), transmissions: transition.transmissions, transmission: transition.transmission };
  });

  const receive = async (options) => {
    if (options.confirmed !== true) throw createHttpError('Confirm receipt before receiving this document');
    const snapshot = await TransmissionModel.findOne({ where: { id: options.transmissionId } });
    if (!snapshot) throw createHttpError('Transmission not found', 404);
    return transaction(async (tx) => {
      const row = await lockDocument(snapshot.get({ plain: true }).documentId, tx);
      const transRow = await TransmissionModel.findOne({ where: { id: options.transmissionId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!transRow) throw createHttpError('Transmission not found', 404);
      const trans = transRow.get({ plain: true });
      const doc = row.get({ plain: true });
      if (trans.toOfficeId !== options.officeId) throw createHttpError('Only the destination office can receive this transmission', 403);
      if (trans.receivedBy) throw createHttpError('This transmission has already been received', 409);
      const event = (doc.sendHistory || []).find((item) => item.transmissionId === trans.id || item.id === trans.id);
      if (event?.deliveryGroupId) {
        if (!event.active || event.fromOfficeId !== trans.fromOfficeId || event.toOfficeId !== trans.toOfficeId) {
          throw createHttpError('This delivery is no longer active. Refresh the document.', 409);
        }
      } else if (doc.status !== 'In Transit' || doc.currentOfficeId !== trans.fromOfficeId || doc.destinationOfficeId !== trans.toOfficeId) {
        throw createHttpError('Transmission no longer matches the document route', 409);
      }
      const receivedAt = new Date().toISOString();
      const updates = buildReceiveTransition({ document: doc, toOfficeId: trans.toOfficeId, transmissionId: trans.id, receivedBy: options.receivedBy, receivedAt });
      await transRow.update({
        receivedBy: options.receivedBy, receivedAt, updatedAt: receivedAt,
        ...(options.acknowledgementRemarks ? { acknowledgementRemarks: options.acknowledgementRemarks } : {}),
      }, { transaction: tx });
      await row.update(withTimeline(doc, updates, [options.eventFor(trans)]), { transaction: tx });
      return { document: row.get({ plain: true }), transmission: transRow.get({ plain: true }) };
    });
  };

  const cancel = async ({ transmissionId, eventFor }) => {
    const snapshot = await TransmissionModel.findOne({ where: { id: transmissionId } });
    if (!snapshot) throw createHttpError('Transmission not found', 404);
    return transaction(async (tx) => {
      const row = await lockDocument(snapshot.get({ plain: true }).documentId, tx);
      const transRow = await TransmissionModel.findOne({ where: { id: transmissionId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!transRow) throw createHttpError('Transmission not found', 404);
      const trans = transRow.get({ plain: true });
      if (!trans.receivedBy) {
        const doc = row.get({ plain: true });
        const cancelled = (doc.sendHistory || []).find((event) => event.id === trans.id || event.transmissionId === trans.id);
        const now = new Date().toISOString();
        const sendHistory = (doc.sendHistory || []).map((event) => event === cancelled
          ? { ...event, active: false, cancelledAt: now, recipientOfficeId: '' } : { ...event });
        const updates = { sendHistory, updatedAt: now };
        if (!cancelled?.deliveryGroupId || cancelled.primary) {
          const successor = cancelled?.deliveryGroupId && sendHistory.find((event) => event.deliveryGroupId === cancelled.deliveryGroupId && !event.cancelledAt);
          if (successor) successor.primary = true;
          Object.assign(updates, {
            status: successor && !successor.receivedBy ? 'In Transit' : (doc.preTransitStatus || 'Received'),
            preTransitStatus: successor && !successor.receivedBy ? doc.preTransitStatus : '',
            currentOfficeId: successor?.receivedBy ? successor.toOfficeId : trans.fromOfficeId,
            destinationOfficeId: successor?.toOfficeId || trans.fromOfficeId,
            routeStep: Math.max(0, (doc.routePlan || []).lastIndexOf(successor?.receivedBy ? successor.toOfficeId : trans.fromOfficeId)),
          });
        }
        await row.update(withTimeline(doc, updates, [eventFor(trans)]), { transaction: tx });
      }
      await transRow.destroy({ transaction: tx });
      return trans;
    });
  };
  return { send, receive, cancel };
};

const service = () => createHandoffService(require('../models')._sequelizeModels);
module.exports = {
  createHandoffService,
  sendHandoffs: (options) => service().send(options),
  receiveHandoff: (options) => service().receive(options),
  cancelHandoff: (options) => service().cancel(options),
};
