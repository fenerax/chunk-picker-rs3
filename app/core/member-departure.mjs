import { isResidentState, cloneResidentState } from './resident-copy.mjs';

// Restore and roster mapping archive incoming History rather than replay its
// inverses. Its departed IDs still declare inert historical task assignments.
// Previous/local restore History is a different save and grants no declaration.
export function departedMemberIds(state) {
  const ids = new Set(), seen = new Set();
  const history = rows => { for (const e of rows ?? []) if (e.type === 'member-departed') ids.add(e.command?.memberId); };
  history(state.history);
  const nodes = [state.provenance];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    history(node.restore?.incomingHistory);
    nodes.push(node.restore?.incomingProvenance);
    for (let transfer = node.transferRoster; transfer; transfer = transfer.previous) {
      if (seen.has(transfer)) break;
      seen.add(transfer); history(transfer.history);
    }
  }
  return ids;
}

// A roster epoch uses existing schema-1 members/History fields. The full frozen
// preimage is retained as a Past map before this transition can be published.
export function memberDeparture(state, memberId, departureId, at) {
  if (state.history.some(e => e.type === 'member-departed' && e.command?.departureId === departureId)) return state;
  if (!state.members.some(m => m.id === memberId) || state.members.length <= 1) throw new Error('Departure needs an existing non-final member.');
  const next = isResidentState(state) ? cloneResidentState(state) : structuredClone(state); next.revision++;
  const old = next.members.find(m => m.id === memberId);
  // Imported display names have a wider contract than History actor labels.
  // Keep the full original in the frozen map; derive bounded attribution even
  // when recovering an intent written before this normalization existed.
  const label = old.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 80).trim() || 'Departed character';
  next.members = next.members.filter(m => m.id !== memberId);
  // Definition rows stay saved with their original assignments; a departed ID
  // has no live member and therefore supplies no current tasks or completion.
  if (next.taskClaims) for (const [id, claim] of Object.entries(next.taskClaims)) if (claim.memberId === memberId) delete next.taskClaims[id];
  if (next.finishLine) for (const row of next.finishLine.customItems) row.completedBy = row.completedBy.filter(id => id !== memberId);
  if (next.groupGoals) for (const goal of next.groupGoals) if (goal.completion === 'players') {
    goal.completedBy = goal.completedBy.filter(id => id !== memberId); goal.done = next.members.every(m => goal.completedBy.includes(m.id));
  }
  delete next.progressSnapshots; // the original daily series remains in Past maps
  next.history.push({ id: `revision-${next.revision}`, revision: next.revision, type: 'member-departed', at,
    actor: { kind: 'invite', inviteId: departureId, memberId, label }, command: { type: 'member-departed', memberId, departureId } });
  return next;
}
