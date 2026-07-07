import React, { useState } from 'react';
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
  Flag,
  User,
  Phone,
  Mail,
  MessageSquare,
  Upload,
} from 'lucide-react';
import {
  getPriorityInfo,
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
  priorityLevels,
} from '../data/mockData';
import { compareNewest } from '../utils/sorting';

const ReceptionistDashboard = ({
  documents,
  offices = defaultOffices,
  documentTypes = defaultDocumentTypes,
  currentUser,
  onAddDocument,
  onAddTransmission,
  onNavigate,
  onOpenDocument,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);

  const [receiveForm, setReceiveForm] = useState({
    subject: '',
    documentDirection: 'Incoming',
    documentTypeId: 'DT-001',
    documentTypeOther: '',
    status: 'Received',
    priorityLevel: 'normal',
    dateReceived: new Date().toISOString().split('T')[0],
    currentOfficeId: currentUser?.officeId || 'OFF-001',
    originOfficeOther: '',
    senderName: '',
    senderContact: '',
    senderEmail: '',
    notifySender: true,
    senderNotificationConsent: true,
    senderNotificationChannels: ['sms', 'email'],
    remarks: '',
    scannedText: '',
  });

  const [routeForm, setRouteForm] = useState({
    documentId: '',
    fromOfficeId: currentUser?.officeId || 'OFF-001',
    toOfficeId: offices.find(o => o.id !== currentUser?.officeId)?.id || 'OFF-002',
    transmissionType: 'Internal',
    transmissionDate: new Date().toISOString().split('T')[0],
  });

  const notify = (message, title = 'Action needed', type = 'warning') => {
    onNotify?.({ type, title, message });
  };

  const registrationStatuses = ['Received', 'For Signing', 'For Filing'];
  const transmittableStatuses = ['Received', 'For Signing', 'For Filing'];
  const finishedStatuses = ['Signed', 'Acknowledged', 'Archived'];
  const getWorkflowStatus = (doc) => {
    if (doc?.status === 'For Signature') return 'For Signing';
    if (doc?.status === 'Acknoweledged') return 'Acknowledged';
    return doc?.status || 'Received';
  };

  const todayDocs = documents.filter(d => {
    const today = new Date().toISOString().split('T')[0];
    return d.dateReceived === today;
  });
  const urgentDocs = documents.filter(d => d.priorityLevel === 'urgent' && d.status !== 'Archived');
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  const pendingDocuments = [...documents]
    .filter(doc => !finishedStatuses.includes(getWorkflowStatus(doc)))
    .sort((a, b) => {
      const pDiff = (priorityOrder[a.priorityLevel] || 2) - (priorityOrder[b.priorityLevel] || 2);
      if (pDiff !== 0) return pDiff;
      return compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
    });

  const statCards = [
    {
      label: 'Received Today',
      value: todayDocs.length,
      icon: <Inbox size={26} />,
      color: 'blue',
      onClick: () => setActiveTab('incoming'),
    },
    {
      label: 'Urgent Items',
      value: urgentDocs.length,
      icon: <Flag size={26} />,
      color: 'red',
      onClick: () => onNavigate('documents'),
    },
    {
      label: 'Pending',
      value: pendingDocuments.length,
      icon: <Clock size={26} />,
      color: 'amber',
      onClick: () => setActiveTab('routing'),
    },
    {
      label: 'Total In System',
      value: documents.length,
      icon: <FileText size={26} />,
      color: 'purple',
      onClick: () => onNavigate('documents'),
    },
  ];

  const getOfficeName = (officeId) => {
    const office = offices.find(o => o.id === officeId);
    return office ? office.name : 'Unknown Office';
  };

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
  const isApprovedForWorkflow = (doc) => (doc?.intakeStatus || 'Approved') === 'Approved';
  const routableDocuments = documents.filter(doc =>
    doc.currentOfficeId === currentUser?.officeId &&
    transmittableStatuses.includes(getWorkflowStatus(doc)) &&
    isApprovedForWorkflow(doc)
  );
  const getDocumentPendingReason = (doc) => {
    if ((doc.intakeStatus || 'Approved') === 'Pending Review') {
      return 'Waiting for Admin or Mayor approval before routing.';
    }
    if (doc.intakeStatus === 'Rejected') {
      return doc.rejectionReason ? `Rejected for correction: ${doc.rejectionReason}` : 'Rejected for correction and needs resubmission.';
    }
    const status = getWorkflowStatus(doc);
    if (status === 'Received' && isApprovedForWorkflow(doc)) {
      return 'Approved and ready to route.';
    }
    if (status === 'In Transit') {
      return 'Already routed. Waiting for the destination office to receive it.';
    }
    if (status === 'For Signing') {
      return 'Waiting for Mayor/Admin signing action.';
    }
    if (status === 'For Filing') {
      return 'Waiting for Mayor/Admin acknowledgement.';
    }
    if (status === 'Signed' || status === 'Acknowledged' || status === 'Archived') {
      return 'Completed workflow. Routing is locked.';
    }
    return '';
  };
  const getNextOfficeId = (fromOfficeId) => offices.find(o => o.id !== fromOfficeId)?.id || fromOfficeId;

  const toggleSenderChannel = (channel) => {
    setReceiveForm(prev => {
      const channels = prev.senderNotificationChannels || [];
      return {
        ...prev,
        senderNotificationChannels: channels.includes(channel)
          ? channels.filter(item => item !== channel)
          : [...channels, channel],
      };
    });
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

  const openRouteForm = () => {
    const fromOfficeId = currentUser?.officeId || 'OFF-001';
    const firstDocument = routableDocuments[0];
    setRouteForm({
      documentId: firstDocument?.id || '',
      fromOfficeId,
      toOfficeId: getNextOfficeId(fromOfficeId),
      transmissionType: 'Internal',
      transmissionDate: new Date().toISOString().split('T')[0],
    });
    setShowRouteForm(true);
  };

  const handleReceive = async (e) => {
    e.preventDefault();
    const newFiles = attachmentFile ? [await fileToAttachment(attachmentFile)] : [];
    const newDoc = {
      ...receiveForm,
      documentDirection: 'Incoming',
      documentTypeOther: isOtherDocumentType(receiveForm.documentTypeId) ? receiveForm.documentTypeOther.trim() : '',
      originOfficeOther: receiveForm.originOfficeOther.trim(),
      status: receiveForm.status,
      originOfficeId: currentUser?.officeId || 'OFF-001',
      currentOfficeId: currentUser?.officeId || receiveForm.currentOfficeId || 'OFF-001',
      scannedFiles: newFiles,
      scannedImageUrl: newFiles[0]?.dataUrl || '',
    };
    try {
      await onAddDocument(newDoc);
      setShowReceiveForm(false);
      setAttachmentFile(null);
      setReceiveForm({
        subject: '',
        documentDirection: 'Incoming',
        documentTypeId: 'DT-001',
        documentTypeOther: '',
        status: 'Received',
        priorityLevel: 'normal',
        dateReceived: new Date().toISOString().split('T')[0],
        currentOfficeId: currentUser?.officeId || 'OFF-001',
        originOfficeOther: '',
        senderName: '',
        senderContact: '',
        senderEmail: '',
        notifySender: true,
        senderNotificationConsent: true,
        senderNotificationChannels: ['sms', 'email'],
        remarks: '',
        scannedText: '',
      });
    } catch {
      // The shared save handler already shows the API error.
    }
  };

  const handleRoute = async (e) => {
    e.preventDefault();
    const selectedDoc = documents.find(d => d.id === routeForm.documentId);
    if (!selectedDoc || !routableDocuments.some(doc => doc.id === selectedDoc.id)) {
      notify('Choose an approved Received, For Signing, or For Filing document from your assigned office.');
      return;
    }
    if (routeForm.fromOfficeId === routeForm.toOfficeId) {
      notify('Choose a different destination office before routing.');
      return;
    }
    const newTrans = {
      ...routeForm,
      fromOfficeId: currentUser?.officeId || routeForm.fromOfficeId,
    };
    try {
      await onAddTransmission(newTrans);
      setShowRouteForm(false);
    } catch {
      // The shared save handler already shows the API error.
    }
  };

  // Recent incoming docs
  const recentIncoming = [...documents]
    .filter(d => d.documentDirection === 'Incoming')
    .sort((a, b) => {
      const pDiff = (priorityOrder[a.priorityLevel] || 2) - (priorityOrder[b.priorityLevel] || 2);
      if (pDiff !== 0) return pDiff;
      return compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
    })
    .slice(0, 4);

  return (
    <div className="receptionist-dashboard">
      <div className="page-header page-header--align-bottom">
        <div className="page-header-left">
          <h1>Receptionist Dashboard</h1>
          <p>Scan, receive, route, and track documents efficiently</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={() => { setAttachmentFile(null); setShowReceiveForm(true); }}>
            <Inbox size={18} /> Register
          </button>
          {routableDocuments.length > 0 && (
            <button className="btn btn-primary" onClick={openRouteForm}>
              <Send size={18} /> Route
            </button>
          )}
        </div>
      </div>

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
              <p>Scan a document, save it, then wait for intake review</p>
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
              onClick={stat.onClick}
              title={`Open ${stat.label}`}
              style={{ textAlign: 'left' }}
            >
              <div className={`stat-icon ${stat.color}`}>{stat.icon}</div>
              <div className="stat-info">
                <p className="stat-label">{stat.label}</p>
                <p className="stat-value">{stat.value}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="tab-bar receptionist-tabs">
        <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`tab-btn ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>Incoming Docs</button>
        <button className={`tab-btn ${activeTab === 'routing' ? 'active' : ''}`} onClick={() => setActiveTab('routing')}>Pending</button>
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
                const pInfo = getPriorityInfo(doc.priorityLevel);
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
                    <div className={`activity-dot ${doc.priorityLevel === 'urgent' ? 'red' : getWorkflowStatus(doc) === 'Received' ? 'blue' : getWorkflowStatus(doc) === 'In Transit' ? 'amber' : 'green'}`}></div>
                    <div className="activity-item-body">
                      <p className="activity-text"><strong>{doc.subject}</strong></p>
                      <div className="activity-badges">
                        <span
                          className="activity-tag"
                          style={{ background: pInfo.bg, color: pInfo.color }}
                        >
                          {pInfo.label}
                        </span>
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
              <h3 className="card-title">Pending</h3>
              <span className="nav-badge">{pendingDocuments.length}</span>
            </div>
            {pendingDocuments.length > 0 ? (
              <div className="activity-list">
                {pendingDocuments.slice(0, 4).map(doc => {
                  const pInfo = getPriorityInfo(doc.priorityLevel);
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
                          <span
                            className="activity-tag"
                            style={{ background: pInfo.bg, color: pInfo.color }}
                          >
                            {pInfo.label}
                          </span>
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
          <table>
            <thead>
              <tr>
                <th>Tracking #</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Type</th>
                <th>Sender</th>
                <th>Status</th>
                <th>Date Received</th>
                <th>Workflow Note</th>
              </tr>
            </thead>
            <tbody>
              {documents.filter(d => d.documentDirection === 'Incoming').map(doc => {
                const pInfo = getPriorityInfo(doc.priorityLevel);
                return (
                  <tr
                    key={doc.id}
                    className="clickable-row"
                    onClick={() => openDocumentInterface(doc)}
                    title="Open document details"
                  >
                    <td><span className="td-mono">{doc.trackingNumber}</span></td>
                    <td className="td-primary">{doc.subject}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.15rem 0.5rem', borderRadius: '9999px',
                        fontSize: '0.7rem', fontWeight: 600,
                        background: pInfo.bg, color: pInfo.color,
                      }}>
                        <Flag size={10} />
                        {pInfo.label}
                      </span>
                    </td>
                    <td>{getDocTypeName(doc.documentTypeId)}</td>
                    <td style={{ fontSize: '0.8rem' }}>{doc.senderName || '—'}</td>
                    <td>
                      <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                        {getWorkflowStatus(doc)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{doc.dateReceived}</td>
                    <td><span className="workflow-explanation">{getDocumentPendingReason(doc)}</span></td>
                  </tr>
                );
              })}
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
                <th>Priority</th>
                <th>Current Status</th>
                <th>Pending For</th>
                <th>Date Received</th>
              </tr>
            </thead>
            <tbody>
              {pendingDocuments.map(doc => {
                const pInfo = getPriorityInfo(doc.priorityLevel);
                return (
                  <tr
                    key={doc.id}
                    className="clickable-row"
                    onClick={() => openDocumentInterface(doc)}
                    title="Open document details"
                  >
                    <td><span className="td-mono">{doc.trackingNumber}</span></td>
                    <td className="td-primary">{doc?.subject || '—'}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.15rem 0.5rem', borderRadius: '9999px',
                        fontSize: '0.7rem', fontWeight: 600,
                        background: pInfo.bg, color: pInfo.color,
                      }}>
                        <Flag size={10} />
                        {pInfo.label}
                      </span>
                    </td>
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
                    <td style={{ color: 'var(--text-muted)' }}>{doc.dateReceived}</td>
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
        <div className="modal-overlay" onClick={() => setShowReceiveForm(false)}>
          <div className="modal receptionist-register-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Register Document</h2>
              <button className="btn-icon" onClick={() => setShowReceiveForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleReceive}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Document Subject / Description</label>
                  <input className="form-input" type="text" value={receiveForm.subject}
                    onChange={e => setReceiveForm({ ...receiveForm, subject: e.target.value })}
                    placeholder="Enter document subject" required />
                  <p className="field-hint">Shortly describe the document so it is easy to find in tracking, tables, and reports.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Document Type</label>
                    <select className="form-select" value={receiveForm.documentTypeId}
                      onChange={e => setReceiveForm({ ...receiveForm, documentTypeId: e.target.value })}>
                      {documentTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.category}</option>)}
                    </select>
                    <p className="field-hint">Classifies the record for filters, reports, and workflow review.</p>
                    {isOtherDocumentType(receiveForm.documentTypeId) && (
                      <>
                        <input
                          className="form-input"
                          type="text"
                          value={receiveForm.documentTypeOther}
                          onChange={e => setReceiveForm({ ...receiveForm, documentTypeOther: e.target.value })}
                          placeholder="Specify document type"
                          required
                          style={{ marginTop: '0.5rem' }}
                        />
                        <p className="field-hint">Names the custom type when the document is not covered by the list.</p>
                      </>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <Flag size={12} style={{ marginRight: '0.25rem' }} />Priority Level
                    </label>
                    <div
                      className="priority-select-wrap"
                      style={{
                        '--priority-color': getPriorityInfo(receiveForm.priorityLevel).color,
                        '--priority-bg': getPriorityInfo(receiveForm.priorityLevel).bg,
                      }}
                    >
                      <span className="priority-color-preview"></span>
                      <select className="form-select priority-select" value={receiveForm.priorityLevel}
                        onChange={e => setReceiveForm({ ...receiveForm, priorityLevel: e.target.value })}>
                        {priorityLevels.map(p => (
                          <option key={p.id} value={p.id} style={{ color: p.color, backgroundColor: p.bg }}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <p className="field-hint">Controls queue urgency and highlights items that need faster attention.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Direction</label>
                    <select className="form-select" value={receiveForm.documentDirection}
                      onChange={e => setReceiveForm({ ...receiveForm, documentDirection: e.target.value })}
                      disabled>
                      <option>Incoming</option>
                    </select>
                    <p className="field-hint">Receptionist intake is always incoming because the sender brought the document in.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date Received</label>
                    <input className="form-input" type="date" value={receiveForm.dateReceived}
                      disabled required />
                    <p className="field-hint">Locked to the registration date.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Pending Workflow Status</label>
                    <select
                      className="form-select"
                      value={receiveForm.status}
                      onChange={e => setReceiveForm({ ...receiveForm, status: e.target.value })}
                    >
                      {registrationStatuses.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <p className="field-hint">Receptionists set this during registration. Mayor/Admin actions finish it after approval.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Receiving Office</label>
                    <select
                      className="form-select"
                      value={receiveForm.currentOfficeId}
                      disabled
                    >
                      {offices
                        .filter(o => o.id === receiveForm.currentOfficeId)
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">Your assigned office is the starting location of the record.</p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">External / Other Source Office</label>
                  <input
                    className="form-input"
                    type="text"
                    value={receiveForm.originOfficeOther}
                    onChange={e => setReceiveForm({ ...receiveForm, originOfficeOther: e.target.value })}
                    placeholder="School, agency, municipality, barangay, or other sender office"
                  />
                  <p className="field-hint">Use this when the source is outside the municipal office list.</p>
                </div>

                {/* Sender  Info */}
                <div style={{
                  padding: '0.75rem', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                  marginTop: '0.25rem',
                }}>
                  <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    <User size={12} style={{ marginRight: '0.25rem' }} />Sender Information
                  </p>
                  <div className="form-group">
                    <label className="form-label">Sender Name</label>
                    <input className="form-input" type="text" value={receiveForm.senderName}
                      onChange={e => setReceiveForm({ ...receiveForm, senderName: e.target.value })}
                      placeholder="Full name of the sender" />
                    <p className="field-hint">Identifies who submitted the document and appears in tracking details.</p>
                  </div>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label"><Phone size={12} style={{ marginRight: '0.25rem' }} />Contact</label>
                      <input className="form-input" type="tel" value={receiveForm.senderContact}
                        onChange={e => setReceiveForm({ ...receiveForm, senderContact: e.target.value })}
                        placeholder="09XX-XXX-XXXX" />
                      <p className="field-hint">Used for SMS tracking updates when sender notifications are enabled.</p>
                    </div>
                    <div className="form-group">
                      <label className="form-label"><Mail size={12} style={{ marginRight: '0.25rem' }} />Email</label>
                      <input className="form-input" type="email" value={receiveForm.senderEmail}
                        onChange={e => setReceiveForm({ ...receiveForm, senderEmail: e.target.value })}
                        placeholder="email@example.com" />
                      <p className="field-hint">Used for email updates about the document status.</p>
                    </div>
                  </div>
                  <div className="sender-notification-options">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={receiveForm.notifySender}
                        onChange={e => setReceiveForm({ ...receiveForm, notifySender: e.target.checked })}
                      />
                      Send tracking number and status updates to sender
                    </label>
                    <div className="sender-channel-options">
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(receiveForm.senderNotificationChannels || []).includes('sms')}
                          onChange={() => toggleSenderChannel('sms')}
                        />
                        SMS
                      </label>
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(receiveForm.senderNotificationChannels || []).includes('email')}
                          onChange={() => toggleSenderChannel('email')}
                        />
                        Email
                      </label>
                    </div>
                    <p className="field-hint">Choose how the sender will receive the tracking number and workflow updates.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label"><MessageSquare size={12} style={{ marginRight: '0.25rem' }} />Remarks</label>
                    <textarea className="form-input" value={receiveForm.remarks}
                      onChange={e => setReceiveForm({ ...receiveForm, remarks: e.target.value })}
                      placeholder="Notes" rows={2} style={{ resize: 'vertical' }} />
                    <p className="field-hint">Optional internal context, instructions, or special handling notes.</p>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">
                    <Upload size={12} style={{ marginRight: '0.25rem' }} />
                    Scanned File Attachment
                  </label>
                  <input
                    className="form-input"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={e => setAttachmentFile(e.target.files?.[0] || null)}
                  />
                  <p className="field-hint">Attach a scanned image or PDF, matching the Document Tracker form.</p>
                </div>

                <div style={{ padding: '0.75rem', background: 'var(--info-bg)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--info)', marginTop: '0.5rem' }}>
                  <AlertCircle size={16} />
                  A tracking number will be automatically generated upon submission.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowReceiveForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-success"><Inbox size={16} /> Register Document</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Route Document Modal */}
      {showRouteForm && (
        <div className="modal-overlay" onClick={() => setShowRouteForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Route Document</h2>
              <button className="btn-icon" onClick={() => setShowRouteForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleRoute}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Select Document</label>
                  <select className="form-select" value={routeForm.documentId}
                    onChange={e => setRouteForm({ ...routeForm, documentId: e.target.value })} required>
                    <option value="">Choose a document to route</option>
                    {routableDocuments.map(d => {
                      const pInfo = getPriorityInfo(d.priorityLevel);
                      return (
                        <option key={d.id} value={d.id}>
                          [{getWorkflowStatus(d)}] [{pInfo.label}] {d.trackingNumber} - {d.subject}
                        </option>
                      );
                    })}
                  </select>
                  <p className="field-hint">Only approved documents in your office that can be routed are listed here.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">From Office</label>
                    <select className="form-select" value={routeForm.fromOfficeId}
                      onChange={e => setRouteForm({ ...routeForm, fromOfficeId: e.target.value })}
                      disabled>
                      {offices
                        .filter(o => o.id === routeForm.fromOfficeId)
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">Your assigned office is the sending office for this route.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">To Office</label>
                    <select className="form-select" value={routeForm.toOfficeId}
                      onChange={e => setRouteForm({ ...routeForm, toOfficeId: e.target.value })}>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">The office that must receive and acknowledge the document next.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Transmission Type</label>
                    <select className="form-select" value={routeForm.transmissionType}
                      onChange={e => setRouteForm({ ...routeForm, transmissionType: e.target.value })}>
                      <option>Internal</option>
                      <option>External</option>
                    </select>
                    <p className="field-hint">Marks whether the transmission stays inside the municipality or leaves it.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input className="form-input" type="date" value={routeForm.transmissionDate}
                      onChange={e => setRouteForm({ ...routeForm, transmissionDate: e.target.value })} required />
                    <p className="field-hint">The official date recorded for the routing action.</p>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRouteForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><Send size={16} /> Route Document</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReceptionistDashboard;
