import { createHash } from 'node:crypto';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
export const deletionRevision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireLoginDeletionReady(doc, accountId) {
  if (doc.accounts.find(a => a.id === accountId)?.pendingCreation) fail('Finish character creation before deleting.');
  if (doc.pickers.some(p => p.ownerAccountId === accountId && p.lifecycle === 'active' && p.provisioning !== 'ready')
    || (doc.groupInvites ?? []).some(i => i.transaction && [i.acceptingAccountId, i.issuerAccountId].includes(accountId))
    || (doc.departures ?? []).some(d => !d.completedAt && [d.accountId, d.actorAccountId].includes(accountId))
    || (doc.handovers ?? []).some(h => h.status === 'pending' && [h.fromAccountId, h.toAccountId].includes(accountId))
    || (doc.deletions ?? []).some(d => !d.completedAt && d.accountId === accountId)
    || doc.relinkRetirements?.includes(accountId)
  ) fail('A login lifecycle change is pending. Finish or cancel it before deleting this login.');
}
/** Full account/roster projection, recomputed inside the registry queue. */
export function deletionPlan(doc, accountId, { kind, characterId = null, pickerId = null, deleteGroup = false } = {}) {
  if (!['character', 'picker', 'account'].includes(kind) || typeof deleteGroup !== 'boolean') fail('Choose a deletion action.', 400);
  const account = doc.accounts.find(a => a.id === accountId);
  if (!account) fail('Sign in again before deleting.', 401);
  if (account.pendingCreation) fail('Finish character creation before deleting.');
  if (kind === 'account') requireLoginDeletionReady(doc, accountId);
  const own = doc.characters.filter(c => c.accountId === accountId && c.lifecycle === 'active');
  const c = own.find(c => c.id === characterId);
  if (kind !== 'account' && (!c || c.placement.pickerId !== pickerId)) fail('Select your own current character and group.', 403);
  const picker = doc.pickers.find(p => p.id === pickerId);
  if (kind === 'picker' && (picker?.ownerAccountId !== accountId || picker.ownerCharacterId !== characterId)) fail('Only the designated owner can delete this group.', 403);
  const targets = (kind === 'account' ? own : kind === 'character' ? [c] : own.filter(c => c.placement.pickerId === pickerId))
    .map(c => ({ characterId: c.id, ...c.placement })).sort((a, b) => a.characterId.localeCompare(b.characterId));
  const ids = new Set(targets.map(t => t.characterId)), involved = [...new Set(targets.map(t => t.pickerId))].sort(), groups = [], rosters = [];
  for (const id of involved) {
    const p = doc.pickers.find(p => p.id === id);
    if (p?.kind !== 'default' || p.lifecycle !== 'active' || p.provisioning !== 'ready') fail('The legacy shared picker or an unavailable group needs operator recovery.');
    if ((doc.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(id))
      || (doc.groupInvites ?? []).some(i => i.transaction && (i.pickerId === id || i.transaction.source?.pickerId === id))
      || (doc.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === id))) fail('Another group change is completing. Retry after recovery.');
    const survivors = p.seats.filter(s => !ids.has(s.characterId));
    if (kind === 'picker' && survivors.length) fail('Other logins still have characters here. Hand over ownership or remove them first; removal preserves their maps.');
    if (survivors.length && ids.has(p.ownerCharacterId)) fail('Complete ownership handover before deleting the designated owner character or login.');
    if (!survivors.length) {
      if (kind === 'character' && !deleteGroup) fail('Explicitly confirm deletion of this final character and its group.');
      groups.push(id);
    }
    rosters.push({ pickerId: id, ownerAccountId: p.ownerAccountId, ownerCharacterId: p.ownerCharacterId, seats: p.seats, reservations: p.reservations });
  }
  const selection = { kind, characterId, pickerId, deleteGroup };
  return { ...selection, targets, groups, revision: deletionRevision({ account: { id: account.id, memberships: account.memberships, identities: account.identities }, targets, groups, rosters }),
    characters: targets.map(t => ({ ...t, runescapeName: doc.characters.find(c => c.id === t.characterId).runescapeName })),
    keptCharacters: own.filter(c => !ids.has(c.id)).map(c => c.id), survivingGroups: involved.filter(id => !groups.includes(id)) };
}
