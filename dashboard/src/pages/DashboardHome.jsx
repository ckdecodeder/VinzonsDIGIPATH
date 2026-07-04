import React from 'react';
import {
  FileText,
  ArrowRightLeft,
  Archive,
  Building2,
  Users,
  TrendingUp,
  ArrowUpRight,
  ArrowRight,
  Inbox,
  Send,
  Clock,
  Flag,
} from 'lucide-react';
import { documentTypes as defaultDocumentTypes, getPriorityInfo } from '../data/mockData';
import { compareNewest } from '../utils/sorting';

const AdminDashboard = ({
  documents,
  transmissions,
  archives,
  offices,
  users: userList,
  documentTypes = defaultDocumentTypes,
  onNavigate,
  onOpenDocument,
  onStatusSelect,
  currentUser,
}) => {
  const getWorkflowStatus = (doc) => {
    if (doc.status === 'For Signature') return 'For Signing';
    if (doc.status === 'Acknoweledged') return 'Acknowledged';
    return doc.status || 'Received';
  };
  const totalDocs = documents.length;
  const inTransit = documents.filter(d => getWorkflowStatus(d) === 'In Transit').length;
  const received = documents.filter(d => getWorkflowStatus(d) === 'Received').length;
  const forSigning = documents.filter(d => getWorkflowStatus(d) === 'For Signing').length;
  const forFiling = documents.filter(d => getWorkflowStatus(d) === 'For Filing').length;
  const signed = documents.filter(d => getWorkflowStatus(d) === 'Signed').length;
  const acknowledged = documents.filter(d => getWorkflowStatus(d) === 'Acknowledged').length;
  const archived = archives.length;
  const urgentCount = documents.filter(d => d.priorityLevel === 'urgent' && getWorkflowStatus(d) !== 'Archived').length;

  const statCards = [
    { label: 'Total Documents', value: totalDocs, icon: <FileText size={22} />, color: 'blue', trend: '+12%', status: 'All' },
    { label: 'Urgent Items', value: urgentCount, icon: <Flag size={22} />, color: 'red', trend: 'Active', page: 'documents' },
    { label: 'Active Transmissions', value: transmissions.filter(t => !t.receivedBy).length, icon: <ArrowRightLeft size={22} />, color: 'purple', trend: `${transmissions.length} total`, page: 'transmissions' },
    { label: 'Archived', value: archived, icon: <Archive size={22} />, color: 'green', trend: 'All time', page: 'archives' },
  ];

  // Status distribution
  const statusCounts = [
    { label: 'Received', count: received, color: '#3b82f6' },
    { label: 'In Transit', count: inTransit, color: '#f59e0b' },
    { label: 'For Signing', count: forSigning, color: '#8b5cf6' },
    { label: 'For Filing', count: forFiling, color: '#087f8f' },
    { label: 'Signed', count: signed, color: '#059669' },
    { label: 'Acknowledged', count: acknowledged, color: '#0f766e' },
    { label: 'Archived', count: documents.filter(d => getWorkflowStatus(d) === 'Archived').length, color: '#10b981' },
  ];

  const total = statusCounts.reduce((s, c) => s + c.count, 0) || 1;
  let cumulative = 0;

  const recentTransmissions = [...transmissions]
    .sort((a, b) => compareNewest(a, b, ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']))
    .slice(0, 5);

  const recentDocs = [...documents].sort((a, b) => {
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    const pDiff = (priorityOrder[a.priorityLevel] || 2) - (priorityOrder[b.priorityLevel] || 2);
    if (pDiff !== 0) return pDiff;
    return compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
  }).slice(0, 6);

  const welcomeName = currentUser ? currentUser.fname : 'Admin';
  const canScan = currentUser?.role === 'Admin' || currentUser?.role === 'Receptionist';
  const canCreateDocument = currentUser?.role === 'Admin';

  const getOfficeName = (officeId) => {
    const office = offices.find(o => o.id === officeId);
    return office ? office.name : 'Unknown Office';
  };

  const getUserFullName = (userId) => {
    const user = userList.find(u => u.id === userId);
    return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : 'Unknown';
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

  const openStatusInterface = (status) => {
    if (onStatusSelect) {
      onStatusSelect(status);
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

  return (
    <div>
      <div className="page-header page-header--align-bottom">
        <div className="page-header-left">
          <h1>Dashboard</h1>
          <p>Welcome back, {welcomeName}. Here's an overview of your document system.</p>
        </div>
        <div className="page-header-actions">
          {canScan && (
            <button className="btn btn-secondary" onClick={() => onNavigate('scan-documents')}>
              <Inbox size={16} /> Scan
            </button>
          )}
          {canCreateDocument && (
            <button className="btn btn-primary" onClick={() => onNavigate('add-document')}>
              <FileText size={16} /> New Document
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {statCards.map((stat, i) => {
          const openStat = () => stat.status ? openStatusInterface(stat.status) : onNavigate(stat.page);
          return (
            <div
              key={i}
              className={`stat-card ${stat.color} clickable-row`}
              role="button"
              tabIndex={0}
              onClick={openStat}
              onKeyDown={(event) => handleKeyboardOpen(event, openStat)}
              title={`Open ${stat.label}`}
            >
              <div className={`stat-icon ${stat.color}`}>
                {stat.icon}
              </div>
              <div className="stat-info">
                <p className="stat-label">{stat.label}</p>
                <p className="stat-value">{stat.value}</p>
                {stat.trend && (
                  <p className="stat-trend up">
                    <TrendingUp size={12} /> {stat.trend}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts + Recent Activity */}
      <div className="grid-2-1">
        {/* Document Status Distribution */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Document Status</h3>
              <p className="card-subtitle">Distribution across all statuses</p>
            </div>
          </div>
          <div className="chart-donut">
            <div className="donut-ring">
              <svg width="190" height="190" viewBox="0 0 190 190">
                {statusCounts.map((seg, i) => {
                  const pct = (seg.count / total) * 100;
                  const circ = 2 * Math.PI * 72;
                  const dashLen = (pct / 100) * circ;
                  const dashOff = -(cumulative / 100) * circ;
                  cumulative += pct;
                  return (
                    <circle
                      key={i}
                      cx="95" cy="95" r="72"
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="16"
                      strokeDasharray={`${dashLen} ${circ - dashLen}`}
                      strokeDashoffset={dashOff}
                      strokeLinecap="round"
                      onClick={() => openStatusInterface(seg.label)}
                      style={{ transition: 'all 0.5s', cursor: 'pointer' }}
                    />
                  );
                })}
              </svg>
              <div className="donut-center">
                <span className="donut-total">{totalDocs}</span>
                <span className="donut-label">Total</span>
              </div>
            </div>
            <div className="donut-legend">
              {statusCounts.map((seg, i) => (
                <button
                  key={i}
                  type="button"
                  className="legend-item status-legend-button"
                  onClick={() => openStatusInterface(seg.label)}
                  title={`Show ${seg.label} documents`}
                >
                  <span className="legend-dot" style={{ background: seg.color }}></span>
                  {seg.label}
                  <span className="legend-value">{seg.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Activity</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('transmissions')}>
              View All <ArrowRight size={14} />
            </button>
          </div>
          <div className="activity-list">
            {recentTransmissions.map((t, i) => (
              <div
                key={t.id}
                className="activity-item clickable-row"
                role="button"
                tabIndex={0}
                onClick={() => onNavigate('transmissions')}
                onKeyDown={(event) => handleKeyboardOpen(event, () => onNavigate('transmissions'))}
                title="Open transmissions"
              >
                <div className={`activity-dot ${['blue', 'green', 'purple', 'amber'][i % 4]}`}></div>
                <div>
                  <p className="activity-text">
                    <strong>{getUserFullName(t.sentBy)}</strong> sent a document from{' '}
                    <strong>{getOfficeName(t.fromOfficeId)}</strong> to{' '}
                    <strong>{getOfficeName(t.toOfficeId)}</strong>
                  </p>
                  <p className="activity-time">
                    <Clock size={10} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    {t.transmissionDate}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Documents Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recent Documents</h3>
            <p className="card-subtitle">Latest documents — sorted by priority</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('documents')}>
            View All <ArrowRight size={14} />
          </button>
        </div>
        <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Tracking #</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Type</th>
                <th>Sender</th>
                <th>Direction</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentDocs.map(doc => {
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
                      <span className={`direction-badge direction-${doc.documentDirection.toLowerCase()}`}>
                        {doc.documentDirection === 'Incoming' ? <Inbox size={12} /> : <Send size={12} />}
                        {' '}{doc.documentDirection}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                        {getWorkflowStatus(doc)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{doc.dateReceived}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
