const { generateId } = require('./helpers');

const normalizePriorityLevel = (value) => {
  const level = String(value || '').trim().toLowerCase();
  return ['urgent', 'high', 'normal', 'low'].includes(level) ? level : 'normal';
};

const getStatusAfterSend = (status) => (
  ['Signed', 'Acknowledged'].includes(status) ? status : 'Received'
);

const canSendDocument = ({ requiresMayorApproval, mayorApprovalCleared }) => (
  !requiresMayorApproval || Boolean(mayorApprovalCleared)
);

const canArchiveDocument = ({ status, hasPendingTransmission, sendQueue }) => (
  ['Signed', 'Acknowledged', 'For Filing'].includes(status)
  && !hasPendingTransmission
  && !(Array.isArray(sendQueue) && sendQueue.some(Boolean))
);

const buildResubmissionUpdates = () => ({
  intakeStatus: 'Pending Review',
  verifiedBy: '',
  verifiedAt: '',
  rejectionReason: '',
  mayorApprovalCleared: false,
});

const buildInitialOfficeRoute = ({
  originOfficeId,
  destinationOfficeId,
  mayorsOfficeId,
  requiresMayorReception = false,
  requiresMayorApproval,
  sentBy,
  sentAt,
}) => {
  const hasDestination = Boolean(destinationOfficeId && destinationOfficeId !== originOfficeId);
  const firstDestination = (requiresMayorReception || requiresMayorApproval) && mayorsOfficeId !== originOfficeId
    ? mayorsOfficeId
    : (hasDestination ? destinationOfficeId : '');
  const routeDestinations = [];
  if (firstDestination && firstDestination !== originOfficeId) routeDestinations.push(firstDestination);
  if (hasDestination && destinationOfficeId !== routeDestinations.at(-1)) routeDestinations.push(destinationOfficeId);
  const routePlan = [originOfficeId, ...routeDestinations];

  return {
    currentOfficeId: originOfficeId,
    destinationOfficeId: firstDestination || originOfficeId,
    status: requiresMayorApproval && firstDestination === mayorsOfficeId ? 'For Signing' : 'Received',
    routePlan,
    routeStep: 0,
    firstDestinationOfficeId: firstDestination,
    intakeOfficeId: requiresMayorReception && mayorsOfficeId ? mayorsOfficeId : originOfficeId,
    queuedOfficeIds: routeDestinations.slice(1),
    sendHistory: [],
    sendQueue: [],
  };
};

const buildSendTransition = ({
  document,
  toOfficeIds,
  sentBy,
  sentAt,
  transmissionType = 'Internal',
  transmissionDate,
  acknowledgementRemarks = '',
}) => {
  const fromOfficeId = document.currentOfficeId || document.originOfficeId || '';
  if (!fromOfficeId) {
    const err = new Error('The document has no recorded source office');
    err.status = 400;
    throw err;
  }
  const requestedOfficeIds = [...new Set((toOfficeIds || []).map((id) => String(id || '').trim()).filter((id) => id && id !== fromOfficeId))];
  const queuedOfficeIds = Array.isArray(document.sendQueue) ? document.sendQueue.filter(Boolean) : [];
  const firstOfficeId = requestedOfficeIds[0] || queuedOfficeIds[0];
  if (!firstOfficeId) {
    const err = new Error('Select a destination office before sending');
    err.status = 400;
    throw err;
  }
  if (queuedOfficeIds.length && firstOfficeId !== queuedOfficeIds[0]) {
    const err = new Error('Send to the next office in the queued route first');
    err.status = 400;
    throw err;
  }

  const remainingOfficeIds = [...new Set([
    ...requestedOfficeIds.slice(1),
    ...queuedOfficeIds.filter((officeId) => officeId !== firstOfficeId),
  ])];
  const existingRoutePlan = Array.isArray(document.routePlan) ? [...document.routePlan] : [];
  const sourceIndex = existingRoutePlan.lastIndexOf(fromOfficeId);
  const routePlan = existingRoutePlan.length ? existingRoutePlan : [fromOfficeId];
  const currentRouteIndex = sourceIndex >= 0 ? sourceIndex : routePlan.length - 1;
  const plannedAfterSource = new Set(routePlan.slice(currentRouteIndex + 1));
  for (const officeId of [firstOfficeId, ...remainingOfficeIds]) {
    if (!plannedAfterSource.has(officeId)) routePlan.push(officeId);
  }

  const transmissionId = generateId('TRN');
  const transmission = {
    id: transmissionId,
    documentId: document.id,
    fromOfficeId,
    toOfficeId: firstOfficeId,
    sentBy,
    receivedBy: null,
    receivedAt: null,
    transmissionDate: transmissionDate || sentAt.split('T')[0],
    transmissionType,
    acknowledgementRemarks,
    createdAt: sentAt,
    updatedAt: sentAt,
  };
  const sendHistoryEntry = {
    id: transmissionId,
    transmissionId,
    fromOfficeId,
    toOfficeId: firstOfficeId,
    sentBy,
    sentAt,
    order: (document.sendHistory || []).length + 1,
    active: true,
  };

  return {
    transmission,
    documentUpdates: {
      status: 'In Transit',
      preTransitStatus: document.status || 'Received',
      currentOfficeId: fromOfficeId,
      destinationOfficeId: firstOfficeId,
      lastRoutedAt: sentAt,
      routePlan,
      routeStep: currentRouteIndex,
      sendHistory: [...(document.sendHistory || []), sendHistoryEntry],
      sendQueue: remainingOfficeIds,
      updatedAt: sentAt,
    },
  };
};

const buildReceiveTransition = ({
  document,
  toOfficeId,
  transmissionId,
  receivedBy,
  receivedAt = new Date().toISOString(),
}) => {
  const routePlan = Array.isArray(document.routePlan) ? document.routePlan : [];
  const destinationIndex = routePlan.lastIndexOf(toOfficeId);
  const nextRouteStep = destinationIndex >= 0
    ? destinationIndex
    : Math.min((Number(document.routeStep) || 0) + 1, Math.max(routePlan.length - 1, 0));
  const sendHistory = (document.sendHistory || []).map((event) => (
    event.transmissionId === transmissionId || event.id === transmissionId
      ? { ...event, active: false, receivedBy, receivedAt }
      : event
  ));

  return {
    status: document.preTransitStatus || 'Received',
    preTransitStatus: '',
    currentOfficeId: toOfficeId,
    destinationOfficeId: toOfficeId,
    routeStep: nextRouteStep,
    sendHistory,
    updatedAt: receivedAt,
  };
};

module.exports = {
  buildInitialOfficeRoute,
  normalizePriorityLevel,
  getStatusAfterSend,
  canSendDocument,
  canArchiveDocument,
  buildResubmissionUpdates,
  buildSendTransition,
  buildReceiveTransition,
};
