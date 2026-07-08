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

export function formatPhilippinesDateTime(date = new Date()) {
  return new Date(date).toLocaleString('en-PH', PHILIPPINES_TIME_OPTIONS);
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
