import { isDeepStrictEqual } from 'node:util';

// These leaf commands keep their complete gameplay inverse in History. Imports,
// random offers and external observations need snapshots, not guessed replay.
const deterministic = {
  'set-rule': ['ruleId', 'value'],
  'set-chunk': ['memberId', 'chunkId', 'status'],
  'complete-task': ['memberId', 'taskId', 'completed'],
  'set-task-status': ['memberId', 'taskId', 'backlogged', 'backlogReason', 'favorite', 'note', 'challengeCompleted'],
  'set-preference': ['memberId', 'preferenceId', 'value'],
  'set-note': ['memberId', 'chunkId', 'note'],
  'set-journal': ['memberId', 'note'],
};
const reversible = event => event?.command?.type === event?.type && Object.hasOwn(deterministic, event?.type);
export async function rebuildHistoryRevisions(current, known, options) {
  const missing = new Set(current.history.map(event => event.revision).filter(revision => !known.has(revision)));
  let rebuilt = 0;
  const retain = state => {
    if (!missing.delete(state.revision)) return;
    known.set(state.revision, { load: async () => state }); rebuilt++;
  };
  if (!missing.size) return 0;
  const { applyCommand } = await import('../../app/core/state.mjs');
  const replay = (state, event) => {
    // History also records derived labels; pass only the command's input keys.
    const command = Object.fromEntries(['type', ...deterministic[event.type]].filter(key => Object.hasOwn(event.command, key)).map(key => [key, event.command[key]]));
    return applyCommand(state, command, { ...options, now: () => event.at, ...(event.actor ? { actor: event.actor } : {}) });
  };
  // Forward replay must reproduce the complete recorded event, including its
  // inverse. A missing command, revision gap or changed semantics stays a gap.
  for (const event of [...current.history].sort((a,b) => a.revision-b.revision)) {
    if (!missing.has(event.revision) || !known.has(event.revision-1) || !reversible(event)) continue;
    try {
      const state = replay(await known.get(event.revision-1).load(), event);
      const expected = { ...event };
      if (expected.undoneRevision > event.revision) delete expected.undoneRevision;
      if (isDeepStrictEqual(state.history.at(-1), expected)) retain(state);
    } catch { /* Unverifiable history is counted, never invented. */ }
  }
  // With only a later snapshot, undo then replay must reproduce that entire
  // snapshot. This also catches inverses that intentionally discard claims.
  for (const [, entry] of [...known].sort((a,b) => b[0]-a[0])) {
    if (!missing.size) break;
    let state = await entry.load();
    while (missing.size && state.revision > [...missing].reduce((a,b) => Math.min(a,b), Infinity)) {
      const event = state.history.at(-1);
      if (event?.revision !== state.revision || !event.undo || !reversible(event)) break;
      try {
        const undone = applyCommand(state, { type: 'undo', undoRevision: event.revision }, options);
        const before = { ...undone, revision: event.revision-1, history: state.history.filter(row => row.revision < event.revision) };
        if (!isDeepStrictEqual(replay(before, event), state)) break;
        retain(before);
        const prior = known.has(before.revision) ? await known.get(before.revision).load() : before;
        if (prior.revision !== before.revision) break;
        state = prior;
      } catch { break; }
    }
  }
  return rebuilt;
}
