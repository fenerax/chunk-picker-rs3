export const completedRangeOptions = Object.freeze([
  Object.freeze({ value: 'all', label: 'All time' }),
  Object.freeze({ value: 'today', label: 'Today' }),
  Object.freeze({ value: '7', label: 'Last 7 days' }),
  Object.freeze({ value: '30', label: 'Last 30 days' }),
  Object.freeze({ value: 'custom', label: 'Custom' }),
]);

const validRanges = new Set(completedRangeOptions.map(option => option.value));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCompletedRange(value) {
  return validRanges.has(value) ? value : 'all';
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function timestampDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDateKey(date) : null;
}

export function selectCompletedRange(rows, { range = 'all', from = '', to = '', now = new Date() } = {}) {
  const selectedRange = normalizeCompletedRange(range);
  const unknownDates = rows.reduce((count, row) => count + (timestampDate(row.latestAt) === null ? 1 : 0), 0);
  if (selectedRange === 'all') return { rows: [...rows], label: 'All time', error: null, unknownDates };

  const today = localDateKey(now instanceof Date ? now : new Date(now));
  let start, end, label;
  if (selectedRange === 'today') {
    start = end = today;
    label = 'today';
  } else if (selectedRange === '7' || selectedRange === '30') {
    const startDate = new Date(now instanceof Date ? now.getTime() : new Date(now).getTime());
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (Number(selectedRange) - 1));
    start = localDateKey(startDate);
    end = today;
    label = `last ${selectedRange} days`;
  } else {
    const hasFrom = from !== '', hasTo = to !== '';
    if (!hasFrom && !hasTo) return { rows: [], label: 'custom range', error: 'Choose a From or To date.', unknownDates };
    if (hasFrom && hasTo && validDate(from) && validDate(to) && from > to) {
      return { rows: [], label: 'custom range', error: 'From must be on or before To.', unknownDates };
    }
    if (hasFrom && !validDate(from) || hasTo && !validDate(to)) {
      return { rows: [], label: 'custom range', error: 'Choose a valid From and To date.', unknownDates };
    }
    start = hasFrom ? from : null;
    end = hasTo ? to : null;
    label = hasFrom && hasTo ? `${from} to ${to}` : hasFrom ? `from ${from}` : `through ${to}`;
  }
  return {
    rows: rows.filter(row => {
      const date = timestampDate(row.latestAt);
      return date !== null && (start === null || date >= start) && (end === null || date <= end);
    }),
    label,
    error: null,
    unknownDates,
  };
}
