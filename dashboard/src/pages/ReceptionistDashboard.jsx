import { getDocumentHandoff } from '../utils/documentHandoff';
import { focusFormError } from '../utils/formAccessibility';
import { createSubmissionGate } from '../utils/submissionGate';
import React, { useId, useRef, useState } from 'react';
import ModalOverlay from '../components/ModalOverlay';
import formatBadgeCount from '../utils/formatBadgeCount';
import {
  Inbox,
  Send,
  FileText,
  Clock,
  CheckCircle2,
  ArrowRight,
  X,
  AlertCircle,
  ScanLine,
  User,
  Phone,
  MessageSquare,
  Upload,
} from 'lucide-react';
import {
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
} from '../data/mockData';
import { compareOldest } from '../utils/sorting';
import { validateRequiredFields, clearFieldError } from '../utils/formValidation';
import { manilaDate, matchesReceptionQueue } from '../utils/documentQueue';

const ReceptionistDashboard = ({
  dataStates = {},
  documents,
  transmissions = [],
  offices = defaultOffices,
  documentTypes = defaultDocumentTypes,
  currentUser,
  onAddDocument,
  onNavigate,
  onOpenDocument,
  onNotify,
  onReturnToSender,
}) => {
  const formId = useId();
  const [activeTab, setActiveTab] = useState('overview');
  const [incomingFilter, setIncomingFilter] = useState('All');
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const receiveSubmitGate = useRef(null);
  if (!receiveSubmitGate.current) receiveSubmitGate.current = createSubmissionGate(setIsSubmitting);

  const mayorsOfficeId = offices.find(o => o.name.toLowerCase().includes('mayor'))?.id || 'OFF-001';

  const getEmptyReceiveForm = () => ({
    subject: '',
    documentDirection: 'Incoming',
    documentTypeId: documentTypes[0]?.id || 'DT-001',
    documentTypeOther: '',
    status: 'Received',
    priorityLevel: 'normal',
    dateReceived: manilaDate(),
    originOfficeId: currentUser?.officeId || 'OFF-001',
    currentOfficeId: mayorsOfficeId,
    destinationOfficeId: mayorsOfficeId,
    originOfficeOther: '',
    senderName: '',
    senderContact: '',
    senderEmail: '',
    notifySender: true,
    senderNotificationConsent: true,
    senderNotificationChannels: ['sms'],
    remarks: '',
    scannedText: '',
  });

  const [receiveForm, setReceiveForm] = useState(getEmptyReceiveForm);

  const [receiveFormErrors, setReceiveFormErrors] = useState({});
  const [receiveFormErrorSummary, setReceiveFormErrorSummary] = useState('');

  const incomingDocuments = documents.filter(d => d.documentDirection === 'Incoming');
  const getWorkflowStatus = (doc) => {
    if (doc?.status === 'For Signature') return 'For Signing';
    if (doc?.status === 'Acknoweledged') return 'Acknowledged';
    return doc?.status || 'Received';
  };

  const receptionQueueOptions = { mayorsOfficeId, transmissions };
  const todayDocs = incomingDocuments.filter(doc => matchesReceptionQueue(doc, 'Received Today', receptionQueueOptions));
  const forwardedToMayorDocs = incomingDocuments.filter(doc => matchesReceptionQueue(doc, 'Sent to Mayor', receptionQueueOptions));
  const filteredIncomingDocuments = incomingDocuments.filter(doc => matchesReceptionQueue(doc, incomingFilter, receptionQueueOptions));
  const pendingDocuments = [...incomingDocuments]
    .filter(doc => matchesReceptionQueue(doc, 'Pending', receptionQueueOptions))
    .sort((a, b) => compareOldest(a, b, ['createdAt', 'dateReceived', 'updatedAt']));
  const rejectedDocs = incomingDocuments.filter(d => ['Rejected', 'Returned to Sender'].includes(d.intakeStatus) && d.currentOfficeId === currentUser?.officeId);
  const openIncoming = (filter) => {
    setIncomingFilter(filter);
    setActiveTab('incoming');
  };

  const statCards = [
    {
      label: 'Received Today',
      value: todayDocs.length,
      icon: <Inbox size={26} />,
      color: 'blue',
      onClick: () => openIncoming('Received Today'),
    },
    {
      label: 'Sent to Mayor',
      value: forwardedToMayorDocs.length,
      ready: dataStates.transmissions?.status === 'ready' && dataStates.offices?.status === 'ready',
      icon: <Send size={26} />,
      color: 'purple',
      onClick: () => openIncoming('Sent to Mayor'),
    },
    {
      label: 'Pending workflow',
      value: pendingDocuments.length,
      icon: <Clock size={26} />,
      color: 'amber',
      onClick: () => setActiveTab('routing'),
    },
    {
      label: 'Total incoming',
      value: incomingDocuments.length,
      icon: <FileText size={26} />,
      color: 'purple',
      onClick: () => openIncoming('All'),
    },
  ];

  const getDocTypeName = (typeId) => {
    const docType = documentTypes.find(d => d.id === typeId);
    return docType ? docType.category : 'Unknown';
  };
  const openDocumentInterface = (doc) => {
    if (onOpenDocument) {
      onOpenDocument(doc.id);
      return;
    }
    onNavigate('documents');
  };
  const handleKeyboardOpen = (event, action) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };
  const isOtherDocumentType = (typeId) => {
    const docType = documentTypes.find(d => d.id === typeId);
    return docType?.category?.toLowerCase().includes('other');
  };
  const getDocumentPendingReason = (doc) => {
    const lookupOffice = id => offices.find(office => office.id === id)?.name || 'Unknown Office';
    const { holder, heading, note, waiting } = getDocumentHandoff(doc, transmissions, currentUser?.officeId, lookupOffice);
    const facts = [heading];
    if (heading !== `Held by ${holder}`) facts.push(`Recorded holder: ${holder}`);
    if (waiting.length) facts.push(`Awaiting receipt: ${waiting.join(', ')}`);
    if (note) facts.push(note);
    return facts.join(' · ');
  };

  const fileToAttachment = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUser?.id || null,
      source: 'upload',
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleReceive = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    return receiveSubmitGate.current(async () => {
      const validation = validateRequiredFields([
        { key: 'subject', label: 'Document subject', value: receiveForm.subject },
        { key: 'senderName', label: 'Sender name', value: receiveForm.senderName },
        {
          key: 'documentTypeOther',
          label: 'Document type',
          value: receiveForm.documentTypeOther,
          when: isOtherDocumentType(receiveForm.documentTypeId),
        },
        {
          key: 'attachmentFile',
          label: 'Scanned file attachment',
          value: attachmentFile?.name || '',
        },
      ]);
      if (!validation.isValid) {
        setReceiveFormErrors(validation.errors);
        setReceiveFormErrorSummary(validation.summary);
        focusFormError(form);
        return;
      }
      setReceiveFormErrors({});
      setReceiveFormErrorSummary('');

      try {
        const newFiles = attachmentFile ? [await fileToAttachment(attachmentFile)] : [];
        const newDoc = {
          ...receiveForm,
          documentDirection: 'Incoming',
          documentTypeOther: isOtherDocumentType(receiveForm.documentTypeId) ? receiveForm.documentTypeOther.trim() : '',
          originOfficeOther: receiveForm.originOfficeOther.trim(),
          status: 'Received',
          priorityLevel: 'normal',
          originOfficeId: currentUser?.officeId || 'OFF-001',
          currentOfficeId: mayorsOfficeId,
          destinationOfficeId: mayorsOfficeId,
          senderEmail: '',
          senderNotificationChannels: receiveForm.senderContact ? ['sms'] : [],
          scannedFiles: newFiles,
          scannedImageUrl: newFiles[0]?.dataUrl || '',
          intakeStatus: 'Approved',
        };
        await onAddDocument(newDoc);
        setShowReceiveForm(false);
        setAttachmentFile(null);
        setReceiveForm(getEmptyReceiveForm());
      } catch {
        // Shared save handler already shows the API error; keep the form open.
      }
    });
  };

  // FIFO external queue
  const recentIncoming = [...incomingDocuments]
    .filter(d => d.documentDirection === 'Incoming')
    .sort((a, b) => compareOldest(a, b, ['createdAt', 'dateReceived', 'updatedAt']))
    .slice(0, 4);

  return (
    <div className="receptionist-dashboard">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Receptionist Dashboard</h1>
          <p>Scan, receive, and track external documents for Mayor's Office</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={() => { setAttachmentFile(null); setShowReceiveForm(true); }}>
            <Inbox size={18} /> Register
          </button>
        </div>
      </div>

      {rejectedDocs.length > 0 && <section className="card archive-review">
        <h3>Corrections awaiting Reception ({rejectedDocs.length})</h3>
        {rejectedDocs.map(doc => <button className="attachment-link" key={doc.id} onClick={() => openDocumentInterface(doc)}>{doc.trackingNumber} · {doc.subject}</button>)}
      </section>}
      <div className="receptionist-hero">
        <button
          type="button"
          className="receptionist-scan-cta"
          onClick={() => onNavigate('scan-documents')}
        >
          <div className="receptionist-scan-cta-content">
            <div className="receptionist-scan-cta-icon">
              <ScanLine size={28} />
            </div>
            <div>
              <h3>Quick Scan Intake</h3>
              <p>Scan a document, review its details, then register it</p>
            </div>
          </div>
          <ArrowRight size={22} className="receptionist-scan-cta-arrow" />
        </button>

        <div className="stats-grid receptionist-stats">
          {statCards.map((stat, i) => (
            <button
              type="button"
              key={i}
              className={`stat-card ${stat.color}`}
              disabled={dataStates.documents?.status !== 'ready' || stat.ready === false}
              onClick={stat.onClick}
              title={`Open ${stat.label}`}
              style={{ textAlign: 'left' }}
            >
              <div className={`stat-icon ${stat.color}`}>{stat.icon}</div>
              <div className="stat-info">
                <p className="stat-label">{stat.label}</p>
                <p className="stat-value">{dataStates.documents?.status === 'ready' && stat.ready !== false ? stat.value : '—'}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="tab-bar receptionist-tabs">
        <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`tab-btn ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => openIncoming('All')}>Incoming Docs</button>
        <button className={`tab-btn ${activeTab === 'routing' ? 'active' : ''}`} onClick={() => setActiveTab('routing')}>Pending workflow</button>
      </div>

      <div className="receptionist-dashboard-body">
      {activeTab === 'overview' && (
        <div className="grid-2 receptionist-overview">
          {/* Recent Incoming */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Incoming Documents</h3>
              <span className="card-header-spacer" aria-hidden="true" />
            </div>
            <div className="activity-list">
              {recentIncoming.map(doc => {
                return (
                  <div
                    key={doc.id}
                    className="activity-item clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDocumentInterface(doc)}
                    onKeyDown={(event) => handleKeyboardOpen(event, () => openDocumentInterface(doc))}
                    title="Open document details"
                  >
                    <div className={`activity-dot ${getWorkflowStatus(doc) === 'Received' ? 'blue' : getWorkflowStatus(doc) === 'In Transit' ? 'amber' : 'green'}`}></div>
                    <div className="activity-item-body">
                      <p className="activity-text"><strong>{doc.subject}</strong></p>
                      <div className="activity-badges">
                        <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                          {getWorkflowStatus(doc)}
                        </span>
                      </div>
                      <div className="activity-subline">
                        <span className="activity-tracking">{doc.trackingNumber}</span>
                        {doc.senderName && (
                          <span className="activity-sender">
                            <User size={10} />{doc.senderName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pending Documents */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Pending workflow</h3>
              <span className="nav-badge">{formatBadgeCount(pendingDocuments.length)}</span>
            </div>
            {pendingDocuments.length > 0 ? (
              <div className="activity-list">
                {pendingDocuments.slice(0, 4).map(doc => {
                  return (
                    <div
                      key={doc.id}
                      className="activity-item clickable-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => openDocumentInterface(doc)}
                      onKeyDown={(event) => handleKeyboardOpen(event, () => openDocumentInterface(doc))}
                      title="Open document details"
                    >
                      <div className="activity-dot amber"></div>
                      <div className="activity-item-body">
                        <p className="activity-text">
                          <strong>{doc.subject || 'Document'}</strong>
                        </p>
                        <div className="activity-badges">
                          <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                            {getWorkflowStatus(doc)}
                          </span>
                          {(doc.intakeStatus || 'Approved') !== 'Approved' && (
                            <span className="status-badge status-in-transit">
                              {doc.intakeStatus}
                            </span>
                          )}
                        </div>
                        <div className="activity-subline activity-time">
                          <Clock size={10} /> {getDocumentPendingReason(doc) || 'Pending next workflow update.'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <CheckCircle2 size={28} style={{ color: 'var(--success)', marginBottom: '0.5rem' }} />
                <h3>All clear!</h3>
                <p>No pending documents</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'incoming' && (
        <div className="receptionist-tab-panel table-container">
          <div className="card-header">
            <h2 className="card-title">{incomingFilter === 'All' ? 'Incoming documents' : incomingFilter} ({filteredIncomingDocuments.length})</h2>
            {incomingFilter !== 'All' && <button type="button" className="btn btn-sm btn-secondary" onClick={() => openIncoming('All')}>Show all incoming</button>}
          </div>
          <table>
            <thead>
              <tr>
                <th>Tracking #</th>
                <th>Subject</th>
                <th>Type</th>
                <th>Sender</th>
                <th>Status</th>
                <th>Current Office</th>
                <th>Date Received</th>
                <th>Workflow Note</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncomingDocuments.map(doc => {
                return (
                  <tr
                    key={doc.id}
                    className="clickable-row"
                    onClick={() => openDocumentInterface(doc)}
                    title="Open document details"
                  >
                    <td><span className="td-mono">{doc.trackingNumber}</span></td>
                    <td className="td-primary">{doc.subject} <button type="button" className="btn btn-sm btn-secondary" aria-label={`Open ${doc.subject || doc.trackingNumber || 'document'}`} onClick={(event) => { event.stopPropagation(); openDocumentInterface(doc); }}>Open</button></td>
                    <td>{getDocTypeName(doc.documentTypeId)}</td>
                    <td style={{ fontSize: '0.8rem' }}>{doc.senderName || '—'}</td>
                    <td>
                      <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                        {getWorkflowStatus(doc)}
                      </span>
                    </td>
                    <td>{offices.find((office) => office.id === doc.currentOfficeId)?.name || 'Location pending'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{manilaDate(doc.dateReceived || '') || '—'}</td>
                    <td><span className="workflow-explanation">{getDocumentPendingReason(doc)}</span></td>
                  </tr>
                );
              })}
              {!filteredIncomingDocuments.length && <tr><td colSpan="8">No documents match this view.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'routing' && (
        <div className="receptionist-tab-panel table-container">
          <table>
            <thead>
              <tr>
                <th>Tracking #</th>
                <th>Subject</th>
                <th>Current Status</th>
                <th>Pending For</th>
                <th>Date Received</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingDocuments.map(doc => {
                return (
                  <tr
                    key={doc.id}
                    className="clickable-row"
                    onClick={() => openDocumentInterface(doc)}
                    title="Open document details"
                  >
                    <td><span className="td-mono">{doc.trackingNumber}</span></td>
                    <td className="td-primary">{doc?.subject || '—'} <button type="button" className="btn btn-sm btn-secondary" aria-label={`Open ${doc.subject || doc.trackingNumber || 'document'}`} onClick={(event) => { event.stopPropagation(); openDocumentInterface(doc); }}>Open</button></td>
                    <td>
                      <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                        {getWorkflowStatus(doc)}
                      </span>
                      {(doc.intakeStatus || 'Approved') !== 'Approved' && (
                        <span className="status-badge status-in-transit" style={{ marginLeft: '0.35rem' }}>
                          {doc.intakeStatus}
                        </span>
                      )}
                    </td>
                    <td><span className="workflow-explanation">{getDocumentPendingReason(doc)}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{manilaDate(doc.dateReceived || '') || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {doc.intakeStatus === 'Rejected' && onReturnToSender && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => onReturnToSender(doc.id)}
                        >
                          Return to Sender
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!pendingDocuments.length && (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state">
                      <CheckCircle2 size={24} />
                      <h3>No pending documents</h3>
                      <p>Completed documents are hidden from this view.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {/* Receive Document Modal */}
      {showReceiveForm && (
        <ModalOverlay aria-labelledby={`${formId}-form-title`} onClose={() => { if (!isSubmitting) setShowReceiveForm(false); }}>
          <div className="modal receptionist-register-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id={`${formId}-form-title`}>Register External Document</h2>
              <button className="btn-icon" aria-label="Close registration form" disabled={isSubmitting} onClick={() => setShowReceiveForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleReceive} noValidate>
              <div className="modal-body">
                {receiveFormErrorSummary && (
                  <div data-form-error tabIndex={-1} className="form-error-summary" role="alert">{receiveFormErrorSummary}</div>
                )}
                <div className="form-group">
                  <label htmlFor={`${formId}-subject`} className="form-label">Document Subject <span className="required-mark">*</span></label>
                  <input id={`${formId}-subject`} aria-describedby={`${formId}-subject-hint${receiveFormErrors.subject ? ` ${formId}-subject-error` : ''}`} aria-invalid={Boolean(receiveFormErrors.subject)} required
                    className={`form-input${receiveFormErrors.subject ? ' is-invalid' : ''}`}
                    type="text"
                    value={receiveForm.subject}
                    onChange={e => {
                      setReceiveForm({ ...receiveForm, subject: e.target.value });
                      setReceiveFormErrors(prev => clearFieldError(prev, 'subject'));
                      if (receiveFormErrorSummary) setReceiveFormErrorSummary('');
                    }}
                    placeholder="Enter document subject"
                  />
                  {receiveFormErrors.subject && (
                    <p id={`${formId}-subject-error`} className="form-field-error">{receiveFormErrors.subject}</p>
                  )}
                  <p id={`${formId}-subject-hint`} className="field-hint">Shortly describe the document so it is easy to find in tracking, tables, and reports.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor={`${formId}-type`} className="form-label">Document Type</label>
                    <select id={`${formId}-type`} aria-describedby={`${formId}-type-hint`} className="form-select" value={receiveForm.documentTypeId}
                      onChange={e => setReceiveForm({ ...receiveForm, documentTypeId: e.target.value })}>
                      {documentTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.category}</option>)}
                    </select>
                    <p id={`${formId}-type-hint`} className="field-hint">Classifies the record for filters, reports, and workflow review.</p>
                    {isOtherDocumentType(receiveForm.documentTypeId) && (
                      <>
                        <input id={`${formId}-other-type`} aria-label="Other document type" aria-invalid={Boolean(receiveFormErrors.documentTypeOther)} aria-describedby={`${formId}-other-type-hint${receiveFormErrors.documentTypeOther ? ` ${formId}-other-type-error` : ''}`}
                          className={`form-input${receiveFormErrors.documentTypeOther ? ' is-invalid' : ''}`}
                          type="text"
                          value={receiveForm.documentTypeOther}
                          onChange={e => {
                            setReceiveForm({ ...receiveForm, documentTypeOther: e.target.value });
                            setReceiveFormErrors(prev => clearFieldError(prev, 'documentTypeOther'));
                            if (receiveFormErrorSummary) setReceiveFormErrorSummary('');
                          }}
                          placeholder="Specify document type"
                          required
                          style={{ marginTop: '0.5rem' }}
                        />
                        {receiveFormErrors.documentTypeOther && <p id={`${formId}-other-type-error`} className="form-field-error">{receiveFormErrors.documentTypeOther}</p>}
                        <p id={`${formId}-other-type-hint`} className="field-hint">Names the custom type when the document is not covered by the list.</p>
                      </>
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-date`} className="form-label">Date Received</label>
                    <input id={`${formId}-date`} aria-describedby={`${formId}-date-hint`} className="form-input" type="date" value={receiveForm.dateReceived}
                      disabled required />
                    <p id={`${formId}-date-hint`} className="field-hint">Locked to the registration date.</p>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor={`${formId}-destination`} className="form-label">Destination Office</label>
                  <input id={`${formId}-destination`} aria-describedby={`${formId}-destination-hint`}
                    className="form-input"
                    type="text"
                    value="Mayor's Office"
                    disabled
                  />
                  <p id={`${formId}-destination-hint`} className="field-hint">All external documents are automatically routed to the Mayor's Office.</p>
                </div>

                {/* Sender Info */}
                <div style={{
                  padding: '0.75rem', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                  marginTop: '0.25rem',
                }}>
                  <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    <User size={12} style={{ marginRight: '0.25rem' }} />Sender Information (External)
                  </p>
                  <div className="form-group">
                    <label htmlFor={`${formId}-sender-name`} className="form-label">Sender Name <span className="required-mark">*</span></label>
                    <input id={`${formId}-sender-name`} aria-describedby={`${formId}-sender-name-hint${receiveFormErrors.senderName ? ` ${formId}-sender-name-error` : ''}`} aria-invalid={Boolean(receiveFormErrors.senderName)} required
                      className={`form-input${receiveFormErrors.senderName ? ' is-invalid' : ''}`}
                      type="text"
                      value={receiveForm.senderName}
                      onChange={e => {
                        setReceiveForm({ ...receiveForm, senderName: e.target.value });
                        setReceiveFormErrors(prev => clearFieldError(prev, 'senderName'));
                        if (receiveFormErrorSummary) setReceiveFormErrorSummary('');
                      }}
                      placeholder="Full name of the sender"
                    />
                    {receiveFormErrors.senderName && (
                      <p id={`${formId}-sender-name-error`} className="form-field-error">{receiveFormErrors.senderName}</p>
                    )}
                    <p id={`${formId}-sender-name-hint`} className="field-hint">Identifies who submitted the document and appears in tracking details.</p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-contact`} className="form-label"><Phone size={12} style={{ marginRight: '0.25rem' }} />Contact Number (Optional)</label>
                    <input id={`${formId}-contact`} aria-describedby={`${formId}-contact-hint`} className="form-input" type="tel" value={receiveForm.senderContact}
                      onChange={e => setReceiveForm({ ...receiveForm, senderContact: e.target.value })}
                      placeholder="09XX-XXX-XXXX" />
                    <p id={`${formId}-contact-hint`} className="field-hint">Used for SMS tracking updates. Enter a Philippine mobile number starting with 09 or +639.</p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-organization`} className="form-label">Sender's Organization / Office (Optional)</label>
                    <input id={`${formId}-organization`} aria-describedby={`${formId}-organization-hint`}
                      className="form-input"
                      type="text"
                      value={receiveForm.originOfficeOther}
                      onChange={e => setReceiveForm({ ...receiveForm, originOfficeOther: e.target.value })}
                      placeholder="School, agency, barangay, or organization"
                    />
                    <p id={`${formId}-organization-hint`} className="field-hint">Optional: school, agency, barangay, or organization (from office).</p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-remarks`} className="form-label"><MessageSquare size={12} style={{ marginRight: '0.25rem' }} />Remarks</label>
                    <textarea id={`${formId}-remarks`} aria-describedby={`${formId}-remarks-hint`} className="form-input" value={receiveForm.remarks}
                      onChange={e => setReceiveForm({ ...receiveForm, remarks: e.target.value })}
                      placeholder="Notes" rows={2} style={{ resize: 'vertical' }} />
                    <p id={`${formId}-remarks-hint`} className="field-hint">Optional internal context, instructions, or special handling notes.</p>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label htmlFor={`${formId}-attachment`} className="form-label">
                    <Upload size={12} style={{ marginRight: '0.25rem' }} />
                    Scanned File Attachment <span className="required-mark">*</span>
                  </label>
                  <input id={`${formId}-attachment`} aria-describedby={`${formId}-attachment-hint${receiveFormErrors.attachmentFile ? ` ${formId}-attachment-error` : ''}`} aria-invalid={Boolean(receiveFormErrors.attachmentFile)} required
                    className={`form-input${receiveFormErrors.attachmentFile ? ' is-invalid' : ''}`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={e => {
                      setAttachmentFile(e.target.files?.[0] || null);
                      setReceiveFormErrors(prev => clearFieldError(prev, 'attachmentFile'));
                      if (receiveFormErrorSummary) setReceiveFormErrorSummary('');
                    }}
                  />
                  {receiveFormErrors.attachmentFile && (
                    <p id={`${formId}-attachment-error`} className="form-field-error">{receiveFormErrors.attachmentFile}</p>
                  )}
                  {attachmentFile && (
                    <div className="attachment-item" style={{ marginTop: '0.45rem' }}>
                      <p className="field-hint" style={{ margin: 0, flex: 1 }}>
                        Selected: {attachmentFile.name}
                      </p>
                      <button
                        type="button"
                        className="attachment-remove"
                        onClick={() => setAttachmentFile(null)}
                        title="Clear selected file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <p id={`${formId}-attachment-hint`} className="field-hint">Attach a scanned image or PDF, matching the Document Tracker form.</p>
                </div>

                <div style={{ padding: '0.75rem', background: 'var(--info-bg)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--info)', marginTop: '0.5rem' }}>
                  <AlertCircle size={16} />
                  A tracking number will be automatically generated upon submission.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowReceiveForm(false)} disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="btn btn-success" disabled={isSubmitting}>
                  <Inbox size={16} /> {isSubmitting ? 'Registering…' : 'Register Document'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default ReceptionistDashboard;
