const { literal } = require('sequelize');
const { getUserOfficeId } = require('./helpers');

/**
 * Admin/Mayor see everything.
 * Offices see documents currently assigned to them and their own outbox history:
 * - In Transit → primary destination and every recipient in the latest delivery
 * - Receptionists retain read access to records first registered at their office
 *
 * Flow: Reception → Selected Offices → Independently confirmed receipts
 * Office users retain current operational access; Receptionists retain lifecycle tracking.
 */
const isGlobalDocumentViewer = (req) => {
  const role = req.user?.role;
  return role === 'Admin' || role === 'Mayor';
};

const getOfficeDocumentVisibilityClauses = (officeId) => [
  { status: 'In Transit', destinationOfficeId: officeId },
  { status: { $ne: 'In Transit' }, currentOfficeId: officeId },
  { originOfficeId: officeId },
  { intakeOfficeId: officeId },
  { 'sendHistory.fromOfficeId': officeId },
  { 'sendHistory.recipientOfficeId': officeId },
];

const getScopedDocumentQuery = (req) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  const visibilityQuery = {
    $or: getOfficeDocumentVisibilityClauses(officeId),
  };

  if (req.user?.role === 'Receptionist') {
    return { $and: [{ documentDirection: 'Incoming' }, visibilityQuery] };
  }

  return visibilityQuery;
};

const getScopedDocumentReadQuery = (req, documentModel) => {
  const scope = getScopedDocumentQuery(req);
  const officeId = getUserOfficeId(req);
  if (req.user?.role !== 'Office' || !officeId) return scope;

  // Older handoffs may only record their sender in the transmission table.
  const { sequelize } = documentModel;
  const { schema } = documentModel.getTableName();
  const table = sequelize.getQueryInterface().queryGenerator.quoteTable({ tableName: 'transmissions', schema });
  const outboundDocumentIds = literal(
    `(SELECT "documentId" FROM ${table} WHERE "fromOfficeId" = ${sequelize.escape(officeId)})`,
  );
  return { $or: [...scope.$or, { id: { $in: outboundDocumentIds } }] };
};

const getScopedTransmissionQuery = (req, { forUpdate = false } = {}) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  // Office monitoring includes completed sends. Update lookups keep the pending-only outbound scope.
  const canReadCompletedOutbound = req.user?.role === 'Office' && !forUpdate;
  return {
    $or: [
      { toOfficeId: officeId },
      canReadCompletedOutbound
        ? { fromOfficeId: officeId }
        : { fromOfficeId: officeId, receivedBy: { $in: [null, ''] } },
    ],
  };
};

// Copy access uses markers on the latest delivery, rather than all historical recipients.
const getScopedDocumentQueryWithTransmissions = async (req) => getScopedDocumentQuery(req);

module.exports = {
  isGlobalDocumentViewer,
  getScopedDocumentQuery,
  getScopedDocumentReadQuery,
  getScopedTransmissionQuery,
  getScopedDocumentQueryWithTransmissions,
};
