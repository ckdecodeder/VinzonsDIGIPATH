import { getWorkflowStatus } from './documentWorkflow.js';
import { canArchiveDocument, canTakeDocumentAction } from './documentActionRules.js';

export const queueFilters = ['Needs your action', 'Newly received', 'Pending review', 'Urgent active', 'Pending receipt', 'Ready to archive'];

export function getDocumentNextAction(doc, user, transmissions = [], documentTypes = []) {
  const status = getWorkflowStatus(doc);
  if (!user?.officeId || !['Admin', 'Mayor', 'Receptionist', 'Office'].includes(user.role) || status === 'Archived') return '';
  if (transmissions.some(t => t.documentId === doc.id && t.toOfficeId === user.officeId && !t.receivedBy)) return 'Receive document';
  if (canArchiveDocument(doc, user)) return 'Archive final copy';
  if (['Rejected', 'Returned to Sender'].includes(doc.intakeStatus)) {
    return user.role === 'Admin' || (doc.currentOfficeId === user.officeId && ['Receptionist', 'Office'].includes(user.role)) ? 'Correct and resubmit' : '';
  }
  if (['Completed', 'In Transit'].includes(status)) return '';
  if (doc.intakeStatus === 'Pending Review') {
    return doc.currentOfficeId === user.officeId && ['Admin', 'Mayor'].includes(user.role) && ['Received', 'For Signing', 'For Filing'].includes(status) ? 'Review intake' : '';
  }
  if (canTakeDocumentAction(doc, user)) {
    if (['Received', 'For Signing'].includes(status)) return 'Sign or acknowledge';
    if (['For Filing', 'Signed'].includes(status)) return 'Acknowledge document';
    return 'Record an action';
  }
  if ((doc.intakeStatus || 'Approved') !== 'Approved' || !['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'].includes(status)
    || transmissions.some(t => t.documentId === doc.id && !t.receivedBy) || (doc.sendHistory || []).some(event => event.active)) return '';
  if (['Admin', 'Mayor'].includes(user.role)) return 'Send document';
  if (doc.currentOfficeId !== user.officeId) return '';
  if (user.role === 'Office' && !['Signed', 'Acknowledged'].includes(status)) return 'Send document';
  const requiresApproval = documentTypes.find(type => type.id === doc.documentTypeId)?.requiresMayorApproval;
  return !(doc.sendQueue || []).some(Boolean) && (!requiresApproval || doc.mayorApprovalCleared) ? 'Complete processing' : '';
}

export function matchesQueue(doc, filter, user, transmissions = [], documentTypes = []) {
  const status = getWorkflowStatus(doc);
  if (filter === 'All') return true;
  if (!queueFilters.includes(filter)) return status === filter;
  const nextAction = getDocumentNextAction(doc, user, transmissions, documentTypes);
  if (filter === 'Ready to archive') return nextAction === 'Archive final copy';
  if (filter === 'Pending receipt') return nextAction === 'Receive document';
  if (filter === 'Newly received') return Boolean(nextAction) && status === 'Received' && (doc.intakeStatus || 'Approved') === 'Approved';
  if (filter === 'Pending review') return Boolean(nextAction) && doc.intakeStatus === 'Pending Review';
  if (filter === 'Urgent active') return Boolean(nextAction) && doc.priorityLevel === 'urgent' && status !== 'Completed';
  return Boolean(nextAction);
}

const manilaDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function manilaDate(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : manilaDateFormat.format(date);
}

export function matchesReceptionQueue(doc, filter, { mayorsOfficeId, transmissions = [], now = new Date() } = {}) {
  if (doc.documentDirection !== 'Incoming') return false;
  const status = getWorkflowStatus(doc);
  if (filter === 'Received Today') return Boolean(doc.dateReceived || doc.createdAt) && manilaDate(doc.dateReceived || doc.createdAt) === manilaDate(now);
  if (filter === 'Sent to Mayor') return Boolean(mayorsOfficeId) && (
    doc.currentOfficeId === mayorsOfficeId || (status === 'In Transit' && doc.destinationOfficeId === mayorsOfficeId)
    || (doc.sendHistory || []).some(event => event.recipientOfficeId === mayorsOfficeId)
    || transmissions.some(item => item.documentId === doc.id && item.toOfficeId === mayorsOfficeId)
  );
  if (filter === 'Pending') return !['Completed', 'Signed', 'Acknowledged', 'Archived', 'Returned to Sender'].includes(status)
    && doc.intakeStatus !== 'Returned to Sender';
  return true;
}
