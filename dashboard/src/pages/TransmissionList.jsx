import React, { useEffect, useState } from "react";
import PageShell from "../components/PageShell";
import ModalOverlay from "../components/ModalOverlay";
import {
  ArrowRightLeft,
  Search,
  ArrowRight,
  Plus,
  X,
  Clock,
  CheckCircle2,
  User,
  Calendar,
  Building2,
  FileText,
  History,
} from "lucide-react";
import {
  offices as defaultOffices,
  users as defaultUsers,
} from "../data/mockData";
import { compareNewest } from "../utils/sorting";

const TransmissionList = ({
  transmissions,
  documents,
  offices = defaultOffices,
  users = defaultUsers,
  currentUser,
  onAdd,
  onUpdate,
  onNotify,
}) => {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [detailTransmission, setDetailTransmission] = useState(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [formData, setFormData] = useState({
    documentId: "",
    fromOfficeId: currentUser?.officeId || "OFF-001",
    toOfficeId: "OFF-002",
    transmissionDate: new Date().toISOString().split("T")[0],
    transmissionType: "Internal",
  });

  const notify = (message, title = "Action needed", type = "warning") => {
    onNotify?.({ type, title, message });
  };

  const types = ["All", "Internal", "External"];
  const isApprovalUser =
    currentUser?.role === "Admin" || currentUser?.role === "Mayor";

  const getOfficeName = (officeId) => {
    const office = offices.find((o) => o.id === officeId);
    return office ? office.name : "Unknown Office";
  };

  const getUserFullName = (userId) => {
    const user = users.find((u) => u.id === userId);
    return user
      ? `${user.fname} ${user.mname || ""} ${user.lname}`
          .replace(/\s+/g, " ")
          .trim()
      : "Unknown";
  };

  const renderRouteOfficeRight = (officeName) => {
    const name = officeName || "Unknown Office";
    const parts = name.split(" & ");
    if (parts.length < 2) return name;
    const firstLine = parts[0];
    const rest = parts.slice(1).join(" & ");
    return (
      <span className="transfer-office-split">
        <span className="transfer-office-line">{firstLine}</span>
        <span className="transfer-office-line">{`& ${rest}`}</span>
      </span>
    );
  };

  const getDocument = (documentId) =>
    documents.find((d) => d.id === documentId);
  const getWorkflowStatus = (doc) => {
    if (doc?.status === "For Signature") return "For Signing";
    if (doc?.status === "Acknoweledged") return "Acknowledged";
    return doc?.status || "Received";
  };
  const isApprovedForWorkflow = (doc) =>
    (doc?.intakeStatus || "Approved") === "Approved";
  const registrationStatuses = ["Received", "For Signing", "For Filing"];
  const finalWorkflowStatuses = ["Signed", "Acknowledged"];
  const transmittableStatuses = [
    ...registrationStatuses,
    ...finalWorkflowStatuses,
  ];
  const canRouteDocument = (doc) => {
    const status = getWorkflowStatus(doc);
    const finalStatus = finalWorkflowStatuses.includes(status);
    return (
      Boolean(doc) &&
      isApprovedForWorkflow(doc) &&
      transmittableStatuses.includes(status) &&
      (isApprovalUser ||
        (!finalStatus && doc.currentOfficeId === currentUser?.officeId))
    );
  };
  const getRouteBlockReason = (doc) => {
    if (!doc) return "Document not found";
    const status = getWorkflowStatus(doc);
    if (!isApprovedForWorkflow(doc))
      return `Needs approval first (${doc.intakeStatus || "Pending Review"})`;
    if (status === "In Transit") return "Already in transit";
    if (status === "Signed")
      return isApprovalUser
        ? "Signed documents can be returned or archived"
        : "Signed documents are handled by Admin/Mayor";
    if (status === "Acknowledged")
      return isApprovalUser
        ? "Acknowledged documents can be returned or archived"
        : "Acknowledged documents are handled by Admin/Mayor";
    if (status === "Archived") return "Archived documents are locked";
    if (!isApprovalUser && doc.currentOfficeId !== currentUser?.officeId)
      return "Not in your assigned office";
    return "Not eligible for routing";
  };
  const getTransmissionPendingReason = (transmission) => {
    const doc = getDocument(transmission.documentId);
    if (transmission.receivedBy) {
      return "Completed: destination office already acknowledged receipt.";
    }
    return `Pending because ${getOfficeName(transmission.toOfficeId)} must receive ${doc?.trackingNumber || "the document"} before the workflow can continue.`;
  };

  const formatDateTime = (value) => {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const formatTransmissionDateParts = (value) => {
    if (!value) return { date: "Not recorded", time: "" };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      const [rawDate = value, rawTime = ""] = String(value).split("T");
      return { date: rawDate, time: rawTime.replace("Z", "") };
    }
    return {
      date: parsed.toLocaleDateString(),
      time: parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  };

  const getTransmissionTimeline = (transmission) => {
    const timeline = [
      {
        id: `${transmission.id}-sent`,
        label: "Transmission sent",
        details: `Sent from ${getOfficeName(transmission.fromOfficeId)} to ${getOfficeName(transmission.toOfficeId)}`,
        userId: transmission.sentBy,
        timestamp: transmission.transmissionDate,
      },
    ];

    if (transmission.receivedBy) {
      timeline.push({
        id: `${transmission.id}-received`,
        label: "Received and acknowledged",
        details: `Received at ${getOfficeName(transmission.toOfficeId)}`,
        userId: transmission.receivedBy,
        timestamp: transmission.receivedAt || transmission.transmissionDate,
      });
    }

    return timeline;
  };

  const filteredTrans = transmissions
    .filter((t) => {
      const doc = documents.find((d) => d.id === t.documentId);
      const term = search.toLowerCase();
      const matchSearch =
        !term ||
        (doc?.subject || "").toLowerCase().includes(term) ||
        (doc?.trackingNumber || "").toLowerCase().includes(term) ||
        getOfficeName(t.fromOfficeId).toLowerCase().includes(term) ||
        getOfficeName(t.toOfficeId).toLowerCase().includes(term) ||
        (t.transmissionType || "").toLowerCase().includes(term) ||
        getUserFullName(t.sentBy).toLowerCase().includes(term) ||
        (t.receivedBy
          ? getUserFullName(t.receivedBy).toLowerCase().includes(term)
          : false);
      const matchType =
        filterType === "All" || t.transmissionType === filterType;
      return matchSearch && matchType;
    })
    .sort((a, b) =>
      compareNewest(a, b, [
        "createdAt",
        "updatedAt",
        "receivedAt",
        "transmissionDate",
      ]),
    );
  const routableDocuments = documents.filter(canRouteDocument);

  useEffect(() => {
    setPage(1);
  }, [search, filterType]);

  const totalPages = Math.max(1, Math.ceil(filteredTrans.length / pageSize));
  const paginatedTransmissions = filteredTrans.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const showFrom = filteredTrans.length ? (page - 1) * pageSize + 1 : 0;
  const showTo = Math.min(filteredTrans.length, page * pageSize);

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    setPage(Math.max(1, Math.min(totalPages, newPage)));
  };
  const visibleRouteDocuments = routableDocuments.sort((a, b) =>
    compareNewest(a, b, ["createdAt", "updatedAt", "dateReceived"]),
  );
  const selectedFormDocument = getDocument(formData.documentId);

  const getNextOfficeId = (fromOfficeId) =>
    offices.find((o) => o.id !== fromOfficeId)?.id || fromOfficeId;

  const selectRouteDocument = (doc) => {
    if (!canRouteDocument(doc)) return;
    const fromOfficeId = isApprovalUser
      ? doc.currentOfficeId || formData.fromOfficeId
      : currentUser?.officeId || doc.currentOfficeId || formData.fromOfficeId;
    setFormData({
      ...formData,
      documentId: doc.id,
      fromOfficeId,
      toOfficeId:
        formData.toOfficeId === fromOfficeId
          ? getNextOfficeId(fromOfficeId)
          : formData.toOfficeId,
    });
  };

  const openCreateForm = () => {
    const firstDocument = routableDocuments[0];
    const fromOfficeId = isApprovalUser
      ? firstDocument?.currentOfficeId ||
        currentUser?.officeId ||
        offices[0]?.id ||
        "OFF-001"
      : currentUser?.officeId ||
        firstDocument?.currentOfficeId ||
        offices[0]?.id ||
        "OFF-001";

    setFormData({
      documentId: firstDocument?.id || "",
      fromOfficeId,
      toOfficeId: getNextOfficeId(fromOfficeId),
      transmissionDate: new Date().toISOString().split("T")[0],
      transmissionType: "Internal",
    });
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const selectedDoc = getDocument(formData.documentId);
    if (!canRouteDocument(selectedDoc)) {
      notify(
        "Choose an approved document that can be routed from your office.",
      );
      return;
    }
    if (formData.fromOfficeId === formData.toOfficeId) {
      notify("Choose a different destination office before routing.");
      return;
    }

    onAdd({
      ...formData,
      fromOfficeId: isApprovalUser
        ? formData.fromOfficeId
        : currentUser?.officeId,
    });
    setShowForm(false);
  };

  const canReceiveTransmission = (transmission) =>
    Boolean(transmission) &&
    !transmission.receivedBy &&
    (currentUser?.role === "Admin" ||
      currentUser?.role === "Mayor" ||
      transmission.toOfficeId === currentUser?.officeId);

  const handleReceive = async (id) => {
    await onUpdate(id, {
      receivedBy: currentUser?.id || "USR-001",
      receivedAt: new Date().toISOString(),
    });
  };

  return (
    <>
      <PageShell
        header={
          <div className="page-header page-header--align-bottom">
            <div className="page-header-left">
              <h1>Transmissions</h1>
              <p>Track document movement between offices</p>
            </div>
            {visibleRouteDocuments.length > 0 && (
              <div className="page-header-actions page-header-actions--inline page-header-actions--mobile-only">
                <button className="btn btn-primary" onClick={openCreateForm}>
                  <Plus size={16} /> New Transmission
                </button>
              </div>
            )}
          </div>
        }
        toolbar={
          <div className="page-toolbar-row transmissions-toolbar">
            <div className="filter-dropdown filter-dropdown-search">
              <label>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="Search by subject, tracking, office, type, or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-dropdown filter-dropdown-inline">
              <label>Type</label>
              <select
                className="form-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            {visibleRouteDocuments.length > 0 && (
              <div className="page-toolbar-actions page-toolbar-actions--desktop-only">
                <button className="btn btn-primary" onClick={openCreateForm}>
                  <Plus size={16} /> New Transmission
                </button>
              </div>
            )}
          </div>
        }
      >
      <div className="table-container">
        <table className="transmissions-table">
          <thead>
            <tr>
              <th className="transmissions-col-id">ID</th>
              <th className="transmissions-col-document">Document</th>
              <th className="transmissions-col-route">Route</th>
              <th className="transmissions-col-sent-by">Sent By</th>
              <th className="transmissions-col-received-by">Received By</th>
              <th className="transmissions-col-date">Date</th>
              <th className="transmissions-col-type">Type</th>
              <th className="transmissions-col-status">Status</th>
              <th className="transmissions-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTransmissions.length > 0 ? (
              paginatedTransmissions.map((t) => {
                const doc = documents.find((d) => d.id === t.documentId);
                const displayTimestamp = t.receivedAt || t.transmissionDate;
                const timestampParts = formatTransmissionDateParts(displayTimestamp);
                return (
                  <tr
                    key={t.id}
                    className="clickable-row"
                    onClick={() => setDetailTransmission(t)}
                    title="View transmission details"
                  >
                    <td className="transmissions-col-id">
                      <span className="td-mono">{t.id}</span>
                    </td>
                    <td className="td-primary transmissions-col-document">
                      {doc?.subject || "Unknown Document"}
                    </td>
                    <td className="transmissions-col-route">
                      <div className="transfer-visual">
                        <span className="transfer-office transfer-office-left">
                          {getOfficeName(t.fromOfficeId)}
                        </span>
                        <ArrowRight size={14} className="transfer-arrow" />
                        <span className="transfer-office transfer-office-right">
                          {renderRouteOfficeRight(getOfficeName(t.toOfficeId))}
                        </span>
                      </div>
                    </td>
                    <td className="transmissions-col-sent-by">{getUserFullName(t.sentBy)}</td>
                    <td className="transmissions-col-received-by">
                      {t.receivedBy ? (
                        getUserFullName(t.receivedBy)
                      ) : (
                        <span className="transmissions-pending-text">
                          Pending: awaiting {getOfficeName(t.toOfficeId)}
                        </span>
                      )}
                    </td>
                    <td className="transmissions-col-date">
                      <div className="transmissions-date-stack">
                        <span>{timestampParts.date}</span>
                        {timestampParts.time && <span>{timestampParts.time}</span>}
                      </div>
                    </td>
                    <td className="transmissions-col-type">
                      <span className="transmissions-type-chip">
                        {t.transmissionType}
                      </span>
                    </td>
                    <td className="transmissions-col-status">
                      {t.receivedBy ? (
                        <span className="status-badge status-archived">
                          <CheckCircle2 size={12} /> Completed
                        </span>
                      ) : (
                        <span className="status-badge status-in-transit">
                          <Clock size={12} /> In Transit
                        </span>
                      )}
                      <small className="workflow-explanation">
                        {getTransmissionPendingReason(t)}
                      </small>
                    </td>
                    <td className="transmissions-col-actions">
                      <div className="transmissions-actions-wrap">
                        {canReceiveTransmission(t) && (
                          <button
                            className="btn btn-sm btn-success"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReceive(t.id).catch(() => {});
                            }}
                          >
                            <CheckCircle2 size={14} /> Receive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="9">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <ArrowRightLeft size={24} />
                    </div>
                    <h3>No transmissions found</h3>
                    <p>Create a new transmission to route a document</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-toolbar">
        <div className="pagination-summary">
          Showing {showFrom}-{showTo} of {filteredTrans.length} matching
          transmissions
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

      {detailTransmission &&
        (() => {
          const transmission =
            transmissions.find((item) => item.id === detailTransmission.id) ||
            detailTransmission;
          const doc = getDocument(transmission.documentId);
          const timeline = getTransmissionTimeline(transmission);

          return (
            <ModalOverlay onClose={() => setDetailTransmission(null)}>
              <div
                className="modal document-detail-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <h2>Transmission Details</h2>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.8rem",
                        marginTop: "0.2rem",
                      }}
                    >
                      {transmission.id}
                    </p>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => setDetailTransmission(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  <div className="document-detail-grid">
                    <div className="document-detail-section">
                      <h4>
                        <FileText size={14} /> Document
                      </h4>
                      <div className="detail-pair">
                        <span>Tracking #</span>
                        <strong>{doc?.trackingNumber || "-"}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Subject</span>
                        <strong>{doc?.subject || "Unknown Document"}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Document Status</span>
                        <strong>{doc ? getWorkflowStatus(doc) : "-"}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Priority</span>
                        <strong>{doc?.priorityLevel || "-"}</strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <Building2 size={14} /> Route
                      </h4>
                      <div className="detail-pair">
                        <span>From</span>
                        <strong>
                          {getOfficeName(transmission.fromOfficeId)}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>To</span>
                        <strong>
                          {getOfficeName(transmission.toOfficeId)}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Type</span>
                        <strong>{transmission.transmissionType}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Status</span>
                        <strong>
                          {transmission.receivedBy ? "Completed" : "In Transit"}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Pending Reason</span>
                        <strong>
                          {getTransmissionPendingReason(transmission)}
                        </strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <User size={14} /> People
                      </h4>
                      <div className="detail-pair">
                        <span>Sent By</span>
                        <strong>{getUserFullName(transmission.sentBy)}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Received By</span>
                        <strong>
                          {transmission.receivedBy
                            ? getUserFullName(transmission.receivedBy)
                            : "Pending"}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Remarks</span>
                        <strong>
                          {transmission.acknowledgementRemarks || "-"}
                        </strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <Calendar size={14} /> Dates
                      </h4>
                      <div className="detail-pair">
                        <span>Sent</span>
                        <strong>
                          {formatDateTime(transmission.transmissionDate)}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Received</span>
                        <strong>
                          {formatDateTime(transmission.receivedAt)}
                        </strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <CheckCircle2 size={14} /> Actions
                      </h4>
                      <div className="workflow-actions">
                        {canReceiveTransmission(transmission) ? (
                          <button
                            className="btn btn-success"
                            onClick={async () => {
                              try {
                                await handleReceive(transmission.id);
                                setDetailTransmission({
                                  ...transmission,
                                  receivedBy: currentUser?.id,
                                });
                              } catch {
                                // The shared save handler already shows the API error.
                              }
                            }}
                          >
                            <CheckCircle2 size={14} /> Receive Transmission
                          </button>
                        ) : (
                          <p className="detail-empty">
                            {transmission.receivedBy
                              ? "This transmission has already been received."
                              : "Only the destination office or an approval user can receive this transmission."}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="document-detail-section document-timeline-section">
                      <h4>
                        <History size={14} /> Timeline
                      </h4>
                      <div className="timeline-compact">
                        {timeline.map((event) => (
                          <div key={event.id} className="timeline-compact-item">
                            <span className="timeline-compact-dot" />
                            <div>
                              <strong>{event.label}</strong>
                              <p>{event.details}</p>
                              <small>
                                {formatDateTime(event.timestamp)}{" "}
                                {event.userId
                                  ? `by ${getUserFullName(event.userId)}`
                                  : ""}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    className="btn btn-primary"
                    onClick={() => setDetailTransmission(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </ModalOverlay>
          );
        })()}

      {/* Form Modal */}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div
            className="modal document-form-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>New Transmission</h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Eligible Documents</label>
                  <div className="route-document-table-wrap">
                    <table className="route-document-table">
                      <thead>
                        <tr>
                          <th>Use</th>
                          <th>Tracking #</th>
                          <th>Subject</th>
                          <th>Current Office</th>
                          <th>Status</th>
                          <th>Route Check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRouteDocuments.length ? (
                          visibleRouteDocuments.map((doc) => (
                            <tr
                              key={doc.id}
                              className="clickable-row"
                              onClick={() => selectRouteDocument(doc)}
                            >
                              <td>
                                <input
                                  type="radio"
                                  checked={formData.documentId === doc.id}
                                  onChange={() => selectRouteDocument(doc)}
                                />
                              </td>
                              <td>
                                <span className="td-mono">
                                  {doc.trackingNumber}
                                </span>
                              </td>
                              <td className="td-primary">
                                {doc.subject || "Untitled document"}
                              </td>
                              <td>{getOfficeName(doc.currentOfficeId)}</td>
                              <td>
                                <span
                                  className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, "-")}`}
                                >
                                  {getWorkflowStatus(doc)}
                                </span>
                              </td>
                              <td>
                                <span className="route-check-ok">
                                  Ready to route
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6">
                              <div
                                className="empty-state"
                                style={{ padding: "1rem" }}
                              >
                                <h3>No documents available</h3>
                                <p>
                                  No approved documents are available for
                                  transmission.
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <input
                    type="hidden"
                    value={formData.documentId}
                    required
                    readOnly
                  />
                  <p className="field-hint">
                    Only approved routable documents are shown here. Admin/Mayor
                    can also return Signed and Acknowledged documents; In
                    Transit and Archived records are hidden from transmission.
                  </p>
                  {selectedFormDocument && (
                    <div className="selected-route-summary">
                      <strong>{selectedFormDocument.trackingNumber}</strong>
                      <span>
                        {selectedFormDocument.subject || "Untitled document"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">From Office</label>
                    <select
                      className="form-select"
                      value={formData.fromOfficeId}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          fromOfficeId: e.target.value,
                          toOfficeId:
                            formData.toOfficeId === e.target.value
                              ? getNextOfficeId(e.target.value)
                              : formData.toOfficeId,
                        })
                      }
                      disabled={!isApprovalUser}
                    >
                      {(isApprovalUser
                        ? offices
                        : offices.filter(
                            (o) =>
                              o.id === currentUser?.officeId ||
                              o.id === formData.fromOfficeId,
                          )
                      ).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <p className="field-hint">
                      The office currently holding and sending the selected
                      document.
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">To Office</label>
                    <select
                      className="form-select"
                      value={formData.toOfficeId}
                      onChange={(e) =>
                        setFormData({ ...formData, toOfficeId: e.target.value })
                      }
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <p className="field-hint">
                      The office that must receive and acknowledge the
                      transmission.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Sent By</label>
                    <input
                      className="form-input"
                      value={
                        currentUser
                          ? `${currentUser.fname} ${currentUser.lname}`
                          : "Current user"
                      }
                      readOnly
                    />
                    <p className="field-hint">
                      Automatically records the signed-in user creating the
                      route.
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select
                      className="form-select"
                      value={formData.transmissionType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          transmissionType: e.target.value,
                        })
                      }
                    >
                      <option>Internal</option>
                      <option>External</option>
                    </select>
                    <p className="field-hint">
                      Marks whether the movement is inside the municipality or
                      external.
                    </p>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Transmission Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={formData.transmissionDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        transmissionDate: e.target.value,
                      })
                    }
                    required
                  />
                  <p className="field-hint">
                    The official date saved in the routing history and reports.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Transmission
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default TransmissionList;
