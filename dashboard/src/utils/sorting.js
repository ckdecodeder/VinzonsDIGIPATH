const dateValue = (value) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const newestTime = (item, fields) => {
  for (const field of fields) {
    const value = dateValue(item?.[field]);
    if (value) return value;
  }
  return 0;
};

const sortableId = (item) => {
  const raw = item?._id?.$oid || item?._id || item?.id || item?.trackingNumber || '';
  return String(raw);
};

export const compareNewest = (a, b, fields = ['createdAt', 'updatedAt', 'dateReceived']) => {
  const diff = newestTime(b, fields) - newestTime(a, fields);
  if (diff !== 0) return diff;
  return sortableId(b).localeCompare(sortableId(a), undefined, { numeric: true });
};

export const compareOldest = (a, b, fields = ['createdAt', 'updatedAt', 'dateReceived']) => {
  const diff = newestTime(a, fields) - newestTime(b, fields);
  if (diff !== 0) return diff;
  return sortableId(a).localeCompare(sortableId(b), undefined, { numeric: true });
};

export const sortNewest = (items = [], fields) => [...items].sort((a, b) => compareNewest(a, b, fields));
