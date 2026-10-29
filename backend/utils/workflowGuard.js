const { createHttpError } = require('./helpers');
const assertCurrentCustody = (req, doc) => {
  if (!req.user?.officeId || doc.currentOfficeId !== req.user.officeId) throw createHttpError('Only the office currently holding this document can perform this action.', 403);
};
const snapshotGuard = (req, snapshot, { custody = false } = {}) => (current) => {
  for (const key of ['status', 'intakeStatus', 'currentOfficeId', 'originOfficeId', 'destinationOfficeId', 'documentTypeId', 'mayorApprovalCleared', 'updatedAt', 'scannedFiles', 'sendHistory', 'sendQueue']) {
    if (JSON.stringify(current[key] ?? null) !== JSON.stringify(snapshot[key] ?? null)) throw createHttpError('This document changed. Refresh before trying again.', 409);
  }
  if (custody) assertCurrentCustody(req, current);
};
module.exports = { assertCurrentCustody, snapshotGuard };
