const express = require('express');
const router = express.Router();
const path = require('path');
const { Document, Transmission, Archive, Office, User, DocumentType, Log } = require('../models');
const { protect } = require('../middleware/auth');
const { WORD_MIME, buildOfficialReportDocx } = require('../utils/reportDocx');
const {
  asyncHandler,
  createHttpError,
  isApprovalRole,
  normalizeText,
  sanitizeFileName,
  workflowStatuses,
  normalizeWorkflowStatus,
} = require('../utils/helpers');

const reportTemplatePath = process.env.REPORT_TEMPLATE_PATH || path.join(__dirname, '..', 'templates', 'Vinzons_Report_Template.docx');

const reportCategories = {
  summary: 'Summary',
  documents: 'Documents',
  transmissions: 'Transmissions',
  offices: 'By Office',
  activity: 'Activity',
};

const priorityLabels = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const getFullName = (user) => {
  if (!user) return 'Unknown';
  return `${user.fname || ''} ${user.mname || ''} ${user.lname || ''}`.replace(/\s+/g, ' ').trim() || user.username || 'Unknown';
};

const formatReportDate = (value, withTime = false) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};

const dateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const inReportRange = (item, field, dateFrom, dateTo) => {
  const key = dateKey(item?.[field]);
  if (!key) return true;
  if (dateFrom && key < dateFrom) return false;
  if (dateTo && key > dateTo) return false;
  return true;
};

const getOfficeMap = (offices) => offices.reduce((map, office) => {
  map[office.id] = office.name;
  return map;
}, {});

const getUserMap = (users) => users.reduce((map, user) => {
  map[user.id] = user;
  return map;
}, {});

const getDocumentTypeMap = (documentTypes) => documentTypes.reduce((map, item) => {
  map[item.id] = item.category;
  return map;
}, {});

const reportStatus = (doc) => {
  if (doc.status === 'For Signature') return 'For Signing';
  if (doc.status === 'Acknoweledged') return 'Acknowledged';
  return normalizeWorkflowStatus(doc.status, doc.status || 'Received');
};

const percentText = (value, total) => {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
};

// Shared helpers from document scoping (copied for report scoping)
const getUserOfficeId = (req) => req.user?.officeId;
const isGlobalRole = (req) => req.user?.role === 'Admin' || req.user?.role === 'Mayor';

const getScopedDocumentQuery = (req) => {
  if (isGlobalRole(req)) return {};
  const officeId = getUserOfficeId(req);
  if (req.user?.role === 'Receptionist') {
    return {
      $or: [
        { 'timeline.userId': req.user.id },
        { verifiedBy: req.user.id },
      ],
    };
  }
  return {
    $or: [
      { originOfficeId: officeId },
      { currentOfficeId: officeId },
      { destinationOfficeId: officeId },
      { 'timeline.userId': req.user.id },
    ],
  };
};

const getScopedTransmissionQuery = (req) => {
  if (isGlobalRole(req)) return {};
  const officeId = getUserOfficeId(req);
  if (req.user?.role === 'Receptionist') {
    return {
      $or: [
        { toOfficeId: officeId, receivedBy: { $in: [null, ''] } },
        { sentBy: req.user.id },
        { receivedBy: req.user.id },
      ],
    };
  }
  return {
    $or: [
      { fromOfficeId: officeId },
      { toOfficeId: officeId },
      { sentBy: req.user.id },
      { receivedBy: req.user.id },
    ],
  };
};

const getScopedDocumentQueryWithTransmissions = async (req) => {
  const baseQuery = getScopedDocumentQuery(req);
  if (isGlobalRole(req)) return baseQuery;
  const transmissions = await Transmission.find(getScopedTransmissionQuery(req)).select('documentId').lean();
  const documentIds = transmissions.map((transmission) => transmission.documentId);
  return {
    $or: [
      ...(baseQuery.$or || []),
      { id: { $in: documentIds } },
    ],
  };
};

