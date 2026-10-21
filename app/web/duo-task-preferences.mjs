export const DUO_TASK_FILTER_STORAGE_KEY = 'rs3:group-task-filter:v1';
export const normalizeDuoPersonalFilter = value => ['not-done', 'only-player'].includes(value) ? value : 'group';
const storageKey = viewerId => `${DUO_TASK_FILTER_STORAGE_KEY}:${encodeURIComponent(viewerId ?? 'viewer')}`;

// Each browser viewer remembers display choices independently of the shared save.
export function readDuoPersonalFilter(storage, viewerId) {
  try { return normalizeDuoPersonalFilter(JSON.parse(storage?.getItem(storageKey(viewerId)) ?? 'null')); }
  catch { return 'group'; }
}

export function writeDuoPersonalFilter(storage, value, viewerId) {
  try { if (!storage) return false; storage.setItem(storageKey(viewerId), JSON.stringify(normalizeDuoPersonalFilter(value))); return true; }
  catch { return false; }
}
