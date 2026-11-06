// Display limits never remove evidence from the save or its portable archives.
export const REPORT_RECORDS = 100;
export const REPORT_BYTES = 256 * 1024;
export const DISPLAY_CHARACTERS = 512;
export const displayText = value => boundedOutput(String(value ?? ''));
// Mapping uses exact IDs: reject unusable keys rather than truncating identity.
export function rosterOutput(members) {
  if (members.length > 32) throw Object.assign(new TypeError('A backup roster must contain at most 32 players.'), { status: 422 });
  return boundedOutput(members.map(({ id, name }) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 80 || /[\u0000-\u001f\u007f]/u.test(id))
      throw Object.assign(new TypeError('Player identifiers must contain 1–80 characters without control characters.'), { status: 422 });
    return { id, name: displayText(name) };
  }));
}
export function warningOutput(warnings, total) {
  const shown = [...new Set(warnings.slice(0, REPORT_RECORDS).map(displayText))];
  const count = total ?? warnings.length;
  if (count > REPORT_RECORDS) {
    shown.length = Math.min(shown.length, REPORT_RECORDS - 1);
    shown.push(`and ${count - shown.length} more warnings; complete evidence is retained in the backup`);
  }
  return boundedOutput(shown);
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
    if (--nodes < 0 || depth > 12) { remaining -= 4; return null; }
    if (typeof item === 'string') {
      // Six bytes per UTF-16 unit covers JSON escaping, including lone
      // surrogates. Never stringify/encode the original untrusted string.
      const text = item.slice(0, Math.min(DISPLAY_CHARACTERS, Math.max(0, Math.floor((remaining - 2) / 6))));
      remaining -= text.length * 6 + 2;
      return text;
    }
    if (!item || typeof item !== 'object') { remaining -= 24; return item; }
    const output = Array.isArray(item) ? [] : {};
    remaining -= 2;
    let count = 0;
    // Do not allocate Object.entries for an unbounded array/object. Enumerate
    // only the prefix that fits the shared node, item and wire-byte budget.
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (remaining < 64 || nodes < 2 || count++ >= REPORT_RECORDS) break;
      if (Array.isArray(output)) { remaining--; output.push(visit(item[key], depth + 1)); }
      else {
        const safeKey = key.slice(0, Math.min(128, Math.floor((remaining - 32) / 12)));
        remaining -= safeKey.length * 6 + 4;
        Object.defineProperty(output, safeKey, { value: visit(item[key], depth + 1), enumerable: true, configurable: true, writable: true });
      }
    }
    return output;
  }
  return visit(value);
}

const boundedMetadata = new WeakSet();
function reportOutput(value, bytes) {
  const output = { ...boundedOutput(value, { bytes }), counts: boundedOutput(value.counts) };
  if (Number.isSafeInteger(output.counts?.preservedForReview) && Array.isArray(value.records)) {
    output.records ??= [];
    output.counts.omitted = output.counts.preservedForReview - output.records.length;
    if (output.counts.omitted) output.more = `and ${output.counts.omitted} more; complete records are retained in the backup`;
  }
  return output;
}
export function importMetadataOutput(value) {
  const { warnings, transferReport, ...rest } = value;
  const output = { ...boundedOutput(rest, { bytes: REPORT_BYTES / 16 }),
    warnings: boundedOutput(warnings ?? [], { bytes: REPORT_BYTES / 8 }) };
  if (transferReport) output.transferReport = reportOutput(transferReport, REPORT_BYTES * 3 / 4);
  boundedMetadata.add(output);
  return output;
}

// Reserve the review's schema, complete rosters and exact counts independently
// of samples. A final wire-size check shrinks only optional data, so early notes
// cannot consume the budget of later members, rules or warnings.
export function importResponseOutput(value) {
  for (let sampleBytes = REPORT_BYTES; ; sampleBytes = Math.floor(sampleBytes / 2)) {
    const sample = item => boundedOutput(item, { bytes: sampleBytes });
    const identity = member => ({ id: String(member.id ?? '').slice(0, 80),
      name: displayText(member.name).slice(0, sampleBytes ? DISPLAY_CHARACTERS : 32) });
    const difference = change => {
      const output = sample(change);
      for (const key of ['added', 'removed', 'changed']) if (Array.isArray(change[key])) {
        output[key] ??= [];
        output[`${key}Count`] = change[`${key}Count`] ?? change[key].length;
      }
      return output;
    };
    const output = sample(value);
    for (const field of ['format', 'schemaVersion', 'mappingRequired']) if (value[field] !== undefined) output[field] = boundedOutput(value[field]);
    for (const field of ['sourceRoster', 'destinationRoster']) if (Array.isArray(value[field]))
      output[field] = value[field].map(identity);
    if (value.preview) {
      const preview = value.preview;
      output.preview = { ...sample(preview), currentRevision: preview.currentRevision, incomingRevision: preview.incomingRevision,
        members: (preview.members ?? []).map(member => {
          const row = { ...sample(member), ...identity(member), status: displayText(member.status) };
          for (const [field, change] of Object.entries(member)) if (change && typeof change === 'object'
            && ['added', 'removed', 'changed'].some(key => Array.isArray(change[key]))) row[field] = difference(change);
          return row;
        }),
        rules: difference(preview.rules ?? { changed: [] }), warnings: sample(preview.warnings ?? []),
        taskCounts: boundedOutput(preview.taskCounts ?? Object.fromEntries(['added', 'removed', 'changed'].map(key => [key, preview.tasks?.[key]?.length ?? 0]))),
      };
    }
    if (value.state) output.state = { ...sample(value.state), schemaVersion: value.state.schemaVersion, revision: value.state.revision,
      members: (value.state.members ?? []).map(member => ({ ...sample(member), ...identity(member), counts: boundedOutput(member.counts ?? {}) })) };
    if (value.warnings) output.warnings = sample(value.warnings);
    if (value.transferReport) output.transferReport = reportOutput(value.transferReport, sampleBytes);
    if (Buffer.byteLength(JSON.stringify(output)) < REPORT_BYTES) return output;
    if (!sampleBytes) throw new TypeError('The mandatory import review exceeds its display budget.');
  }
}

// One mandatory worker egress for display data. Exact state/publication bytes
// use the yielding transfer protocol instead: truncating those would lose saves.
// Keeping this at send(), after every branch has built its result, also bounds
// future preview fields and early mapping/error replies.
export const IMPORT_DISPLAY_PATHS = Object.freeze([
  ['error'], ['result', 'response'], ['result', 'publication', 'summary'], ['result', 'publication', 'reply', 'metadata'],
].map(Object.freeze));
export function boundedImportMessage(message) {
  for (const path of IMPORT_DISPLAY_PATHS) {
    let owner = message;
    for (const key of path.slice(0, -1)) owner = owner?.[key];
    const key = path.at(-1);
    if (owner?.[key]) owner[key] = key === 'response' ? importResponseOutput(owner[key])
      : key === 'metadata' ? boundedMetadata.has(owner[key]) ? owner[key] : importMetadataOutput(owner[key])
      : boundedOutput(owner[key]);
  }
  return message;
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
