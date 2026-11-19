import { randomUUID } from 'node:crypto';
import { open, link, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncDirectory } from './registry-lock.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const characterId = value => typeof value === 'string' && /^c_[0-9a-f]{32}$/.test(value);
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const publicRow = ({ id, pickerId, fromCharacterId, toCharacterId, status }) => ({ id, pickerId, fromCharacterId, toCharacterId, status });
export const HANDOVER_POINTS = ['handover-backed-up', 'handover-versioned', 'handover-before-proposal', 'handover-proposed', 'handover-before-resolution', 'handover-resolved'];

export function validateHandovers(doc) {
  if (doc.schemaVersion < 4) return;
  const bad = () => { throw new TypeError('Invalid ownership handover registry.'); };
  if (!Array.isArray(doc.handovers) || doc.handovers.length > 20000) bad();
  const ids = new Set(), pending = new Set();
  const pickers = new Set(doc.pickers.filter(p => p.kind === 'default').map(p => p.id));
  for (const h of doc.handovers) {
    if (!h || Object.keys(h).some(k => !['id', 'pickerId', 'fromAccountId', 'fromCharacterId', 'toAccountId', 'toCharacterId', 'status', 'createdAt', 'resolvedAt'].includes(k))
      || !uuid(h.id) || ids.has(h.id) || !pickers.has(h.pickerId)
      || !uuid(h.fromAccountId) || !uuid(h.toAccountId) || !characterId(h.fromCharacterId) || !characterId(h.toCharacterId)
      || h.fromCharacterId === h.toCharacterId || !['pending', 'accepted', 'declined', 'cancelled'].includes(h.status)
      || typeof h.createdAt !== 'string' || !Number.isFinite(Date.parse(h.createdAt))
      || (h.status === 'pending' ? h.resolvedAt !== null || h.fromAccountId === h.toAccountId
        : typeof h.resolvedAt !== 'string' || !Number.isFinite(Date.parse(h.resolvedAt)))) bad();
    ids.add(h.id);
    if (h.status === 'pending') { if (pending.has(h.pickerId)) bad(); pending.add(h.pickerId); }
  }
}