const buildReportData = async (req, category, dateFrom, dateTo) => {
  if (!reportCategories[category]) {
    throw createHttpError(`Unknown report category: ${category}`, 400);
  }
  if (category === 'activity' && !isApprovalRole(req)) {
    throw createHttpError('Activity reports are available to Admin and Mayor users only', 403);
  }

  const [
    documents,
    transmissions,
    archives,
    offices,
    users,
    documentTypes,
    logs,
  ] = await Promise.all([
    Document.find(await getScopedDocumentQueryWithTransmissions(req)).sort({ createdAt: -1, dateReceived: -1, _id: -1 }).lean(),
    Transmission.find(getScopedTransmissionQuery(req)).sort({ createdAt: -1, transmissionDate: -1, _id: -1 }).lean(),
    Archive.find().sort({ createdAt: -1, date: -1, _id: -1 }).lean(),
    Office.find().sort({ id: 1 }).lean(),
    User.find().sort({ lname: 1, fname: 1 }).lean(),
    DocumentType.find().sort({ id: 1 }).lean(),
    Log.find(req.user.role === 'Receptionist' ? { userId: req.user.id } : {}).sort({ timestamp: -1, _id: -1 }).lean(),
  ]);

  const visibleDocumentIds = new Set(documents.map((doc) => doc.id));
  const visibleArchives = archives.filter((archive) => visibleDocumentIds.has(archive.documentId));
  const filteredDocs = documents.filter((doc) => inReportRange(doc, 'dateReceived', dateFrom, dateTo));
  const filteredTransmissions = transmissions.filter((transmission) => inReportRange(transmission, 'transmissionDate', dateFrom, dateTo));
  const filteredArchives = visibleArchives.filter((archive) => inReportRange(archive, 'date', dateFrom, dateTo));
  const filteredLogs = logs.filter((log) => inReportRange(log, 'timestamp', dateFrom, dateTo));
  const officeMap = getOfficeMap(offices);
  const userMap = getUserMap(users);
  const documentTypeMap = getDocumentTypeMap(documentTypes);
  const docMap = documents.reduce((map, doc) => {
    map[doc.id] = doc;
    return map;
  }, {});
  const officeName = (officeId, fallback = '') => fallback || officeMap[officeId] || officeId || 'Not recorded';
  const userName = (userId) => getFullName(userMap[userId]);
  const docTypeName = (doc) => {
    if (doc.documentTypeOther) return doc.documentTypeOther;
    return documentTypeMap[doc.documentTypeId] || doc.documentTypeId || 'Unknown';
  };
  const statusCounts = workflowStatuses.reduce((map, status) => {
    map[status] = filteredDocs.filter((doc) => reportStatus(doc) === status).length;
    return map;
  }, {});
  const pendingTransmissions = filteredTransmissions.filter((item) => !item.receivedBy).length;
  const completedTransmissions = filteredTransmissions.length - pendingTransmissions;
  const incomingCount = filteredDocs.filter((doc) => doc.documentDirection === 'Incoming').length;
  const outgoingCount = filteredDocs.filter((doc) => doc.documentDirection === 'Outgoing').length;
  const summaryRows = [
    ['Documents', 'Total Documents', String(filteredDocs.length), `${incomingCount} incoming / ${outgoingCount} outgoing`],
    ['Documents', 'Received', String(statusCounts.Received || 0), percentText(statusCounts.Received || 0, filteredDocs.length)],
    ['Documents', 'For Signing', String(statusCounts['For Signing'] || 0), percentText(statusCounts['For Signing'] || 0, filteredDocs.length)],
    ['Documents', 'For Filing', String(statusCounts['For Filing'] || 0), percentText(statusCounts['For Filing'] || 0, filteredDocs.length)],
    ['Documents', 'Signed', String(statusCounts.Signed || 0), percentText(statusCounts.Signed || 0, filteredDocs.length)],
    ['Documents', 'Acknowledged', String(statusCounts.Acknowledged || 0), percentText(statusCounts.Acknowledged || 0, filteredDocs.length)],
    ['Routing', 'Total Transmissions', String(filteredTransmissions.length), `${pendingTransmissions} pending / ${completedTransmissions} completed`],
    ['Archives', 'Archived Records', String(filteredArchives.length), 'Visible archived records in coverage'],
  ];

  if (category === 'transmissions') {
    return {
      summaryRows,
      tableTitle: 'Transmission Report',
      headers: ['ID', 'Document', 'From', 'To', 'Sent By', 'Status'],
      rows: filteredTransmissions.map((transmission) => {
        const doc = docMap[transmission.documentId];
        return [
          transmission.id,
          doc ? `${doc.trackingNumber || doc.id} - ${doc.subject}` : transmission.documentId,
          officeName(transmission.fromOfficeId),
          officeName(transmission.toOfficeId),
          userName(transmission.sentBy),
          transmission.receivedBy
            ? `Completed (${formatReportDate(transmission.receivedAt || transmission.transmissionDate)})`
            : `Pending (${formatReportDate(transmission.transmissionDate)})`,
        ];
      }),
    };
  }

  if (category === 'offices') {
    const officeStats = offices.map((office) => {
      const sentFrom = filteredTransmissions.filter((item) => item.fromOfficeId === office.id).length;
      const receivedTo = filteredTransmissions.filter((item) => item.toOfficeId === office.id).length;
      return { office, sentFrom, receivedTo, total: sentFrom + receivedTo };
    }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    const totalOfficeMovement = officeStats.reduce((sum, item) => sum + item.total, 0);

    return {
      summaryRows,
      tableTitle: 'Office Movement Report',
      headers: ['Office', 'Sent From', 'Received To', 'Total', 'Share', 'Notes'],
      rows: officeStats.map((item) => [
        item.office.name,
        String(item.sentFrom),
        String(item.receivedTo),
        String(item.total),
        percentText(item.total, totalOfficeMovement),
        item.office.id,
      ]),
    };
  }

  if (category === 'activity') {
    return {
      summaryRows,
      tableTitle: 'Activity Log Report',
      headers: ['Date / Time', 'User', 'Role', 'Action', 'Reference', 'Details'],
      rows: filteredLogs.map((log) => {
        const user = userMap[log.userId];
        return [
          formatReportDate(log.timestamp, true),
          getFullName(user),
          user?.role || '',
          log.action,
          log.referenceId || '',
          log.details || '',
        ];
      }),
    };
  }

  if (category === 'summary') {
    return {
      recordCount: filteredDocs.length,
      summaryRows,
      tableTitle: '',
      headers: [],
      rows: [],
    };
  }

  return {
    summaryRows,
    tableTitle: 'Document Report Table',
    headers: ['Tracking #', 'Subject', 'Type', 'Status', 'Priority', 'Date'],
    rows: filteredDocs.map((doc) => [
      doc.trackingNumber,
      doc.subject,
      docTypeName(doc),
      reportStatus(doc),
      priorityLabels[doc.priorityLevel] || doc.priorityLevel || 'Normal',
      formatReportDate(doc.dateReceived),
    ]),
  };
};

router.use(protect);

router.get('/export', asyncHandler(async (req, res) => {
  const category = normalizeText(req.query.category || 'summary');
  const dateFrom = normalizeText(req.query.dateFrom || '');
  const dateTo = normalizeText(req.query.dateTo || '');
  const categoryLabel = reportCategories[category];
  const userOffice = req.user.officeId ? await Office.findOne({ id: req.user.officeId }).lean() : null;
  const generatedDate = new Date();
  const coverage = `${dateFrom || 'Start'} to ${dateTo || 'Present'}`;
  const reportData = await buildReportData(req, category, dateFrom, dateTo);
  const preparedBy = getFullName(req.user);
  const reportBuffer = buildOfficialReportDocx({
    templatePath: reportTemplatePath,
    title: 'DigiPath Official Report',
    categoryLabel,
    preparedBy,
    role: req.user.role,
    office: userOffice?.name || req.user.officeId || 'All visible offices',
    coverage,
    generatedAt: formatReportDate(generatedDate, true),
    generatedDate: formatReportDate(generatedDate),
    recordCount: reportData.recordCount ?? reportData.rows.length,
    reviewedBy: isApprovalRole(req) ? preparedBy : '',
    summaryRows: reportData.summaryRows,
    tableTitle: reportData.tableTitle,
    headers: reportData.headers,
    rows: reportData.rows,
  });
  const filename = sanitizeFileName(`digipath-${category}-${generatedDate.toISOString().slice(0, 10)}.docx`);

  const { createLogEntry } = require('../utils/helpers');
  await createLogEntry(req, 'report_exported', `Exported ${categoryLabel} report using official Word template`, category);
  res.setHeader('Content-Type', WORD_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', reportBuffer.length);
  res.send(reportBuffer);
}));

module.exports = router;
