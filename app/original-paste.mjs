// Independent interchange adapter. No upstream service access or executable input.
import { parseRequestJSON } from './security/json.mjs';
import { decodeLegacyText } from './tasks/gameplay-compat.mjs';
import { buildIdentityIndex, legacyTaskId } from './tasks/identity.mjs';
import { createGroupState } from './core/state.mjs';
import { boundedOutput, REPORT_RECORDS, DISPLAY_CHARACTERS } from './import-output.mjs';
import { originalRuleDefaults, taskRuleDefinitions, taskRuleBehavior, taskRuleValueError } from './data/settings.mjs';

export const ORIGINAL_PASTE_FORMAT = 'rs3-original-paste';
export const MAX_ORIGINAL_PASTE_BYTES = 8 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const decodeKey = key => String(decodeLegacyText(key)).replace(/^\*fb\*_/, '');
const fields = ['chunksText', 'rulesText', 'gameplayText'];

export function readOriginalPaste(document) {
  if (!record(document) || document.format !== ORIGINAL_PASTE_FORMAT
    || Object.keys(document).some(key => !['format', ...fields, 'includeRules', 'includeTasks'].includes(key))) fail('Choose the documented original-picker paste format.');
  const texts = {};
  let bytes = 0;
  for (const field of fields) {
    const value = document[field] ?? '';
    if (typeof value !== 'string' && (!Array.isArray(value) || value.length > 1024 || value.some(part => typeof part !== 'string'))) fail('Paste fields must contain text.');
    for (const part of typeof value === 'string' ? [value] : value) bytes += Buffer.byteLength(part);
    if (bytes > MAX_ORIGINAL_PASTE_BYTES) throw Object.assign(new Error('The total paste limit is 8 MiB of UTF-8 text.'), { status: 413 });
    texts[field] = typeof value === 'string' ? value : value.join('');
  }
  for (const field of ['includeRules', 'includeTasks']) if (document[field] !== undefined && typeof document[field] !== 'boolean') fail('Choose whether to import rules and task checks.');
  if (!texts.rulesText.trim()) fail('Paste the original rules JSON (use {} for no rules).');
  const rules = parseRequestJSON(texts.rulesText), gameplay = texts.gameplayText.trim() ? parseRequestJSON(texts.gameplayText) : {};
  if (!record(rules) || !record(gameplay)) fail('Rules and optional gameplay must be JSON objects.');
  for (const field of ['chunks', 'chunkinfo']) if (gameplay[field] !== undefined && !record(gameplay[field])) fail('Gameplay chunks and chunkinfo must be keyed objects.');
  // This route collects gameplay only. Reject credentials even in nested unknown
  // fields instead of storing them in provenance or reflecting their values.
  const pending = [rules, gameplay];
  while (pending.length) for (const [key, value] of Object.entries(pending.pop())) {
    if (/^(?:password(?:hash)?|credentials?|secret|client[_-]?secret|(?:access|refresh|id|auth)[_-]?token|token|authorization|api[_-]?key|accounts?|sessions?)$/i.test(decodeKey(key))) fail('Remove credentials and account/session data; paste gameplay only.');
    if (value && typeof value === 'object') pending.push(value);
  }
  return { texts, rules, gameplay, bytes, includeRules: document.includeRules === true, includeTasks: document.includeTasks === true };
}

