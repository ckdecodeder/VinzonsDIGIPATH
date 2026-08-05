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
import { getPriorityInfo } from '../data/mockData';
import { getWorkflowStatus } from '../utils/documentWorkflow';
import { getDocumentFiles } from '../utils/documentFiles';
import { resolveUploadUrl } from '../utils/mediaUrl';

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

  const currentRole = currentUser?.role?.toLowerCase() || '';

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

  const pendingTransmission = transmissions
    .filter((item) => item.documentId === doc.id && !item.receivedBy)
    .sort((a, b) => new Date(b.transmissionDate || 0) - new Date(a.transmissionDate || 0))[0];

  const status = getWorkflowStatus(doc);
  const files = getDocumentFiles(doc);
  const timeline = [...(doc.timeline || [])].sort(
    (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0),
  );

  let workflowExplanation = '';
  if (doc.intakeStatus === 'Pending Review') {
    workflowExplanation = 'Waiting for Admin or Mayor intake review before the document can be routed, signed, filed, or archived.';
  } else if (doc.intakeStatus === 'Rejected') {
    workflowExplanation = doc.rejectionReason
      ? `Rejected for correction: ${doc.rejectionReason}`
      : 'Rejected for correction. Resubmit after fixing the document details.';
  } else if (pendingTransmission) {
    workflowExplanation = `Waiting for ${getOfficeName(pendingTransmission.toOfficeId)} to receive transmission ${pendingTransmission.id}.`;
  } else if (status === 'For Signing') {
    workflowExplanation = 'Waiting for Mayor/Admin signing action.';
  } else if (status === 'For Filing') {
    workflowExplanation = 'Waiting for Mayor/Admin acknowledgement.';
  } else if (status === 'Received') {
    workflowExplanation = 'Approved and ready to acknowledge or route.';
  }

  const currentLocation = (() => {
    if (doc.lastDetectedOfficeId && status === 'In Transit') {
      return `Detected at ${getOfficeName(doc.lastDetectedOfficeId)} (pending receipt)`;
    }
    if (pendingTransmission) {
      return `In transit to ${getOfficeName(pendingTransmission.toOfficeId)}`;
    }
    return getOfficeName(doc.currentOfficeId) || '-';
  })();

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

          <div className="document-detail-grid">
            <div className="document-detail-section">
              <h4><MapPin size={14} /> Location</h4>
              <div className="detail-pair"><span>Status</span><strong>{status}</strong></div>
              <div className="detail-pair"><span>Intake Review</span><strong>{doc.intakeStatus || 'Approved'}</strong></div>
              {workflowExplanation && (
                <div className="detail-pair"><span>Workflow Note</span><strong>{workflowExplanation}</strong></div>
              )}
              {doc.rejectionReason && (
                <div className="detail-pair"><span>Rejection Reason</span><strong>{doc.rejectionReason}</strong></div>
              )}
              <div className="detail-pair"><span>Current</span><strong>{currentLocation}</strong></div>
              <div className="detail-pair">
                <span>Origin</span>
                <strong>{doc.originOfficeOther || getOfficeName(doc.originOfficeId)}</strong>
              </div>
              <div className="detail-pair">
                <span>Destination</span>
                <strong>
                  {doc.destinationOfficeOther
                    || (doc.destinationOfficeId ? getOfficeName(doc.destinationOfficeId) : '-')}
                </strong>
              </div>
              {currentRole !== 'receptionist' && (
                <>
                  <div className="detail-pair"><span>RFID Tag</span><strong>{doc.rfidTag || '-'}</strong></div>
                  <div className="detail-pair">
                    <span>Last Detected</span>
                    <strong>
                      {doc.lastDetectedOfficeId
                        ? `${getOfficeName(doc.lastDetectedOfficeId)} - ${formatDateTime(doc.lastDetectedAt)}`
                        : '-'}
                    </strong>
                  </div>
                </>
              )}
            </div>

            <div className="document-detail-section">
              <h4><User size={14} /> Sender</h4>
              <div className="detail-pair"><span>Name</span><strong>{doc.senderName || '-'}</strong></div>
              <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
              <div className="detail-pair"><span>Email</span><strong>{doc.senderEmail || '-'}</strong></div>
              <div className="detail-pair">
                <span>Priority</span>
                <strong>{getPriorityInfo(doc.priorityLevel).label}</strong>
              </div>
              <div className="detail-pair">
                <span>Updates</span>
                <strong>
                  {doc.notifySender === false
                    ? 'Disabled'
                    : (doc.senderNotificationChannels || []).join(', ').toUpperCase() || 'Enabled'}
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
                          <span className="attachment-link">
                            <Eye size={14} />
                            <span>{file.name}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="detail-empty">No scanned file attached yet.</p>
              )}
            </div>

            <div className="document-detail-section document-timeline-section">
              <h4><History size={14} /> Timeline</h4>
              <div className="timeline-compact">
                {timeline.length ? timeline.map((event) => (
                  <div key={event.id || `${event.timestamp}-${event.label}`} className="timeline-compact-item">
                    <span className="timeline-compact-dot"></span>
                    <div>
                      <strong>{event.label}</strong>
                      <p>{event.details}</p>
                      <small>
                        {formatDateTime(event.timestamp)}
                        {event.userId ? ` - ${getUserFullName(event.userId)}` : ''}
                        {event.officeId ? ` - ${getOfficeName(event.officeId)}` : ''}
                      </small>
                    </div>
                  </div>
                )) : (
                  <p className="detail-empty">No timeline events yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default DocumentPreviewModal;
