const isGlobalViewer = (currentUser, role) => {
  if (!currentUser) return false;
  return role === 'admin'
    || role === 'mayor'
    || currentUser.role === 'Admin'
    || currentUser.role === 'Mayor';
};

const getWorkflowStatus = (doc) => {
  if (doc?.status === 'For Signature') return 'For Signing';
  if (doc?.status === 'Acknoweledged') return 'Acknowledged';
  return doc?.status || 'Received';
};

export const isOfficeDocumentSender = (doc, currentUser, hasOutboundTransmission = false) => (
  currentUser?.role === 'Office'
  && Boolean(currentUser.officeId)
  && Boolean(doc && (
    doc.originOfficeId === currentUser.officeId
    || (doc.sendHistory || []).some((event) => event.fromOfficeId === currentUser.officeId)
    || hasOutboundTransmission
  ))
);

// Current recipients keep copy access for the latest delivery. Offices that sent
// the document retain tracking access as it moves through later deliveries.
export const isDocumentVisibleToUser = (doc, currentUser, { role, sentDocumentIds } = {}) => {
  if (!currentUser || !doc) return false;
  if (isGlobalViewer(currentUser, role)) return true;

  const officeId = currentUser.officeId;
  if (!officeId) return false;

  if (currentUser.role === 'Receptionist' && doc.documentDirection === 'Incoming' && doc.intakeOfficeId === officeId) {
    return true;
  }

  if (isOfficeDocumentSender(doc, currentUser, sentDocumentIds?.has(doc.id))) return true;
  if ((doc.sendHistory || []).some((event) => event.recipientOfficeId === officeId)) return true;
  if (getWorkflowStatus(doc) === 'In Transit') {
    return doc.destinationOfficeId === officeId;
  }

  return doc.currentOfficeId === officeId;
};

export const isTransmissionVisibleToUser = (transmission, currentUser, { role } = {}) => {
  if (!currentUser || !transmission) return false;
  if (isGlobalViewer(currentUser, role)) return true;

  const officeId = currentUser.officeId;
  if (!officeId) return false;

  if (transmission.toOfficeId === officeId) return true;
  return transmission.fromOfficeId === officeId
    && (currentUser.role === 'Office' || !transmission.receivedBy);
};
