export const PROGRESS_METRICS = Object.freeze(['unlockedChunks', 'completedTasks', 'questPoints', 'totalLevel', 'combatLevel']);
export const MAX_PROGRESS_DAYS = 3660;
const DAY = 86_400_000;
const sum = values => {
  if (values.some(value => value === null)) return null;
  const total = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(total) ? total : null;
};

export function validateProgressCompletionBaseline(value) {
  const fail = () => { throw new TypeError('Progress completion baseline must contain matching member IDs and personal completion lists'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['memberIds', 'completedTasks'].includes(key))
    || !Array.isArray(value.memberIds) || !value.memberIds.length || value.memberIds.length > 16
    || value.memberIds.some(id => typeof id !== 'string' || !id.trim())
    || new Set(value.memberIds).size !== value.memberIds.length
    || !Array.isArray(value.completedTasks) || value.completedTasks.length !== value.memberIds.length) fail();
  for (const tasks of value.completedTasks) {
    if (!Array.isArray(tasks) || tasks.some(id => typeof id !== 'string' || !id.trim()) || new Set(tasks).size !== tasks.length) fail();
  }
}

/** Account QP observations live outside the legacy estimate tuples. Provenance
 * is extensible in older releases, so rollback can still read those tuples. */
export function validateProgressQuestPoints(value) {
  const fail = message => { throw new TypeError(`Progress snapshots quest points ${message}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || Object.keys(value).some(key => !['schemaVersion', 'memberIds', 'days'].includes(key))) fail('have an unsupported schema');
  if (!Array.isArray(value.memberIds) || !value.memberIds.length || value.memberIds.length > 16
    || value.memberIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)
    || new Set(value.memberIds).size !== value.memberIds.length) fail('need unique member IDs');
  if (!Array.isArray(value.days) || value.days.length > MAX_PROGRESS_DAYS) fail('exceed the daily limit');
  const count = value => value === null || Number.isSafeInteger(value) && value >= 0;
  let previous = -1;
  for (const row of value.days) {
    if (!Array.isArray(row) || row.length !== 4) fail('contain an invalid day tuple');
    const [day, at, members, duo] = row;
    if (!Number.isSafeInteger(day) || day <= previous || !Number.isSafeInteger(at) || at < 0
      || at > 253402300799999 || Math.floor(at / DAY) !== day) fail('need ordered unique valid UTC dates');
    previous = day;
    if (!Array.isArray(members) || members.length !== value.memberIds.length || !members.every(count)
      || !count(duo) || duo !== sum(members)) fail('have inconsistent account counts');
  }
  return value;
}

/** Validate tiny portable daily count tuples independently of calculators. */
export function validateProgressSnapshots(value) {
  const fail = message => { throw new TypeError(`Progress snapshots ${message}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
  if (Object.keys(value).some(key => !['schemaVersion', 'memberIds', 'days', 'truncated'].includes(key)) || value.schemaVersion !== 1) fail('have an unsupported schema');
  if (!Array.isArray(value.memberIds) || !value.memberIds.length || value.memberIds.length > 16
    || value.memberIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)
    || new Set(value.memberIds).size !== value.memberIds.length) fail('need 1 through 16 unique member IDs');
  if (typeof value.truncated !== 'boolean' || !Array.isArray(value.days) || value.days.length > MAX_PROGRESS_DAYS) fail('exceed the daily limit or have invalid metadata');
  const check = (row, combined = false) => {
    if (!Array.isArray(row) || row.length !== PROGRESS_METRICS.length) fail('need five numeric counts');
    row.forEach((number, index) => {
      const maximum = index === 2 ? Number.MAX_SAFE_INTEGER : index === 3 ? 3480 : index === 4 ? 200 : 1_000_000;
      if (number === null && index >= 2) return;
      if (!Number.isSafeInteger(number) || number < 0 || number > maximum * (combined ? value.memberIds.length : 1)) fail('contain an invalid count');
    });
  };
  let previous = -1;
  for (const row of value.days) {
    if (!Array.isArray(row) || (row.length !== 4 && row.length !== 5)
      || (row.length === 5 && row[4] !== 1)) fail('contain an invalid day tuple');
    const [day, at, members, duo] = row;
    if (!Number.isSafeInteger(day) || day < 0 || day <= previous || !Number.isSafeInteger(at) || at < 0
      || at > 253402300799999 || Math.floor(at / DAY) !== day) fail('need ordered unique valid UTC dates');
    previous = day;
    if (!Array.isArray(members) || members.length !== value.memberIds.length) fail('have a mismatched member count');
    members.forEach(row => check(row)); check(duo, true);
    for (const index of [2, 3, 4]) if (duo[index] !== sum(members.map(member => member[index]))) fail('have inconsistent combined account counts');
    for (const index of [0, 1]) if (duo[index] < Math.max(...members.map(member => member[index])) || duo[index] > sum(members.map(member => member[index]))) fail('have inconsistent unique duo counts');
  }
  return value;
}
