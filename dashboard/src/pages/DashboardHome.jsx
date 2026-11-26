import { countWorkflowStatuses, getWorkflowStatus, workflowStatusColors } from '../utils/documentWorkflow.js';
import { manilaDate } from '../utils/philippinesDateTime.js';
import { getDocumentNextAction, matchesQueue } from '../utils/documentQueue';
import React, { useState } from "react";
import {
  FileText,
  ArrowRightLeft,
  Archive,
  ArrowRight,
  Inbox,
  Flag,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  documentTypes as defaultDocumentTypes,
  getPriorityInfo,
} from "../data/mockData";
import { compareNewest } from "../utils/sorting";
import PageShell from "../components/PageShell";

const AdminDashboard = ({
  dataStates = {},
  documents,
  transmissions,
  archives,
  offices,
  documentTypes = defaultDocumentTypes,
  onNavigate,
  onPreviewDocument,
  onStatusSelect,
  currentUser,
}) => {
  const [activityView, setActivityView] = useState("documents");
  const statusCounts = countWorkflowStatuses(documents);
  const totalDocs = documents.length;
  const documentsReady = dataStates.documents?.status === 'ready';
  const visibleArchiveRegister = ['Admin', 'Mayor'].includes(currentUser?.role);
  const actionQueueSections = ['documents', 'transmissions', 'documentTypes'];
  const actionQueueReady = actionQueueSections.every(key => dataStates[key]?.status === 'ready');
  const actionQueueFailed = actionQueueSections.some(key => dataStates[key]?.status === 'error');
  const urgentCount = documents.filter(
    (d) => matchesQueue(d, 'Urgent active', currentUser, transmissions, documentTypes),
  ).length;
  const pendingReceiptCount = documents.filter(d => matchesQueue(d, 'Pending receipt', currentUser, transmissions, documentTypes)).length;
  const readyToArchiveCount = documents.filter(d => matchesQueue(d, 'Ready to archive', currentUser, transmissions, documentTypes)).length;

  const statCards = [
    {
      label: "Total Documents",
      value: dataStates.documents?.status === 'ready' ? totalDocs : '—',
      icon: <FileText size={22} />,
      color: "blue",
      status: "All",
    },
    {
      label: "Urgent Items",
      value: actionQueueReady ? urgentCount : '—',
      icon: <Flag size={22} />,
      color: "red",
      status: "Urgent active",
    },
    {
      label: "Awaiting your receipt",
      value: actionQueueReady ? pendingReceiptCount : '—',
      icon: <ArrowRightLeft size={22} />,
      color: "purple",
      status: "Pending receipt",
    },
    {
      label: "Archived",
      value: documentsReady && (!visibleArchiveRegister || dataStates.archives?.status === 'ready')
        ? (visibleArchiveRegister ? archives.length : statusCounts.Archived) : '—',
      icon: <Archive size={22} />,
      color: "green",
      ...(visibleArchiveRegister ? { page: "archives" } : { status: "Archived" }),
    },
  ];

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const actionStatusRank = {
    Received: 0,
    "In Transit": 1,
    "For Signing": 2,
    "For Filing": 3,
  };

  const attentionDocuments = documents
    .filter(doc => matchesQueue(doc, 'Needs your action', currentUser, transmissions, documentTypes))
    .sort((a, b) => {
      const pendingDiff =
        Number(b.intakeStatus === "Pending Review") -
        Number(a.intakeStatus === "Pending Review");
      if (pendingDiff !== 0) return pendingDiff;
      const receivedDiff =
        Number(getWorkflowStatus(b) === "Received") -
        Number(getWorkflowStatus(a) === "Received");
      if (receivedDiff !== 0) return receivedDiff;
      const urgentDiff =
        Number(b.priorityLevel === "urgent") - Number(a.priorityLevel === "urgent");
      if (urgentDiff !== 0) return urgentDiff;
      const statusDiff =
        (actionStatusRank[getWorkflowStatus(a)] ?? 9) -
        (actionStatusRank[getWorkflowStatus(b)] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      return compareNewest(a, b, ["createdAt", "updatedAt", "dateReceived"]);
    });

  const newlyReceivedCount = documents.filter(
    (d) => matchesQueue(d, 'Newly received', currentUser, transmissions, documentTypes),
  ).length;
  const pendingReviewCount = documents.filter(
    (d) => matchesQueue(d, 'Pending review', currentUser, transmissions, documentTypes),
  ).length;
  const actionQueueCount = attentionDocuments.length;

  const recentTransmissions = [...transmissions]
    .sort((a, b) =>
      compareNewest(a, b, [
        "createdAt",
        "updatedAt",
        "receivedAt",
        "transmissionDate",
      ]),
    )
    .slice(0, 4);

  const recentDocs = [...documents]
    .sort((a, b) => {
      const pDiff =
        (priorityRank[a.priorityLevel] ?? 2) -
        (priorityRank[b.priorityLevel] ?? 2);
      if (pDiff !== 0) return pDiff;
      return compareNewest(a, b, ["createdAt", "updatedAt", "dateReceived"]);
    })
    .slice(0, 5);

  const canScan =
    currentUser?.role === "Admin" || currentUser?.role === "Receptionist";
  const canCreateDocument =
    currentUser?.role === "Admin" || currentUser?.role === "Office";

  const getOfficeName = (officeId) => {
    const office = offices.find((o) => o.id === officeId);
    return office ? office.name : "Unknown Office";
  };

  const openDocumentInterface = (doc) => {
    if (!doc) return;
    // Preview popup on the dashboard — do NOT navigate to All Documents
    if (onPreviewDocument) {
      onPreviewDocument(doc);
      return;
    }
  };

  const openStatusInterface = (status) => {
    // View all / status cards → All Documents page
    if (onStatusSelect) {
      onStatusSelect(status);
      return;
    }
    onNavigate("documents");
  };

  return (
    <PageShell className="staff-dashboard"
      header={
        <div className="page-header">
          <div className="page-header-left">
            <h1>Dashboard</h1>
            <p>
              Welcome back{currentUser?.fname ? `, ${currentUser.fname}` : ""}.{" "}
              {currentUser?.role === "Office"
                ? "Send documents to reception or other offices and track their progress."
                : "Focus on newly received documents that need action first."}
            </p>
          </div>
          <div className="page-header-actions">
            {canScan && (
              <button
                className="btn btn-secondary"
                onClick={() => onNavigate("scan-documents")}
              >
                <Inbox size={16} /> Scan
              </button>
            )}
            {canCreateDocument && (
              <button
                className="btn btn-primary"
                onClick={() => onNavigate("add-document")}
              >
                <FileText size={16} /> New Document
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="stats-grid" role="group" aria-label="Document totals">
        {statCards.map(stat => (
          <button key={stat.label} type="button" className={`stat-card ${stat.color}`}
            title={`Open ${stat.label}`}
            onClick={() => stat.status ? openStatusInterface(stat.status) : onNavigate(stat.page)}>
            <span className={`stat-icon ${stat.color}`} aria-hidden="true">{stat.icon}</span>
            <span className="stat-info">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value">{stat.value}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="dashboard-priority-grid">
        <div className="card dashboard-attention-card">
          <div className="card-header dashboard-attention-header">
            <div>
              <div className="attention-title-row">
                <h2 className="card-title">Needs your action</h2>
                {actionQueueReady && actionQueueCount > 0 && (
                  <span className="attention-count-pill">{actionQueueCount}</span>
                )}
              </div>

            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!actionQueueReady}
              onClick={() => openStatusInterface("Needs your action")}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>

          <div className="attention-summary-chips">
            <button
              type="button"
              className="attention-chip attention-chip--received"
              disabled={!actionQueueReady}
              onClick={() => openStatusInterface("Newly received")}
            >
              <Inbox size={13} />
              {actionQueueReady ? newlyReceivedCount : '—'} newly received
            </button>
            <button
              type="button"
              className="attention-chip attention-chip--review"
              disabled={!actionQueueReady}
              onClick={() => openStatusInterface("Pending review")}
            >
              <AlertTriangle size={13} />
              {actionQueueReady ? pendingReviewCount : '—'} pending review
            </button>
            <button
              type="button"
              className="attention-chip attention-chip--urgent"
              disabled={!actionQueueReady}
              onClick={() => openStatusInterface("Urgent active")}
            >
              <Flag size={13} />
              {actionQueueReady ? urgentCount : '—'} urgent
            </button>
            {['Admin', 'Mayor'].includes(currentUser?.role) && (
              <button type="button" className="attention-chip" disabled={!actionQueueReady} onClick={() => openStatusInterface('Ready to archive')}>
                <Archive size={13} /> {actionQueueReady ? readyToArchiveCount : '—'} ready to archive
              </button>
            )}
          </div>
          <div className="attention-list">
            {!actionQueueReady ? (
              <div className="attention-empty" role="status">
                <Clock size={20} />
                <p>{actionQueueFailed ? 'Action queue unavailable' : 'Loading action queue'}</p>
                <span>Counts and next steps require documents, deliveries and document types. Use the section status to retry failed data.</span>
              </div>
            ) : attentionDocuments.length === 0 ? (
              <div className="attention-empty">
                <CheckCircle2 size={20} strokeWidth={1.75} />
                <p>No action waiting for you</p>
                <span>Documents awaiting another office remain available in All Documents.</span>
              </div>
            ) : (
              attentionDocuments.slice(0, 4).map((doc) => {
                const status = getWorkflowStatus(doc);
                const pInfo = getPriorityInfo(doc.priorityLevel);
                const hint = getDocumentNextAction(doc, currentUser, transmissions, documentTypes);

                return (
                  <button
                    key={doc.id}
                    type="button"
                    className={doc.priorityLevel === "urgent" ? "attention-item attention-item--urgent" : "attention-item"}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openDocumentInterface(doc);
                    }}
                    title={`Open ${doc.trackingNumber}`}
                  >
                    <div className="attention-item-main">
                      <p className="attention-item-subject">{doc.subject}</p>
                      <p className="attention-item-sub">
                        {doc.trackingNumber}
                        <span aria-hidden="true">·</span>
                        {hint}
                        <span aria-hidden="true">·</span>
                        {getOfficeName(doc.currentOfficeId || doc.originOfficeId)}
                      </p>
                    </div>
                    <div className="attention-item-side">
                      {doc.priorityLevel && doc.priorityLevel !== "normal" && <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.2rem",
                          padding: "0.12rem 0.45rem",
                          borderRadius: "9999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: pInfo.bg,
                          color: pInfo.color,
                        }}
                      >
                        <Flag size={9} />
                        {pInfo.label}
                      </span>}
                      <span
                        className={`status-badge status-${status.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {doc.intakeStatus === "Pending Review" ? "Pending Review" : status}
                      </span>
                      <span className="attention-item-date">
                        {manilaDate(doc.dateReceived || doc.updatedAt || "") || "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card dashboard-status-card dashboard-status-card--mini">
          <div className="card-header">
            <h2 className="card-title">Status overview</h2>
            <span className="status-mini-total">{documentsReady ? totalDocs : '—'} docs</span>
          </div>
          <div className="status-mini-bars">
            {!documentsReady && <p className="attention-empty-inline" role="status">{dataStates.documents?.status === 'error' ? 'Document totals unavailable.' : 'Loading document totals…'}</p>}
            {Object.entries(statusCounts)
              .filter(([, count]) => count > 0)
              .map(([label, count]) => {
                const pct = (count / totalDocs) * 100;
                return (
                  <button
                    key={label}
                    type="button"
                    className="status-mini-row"
                    onClick={() => openStatusInterface(label)}
                    title={`Show ${label} documents`}
                  >
                    <span className="status-mini-label">{label}</span>
                    <span className="status-mini-track">
                      <span
                        className="status-mini-fill"
                        style={{ width: `${pct}%`, background: Object.hasOwn(workflowStatusColors, label) ? workflowStatusColors[label] : 'var(--text-muted)' }}
                      />
                    </span>
                    <span className="status-mini-count">{count}</span>
                  </button>
                );
              })}
            {documentsReady && totalDocs === 0 && (
              <p className="attention-empty-inline">No documents yet.</p>
            )}
          </div>
        </div>
      </div>

      <section className="card dashboard-records" aria-label="Recent activity">
        <div className="card-header">
          <div className="activity-views" role="group" aria-label="Dashboard activity views">
            <button type="button" aria-pressed={activityView === "documents"} onClick={() => setActivityView("documents")}>Documents by priority</button>
            <button type="button" aria-pressed={activityView === "transfers"} onClick={() => setActivityView("transfers")}>Recent transfers</button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate(activityView === "documents" ? "documents" : "logs")}>
            {activityView === "documents" ? "View documents" : "Activity log"} <ArrowRight size={14} />
          </button>
        </div>
        {activityView === "transfers" ? (
          <div className="activity-list dashboard-transfer-list">
            {recentTransmissions.length === 0 ? (
              <p className="attention-empty-inline" role="status">
                {dataStates.transmissions?.status === 'ready' ? 'No recent transfers.'
                  : dataStates.transmissions?.status === 'error' ? 'Recent transfers unavailable.' : 'Loading recent transfers…'}
              </p>
            ) : (
              recentTransmissions.map(t => {
                const doc = documents.find(item => item.id === t.documentId);
                return (
                  <div key={t.id} className="activity-item">
                    <div className="activity-item-body">
                      {doc ? (
                        <button className="row-open-control transfer-document" type="button" onClick={() => openDocumentInterface(doc)}>
                          {doc.trackingNumber || doc.id} · {doc.subject || 'Open document'}
                        </button>
                      ) : <strong>{t.documentId || 'Document'}</strong>}
                      <p className="activity-text">{getOfficeName(t.fromOfficeId)} → <strong>{getOfficeName(t.toOfficeId)}</strong></p>
                      <p className="activity-time">
                        <Clock size={12} /> {manilaDate(t.transmissionDate || '') || 'Date unrecorded'} · {t.receivedBy ? 'Received' : 'Awaiting receipt'}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div
            className="table-container"
            style={{ border: "none", borderRadius: 0 }}
          >
            <table aria-label="Documents sorted by priority, then newest first">
              <thead>
                <tr>
                  <th>Tracking #</th>
                  <th>Subject</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.length === 0 && <tr><td colSpan={5}>{documentsReady ? "No documents yet." : dataStates.documents?.status === "error" ? "Recent documents unavailable." : "Loading recent documents…"}</td></tr>}
                {recentDocs.map((doc) => {
                  const pInfo = getPriorityInfo(doc.priorityLevel);
                  return (
                    <tr
                      key={doc.id}
                      className="clickable-row"
                      onClick={() => openDocumentInterface(doc)}
                      title="Open document details"
                    >
                      <td>
                        <button type="button" className="row-open-control td-mono" aria-label={`Open document ${doc.subject}`} onClick={event => { event.stopPropagation(); openDocumentInterface(doc); }}>{doc.trackingNumber}</button>
                      </td>
                      <td className="td-primary">{doc.subject}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: pInfo.bg,
                            color: pInfo.color,
                          }}
                        >
                          <Flag size={10} />
                          {pInfo.label}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {getWorkflowStatus(doc)}
                        </span>
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {manilaDate(doc.dateReceived || "") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
};

export default AdminDashboard;
