const { createHttpError, generateId } = require('./helpers');
const { canArchiveDocument } = require('./documentRouting');
const { withModelTransaction } = require('./transactionContext');

const createArchiveService = ({ DocumentModel, TransmissionModel, ArchiveModel }) => {
  const lockDocument = async (id, tx) => {
    const row = await DocumentModel.findOne({ where: { id }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (!row) throw createHttpError('Document not found', 404);
    return row;
  };
  const create = ({ documentId, userId, date, eventFor }) => withModelTransaction(DocumentModel, async tx => {
    const row = await lockDocument(documentId, tx);
    const doc = row.get({ plain: true });
    const pending = await TransmissionModel.findAll({ where: { documentId }, transaction: tx });
    if ((doc.intakeStatus || 'Approved') !== 'Approved' || !canArchiveDocument({ status: doc.status, sendQueue: doc.sendQueue, hasPendingTransmission: pending.some(t => !t.get({ plain: true }).receivedBy) })
      || (doc.sendHistory || []).some(e => e.active)) throw createHttpError('Complete all office handoffs and document actions before archiving.', 409);
    if (await ArchiveModel.findOne({ where: { documentId }, transaction: tx })) throw createHttpError('This document is already archived.', 409);
    const now = new Date().toISOString();
    const archive = await ArchiveModel.create({ id: generateId('ARC'), documentId, userId, date: date || now.slice(0, 10), statusBeforeArchive: doc.status, createdAt: now, updatedAt: now }, { transaction: tx });
    await row.update({ status: 'Archived', archivedAt: now, updatedAt: now, timeline: [...(doc.timeline || []), eventFor(archive.get({ plain: true }), doc)] }, { transaction: tx });
    return { archive: archive.get({ plain: true }), document: row.get({ plain: true }) };
  });
  const remove = async ({ archiveId, eventFor }) => {
    const snapshot = await ArchiveModel.findOne({ where: { id: archiveId } });
    if (!snapshot) throw createHttpError('Archive not found', 404);
    return withModelTransaction(DocumentModel, async tx => {
      const row = await lockDocument(snapshot.get({ plain: true }).documentId, tx);
      const archive = await ArchiveModel.findOne({ where: { id: archiveId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!archive) throw createHttpError('Archive no longer exists. Refresh before trying again.', 409);
      const item = archive.get({ plain: true }), doc = row.get({ plain: true });
      if (item.documentId !== doc.id || doc.status !== 'Archived' || !['Signed', 'Acknowledged', 'For Filing'].includes(item.statusBeforeArchive)
        || await ArchiveModel.count({ where: { documentId: doc.id }, transaction: tx }) !== 1) throw createHttpError('Archive state needs reconciliation before it can be restored.', 409);
      await row.update({ status: item.statusBeforeArchive, archivedAt: '', updatedAt: new Date().toISOString(), timeline: [...(doc.timeline || []), eventFor(item, doc)] }, { transaction: tx });
      await archive.destroy({ transaction: tx });
      return { archive: item, document: row.get({ plain: true }) };
    });
  };
  return { create, remove };
};
const service = () => createArchiveService(require('../models')._sequelizeModels);
module.exports = { createArchiveService, archiveDocument: options => service().create(options), restoreArchive: options => service().remove(options) };
