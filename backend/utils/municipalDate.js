const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const manilaCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

function validDate(value) {
  return typeof value === 'string' && dateOnly.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function manilaDate(value = new Date()) {
  if (!value) return '';
  if (dateOnly.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : manilaCalendar.format(date);
}

function dateRangeError(from, to) {
  if ((from && !validDate(from)) || (to && !validDate(to))) return 'Enter a valid calendar date (YYYY-MM-DD).';
  return from && to && from > to ? 'Choose an end date on or after the start date.' : '';
}

// Stored instants are UTC ISO strings. Calendar-only legacy entries sort within their municipal day.
function municipalTimestampRange(from, to) {
  const range = {};
  if (from) range.$gte = new Date(from + 'T00:00:00+08:00').toISOString();
  if (to) range.$lt = new Date(Date.parse(to + 'T00:00:00+08:00') + 86400000).toISOString();
  return range;
}

module.exports = { manilaDate, validDate, dateRangeError, municipalTimestampRange };
