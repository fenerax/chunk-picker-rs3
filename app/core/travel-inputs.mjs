// These inputs belong to the transport-disabled task proof and the personal
// fact projection in automatic-transport.mjs. Keep this browser-compatible.
const memberFields = ['id', 'name', 'sourceMapId', 'unlocked', 'completedTasks', 'obtainedEquipment',
  'teleports', 'teleportOverrides', 'taskRules', 'sectionOverrides', 'sourceBacklogs',
  'areaOverrides', 'primaryOverrides', 'passiveLevels', 'maxLevels', 'slayerLock',
  'runescapeName', 'skillProgress', 'questProgress', 'transportFacts', 'xpChoices'];
const irrelevantRules = new Set(['roll.selected', 'roll.adjacent', 'roll.neighborMode',
  'roll.clearSelected', 'roll.walkable', 'roll.teleports', 'roll.teleportScope', 'tasks.completion']);
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const targets = value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function identityInputs(state) {
  const ids = new Set(state.members.flatMap(member => [...member.completedTasks ?? [],
    ...Object.entries(member.taskStatus ?? {}).filter(([, status]) => Object.hasOwn(status, 'backlogged')).map(([id]) => id)]));
  const registry = state.identityRegistry;
  // The proof resolves completion/backlog IDs without a category. Catalogue
  // aliases are fixed by the evaluator; saved aliases can add candidates, and
  // entry existence can admit a saved candidate or an otherwise unknown ID.
  // Entry labels/category/aliases and unrelated registrations are not read by
  // this uncategorized resolution. Task alternatives only select presentation.
  return [...ids].map(id => {
    const aliases = registry?.aliases?.[id], savedAliases = registry?.savedAliases?.[id];
    return [id, aliases, savedAliases, [...new Set([id, ...targets(aliases), ...targets(savedAliases)])]
      .map(target => [target, record(registry?.entries?.[target])])];
  });
}

export function automaticTravelInputKey(state, transportFactsByMember) {
  const completed = new Set(state.members.flatMap(member => member.completedTasks ?? []));
  // Preserve nested save order: legacy encoded keys can decode to the same
  // name, and alias/XP/source dictionaries can have meaningful precedence.
  return JSON.stringify({
    rules: Object.fromEntries(Object.entries(state.rules ?? {}).filter(([key]) => !irrelevantRules.has(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    taskRules: state.taskRules,
    members: state.members.map(member => ({ ...pick(member, memberFields),
      // Challenge ticks do not prove personal completion, supplies or training.
      // Backlogs do remove production methods, including explicit false aliases.
      taskStatus: Object.entries(member.taskStatus ?? {})
        .filter(([, status]) => Object.hasOwn(status, 'backlogged'))
        // Alias statuses merge in save order; canonical entries merge last.
        .map(([id, status]) => [id, status.backlogged]) })),
    legacy: state.legacy, gameplayMigration: state.gameplayMigration,
    identities: identityInputs(state),
    quests: (state.tasks ?? []).filter(task => task.category === 'Quest' && completed.has(task.id)).map(task => pick(task, ['id', 'label'])),
    transportFactsByMember,
  });
}
