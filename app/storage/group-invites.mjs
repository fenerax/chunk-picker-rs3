import { createHash, randomUUID } from 'node:crypto';
import { generateToken } from '../security/tokens.mjs';
import { newCharacterId, characterName, normalizedCharacterName } from './registry-characters.mjs';
import { departureSoloEligible, pastMapSlots, pickerHasPendingJoin } from './group-departures.mjs';

const DAY = 86400000;
const hash = secret => createHash('sha256').update(secret).digest('hex');
const fail = (message, status = 409, code) => { throw Object.assign(new Error(message), { status, code }); };
export const MOVE_UNAVAILABLE = 'This character already has a map in progress. Choose a new character, or wait until moving characters is available.';
export const GROUP_INVITE_POINTS = ['invite-backed-up', 'invite-versioned', 'invite-created', 'invite-ids', 'invite-committed', 'invite-roster-prepared', 'invite-roster', 'invite-placed'];

// Stage 3 replaces this eligibility policy only after preserving Past maps.
// Gameplay proof is separately checked inside the source picker's write queue.
export function stage2SourceEligible(document, accountId, characterId) {
  const c = document.characters.find(c => c.id === characterId && c.accountId === accountId && c.lifecycle === 'active');
  const p = document.pickers.find(p => p.id === c?.placement?.pickerId);
  return Boolean(c?.requestId === 'initial' && p?.kind === 'default' && p.lifecycle === 'active' && p.provisioning === 'ready'
    && p.ownerAccountId === accountId && p.ownerCharacterId === c.id && p.seats.length === 1 && p.seats[0].memberId === 'owner'
    && !pickerHasPendingJoin(document, p.id)
    && p.memberIds.length === 1 && !document.capabilities.some(k => k.pickerId === p.id)
    && !document.accounts.some(a => a.memberships.some(m => m.pickerId === p.id && (a.id !== accountId || m.role !== 'owner'))));
}