export function originalChunkList(text) {
  let source = text.trim();
  const url = /^(?:https:\/\/)?gitgeddes\.github\.io\/ChunkPicker\/\?([^#\s]+)$/.exec(source);
  if (url) {
    const sets = url[1].split(';');
    if (sets.length > 2) fail('Invalid original chunk URL.');
    const decode = value => {
      const result = [];
      for (const token of value ? value.split(',') : []) {
        if (!/^[0-9a-zA-Z]{1,9}$/.test(token)) fail('Invalid original chunk URL token.');
        let number = 0;
        for (const character of token) number = number * 62 + '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(character);
        if (!Number.isSafeInteger(number)) fail('Invalid original chunk URL number.');
        const digits = String(number).padStart(Math.ceil(String(number).length / 4) * 4, '0');
        for (let offset = 0; offset < digits.length; offset += 4) {
          const index = Number(digits.slice(offset, offset + 4));
          if (index >= 2303) fail('The original chunk URL contains a cell outside its grid.');
          result.push(String(7494 + 256 * (index % 47) - Math.floor(index / 47)));
        }
      }
      return [...new Set(result)];
    };
    // The original importer sorts selected grid indices descending.
    const selected = decode(sets[1] ?? '').sort((a, b) => {
      const index = id => Math.floor(Number(id) / 256) - 29 + 47 * (70 - Number(id) % 256);
      return index(b) - index(a);
    });
    return { unlocked: decode(sets[0]), selected };
  }
  if (source && !/^\d+(?:\s*,\s*\d+)*$/.test(source)) fail('Paste comma-separated chunk IDs or the original legacy chunk URL. Map codes require the later browser-read feature.');
  const unlocked = source ? source.split(',').map(id => id.trim()) : [];
  if (unlocked.some(id => !/^[1-9]\d{0,7}$/.test(id))) fail('Invalid original chunk ID.');
  return { unlocked: [...new Set(unlocked)], selected: [] };
}

export function originalRuleDecision(key, value, { defaults = originalRuleDefaults, definitions = taskRuleDefinitions, behaviorFor = taskRuleBehavior } = {}) {
  if (key === 'F2P') return { outcome: 'unsupported', reason: 'F2P changes shared content scope; review it separately in Rules.' };
  if (typeof value === 'string' && value.length > DISPLAY_CHARACTERS) return { outcome: 'unsupported', reason: 'This rule value exceeds the active display limit; the exact value stays in provenance.' };
  const definition = definitions.find(rule => rule.id === key);
  if (!Object.hasOwn(defaults, key) || !definition) return { outcome: 'unsupported', reason: 'No reviewed destination task rule equivalent.' };
  const behavior = behaviorFor(key);
  if (!['implemented-scope', 'category-gate'].includes(behavior.status)) return { outcome: 'unsupported', reason: behavior.detail };
  if (!['string', 'number', 'boolean'].includes(typeof value) || definition.type === 'boolean' && typeof value !== 'boolean' || taskRuleValueError(key, value)) return { outcome: 'unsupported', reason: 'Invalid value for the destination task rule.' };
  return { outcome: 'equivalent', target: key, reason: behavior.detail };
}

export function normalizeOriginalPaste(document, { current, world, dataset, migration = {} } = {}) {
  if (dataset?.datasetId !== 'duo-legacy' || dataset.coordinateSystem !== 'surface-grid-v1') fail('Original paste import requires the full legacy RS3 dataset. Other datasets need a reviewed correspondence.');
  const paste = readOriginalPaste(document), state = createGroupState([{ id: 'original_paste', name: 'Original picker player' }]);
  const member = state.members[0], records = [];
  let total = 0;
  const add = (field, key, rawValue, reason, outcome = 'preserved-for-review') => {
    total++;
    if (records.length < REPORT_RECORDS) records.push(boundedOutput({ reason, outcome, field, key, rawValue }, { bytes: 1536 }));
  };
  Object.assign(member, originalChunkList(paste.texts.chunksText));
  const chunks = paste.gameplay.chunks;
  for (const [original, target] of [['selected', 'selected'], ['potential', 'pendingRoll'], ['blacklisted', 'blacklisted']]) {
    const values = chunks?.[original];
    if (values !== undefined && !record(values)) { add(`chunks.${original}`, null, values, 'Expected a keyed chunk object.'); continue; }
    if (!values) continue;
    const entries = Object.entries(values);
    if (original === 'selected') entries.sort((a, b) => Number(a[1]) - Number(b[1]));
    member[target] = entries.flatMap(([raw, rank]) => {
      const id = decodeKey(raw);
      if (!/^[1-9]\d{0,7}$/.test(id) || original === 'selected' && (!Number.isSafeInteger(rank) || rank < 1)) {
        add(`chunks.${original}`, raw, rank, 'Invalid chunk ID or candidate rank.'); return [];
      }
      return [id];
    });
  }
  for (const field of ['unlocked', 'selected', 'pendingRoll', 'blacklisted']) {
    member[field] = [...new Set(member[field])].filter(id => {
      if (world.chunks.has(id)) return true;
      add(field, id, id, 'Unknown chunk retained in original paste provenance; excluded from active territory.'); return false;
    });
  }
  const ruleRows = [], decodedRuleCounts = new Map();
  for (const raw of Object.keys(paste.rules)) { const key = decodeKey(raw); decodedRuleCounts.set(key, (decodedRuleCounts.get(key) ?? 0) + 1); }
  for (const [raw, value] of Object.entries(paste.rules)) {
    const key = decodeKey(raw), decision = decodedRuleCounts.get(key) > 1
      ? { outcome: 'unsupported', reason: 'Multiple original keys decode to this rule; review the raw values separately.' } : originalRuleDecision(key, value);
    const applied = paste.includeRules && decision.outcome === 'equivalent';
    if (applied) (member.taskRules ??= {})[key] = boundedOutput(value);
    ruleRows.push({ ...decision, applied, key, rawKey: raw, ...(value !== null && typeof value === 'object' ? { valueType: 'structured; exact value retained in rulesText' } : { value }) });
    add('rules', key, value, `${decision.reason}${applied ? ' Imported for this player.' : ' Retained only.'}`, applied ? 'importable' : 'preserved-for-review');
  }
  const rows = [...current.tasks, ...(migration.catalogue ?? []), ...(migration.dynamicCatalogue ?? [])];
  const mappingIds = new Set();
  for (const tasks of Object.values(paste.gameplay.chunkinfo ?? {})) if (record(tasks)) for (const entries of Object.values(tasks)) if (record(entries)) for (const id of Object.keys(entries)) mappingIds.add(decodeKey(id));
  const index = buildIdentityIndex(rows, { savedRegistry: current.identityRegistry, taskMap: migration.taskMap ?? {}, history: migration.taskMapHistory, mappingIds });
  const definitions = new Map([...(migration.catalogue ?? []), ...(migration.dynamicCatalogue ?? []), ...current.tasks].map(task => [task.id, task]));
  const statuses = new Map(), referenced = new Set(), backlogConflicts = new Set();
  for (const [field, status] of [['checkedAllTasks', 'challengeCompleted'], ['checkedChallenges', 'challengeCompleted'], ['completedChallenges', 'challengeCompleted'], ['backlog', 'backlogged'], ['favoriteTasks', 'favorite']]) {
    const categories = paste.gameplay.chunkinfo?.[field];
    if (categories !== undefined && !record(categories)) { add(`chunkinfo.${field}`, null, categories, 'Expected category-keyed tasks.'); continue; }
    for (const [rawCategory, entries] of Object.entries(categories ?? {})) {
      if (!record(entries)) { add(`chunkinfo.${field}`, rawCategory, entries, 'Expected keyed task records.'); continue; }
      for (const [raw, value] of Object.entries(entries)) {
        const category = decodeKey(rawCategory), key = decodeKey(raw);
        const resolution = index.resolve(key.startsWith('t_') || key.startsWith('rs3:') ? key : legacyTaskId(category, key), { category });
        if (!paste.includeTasks || resolution.status !== 'resolved' || !definitions.has(resolution.id)
          || (field === 'backlog' ? typeof value !== 'string' || value.length > 10_000 : typeof value !== 'boolean')) {
          add(`chunkinfo.${field}.${category}`, key, value, !paste.includeTasks ? 'Task import is off.' : 'Unknown, ambiguous, unavailable or invalid task record.'); continue;
        }
        const patch = statuses.get(resolution.id) ?? {};
        if (field === 'backlog') {
          const reason = decodeLegacyText(value);
          if (backlogConflicts.has(resolution.id) || patch.backlogged && patch.backlogReason !== reason) { backlogConflicts.add(resolution.id); delete patch.backlogged; delete patch.backlogReason; add(`chunkinfo.${field}.${category}`, key, value, 'Conflicting backlog aliases; all raw reasons retained.'); continue; }
          patch.backlogged = true; patch.backlogReason = boundedOutput(reason);
          if (patch.backlogReason !== reason) add(`chunkinfo.${field}.${category}`, key, value, 'The active backlog reason is a bounded sample; the exact reason stays in original paste provenance.');
        } else if (value === true) patch[status] = true;
        statuses.set(resolution.id, patch); referenced.add(resolution.id);
      }
    }
  }
  member.taskStatus = Object.fromEntries(statuses);
  state.tasks = [...referenced].map(id => Object.fromEntries(Object.entries(definitions.get(id)).filter(([key]) => ['id', 'label', 'category', 'completionIds', 'skill', 'level'].includes(key))));
  // All other branches are explicitly archive-only; they never become authority,
  // observed personal progress, generated tasks or integration bindings.
  for (const [key, value] of Object.entries(paste.gameplay)) {
    if (key !== 'chunkinfo' && key !== 'chunks') add('gameplay', key, value, 'This gameplay branch is retained only. Paste rules separately; clipboard chunks are authoritative.');
  }
  for (const [key, value] of Object.entries(chunks ?? {})) if (!['selected', 'potential', 'blacklisted'].includes(key)) add('chunks', key, value, key === 'unlocked' ? 'Clipboard chunks are authoritative; captured ownership retained for comparison.' : 'Chunk annotations are retained only.');
  for (const [key, value] of Object.entries(paste.gameplay.chunkinfo ?? {})) if (!['checkedAllTasks', 'checkedChallenges', 'completedChallenges', 'backlog', 'favoriteTasks'].includes(key)) add('chunkinfo', key, value, 'This task-control branch is retained only.');
  const report = { format: 'rs3-chunk-transfer-report', version: 1, rules: boundedOutput(ruleRows, { bytes: 64 * 1024 }), records,
    counts: { preservedForReview: total, dropped: 0, omitted: total - records.length },
    history: 'This player replacement supports Undo; the previous save and exact pasted evidence are retained.' };
  return { state, archive: { format: ORIGINAL_PASTE_FORMAT, version: 1, ...paste.texts, includeRules: paste.includeRules, includeTasks: paste.includeTasks, rules: ruleRows }, report };
}
