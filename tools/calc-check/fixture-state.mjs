// Core engine unit tests also use partial states with global task switches.
// Convert that shorthand to the saved-game schema without losing rule effects.
export function completeFixtureState(input, catalogue = []) {
  const { taskRules, ...saved } = input;
  const state = { schemaVersion: 1, revision: 0, rules: {}, tasks: [], history: [], ...saved,
    members: input.members.map(member => ({ name: member.id, sourceMapId: null, unlocked: [], selected: [], pendingRoll: [], blacklisted: [], completedTasks: [], obtainedEquipment: [], teleports: [], notes: {}, ...member,
      taskRules: { ...taskRules, ...member.taskRules } })) };
  const present = new Set(state.tasks.map(task => task.id));
  const missing = new Set(state.members.flatMap(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})]).filter(id => !present.has(id)));
  if (!missing.size) return state;
  const extra = [];
  for (const row of catalogue) {
    if (typeof row.label !== 'string' || typeof row.category !== 'string') continue;
    for (const id of [row.id, ...row.aliases ?? []]) if (missing.delete(id)) extra.push({ id, label: row.label, category: row.category });
  }
  if (extra.length) state.tasks = [...state.tasks, ...extra];
  return state;
}