export function validateGroupInvites(doc) {
  if (doc.schemaVersion < 3) return;
  const bad = () => { throw new TypeError('Invalid group invitation registry.'); };
  if (!Array.isArray(doc.groupInvites) || doc.groupInvites.length > 20000) bad();
  const ids = new Set(), reservations = new Set(), allocating = new Set(), moving = new Set();
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
  for (const i of doc.groupInvites) {
    if (!i || Object.keys(i).some(k => !['id', 'secretHash', 'issuerAccountId', 'issuerCharacterId', 'pickerId', 'reservationId', 'createdAt', 'expiresAt', 'status', 'terminalAt', 'acceptingAccountId', 'acceptingCharacterId', 'transaction'].includes(k))
      || !uuid(i.id) || ids.has(i.id)
      || !(i.secretHash === null || /^[0-9a-f]{64}$/.test(i.secretHash))
      || !['pending', 'accepted', 'expired', 'revoked'].includes(i.status)
      || !Number.isFinite(Date.parse(i.createdAt)) || Date.parse(i.expiresAt) !== Date.parse(i.createdAt) + 7 * DAY
      || !doc.pickers.some(p => p.id === i.pickerId) || !uuid(i.issuerAccountId) || !/^c_[0-9a-f]{32}$/.test(i.issuerCharacterId)
      || !uuid(i.reservationId) || !(i.transaction === null || i.transaction && typeof i.transaction === 'object' && !Array.isArray(i.transaction))
      || (i.status === 'pending' ? i.terminalAt !== null : !Number.isFinite(Date.parse(i.terminalAt)))
      || (i.status !== 'accepted' && (i.acceptingAccountId !== null || i.acceptingCharacterId !== null || i.transaction !== null))) bad();
    ids.add(i.id);
    if (i.status === 'pending') {
      const p = doc.pickers.find(p => p.id === i.pickerId);
      if (reservations.has(i.reservationId) || !p.reservations.some(r => r.id === i.reservationId && r.inviteId === i.id && r.expiresAt === i.expiresAt)
        || !i.secretHash || i.transaction || i.acceptingAccountId || i.acceptingCharacterId) bad();
      reservations.add(i.reservationId);
    }
    if (i.status === 'accepted' && (!uuid(i.acceptingAccountId) || !/^c_[0-9a-f]{32}$/.test(i.acceptingCharacterId))) bad();
    if (i.transaction) {
      const t = i.transaction;
      if (i.status !== 'accepted' || Object.keys(t).some(k => !['source', 'memberId', 'runescapeName', 'newCharacter', ...(doc.schemaVersion >= 4 ? ['pastMapId'] : [])].includes(k))
        || t.pastMapId !== undefined && (t.newCharacter || t.pastMapId !== i.id)
        || !/^m_[0-9a-f]{32}$/.test(t.memberId) || typeof t.newCharacter !== 'boolean'
        || (t.newCharacter ? t.source !== null : !t.source || typeof t.source.pickerId !== 'string' || t.source.memberId !== 'owner')
        || characterName(t.runescapeName) !== t.runescapeName) bad();
      const p = doc.pickers.find(p => p.id === i.pickerId), c = doc.characters.find(c => c.id === i.acceptingCharacterId);
      if (p.lifecycle !== 'active' || p.kind !== 'default' || !doc.accounts.some(a => a.id === i.acceptingAccountId && a.initialProvisioned)
        || !p.memberIds.includes(t.memberId) || p.seats.some(s => s.memberId === t.memberId)
        || reservations.has(i.reservationId) || !p.reservations.some(r => r.id === i.reservationId && r.inviteId === i.id && r.expiresAt === i.expiresAt)
        || allocating.has(i.acceptingCharacterId) || moving.has(t.source?.pickerId)
        || (t.newCharacter ? Boolean(c) : c?.accountId !== i.acceptingAccountId || c?.lifecycle !== 'active'
          || c?.placement?.pickerId !== t.source.pickerId || c?.placement?.memberId !== t.source.memberId
          || Object.keys(t.source).some(k => !['pickerId', 'memberId'].includes(k)) || t.source.pickerId === p.id)) bad();
      reservations.add(i.reservationId); allocating.add(i.acceptingCharacterId);
      if (t.source) moving.add(t.source.pickerId);
    }
  }
  for (const p of doc.pickers) for (const r of p.reservations) if (!doc.groupInvites.some(i => (i.status === 'pending' || i.transaction) && i.id === r.inviteId && i.pickerId === p.id && i.reservationId === r.id && i.expiresAt === r.expiresAt)) bad();
}

