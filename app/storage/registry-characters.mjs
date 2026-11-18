import { randomBytes, createHash } from 'node:crypto';
import { readFile, copyFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { writeRegistryJson, syncDirectory } from './registry-lock.mjs';
import { registryObject as object, REGISTRY_ACCOUNT, registryMembers } from './registry-legacy.mjs';

export const CHARACTER_ID = /^c_[0-9a-f]{32}$/;
export const newCharacterId = () => 'c_' + randomBytes(16).toString('hex');
export const characterError = (message, code = 'CHARACTER_CONFLICT') => Object.assign(new Error(message), { status: 409, code });
export const DELETION_PAUSED = 'Deletion affecting characters is unavailable until character deletion is supported. Your maps and access are unchanged.';
const bad = () => { throw new TypeError('Invalid character registry.'); };
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function characterName(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9 _-]{1,12}$/.test(value.trim())) throw Object.assign(new Error('Use a RuneScape name of 1–12 letters, digits, spaces, hyphens or underscores.'), { status: 400 });
  return value.trim();
}
export const normalizedCharacterName = value => value?.trim().replaceAll('_', ' ').toLowerCase();

// Called at startup and character/seat transactions, never for ordinary key or
// identity writes. The existing cap indexes retain their incremental boundary.
export function validateCharacters(document, caps) {
  if (!Array.isArray(document.characters)) bad();
  const characters = new Map(), slots = new Set(), counts = new Map();
  const accounts = new Map(document.accounts.map(a => [a.id, a]));
  const pickers = new Map(document.pickers.map(p => [p.id, p]));
  const ownerCounts = new Map();
  for (const account of document.accounts) for (const membership of account.memberships) if (membership.role === 'owner') ownerCounts.set(membership.pickerId, (ownerCounts.get(membership.pickerId) ?? 0) + 1);
  for (const character of document.characters) {
    if (!object(character, ['id', 'accountId', 'runescapeName', 'creationName', 'placement', 'lifecycle', 'createdAt', 'requestId']) || !CHARACTER_ID.test(character.id) || characters.has(character.id)
      || !REGISTRY_ACCOUNT.test(character.accountId) || !['active', 'retired'].includes(character.lifecycle) || !date(character.createdAt)
      || characterName(character.runescapeName) !== character.runescapeName || characterName(character.creationName) !== character.creationName || typeof character.requestId !== 'string' || character.requestId.length > 128) bad();
    characters.set(character.id, character);
    if (character.lifecycle !== 'active') { if (character.placement !== null) bad(); continue; }
    const account = accounts.get(character.accountId), placement = character.placement, picker = pickers.get(placement?.pickerId);
    if (!object(placement, ['pickerId', 'memberId']) || !picker || picker.lifecycle !== 'active' || !account || !picker.memberIds.includes(placement.memberId)
      || !account.memberships.some(m => m.pickerId === picker.id && m.memberId === placement.memberId && m.role !== 'viewer')) bad();
    const slot = JSON.stringify([picker.id, placement.memberId]); if (slots.has(slot)) bad(); slots.add(slot);
    counts.set(account.id, (counts.get(account.id) ?? 0) + 1);
    if (!picker.seats?.some(s => s.characterId === character.id && s.memberId === placement.memberId)) bad();
  }
  let total = slots.size;
  for (const invite of document.groupInvites ?? []) if (invite.transaction?.newCharacter) {
    total++; counts.set(invite.acceptingAccountId, (counts.get(invite.acceptingAccountId) ?? 0) + 1);
  }
  for (const account of document.accounts) {
    if (typeof account.initialProvisioned !== 'boolean' || !(account.lastCharacterId === null || CHARACTER_ID.test(account.lastCharacterId))) bad();
    if (account.pendingCreation !== null) {
      const pending = account.pendingCreation;
      if (!object(pending, ['requestId', 'characterId', 'pickerId', 'runescapeName', 'createdAt']) || !CHARACTER_ID.test(pending.characterId)
        || !/^p_[0-9a-f]{32}$/.test(pending.pickerId) || typeof pending.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(pending.requestId)
        || characterName(pending.runescapeName) !== pending.runescapeName || !date(pending.createdAt)) bad();
      if (!characters.has(pending.characterId)) { total++; counts.set(account.id, (counts.get(account.id) ?? 0) + 1); }
    }
    if ((counts.get(account.id) ?? 0) > caps.charactersPerAccount) throw characterError('The character limit for this login has been reached. Existing maps are unchanged.');
  }
  if (total > caps.characters) throw characterError('The service character limit has been reached. Existing maps are unchanged.');
  for (const picker of document.pickers) {
    if (!Array.isArray(picker.seats) || !Array.isArray(picker.reservations) || picker.seats.length + picker.reservations.length > 5) bad();
    const members = new Set(), reserved = new Set();
    for (const seat of picker.seats) {
      const character = characters.get(seat?.characterId);
      if (!object(seat, ['memberId', 'characterId']) || members.has(seat.memberId) || character?.lifecycle !== 'active'
        || character.placement.pickerId !== picker.id || character.placement.memberId !== seat.memberId) bad();
      members.add(seat.memberId);
    }
    for (const reservation of picker.reservations) {
      if (!object(reservation, ['id', 'inviteId', 'expiresAt']) || !REGISTRY_ACCOUNT.test(reservation.id) || !REGISTRY_ACCOUNT.test(reservation.inviteId)
        || !date(reservation.expiresAt) || reserved.has(reservation.id)) bad();
      reserved.add(reservation.id);
    }
    if (picker.kind === 'legacy-shared' || picker.lifecycle !== 'active') { if (picker.ownerCharacterId !== null) bad(); }
    else {
      const owner = characters.get(picker.ownerCharacterId);
      if (!owner || owner.accountId !== picker.ownerAccountId || owner.placement?.pickerId !== picker.id
        || !accounts.get(owner.accountId)?.memberships.some(m => m.pickerId === picker.id && m.memberId === owner.placement.memberId && m.role === 'owner')
        || ownerCounts.get(picker.id) !== 1) bad();
    }
  }
}

