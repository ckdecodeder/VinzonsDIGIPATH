import React, { useEffect, useState } from "react";
import { documentService } from '../api/documentService';
import PageShell from "../components/PageShell";
import ModalOverlay from "../components/ModalOverlay";
import ScannedPreviewModal from "../components/ScannedPreviewModal";
import {
  Archive,
  Search,
  Plus,
  X,
  User,
  Eye,
  Download,
  Paperclip,
  FileText,
  History,
  MapPin,
} from "lucide-react";
import {
  documentTypes as defaultDocumentTypes,
  offices as defaultOffices,
  users as defaultUsers,
} from "../data/mockData";
import {
  getAttachmentSource,
} from "../utils/attachmentDownload";

const ArchiveList = ({
  archives,
  documents,
  offices = defaultOffices,
  users = defaultUsers,
  documentTypes = defaultDocumentTypes,
  currentUser,
  currentRole,
  onAdd,
  onEditDocument,
  onNotify,
}) => {
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detailArchive, setDetailArchive] = useState(null);
  const [detailDocument, setDetailDocument] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  useEffect(() => {
    setDetailDocument(null); setDetailError('');
    if (!detailArchive) return undefined;
    const controller = new AbortController();
    documentService.getById(detailArchive.documentId, { signal: controller.signal }).then(setDetailDocument).catch((error) => {
      if (error.code !== 'ABORTED') setDetailError(error.message);
    });
    return () => controller.abort();
  }, [detailArchive?.id, detailRetry]);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [formData, setFormData] = useState({
    documentId: "",
    date: new Date().toISOString().split("T")[0],
  });

  const getUserFullName = (userId) => {
    const user = users.find((u) => u.id === userId);
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

  const getOfficeName = (officeId) => {
    const office = offices.find((o) => o.id === officeId);
    return office ? office.name : "Unknown Office";
  };

  const formatDateTime = (value) => {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const getArchiveDateKey = (archive) => {
    const raw = archive?.date;
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return String(raw);
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return String(raw).slice(0, 10);
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatArchiveDateParts = (value) => {
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

  const getDocumentFiles = (doc) => {
    if (!doc) return [];
    if (doc.scannedFiles?.length) return doc.scannedFiles;
    if (doc.scannedImageUrl) {
      return [
        {
          id: `${doc.id}-scan`,
          name: `${doc.trackingNumber || doc.id}-scan.jpg`,
          type: "image/jpeg",
          url: doc.scannedImageUrl.startsWith("data:") ? undefined : doc.scannedImageUrl,
          dataUrl: doc.scannedImageUrl.startsWith("data:") ? doc.scannedImageUrl : undefined,
          uploadedAt: doc.dateReceived,
          uploadedBy: null,
          source: "camera",
        },
      ];
    }
    return [];
  };

  const openPreview = (file, doc) => {
    setPreviewDoc(doc);
    setPreviewFile(file);
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewDoc(null);
  };

  const canEditRotation = currentRole === "admin" || currentRole === "mayor";

  const handleSaveRotatedAttachment = async (rotatedFile) => {
    if (!previewDoc || !onEditDocument) {
      throw new Error("This scan cannot be saved right now.");
    }

    const existingFiles = getDocumentFiles(previewDoc);
    const updatedFiles = existingFiles.map((file) => (
      file.id === rotatedFile.id ? rotatedFile : file
    ));

    const savedDoc = await onEditDocument({
      ...previewDoc,
      scannedFiles: updatedFiles,
      scannedImageUrl:
        updatedFiles[0]?.url ||
        updatedFiles[0]?.dataUrl ||
        previewDoc.scannedImageUrl,
    });

    const savedFile =
      getDocumentFiles(savedDoc).find((file) => file.id === rotatedFile.id) ||
      rotatedFile;
    setPreviewDoc(savedDoc);
    setPreviewFile(savedFile);
  };

  const getArchiveTimeline = (archive, doc) => {
    const timeline = doc?.timeline?.length
      ? [...doc.timeline]
      : [
          {
            id: `${archive.id}-registered`,
            label: "Registered",
            details: doc
              ? `Document registered with tracking number ${doc.trackingNumber}`
              : "Document record was created",
            officeId: doc?.originOfficeId || doc?.currentOfficeId,
            userId: null,
            timestamp: doc?.dateReceived || archive.date,
          },
        ];

    if (
      !timeline.some(
        (event) =>
          event.action === "document_archived" || event.label === "Archived",
      )
    ) {
      timeline.push({
        id: `${archive.id}-archived`,
        action: "document_archived",
        label: "Archived",
        details: "Document moved to archive records",
        officeId:
          doc?.currentOfficeId ||
          doc?.destinationOfficeId ||
          doc?.originOfficeId,
        userId: archive.userId,
        referenceId: archive.id,
        timestamp: archive.date,
      });
    }

    return timeline.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    );
  };

  const enrichedArchives = archives.map((a) => {
    const doc = documents.find((d) => d.id === a.documentId);
    return { ...a, doc };
  });

  const filtered = enrichedArchives.filter((a) => {
    const term = search.toLowerCase();
    const currentLocation = a.doc
      ? getOfficeName(a.doc.currentOfficeId || a.doc.originOfficeId)
      : "";
    const matchSearch =
      !term ||
      (a.doc?.subject || "").toLowerCase().includes(term) ||
      (a.doc?.trackingNumber || "").toLowerCase().includes(term) ||
      a.id.toLowerCase().includes(term) ||
      getUserFullName(a.userId).toLowerCase().includes(term) ||
      (a.doc ? getDocTypeName(a.doc.documentTypeId) : "")
        .toLowerCase()
        .includes(term) ||
      currentLocation.toLowerCase().includes(term);
    const matchDate = !filterDate || getArchiveDateKey(a) === filterDate;
    return matchSearch && matchDate;
  });

  useEffect(() => {
    setPage(1);
  }, [search, filterDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedArchives = filtered.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const showFrom = filtered.length ? (page - 1) * pageSize + 1 : 0;
  const showTo = Math.min(filtered.length, page * pageSize);

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    setPage(Math.max(1, Math.min(totalPages, newPage)));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd({
      ...formData,
    });
    setShowForm(false);
  };

  const archivableDocs = documents.filter(
    (d) =>
      ["Signed", "Acknowledged"].includes(d.status) &&
      !archives.some((a) => a.documentId === d.id),
  );

  return (
    <>
      <PageShell
        className="documents-page archives-page"
        header={
          <div className="page-header page-header--align-bottom">
            <div className="page-header-left">
              <h1>Archives</h1>
              <p>Documents that are filed, archived, and stored for records</p>
            </div>
            <div className="page-header-actions page-header-actions--inline">
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                <Plus size={16} /> Archive Document
              </button>
            </div>
          </div>
        }
        toolbar={
          <div className="document-toolbar document-toolbar--archives">
            <div className="filter-dropdown filter-dropdown-search">
              <label>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="Search by subject, tracking, name, type, or location..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="filter-dropdown filter-dropdown-date">
              <label htmlFor="archive-date-filter">Date</label>
              <input
                id="archive-date-filter"
                className="form-input"
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>
          </div>
        }
      >
      <section className="document-panel">
        <div className="table-container documents-table-container">
        <table className="archives-table documents-table">
          <thead>
            <tr>
              <th className="archives-col-id">Archive ID</th>
              <th className="archives-col-tracking">Tracking #</th>
              <th className="archives-col-subject">Document Subject</th>
              <th className="archives-col-type">Type</th>
              <th className="archives-col-archived-by">Archived By</th>
              <th className="archives-col-date">Archive Date</th>
            </tr>
          </thead>
          <tbody>
            {paginatedArchives.length > 0 ? (
              paginatedArchives.map((a) => {
                const dateParts = formatArchiveDateParts(a.date);
                return (
                <tr
                  key={a.id}
                  className="clickable-row"
                  aria-label="View archive details"
                  onClick={() => setDetailArchive(a)}
                >
                  <td className="archives-col-id" title={a.id}>
                    <span className="td-mono documents-tracking-code">{a.id}</span>
                  </td>
                  <td className="archives-col-tracking" title={a.doc?.trackingNumber || "-"}>
                    <span className="td-mono documents-tracking-code">
                      {a.doc?.trackingNumber || "-"}
                    </span>
                  </td>
                  <td className="td-primary archives-col-subject" title={a.doc?.subject || "Unknown"}>
                    {a.doc?.subject || "Unknown"}
                  </td>
                  <td className="archives-col-type" title={a.doc ? getDocTypeName(a.doc.documentTypeId) : "-"}>
                    {a.doc ? getDocTypeName(a.doc.documentTypeId) : "-"}
                  </td>
                  <td className="archives-col-archived-by" title={getUserFullName(a.userId)}>
                    {getUserFullName(a.userId)}
                  </td>
                  <td className="archives-col-date">
                    <div className="archives-date-stack">
                      <span>{dateParts.date}</span>
                      {dateParts.time && <span>{dateParts.time}</span>}
                    </div>
                  </td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="6">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Archive size={24} />
                    </div>
                    <h3>No archived documents</h3>
                    <p>Archive completed documents for safekeeping</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-toolbar">
        <div className="pagination-summary">
          Showing {showFrom}-{showTo} of {filtered.length} matching archives
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
      </section>
      </PageShell>

      {detailArchive && !previewFile &&
        (() => {
          const archive =
            archives.find((item) => item.id === detailArchive.id) ||
            detailArchive;
          const doc = (detailDocument?.id === archive.documentId ? detailDocument : null) || documents.find((item) => item.id === archive.documentId) || archive.doc;
          const files = getDocumentFiles(doc);
          const timeline = getArchiveTimeline(archive, doc);

          return (
            <ModalOverlay onClose={() => setDetailArchive(null)}>
              <div
                className="modal document-detail-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <h2>Archive Details</h2>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.8rem",
                        marginTop: "0.2rem",
                      }}
                    >
                      {archive.id}
                    </p>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => setDetailArchive(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  {detailDocument?.id !== archive.documentId && <div role="status">{detailError || 'Loading scans and history…'}
                    {detailError && <button onClick={() => setDetailRetry((value) => value + 1)}>Retry</button>}
                  </div>}

                  <div className="document-detail-grid">
                    <div className="document-detail-section">
                      <h4>
                        <Archive size={14} /> Archive Record
                      </h4>
                      <div className="detail-pair">
                        <span>Archive ID</span>
                        <strong>{archive.id}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Archive Date</span>
                        <strong>{formatDateTime(archive.date)}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Archived By</span>
                        <strong>{getUserFullName(archive.userId)}</strong>
                      </div>
                    </div>

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
                        <span>Type</span>
                        <strong>
                          {doc ? getDocTypeName(doc.documentTypeId) : "-"}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Status</span>
                        <strong>{doc?.status || "-"}</strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <MapPin size={14} /> Location
                      </h4>
                      <div className="detail-pair">
                        <span>Origin</span>
                        <strong>
                          {doc?.originOfficeId
                            ? getOfficeName(doc.originOfficeId)
                            : "-"}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Current</span>
                        <strong>
                          {doc?.currentOfficeId
                            ? getOfficeName(doc.currentOfficeId)
                            : "-"}
                        </strong>
                      </div>
                      <div className="detail-pair">
                        <span>Destination</span>
                        <strong>
                          {doc?.destinationOfficeId
                            ? getOfficeName(doc.destinationOfficeId)
                            : "-"}
                        </strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <User size={14} /> Sender
                      </h4>
                      <div className="detail-pair">
                        <span>Name</span>
                        <strong>{doc?.senderName || "-"}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Contact</span>
                        <strong>{doc?.senderContact || "-"}</strong>
                      </div>
                      <div className="detail-pair">
                        <span>Email</span>
                        <strong>{doc?.senderEmail || "-"}</strong>
                      </div>
                    </div>

                    <div className="document-detail-section">
                      <h4>
                        <Paperclip size={14} /> Scanned Paper
                      </h4>
                      {files.length ? (
                        <div className="attachment-list">
                          {files.map((file) => (
                            <div key={file.id} className="attachment-item">
                              <button
                                type="button"
                                className="attachment-link"
                                onClick={() => openPreview(file, doc)}
                              >
                                <Eye size={14} />
                                <span>{file.name}</span>
                              </button>
                              <a
                                href={getAttachmentSource(file)}
                                download={file.name}
                                className="attachment-download"
                                title="Download scanned file"
                              >
                                <Download size={14} />
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="detail-empty">
                          No scanned file attached yet.
                        </p>
                      )}
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
                    onClick={() => setDetailArchive(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </ModalOverlay>
          );
        })()}

      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Archive a Document</h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Document to Archive</label>
                  <select
                    className="form-select"
                    value={formData.documentId}
                    onChange={(e) =>
                      setFormData({ ...formData, documentId: e.target.value })
                    }
                    required
                  >
                    <option value="">Select a document</option>
                    {archivableDocs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.trackingNumber} - {d.subject}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">
                    Only completed documents that can be moved into archive are
                    listed.
                  </p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Archived By</label>
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
                      Automatically records the signed-in user performing the
                      archive action.
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Archive Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.date}
                      onChange={(e) =>
                        setFormData({ ...formData, date: e.target.value })
                      }
                      required
                    />
                    <p className="field-hint">
                      The official date used in archive records and reports.
                    </p>
                  </div>
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
                  Archive Document
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {previewFile && (
        <ScannedPreviewModal
          file={previewFile}
          canEdit={canEditRotation}
          onClose={closePreview}
          onSaveRotated={handleSaveRotatedAttachment}
          onNotify={onNotify}
        />
      )}
    </>
  );
};

export default ArchiveList;
