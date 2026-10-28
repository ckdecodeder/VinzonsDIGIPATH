const completedStatuses = ['Signed', 'Acknowledged', 'Archived'];
const approvalRoles = ['Admin', 'Mayor'];

const statusOf = (doc) => {
  if (doc?.status === 'For Signature') return 'For Signing';
  if (doc?.status === 'Acknoweledged') return 'Acknowledged';
  return doc?.status || 'Received';
};

const hasApprovalCustody = (doc, user) => (
  approvalRoles.includes(user?.role)
  && Boolean(user?.officeId)
  && doc?.currentOfficeId === user.officeId
  && (doc?.intakeStatus || 'Approved') === 'Approved'
);

export const isOfficeReadOnlyTracking = (doc, user) => (
  user?.role === 'Office'
  && doc?.originOfficeId === user.officeId
  && doc?.currentOfficeId !== user.officeId
);

export const canTakeDocumentAction = (doc, user) => (
  hasApprovalCustody(doc, user)
  && ['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'].includes(statusOf(doc))
);

export const canSignDocument = (doc, user) => (
  canTakeDocumentAction(doc, user)
  && ['Received', 'For Signing'].includes(statusOf(doc))
);

export const canAcknowledgeDocument = (doc, user) => (
  canTakeDocumentAction(doc, user)
  && ['Received', 'For Filing', 'For Signing', 'Signed'].includes(statusOf(doc))
);

export const canRejectDocument = (doc, user) => (
  approvalRoles.includes(user?.role)
  && doc?.currentOfficeId === user?.officeId
  && ['Approved', 'Pending Review'].includes(doc?.intakeStatus || 'Approved')
  && ['Received', 'For Signing', 'For Filing'].includes(statusOf(doc))
  && !completedStatuses.includes(statusOf(doc))
);

export const canArchiveDocument = (doc, user) => (
  approvalRoles.includes(user?.role)
  && (doc?.intakeStatus || 'Approved') === 'Approved'
  && ['Signed', 'Acknowledged'].includes(statusOf(doc))
  && !(doc?.sendHistory || []).some((event) => event.active)
  && !(doc?.sendQueue || []).some(Boolean)
);
