const normalizeDate = (value) => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

export const filterByDateRange = (items = [], dateField, dateFrom = '', dateTo = '') => (
  items.filter((item) => {
    if (!dateFrom && !dateTo) return true;
    const date = normalizeDate(item?.[dateField]);
    if (!date) return false;
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    return true;
  })
);

const includesText = (value, term) => String(value || '').toLowerCase().includes(term);

const getUserName = (userId, users = []) => {
  const user = users.find((item) => item.id === userId);
  return user
    ? [user.fname, user.mname, user.lname].filter(Boolean).join(' ')
    : '';
};

const getActionLabel = (action = '') => String(action)
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

export const filterActivityLogs = (logs = [], filters = {}) => {
  const {
    search = '',
    action = '',
    userId = '',
    reference = '',
    dateFrom = '',
    dateTo = '',
    users = [],
    actionLabels = {},
  } = filters;
  const term = search.trim().toLowerCase();
  const referenceTerm = reference.trim().toLowerCase();

  return filterByDateRange(logs, 'timestamp', dateFrom, dateTo).filter((log) => {
    if (action && action !== 'All' && log.action !== action) return false;
    if (userId && log.userId !== userId) return false;
    if (referenceTerm && !includesText(log.referenceId, referenceTerm)) return false;
    if (!term) return true;

    return includesText(log.details, term)
      || includesText(log.referenceId, term)
      || includesText(getUserName(log.userId, users), term)
      || includesText(action, term)
      || includesText(actionLabels[log.action], term)
      || includesText(getActionLabel(log.action), term);
  });
};

export const filterDocuments = (documents = [], filters = {}) => {
  const {
    dateFrom = '',
    dateTo = '',
    status = '',
    typeId = '',
    priority = '',
    direction = '',
    officeId = '',
  } = filters;

  return filterByDateRange(documents, 'dateReceived', dateFrom, dateTo).filter((document) => {
    if (status && document.status !== status) return false;
    if (typeId && document.documentTypeId !== typeId) return false;
    if (priority && document.priorityLevel !== priority) return false;
    if (direction && document.documentDirection !== direction) return false;
    if (officeId) {
      const officeIds = [
        document.currentOfficeId,
        document.originOfficeId,
        document.destinationOfficeId,
        document.lastDetectedOfficeId,
      ];
      if (!officeIds.includes(officeId)) return false;
    }
    return true;
  });
};

export const filterTransmissions = (transmissions = [], filters = {}) => {
  const {
    dateFrom = '',
    dateTo = '',
    status = '',
    type = '',
    fromOfficeId = '',
    toOfficeId = '',
    sentBy = '',
    receivedBy = '',
  } = filters;

  return filterByDateRange(transmissions, 'transmissionDate', dateFrom, dateTo).filter((transmission) => {
    if (status === 'Pending' && transmission.receivedBy) return false;
    if (status === 'Completed' && !transmission.receivedBy) return false;
    if (type && transmission.transmissionType !== type) return false;
    if (fromOfficeId && transmission.fromOfficeId !== fromOfficeId) return false;
    if (toOfficeId && transmission.toOfficeId !== toOfficeId) return false;
    if (sentBy && transmission.sentBy !== sentBy) return false;
    if (receivedBy && transmission.receivedBy !== receivedBy) return false;
    return true;
  });
};

export const filterOfficeStats = (officeStats = [], officeId = '') => (
  officeId ? officeStats.filter((office) => office.id === officeId) : officeStats
);
