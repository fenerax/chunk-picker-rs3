import { createHash } from 'node:crypto';
import { mkdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { durableDirectory, writeRegistryJson, syncDirectory } from './registry-lock.mjs';
import { assertPastMapFits } from './login-storage-budget.mjs';

const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const cid = v => typeof v === 'string' && /^c_[0-9a-f]{32}$/.test(v);
const pid = v => typeof v === 'string' && /^p_[0-9a-f]{32}$/.test(v);
const slot = v => v && Object.keys(v).length === 2 && pid(v.pickerId) && typeof v.memberId === 'string';
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
export const DEPARTURE_POINTS = ['departure-intent', 'departure-id', 'departure-directory', 'departure-destination', 'departure-snapshot-file', 'departure-snapshot', 'departure-roster-prepared', 'departure-roster', 'departure-keys', 'departure-overlays', 'departure-sessions', 'departure-credentials', 'departure-placed'];
export const pastMapDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const pickerHasPendingJoin = (doc, pickerId) => (doc.groupInvites ?? []).some(i => i.transaction
  && (i.pickerId === pickerId || i.transaction.source?.pickerId === pickerId)) || (doc.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === pickerId));
export function pastMapSlots(doc) {
  const saved = new Set((doc.pastMaps ?? []).map(m => m.id));
  return saved.size + (doc.departures ?? []).filter(d => !d.completedAt && !saved.has(d.id)).length
    + (doc.groupInvites ?? []).filter(i => i.transaction?.pastMapId && !saved.has(i.transaction.pastMapId)).length;
}

export function validateDepartures(doc) {
  if (doc.schemaVersion < 4) return;
  const bad = () => { throw new TypeError('Invalid departure registry.'); };
  if (!Array.isArray(doc.departures) || !Array.isArray(doc.pastMaps) || doc.departures.length > 20000 || doc.pastMaps.length > 20000 || pastMapSlots(doc) > 20000) bad();
  const ids = new Set(), moving = new Set(), destinations = new Set();
  const pickers = new Set(doc.pickers.map(p => p.id)), characters = new Map(doc.characters.map(c => [c.id, c]));
  for (const d of doc.departures) {
    if (!d || Object.keys(d).some(k => !['id', 'characterId', 'accountId', 'actorAccountId', 'actorCharacterId', 'source', 'destination', 'reason', 'createdAt', 'completedAt'].includes(k))
      || !uuid(d.id) || ids.has(d.id) || !cid(d.characterId) || !cid(d.actorCharacterId) || !uuid(d.accountId) || !uuid(d.actorAccountId)
      || !slot(d.source) || !slot(d.destination) || d.destination.memberId !== 'owner' || d.source.pickerId === d.destination.pickerId
      || !['left', 'removed'].includes(d.reason) || !date(d.createdAt) || !(d.completedAt === null || date(d.completedAt))) bad();
    ids.add(d.id);
    const c = characters.get(d.characterId);
    if (!d.completedAt) {
      if (moving.has(d.characterId) || destinations.has(d.destination.pickerId) || pickers.has(d.destination.pickerId)
        || c?.lifecycle !== 'active' || c.accountId !== d.accountId || JSON.stringify(c.placement) !== JSON.stringify(d.source)) bad();
      moving.add(d.characterId); destinations.add(d.destination.pickerId);
    }
  }
  const maps = new Map();
  for (const m of doc.pastMaps) {
    if (!m || Object.keys(m).some(k => !['id', 'accountId', 'characterId', 'pickerId', 'memberId', 'reason', 'createdAt', 'digest'].includes(k))
      || !uuid(m.id) || maps.has(m.id) || !uuid(m.accountId) || !cid(m.characterId) || !pid(m.pickerId) || typeof m.memberId !== 'string'
      || !['left', 'removed', 'rejoined'].includes(m.reason) || !date(m.createdAt) || !/^[0-9a-f]{64}$/.test(m.digest)
      || !pickers.has(m.pickerId)) bad();
    maps.set(m.id, m);
  }
  for (const d of doc.departures) {
    const m = maps.get(d.id);
    if (d.completedAt && !m || m && (m.accountId !== d.accountId || m.characterId !== d.characterId || m.pickerId !== d.source.pickerId || m.memberId !== d.source.memberId || m.reason !== d.reason || m.createdAt !== d.createdAt)) bad();
  }
}

