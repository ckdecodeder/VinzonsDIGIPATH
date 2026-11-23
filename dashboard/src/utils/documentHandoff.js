import { getWorkflowStatus } from './documentWorkflow.js';

export function getDocumentHandoff(doc, transmissions, officeId, getOfficeName) {
  const status = getWorkflowStatus(doc);
  const recipients = (doc.sendHistory || []).filter(item => item.recipientOfficeId);
  const pending = transmissions.filter(item => item.documentId === doc.id && !item.receivedBy);
  const waitingIds = [...new Set([
    ...recipients.filter(item => item.active).map(item => item.recipientOfficeId),
    ...pending.map(item => item.toOfficeId),
  ].filter(Boolean))];
  if (!waitingIds.length && status === 'In Transit' && doc.destinationOfficeId) waitingIds.push(doc.destinationOfficeId);
  const holder = doc.currentOfficeId ? getOfficeName(doc.currentOfficeId) : 'Unrecorded';
  const waiting = waitingIds.map(getOfficeName);
  const custodyRecipient = recipients.find(item => item.primary && item.active)?.recipientOfficeId;
  const copies = recipients.filter(item => item.primary === false && (item.active || item.receivedBy));
  const ownReceipt = pending.some(item => item.toOfficeId === officeId);
  const receivedCopy = copies.some(item => item.receivedBy && item.recipientOfficeId === officeId);
  const senderId = pending.find(item => item.toOfficeId === officeId)?.fromOfficeId
    || pending[0]?.fromOfficeId || recipients[0]?.fromOfficeId;
  let heading = doc.currentOfficeId ? `Held by ${holder}` : 'Holding office unrecorded';
  let note = '';
  if (status === 'Returned to Sender' || doc.intakeStatus === 'Returned to Sender') {
    heading = 'Returned to the external sender';
  } else if (doc.intakeStatus === 'Rejected') {
    heading = 'Correction required';
    note = doc.rejectionReason || 'Review the document before resubmitting it.';
  } else if (status === 'Archived') {
    heading = 'Document archived';
  } else if (ownReceipt) {
    heading = 'Your office has a document to receive';
    note = 'Confirm receipt once the document reaches your office.';
  } else if (waiting.length) {
    heading = `Waiting for ${waiting.length === 1 ? waiting[0] : `${waiting.length} offices`} to confirm receipt`;
    if (receivedCopy) note = 'Your office has received its copy.';
  } else if (status === 'Completed') {
    heading = 'Processing complete';
    note = 'A final copy is required for archiving.';
  } else if (receivedCopy) {
    heading = 'Your office received a copy';
  } else if (doc.intakeStatus === 'Pending Review') {
    heading = 'Awaiting intake review';
  } else if (status === 'For Signing') {
    heading = 'Awaiting signature';
  } else if (status === 'For Filing') {
    heading = 'Awaiting acknowledgement';
  } else if (status === 'In Transit') {
    heading = 'Awaiting receipt';
  }
  return { status, holder, heading, note, senderId, waiting, ownReceipt, custodyRecipient, copies };
}
