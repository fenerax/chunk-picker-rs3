// Real commands only. replace-member is the application's existing map-restore
// command; its single inverse replaces thousands of individual unlock inverses.
// Neighbour-mode option names differ by dataset (open starter: geometric;
// duo-legacy: frontier). Pick the non-default walking option the registry offers.
export function alternateNeighborMode(rules) {
  const options = rules?.get?.('roll.neighborMode')?.options ?? [];
  return options.find(option => option !== 'accessible' && option !== 'manual') ?? 'accessible';
}
export function* growthCommands(state, item, chunks, fixture, now, rules) {
  const unlocked = chunks.slice(0, Math.max(1, Math.floor(chunks.length * fixture.unlockFraction)));
  for (const member of state.members) {
    yield { command: { type: 'replace-member', memberId: member.id,
      member: { ...member, unlocked }, source: 'Synthetic capacity batch unlock' }, ticks: unlocked.length };
    yield { command: { type: 'set-skill-levels', memberId: member.id, skill: 'Mining', passiveLevel: 20 + item.variant * 15 } };
    yield { command: { type: 'add-task', task: { id: `custom:capacity-${member.id}`, category: 'Custom',
      label: `Synthetic private task ${item.index}-${member.id}`, memberIds: [member.id] } } };
    yield { command: { type: 'complete-task', memberId: member.id, taskId: `custom:capacity-${member.id}`, completed: true } };
    yield { command: { type: 'add-task', task: { id: `custom:quest-${member.id}`, category: 'Quest', label: 'Synthetic quest', memberIds: [member.id] } } };
    yield { command: { type: 'add-task', task: { id: `custom:item-${member.id}`, category: 'Custom', label: 'Synthetic item goal', memberIds: [member.id] } } };
    yield { command: { type: 'apply-game-progress', memberId: member.id, fetchedAt: new Date(now()).toISOString(),
      skills: [{ skill: 'Mining', level: 20 + item.variant * 15, xp: 4470 }],
      quests: [{ taskId: `custom:quest-${member.id}`, title: 'Synthetic quest' }],
      items: [{ taskId: `custom:item-${member.id}`, title: 'Synthetic item', gameItemId: 1000000, evidence: 'owned', seen: 'Synthetic fixture observation' }] } };
  }
  yield { command: { type: 'set-rule', ruleId: 'access.shared', value: item.variant % 2 === 0 } };
  yield { command: { type: 'set-rule', ruleId: 'roll.neighborMode', value: item.variant < 2 ? 'accessible' : alternateNeighborMode(rules) } };
}

// Publish before a potentially slow operation, then after completion. Callers
// await writes, so there is no unbounded queue of progress writes or stale race.
// First/last steps and phase/group changes bypass the one-second throttle.
export function fixtureProgress(write, { now = Date.now, intervalMs = 1000 } = {}) {
  let lastAt = -Infinity, previous = {}, sequence = 0;
  return async update => {
    const at = now();
    const boundary = ['groupIndex', 'phase', 'groups'].some(key => update[key] !== previous[key]);
    const endpoint = update.completed === 0 || update.completed === update.total;
    if (!boundary && !endpoint && at - lastAt < intervalMs) return;
    await write({ ...update, sequence: ++sequence, updatedAt: new Date(at).toISOString() });
    lastAt = at; previous = update;
  };
}
