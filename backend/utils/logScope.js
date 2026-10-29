const { Document, Transmission, Archive } = require('../models');
const { getScopedDocumentQueryWithTransmissions, isGlobalDocumentViewer } = require('./documentScope');

// Resolve linked workflow IDs too; a transmission log's reference is not its document ID.
const getScopedLogQuery = async (req) => {
  if (isGlobalDocumentViewer(req)) return {};
  const documents = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).select('id').lean();
  const ids = documents.map(doc => doc.id);
  const [transmissions, archives] = ids.length ? await Promise.all([
    Transmission.find({ documentId: { $in: ids } }).select('id').lean(),
    Archive.find({ documentId: { $in: ids } }).select('id').lean(),
  ]) : [[], []];
  return { $or: [{ userId: req.user.id }, { referenceId: { $in: [...ids, ...transmissions.map(t => t.id), ...archives.map(a => a.id)] } }] };
};
module.exports = { getScopedLogQuery };
