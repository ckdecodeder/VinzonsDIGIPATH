import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import {
  getPriorityInfo,
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
} from '../data/mockData';
import { sortNewest } from '../utils/sorting';
import usePhilippinesClock from '../hooks/usePhilippinesClock';
import { formatPhilippinesDateTime } from '../utils/philippinesDateTime';
import {
  buildReportFilename,
  prepareReportPdf,
  exportReportPagesAsJpeg,
  exportReportPagesAsPdf,
} from '../utils/reportExport';
import {
  filterActivityLogs,
  filterByDateRange,
  filterDocuments,
  filterOfficeStats,
  filterTransmissions,
} from '../utils/reportFilters';

const ReportClock = () => <>{usePhilippinesClock()}</>;
const ReportPdfPreview = lazy(() => import('../components/ReportPdfPreview'));
const reportDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric' });
const reportDateTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const releasePdfUrl = (file) => { if (file?.url) setTimeout(() => URL.revokeObjectURL(file.url), 60000); };

const ReportsPage = ({
  documents = [],
  transmissions = [],
  archives = [],
  offices = defaultOffices,
  users = [],
  logs = [],
  documentTypes = defaultDocumentTypes,
  currentRole,
  currentUser,
  onNotify,
}) => {
  const [activeCategory, setActiveCategory] = useState('summary');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [documentFilters, setDocumentFilters] = useState({
    status: '', typeId: '', priority: '', direction: '', officeId: '',
  });
  const [transmissionFilters, setTransmissionFilters] = useState({
    status: '', type: '', fromOfficeId: '', toOfficeId: '', sentBy: '', receivedBy: '',
  });
  const [officeFilter, setOfficeFilter] = useState('');
  const [activityFilters, setActivityFilters] = useState({ search: '', action: '', userId: '', reference: '' });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [reportFile, setReportFile] = useState(null);
  const [reportProgress, setReportProgress] = useState(null);
  const [printHint, setPrintHint] = useState(false);
  const fileRef = useRef(null);
  const jobRef = useRef(null);
  useEffect(() => () => {
    jobRef.current?.controller.abort();
    jobRef.current?.printWindow?.close();
    jobRef.current = null;
    releasePdfUrl(fileRef.current);
  }, []);
  const downloadMenuRef = useRef(null);
  const [reportTablePage, setReportTablePage] = useState(1);
  const [transmissionReportTablePage, setTransmissionReportTablePage] = useState(1);

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

  const dateFilteredTransmissions = useMemo(() => sortNewest(
    filterByDateRange(transmissions, 'transmissionDate', dateFrom, dateTo),
    ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate'],
  ), [transmissions, dateFrom, dateTo]);
  const filteredArchives = useMemo(() => sortNewest(
    filterByDateRange(archives, 'date', dateFrom, dateTo), ['createdAt', 'updatedAt', 'date'],
  ), [archives, dateFrom, dateTo]);
  const filteredDocs = useMemo(() => sortNewest(filterDocuments(documents, {
    ...documentFilters, dateFrom, dateTo,
  }), ['createdAt', 'updatedAt', 'dateReceived']), [documents, documentFilters, dateFrom, dateTo]);
  const filteredTransmissions = useMemo(() => sortNewest(filterTransmissions(transmissions, {
    ...transmissionFilters, dateFrom, dateTo,
  }), ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']), [transmissions, transmissionFilters, dateFrom, dateTo]);
  const filteredLogs = useMemo(() => sortNewest(filterActivityLogs(logs, {
    ...activityFilters, dateFrom, dateTo, users,
  }), ['timestamp']), [logs, activityFilters, dateFrom, dateTo, users]);
  const activityUsers = useMemo(() => {
    const ids = new Set(filteredLogs.map((log) => log.userId));
    return users.filter((user) => ids.has(user.id));
  }, [users, filteredLogs]);

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
  }, [dateFrom, dateTo, activeCategory, documentFilters, transmissionFilters, officeFilter, activityFilters]);

  useEffect(() => {
    setReportTablePage((current) => Math.min(current, reportTableTotalPages));
  }, [reportTableTotalPages]);

  useEffect(() => {
    setTransmissionReportTablePage((current) => Math.min(current, transmissionReportTotalPages));
  }, [transmissionReportTotalPages]);

  useEffect(() => {
    if (!downloadMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!downloadMenuRef.current?.contains(event.target)) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [downloadMenuOpen]);

  useEffect(() => {
    if (!showPreview) setDownloadMenuOpen(false);
  }, [showPreview]);

  const getOfficeName = (officeId) => {
    const office = offices.find((item) => item.id === officeId);
    return office ? office.name : 'Unknown Office';
  };

  const getUserFullName = (userId) => {
    const user = users.find((item) => item.id === userId);
    return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : 'Unknown';
  };

  const getWorkflowStatus = (doc) => {
    if (doc.status === 'For Signature') return 'For Signing';
    if (doc.status === 'Acknoweledged') return 'Acknowledged';
    return doc.status || 'Received';
  };

  const updateDocumentFilter = (key, value) => {
    setDocumentFilters((current) => ({ ...current, [key]: value }));
  };

  const updateTransmissionFilter = (key, value) => {
    setTransmissionFilters((current) => ({ ...current, [key]: value }));
  };

  const updateActivityFilter = (key, value) => {
    setActivityFilters((current) => ({ ...current, [key]: value }));
  };

  const getFilterValues = (items, field) => [...new Set(
    items.map((item) => item?.[field]).filter((value) => value !== undefined && value !== null && value !== ''),
  )].sort((a, b) => String(a).localeCompare(String(b)));

  const renderFilterSelect = (label, value, onChange, options, allLabel = `All ${label.toLowerCase()}`) => (
    <label className="report-filter-control">
      <span>{label}</span>
      <select className="form-select" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Filter report by ${label.toLowerCase()}`}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );

  const officeOptions = offices.map((office) => ({ value: office.id, label: office.name }));
  const userOptions = users.map((user) => ({
    value: user.id,
    label: getUserFullName(user.id),
  }));
  const documentTypeOptions = documentTypes.map((type) => ({ value: type.id, label: type.category }));
  const documentStatusOptions = getFilterValues(documents, 'status').map((value) => ({
    value,
    label: getWorkflowStatus({ status: value }),
  }));
  const priorityOptions = getFilterValues(documents, 'priorityLevel').map((value) => ({
    value,
    label: getPriorityInfo(value).label || value,
  }));
  const directionOptions = getFilterValues(documents, 'documentDirection').map((value) => ({ value, label: value }));
  const transmissionTypeOptions = getFilterValues(transmissions, 'transmissionType').map((value) => ({ value, label: value }));
  const activityActionOptions = getFilterValues(logs, 'action').map((value) => ({ value, label: value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') }));

  const renderCategoryFilters = () => {
    if (activeCategory === 'summary' || activeCategory === 'documents') {
      return (
        <div className="report-filter-row reports-extra-filters" aria-label="Document report filters">
          {renderFilterSelect('Status', documentFilters.status, (value) => updateDocumentFilter('status', value), documentStatusOptions)}
          {renderFilterSelect('Type', documentFilters.typeId, (value) => updateDocumentFilter('typeId', value), documentTypeOptions)}
          {renderFilterSelect('Priority', documentFilters.priority, (value) => updateDocumentFilter('priority', value), priorityOptions)}
          {renderFilterSelect('Direction', documentFilters.direction, (value) => updateDocumentFilter('direction', value), directionOptions)}
          {renderFilterSelect('Office', documentFilters.officeId, (value) => updateDocumentFilter('officeId', value), officeOptions)}
        </div>
      );
    }

    if (activeCategory === 'transmissions') {
      return (
        <div className="report-filter-row reports-extra-filters" aria-label="Transmission report filters">
          {renderFilterSelect('Status', transmissionFilters.status, (value) => updateTransmissionFilter('status', value), [
            { value: 'Pending', label: 'Pending Receipt' },
            { value: 'Completed', label: 'Completed' },
          ])}
          {renderFilterSelect('Type', transmissionFilters.type, (value) => updateTransmissionFilter('type', value), transmissionTypeOptions)}
          {renderFilterSelect('Source office', transmissionFilters.fromOfficeId, (value) => updateTransmissionFilter('fromOfficeId', value), officeOptions)}
          {renderFilterSelect('Destination office', transmissionFilters.toOfficeId, (value) => updateTransmissionFilter('toOfficeId', value), officeOptions)}
          {renderFilterSelect('Sender', transmissionFilters.sentBy, (value) => updateTransmissionFilter('sentBy', value), userOptions)}
          {renderFilterSelect('Receiver', transmissionFilters.receivedBy, (value) => updateTransmissionFilter('receivedBy', value), userOptions)}
        </div>
      );
    }

    if (activeCategory === 'offices') {
      return (
        <div className="report-filter-row reports-extra-filters" aria-label="Office report filters">
          {renderFilterSelect('Office', officeFilter, setOfficeFilter, officeOptions)}
        </div>
      );
    }

    if (activeCategory === 'activity' && canViewActivity) {
      return (
        <div className="report-filter-row reports-extra-filters" aria-label="Activity report filters">
          <label className="report-filter-control report-filter-control--search">
            <span>Search</span>
            <input className="form-input" type="search" value={activityFilters.search} onChange={(event) => updateActivityFilter('search', event.target.value)} placeholder="Search details, reference, user, or action" aria-label="Search activity report" />
          </label>
          {renderFilterSelect('Action', activityFilters.action, (value) => updateActivityFilter('action', value), activityActionOptions)}
          {renderFilterSelect('User', activityFilters.userId, (value) => updateActivityFilter('userId', value), userOptions)}
          <label className="report-filter-control">
            <span>Reference</span>
            <input className="form-input" type="search" value={activityFilters.reference} onChange={(event) => updateActivityFilter('reference', event.target.value)} placeholder="Reference ID" aria-label="Filter activity report by reference" />
          </label>
        </div>
      );
    }

    return null;
  };

  const getDocTypeName = (typeId) => {
    const documentType = documentTypes.find((item) => item.id === typeId);
    return documentType ? documentType.category : 'Unknown';
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
    const sentFrom = dateFilteredTransmissions.filter(t => t.fromOfficeId === office.id).length;
    const sentTo = dateFilteredTransmissions.filter(t => t.toOfficeId === office.id).length;
    return { id: office.id, name: office.name, sentFrom, sentTo, total: sentFrom + sentTo };
  }).filter(o => o.total > 0).sort((a, b) => b.total - a.total);
  const filteredOfficeStats = filterOfficeStats(officeStats, officeFilter);

  // ====== STAT CARD COMPONENT ======
  const StatCard = ({ label, value, icon, color, sub }) => (
    <div className="report-stat-card">
      <div className="report-stat-card-icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="report-stat-card-body">
        <p className="report-stat-card-label">{label}</p>
        <p className="report-stat-card-value">{value}</p>
        {sub && <p className="report-stat-card-sub">{sub}</p>}
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
  const maxOffice = Math.max(...filteredOfficeStats.map(o => o.total), 1);

  const closePreview = () => {
    jobRef.current?.controller.abort();
    jobRef.current?.printWindow?.close();
    setShowPreview(false); setDownloadMenuOpen(false);
    releasePdfUrl(fileRef.current); fileRef.current = null; setReportFile(null);
  };

  const runReportAction = async (action) => {
    if (jobRef.current) return;
    let printWindow = null;
    // Open during the click gesture, before asynchronous generation, so printing
    // is not blocked as a popup. It never calls window.print() on the live app.
    if (action === 'print') {
      printWindow = window.open('about:blank', '_blank');
      if (!printWindow) { setExportError('Please allow the report tab to open, or download the PDF and print it.'); return; }
      printWindow.opener = null;
      printWindow.document.title = 'Preparing DigiPath report';
      printWindow.document.body.textContent = 'Preparing your report for printing. You can cancel from DigiPath.';
    }
    const controller = new AbortController();
    const job = { controller, printWindow };
    jobRef.current = job;
    setExportError(''); setIsExporting(true); setDownloadMenuOpen(false); setPrintHint(false);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, action === 'jpeg' ? 300000 : 125000);
    try {
      let file = showPreview ? fileRef.current : null;
      if (!file) {
        releasePdfUrl(fileRef.current); fileRef.current = null; setReportFile(null);
        setShowPreview(true);
        setReportProgress({ completedRows: 0, totalRows: 0, stage: 'preparing' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (controller.signal.aborted) throw Object.assign(new Error('Report generation cancelled.'), { name: 'AbortError' });
        const table = getPreviewTable();
        const model = { categoryLabel, preparedBy, coverageText, generatedAt: formatPhilippinesDateTime(),
          recordCount: activeCategory === 'summary' ? filteredDocs.length : table.rows.length,
          summaryRows, table };
        setReportProgress({ completedRows: 0, totalRows: table.title ? table.rows.length : 0, stage: 'pdf' });
        const result = await prepareReportPdf(model, { signal: controller.signal, onProgress: (progress) => {
          if (jobRef.current === job) setReportProgress({ ...progress, stage: 'pdf' });
        } });
        if (jobRef.current !== job || controller.signal.aborted) return;
        file = { ...result, recordCount: model.recordCount,
          url: URL.createObjectURL(new Blob([result.buffer], { type: 'application/pdf' })) };
        fileRef.current = file; setReportFile(file);
      }
      if (action === 'pdf') exportReportPagesAsPdf(file, buildReportFilename(categoryLabel, 'pdf'));
      if (action === 'jpeg') await exportReportPagesAsJpeg(file, buildReportFilename(categoryLabel, 'jpeg'), {
        signal: controller.signal,
        onProgress: (progress) => { if (jobRef.current === job) setReportProgress(progress); },
      });
      if (action === 'print' && printWindow && !printWindow.closed) {
        printWindow.location.href = file.url;
        job.printWindow = null;
        setPrintHint(true);
      }
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      if (jobRef.current === job) {
        const message = timedOut ? 'Report generation took too long. Retry or select a smaller date range.'
          : error.name === 'AbortError' ? 'Report generation cancelled. You can retry.'
          : error.message || 'Unable to generate the report. Please retry.';
        setExportError(message);
        if (error.name !== 'AbortError') onNotify?.({ type: 'danger', title: 'Report generation failed', message });
      }
    } finally {
      clearTimeout(timer);
      if (jobRef.current === job) { jobRef.current = null; setIsExporting(false); setReportProgress(null); }
    }
  };

  const renderDownloadMenu = (compact = false) => (
    <div
      className={`report-download-menu${compact ? ' report-download-menu--compact' : ''}`}
      ref={downloadMenuRef}
    >
      <button
        type="button"
        className="btn-report-action btn-report-action--download"
        onClick={() => setDownloadMenuOpen((open) => !open)}
        disabled={isExporting}
        aria-haspopup="menu"
        aria-expanded={downloadMenuOpen}
      >
        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {isExporting ? 'Generating...' : 'Download'}
        {!isExporting && <ChevronDown size={14} className={`report-download-chevron${downloadMenuOpen ? ' is-open' : ''}`} />}
      </button>
      {downloadMenuOpen && (
        <div className="report-download-menu-panel" role="menu" aria-label="Download format">
          <button type="button" role="menuitem" onClick={() => runReportAction('pdf')}>
            Download as PDF
          </button>
          <button type="button" role="menuitem" onClick={() => runReportAction('jpeg')}>
            Download as JPEG (ZIP for multiple pages)
          </button>
        </div>
      )}
    </div>
  );

  const categoryLabel = categories.find(item => item.id === activeCategory)?.label || 'Summary';
  const preparedBy = currentUser ? `${currentUser.fname} ${currentUser.lname}` : 'DigiPath User';
  const coverageText = `${dateFrom || 'Start'} to ${dateTo || 'Present'}`;
  const formatReportDate = (value, withTime = false) => {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return (withTime ? reportDateTime : reportDate).format(date);
  };
  const percent = (value, total) => (!total ? '0%' : `${Math.round((value / total) * 100)}%`);
  const summaryRows = [
    ['Documents', 'Total Documents', filteredDocs.length, `${directionCounts.Incoming} incoming / ${directionCounts.Outgoing} outgoing`],
    ['Documents', 'Received', statusCounts.Received, percent(statusCounts.Received, filteredDocs.length)],
    ['Documents', 'For Signing', statusCounts['For Signing'], percent(statusCounts['For Signing'], filteredDocs.length)],
    ['Documents', 'For Filing', statusCounts['For Filing'], percent(statusCounts['For Filing'], filteredDocs.length)],
    ['Documents', 'Signed', statusCounts.Signed, percent(statusCounts.Signed, filteredDocs.length)],
    ['Documents', 'Acknowledged', statusCounts.Acknowledged, percent(statusCounts.Acknowledged, filteredDocs.length)],
    ['Routing', 'Total Transmissions', dateFilteredTransmissions.length, `${dateFilteredTransmissions.filter(t => !t.receivedBy).length} pending / ${dateFilteredTransmissions.filter(t => t.receivedBy).length} completed`],
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
      const totalOfficeMovement = filteredOfficeStats.reduce((sum, item) => sum + item.total, 0);
      return {
        title: 'Office Movement Report',
        headers: ['Office', 'Sent From', 'Received To', 'Total', 'Share', 'Notes'],
        columnWidths: ['18%', '14%', '14%', '10%', '10%', '34%'],
        rows: filteredOfficeStats.map(item => [
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
              <button type="button" className="btn-report-action btn-report-action--preview" onClick={() => runReportAction('preview')} disabled={isExporting}>
                <Eye size={16} />
                Preview
              </button>
              <button type="button" className="btn-report-action btn-report-action--print" onClick={() => runReportAction('print')} disabled={isExporting}>
                <Printer size={16} />
                Print
              </button>
              {!showPreview && renderDownloadMenu()}
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
          <strong><ReportClock /></strong>
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
          {renderCategoryFilters()}
        </div>
      </div>

      {/* ==================== SUMMARY ==================== */}
      {activeCategory === 'summary' && (
        <div>
          <div className="reports-stats-grid">
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

            {/* FIFO note instead of priority */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Processing Order</h3>
              </div>
              <p className="field-hint" style={{ padding: '0.75rem 1rem' }}>
                Documents are processed first-come-first-served by registration date (oldest first). Priority levels have been removed.
              </p>
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
          <div className="reports-stats-grid reports-stats-grid--compact">
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
            {filteredOfficeStats.length > 0 ? (
              filteredOfficeStats.map(o => (
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
                  {filteredOfficeStats.map(o => (
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
                {activityUsers.map(u => {
                    const userLogs = filteredLogs.filter(l => l.userId === u.id);
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
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredLogs.length} entries</span>
            </div>
            <div className="activity-list">
              {filteredLogs.slice(0, 15).map(log => (
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
        <ModalOverlay overlayClassName="report-preview-overlay" onClose={closePreview}>
          <div className="modal report-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="report-preview-toolbar">
              <div><h2>Report Preview</h2><p>{categoryLabel} - {coverageText}</p></div>
              <div className="report-preview-actions">
                <button type="button" className="btn-report-action btn-report-action--print" onClick={() => runReportAction('print')} disabled={isExporting}>
                  <Printer size={16} /> Print
                </button>
                {renderDownloadMenu(true)}
                <button className="btn-icon" onClick={closePreview} aria-label="Close preview"><X size={18} /></button>
              </div>
            </div>
            {isExporting && <div className="report-generation-status" role="status" aria-live="polite">
              <Loader2 size={16} className="animate-spin" />
              <span>{reportProgress?.stage === 'images' ? 'Preparing images' : 'Preparing PDF'}
                {reportProgress?.totalRows > 0 ? `: ${reportProgress.completedRows.toLocaleString()} / ${reportProgress.totalRows.toLocaleString()}` : '…'}</span>
              {reportProgress?.totalRows > 0 && <progress value={reportProgress.completedRows} max={reportProgress.totalRows} aria-label="Report generation progress" />}
              <button className="btn btn-secondary btn-sm" onClick={() => jobRef.current?.controller.abort()}>Cancel</button>
            </div>}
            {exportError && <div className="report-generation-status" role="alert">
              <span>{exportError}</span>
              {!isExporting && <button className="btn btn-secondary btn-sm" onClick={() => runReportAction('preview')}>Retry PDF</button>}
            </div>}
            {printHint && <p className="report-generation-status">Your PDF opened in a new tab. Use its print button or Ctrl+P to print.</p>}
            {reportFile ? <>
              <div className="report-generation-status">
                <span>{reportFile.pageCount.toLocaleString()} pages · {reportFile.recordCount.toLocaleString()} records</span>
                <a href={reportFile.url} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a>
              </div>
              <Suspense fallback={<p className="report-generation-status">Loading PDF preview…</p>}>
                <ReportPdfPreview key={reportFile.url} file={reportFile} />
              </Suspense>
            </> : !isExporting && <div className="report-generation-empty">Select Retry PDF to prepare the report, or close this preview.</div>}
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default ReportsPage;
