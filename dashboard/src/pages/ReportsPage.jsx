import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PageShell from '../components/PageShell';
import ModalOverlay from '../components/ModalOverlay';
import {
  BarChart3,
  FileText,
  ArrowRightLeft,
  Building2,
  Users,
  Clock,
  Flag,
  TrendingUp,
  Calendar,
  Inbox,
  Send,
  Archive,
  Download,
  Printer,
  Eye,
  X,
  PieChart,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  getPriorityInfo,
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
} from '../data/mockData';
import { reportService } from '../api/documentService';
import { sortNewest } from '../utils/sorting';
import usePhilippinesClock from '../hooks/usePhilippinesClock';

const ReportsPage = ({
  documents,
  transmissions,
  archives,
  offices = defaultOffices,
  users,
  logs,
  documentTypes = defaultDocumentTypes,
  currentRole,
  currentUser,
  onNotify,
}) => {
  const [activeCategory, setActiveCategory] = useState('summary');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [reportTablePage, setReportTablePage] = useState(1);
  const [transmissionReportTablePage, setTransmissionReportTablePage] = useState(1);
  const generatedAt = usePhilippinesClock();

  const REPORT_TABLE_PAGE_SIZE = 10;

  const categories = [
    { id: 'summary', label: 'Summary', icon: <PieChart size={16} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={16} /> },
    { id: 'transmissions', label: 'Transmissions', icon: <ArrowRightLeft size={16} /> },
    { id: 'offices', label: 'By Office', icon: <Building2 size={16} /> },
  ];

  const canViewActivity = currentRole === 'admin' || currentRole === 'mayor';

  // Add activity reports for approval/admin roles
  if (canViewActivity) {
    categories.push({ id: 'activity', label: 'Activity', icon: <Clock size={16} /> });
  }

  // Filter by date range
  const filterByDate = (items, dateField) => {
    return items.filter(item => {
      const d = item[dateField];
      if (!d) return true;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  };

  const filteredDocs = sortNewest(filterByDate(documents, 'dateReceived'), ['createdAt', 'updatedAt', 'dateReceived']);
  const filteredTransmissions = sortNewest(filterByDate(transmissions, 'transmissionDate'), ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']);
  const filteredArchives = sortNewest(filterByDate(archives, 'date'), ['createdAt', 'updatedAt', 'date']);
  const filteredLogs = sortNewest(filterByDate(logs, 'timestamp'), ['timestamp']);

  const reportTableTotalPages = Math.max(1, Math.ceil(filteredDocs.length / REPORT_TABLE_PAGE_SIZE));
  const paginatedReportDocs = filteredDocs.slice(
    (reportTablePage - 1) * REPORT_TABLE_PAGE_SIZE,
    reportTablePage * REPORT_TABLE_PAGE_SIZE,
  );
  const reportShowFrom = filteredDocs.length
    ? (reportTablePage - 1) * REPORT_TABLE_PAGE_SIZE + 1
    : 0;
  const reportShowTo = Math.min(filteredDocs.length, reportTablePage * REPORT_TABLE_PAGE_SIZE);

  const transmissionReportTotalPages = Math.max(1, Math.ceil(filteredTransmissions.length / REPORT_TABLE_PAGE_SIZE));
  const paginatedReportTransmissions = filteredTransmissions.slice(
    (transmissionReportTablePage - 1) * REPORT_TABLE_PAGE_SIZE,
    transmissionReportTablePage * REPORT_TABLE_PAGE_SIZE,
  );
  const transmissionReportShowFrom = filteredTransmissions.length
    ? (transmissionReportTablePage - 1) * REPORT_TABLE_PAGE_SIZE + 1
    : 0;
  const transmissionReportShowTo = Math.min(
    filteredTransmissions.length,
    transmissionReportTablePage * REPORT_TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    setReportTablePage(1);
    setTransmissionReportTablePage(1);
  }, [dateFrom, dateTo, activeCategory]);

  useEffect(() => {
    setReportTablePage((current) => Math.min(current, reportTableTotalPages));
  }, [reportTableTotalPages]);

  useEffect(() => {
    setTransmissionReportTablePage((current) => Math.min(current, transmissionReportTotalPages));
  }, [transmissionReportTotalPages]);

  const getOfficeName = (officeId) => {
    const office = offices.find((item) => item.id === officeId);
    return office ? office.name : 'Unknown Office';
  };

  const getUserFullName = (userId) => {
    const user = users.find((item) => item.id === userId);
    return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : 'Unknown';
  };

  const getDocTypeName = (typeId) => {
    const documentType = documentTypes.find((item) => item.id === typeId);
    return documentType ? documentType.category : 'Unknown';
  };

  const getWorkflowStatus = (doc) => {
    if (doc.status === 'For Signature') return 'For Signing';
    if (doc.status === 'Acknoweledged') return 'Acknowledged';
    return doc.status || 'Received';
  };

  // ====== SUMMARY ======
  const statusCounts = {
    'Received': filteredDocs.filter(d => getWorkflowStatus(d) === 'Received').length,
    'In Transit': filteredDocs.filter(d => getWorkflowStatus(d) === 'In Transit').length,
    'For Signing': filteredDocs.filter(d => getWorkflowStatus(d) === 'For Signing').length,
    'For Filing': filteredDocs.filter(d => getWorkflowStatus(d) === 'For Filing').length,
    'Signed': filteredDocs.filter(d => getWorkflowStatus(d) === 'Signed').length,
    'Acknowledged': filteredDocs.filter(d => getWorkflowStatus(d) === 'Acknowledged').length,
    'Archived': filteredDocs.filter(d => getWorkflowStatus(d) === 'Archived').length,
  };

  const priorityCounts = {
    urgent: filteredDocs.filter(d => d.priorityLevel === 'urgent').length,
    high: filteredDocs.filter(d => d.priorityLevel === 'high').length,
    normal: filteredDocs.filter(d => d.priorityLevel === 'normal').length,
    low: filteredDocs.filter(d => d.priorityLevel === 'low').length,
  };

  const directionCounts = {
    Incoming: filteredDocs.filter(d => d.documentDirection === 'Incoming').length,
    Outgoing: filteredDocs.filter(d => d.documentDirection === 'Outgoing').length,
  };

  // ====== DOCUMENT TYPE BREAKDOWN ======
  const docTypeCounts = documentTypes.map(dt => ({
    name: dt.category,
    count: filteredDocs.filter(d => d.documentTypeId === dt.id).length,
  })).filter(d => d.count > 0).sort((a, b) => b.count - a.count);

  // ====== OFFICE BREAKDOWN ======
  const officeStats = offices.map(office => {
    const sentFrom = filteredTransmissions.filter(t => t.fromOfficeId === office.id).length;
    const sentTo = filteredTransmissions.filter(t => t.toOfficeId === office.id).length;
    return { name: office.name, sentFrom, sentTo, total: sentFrom + sentTo };
  }).filter(o => o.total > 0).sort((a, b) => b.total - a.total);

  // ====== STAT CARD COMPONENT ======
  const StatCard = ({ label, value, icon, color, sub }) => (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '1.25rem',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.75rem',
    }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${color}18`, color: color,
      }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>{label}</p>
        <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>{value}</p>
        {sub && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{sub}</p>}
      </div>
    </div>
  );

  // ====== HORIZONTAL BAR ======
  const HorizontalBar = ({ label, value, max, color }) => {
    const pct = max > 0 ? (value / max) * 100 : 0;
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>{value}</span>
        </div>
        <div style={{
          height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`, background: color || 'var(--primary)',
            borderRadius: '4px', transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    );
  };

  const maxCount = Math.max(...docTypeCounts.map(d => d.count), 1);
  const maxOffice = Math.max(...officeStats.map(o => o.total), 1);

  const downloadBlob = (filename, content, type) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    const label = categories.find(item => item.id === activeCategory)?.label || 'Summary';
    const filename = `DigiPath-${label.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.docx`;
    setExportError('');
    setIsExporting(true);
    try {
      const blob = await reportService.exportOfficialReport({
        category: activeCategory,
        dateFrom,
        dateTo,
      });
      downloadBlob(
        filename,
        blob,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    } catch (err) {
      const message = err.message || 'Unable to generate the official report.';
      setExportError(message);
      onNotify?.({ type: 'danger', title: 'Report export failed', message });
    } finally {
      setIsExporting(false);
    }
  };

  const categoryLabel = categories.find(item => item.id === activeCategory)?.label || 'Summary';
  const preparedBy = currentUser ? `${currentUser.fname} ${currentUser.lname}` : 'DigiPath User';
  const coverageText = `${dateFrom || 'Start'} to ${dateTo || 'Present'}`;
  const formatReportDate = (value, withTime = false) => {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return withTime ? date.toLocaleString() : date.toLocaleDateString();
  };
  const percent = (value, total) => (!total ? '0%' : `${Math.round((value / total) * 100)}%`);
  const summaryRows = [
    ['Documents', 'Total Documents', filteredDocs.length, `${directionCounts.Incoming} incoming / ${directionCounts.Outgoing} outgoing`],
    ['Documents', 'Received', statusCounts.Received, percent(statusCounts.Received, filteredDocs.length)],
    ['Documents', 'For Signing', statusCounts['For Signing'], percent(statusCounts['For Signing'], filteredDocs.length)],
    ['Documents', 'For Filing', statusCounts['For Filing'], percent(statusCounts['For Filing'], filteredDocs.length)],
    ['Documents', 'Signed', statusCounts.Signed, percent(statusCounts.Signed, filteredDocs.length)],
    ['Documents', 'Acknowledged', statusCounts.Acknowledged, percent(statusCounts.Acknowledged, filteredDocs.length)],
    ['Routing', 'Total Transmissions', filteredTransmissions.length, `${filteredTransmissions.filter(t => !t.receivedBy).length} pending / ${filteredTransmissions.filter(t => t.receivedBy).length} completed`],
    ['Archives', 'Archived Records', filteredArchives.length, 'Visible archived records in coverage'],
  ];

  const getPreviewTable = () => {
    if (activeCategory === 'transmissions') {
      return {
        title: 'Transmission Report',
        headers: ['ID', 'Document', 'From', 'To', 'Sent By', 'Status'],
        columnWidths: ['9%', '27%', '14%', '14%', '16%', '20%'],
        rows: filteredTransmissions.map(t => {
          const doc = documents.find(d => d.id === t.documentId);
          return [
            t.id,
            doc ? `${doc.trackingNumber || doc.id} - ${doc.subject}` : t.documentId,
            getOfficeName(t.fromOfficeId),
            getOfficeName(t.toOfficeId),
            getUserFullName(t.sentBy),
            t.receivedBy ? `Completed (${formatReportDate(t.receivedAt || t.transmissionDate)})` : `Pending (${formatReportDate(t.transmissionDate)})`,
          ];
        }),
      };
    }

    if (activeCategory === 'offices') {
      const totalOfficeMovement = officeStats.reduce((sum, item) => sum + item.total, 0);
      return {
        title: 'Office Movement Report',
        headers: ['Office', 'Sent From', 'Received To', 'Total', 'Share', 'Notes'],
        columnWidths: ['18%', '14%', '14%', '10%', '10%', '34%'],
        rows: officeStats.map(item => [
          item.name,
          item.sentFrom,
          item.sentTo,
          item.total,
          percent(item.total, totalOfficeMovement),
          'Office movement count',
        ]),
      };
    }

    if (activeCategory === 'activity' && canViewActivity) {
      return {
        title: 'Activity Log Report',
        headers: ['Date / Time', 'User', 'Role', 'Action', 'Reference', 'Details'],
        columnWidths: ['16%', '14%', '10%', '12%', '12%', '36%'],
        rows: filteredLogs.map(log => {
          const user = users.find(item => item.id === log.userId);
          return [
            formatReportDate(log.timestamp, true),
            getUserFullName(log.userId),
            user?.role || '',
            log.action,
            log.referenceId || '',
            log.details || '',
          ];
        }),
      };
    }

    if (activeCategory === 'summary') {
      return {
        title: '',
        headers: ['Section', 'Metric', 'Value', 'Notes'],
        rows: summaryRows,
      };
    }

    return {
      title: 'Document Report Table',
      headers: ['Tracking #', 'Subject', 'Type', 'Status', 'Priority', 'Date'],
      columnWidths: ['13%', '30%', '12%', '14%', '11%', '20%'],
      rows: filteredDocs.map(doc => [
        doc.trackingNumber,
        doc.subject,
        getDocTypeName(doc.documentTypeId),
        getWorkflowStatus(doc),
        getPriorityInfo(doc.priorityLevel).label,
        formatReportDate(doc.dateReceived),
      ]),
    };
  };

  const previewTable = getPreviewTable();
  const detailRows = previewTable.title ? previewTable.rows : [];

  // Reusable report building blocks (shared by the visible sheets and the
  // hidden measurement layer so heights match exactly).
  const detailColgroup = previewTable.columnWidths ? (
    <colgroup>
      {previewTable.columnWidths.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  ) : null;

  const detailThead = (
    <thead>
      <tr>
        {previewTable.headers.map(header => <th key={header}>{header}</th>)}
      </tr>
    </thead>
  );

  const coverBlock = (
    <>
      <header className="official-report-header">
        <img src="/Seal_of_Vinzons.png" alt="Seal of Vinzons" />
        <div>
          <p>Republic of the Philippines</p>
          <p>Province of Camarines Norte</p>
          <h1>Municipality of Vinzons</h1>
          <strong>DigiPath Document Tracking System</strong>
        </div>
      </header>

      <div className="official-report-title">
        <h2>{categoryLabel} Report</h2>
        <p>Official generated report from DigiPath records</p>
      </div>

      <div className="official-report-meta">
        <div><span>Prepared By</span><strong>{preparedBy}</strong></div>
        <div><span>Coverage</span><strong>{coverageText}</strong></div>
        <div><span>Generated</span><strong>{generatedAt}</strong></div>
        <div><span>Record Count</span><strong>{activeCategory === 'summary' ? filteredDocs.length : previewTable.rows.length}</strong></div>
      </div>

      <div className="official-report-section">
        <h3 className="official-report-section-title">Summary</h3>
        <div className="official-report-table-wrap">
          <table className="official-report-table official-report-table--summary">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '40%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Section</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row, index) => (
                <tr key={`${row[0]}-${row[1]}-${index}`}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const footerBlock = (
    <footer className="official-report-footer">
      <div>
        <span>Prepared by</span>
        <strong>{preparedBy}</strong>
      </div>
      <div>
        <span>Verified / Noted by</span>
        <strong>____________________________</strong>
      </div>
    </footer>
  );

  // Measure the real rendered heights so the preview paginates exactly like a
  // printed bond paper (Letter, 8.5in x 11in) instead of clipping content.
  const measureRef = useRef(null);
  const [rowChunks, setRowChunks] = useState(null);
  const measureSignature = `${activeCategory}|${dateFrom}|${dateTo}|${detailRows.length}|${previewTable.title}`;

  useLayoutEffect(() => {
    if (!showPreview) return;
    const node = measureRef.current;
    if (!node) return;

    const DPI = 96;
    const USABLE = 11 * DPI - (0.55 + 0.85) * DPI; // page height minus top/bottom padding

    const coverEl = node.querySelector('[data-m="cover"]');
    const theadEl = node.querySelector('[data-m="thead"]');
    const footerEl = node.querySelector('[data-m="footer"]');
    const rowEls = Array.from(node.querySelectorAll('[data-m="row"]'));

    const coverH = coverEl ? coverEl.offsetHeight : 0;
    const theadH = theadEl ? theadEl.offsetHeight : 0;
    const footerH = footerEl ? footerEl.offsetHeight : 0;
    const rowH = rowEls.map(el => el.offsetHeight);

    const firstHeadH = coverH + theadH;
    const contHeadH = theadH;

    const chunks = [];
    if (rowH.length === 0) {
      chunks.push([0, 0]);
    } else {
      let i = 0;
      let isFirst = true;
      while (i < rowH.length) {
        const avail = USABLE - (isFirst ? firstHeadH : contHeadH);
        const start = i;
        let used = 0;
        while (i < rowH.length && used + rowH[i] <= avail) {
          used += rowH[i];
          i += 1;
        }
        if (i === start) {
          i += 1; // a single row taller than the page: keep at least one
        }
        chunks.push([start, i]);
        isFirst = false;
      }

      // Keep the signature footer with content: if it does not fit on the last
      // sheet, spill trailing rows onto a fresh sheet that carries the footer.
      const lastHeadH = chunks.length === 1 ? firstHeadH : contHeadH;
      const last = chunks[chunks.length - 1];
      let lastUsed = 0;
      for (let k = last[0]; k < last[1]; k += 1) lastUsed += rowH[k];
      if (lastUsed + footerH > USABLE - lastHeadH) {
        let end = last[1];
        while (end > last[0] + 1 && lastUsed + footerH > USABLE - contHeadH) {
          end -= 1;
          lastUsed -= rowH[end];
        }
        if (end < last[1]) {
          chunks[chunks.length - 1] = [last[0], end];
          chunks.push([end, last[1]]);
        }
      }
    }

    setRowChunks(prev => {
      if (prev && prev.length === chunks.length && prev.every((c, idx) => c[0] === chunks[idx][0] && c[1] === chunks[idx][1])) {
        return prev;
      }
      return chunks;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, measureSignature]);

  const detailPageDefs = (rowChunks && rowChunks.length)
    ? rowChunks.map(([start, end]) => ({ rows: detailRows.slice(start, end), startIndex: start }))
    : [{ rows: detailRows, startIndex: 0 }];
  const previewTotalPages = detailPageDefs.length;

  const handlePrintPreview = () => {
    setShowPreview(true);
    window.setTimeout(() => {
      window.print();
    }, 120);
  };

  const handlePrintFromPreview = () => {
    window.print();
  };

  return (
    <>
      <PageShell
        header={
          <div className="page-header page-header--align-bottom">
            <div className="page-header-left">
              <h1>Reports</h1>
              <p>View categorized reports and analytics</p>
            </div>
            <div className="page-header-actions reports-header-actions">
              <button type="button" className="btn-report-action btn-report-action--preview" onClick={() => setShowPreview(true)}>
                <Eye size={16} />
                Preview
              </button>
              <button type="button" className="btn-report-action btn-report-action--print" onClick={handlePrintPreview}>
                <Printer size={16} />
                Print
              </button>
              <button type="button" className="btn-report-action btn-report-action--download" onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {isExporting ? 'Generating...' : 'Download DOCX'}
              </button>
            </div>
          </div>
        }
      >      {exportError && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {exportError}
        </div>
      )}

      <div className="report-cover">
        <div>
          <span>Generated Report</span>
          <strong>{categoryLabel}</strong>
        </div>
        <div>
          <span>Prepared By</span>
          <strong>{preparedBy}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{coverageText}</strong>
        </div>
        <div>
          <span>Generated</span>
          <strong>{generatedAt}</strong>
        </div>
      </div>

      {/* Category Tabs + Date Filter */}
      <div className="card reports-controls">
        <div className="reports-controls-toolbar">
          <div className="reports-category-tabs" role="tablist" aria-label="Report categories">
            {categories.map(cat => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={activeCategory === cat.id}
                className={`reports-category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>

          <div className="reports-date-filter">
            <div className="reports-date-filter-label">
              <Calendar size={16} />
              <span>Date range</span>
            </div>
            <input
              type="date"
              className="form-input reports-date-input"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              aria-label="Report start date"
            />
            <span className="reports-date-separator">to</span>
            <input
              type="date"
              className="form-input reports-date-input"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              aria-label="Report end date"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm reports-date-clear"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
              >
                <X size={14} />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ==================== SUMMARY ==================== */}
      {activeCategory === 'summary' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}>
            <StatCard label="Total Documents" value={filteredDocs.length} icon={<FileText size={20} />} color="#0f4c75" />
            <StatCard label="In Transit" value={statusCounts['In Transit']} icon={<ArrowRightLeft size={20} />} color="#f59e0b" />
            <StatCard label="For Filing" value={statusCounts['For Filing']} icon={<CheckCircle2 size={20} />} color="#087f8f" />
            <StatCard label="Signed" value={statusCounts['Signed']} icon={<CheckCircle2 size={20} />} color="#059669" />
            <StatCard label="Acknowledged" value={statusCounts['Acknowledged']} icon={<CheckCircle2 size={20} />} color="#0f766e" />
            <StatCard label="Archived" value={statusCounts['Archived']} icon={<Archive size={20} />} color="#10b981" />
          </div>

          <div className="grid-2" style={{ gap: '1.5rem' }}>
            {/* Status Distribution */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Status Distribution</h3>
              </div>
              {Object.entries(statusCounts).map(([status, count]) => {
                const colors = { 'Received': '#2563eb', 'In Transit': '#f59e0b', 'For Signing': '#8b5cf6', 'For Filing': '#087f8f', 'Signed': '#059669', 'Acknowledged': '#0f766e', 'Archived': '#10b981' };
                return <HorizontalBar key={status} label={status} value={count} max={filteredDocs.length} color={colors[status]} />;
              })}
            </div>

            {/* Priority Breakdown */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Priority Breakdown</h3>
              </div>
              {Object.entries(priorityCounts).map(([p, count]) => {
                const info = getPriorityInfo(p);
                return <HorizontalBar key={p} label={info.label} value={count} max={filteredDocs.length} color={info.color} />;
              })}
            </div>

            {/* Direction Split */}
            <div className="card reports-summary-card">
              <div className="card-header">
                <h3 className="card-title">Document Direction</h3>
              </div>
              <div className="reports-metric-split">
                <div className="reports-metric-box reports-metric-box--incoming">
                  <Inbox size={24} className="reports-metric-icon reports-metric-icon--accent" />
                  <p className="reports-metric-value">{directionCounts.Incoming}</p>
                  <p className="reports-metric-label">Incoming</p>
                </div>
                <div className="reports-metric-box reports-metric-box--outgoing">
                  <Send size={24} className="reports-metric-icon reports-metric-icon--primary" />
                  <p className="reports-metric-value">{directionCounts.Outgoing}</p>
                  <p className="reports-metric-label">Outgoing</p>
                </div>
              </div>
            </div>

            {/* Transmissions Summary */}
            <div className="card reports-summary-card">
              <div className="card-header">
                <h3 className="card-title">Transmissions Summary</h3>
              </div>
              <div className="reports-metric-split">
                <div className="reports-metric-box reports-metric-box--pending">
                  <Clock size={24} className="reports-metric-icon reports-metric-icon--amber" />
                  <p className="reports-metric-value">
                    {filteredTransmissions.filter(t => !t.receivedBy).length}
                  </p>
                  <p className="reports-metric-label">Pending Receipt</p>
                </div>
                <div className="reports-metric-box reports-metric-box--completed">
                  <CheckCircle2 size={24} className="reports-metric-icon reports-metric-icon--green" />
                  <p className="reports-metric-value">
                    {filteredTransmissions.filter(t => t.receivedBy).length}
                  </p>
                  <p className="reports-metric-label">Completed</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== DOCUMENTS ==================== */}
      {activeCategory === 'documents' && (
        <div>
          <div className="grid-2" style={{ gap: '1.5rem' }}>
            {/* By Document Type */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">By Document Type</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredDocs.length} total</span>
              </div>
              {docTypeCounts.length > 0 ? (
                docTypeCounts.map(dt => (
                  <HorizontalBar key={dt.name} label={dt.name} value={dt.count} max={maxCount} color="#0f4c75" />
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No documents in this period.</p>
              )}
            </div>

            {/* Recent Documents */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Latest Documents</h3>
              </div>
              <div className="activity-list">
                {filteredDocs.slice(0, 8).map(doc => {
                  const pInfo = getPriorityInfo(doc.priorityLevel);
                  return (
                    <div key={doc.id} className="activity-item">
                      <div className={`activity-dot ${doc.priorityLevel === 'urgent' ? 'red' : 'blue'}`}></div>
                      <div style={{ flex: 1 }}>
                        <p className="activity-text"><strong>{doc.subject}</strong></p>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                          <span className="td-mono" style={{ fontSize: '0.68rem' }}>{doc.trackingNumber}</span>
                          <span style={{
                            padding: '0.1rem 0.375rem', borderRadius: '9999px',
                            fontSize: '0.6rem', fontWeight: 600,
                            background: pInfo.bg, color: pInfo.color,
                          }}>
                            {pInfo.label}
                          </span>
                          <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`} style={{ fontSize: '0.6rem' }}>
                            {getWorkflowStatus(doc)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Full document table */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header">
              <h3 className="card-title">Document Report Table</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredDocs.length} documents</span>
            </div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Tracking #</th>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Direction</th>
                    <th>Status</th>
                    <th className="reports-date-col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReportDocs.length ? paginatedReportDocs.map(doc => {
                    const pInfo = getPriorityInfo(doc.priorityLevel);
                    return (
                      <tr key={doc.id}>
                        <td><span className="td-mono">{doc.trackingNumber}</span></td>
                        <td className="td-primary">{doc.subject}</td>
                        <td>{getDocTypeName(doc.documentTypeId)}</td>
                        <td>
                          <span style={{
                            padding: '0.15rem 0.5rem', borderRadius: '9999px',
                            fontSize: '0.7rem', fontWeight: 600,
                            background: pInfo.bg, color: pInfo.color,
                          }}>
                            {pInfo.label}
                          </span>
                        </td>
                        <td>{doc.documentDirection}</td>
                        <td>
                          <span className={`status-badge status-${getWorkflowStatus(doc).toLowerCase().replace(/\s+/g, '-')}`}>
                            {getWorkflowStatus(doc)}
                          </span>
                        </td>
                        <td className="reports-date-col reports-date-cell">{formatReportDate(doc.dateReceived)}</td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                        No documents match the current report filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination-toolbar report-table-pagination">
              <div className="pagination-summary">
                Showing {reportShowFrom}-{reportShowTo} of {filteredDocs.length} documents
              </div>
              <div className="pagination-pages">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={reportTablePage <= 1}
                  onClick={() => setReportTablePage(prev => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span>Page {reportTablePage} of {reportTableTotalPages}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={reportTablePage >= reportTableTotalPages}
                  onClick={() => setReportTablePage(prev => Math.min(reportTableTotalPages, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {}
      {activeCategory === 'transmissions' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}>
            <StatCard label="Total Transmissions" value={filteredTransmissions.length} icon={<ArrowRightLeft size={20} />} color="#0f4c75" />
            <StatCard label="Pending Receipt" value={filteredTransmissions.filter(t => !t.receivedBy).length} icon={<Clock size={20} />} color="#f59e0b" />
            <StatCard label="Completed" value={filteredTransmissions.filter(t => t.receivedBy).length} icon={<CheckCircle2 size={20} />} color="#10b981" />
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Transmission Report</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {filteredTransmissions.length} transmissions
              </span>
            </div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th className="reports-trans-col-id">ID</th>
                    <th className="reports-trans-col-document">Document</th>
                    <th className="reports-trans-col-from">From</th>
                    <th className="reports-trans-col-to">To</th>
                    <th className="reports-trans-col-sent-by">Sent By</th>
                    <th className="reports-date-col reports-trans-col-date">Date</th>
                    <th className="reports-trans-col-status">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReportTransmissions.length ? paginatedReportTransmissions.map(t => {
                    const doc = documents.find(d => d.id === t.documentId);
                    return (
                      <tr key={t.id}>
                        <td className="reports-trans-col-id"><span className="td-mono">{t.id}</span></td>
                        <td className="td-primary reports-trans-col-document">{doc?.subject || '—'}</td>
                        <td className="reports-trans-col-from">{getOfficeName(t.fromOfficeId)}</td>
                        <td className="reports-trans-col-to">{getOfficeName(t.toOfficeId)}</td>
                        <td className="reports-trans-col-sent-by">{getUserFullName(t.sentBy)}</td>
                        <td className="reports-date-col reports-date-cell reports-trans-col-date">{formatReportDate(t.transmissionDate)}</td>
                        <td className="reports-trans-col-status">
                          {t.receivedBy ? (
                            <span className="status-badge status-archived">Completed</span>
                          ) : (
                            <span className="status-badge status-in-transit">Pending Receipt</span>
                          )}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                        No transmissions match the current report filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination-toolbar report-table-pagination">
              <div className="pagination-summary">
                Showing {transmissionReportShowFrom}-{transmissionReportShowTo} of {filteredTransmissions.length} transmissions
              </div>
              <div className="pagination-pages">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={transmissionReportTablePage <= 1}
                  onClick={() => setTransmissionReportTablePage(prev => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span>Page {transmissionReportTablePage} of {transmissionReportTotalPages}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={transmissionReportTablePage >= transmissionReportTotalPages}
                  onClick={() => setTransmissionReportTablePage(prev => Math.min(transmissionReportTotalPages, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== BY OFFICE ==================== */}
      {activeCategory === 'offices' && (
        <div>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header">
              <h3 className="card-title">Transmission Volume by Office</h3>
            </div>
            {officeStats.length > 0 ? (
              officeStats.map(o => (
                <HorizontalBar key={o.name} label={o.name} value={o.total} max={maxOffice} color="#0891b2" />
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No office data in this period.</p>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Office Detail</h3>
            </div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Office</th>
                    <th style={{ textAlign: 'center' }}>Sent From</th>
                    <th style={{ textAlign: 'center' }}>Received To</th>
                    <th style={{ textAlign: 'center' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {officeStats.map(o => (
                    <tr key={o.name}>
                      <td className="td-primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Building2 size={14} style={{ color: 'var(--text-muted)' }} />
                          {o.name}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', color: '#f59e0b', fontWeight: 600 }}>{o.sentFrom}</td>
                      <td style={{ textAlign: 'center', color: '#3b82f6', fontWeight: 600 }}>{o.sentTo}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-main)' }}>{o.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ACTIVITY ==================== */}
      {activeCategory === 'activity' && canViewActivity && (
        <div>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header">
              <h3 className="card-title">User Activity Summary</h3>
            </div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th style={{ textAlign: 'center' }}>Total Actions</th>
                    <th>Last Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const userLogs = logs.filter(l => l.userId === u.id);
                    const lastLog = userLogs.length > 0 ? userLogs[0] : null;
                    return (
                      <tr key={u.id}>
                        <td className="td-primary">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div className="user-avatar" style={{ width: '28px', height: '28px', fontSize: '0.65rem' }}>{u.fname[0]}{u.lname[0]}</div>
                            {u.fname} {u.lname}
                          </div>
                        </td>
                        <td>
                          <span style={{
                            padding: '0.15rem 0.5rem', borderRadius: '9999px',
                            fontSize: '0.7rem', fontWeight: 600,
                            background: u.role === 'Admin' ? 'rgba(239, 68, 68, 0.1)' : u.role === 'Mayor' ? 'var(--info-bg)' : 'var(--success-bg)',
                            color: u.role === 'Admin' ? '#ef4444' : u.role === 'Mayor' ? 'var(--info)' : 'var(--success)',
                          }}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{userLogs.length}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {lastLog ? lastLog.details?.slice(0, 50) : 'No activity'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Activity Log</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{logs.length} entries</span>
            </div>
            <div className="activity-list">
              {logs.slice(0, 15).map(log => (
                <div key={log.id} className="activity-item">
                  <div className={`activity-dot ${
                    log.action.includes('received') ? 'blue' :
                    log.action.includes('created') || log.action.includes('scanned') ? 'green' :
                    log.action.includes('login') ? 'purple' : 'amber'
                  }`}></div>
                  <div style={{ flex: 1 }}>
                    <p className="activity-text">
                      <strong>{getUserFullName(log.userId)}</strong> — {log.details}
                    </p>
                    <p className="activity-time">
                      <Clock size={10} style={{ marginRight: '0.25rem' }} />
                      {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      </PageShell>

      {showPreview && (
        <ModalOverlay overlayClassName="report-preview-overlay" onClose={() => setShowPreview(false)}>
          <div className="modal report-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="report-preview-toolbar">
              <div>
                <h2>Report Preview</h2>
                <p>{categoryLabel} - {coverageText}</p>
              </div>
              <div className="report-preview-actions">
                <button type="button" className="btn-report-action btn-report-action--print" onClick={handlePrintFromPreview}>
                  <Printer size={16} /> Print
                </button>
                <button className="btn-icon" onClick={() => setShowPreview(false)} aria-label="Close preview">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="report-print-root">
              {detailPageDefs.map((pageDef, pageIndex) => {
                const isFirstSheet = pageIndex === 0;
                const isLastSheet = pageIndex === previewTotalPages - 1;
                const pageRows = pageDef.rows;
                const rowOffset = pageDef.startIndex;

                return (
                  <section className="official-report-page" key={pageIndex}>
                    {isFirstSheet ? (
                      <>
                        {coverBlock}

                        {previewTable.title && (
                          <div className="official-report-section">
                            <h3 className="official-report-section-title">{previewTable.title}</h3>
                            <div className="official-report-table-wrap">
                              <table className="official-report-table">
                                {detailColgroup}
                                {detailThead}
                                <tbody>
                                  {pageRows.length ? pageRows.map((row, rowIndex) => (
                                    <tr key={rowOffset + rowIndex}>
                                      {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '-'}</td>)}
                                    </tr>
                                  )) : (
                                    <tr>
                                      <td colSpan={previewTable.headers.length || 1}>No records found for the selected coverage.</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="official-report-section">
                        <div className="official-report-table-wrap">
                          <table className="official-report-table">
                            {detailColgroup}
                            {detailThead}
                            <tbody>
                              {pageRows.map((row, rowIndex) => (
                                <tr key={rowOffset + rowIndex}>
                                  {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '-'}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {isLastSheet && footerBlock}

                    <div className="official-report-page-number">
                      Page {pageIndex + 1} of {previewTotalPages}
                    </div>
                  </section>
                );
              })}

              {/* Hidden measurement layer: mirrors a single sheet's content at
                  the true print width so we can paginate by real pixel heights. */}
              <div className="report-measure-layer" ref={measureRef} aria-hidden="true">
                <div className="official-report-page report-measure-page">
                  <div data-m="cover">{coverBlock}</div>
                  {previewTable.title && (
                    <div className="official-report-section">
                      <div className="official-report-table-wrap">
                        <table className="official-report-table">
                          {detailColgroup}
                          <thead data-m="thead">
                            <tr>
                              {previewTable.headers.map(header => <th key={header}>{header}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {detailRows.map((row, rowIndex) => (
                              <tr key={rowIndex} data-m="row">
                                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '-'}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div data-m="footer">{footerBlock}</div>
                </div>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default ReportsPage;
