import React, { useEffect, useState } from "react";
import PageShell from "../components/PageShell";
import {
  Search,
  FileText,
  ArrowRightLeft,
  Archive,
  ScanLine,
  LogIn,
  Monitor,
  Clock,
  User,
  Filter,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { users as defaultUsers } from "../data/mockData";

const actionConfig = {
  document_received: {
    label: "Document Received",
    icon: <FileText size={14} />,
    color: "var(--info)",
    bg: "var(--info-bg)",
  },
  document_scanned: {
    label: "Document Scanned",
    icon: <ScanLine size={14} />,
    color: "var(--accent)",
    bg: "rgba(6, 182, 212, 0.12)",
  },
  transmission_created: {
    label: "Transmission Created",
    icon: <ArrowRightLeft size={14} />,
    color: "var(--primary-light)",
    bg: "var(--primary-glow)",
  },
  transmission_received: {
    label: "Transmission Received",
    icon: <CheckCircle2 size={14} />,
    color: "var(--success)",
    bg: "var(--success-bg)",
  },
  document_archived: {
    label: "Document Archived",
    icon: <Archive size={14} />,
    color: "var(--success)",
    bg: "var(--success-bg)",
  },
  document_approved: {
    label: "Document Approved",
    icon: <CheckCircle2 size={14} />,
    color: "var(--success)",
    bg: "var(--success-bg)",
  },
  document_rejected: {
    label: "Document Rejected",
    icon: <AlertCircle size={14} />,
    color: "var(--danger)",
    bg: "var(--danger-bg)",
  },
  document_resubmitted: {
    label: "Document Resubmitted",
    icon: <FileText size={14} />,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
  },
  ready_for_signing: {
    label: "Marked For Signing",
    icon: <Clock size={14} />,
    color: "var(--primary-light)",
    bg: "var(--primary-glow)",
  },
  action_note: {
    label: "Document Action Note",
    icon: <FileText size={14} />,
    color: "var(--text-secondary)",
    bg: "rgba(148, 163, 184, 0.12)",
  },
  ready_for_signature: {
    label: "Marked For Signing",
    icon: <FileText size={14} />,
    color: "#7c3aed",
    bg: "rgba(139, 92, 246, 0.12)",
  },
  ready_for_filing: {
    label: "Marked For Filing",
    icon: <Archive size={14} />,
    color: "var(--accent)",
    bg: "rgba(8, 145, 178, 0.12)",
  },
  sign_document: {
    label: "Document Signed",
    icon: <CheckCircle2 size={14} />,
    color: "var(--success)",
    bg: "var(--success-bg)",
  },
  acknowledge_document: {
    label: "Document Acknowledged",
    icon: <CheckCircle2 size={14} />,
    color: "#0f766e",
    bg: "rgba(15, 118, 110, 0.12)",
  },
  user_login: {
    label: "User Login",
    icon: <LogIn size={14} />,
    color: "var(--text-secondary)",
    bg: "rgba(148, 163, 184, 0.12)",
  },
  user_logout: {
    label: "User Logout",
    icon: <LogIn size={14} />,
    color: "var(--text-muted)",
    bg: "rgba(148, 163, 184, 0.08)",
  },
  device_status: {
    label: "Device Status",
    icon: <Monitor size={14} />,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
  },
  document_edited: {
    label: "Document Edited",
    icon: <FileText size={14} />,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
  },
  document_deleted: {
    label: "Document Deleted",
    icon: <AlertCircle size={14} />,
    color: "var(--danger)",
    bg: "var(--danger-bg)",
  },
};

const ActivityLogs = ({ logs, users = defaultUsers }) => {
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("All");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const getUserFullName = (userId) => {
    const user = users.find((u) => u.id === userId);
    return user
      ? `${user.fname} ${user.mname || ""} ${user.lname}`
          .replace(/\s+/g, " ")
          .trim()
      : "Unknown";
  };

  const actionTypes = ["All", ...new Set(logs.map((l) => l.action))];
  const formatActionLabel = (action) => {
    if (action === "All") return "All Activities";
    return (
      actionConfig[action]?.label ||
      action
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    );
  };

  const filtered = logs
    .filter((l) => {
      const matchSearch =
        l.details.toLowerCase().includes(search.toLowerCase()) ||
        getUserFullName(l.userId)
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        (l.referenceId || "").toLowerCase().includes(search.toLowerCase());
      const matchAction = filterAction === "All" || l.action === filterAction;
      return matchSearch && matchAction;
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedLogs = filtered.slice((page - 1) * pageSize, page * pageSize);
  const showFrom = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showTo = Math.min(page * pageSize, filtered.length);

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    const normalized = Math.min(Math.max(1, newPage), totalPages);
    setPage(normalized);
  };

  useEffect(() => {
    setPage(1);
  }, [search, filterAction, logs]);

  const formatTimestamp = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getRelativeTime = (ts) => {
    const now = new Date();
    const d = new Date(ts);
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <PageShell
      header={
        <div className="page-header">
          <div className="page-header-left">
            <h1>Activity Logs</h1>
            <p>Complete audit trail of all system activities</p>
          </div>
        </div>
      }
      toolbar={
        <div className="activity-filter-row">
          <div className="search-bar">
            <Search size={16} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="activity-filter-dropdown">
            <select
              id="actionFilter"
              className="form-select activity-filter-select"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              {actionTypes.map((a) => (
                <option key={a} value={a}>
                  {formatActionLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div className="activity-entries-count ml-auto self-center whitespace-nowrap text-right">
            <span className="activity-entries-text">
              {filtered.length} entries
            </span>
          </div>
        </div>
      }
    >
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="activity-col-timestamp">Timestamp</th>
              <th className="w-[170px] min-w-[160px]">Action</th>
              <th className="w-[170px] min-w-[160px]">User</th>
              <th className="min-w-[280px]">Details</th>
              <th className="w-[120px] min-w-[110px]">Reference</th>
            </tr>
          </thead>
          <tbody>
            {paginatedLogs.length > 0 ? (
              paginatedLogs.map((log) => {
                const cfg = actionConfig[log.action] || {
                  label: formatActionLabel(log.action),
                  icon: <Clock size={14} />,
                  color: "var(--text-muted)",
                  bg: "var(--bg-elevated)",
                };
                return (
                  <tr key={log.id}>
                    <td className="activity-col-timestamp-cell">
                      <span className="activity-log-timestamp">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </td>
                    <td>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold whitespace-nowrap"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <User
                          size={14}
                          style={{ color: "var(--text-muted)" }}
                        />
                        <span className="text-[0.8rem] font-medium text-[var(--text-main)]">
                          {getUserFullName(log.userId)}
                        </span>
                      </div>
                    </td>
                    <td className="td-primary text-[0.8rem] font-normal leading-snug">
                      {log.details}
                    </td>
                    <td>
                      {log.referenceId && (
                        <span className="td-mono text-[0.7rem]">
                          {log.referenceId}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="5">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Clock size={24} />
                    </div>
                    <h3>No log entries found</h3>
                    <p>Activity will appear here as the system is used</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-toolbar">
        <div className="pagination-summary">
          Showing {showFrom}-{showTo} of {filtered.length} matching logs
        </div>
        <div className="pagination-controls">
          <label>
            Rows per page
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={pageSize}
              className="form-input pagination-page-size-input"
              onChange={(e) =>
                handlePageSizeChange(Number(e.target.value) || 1)
              }
            />
          </label>
        </div>
        <div className="pagination-pages">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </PageShell>
  );
};

export default ActivityLogs;
