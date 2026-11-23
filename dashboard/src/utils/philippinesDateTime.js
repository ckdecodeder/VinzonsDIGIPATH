const PHILIPPINES_TIME_OPTIONS = {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
};

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const manilaCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function manilaDate(value = new Date()) {
  if (!value) return '';
  if (typeof value === 'string' && dateOnly.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : manilaCalendar.format(date);
}

export function formatPhilippinesDateParts(value) {
  if (!value) return { date: 'Not recorded', time: '' };
  if (dateOnly.test(value)) return { date: value, time: '' };
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: String(value), time: '' };
  return {
    date: manilaDate(instant),
    time: instant.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }),
  };
}

export function formatPhilippinesDateTime(value = new Date()) {
  if (!value) return 'Not recorded';
  if (dateOnly.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-PH', PHILIPPINES_TIME_OPTIONS);
}

export function manilaPartsToEpoch({
  year,
  month,
  day,
  hour,
  minute,
  seconds,
  milliSeconds = 0,
}) {
  return Date.UTC(year, month - 1, day, hour - 8, minute, seconds, milliSeconds);
}