export function createGroupInvites({ read, save, version, issueCharacter, now, caps, point, admit = async () => {} }) {
  let cursor = 0;
  const stamp = () => new Date(now()).toISOString();
  const conflict = (doc, i) => {
    const source = i?.transaction?.source?.pickerId;
    return Boolean(source && (doc.pickers.find(p => p.id === source)?.seats.length !== 1
      || doc.groupInvites.some(other => other.id !== i.id && other.transaction && other.pickerId === source)));
  };
  const authorized = (doc, i) => {
    const p = doc.pickers.find(p => p.id === i.pickerId);
    return p?.kind === 'default' && p.lifecycle === 'active' && p.provisioning === 'ready' && p.ownerAccountId === i.issuerAccountId
      && !(doc.deletions ?? []).some(d => d.groups.includes(p.id) || d.targets.some(t => t.characterId === i.issuerCharacterId))
      && p.ownerCharacterId === i.issuerCharacterId && doc.characters.some(c => c.id === i.issuerCharacterId && c.lifecycle === 'active' && c.accountId === i.issuerAccountId && c.placement.pickerId === p.id);
  };
  const state = (doc, i) => i.status !== 'pending' ? i.status : Date.parse(i.expiresAt) <= now() ? 'expired' : authorized(doc, i) ? 'pending' : 'revoked';
  const metadata = (doc, i) => ({ id: i.id, pickerId: i.pickerId, playerCount: doc.pickers.find(p => p.id === i.pickerId)?.seats.length ?? 0, status: state(doc, i), createdAt: i.createdAt, expiresAt: i.expiresAt,
    acceptingCharacterId: i.acceptingCharacterId, joining: Boolean(i.transaction) });
  function terminal(doc, i, status) {
    i.status = status; i.terminalAt = status === 'expired' ? i.expiresAt : stamp();
    const p = doc.pickers.find(p => p.id === i.pickerId);
    p.reservations = p.reservations.filter(r => r.inviteId !== i.id);
  }
  function cleanup(doc, pickerId) {
    const rows = doc.groupInvites ?? [];
    const visit = new Set(rows.filter(i => i.pickerId === pickerId && i.status === 'pending'));
    for (let n = 0; n < Math.min(16, rows.length); n++) visit.add(rows[(cursor++ % rows.length)]);
    for (const i of visit) if (i.status === 'pending' && state(doc, i) !== 'pending') terminal(doc, i, state(doc, i));
    doc.groupInvites = rows.filter(i => !visit.has(i) || i.status === 'pending' || i.transaction || now() - Date.parse(i.terminalAt) < 30 * DAY);
  }
  function owner(doc, accountId, pickerId) {
    const p = doc.pickers.find(p => p.id === pickerId);
    if (!p || !authorized(doc, { pickerId, issuerAccountId: accountId, issuerCharacterId: p.ownerCharacterId })) fail('Only the current group owner can manage player invitations.', 403);
    return p;
  }
  function bySecret(doc, secret) {
    if (typeof secret !== 'string' || !/^gin_[A-Za-z0-9_-]{43}$/.test(secret)) fail('This player invite is unavailable.');
    const i = doc.groupInvites?.find(i => i.secretHash === hash(secret));
    if (!i) fail('This player invite is unavailable.');
    return i;
  }
  return {
    resumeVersion: version,
    list(accountId, pickerId) { const doc = read(); owner(doc, accountId, pickerId); return (doc.groupInvites ?? []).filter(i => i.pickerId === pickerId).map(i => metadata(doc, i)); },
    preview(secret) { const doc = read(), i = bySecret(doc, secret); return metadata(doc, i); },
    eligible(accountId, characterId) { return stage2SourceEligible(read(), accountId, characterId) || departureSoloEligible(read(), accountId, characterId); },
    transactions() { return structuredClone((read().groupInvites ?? []).filter(i => i.transaction)); },
    conflict(id) { const doc = read(); return conflict(doc, doc.groupInvites?.find(i => i.id === id)); },
    async cancelConflict(id) {
      const doc = structuredClone(read()), i = doc.groupInvites.find(i => i.id === id);
      if (!conflict(doc, i)) fail('The invitation no longer has an admission conflict. Retry recovery.');
      // The invalid outgoing move never acquired placement. Keep its issued
      // member ID and frozen files, release its reservation, and retain a
      // terminal consumed invitation instead of inventing an owner successor.
      terminal(doc, i, 'revoked'); i.transaction = null; i.acceptingAccountId = null; i.acceptingCharacterId = null;
      await save(doc); await point('invite-conflict-cancelled', i.pickerId);
    },
    async create(accountId, pickerId, replaceId) {
      if ((read().deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === pickerId))) fail('Deletion is completing. Retry after recovery.');
      owner(read(), accountId, pickerId);
      await version();
      const doc = structuredClone(read()), p = owner(doc, accountId, pickerId);
      cleanup(doc, pickerId);
      if (replaceId) {
        const old = doc.groupInvites.find(i => i.id === replaceId && i.pickerId === pickerId && i.status === 'pending');
        if (!old) fail('Only a pending invitation can be replaced.');
        terminal(doc, old, 'revoked');
      }
      if (p.seats.length + p.reservations.length >= 5) fail('This group has no vacant player seats.');
      const live = doc.groupInvites.filter(i => state(doc, i) === 'pending');
      if (doc.groupInvites.length >= 20000 || live.length >= 10000 || live.filter(i => i.issuerAccountId === accountId).length >= 40) fail('The invitation limit has been reached. Wait for old invitations to expire.');
      const secret = 'gin_' + generateToken(); let id; do { id = randomUUID(); } while (doc.groupInvites.some(i => i.id === id) || (doc.departures ?? []).some(d => d.id === id) || (doc.pastMaps ?? []).some(m => m.id === id));
      const reservationId = randomUUID(), createdAt = stamp(), expiresAt = new Date(Date.parse(createdAt) + 7 * DAY).toISOString();
      p.reservations.push({ id: reservationId, inviteId: id, expiresAt });
      const i = { id, secretHash: hash(secret), issuerAccountId: accountId, issuerCharacterId: p.ownerCharacterId, pickerId, reservationId,
        createdAt, expiresAt, status: 'pending', terminalAt: null, acceptingAccountId: null, acceptingCharacterId: null, transaction: null };
      doc.groupInvites.push(i); await save(doc); await point('invite-created', pickerId);
      return { ...metadata(doc, i), secret };
    },
    async revoke(accountId, pickerId, id) {
      const doc = structuredClone(read()); owner(doc, accountId, pickerId);
      const i = doc.groupInvites?.find(i => i.id === id && i.pickerId === pickerId);
      if (!i) fail('Invitation not found.', 404);
      if (i.status === 'pending') terminal(doc, i, state(doc, i) === 'expired' ? 'expired' : 'revoked');
      await save(doc); return metadata(doc, i);
    },
    async begin(secret, accountId, { characterId, runescapeName = null, acknowledgeDuplicate = false } = {}) {
      let doc = structuredClone(read()), i = bySecret(doc, secret);
      if ((doc.deletions ?? []).some(d => !d.completedAt && (d.targets.some(t => t.pickerId === i.pickerId || t.characterId === characterId) || d.kind === 'account' && d.accountId === accountId))) fail('Deletion is completing. Retry after recovery.');
      if (i.status === 'accepted') {
        if (i.acceptingAccountId !== accountId || (characterId && characterId !== i.acceptingCharacterId) || (!characterId && !i.transaction?.newCharacter && read().characters.find(c => c.id === i.acceptingCharacterId)?.requestId !== `invite:${i.id}`)) fail('This invitation has already been accepted by another character.');
        return structuredClone(i);
      }
      const status = state(doc, i);
      if (status !== 'pending') { if (i.status === 'pending') { terminal(doc, i, status); await save(doc); } fail(`This player invite is ${status}.`); }
      if ((doc.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(i.pickerId))) fail('A departure is completing. Retry this invitation after recovery.');
      if (doc.groupInvites.some(other => other.transaction?.source?.pickerId === i.pickerId)) fail('This group is completing an outgoing move. Retry this invitation after recovery.');
      const account = doc.accounts.find(a => a.id === accountId);
      if (!account?.initialProvisioned || account.pendingCreation) fail('Finish first sign-in or character creation before joining.');
      const own = doc.characters.filter(c => c.accountId === accountId && c.lifecycle === 'active');
      let c;
      if (characterId) {
        if (!stage2SourceEligible(doc, accountId, characterId) && !departureSoloEligible(doc, accountId, characterId)) fail(MOVE_UNAVAILABLE);
        if (departureSoloEligible(doc, accountId, characterId) && pastMapSlots(doc) >= 20000) fail('The retained map record limit has been reached. Your solo remains available.');
        c = own.find(c => c.id === characterId);
      } else {
        runescapeName = characterName(runescapeName);
        if (runescapeName && !acknowledgeDuplicate && own.some(c => normalizedCharacterName(c.runescapeName) === normalizedCharacterName(runescapeName))) fail('This login already has a character with that name. Confirm a separate character.', 409, 'DUPLICATE_CHARACTER_NAME');
        const allocating = doc.groupInvites.filter(i => i.transaction?.newCharacter);
        if (own.length + allocating.filter(i => i.acceptingAccountId === accountId).length >= caps.charactersPerAccount
          || doc.characters.filter(c => c.lifecycle === 'active').length + doc.accounts.filter(a => a.pendingCreation).length + allocating.length >= caps.characters) fail('The character limit has been reached. Existing maps are unchanged.');
        if (account.memberships.length >= caps.membershipsPerAccount) fail('The account membership record limit has been reached.');
        c = { id: newCharacterId(), runescapeName };
      }
      const p = doc.pickers.find(p => p.id === i.pickerId);
      if (p.memberIds.length >= caps.membersPerPicker || p.seats.length + p.reservations.length > 5) fail('The group seat or member record limit has been reached.');
      const rejoining = characterId && departureSoloEligible(doc, accountId, characterId);
      i.status = 'accepted'; i.terminalAt = stamp(); i.acceptingAccountId = accountId; i.acceptingCharacterId = c.id;
      i.transaction = { source: characterId ? c.placement : null, newCharacter: !characterId, memberId: 'm_' + randomUUID().replaceAll('-', ''), runescapeName: c.runescapeName };
      if (rejoining) i.transaction.pastMapId = i.id;
      p.memberIds.push(i.transaction.memberId);
      await admit(doc);
      // Refuse storage admission before consuming irreversible character IDs.
      if (!characterId) { await issueCharacter(c.id); await point('invite-ids', p.id); }
      // Reservation is held until placement is ready; accepted transactions are
      // also counted against capacity. It still has no playable map or character.
      await save(doc); await point('invite-committed', p.id); return structuredClone(i);
    },
    async finish(id) {
      const doc = structuredClone(read()), i = doc.groupInvites.find(i => i.id === id);
      if (!i?.transaction) return i;
      if (conflict(doc, i)) fail('A prior admission won this source group. Recover the conflicting invitation first.');
      const t = i.transaction, p = doc.pickers.find(p => p.id === i.pickerId), a = doc.accounts.find(a => a.id === i.acceptingAccountId);
      let c = doc.characters.find(c => c.id === i.acceptingCharacterId);
      if (t.newCharacter) {
        c = { id: i.acceptingCharacterId, accountId: a.id, runescapeName: t.runescapeName, creationName: t.runescapeName,
          placement: null, lifecycle: 'active', createdAt: i.terminalAt, requestId: `invite:${i.id}` }; doc.characters.push(c);
      } else {
        if (c?.placement.pickerId !== t.source.pickerId || c.placement.memberId !== t.source.memberId) fail('The source placement changed. Recovery needs review.');
        const source = doc.pickers.find(p => p.id === t.source.pickerId);
        source.lifecycle = 'retired'; source.ownerCharacterId = null; source.seats = [];
        for (const other of doc.groupInvites) if (other.pickerId === source.id && other.status === 'pending') terminal(doc, other, 'revoked');
        a.memberships = a.memberships.filter(m => m.pickerId !== source.id);
        if (a.defaultPickerId === source.id) a.defaultPickerId = null;
        doc.capabilities = doc.capabilities.filter(k => k.pickerId !== source.id || k.memberId !== t.source.memberId);
      }
      c.placement = { pickerId: p.id, memberId: t.memberId };
      p.reservations = p.reservations.filter(r => r.inviteId !== i.id); p.seats.push({ memberId: t.memberId, characterId: c.id });
      a.memberships.push({ pickerId: p.id, memberId: t.memberId, role: 'player' }); a.lastCharacterId = c.id;
      i.transaction = null; cleanup(doc, p.id);
      await save(doc); await point('invite-placed', p.id); return structuredClone(i);
    },
    async clean() { if (read().schemaVersion < 3) return; const doc = structuredClone(read()); cleanup(doc); await save(doc); },
  };
}
