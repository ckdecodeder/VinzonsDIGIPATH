const { generateId } = require('./helpers');

const normalizePriorityLevel = (value) => {
  const level = String(value || '').trim().toLowerCase();
  return ['urgent', 'high', 'normal', 'low'].includes(level) ? level : 'normal';
};

const getStatusAfterSend = (status) => (
  ['Signed', 'Acknowledged'].includes(status) ? status : 'Received'
);

const buildInitialOfficeRoute = ({
  originOfficeId,
  destinationOfficeId,
  mayorsOfficeId,
  requiresMayorApproval,
  sentBy,
  sentAt,
}) => {
  const hasDestination = Boolean(destinationOfficeId && destinationOfficeId !== originOfficeId);
  const firstDestination = requiresMayorApproval ? mayorsOfficeId : (hasDestination ? destinationOfficeId : '');
  const routePlan = [originOfficeId];

  if (requiresMayorApproval && mayorsOfficeId !== originOfficeId) routePlan.push(mayorsOfficeId);
  if (hasDestination && destinationOfficeId !== routePlan.at(-1)) routePlan.push(destinationOfficeId);

  const sendHistory = firstDestination ? [{
    id: generateId('SND'),
    fromOfficeId: originOfficeId,
    toOfficeId: firstDestination,
    sentBy,
    sentAt,
    order: 1,
    active: true,
  }] : [];

  return {
    currentOfficeId: firstDestination || originOfficeId,
    status: requiresMayorApproval ? 'For Signing' : 'Received',
    routePlan,
    routeStep: firstDestination ? routePlan.indexOf(firstDestination) : 0,
    sendHistory,
    sendQueue: [],
  };
};

module.exports = { buildInitialOfficeRoute, normalizePriorityLevel, getStatusAfterSend };
