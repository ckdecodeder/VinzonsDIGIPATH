const { Sequelize } = require('sequelize');
const parsePagination = (query = {}) => {
  const parse = (value, fallback, max) => {
    if (value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) {
      const error = new Error('Invalid page or page size'); error.status = 400; throw error;
    }
    return number;
  };
  const page = parse(query.page, 1, 1000000);
  const limit = parse(query.limit, 50, 100);
  return { page, limit, offset: (page - 1) * limit };
};
const contains = (value) => ({ $iLike: `%${String(value).trim().replace(/[\\%_]/g, '\\$&')}%` });
const andFilters = (...filters) => ({ $and: filters.filter((filter) => Object.keys(filter).length) });
const documentSummaryAttributes = {
  exclude: ['scannedImageUrl', 'scannedFiles', 'scannedText', 'timeline'],
  include: [
    [Sequelize.literal('CASE WHEN jsonb_typeof("scannedFiles") = \'array\' AND jsonb_array_length("scannedFiles") > 0 THEN jsonb_array_length("scannedFiles") WHEN COALESCE("scannedImageUrl", \'\') <> \'\' THEN 1 ELSE 0 END'), 'attachmentCount'],
  ],
};
module.exports = { parsePagination, contains, andFilters, documentSummaryAttributes };
