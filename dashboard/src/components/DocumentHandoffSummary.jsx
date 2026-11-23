import React from 'react';

import { getDocumentHandoff } from '../utils/documentHandoff';

export default function DocumentHandoffSummary({
  doc, badge, officeId, getOfficeName, transmissions, trackingOnly, children,
}) {
  const { status, heading, holder, note, waiting, ownReceipt, senderId, custodyRecipient, copies } =
    getDocumentHandoff(doc, transmissions, officeId, getOfficeName);
  return (
    <section className="handoff-summary" aria-label="Document handoff">
      <div className="handoff-heading">
        <h3>{heading}</h3>
        <span className={`status-badge ${badge?.className || `status-${status.toLowerCase().replace(/\s+/g, '-')}`}`}>{badge?.label || status}</span>
      </div>
      {note && <p className="handoff-note">{note}</p>}
      <dl className="handoff-facts">
        <div><dt>Recorded holder</dt><dd>{holder}</dd></div>
        {senderId && <div><dt>Sent by</dt><dd>{getOfficeName(senderId)}</dd></div>}
        {custodyRecipient && <div><dt>Custody destination</dt><dd>{getOfficeName(custodyRecipient)}</dd></div>}
        {copies.length > 0 && <div><dt>Copy recipients</dt><dd>{copies.map(item =>
          `${getOfficeName(item.recipientOfficeId)} (${item.receivedBy ? 'received' : 'pending'})`).join(', ')}</dd></div>}
        {waiting.length > 0 && <div><dt>Awaiting receipt</dt><dd>{waiting.join(', ')}</dd></div>}
        {trackingOnly && !ownReceipt && <div><dt>Your access</dt><dd>Read-only tracking</dd></div>}
      </dl>
      {children}
    </section>
  );
}
