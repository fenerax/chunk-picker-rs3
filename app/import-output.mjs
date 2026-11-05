// Display limits never remove evidence from the save or its portable archives.
export const REPORT_RECORDS = 100;
export const REPORT_BYTES = 256 * 1024;
export const displayText = value => String(value ?? '').slice(0, 512);
export function warningOutput(warnings, total) {
  const unique = [...new Set(warnings.map(displayText))];
  const count = total ?? unique.length;
  if (count <= REPORT_RECORDS) return unique;
  const shown = unique.slice(0, REPORT_RECORDS - 1);
  return [...shown, `and ${count - shown.length} more warnings; complete evidence is retained in the backup`];
}
export function displayList(values, label = value => value) {
  return values.slice(0, REPORT_RECORDS).map(value => displayText(label(value))).join(', ')
    + (values.length > REPORT_RECORDS ? `, and ${values.length - REPORT_RECORDS} more` : '');
}
export function trimTaskStars(value) {
  let end = value.length;
  while (end && value[end - 1] === '*') end--;
  return value.slice(0, end);
}
export function replaceDelimited(text, open, close, replacement = () => '') {
  const parts = [];
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(open, cursor);
    if (start < 0) break;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) break;
    parts.push(text.slice(cursor, start), replacement(text.slice(start + open.length, end)));
    cursor = end + close.length;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
export function boundedOutput(value, { bytes = REPORT_BYTES } = {}) {
  let remaining = bytes, nodes = 4096;
  function visit(item, depth = 0) {
    if (--nodes < 0 || remaining < 16 || depth > 12) return '[more retained in backup]';
    if (typeof item === 'string') {
      const text = item.slice(0, Math.min(512, Math.floor(remaining / 6)));
      remaining -= text.length * 6 + 2;
      return text.length < item.length ? `${text}…` : text;
    }
    if (!item || typeof item !== 'object') { remaining -= 24; return item; }
    const output = Array.isArray(item) ? [] : {};
    let count = 0;
    for (const [key, child] of Object.entries(item)) {
      if (remaining < 64 || nodes < 2 || count++ >= REPORT_RECORDS) break;
      const safeKey = key.slice(0, Math.min(128, Math.floor(remaining / 12)));
      remaining -= safeKey.length * 6 + 8;
      Object.defineProperty(output, safeKey, { value: visit(child, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    return output;
  }
  return visit(value);
}

// Legacy diagnostic messages are a fixed sentence format. Delimiter searches
// scan once, including missing delimiters; no unanchored wildcard backtracking.
export function readableMigrationWarning(value, { tasks = new Map(), members = new Map(), maps = new Map() } = {}) {
  let warning = String(value);
  if (warning.startsWith('Could not migrate ')) {
    const sourceEnd = warning.indexOf(' ', 18), memberStart = warning.indexOf(' for member ', sourceEnd + 1);
    const reasonStart = memberStart < 0 ? -1 : warning.indexOf(': ', memberStart + 12);
    if (sourceEnd >= 0 && memberStart >= 0 && reasonStart >= 0 && warning.endsWith('.')) {
      const source = warning.slice(18, sourceEnd), member = warning.slice(memberStart + 12, reasonStart);
      const reason = warning.slice(reasonStart + 2, -1);
      const sources = { checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' };
      const reasons = { 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' };
      warning = `Could not import ${displayText(sources[source] ?? source)} ${displayText(warning.slice(sourceEnd + 1, memberStart))} for ${displayText(members.get(member)?.name ?? members.get(member) ?? member)}: ${displayText(reasons[reason] ?? reason)}.`;
    }
  } else if (warning.startsWith('Unresolved saved task ID ')) {
    const at = warning.indexOf(' at ', 24), suffix = '; the original record is preserved for review.';
    if (at >= 0 && warning.endsWith(suffix)) {
      const id = warning.slice(24, at);
      warning = `Saved task ${displayText(tasks.get(id)?.label ?? tasks.get(id) ?? id)} at ${displayText(warning.slice(at + 4, -suffix.length))} could not be matched; the original record is kept for review.`;
    }
  }
  return displayText(warning)
    .replace(/^Map ([^ ]+) has /, (_, id) => `${displayText(maps.get(id)?.name ?? maps.get(id) ?? id)}’s original map has `)
    .replace(/^Member ([^ ]+) references missing legacy map ([^.]+)\.$/, (_, id, mapId) => `${displayText(members.get(id)?.name ?? members.get(id) ?? id)}’s original map ${displayText(mapId)} is missing from this save.`);
}
