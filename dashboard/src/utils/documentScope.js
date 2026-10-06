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

/**
 * Non-global users only see documents assigned to their office:
 * Reception → Selected Office → Received by Selected Office.
 * In Transit: destination office only. Otherwise: current office only.
 */
export const isDocumentVisibleToUser = (doc, currentUser, { role } = {}) => {
  if (!currentUser || !doc) return false;
  if (isGlobalViewer(currentUser, role)) return true;

  const officeId = currentUser.officeId;
  if (!officeId) return false;

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

  // Destined to this office, or pending outbound from this office (status tracking only).
  if (transmission.toOfficeId === officeId) return true;
  if (!transmission.receivedBy && transmission.fromOfficeId === officeId) return true;
  return false;
};