export function departureSoloEligible(doc, accountId, characterId) {
  const c = doc.characters.find(c => c.id === characterId && c.accountId === accountId && c.lifecycle === 'active');
  const p = doc.pickers.find(p => p.id === c?.placement?.pickerId);
  return Boolean(p?.kind === 'default' && p.lifecycle === 'active' && p.provisioning === 'ready' && p.ownerCharacterId === c.id
    && p.seats.length === 1 && (doc.departures ?? []).some(d => d.completedAt && d.characterId === c.id && d.destination.pickerId === p.id)
    && !(doc.departures ?? []).some(d => !d.completedAt && d.characterId === c.id)
    && !pickerHasPendingJoin(doc, p.id));
}

export function createGroupDepartures({ read, save, saveLedgerId, allocate, version, point, now, caps, pickerRoot, registryDir, admit = async () => {} }) {
  const stamp = () => new Date(now()).toISOString();
  const snapshotFile = id => path.join(registryDir, 'past-maps', id + '.json');
  function character(doc, id) { const c = doc.characters.find(c => c.id === id && c.lifecycle === 'active'); if (!c) fail('Character is unavailable.', 403); return c; }
  function check(doc, actorAccountId, actorCharacterId, targetId, expectedPicker) {
    if ((doc.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === expectedPicker))) fail('Deletion is completing. Retry after recovery.');
    const c = character(doc, targetId), actor = character(doc, actorCharacterId), p = doc.pickers.find(p => p.id === c.placement.pickerId);
    if (actor.accountId !== actorAccountId || actor.placement.pickerId !== p?.id || p.id !== expectedPicker || p.kind !== 'default' || p.lifecycle !== 'active') fail('Select a current character in this group.', 403);
    const removing = actor.id !== c.id;
    if (removing && (p.ownerCharacterId !== actor.id || p.ownerAccountId !== actorAccountId)) fail('Only the designated owner can remove another member.', 403);
    if (p.ownerCharacterId === c.id) fail('Complete ownership handover before this character leaves.');
    if (p.seats.length <= 1) fail('A solo character keeps this group. Join another group by invitation.');
    if ((doc.departures ?? []).some(d => !d.completedAt && (d.source.pickerId === p.id || d.characterId === c.id))
      || (doc.groupInvites ?? []).some(i => i.transaction && (i.pickerId === p.id || i.transaction.source?.pickerId === p.id))) fail('Another group change is completing. Retry after recovery.');
    return { c, p, removing };
  }
  return {
    pending() { return structuredClone((read().departures ?? []).filter(d => !d.completedAt)); },
    get(id) { return structuredClone(read().departures?.find(d => d.id === id)); },
    destination(id) {
      const d = read().departures?.find(d => !d.completedAt && d.destination.pickerId === id);
      return d && { id, kind: 'default', ownerAccountId: d.accountId, ownerCharacterId: d.characterId, lifecycle: 'active', provisioning: 'ready', memberIds: ['owner'], seats: [{ memberId: 'owner', characterId: d.characterId }], reservations: [], createdAt: d.createdAt };
    },
    async begin(actorAccountId, actorCharacterId, pickerId, { requestId, characterId } = {}) {
      if (!uuid(requestId) || !cid(characterId)) fail('A departure request ID and character are required.', 400);
      const receipt = read().departures?.find(d => d.id === requestId);
      if (receipt) {
        if (receipt.actorAccountId !== actorAccountId || receipt.actorCharacterId !== actorCharacterId || receipt.characterId !== characterId || receipt.source.pickerId !== pickerId) fail('This departure request ID was already used.');
        return structuredClone(receipt);
      }
      if ((read().pastMaps ?? []).some(m => m.id === requestId) || (read().groupInvites ?? []).some(i => i.id === requestId)) fail('This request ID is already used for another retained map or invitation.');
      const { c, removing } = check(read(), actorAccountId, actorCharacterId, characterId, pickerId);
      if ((read().departures?.length ?? 0) >= 20000 || pastMapSlots(read()) >= 20000) fail('The retained map record limit has been reached. Existing maps are unchanged.');
      const picker = await allocate(false, c.accountId);
      await version();
      const doc = structuredClone(read()), d = { id: requestId, characterId: c.id, accountId: c.accountId, actorAccountId, actorCharacterId,
        source: structuredClone(c.placement), destination: { pickerId: picker, memberId: 'owner' }, reason: removing ? 'removed' : 'left', createdAt: stamp(), completedAt: null };
      doc.departures.push(d); await admit(doc); await save(doc); await point('departure-intent', pickerId); return structuredClone(d);
    },
    async prepare(id) {
      const d = read().departures.find(d => d.id === id); if (!d || d.completedAt) return;
      await saveLedgerId(d.destination.pickerId); await point('departure-id', d.source.pickerId);
      const directory = path.join(pickerRoot, d.destination.pickerId);
      await durableDirectory(directory);
      if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) fail('Unsafe departure destination.');
      await syncDirectory(pickerRoot); await point('departure-directory', d.source.pickerId);
    },
    async capture(meta, document) {
      if (!uuid(meta.id)) fail('Invalid Past map ID.', 400);
      const existing = read().pastMaps.find(m => m.id === meta.id);
      if (existing) {
        if (Object.keys(meta).some(k => existing[k] !== meta[k])) fail('The retained map ID belongs to a different departure. Recovery needs review.');
        return structuredClone(existing);
      }
      if (read().pastMaps.length >= 20000) fail('The retained map record limit has been reached.');
      const proposal = structuredClone(read()); proposal.pastMaps.push(meta);
      await admit(proposal);
      await durableDirectory(path.join(registryDir, 'past-maps'));
      const file = snapshotFile(meta.id);
      let bytes;
      try { bytes = await readFile(file); }
      catch (e) { if (e.code !== 'ENOENT') throw e; assertPastMapFits(document); await writeRegistryJson(file, document); bytes = await readFile(file); }
      // An interrupted capture is immutable: retry uses the frozen file, never
      // resnapshots a source whose roster may already have changed.
      const m = { ...meta, digest: pastMapDigest(bytes) };
      await point('departure-snapshot-file', meta.pickerId);
      const doc = structuredClone(read()); doc.pastMaps.push(m); await save(doc); await point('departure-snapshot', meta.pickerId); return structuredClone(m);
    },
    list(accountId) { return structuredClone((read().pastMaps ?? []).filter(m => m.accountId === accountId)); },
    async readMap(accountId, id) {
      const m = read().pastMaps?.find(m => m.id === id && m.accountId === accountId); if (!m) fail('Past map not found.', 404);
      const bytes = await readFile(snapshotFile(m.id)); if (pastMapDigest(bytes) !== m.digest) fail('Past map needs recovery. The retained copy failed its integrity check.', 503);
      return { metadata: structuredClone(m), document: JSON.parse(bytes) };
    },
    async finish(id) {
      const doc = structuredClone(read()), d = doc.departures.find(d => d.id === id); if (!d || d.completedAt) return d;
      if (!doc.pastMaps.some(m => m.id === d.id)) fail('Freeze the Past map before publishing departure.');
      const c = character(doc, d.characterId), source = doc.pickers.find(p => p.id === d.source.pickerId), a = doc.accounts.find(a => a.id === c.accountId);
      if (JSON.stringify(c.placement) !== JSON.stringify(d.source) || source.ownerCharacterId === c.id) fail('Departure binding changed. Recovery needs review.');
      const p = { id: d.destination.pickerId, kind: 'default', ownerAccountId: a.id, ownerCharacterId: c.id, lifecycle: 'active', provisioning: 'ready',
        memberIds: ['owner'], seats: [{ memberId: 'owner', characterId: c.id }], reservations: [], createdAt: d.createdAt };
      doc.pickers.push(p); source.seats = source.seats.filter(s => s.characterId !== c.id);
      a.memberships = a.memberships.filter(m => m.pickerId !== source.id || m.memberId !== d.source.memberId);
      a.memberships.push({ pickerId: p.id, memberId: 'owner', role: 'owner' }); a.defaultPickerId ??= p.id; a.lastCharacterId = c.id;
      c.placement = structuredClone(d.destination);
      const removedCapabilities = doc.capabilities.filter(k => k.pickerId === source.id && k.memberId === d.source.memberId);
      doc.capabilities = doc.capabilities.filter(k => !removedCapabilities.includes(k));
      for (const h of doc.handovers) if (h.status === 'pending' && (h.toCharacterId === c.id || h.fromCharacterId === c.id)) { h.status = 'cancelled'; h.resolvedAt = stamp(); }
      d.completedAt = stamp(); await save(doc, removedCapabilities); await point('departure-placed', source.id); return structuredClone(d);
    },
  };
}
