import React from 'react';

export default function DocumentHandoffSummary({
  doc, status, badge, officeId, getOfficeName, recipients, pending, ownReceipt, trackingOnly, children,
}) {
  const waitingIds = [...new Set([
    ...recipients.filter(item => item.active).map(item => item.toOfficeId),
    ...pending.map(item => item.toOfficeId),
  ].filter(Boolean))];
  if (!waitingIds.length && doc.status === 'In Transit' && doc.destinationOfficeId) {
    waitingIds.push(doc.destinationOfficeId);
  }
  const holder = doc.currentOfficeId ? getOfficeName(doc.currentOfficeId) : 'Unrecorded';
  const receivedCopy = recipients.some(item => !item.primary && item.receivedBy && item.toOfficeId === officeId);
  const waitingLabel = waitingIds.length === 1 ? getOfficeName(waitingIds[0]) : `${waitingIds.length} offices`;
  let heading = doc.currentOfficeId ? `Held by ${holder}` : 'Holding office unrecorded';
  let note = '';
  if (status === 'Returned to Sender' || ['Returned to Sender', 'Rejected'].includes(doc.intakeStatus)) {
    heading = 'Correction required';
    note = doc.rejectionReason || 'Review the document before resubmitting it.';
  } else if (status === 'Archived') {
    heading = 'Document archived';
  } else if (ownReceipt) {
    heading = 'Your office has a document to receive';
    note = 'Confirm receipt once the document reaches your office.';
  } else if (waitingIds.length) {
    heading = `Waiting for ${waitingLabel} to confirm receipt`;
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
  } else if (status === 'In Transit') {
    heading = 'Awaiting receipt';
  }
  const senderId = pending.find(item => item.toOfficeId === officeId)?.fromOfficeId
    || pending[0]?.fromOfficeId || recipients[0]?.fromOfficeId;

  return (
    <section className="handoff-summary" aria-label="Document handoff">
      <div className="handoff-heading">
        <h3>{heading}</h3>
        <span className={`status-badge ${badge.className}`}>{badge.label}</span>
      </div>
      {note && <p className="handoff-note">{note}</p>}
      <dl className="handoff-facts">
        <div><dt>Recorded holder</dt><dd>{holder}</dd></div>
        {senderId && <div><dt>Sent by</dt><dd>{getOfficeName(senderId)}</dd></div>}
        {(waitingIds.length > 1 || ownReceipt) && <div><dt>Awaiting receipt</dt><dd>{waitingIds.map(getOfficeName).join(', ')}</dd></div>}
        {trackingOnly && !ownReceipt && <div><dt>Your access</dt><dd>Read-only tracking</dd></div>}
      </dl>
      {children}
    </section>
  );
}