export function createGroupHandovers({ read, save, versionInvites, registryDir, point, now }) {
  const stamp = () => new Date(now()).toISOString();
  function roster(doc, accountId, actingId, pickerId) {
    const p = doc.pickers.find(p => p.id === pickerId);
    const c = doc.characters.find(c => c.id === actingId && c.accountId === accountId && c.lifecycle === 'active' && c.placement.pickerId === pickerId);
    if (!c || !p || p.kind !== 'default' || p.lifecycle !== 'active' || p.provisioning !== 'ready'
      || !p.seats.some(s => s.characterId === c.id)
      || !doc.accounts.some(a => a.id === accountId && a.memberships.some(m => m.pickerId === p.id && m.memberId === c.placement.memberId && m.role !== 'viewer'))) fail('Select a current character in an ordinary group.', 403);
    return p;
  }
  function owner(doc, accountId, actingId, pickerId) {
    const p = roster(doc, accountId, actingId, pickerId);
    if (p.ownerAccountId !== accountId || p.ownerCharacterId !== actingId) fail('Only the current designated owner can hand over this group.', 403);
    return p;
  }
  function ready(doc, pickerId) {
    if ((doc.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === pickerId))) fail('Deletion is completing. Retry after recovery.');
    if ((doc.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(pickerId))) fail('A departure is completing. Retry handover after recovery.');
    if ((doc.groupInvites ?? []).some(i => i.transaction && (i.pickerId === pickerId || i.transaction.source?.pickerId === pickerId))) fail('Group admission is completing. Retry handover after it finishes.');
  }
  function transfer(doc, p, h) {
    owner(doc, h.fromAccountId, h.fromCharacterId, p.id);
    roster(doc, h.toAccountId, h.toCharacterId, p.id);
    const from = doc.accounts.find(a => a.id === h.fromAccountId), to = doc.accounts.find(a => a.id === h.toAccountId);
    const old = doc.characters.find(c => c.id === h.fromCharacterId), next = doc.characters.find(c => c.id === h.toCharacterId);
    from.memberships.find(m => m.pickerId === p.id && m.memberId === old.placement.memberId).role = 'player';
    to.memberships.find(m => m.pickerId === p.id && m.memberId === next.placement.memberId).role = 'owner';
    p.ownerAccountId = to.id; p.ownerCharacterId = next.id;
    if (from.id !== to.id && from.defaultPickerId === p.id) from.defaultPickerId = null;
    // A default is a preference, not an entitlement to replace another group.
    to.defaultPickerId ??= p.id;
    for (const i of doc.groupInvites) if (i.pickerId === p.id && i.status === 'pending') {
      i.status = Date.parse(i.expiresAt) <= now() ? 'expired' : 'revoked'; i.terminalAt = i.status === 'expired' ? i.expiresAt : stamp();
      p.reservations = p.reservations.filter(r => r.inviteId !== i.id);
    }
    h.status = 'accepted'; h.resolvedAt = stamp();
  }
  async function version() {
    if (read().schemaVersion >= 4) return;
    await versionInvites();
    const target = path.join(registryDir, 'registry.pre-handovers-v3.json');
    const bytes = await readFile(path.join(registryDir, 'registry.json')), temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      try { await link(temporary, target); }
      catch (e) { if (e.code !== 'EEXIST') throw e; if (!(await readFile(target)).equals(bytes)) throw new Error('Handover migration preimage differs from registry. Review recovery before upgrading.'); }
    } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
    await syncDirectory(registryDir); await point('handover-backed-up');
    const doc = structuredClone(read()); doc.schemaVersion = 4; doc.handovers = []; doc.departures = []; doc.pastMaps = [];
    await save(doc); await point('handover-versioned');
  }
  return {
    version,
    list(accountId, actingId, pickerId) {
      const doc = read(), p = roster(doc, accountId, actingId, pickerId);
      return { ownerCharacterId: p.ownerCharacterId, candidates: doc.characters.filter(c => c.lifecycle === 'active' && c.placement.pickerId === p.id && c.id !== p.ownerCharacterId)
        .map(c => ({ id: c.id, runescapeName: c.runescapeName, sameLogin: c.accountId === accountId })),
      handovers: (doc.handovers ?? []).filter(h => h.pickerId === p.id && (p.ownerCharacterId === actingId || h.toCharacterId === actingId || h.fromCharacterId === actingId)).map(publicRow) };
    },
    async propose(accountId, actingId, pickerId, { requestId, targetCharacterId } = {}) {
      if (!uuid(requestId) || !characterId(targetCharacterId)) fail('Choose a successor and a handover request ID.', 400);
      roster(read(), accountId, actingId, pickerId);
      const receipt = read().handovers?.find(h => h.id === requestId);
      if (receipt) {
        if (receipt.pickerId !== pickerId || receipt.fromAccountId !== accountId || receipt.fromCharacterId !== actingId || receipt.toCharacterId !== targetCharacterId) fail('This handover request ID was already used.');
        return publicRow(receipt);
      }
      owner(read(), accountId, actingId, pickerId);
      const target = read().characters.find(c => c.id === targetCharacterId);
      if (targetCharacterId === actingId) fail('Choose another existing member character.');
      roster(read(), target?.accountId, targetCharacterId, pickerId);
      ready(read(), pickerId);
      if (read().handovers?.some(h => h.pickerId === pickerId && h.status === 'pending')) fail('Cancel the pending handover before proposing another.');
      if ((read().handovers?.length ?? 0) >= 20000) fail('The handover record limit has been reached. Existing ownership is unchanged.');
      await version();
      const doc = structuredClone(read()), p = owner(doc, accountId, actingId, pickerId);
      const h = { id: requestId, pickerId, fromAccountId: accountId, fromCharacterId: actingId, toAccountId: target.accountId, toCharacterId: target.id,
        status: 'pending', createdAt: stamp(), resolvedAt: null };
      doc.handovers.push(h);
      if (h.fromAccountId === h.toAccountId) transfer(doc, p, h);
      await point('handover-before-proposal', pickerId); await save(doc); await point('handover-proposed', pickerId);
      return publicRow(h);
    },
    async resolve(accountId, actingId, pickerId, id, action) {
      if (!uuid(id) || !['accept', 'decline', 'cancel'].includes(action)) fail('Invalid handover response.', 400);
      const doc = structuredClone(read()), p = roster(doc, accountId, actingId, pickerId);
      const h = doc.handovers?.find(h => h.id === id && h.pickerId === pickerId);
      if (!h) fail('Handover not found.', 404);
      const cancelling = action === 'cancel';
      if (accountId !== (cancelling ? h.fromAccountId : h.toAccountId) || actingId !== (cancelling ? h.fromCharacterId : h.toCharacterId)) fail('This handover is addressed to a different character.', 403);
      const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
      if (h.status === status) return publicRow(h);
      if (h.status !== 'pending') fail(`This handover is already ${h.status}.`);
      owner(doc, h.fromAccountId, h.fromCharacterId, pickerId); ready(doc, pickerId);
      if (action === 'accept') transfer(doc, p, h);
      else { h.status = status; h.resolvedAt = stamp(); }
      await point('handover-before-resolution', pickerId); await save(doc); await point('handover-resolved', pickerId);
      return publicRow(h);
    },
  };
}
