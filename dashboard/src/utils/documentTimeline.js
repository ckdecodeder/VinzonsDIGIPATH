const ACTION_LABELS = {
  transmission_received: 'Received at office',
  transmission_sent: 'Forwarded to another office',
  document_scanned: 'Document scanned',
  document_created: 'Document registered',
  document_updated: 'Document details updated',
  document_completed: 'Marked as completed',
  document_archived: 'Document archived',
  mayor_approved: 'Approved by Mayor',
  mayor_rejected: 'Returned for revision',
};

const isTechnicalToken = (value) => /^[A-Z]{2,}-[A-Z0-9-]+$/i.test(value) || /^[a-f\d-]{24,}$/i.test(value);

export const getTimelineEventLabel = (event = {}) => {
  const supplied = String(event.label || '').trim();
  if (supplied && !isTechnicalToken(supplied)) return supplied;
  const action = String(event.action || '').trim();
  if (!action || isTechnicalToken(action)) return 'Document update';
  const label = ACTION_LABELS[action] || action.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const getTimelineEventOffice = (event, offices = []) => (
  offices.find((office) => office.id === event?.officeId)?.name || ''
);

export const getTimelineEventUser = (event, users = []) => {
  const user = users.find((item) => item.id === event?.userId);
  return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : '';
};
