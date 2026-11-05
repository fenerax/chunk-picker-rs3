// Admission before cloning, codec expansion, migration or hashing hostile saves.
// These limits concern synchronous CPU on the shared server, independently of
// the (streamed) wire/decompression limit. Archives consume the same budget.
export const IMPORT_WORK_LIMITS = Object.freeze({ tasks: 5_000, history: 500, units: 100_000, text: 1 * 1024 * 1024 });
export function refuseImportWork() { throw Object.assign(new Error('This backup exceeds the safe import work limit for this shared server. Reduce its catalogue, History or archived evidence and export a smaller backup.'), { status: 413 }); }

export function assertImportWork(value, { additionalWork = 0, budget } = {}) {
  let units = (budget?.units ?? 0) + additionalWork, text = budget?.text ?? 0;
  const ancestors = new Set();
  const occurrences = new Map(), aliases = [], taskAliases = new Map();
  const charge = amount => { units += amount; if (units > IMPORT_WORK_LIMITS.units) refuseImportWork(); };
  const note = value => occurrences.set(value, (occurrences.get(value) ?? 0) + 1);
  const memberReferences = member => ['completedTasks', 'unlocked', 'selected', 'pendingRoll', 'xpChoices', 'taskStatus', 'questProgress', 'achievementProgress', 'itemProgress']
    .reduce((sum, field) => sum + Object.keys(member?.[field] ?? {}).length, 0)
    + Object.values(member?.taskAlternatives ?? {}).reduce((sum, groups) => sum + Object.keys(groups ?? {}).length, 0);
  function visit(item, depth = 0) {
    charge(1);
    if (typeof item === 'string') { note(item); text += item.length; if (text > IMPORT_WORK_LIMITS.text) refuseImportWork(); return; }
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item.members) && item.members.length > 32) refuseImportWork();
    if (depth > 100 || ancestors.has(item)) refuseImportWork();
    ancestors.add(item);
    const keys = Object.keys(item);
    charge(keys.length);
    // Account for the remaining catalogue rebuilds and reference checks during
    // replay. Count ceilings alone cannot bound these multiplicative terms.
    if (Array.isArray(item.tasks) && Array.isArray(item.history)) {
      if (item.tasks.length > IMPORT_WORK_LIMITS.tasks || item.history.length > IMPORT_WORK_LIMITS.history) refuseImportWork();
      let references = (item.members ?? []).reduce((n, member) => n + memberReferences(member), 0);
      let claims = Object.keys(item.taskClaims ?? {}).length;
      let catalogueSize = item.tasks.length, restoredRows = 0;
      for (const event of item.history) {
        for (const member of event?.undo?.members ?? []) references += memberReferences(member);
        for (const change of event?.undo?.memberChanges ?? []) for (const patch of change.changes ?? []) {
          // A historical array may be larger than today's cleared collection.
          for (const side of [patch.before, patch.after]) if (side?.value && typeof side.value === 'object') references += Object.keys(side.value).length;
        }
        claims += event?.undo?.taskClaimChanges?.changes?.length ?? 0;
        catalogueSize = Math.max(catalogueSize, event?.undo?.tasks?.length ?? 0);
        for (const change of event?.undo?.taskChanges ?? []) if (change.before?.exists && !change.after?.exists) restoredRows++;
      }
      catalogueSize += restoredRows;
      for (const event of item.history) {
        if (!event?.undo) continue;
        charge(references + claims);
        if (event.undo.tasks || event.undo.taskChanges?.some(change => !change.before?.exists || !change.after?.exists || change.before.index !== change.after.index)) {
          charge(catalogueSize + (event.undo.tasks?.length ?? 0));
        }
      }
    }
    // Compact completion arrays can amplify both hashes and expanded snapshots.
    if (Array.isArray(item.entries) && item.version === 1) {
      for (const entry of item.entries) if (entry && Number.isSafeInteger(entry.length) && entry.length > 0) charge(entry.length);
    }
    if (typeof item.id === 'string' && typeof item.label === 'string' && typeof item.category === 'string') {
      const implicit = `rs3:${encodeURIComponent(item.category.normalize('NFC'))}:${encodeURIComponent((item.rawLabel ?? item.label).normalize('NFC'))}`;
      for (const alias of new Set([implicit, ...(Array.isArray(item.aliases) ? item.aliases : [])])) {
        if (typeof alias === 'string') taskAliases.set(alias, (taskAliases.get(alias) ?? 0) + 1);
      }
    }
    if (item.aliases && !Array.isArray(item.aliases) && typeof item.aliases === 'object') {
      for (const [alias, targets] of Object.entries(item.aliases)) if (Array.isArray(targets)) aliases.push([alias, targets.length]);
    }
    for (const key of keys) { note(key); text += key.length; if (text > IMPORT_WORK_LIMITS.text) refuseImportWork(); visit(item[key], depth + 1); }
    ancestors.delete(item);
  }
  visit(value);
  for (const [alias, targets] of taskAliases) charge((occurrences.get(alias) ?? 0) * targets);
  for (const [alias, targets] of aliases) charge((occurrences.get(alias) ?? 0) * targets);
  if (budget) { budget.units = units; budget.text = text; }
  return units;
}
