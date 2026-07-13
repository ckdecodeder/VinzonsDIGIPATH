const { getUserOfficeId } = require('./helpers');

const isGlobalDocumentViewer = (req) => req.user?.role === 'Mayor';

const isReceptionist = (req) => req.user?.role === 'Receptionist';

const getOfficeDocumentVisibilityClauses = (officeId) => [
  { status: 'In Transit', destinationOfficeId: officeId },
  { status: { $ne: 'In Transit' }, currentOfficeId: officeId },
];

const getScopedDocumentQuery = (req) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  if (isReceptionist(req)) {
    return {
      $or: [
        ...getOfficeDocumentVisibilityClauses(officeId),
        { 'timeline.userId': req.user.id },
        { verifiedBy: req.user.id },
      ],
    };
  }

  return {
    $or: getOfficeDocumentVisibilityClauses(officeId),
  };
};

const getScopedTransmissionQuery = (req) => {
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  if (!officeId) return { id: '__no_office__' };

  if (isReceptionist(req)) {
    return {
      $or: [
        { toOfficeId: officeId, receivedBy: { $in: [null, ''] } },
        { sentBy: req.user.id },
        { receivedBy: req.user.id },
      ],
    };
  }

  return { toOfficeId: officeId };
};

const getScopedDocumentQueryWithTransmissions = async (req) => {
  const baseQuery = getScopedDocumentQuery(req);
  if (isGlobalDocumentViewer(req)) return baseQuery;

  const { Transmission } = require('../models');
  const transmissions = await Transmission.find(getScopedTransmissionQuery(req)).select('documentId').lean();
  const documentIds = [...new Set(transmissions.map((item) => item.documentId).filter(Boolean))];

  if (!documentIds.length) return baseQuery;

  return {
    $or: [
      ...(baseQuery.$or || []),
      { id: { $in: documentIds } },
    ],
  };
};

module.exports = {
  isGlobalDocumentViewer,
  getScopedDocumentQuery,
  getScopedTransmissionQuery,
  getScopedDocumentQueryWithTransmissions,
};
