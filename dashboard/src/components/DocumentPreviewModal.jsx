import { formatPhilippinesDateTime as formatDateTime } from '../utils/philippinesDateTime.js';
import React, { useState, useId } from 'react';
import {
  X,
  MapPin,
  User,
  Paperclip,
  Eye,
} from 'lucide-react';
import ModalOverlay from './ModalOverlay';
import DocumentHandoffSummary from './DocumentHandoffSummary';
import { getWorkflowStatus } from '../utils/documentWorkflow';
import { getDocumentFiles } from '../utils/documentFiles';
import { resolveUploadUrl } from '../utils/mediaUrl';
import { readMediaBlob } from '../utils/protectedMedia';
import { getTimelineEventLabel, getTimelineEventOffice, getTimelineEventUser } from '../utils/documentTimeline';

const DocumentPreviewModal = ({
  doc,
  loading = false,
  refreshError = '',
  onRetry,
  offices = [],
  users = [],
  documentTypes = [],
  transmissions = [],
  currentUser,
  onClose,
  onOpenRecord,
}) => {
  const titleId = useId();
  const [fileError, setFileError] = useState('');
  const openFile = async (event, href) => {
    event.preventDefault();
    const popup = window.open('', '_blank');
    if (!popup) { setFileError('Allow popups to open this file.'); return; }
    try {
      const objectUrl = URL.createObjectURL(await readMediaBlob(href));
      popup.opener = null;
      popup.location.replace(objectUrl);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) { popup.close(); setFileError(error.message || 'Unable to open this file.'); }
  };
  if (loading || refreshError) return (
    <ModalOverlay onClose={onClose} aria-labelledby={titleId}>
      <div className="modal document-detail-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id={titleId}>Document details</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close document details"><X size={18} /></button>
        </div>
        <div className="modal-body" aria-busy={loading}>
          {loading ? <p role="status">Refreshing document details…</p> : <>
            <p role="alert">{refreshError}</p>
            <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
          </>}
        </div>
      </div>
    </ModalOverlay>
  );
  if (!doc) return null;

  const getOfficeName = (officeId) =>
    offices.find((office) => office.id === officeId)?.name || 'Unknown Office';

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
  const queuedOfficeIds = (doc.sendQueue || []).filter(Boolean);

  return (
    <ModalOverlay onClose={onClose} aria-labelledby={titleId}>
      <div className="modal document-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{doc.subject}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
              {doc.trackingNumber} - {getDocumentTypeLabel(doc)}
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <DocumentHandoffSummary doc={doc} officeId={currentUser?.officeId} getOfficeName={getOfficeName} transmissions={transmissions}>
            {queuedOfficeIds.length > 0 && <p className="handoff-note">Later offices in route · {queuedOfficeIds.map(getOfficeName).join(' → ')}</p>}
          </DocumentHandoffSummary>

          <div className="document-detail-grid">
            <div className="document-detail-section">
              <h4><MapPin size={14} /> Location</h4>
              <div className="detail-pair"><span>Status</span><strong>{status}</strong></div>
              <div className="detail-pair"><span>Review</span><strong>{doc.intakeStatus || 'Approved'}</strong></div>
              {doc.rejectionReason && (
                <div className="detail-pair"><span>Rejection Reason</span><strong>{doc.rejectionReason}</strong></div>
              )}
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
              {fileError && <p role="alert">{fileError}</p>}
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
                            onClick={event => openFile(event, href)}
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
            <details className="document-detail-section" style={{ marginTop: '1rem' }}>
              <summary>Send history ({sendHistory.length})</summary>
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
            </details>
          )}

          <details className="document-detail-section" style={{ marginTop: '1rem' }}>
            <summary>Timeline ({timeline.length})</summary>
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
          </details>
        </div>
        {onOpenRecord && doc.id && (
          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={() => onOpenRecord(doc.id)}>Open record</button>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
};

export default DocumentPreviewModal;
