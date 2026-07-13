const isGlobalViewer = (currentUser, role) => {
  if (!currentUser) return false;
  return role === 'mayor' || currentUser.role === 'Mayor';
};

export const isDocumentVisibleToUser = (doc, currentUser, { role } = {}) => {
  if (!currentUser || !doc) return false;
  if (isGlobalViewer(currentUser, role)) return true;

  const officeId = currentUser.officeId;
  if (!officeId) return false;

  if (doc.status === 'In Transit') {
    return doc.destinationOfficeId === officeId;
  }

  if (role === 'receptionist') {
    return doc.currentOfficeId === officeId
      || doc.verifiedBy === currentUser.id
      || (Array.isArray(doc.timeline) && doc.timeline.some((event) => event.userId === currentUser.id));
  }

  return doc.currentOfficeId === officeId;
};

export const isTransmissionVisibleToUser = (transmission, currentUser, { role } = {}) => {
  if (!currentUser || !transmission) return false;
  if (isGlobalViewer(currentUser, role)) return true;

  const officeId = currentUser.officeId;
  if (!officeId) return false;

  if (role === 'receptionist') {
    return transmission.sentBy === currentUser.id
      || transmission.receivedBy === currentUser.id
      || transmission.toOfficeId === officeId;
  }

  return transmission.toOfficeId === officeId;
};
