import React from "react";
import {
  FileText,
  ArrowRightLeft,
  Archive,
  TrendingUp,
  ArrowRight,
  Inbox,
  Send,
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

const ACTION_STATUSES = new Set([
  "Received",
  "In Transit",
  "For Signing",
  "For Filing",
]);

const STATUS_ACTION_HINT = {
  Received: "Process or route",
  "In Transit": "Acknowledge receipt",
  "For Signing": "Ready for signature",
  "For Filing": "Ready for filing",
};

const AdminDashboard = ({
  dataStates = {},
  documents,
  transmissions,
  archives,
  offices,
  users: userList = [],
  documentTypes = defaultDocumentTypes,
  onNavigate,
  onPreviewDocument,
  onStatusSelect,
  currentUser,
}) => {
  const getWorkflowStatus = (doc) => {
    if (doc.status === "For Signature") return "For Signing";
    if (doc.status === "Acknoweledged") return "Acknowledged";
    return doc.status || "Received";
  };
  const totalDocs = documents.length;
  const inTransit = documents.filter(
    (d) => getWorkflowStatus(d) === "In Transit",
  ).length;
  const received = documents.filter(
    (d) => getWorkflowStatus(d) === "Received",
  ).length;
  const forSigning = documents.filter(
    (d) => getWorkflowStatus(d) === "For Signing",
  ).length;
  const forFiling = documents.filter(
    (d) => getWorkflowStatus(d) === "For Filing",
  ).length;
  const signed = documents.filter(
    (d) => getWorkflowStatus(d) === "Signed",
  ).length;
  const acknowledged = documents.filter(
    (d) => getWorkflowStatus(d) === "Acknowledged",
  ).length;
  const archived = archives.length;
  const urgentCount = documents.filter(
    (d) => d.priorityLevel === "urgent" && getWorkflowStatus(d) !== "Archived",
  ).length;

  const statCards = [
    {
      label: "Total Documents",
      value: dataStates.documents?.status === 'ready' ? totalDocs : '—',
      icon: <FileText size={22} />,
      color: "blue",
      trend: "+12%",
      status: "All",
    },
    {
      label: "Urgent Items",
      value: dataStates.documents?.status === 'ready' ? urgentCount : '—',
      icon: <Flag size={22} />,
      color: "red",
      trend: "Active",
      page: "documents",
    },
    {
      label: "Active Transmissions",
      value: dataStates.transmissions?.status === 'ready' ? transmissions.filter((t) => !t.receivedBy).length : '—',
      icon: <ArrowRightLeft size={22} />,
      color: "purple",
      trend: dataStates.transmissions?.status === 'ready' ? `${transmissions.length} total` : 'Unavailable',
      page: "transmissions",
    },
    {
      label: "Archived",
      value: dataStates.archives?.status === 'ready' ? archived : '—',
      icon: <Archive size={22} />,
      color: "green",
      trend: "All time",
      page: "archives",
    },
  ];

  // Status distribution
  const statusCounts = [
    { label: "Received", count: received, color: "#3b82f6" },
    { label: "In Transit", count: inTransit, color: "#f59e0b" },
    { label: "For Signing", count: forSigning, color: "#8b5cf6" },
    { label: "For Filing", count: forFiling, color: "#087f8f" },
    { label: "Signed", count: signed, color: "#059669" },
    { label: "Acknowledged", count: acknowledged, color: "#0f766e" },
    {
      label: "Archived",
      count: documents.filter((d) => getWorkflowStatus(d) === "Archived")
        .length,
      color: "#10b981",
    },
  ];

  const statusTotal = statusCounts.reduce((s, c) => s + c.count, 0);
  const total = statusTotal || 1;

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const actionStatusRank = {
    Received: 0,
    "In Transit": 1,
    "For Signing": 2,
    "For Filing": 3,
  };

  const needsImmediateAction = (doc) => {
    const status = getWorkflowStatus(doc);
    if (status === "Archived") return false;
    if (doc.intakeStatus === "Pending Review" || doc.intakeStatus === "Rejected") return true;
    if (ACTION_STATUSES.has(status)) return true;
    return doc.priorityLevel === "urgent";
  };

  const attentionDocuments = [...documents]
    .filter(needsImmediateAction)
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
    })
    .slice(0, 12);

  const newlyReceivedCount = documents.filter(
    (d) => getWorkflowStatus(d) === "Received" && d.intakeStatus !== "Rejected",
  ).length;
  const pendingReviewCount = documents.filter(
    (d) => d.intakeStatus === "Pending Review",
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
        (priorityRank[a.priorityLevel] || 2) -
        (priorityRank[b.priorityLevel] || 2);
      if (pDiff !== 0) return pDiff;
      return compareNewest(a, b, ["createdAt", "updatedAt", "dateReceived"]);
    })
    .slice(0, 6);

  const welcomeName = currentUser ? currentUser.fname : "Admin";
  const canScan =
    currentUser?.role === "Admin" || currentUser?.role === "Receptionist";
  const canCreateDocument =
    currentUser?.role === "Admin" || currentUser?.role === "Office";

  const getOfficeName = (officeId) => {
    const office = offices.find((o) => o.id === officeId);
    return office ? office.name : "Unknown Office";
  };

  const getUserFullName = (userId) => {
    const user = userList.find((u) => u.id === userId);
    return user
      ? `${user.fname} ${user.mname || ""} ${user.lname}`
          .replace(/\s+/g, " ")
          .trim()
      : "Unknown";
  };

  const getDocTypeName = (typeId) => {
    const docType = documentTypes.find((d) => d.id === typeId);
    return docType ? docType.category : "Unknown";
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

  const handleKeyboardOpen = (event, action) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

  return (
    <PageShell
      header={
        <div className="page-header page-header--align-bottom">
          <div className="page-header-left">
            <h1>Dashboard</h1>
            <p>
              Welcome back, {welcomeName}.{" "}
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
      {/* Stats */}
      <div className="stats-grid">
        {statCards.map((stat, i) => {
          const openStat = () =>
            stat.status
              ? openStatusInterface(stat.status)
              : onNavigate(stat.page);
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
              <div className={`stat-icon ${stat.color}`}>{stat.icon}</div>
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

      {/* Action queue (primary) + compact status / activity */}
      <div className="dashboard-priority-grid">
        <div className="card dashboard-attention-card">
          <div className="card-header dashboard-attention-header">
            <div>
              <div className="attention-title-row">
                <h3 className="card-title">Needs Immediate Attention</h3>
                {actionQueueCount > 0 && (
                  <span className="attention-count-pill">{actionQueueCount}</span>
                )}
              </div>
              <p className="attention-header-meta">
                Newly received and pending documents that need action — process these first.
              </p>
              <div className="attention-summary-chips">
                <button
                  type="button"
                  className="attention-chip attention-chip--received"
                  onClick={() => openStatusInterface("Received")}
                >
                  <Inbox size={13} />
                  {newlyReceivedCount} newly received
                </button>
                <button
                  type="button"
                  className="attention-chip attention-chip--review"
                  onClick={() => openStatusInterface("All")}
                >
                  <AlertTriangle size={13} />
                  {pendingReviewCount} pending review
                </button>
                <button
                  type="button"
                  className="attention-chip attention-chip--urgent"
                  onClick={() => onNavigate("documents")}
                >
                  <Flag size={13} />
                  {urgentCount} urgent
                </button>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => openStatusInterface("All")}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>

          <div className="attention-list">
            {attentionDocuments.length === 0 ? (
              <div className="attention-empty">
                <CheckCircle2 size={20} strokeWidth={1.75} />
                <p>You're all caught up</p>
                <span>Newly received documents that need action will appear here.</span>
              </div>
            ) : (
              attentionDocuments.map((doc) => {
                const status = getWorkflowStatus(doc);
                const pInfo = getPriorityInfo(doc.priorityLevel);
                const isNewReceived =
                  status === "Received" || doc.intakeStatus === "Pending Review";
                const hint =
                  doc.intakeStatus === "Pending Review"
                    ? "Needs intake review"
                    : doc.intakeStatus === "Rejected"
                      ? "Needs correction"
                      : STATUS_ACTION_HINT[status] || "Needs follow-up";

                return (
                  <button
                    key={doc.id}
                    type="button"
                    className={[
                      "attention-item",
                      doc.priorityLevel === "urgent" ? "attention-item--urgent" : "",
                      isNewReceived ? "attention-item--new" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openDocumentInterface(doc);
                    }}
                    title={`Open ${doc.trackingNumber}`}
                  >
                    <div className="attention-item-main">
                      <div className="attention-item-topline">
                        {isNewReceived && (
                          <span className="attention-new-badge">New</span>
                        )}
                        <p className="attention-item-subject">{doc.subject}</p>
                      </div>
                      <p className="attention-item-sub">
                        {doc.trackingNumber}
                        <span aria-hidden="true">·</span>
                        {hint}
                        <span aria-hidden="true">·</span>
                        {getOfficeName(doc.currentOfficeId || doc.originOfficeId)}
                      </p>
                    </div>
                    <div className="attention-item-side">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.2rem",
                          padding: "0.12rem 0.45rem",
                          borderRadius: "9999px",
                          fontSize: "0.65rem",
                          fontWeight: 600,
                          background: pInfo.bg,
                          color: pInfo.color,
                        }}
                      >
                        <Flag size={9} />
                        {pInfo.label}
                      </span>
                      <span
                        className={`status-badge status-${status.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {doc.intakeStatus === "Pending Review" ? "Pending Review" : status}
                      </span>
                      <span className="attention-item-date">
                        {doc.dateReceived || doc.updatedAt?.slice?.(0, 10) || "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="dashboard-side-stack">
          <div className="card dashboard-status-card dashboard-status-card--mini">
            <div className="card-header">
              <h3 className="card-title">Status overview</h3>
              <span className="status-mini-total">{statusTotal} docs</span>
            </div>
            <div className="status-mini-bars">
              {statusCounts
                .filter((seg) => seg.count > 0)
                .map((seg) => {
                  const pct = Math.max((seg.count / total) * 100, 4);
                  return (
                    <button
                      key={seg.label}
                      type="button"
                      className="status-mini-row"
                      onClick={() => openStatusInterface(seg.label)}
                      title={`Show ${seg.label} documents`}
                    >
                      <span className="status-mini-label">{seg.label}</span>
                      <span className="status-mini-track">
                        <span
                          className="status-mini-fill"
                          style={{ width: `${pct}%`, background: seg.color }}
                        />
                      </span>
                      <span className="status-mini-count">{seg.count}</span>
                    </button>
                  );
                })}
              {statusTotal === 0 && (
                <p className="attention-empty-inline">No documents yet.</p>
              )}
            </div>
          </div>

          <div className="card dashboard-activity-card">
            <div className="card-header">
              <h3 className="card-title">Recent Activity</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onNavigate("logs")}
              >
                View all <ArrowRight size={14} />
              </button>
            </div>
            <div className="activity-list">
              {recentTransmissions.length === 0 ? (
                <p className="attention-empty-inline">No recent activity.</p>
              ) : (
                recentTransmissions.map((t, i) => (
                  <div
                    key={t.id}
                    className="activity-item clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onNavigate("logs")}
                    onKeyDown={(event) =>
                      handleKeyboardOpen(event, () => onNavigate("logs"))
                    }
                    title="Open activity logs"
                  >
                    <div
                      className={`activity-dot ${["blue", "green", "purple", "amber"][i % 4]}`}
                    ></div>
                    <div className="activity-item-body">
                      <p className="activity-text">
                        <strong>{getUserFullName(t.sentBy)}</strong> sent a document
                        from <strong>{getOfficeName(t.fromOfficeId)}</strong> to{" "}
                        <strong>{getOfficeName(t.toOfficeId)}</strong>
                      </p>
                      <p className="activity-time">
                        <Clock size={10} />
                        {t.transmissionDate}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Documents Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recent Documents</h3>
            <p className="card-subtitle">
              Latest documents — sorted by priority
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onNavigate("documents")}
          >
            View All <ArrowRight size={14} />
          </button>
        </div>
        <div
          className="table-container"
          style={{ border: "none", borderRadius: 0 }}
        >
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
                      <span className="td-mono">{doc.trackingNumber}</span>
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
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          background: pInfo.bg,
                          color: pInfo.color,
                        }}
                      >
                        <Flag size={10} />
                        {pInfo.label}
                      </span>
                    </td>
                    <td>{getDocTypeName(doc.documentTypeId)}</td>
                    <td style={{ fontSize: "0.8rem" }}>
                      {doc.senderName || "—"}
                    </td>
                    <td>
                      <span
                        className={`direction-badge direction-${doc.documentDirection.toLowerCase()}`}
                      >
                        {doc.documentDirection === "Incoming" ? (
                          <Inbox size={12} />
                        ) : (
                          <Send size={12} />
                        )}{" "}
                        {doc.documentDirection}
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
                      {doc.dateReceived}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
};

export default AdminDashboard;