export function bindCharacter(document, account, picker, memberId, { id = newCharacterId(), runescapeName = null, requestId = 'migration', createdAt = account.createdAt } = {}) {
  const existing = document.characters.find(c => c.lifecycle === 'active' && c.placement.pickerId === picker.id && c.placement.memberId === memberId);
  if (existing) {
    if (existing.accountId !== account.id) throw characterError(`Character mapping needs review for picker ${picker.id}, member ${memberId}: conflicting login claims.`, 'CHARACTER_MAPPING_REVIEW');
    return existing;
  }
  const character = { id, accountId: account.id, runescapeName, creationName: runescapeName, placement: { pickerId: picker.id, memberId }, lifecycle: 'active', createdAt, requestId };
  document.characters.push(character); picker.seats.push({ memberId, characterId: id });
  if (account.memberships.some(m => m.pickerId === picker.id && m.memberId === memberId && m.role === 'owner')) picker.ownerCharacterId = id;
  return character;
}

// A migration report contains opaque application IDs only. Gameplay bytes and
// provider subjects remain in the local preimage, never an exception message.
export async function migrateCharacterDocuments(document, ledger, { registryDir, pickerRoot, legacyDir, point, validateV1, validateTarget }) {
  const file = path.join(registryDir, 'registry.json'), intentFile = path.join(registryDir, 'characters-migration.json');
  const ledgerFile = ledger.file;
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const read = file => readFile(file, 'utf8');
  let intent;
  try { intent = JSON.parse(await read(intentFile)); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid character migration intent.'); }
  if (intent) {
    if (intent.completed === true && document.schemaVersion === 2 && ledger.document.schemaVersion === 2) return [document, ledger.document];
    if (intent.format !== 'character-migration-v1' || !Array.isArray(intent.sources) || !Array.isArray(intent.targets)
      || intent.sources.length !== 2 || intent.targets.length !== 2) throw new Error('Invalid character migration intent.');
    for (const [index, target] of [file, ledgerFile].entries()) {
      const bytes = await read(target);
      if (hash(bytes) !== intent.sources[index] && hash(bytes) !== hash(JSON.stringify(intent.targets[index]) + '\n')) throw new Error('Character migration source changed. Review the local migration intent before recovery.');
    }
  } else {
    if (document.schemaVersion !== 1) return [document, ledger.document];
    validateV1(document);
    const next = structuredClone(document), nextLedger = structuredClone(ledger.document), conflicts = [];
    next.schemaVersion = 2; next.characters = [];
    nextLedger.schemaVersion = 2; nextLedger.issuedCharacterIds ??= []; nextLedger.characters ??= [];
    for (const account of next.accounts) Object.assign(account, { initialProvisioned: account.memberships.length > 0 || next.pickers.some(p => p.ownerAccountId === account.id), lastCharacterId: null, pendingCreation: null });
    for (const picker of next.pickers) {
      Object.assign(picker, { seats: [], reservations: [], ownerCharacterId: null });
      if (picker.lifecycle !== 'active') continue;
      const ownerClaims = next.accounts.flatMap(a => a.memberships.filter(m => m.pickerId === picker.id && m.role === 'owner').map(m => ({ accountId: a.id, memberId: m.memberId })));
      if (picker.kind !== 'legacy-shared' && ownerClaims.length !== 1) conflicts.push({ pickerId: picker.id, claims: ownerClaims, reason: 'ambiguous owner character' });
      const directory = picker.kind === 'legacy-shared' ? legacyDir : path.join(pickerRoot, picker.id);
      let roster;
      try {
        const state = JSON.parse(await read(path.join(directory, 'state.json')));
        roster = state.state?.members ?? state.members;
        if (!Array.isArray(roster)) throw new Error('Invalid saved roster.');
        registryMembers(roster.map(m => m.id));
      } catch (failure) {
        if (failure.code !== 'ENOENT') throw failure;
        // Empty/lazily initialized stores have no imported roster to preserve.
        roster = picker.memberIds.map(id => ({ id }));
      }
      for (const membership of next.accounts.flatMap(a => a.memberships.filter(m => m.pickerId === picker.id && m.role !== 'viewer'))) {
        if (!roster.some(m => m.id === membership.memberId)) conflicts.push({ pickerId: picker.id, memberId: membership.memberId, reason: 'membership absent from saved roster' });
      }
      for (const member of roster) {
        if (!picker.memberIds.includes(member.id)) { conflicts.push({ pickerId: picker.id, memberId: member.id, reason: 'saved member absent from registry' }); continue; }
        const owners = next.accounts.filter(a => a.memberships.some(m => m.pickerId === picker.id && m.memberId === member.id && m.role !== 'viewer'));
        if (owners.length !== 1) {
          if (owners.length === 0 && picker.kind === 'legacy-shared') continue;
          conflicts.push({ pickerId: picker.id, memberId: member.id, accountIds: owners.map(a => a.id), reason: owners.length ? 'conflicting claims' : 'unclaimed member' }); continue;
        }
        const character = bindCharacter(next, owners[0], picker, member.id, { runescapeName: characterName(member.runescapeName) });
        nextLedger.issuedCharacterIds.push(character.id);
      }
    }
    if (conflicts.length) {
      const sources = await Promise.all([read(file), read(ledgerFile)]);
      await writeRegistryJson(path.join(registryDir, 'characters-mapping-review.json'), {
        format: 'character-mapping-review-v1', sourceDigests: sources.map(hash), conflicts,
        proposedMappings: next.characters.map(({ id, accountId, placement }) => ({ characterId: id, accountId, ...placement })),
      });
      throw characterError('Character mapping needs review. See characters-mapping-review.json; the registry and ledger are unchanged.', 'CHARACTER_MAPPING_REVIEW');
    }
    validateTarget(next, nextLedger);
    const sources = await Promise.all([read(file), read(ledgerFile)]);
    for (const [index, source] of [file, ledgerFile].entries()) {
      const backup = path.join(registryDir, index ? 'ledger.pre-characters-v1.json' : 'registry.pre-characters-v1.json');
      try { await copyFile(source, backup, constants.COPYFILE_EXCL); }
      catch (failure) { if (failure.code !== 'EEXIST' || await read(backup) !== sources[index]) throw failure; }
      const handle = await open(backup, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    }
    await syncDirectory(registryDir); await point('migration-backed-up');
    intent = { format: 'character-migration-v1', sources: sources.map(hash), targets: [next, nextLedger] };
    await writeRegistryJson(intentFile, intent); await point('migration-intent');
  }
  // Keep the intent as a recovery receipt. Once both publications match, the
  // caller marks completion; future ordinary registry mutations are unrelated.
  validateTarget(...intent.targets);
  await writeRegistryJson(ledgerFile, intent.targets[1]); await point('migration-ledger');
  await writeRegistryJson(file, intent.targets[0]); await point('migration-registry');
  await writeRegistryJson(intentFile, { ...intent, completed: true });
  return intent.targets;
}
