import React from 'react';
import {
  X,
  MapPin,
  User,
  Paperclip,
  History,
  Eye,
} from 'lucide-react';
import ModalOverlay from './ModalOverlay';
import DocumentWorkflowPipeline from './DocumentWorkflowPipeline';
import { getWorkflowStatus } from '../utils/documentWorkflow';
import { getDocumentFiles } from '../utils/documentFiles';
import { resolveUploadUrl } from '../utils/mediaUrl';
import { getTimelineEventLabel, getTimelineEventOffice, getTimelineEventUser } from '../utils/documentTimeline';

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const DocumentPreviewModal = ({
  doc,
  offices = [],
  users = [],
  documentTypes = [],
  transmissions = [],
  currentUser,
  onClose,
}) => {
  if (!doc) return null;

  const getOfficeName = (officeId) =>
    offices.find((office) => office.id === officeId)?.name || officeId || 'Unknown Office';

  const getDocTypeName = (typeId) =>
    documentTypes.find((item) => item.id === typeId)?.category || 'Unknown';

  const getDocumentTypeLabel = (document) => {
    const label = getDocTypeName(document.documentTypeId);
    return label === 'Others' && document.documentTypeOther
      ? document.documentTypeOther
      : label;
  };

  const getUserFullName = (userId) => {
    const user = users.find((item) => item.id === userId);
    return user
      ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim()
      : 'Unknown';
  };

  const status = getWorkflowStatus(doc);
  const files = getDocumentFiles(doc);
  const timeline = [...(doc.timeline || [])].sort(
    (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0),
  );
  const sendHistory = Array.isArray(doc.sendHistory) ? doc.sendHistory : [];
  const pendingTransmission = transmissions.find(
    (item) => item.documentId === doc.id && !item.receivedBy,
  );
  const queuedOfficeIds = Array.isArray(doc.sendQueue) ? doc.sendQueue.filter(Boolean) : [];

  let workflowExplanation = '';
  if (doc.intakeStatus === 'Returned to Sender' || status === 'Returned to Sender') {
    workflowExplanation = 'Document was returned to the external sender.';
  } else if (doc.intakeStatus === 'Rejected') {
    workflowExplanation = doc.rejectionReason
      ? `Rejected by Mayor — return to sender: ${doc.rejectionReason}`
      : 'Rejected by Mayor — Reception should return it to the sender.';
  } else if (status === 'For Signing') {
    workflowExplanation = 'Waiting for Mayor/Admin signing action.';
  } else if (status === 'For Filing') {
    workflowExplanation = 'Waiting for Mayor/Admin acknowledgement.';
  } else if (status === 'Received') {
    workflowExplanation = doc.documentDirection === 'Outgoing'
      ? 'At current office — ready to send or complete.'
      : "At Mayor's Office (FIFO queue).";
  }

  const currentLocation = getOfficeName(doc.currentOfficeId) || '-';

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal document-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{doc.subject}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
              {doc.trackingNumber} - {getDocumentTypeLabel(doc)}
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <DocumentWorkflowPipeline
            doc={doc}
            hasPendingTransmission={Boolean(pendingTransmission)}
            locationLabel={currentLocation}
            workflowNote={workflowExplanation}
          />

          {(pendingTransmission || queuedOfficeIds.length > 0) && (
            <div className="document-detail-section" style={{ marginTop: '1rem' }}>
              <h4><MapPin size={14} /> Current Handoff</h4>
              {pendingTransmission && (
                <>
                  <div className="detail-pair">
                    <span>Custody remains at</span>
                    <strong>{getOfficeName(doc.currentOfficeId)}</strong>
                  </div>
                  <div className="detail-pair">
                    <span>Awaiting receipt at</span>
                    <strong>{getOfficeName(pendingTransmission.toOfficeId)}</strong>
                  </div>
                  <div className="detail-pair">
                    <span>Sent</span>
                    <strong>{formatDateTime(pendingTransmission.createdAt || pendingTransmission.transmissionDate)}</strong>
                  </div>
                </>
              )}
              {queuedOfficeIds.length > 0 && (
                <div className="detail-pair">
                  <span>Later offices in route</span>
                  <strong>{queuedOfficeIds.map(getOfficeName).join(' → ')}</strong>
                </div>
              )}
            </div>
          )}

          <div className="document-detail-grid">
            <div className="document-detail-section">
              <h4><MapPin size={14} /> Location</h4>
              <div className="detail-pair"><span>Status</span><strong>{status}</strong></div>
              <div className="detail-pair"><span>Review</span><strong>{doc.intakeStatus || 'Approved'}</strong></div>
              {workflowExplanation && (
                <div className="detail-pair"><span>Workflow Note</span><strong>{workflowExplanation}</strong></div>
              )}
              {doc.rejectionReason && (
                <div className="detail-pair"><span>Rejection Reason</span><strong>{doc.rejectionReason}</strong></div>
              )}
              <div className="detail-pair"><span>Current</span><strong>{currentLocation}</strong></div>
              <div className="detail-pair">
                <span>From Organization</span>
                <strong>{doc.originOfficeOther || '-'}</strong>
              </div>
              <div className="detail-pair">
                <span>Destination</span>
                <strong>
                  {doc.destinationOfficeOther
                    || (doc.destinationOfficeId ? getOfficeName(doc.destinationOfficeId) : '-')}
                </strong>
              </div>
            </div>

            <div className="document-detail-section">
              <h4><User size={14} /> Sender</h4>
              <div className="detail-pair"><span>Name</span><strong>{doc.senderName || '-'}</strong></div>
              <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
              <div className="detail-pair">
                <span>SMS Updates</span>
                <strong>
                  {doc.notifySender === false
                    ? 'Disabled'
                    : (doc.senderContact ? 'Enabled' : 'No contact number')}
                </strong>
              </div>
            </div>

            <div className="document-detail-section">
              <h4><Paperclip size={14} /> Attachments</h4>
              {files.length ? (
                <div className="attachment-list">
                  {files.map((file) => {
                    const href = resolveUploadUrl(file.url || file.dataUrl || '');
                    return (
                      <div key={file.id} className="attachment-item">
                        {href ? (
                          <a
                            className="attachment-link"
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Eye size={14} />
                            <span>{file.name}</span>
                          </a>
                        ) : (
                          <span className="attachment-link is-disabled">
                            <Eye size={14} />
                            <span>{file.name}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="detail-empty">No attachments</p>
              )}
            </div>
          </div>

          {sendHistory.length > 0 && (
            <div className="document-detail-section" style={{ marginTop: '1rem' }}>
              <h4><History size={14} /> Send History (chronological)</h4>
              <div className="timeline-list">
                {sendHistory.map((event) => (
                  <div key={event.id} className="timeline-item">
                    <strong>
                      {getOfficeName(event.fromOfficeId)} → {getOfficeName(event.toOfficeId)}
                    </strong>
                    <span>{formatDateTime(event.sentAt)}</span>
                    <span>by {getUserFullName(event.sentBy)}</span>
                    <span>
                      {event.receivedAt
                        ? `Received ${formatDateTime(event.receivedAt)}${event.receivedBy ? ` by ${getUserFullName(event.receivedBy)}` : ''}`
                        : 'Awaiting destination receipt'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="document-detail-section" style={{ marginTop: '1rem' }}>
            <h4><History size={14} /> Timeline</h4>
            {timeline.length ? (
              <div className="timeline-list">
                {timeline.map((event) => (
                  <div key={event.id || `${event.timestamp}-${event.label}`} className="timeline-item">
                    <strong>{getTimelineEventLabel(event)}</strong>
                    <span>{formatDateTime(event.timestamp)}</span>
                    {event.details && !/^[A-Z]{2,}-[A-Z0-9-]+$/i.test(event.details.trim()) && <span>{event.details}</span>}
                    {getTimelineEventOffice(event, offices) && <span>{getTimelineEventOffice(event, offices)}</span>}
                    {getTimelineEventUser(event, users) && <span>{getTimelineEventUser(event, users)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="detail-empty">No timeline events yet</p>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default DocumentPreviewModal;
