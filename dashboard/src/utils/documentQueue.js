import { getWorkflowStatus } from './documentWorkflow.js';

export const queueFilters = ['Needs your action', 'Newly received', 'Pending review', 'Urgent active'];

export function matchesQueue(doc, filter, user, transmissions = []) {
  const status = getWorkflowStatus(doc);
  if (filter === 'All') return true;
  if (filter === 'Newly received') return status === 'Received' && doc.intakeStatus !== 'Rejected';
  if (filter === 'Pending review') return doc.intakeStatus === 'Pending Review';
  if (filter === 'Urgent active') return doc.priorityLevel === 'urgent' && !['Archived', 'Completed'].includes(status);
  if (filter !== 'Needs your action') return status === filter;
  if (!user?.officeId || ['Completed', 'Archived'].includes(status)) return false;
  if (transmissions.some(t => t.documentId === doc.id && t.toOfficeId === user.officeId && !t.receivedBy)) return true;
  if (doc.currentOfficeId !== user.officeId || status === 'In Transit') return false;
  if (user.role === 'Mayor') return doc.intakeStatus === 'Pending Review' || status === 'For Signing' || status === 'For Signature';
  if (user.role === 'Receptionist') return ['Rejected', 'Returned to Sender'].includes(doc.intakeStatus);
  return true;
}
