const retainedFields = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);

/** Preview queued chunk edits without changing the saved revision or history. */
export function projectChunkState(state, changes) {
  if (!changes.length) return state;
  const members = state.members.map(member => {
    const edits = changes.filter(change => change.memberId === member.id);
    if (!edits.length) return member;
    const projected = { ...member };
    for (const field of ['unlocked', 'selected', 'blacklisted']) projected[field] = [...member[field]];
    for (const edit of edits) {
      if (!['unlocked', 'selected', 'blacklisted', 'locked'].includes(edit.status) || member.pendingRoll.includes(edit.chunkId)) continue;
      for (const field of ['unlocked', 'selected', 'blacklisted']) projected[field] = projected[field].filter(id => id !== edit.chunkId);
      if (edit.status !== 'locked') projected[edit.status].push(edit.chunkId);
    }
    return projected;
  });
  return { ...state, members };
}

/** A command may reuse large fields from the exact revision it changed. */
export function mergeCommandState(baseline, response) {
  if (!response.unchangedFields?.length) return response.state;
  if (!Array.isArray(response.unchangedFields)) throw new TypeError('Invalid unchanged command fields');
  if (!baseline || baseline.revision !== response.baseRevision) return null;
  const state = { ...response.state };
  for (const field of response.unchangedFields) {
    if (!retainedFields.has(field) || !Object.hasOwn(baseline, field) || Object.hasOwn(state, field)) {
      throw new TypeError('Invalid retained command field');
    }
    state[field] = baseline[field];
  }
  return state;
}
