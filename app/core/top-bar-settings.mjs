// Which top bar buttons a player keeps in view. Hidden buttons move into More,
// so More itself is locked: it holds Settings and every hidden action.
export const TOP_BAR_PREFERENCE = 'topBarHidden';

export const topBarButtons = Object.freeze([
  { id: 'helper', label: 'Helper' },
  { id: 'search', label: 'Search' },
  { id: 'info', label: 'Info' },
  { id: 'sync', label: 'Sync levels' },
  { id: 'more', label: 'More', locked: true, reason: 'It holds Settings and any hidden buttons.' },
].map(row => Object.freeze(row)));

const hideable = topBarButtons.filter(row => !row.locked).map(row => row.id);
const locked = new Map(topBarButtons.filter(row => row.locked).map(row => [row.id, row]));

export const topBarSettingDefinitions = Object.freeze([Object.freeze({
  id: TOP_BAR_PREFERENCE, type: 'list', default: Object.freeze([]), options: Object.freeze(hideable),
  label: 'Top bar buttons', description: 'Choose which buttons stay in the top bar. Hidden buttons move into More.', section: 'Display',
})]);

/** A saved list names each hideable button at most once; locked buttons are refused. */
export function validateTopBarSetting(id, value) {
  if (id !== TOP_BAR_PREFERENCE) throw new TypeError(`Unknown top bar setting: ${id}`);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Top bar buttons must be a list of hidden buttons.');
  const seen = new Set();
  for (let index = 0; index < value.length; index++) {
    const button = value[index];
    if (!Object.hasOwn(value, index)) throw new TypeError('Top bar buttons must be a list of hidden buttons.');
    if (locked.has(button)) throw new TypeError(`${locked.get(button).label} can't be hidden. ${locked.get(button).reason}`);
    if (!hideable.includes(button)) throw new TypeError(`Top bar buttons can only hide: ${hideable.map(item => topBarButtons.find(row => row.id === item).label).join(', ')}.`);
    if (seen.has(button)) throw new TypeError('Top bar buttons must name each button once.');
    seen.add(button);
  }
  return value;
}

/** Hidden buttons for display, in top bar order. Missing or unreadable values mean none. */
export function hiddenTopBarButtons(preferences) {
  const value = preferences?.[TOP_BAR_PREFERENCE];
  return Array.isArray(value) ? hideable.filter(id => value.includes(id)) : [];
}
