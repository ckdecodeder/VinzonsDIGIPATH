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

const getScopedTransmissionQuery = (req) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  // Incoming to this office, or still-pending outbound from this office (tracking only).
  return {
    $or: [
      { toOfficeId: officeId },
      { fromOfficeId: officeId, receivedBy: { $in: [null, ''] } },
    ],
  };
};

// Copy access uses markers on the latest delivery, rather than all historical recipients.
const getScopedDocumentQueryWithTransmissions = async (req) => getScopedDocumentQuery(req);

module.exports = {
  isGlobalDocumentViewer,
  getScopedDocumentQuery,
  getScopedTransmissionQuery,
  getScopedDocumentQueryWithTransmissions,
};
