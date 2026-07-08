export const getProcessActionToastMessage = (action) => {
  const messages = {
    action_note: 'Action added successfully',
    sign_document: 'Signed successfully',
    acknowledge_document: 'Acknowledged successfully',
  };

  return messages[action] || 'Saved successfully';
};

export const getVerificationToastMessage = (intakeStatus) => {
  if (intakeStatus === 'Approved') return 'Approved successfully';
  if (intakeStatus === 'Rejected') return 'Rejected successfully';
  return 'Saved successfully';
};

export const getStatusToastMessage = (status) => {
  const messages = {
    Signed: 'Marked as signed successfully',
    Acknowledged: 'Acknowledged successfully',
    'For Filing': 'Marked for filing successfully',
    'For Signing': 'Marked for signing successfully',
    Received: 'Marked as received successfully',
    'In Transit': 'Marked in transit successfully',
    Archived: 'Archived successfully',
  };

  return messages[status] || 'Updated successfully';
};

export const getTransmissionUpdateToastMessage = (updates = {}) => {
  if (updates.receivedBy || updates.receivedAt) {
    return 'Received successfully';
  }
  return 'Updated successfully';
};
