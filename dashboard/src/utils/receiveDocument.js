export async function receiveDocumentWithConfirmation({ transmission, document, currentUser, office, updates = {} }, { confirm, save }) {
  if (!transmission || transmission.receivedBy || !currentUser?.id || transmission.toOfficeId !== currentUser.officeId) return null;
  const confirmed = await confirm({
    type: 'warning', title: 'Confirm document receipt',
    message: `Confirm that ${office?.name || 'your office'} has received ${document?.trackingNumber || 'this document'}${document?.subject ? ` — ${document.subject}` : ''}. This records your name and the receipt time.`,
    confirmLabel: 'Confirm receipt',
  });
  if (!confirmed) return null;
  return save(transmission.id, { ...updates, receivedBy: currentUser.id, confirmReceipt: true });
}
