const test = require('node:test');
const assert = require('node:assert/strict');
const { manilaDate, dateRangeError, municipalTimestampRange } = require('../utils/municipalDate');

test('log query boundaries include exactly the municipal day, including historical calendar-only logs', () => {
  const start = '2026-11-21T16:00:00.000Z';
  const end = '2026-11-22T16:00:00.000Z';
  const range = municipalTimestampRange('2026-11-22', '2026-11-22');
  assert.deepEqual(range, { $gte: start, $lt: end });
  for (const timestamp of ['2026-11-21T15:59:59.999Z', start, '2026-11-21T16:30:00.000Z',
    '2026-11-22T00:00:00.000Z', '2026-11-21', '2026-11-22', end]) {
    assert.equal(timestamp >= range.$gte && timestamp < range.$lt, manilaDate(timestamp) === '2026-11-22', timestamp);
  }
  assert.deepEqual(municipalTimestampRange('', '2026-11-22'), { $lt: end });
  assert.deepEqual(municipalTimestampRange('2026-11-22', ''), { $gte: start });
});

test('single-day and open coverage are valid, reversed or invalid calendar days are rejected', () => {
  assert.equal(dateRangeError('2026-11-22', '2026-11-22'), '');
  assert.equal(dateRangeError('', '2026-11-22'), '');
  assert.match(dateRangeError('2026-11-22', '2026-11-21'), /end date on or after/);
  assert.match(dateRangeError('2026-02-30', ''), /valid calendar/);
});
