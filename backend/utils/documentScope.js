const { getUserOfficeId } = require('./helpers');

/**
 * Admin/Mayor see everything.
 * Everyone else only sees documents currently assigned to their office:
 * - In Transit → destination office only
 * - Otherwise → current office only
 *
 * Flow: Reception → Selected Office → Received by Selected Office
 * Once routed forward, the previous office loses document access.
 */
const isGlobalDocumentViewer = (req) => {
  const role = req.user?.role;
  return role === 'Admin' || role === 'Mayor';
};

const getOfficeDocumentVisibilityClauses = (officeId) => [
  { status: 'In Transit', destinationOfficeId: officeId },
  { status: { $ne: 'In Transit' }, currentOfficeId: officeId },
];

const getScopedDocumentQuery = (req) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  return {
    $or: getOfficeDocumentVisibilityClauses(officeId),
  };
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

// Do not expand document access via historical transmission IDs —
// that was leaking documents to offices that already forwarded them.
const getScopedDocumentQueryWithTransmissions = async (req) => getScopedDocumentQuery(req);

module.exports = {
  isGlobalDocumentViewer,
  getScopedDocumentQuery,
  getScopedTransmissionQuery,
  getScopedDocumentQueryWithTransmissions,
};
