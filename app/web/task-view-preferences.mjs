export const TASK_VIEW_STORAGE_KEY = 'rs3:task-view';
const normalize = value => ({ showBlocked: value?.showBlocked === true, showAll: value?.showAll === true, groupView: value?.groupView !== false });

export function readTaskViewPreferences(storage) {
  try { return normalize(JSON.parse(storage?.getItem(TASK_VIEW_STORAGE_KEY) ?? 'null')); }
  catch { return normalize(); }
}

export function writeTaskViewPreferences(storage, value) {
  try { if (!storage) return false; storage.setItem(TASK_VIEW_STORAGE_KEY, JSON.stringify(normalize(value))); return true; }
  catch { return false; }
}

// Initialise explicitly so browser form restoration cannot choose task filters.
// Hide completed remains owned by the saved hideChecked preference.
export function bindTaskViewPreferences(get, getStorage = () => globalThis.localStorage) {
  let storage;
  try { storage = getStorage(); } catch { /* Storage may be denied. */ }
  const saved = readTaskViewPreferences(storage);
  get('show-blocked').checked = saved.showBlocked;
  get('show-all').checked = saved.showAll;
  if (get('group-view')) get('group-view').checked = saved.groupView;
  for (const id of ['show-blocked', 'show-all', 'group-view']) get(id)?.addEventListener('change', () => {
    writeTaskViewPreferences(storage, { showBlocked: get('show-blocked').checked, showAll: get('show-all').checked, groupView: get('group-view')?.checked !== false });
  });
}
