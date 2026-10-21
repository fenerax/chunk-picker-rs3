export const ACTIVITY_FILTERS_STORAGE_KEY = 'rs3:activity-info-filters:v1';

const activityChoices = [['done', 'Done'], ['doable', 'Doable'], ['blocked', 'Blocked']];
const questChoices = [['not-started', 'Not started'], ['in-progress', 'In progress'], ['done', 'Done'], ['can-do-now', 'Can do now']];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const choices = (value, allowed) => Array.isArray(value) ? [...new Set(value.filter(item => allowed.some(([key]) => item === key)))] : [];
const normalizeTab = value => ({
  statuses: choices(value?.statuses, activityChoices),
  questStatuses: choices(value?.questStatuses, questChoices),
  sort: value?.sort === 'level' ? 'level' : 'default',
});

/** One browser preference record, with independent choices for each display tab. */
export function normalizeActivityFilters(value) {
  return Object.fromEntries(record(value) ? Object.entries(value).filter(([, tab]) => record(tab)).map(([key, tab]) => [key, normalizeTab(tab)]) : []);
}

export function readActivityFilters(storage) {
  try { return normalizeActivityFilters(JSON.parse((storage ?? globalThis.localStorage)?.getItem(ACTIVITY_FILTERS_STORAGE_KEY) ?? 'null')); }
  catch { return {}; }
}

export function writeActivityFilters(storage, value) {
  try {
    storage ??= globalThis.localStorage;
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(ACTIVITY_FILTERS_STORAGE_KEY, JSON.stringify(normalizeActivityFilters(value)));
    return true;
  } catch { return false; }
}

/** Classifies existing calculation output; never calculates gameplay readiness. */
export function activityStatus(row) {
  if (Array.isArray(row?.tasks)) {
    if (row.wholeCompletion?.some(task => task.personalCompleted || task.challengeSatisfied)) return 'done';
    return row.tasks.some(task => activityStatus(task) === 'doable') ? 'doable' : 'blocked';
  }
  if (row?.personalCompleted || row?.challengeSatisfied) return 'done';
  return row?.status === 'available' && !row.blockers?.length ? 'doable' : 'blocked';
}

/** Progress choices are OR; Can do now further limits the selected progress. */
export function selectActivityRows(rows, preferences) {
  const filters = normalizeTab(preferences), progress = filters.questStatuses.filter(key => key !== 'can-do-now');
  const selected = (Array.isArray(rows) ? rows : []).filter(row =>
    (!filters.statuses.length || filters.statuses.includes(activityStatus(row)))
    && (!progress.length || progress.includes(row.questStatus))
    && (!filters.questStatuses.includes('can-do-now') || row.canDoNow === true));
  if (filters.sort === 'level') {
    const level = row => typeof row.level === 'number' && Number.isFinite(row.level) && row.level > 0 ? row.level : Infinity;
    selected.sort((a, b) => level(a) - level(b));
  }
  return selected;
}

/** Display controls only: no saved gameplay commands or calculation requests. */
export function createActivityFilterControls({ el, button, storage }, { tab, quests = false, activity = true, onChange = () => {} }) {
  let filters = normalizeTab(readActivityFilters(storage)[tab]);
  const root = el('div', undefined, 'activity-filter-controls'), groups = [];
  const refresh = () => {
    for (const { key, chips } of groups) for (const [value, chip] of chips) {
      chip.setAttribute('aria-pressed', String(value === 'all' ? !filters[key].length : filters[key].includes(value)));
    }
  };
  const save = () => {
    // Read at save time so another open tab's controls keep their own choices.
    writeActivityFilters(storage, { ...readActivityFilters(storage), [tab]: filters });
    refresh(); onChange();
  };
  const addGroup = (key, label, options) => {
    const group = el('div', undefined, 'activity-filter-group'), chips = new Map();
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    group.append(el('span', label, 'activity-filter-label'));
    for (const [value, text] of [['all', 'All'], ...options]) {
      const chip = button(text, () => {
        filters = { ...filters, [key]: value === 'all' ? [] : filters[key].includes(value) ? filters[key].filter(item => item !== value) : [...filters[key], value] };
        save();
      }, 'filter-chip');
      chip.type = 'button'; chips.set(value, chip); group.append(chip);
    }
    groups.push({ key, chips }); root.append(group);
  };
  if (activity) addGroup('statuses', 'Activity status', activityChoices);
  if (quests) addGroup('questStatuses', 'Quest progress', questChoices);
  const label = el('label', undefined, 'form-field activity-filter-sort'), sort = el('select');
  sort.setAttribute('aria-label', 'Sort activities');
  for (const [value, text] of [['default', 'Default order'], ['level', 'Level (low first)']]) {
    const option = el('option', text); option.value = value; sort.append(option);
  }
  sort.value = filters.sort;
  sort.addEventListener('change', () => { filters = { ...filters, sort: sort.value === 'level' ? 'level' : 'default' }; save(); });
  label.append(el('span', 'Sort', 'activity-filter-label'), sort); root.append(label); refresh();
  if (quests) root.append(el('p', `${activity ? 'Doable: possible in your unlocked chunks, counting levels you could train. ' : ''}Can do now: your saved levels and quest progress already allow it.`, 'activity-filter-help'));
  else if (activity) root.append(el('p', 'Doable: possible in your unlocked chunks, counting levels you could train.', 'activity-filter-help'));
  return { element: root, preferences: () => filters };
}
