import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { generateToken } from '../security/tokens.mjs';
import path from 'node:path';
import { durableDirectory, lockRegistry, syncDirectory, writeRegistryJson } from './registry-lock.mjs';
import { REGISTRY_ACCOUNT, registryIdentity, registryMembers, registryObject as object } from './registry-legacy.mjs';
import { createRegistryCaps } from './registry-caps.mjs';
import { CHARACTER_ID, newCharacterId, bindCharacter, validateCharacters, migrateCharacterDocuments, characterName, normalizedCharacterName, characterError } from './registry-characters.mjs';
import { createGroupInvites, validateGroupInvites } from './group-invites.mjs';

const PICKER = /^p_[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const roles = ['owner', 'player', 'viewer'];
const kinds = ['plugin-key', 'overlay-capability'];
const error = (status, message) => Object.assign(new Error(message), { status });
const copy = value => value == null ? null : structuredClone(value);
const identityKey = (provider, subject) => JSON.stringify([provider, subject]);
const capabilityKey = (kind, hash) => JSON.stringify([kind, hash]);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bad = () => { throw new TypeError('Invalid registry document.'); };
export const DEFAULT_REGISTRY_CAPS = Object.freeze({ accounts: 3000, pickers: 3500, issuedPickerIds: 1000000,
  retiredAccounts: 1000000, membershipsPerAccount: 1000, membersPerPicker: 100, capabilities: 20000, capabilitiesPerPicker: 100,
  characters: 3000, charactersPerAccount: 10, issuedCharacterIds: 1000000, retiredCharacters: 1000000 });
export const REGISTRY_PROVISION_POINTS = Object.freeze(['account-recorded', 'id-reserved', 'registry-reserved', 'directory-created', 'directory-synced', 'registry-ready']);

function validateLedger(ledger) {
  if (ledger?.schemaVersion > 2) throw new Error('Unsupported newer registry ledger version. Use a compatible release.');
  if (!object(ledger, ['schemaVersion', 'issuedPickerIds', 'pickers', 'accounts', ...(ledger?.schemaVersion === 2 ? ['issuedCharacterIds', 'characters'] : [])]) || ![1, 2].includes(ledger.schemaVersion) || !Array.isArray(ledger.issuedPickerIds) || !Array.isArray(ledger.pickers) || !Array.isArray(ledger.accounts)) bad();
  if (ledger.schemaVersion === 2 && (!Array.isArray(ledger.issuedCharacterIds) || ledger.issuedCharacterIds.some(id => !CHARACTER_ID.test(id)) || new Set(ledger.issuedCharacterIds).size !== ledger.issuedCharacterIds.length || !Array.isArray(ledger.characters) || ledger.characters.length)) bad();
  const issued = new Set(), deleted = new Set(), accounts = new Set();
  for (const id of ledger.issuedPickerIds) { if (typeof id !== 'string' || !PICKER.test(id) || issued.has(id)) bad(); issued.add(id); }
  for (const entry of ledger.pickers) {
    if (!object(entry, ['pickerId', 'lifecycle', 'deletingAt', 'deletedAt', 'purgeProgress']) || !issued.has(entry.pickerId) || deleted.has(entry.pickerId) || !['deleting', 'deleted'].includes(entry.lifecycle) || !date(entry.deletingAt) || (entry.lifecycle === 'deleted' ? !date(entry.deletedAt) : entry.deletedAt !== null)) bad();
    if (entry.purgeProgress !== undefined && !['revoked', 'drained', 'directory-removed', 'binding-removed', 'complete'].includes(entry.purgeProgress)) bad();
    deleted.add(entry.pickerId);
  }
  for (const entry of ledger.accounts) {
    if (!object(entry, ['accountId', 'deletedAt', 'purgeProgress']) || !REGISTRY_ACCOUNT.test(entry.accountId) || accounts.has(entry.accountId) || !date(entry.deletedAt)) bad();
    if (entry.purgeProgress !== undefined && !['pending', 'complete'].includes(entry.purgeProgress)) bad();
    accounts.add(entry.accountId);
  }
  return ledger;
}

function validate(document, selection) {
  if (document?.schemaVersion > 3) throw new Error('Unsupported newer registry version. Use a compatible release.');
  const v2 = document?.schemaVersion >= 2;
  if (!object(document, ['schemaVersion', 'accounts', 'pickers', 'capabilities', 'relinkCodes', 'relinkRetirements', ...(v2 ? ['characters'] : []), ...(document?.schemaVersion === 3 ? ['groupInvites'] : [])]) || ![1, 2, 3].includes(document.schemaVersion) || !Array.isArray(document.accounts) || !Array.isArray(document.pickers) || !Array.isArray(document.capabilities)) bad();
  if (document.relinkCodes !== undefined && (!selection || selection.relinkCodes)) {
    if (!Array.isArray(document.relinkCodes)) bad();
    const seen = new Set();
    for (const entry of document.relinkCodes) {
      if (!object(entry, ['accountId', 'hash', 'expiresAt']) || !REGISTRY_ACCOUNT.test(entry.accountId) || !HASH.test(entry.hash) || !date(entry.expiresAt) || seen.has(entry.accountId)) bad();
      seen.add(entry.accountId);
    }
  }
  if (document.relinkRetirements !== undefined && (!selection || selection.relinkRetirements) && (!Array.isArray(document.relinkRetirements) || document.relinkRetirements.some(id => !REGISTRY_ACCOUNT.test(id)) || new Set(document.relinkRetirements).size !== document.relinkRetirements.length)) bad();
  const accounts = new Map(), pickers = new Map(), identities = new Set(), defaults = new Set();
  const accountRows = selection?.accounts ?? document.accounts, pickerRows = selection?.pickers ?? document.pickers;
  const accountFor = id => accounts.has(id) ? accounts.get(id) : selection?.account(id);
  const pickerFor = id => pickers.get(id) ?? selection?.picker(id);
  let legacy = 0;
  for (const picker of pickerRows) {
    if (!object(picker, ['id', 'kind', 'ownerAccountId', 'lifecycle', 'provisioning', 'memberIds', 'createdAt', ...(v2 ? ['seats', 'reservations', 'ownerCharacterId'] : [])]) || !PICKER.test(picker.id) || pickers.has(picker.id) || !['default', 'legacy-shared'].includes(picker.kind) || !['active', 'deleting', 'deleted', ...(document.schemaVersion === 3 ? ['retired'] : [])].includes(picker.lifecycle) || !['reserved', 'ready'].includes(picker.provisioning) || !date(picker.createdAt)) bad();
    registryMembers(picker.memberIds);
    if (picker.kind === 'legacy-shared') { if (++legacy > 1 || picker.ownerAccountId !== null || picker.provisioning !== 'ready' || picker.memberIds.length !== 2) bad(); }
    else if (!REGISTRY_ACCOUNT.test(picker.ownerAccountId)) bad();
    pickers.set(picker.id, picker);
  }
  for (const account of accountRows) {
    if (selection && account.deleted) { accounts.set(account.id, null); continue; }
    if (!object(account, ['id', 'identities', 'memberships', 'defaultPickerId', 'createdAt', ...(v2 ? ['initialProvisioned', 'lastCharacterId', 'pendingCreation'] : [])]) || !REGISTRY_ACCOUNT.test(account.id) || accounts.has(account.id) || !Array.isArray(account.identities) || account.identities.length > 2 || !Array.isArray(account.memberships) || !date(account.createdAt)) bad();
    accounts.set(account.id, account);
    const providers = new Set(), memberships = new Set();
    for (const identity of account.identities) {
      if (!object(identity, ['provider', 'subject'])) bad();
      registryIdentity(identity.provider, identity.subject);
      const key = identityKey(identity.provider, identity.subject);
      if (identities.has(key) || providers.has(identity.provider)) bad();
      const other = selection?.identity(key);
      if (other && other !== account.id && !accountRows.some(a => a.id === other && (a.deleted || !a.identities.some(i => identityKey(i.provider, i.subject) === key)))) bad();
      identities.add(key); providers.add(identity.provider);
    }
    for (const membership of account.memberships) {
      const picker = pickerFor(membership?.pickerId);
      const key = JSON.stringify([membership?.pickerId, membership?.memberId]);
      if (!object(membership, ['pickerId', 'role', 'memberId']) || !picker || picker.lifecycle !== 'active' || !roles.includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !picker.memberIds.includes(membership.memberId)) || memberships.has(key) || (membership.role === 'owner' && (picker.kind !== 'default' || picker.ownerAccountId !== account.id))) bad();
      memberships.add(key);
    }
    if (account.defaultPickerId !== null) {
      const picker = pickerFor(account.defaultPickerId);
      if (!picker || picker.kind !== 'default' || picker.ownerAccountId !== account.id || picker.lifecycle === 'deleted' || defaults.has(picker.id)) bad();
      defaults.add(picker.id);
    }
  }
  // Account edits must also preserve their existing owned picker invariant.
  if (selection) for (const account of accountRows) {
    for (const id of [selection.account(account.id)?.defaultPickerId, account.defaultPickerId]) {
      const picker = pickerFor(id); if (picker) pickers.set(id, picker);
    }
  }
  for (const picker of pickers.values()) {
    if (picker.kind === 'default' && picker.lifecycle === 'active') {
      const account = accountFor(picker.ownerAccountId);
      if (!account || !v2 && account.defaultPickerId !== picker.id || !account.memberships.some(m => m.pickerId === picker.id && m.role === 'owner')) bad();
    }
  }
  const capabilities = new Set();
  for (const capability of selection?.addedCapabilities ?? document.capabilities) {
    const account = accountFor(capability?.accountId), picker = pickerFor(capability?.pickerId);
    const key = capabilityKey(capability?.kind, capability?.hash);
    if (!object(capability, ['kind', 'hash', 'pickerId', 'accountId', 'memberId']) || !kinds.includes(capability.kind) || typeof capability.hash !== 'string' || !HASH.test(capability.hash) || capabilities.has(key) || !picker || picker.lifecycle !== 'active' || picker.provisioning !== 'ready' || !account?.memberships.some(m => m.pickerId === picker.id && m.memberId === capability.memberId && (capability.kind !== 'plugin-key' || m.role !== 'viewer'))) bad();
    capabilities.add(key);
  }
  return document;
}

function reconcile(document, ledger, changes = { accounts: [], pickers: [], removedCapabilities: [] }) {
  const next = copy(document), blocked = new Map(ledger.pickers.map(entry => [entry.pickerId, entry]));
  const deletedAccounts = new Set(ledger.accounts.map(entry => entry.accountId));
  next.accounts = next.accounts.filter(account => {
    if (!deletedAccounts.has(account.id)) return true;
    changes.accounts.push({ id: account.id, deleted: true }); return false;
  });
  for (const picker of next.pickers) {
    const tombstone = blocked.get(picker.id);
    if (tombstone && picker.lifecycle !== tombstone.lifecycle) { picker.lifecycle = tombstone.lifecycle; changes.pickers.push(picker); }
  }
  for (const account of next.accounts) {
    const length = account.memberships.length, previousDefault = account.defaultPickerId;
    account.memberships = account.memberships.filter(m => !blocked.has(m.pickerId));
    if (blocked.get(account.defaultPickerId)?.lifecycle === 'deleted') account.defaultPickerId = null;
    if (account.memberships.length !== length || account.defaultPickerId !== previousDefault) changes.accounts.push(account);
  }
  next.capabilities = next.capabilities.filter(c => {
    if (!blocked.has(c.pickerId) && !deletedAccounts.has(c.accountId)) return true;
    changes.removedCapabilities.push(c); return false;
  });
  if (next.characters) for (const character of next.characters) if (character.lifecycle === 'active' && (blocked.has(character.placement.pickerId) || deletedAccounts.has(character.accountId))) {
    character.lifecycle = 'retired'; character.placement = null; changes.characters = true;
  }
  if (changes.characters) for (const picker of next.pickers) {
    const seats = picker.seats.filter(s => next.characters.some(c => c.id === s.characterId && c.lifecycle === 'active'));
    if (seats.length !== picker.seats.length) { picker.seats = seats; if (blocked.has(picker.id)) picker.ownerCharacterId = null; if (!changes.pickers.includes(picker)) changes.pickers.push(picker); }
  }
  return next;
}

function separate(a, b) {
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  return !inside(a, b) && !inside(b, a);
}
async function load(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (failure) { if (failure.code === 'ENOENT') return undefined; throw new Error('Invalid registry document.'); }
}

/** Operator paths only. No HTTP, gameplay state, sign-in, or store is opened here. */
export async function openRegistry({ registryDir, pickerRoot, tombstoneDir, legacyDir, caps: overrides = {}, now = Date.now,
  crashPoint, pickerRandomBytes = randomBytes, betaPickerCap, onCapCheck, recoveryOnly = false } = {}) {
  if (typeof recoveryOnly !== 'boolean') throw new TypeError('Invalid registry recovery mode.');
  if ([registryDir, pickerRoot, tombstoneDir].some(dir => typeof dir !== 'string' || !dir)) throw new TypeError('Registry, picker and tombstone roots are required.');
  const caps = { ...DEFAULT_REGISTRY_CAPS, ...overrides };
  if (!object(overrides, Object.keys(DEFAULT_REGISTRY_CAPS)) || Object.values(caps).some(n => !Number.isSafeInteger(n) || n < 1)) throw new TypeError('Invalid registry caps.');
  if (betaPickerCap !== undefined && (!Number.isSafeInteger(betaPickerCap) || betaPickerCap < 1)) throw new TypeError('betaPickerCap must be a positive integer when set.');
  let roots = [registryDir, pickerRoot, tombstoneDir].map(dir => path.resolve(dir));
  const checkRoots = () => { if (roots.some((dir, i) => roots.slice(i + 1).some(other => !separate(dir, other)))) throw new TypeError('Registry, picker and tombstone roots must be disjoint.'); };
  checkRoots();
  for (const dir of roots) await durableDirectory(dir);
  roots = await Promise.all(roots.map(dir => realpath(dir))); checkRoots();
  [registryDir, pickerRoot, tombstoneDir] = roots;
  if (legacyDir !== undefined) {
    legacyDir = await realpath(legacyDir);
    if (!(await lstat(legacyDir)).isDirectory() || roots.some(dir => !separate(dir, legacyDir))) throw new TypeError('Legacy directory must be separate from registry roots.');
  }
  const releases = [];
  let current, ledger, queue = Promise.resolve(), closed = false, failed = false, closing;
  let providerIndex, capabilityIndex, accountIndex, pickerIndex, memberAccounts, tombstoneIndex, retiredAccounts, issuedIds, capCounts, characterIndex;
  const file = path.join(registryDir, 'registry.json'), ledgerFile = path.join(tombstoneDir, 'ledger.json');
  const timestamp = () => new Date(now()).toISOString();
  const usable = () => { if (closed || failed) throw new Error('Registry is closed or requires restart.'); };
  const rebuildIndexes = () => {
    accountIndex = new Map(current.accounts.map(a => [a.id, a]));
    pickerIndex = new Map(current.pickers.map(p => [p.id, p]));
    providerIndex = new Map(current.accounts.flatMap(a => a.identities.map(i => [identityKey(i.provider, i.subject), a.id])));
    capabilityIndex = new Map(current.capabilities.map(c => [capabilityKey(c.kind, c.hash), c]));
    memberAccounts = new Map();
    characterIndex = new Map((current.characters ?? []).map(c => [c.id, c]));
    for (const account of current.accounts) indexMemberships(account, true);
  };
  function indexMemberships(account, add) {
    for (const membership of account?.memberships ?? []) {
      const key = JSON.stringify([membership.pickerId, membership.memberId]);
      if (add) {
        if (!memberAccounts.has(key)) memberAccounts.set(key, new Set());
        memberAccounts.get(key).add(account.id);
      } else {
        const accounts = memberAccounts.get(key); accounts?.delete(account.id);
        if (!accounts?.size) memberAccounts.delete(key);
      }
    }
  }
  const rebuildLedgerIndexes = () => {
    tombstoneIndex = new Map(ledger.pickers.map(t => [t.pickerId, t]));
    retiredAccounts = new Set(ledger.accounts.map(t => t.accountId));
    issuedIds = new Set(ledger.issuedPickerIds);
  };
  function enforceCaps(next, nextLedger = ledger, changes = {}) {
    return capCounts.prepare(next, nextLedger, changes);
  }
  async function save(next, changes = {}) {
    const accountRows = changes.accounts ?? [], pickerRows = changes.pickers ?? [];
    validate(next, { ...changes, accounts: accountRows, pickers: pickerRows, addedCapabilities: changes.addedCapabilities ?? [],
      account: id => accountIndex.get(id), picker: id => pickerIndex.get(id), identity: key => providerIndex.get(key) });
    if (changes.characters) validateCharacters(next, caps);
    validateGroupInvites(next);
    const commitCounts = enforceCaps(next, ledger, changes);
    try {
      await writeRegistryJson(file, next); current = next; commitCounts();
      for (const account of accountRows) {
        indexMemberships(accountIndex.get(account.id), false);
        for (const identity of accountIndex.get(account.id)?.identities ?? []) {
          const key = identityKey(identity.provider, identity.subject); if (providerIndex.get(key) === account.id) providerIndex.delete(key);
        }
        if (account.deleted) accountIndex.delete(account.id); else accountIndex.set(account.id, account);
      }
      for (const account of accountRows) if (!account.deleted) {
        indexMemberships(account, true);
        for (const identity of account.identities) providerIndex.set(identityKey(identity.provider, identity.subject), account.id);
      }
      for (const picker of pickerRows) pickerIndex.set(picker.id, picker);
      for (const capability of changes.removedCapabilities ?? []) capabilityIndex.delete(capabilityKey(capability.kind, capability.hash));
      for (const capability of changes.addedCapabilities ?? []) capabilityIndex.set(capabilityKey(capability.kind, capability.hash), capability);
      if (changes.characters) characterIndex = new Map(current.characters.map(c => [c.id, c]));
    } catch (failure) { failed = true; throw failure; }
  }
  async function saveLedger(next) {
    validateLedger(next); enforceCaps(current, next);
    if ((next.issuedCharacterIds?.length ?? 0) > caps.issuedCharacterIds || (next.characters?.length ?? 0) > caps.retiredCharacters) throw characterError('The character ID history limit has been reached. Existing IDs cannot be reused.');
    try { await writeRegistryJson(ledgerFile, next); ledger = next; rebuildLedgerIndexes(); }
    catch (failure) { failed = true; throw failure; }
  }
  async function saveCharacterBindings(next, changes) {
    validateCharacters(next, caps);
    enforceCaps(next, ledger, changes);
    const missing = next.characters.filter(c => !ledger.issuedCharacterIds.includes(c.id));
    if (missing.length) { const nextLedger = copy(ledger); nextLedger.issuedCharacterIds.push(...missing.map(c => c.id)); await saveLedger(nextLedger); }
    await save(next, { ...changes, characters: true });
  }
  async function point(name, pickerId) {
    try { await crashPoint?.(name, { pickerId }); }
    catch (failure) { failed = true; throw failure; }
  }
  function enqueue(operation) {
    try { usable(); } catch (failure) { return Promise.reject(failure); }
    const pending = queue.then(async () => { if (failed) throw new Error('Registry requires restart.'); return copy(await operation()); });
    queue = pending.catch(() => {}); return pending;
  }
  const requireAccount = (next, id) => { const account = next.accounts.find(a => a.id === id); if (!account) throw error(404, 'Account not found.'); return account; };
  const requirePicker = (next, id) => { const picker = next.pickers.find(p => p.id === id); if (!picker) throw error(404, 'Picker not found.'); return picker; };
  const activePicker = (next, id) => {
    const picker = requirePicker(next, id);
    if (picker.lifecycle !== 'active' || tombstoneIndex.has(id)) throw error(409, 'Picker is unavailable.');
    return picker;
  };
  function accountForIdentity(next, provider, subject) { return next.accounts.find(a => a.identities.some(i => i.provider === provider && i.subject === subject)); }
  function addIdentity(next, account, provider, subject) {
    registryIdentity(provider, subject);
    const owner = accountForIdentity(next, provider, subject), existing = account.identities.find(i => i.provider === provider);
    if (owner && owner.id !== account.id || existing && existing.subject !== subject) throw error(409, 'Sign-in identity is already assigned.');
    if (!existing) account.identities.push({ provider, subject });
  }
  function ensureIdentity(next, provider, subject) {
    registryIdentity(provider, subject);
    let account = accountForIdentity(next, provider, subject);
    if (!account) {
      if (next.accounts.length >= caps.accounts) throw error(409, 'The login account limit has been reached. Ask the operator about available capacity.');
      let id;
      do { id = randomUUID(); } while (next.accounts.some(a => a.id === id) || retiredAccounts.has(id));
      account = { id, identities: [{ provider, subject }], memberships: [], defaultPickerId: null, createdAt: timestamp(), initialProvisioned: false, lastCharacterId: null, pendingCreation: null };
      next.accounts.push(account);
    }
    return account;
  }
  function checkPickerAllocation() {
    const count = capCounts.activePickers;
    if (count >= caps.pickers) throw error(409, 'The picker limit has been reached. Existing maps are unchanged. Ask the operator about available capacity.');
    // Admission only: a lowered beta cap must not block reads, recovery or deletion.
    if (betaPickerCap !== undefined && count >= betaPickerCap) throw error(409, 'The beta is full. New groups are paused; existing maps are unchanged. Ask the operator about the next opening.');
    if (ledger.issuedPickerIds.length >= caps.issuedPickerIds) throw error(409, 'The picker ID limit has been reached. Ask the operator for help; existing IDs cannot be reused.');
  }
  async function allocate(reserve = true) {
    checkPickerAllocation();
    for (let attempt = 0; attempt < 128; attempt++) {
      const bits = pickerRandomBytes(16);
      if (!Buffer.isBuffer(bits) || bits.length !== 16) throw new TypeError('Expected 128 random bits.');
      const id = 'p_' + bits.toString('hex');
      if (issuedIds.has(id)) continue;
      // Neither an unregistered directory nor an orphan binding can be adopted.
      let occupied = false;
      for (const target of [path.join(pickerRoot, id), path.join(pickerRoot, id) + '.dataset.json']) {
        try { await lstat(target); occupied = true; break; } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      }
      if (occupied) continue;
      if (reserve) {
        const next = copy(ledger); next.issuedPickerIds.push(id); await saveLedger(next);
        await point('id-reserved', id);
      }
      return id;
    }
    throw error(409, 'Could not allocate an unused picker ID.');
  }
  async function provision(id) {
    const picker = activePicker(current, id);
    if (picker.provisioning === 'ready') return picker;
    const directory = path.join(pickerRoot, id);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe picker directory.');
    await point('directory-created', id);
    await syncDirectory(directory); await syncDirectory(pickerRoot);
    await point('directory-synced', id);
    const next = copy(current), changed = requirePicker(next, id); changed.provisioning = 'ready'; await save(next, { pickers: [changed] });
    await point('registry-ready', id); return requirePicker(current, id);
  }
  async function ensureDefault(accountId) {
    const account = requireAccount(current, accountId);
    if (account.pendingCreation) return (await createCharacter(accountId, { ...account.pendingCreation, acknowledgeDuplicate: true })).picker;
    if (account.defaultPickerId) return provision(account.defaultPickerId);
    if (account.initialProvisioned) return null;
    return (await createCharacter(accountId, { requestId: 'initial' })).picker;
  }
  async function createCharacter(accountId, { requestId, runescapeName = null, acknowledgeDuplicate = false } = {}) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw error(400, 'A character creation request ID is required.');
    runescapeName = characterName(runescapeName);
    let account = requireAccount(current, accountId);
    const receipt = current.characters.find(c => c.accountId === accountId && c.requestId === requestId);
    if (receipt && !account.pendingCreation) {
      if (receipt.creationName !== runescapeName) throw characterError('This creation request was already used with a different name.');
      return { account, character: receipt, picker: receipt.placement ? await provision(receipt.placement.pickerId) : null };
    }
    if (account.pendingCreation && (account.pendingCreation.requestId !== requestId || account.pendingCreation.runescapeName !== runescapeName)) throw characterError('Another character is still being created. Retry that request first.');
    if (!account.pendingCreation) {
      const own = current.characters.filter(c => c.accountId === accountId && c.lifecycle === 'active');
      if (runescapeName && !acknowledgeDuplicate && own.some(c => normalizedCharacterName(c.runescapeName) === normalizedCharacterName(runescapeName))) throw characterError('This login already has a character with that RuneScape name. Confirm that you want a separate character and map.', 'DUPLICATE_CHARACTER_NAME');
      if (own.length >= caps.charactersPerAccount || current.characters.filter(c => c.lifecycle === 'active').length + current.accounts.filter(a => a.pendingCreation && !current.characters.some(c => c.id === a.pendingCreation.characterId)).length >= caps.characters) throw characterError('The character limit has been reached. Existing maps are unchanged.');
      if (account.memberships.length >= caps.membershipsPerAccount) throw error(409, 'The account membership record limit has been reached.');
      if (ledger.issuedCharacterIds.length >= caps.issuedCharacterIds) throw characterError('The character ID history limit has been reached.');
      const pickerId = await allocate(false);
      let characterId; do { characterId = newCharacterId(); } while (ledger.issuedCharacterIds.includes(characterId));
      const next = copy(current), owner = requireAccount(next, accountId);
      owner.pendingCreation = { requestId, pickerId, characterId, runescapeName, createdAt: timestamp() };
      await save(next, { accounts: [owner], characters: true }); await point('account-recorded', pickerId);
    }
    account = requireAccount(current, accountId);
    const pending = account.pendingCreation, id = pending.pickerId;
    if (!ledger.issuedPickerIds.includes(id) || !ledger.issuedCharacterIds.includes(pending.characterId)) {
      const nextLedger = copy(ledger);
      if (!nextLedger.issuedPickerIds.includes(id)) nextLedger.issuedPickerIds.push(id);
      if (!nextLedger.issuedCharacterIds.includes(pending.characterId)) nextLedger.issuedCharacterIds.push(pending.characterId);
      await saveLedger(nextLedger); await point('id-reserved', id);
    }
    if (!pickerIndex.has(id)) {
      const next = copy(current), owner = requireAccount(next, accountId);
      const picker = { id, kind: 'default', ownerAccountId: accountId, ownerCharacterId: null, seats: [], reservations: [], lifecycle: 'active', provisioning: 'reserved', memberIds: ['owner'], createdAt: pending.createdAt };
      next.pickers.push(picker); owner.defaultPickerId ??= id;
      owner.memberships.push({ pickerId: id, role: 'owner', memberId: 'owner' });
      bindCharacter(next, owner, picker, 'owner', { id: pending.characterId, requestId, runescapeName, createdAt: pending.createdAt });
      await save(next, { accounts: [owner], pickers: [picker], characters: true }); await point('registry-reserved', id);
    }
    const picker = await provision(id), next = copy(current), owner = requireAccount(next, accountId);
    owner.pendingCreation = null; owner.initialProvisioned = true; owner.lastCharacterId = pending.characterId;
    await save(next, { accounts: [owner], characters: true });
    await point('character-ready', id);
    return { account: requireAccount(current, accountId), picker, character: characterIndex.get(pending.characterId) };
  }
  function deletion(nextLedger, id) {
    if (!nextLedger.pickers.some(t => t.pickerId === id)) nextLedger.pickers.push({ pickerId: id, lifecycle: 'deleting', deletingAt: timestamp(), deletedAt: null });
  }
  function retireAccount(nextLedger, accountId, runtimePurge) {
    if (!nextLedger.accounts.some(t => t.accountId === accountId)) nextLedger.accounts.push({ accountId, deletedAt: timestamp(), ...(runtimePurge ? { purgeProgress: 'pending' } : {}) });
    for (const picker of current.pickers) if (picker.kind === 'default' && picker.ownerAccountId === accountId && picker.lifecycle === 'active') deletion(nextLedger, picker.id);
  }
  async function finishRelinkRetirements() {
    if (!current.relinkRetirements?.length) return;
    const nextLedger = copy(ledger);
    for (const id of current.relinkRetirements) retireAccount(nextLedger, id, true);
    await saveLedger(nextLedger); await point('relink-retired');
    const changes = { accounts: [], pickers: [], removedCapabilities: [], relinkRetirements: true };
    const next = reconcile(current, ledger, changes); delete next.relinkRetirements;
    await save(next, changes); await point('relink-reconciled');
  }
  async function applyTombstones() {
    const changes = { accounts: [], pickers: [], removedCapabilities: [] };
    const next = reconcile(current, ledger, changes);
    // Retired IDs can exist only in the external ledger after restoring an older checkpoint.
    if (changes.accounts.length || changes.pickers.length || changes.removedCapabilities.length || changes.characters) await save(next, changes);
    return { blockedPickerIds: ledger.pickers.map(t => t.pickerId), deletedAccountIds: ledger.accounts.map(t => t.accountId) };
  }
  const blockedPicker = id => tombstoneIndex.get(id);
  const groupInvites = createGroupInvites({ read: () => current, now, caps, point,
    save: next => save(next, { accounts: next.accounts, pickers: next.pickers, characters: true }),
    async version() {
      if (current.schemaVersion === 3) return;
      const { open, link, unlink } = await import('node:fs/promises');
      // One-file migration: retain the original bytes before atomic publication.
      const target = path.join(registryDir, 'registry.pre-invites-v2.json');
      const bytes = await readFile(file), temporary = `${target}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
        // Hard-link only complete, synced bytes; never replace a retained preimage.
        try { await link(temporary, target); }
        catch (e) {
          if (e.code !== 'EEXIST') throw e;
          if (!(await readFile(target)).equals(bytes)) throw new Error('Invitation migration preimage differs from registry. Review recovery before upgrading.');
        }
      } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
      await syncDirectory(registryDir);
      await point('invite-backed-up');
      const next = copy(current); next.schemaVersion = 3; next.groupInvites = [];
      await save(next); await point('invite-versioned');
    },
    async issueCharacter(id) { const next = copy(ledger); next.issuedCharacterIds.push(id); await saveLedger(next); },
  });
  function visibleAccount(id) {
    if (retiredAccounts.has(id)) return null;
    const account = copy(accountIndex.get(id));
    if (account) {
      account.memberships = account.memberships.filter(m => !blockedPicker(m.pickerId));
      if (blockedPicker(account.defaultPickerId)?.lifecycle === 'deleted') account.defaultPickerId = null;
    }
    return account;
  }
  function visiblePicker(picker) {
    if (!picker) return null;
    return { ...copy(picker), lifecycle: blockedPicker(picker.id)?.lifecycle ?? picker.lifecycle };
  }
  function relinkTarget(accountId) {
    const account = visibleAccount(accountId);
    // A joined login can have no owned default after onboarding retirement.
    // Reclaim still restores its own character collection, never group ownership.
    if (current.schemaVersion === 3 && account && !account.identities.length && current.characters.some(c => c.accountId === account.id && c.lifecycle === 'active'
      && current.pickers.some(p => p.id === c.placement.pickerId && p.kind === 'default' && p.lifecycle === 'active' && p.provisioning === 'ready' && !blockedPicker(p.id))
      && account.memberships.some(m => m.pickerId === c.placement.pickerId && m.memberId === c.placement.memberId && m.role !== 'viewer'))) return account;
    const picker = account && current.pickers.find(p => p.id === account.defaultPickerId);
    return account && !account.identities.length && picker?.kind === 'default' && picker.ownerAccountId === account.id
      && picker.lifecycle === 'active' && picker.provisioning === 'ready' && !blockedPicker(picker.id)
      && account.memberships.some(m => m.pickerId === picker.id && m.role === 'owner') ? account : null;
  }
  function checkRelink(code, provider, subject) {
    registryIdentity(provider, subject);
    const refuse = () => { throw error(409, 'This account claim is unavailable. Ask the operator for a new link.'); };
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) refuse();
    const hash = createHash('sha256').update(code).digest('hex');
    const entry = current.relinkCodes?.find(c => c.hash === hash);
    if (!entry || Date.parse(entry.expiresAt) <= now()) refuse();
    const target = relinkTarget(entry.accountId), source = accountForIdentity(current, provider, subject);
    if (!target) refuse();
    if (source) {
      const picker = current.pickers.find(p => p.id === source.defaultPickerId);
      if (source.id === target.id || retiredAccounts.has(source.id) || source.identities.length !== 1 || source.memberships.length !== 1
        || source.memberships[0].pickerId !== picker?.id || source.memberships[0].role !== 'owner'
        || picker?.kind !== 'default' || picker.ownerAccountId !== source.id || picker.lifecycle !== 'active' || picker.provisioning !== 'ready' || blockedPicker(picker.id)
        || current.pickers.some(p => p.ownerAccountId === source.id && p.id !== picker.id)) refuse();
    }
    return { target, source, hash };
  }
  try {
    releases.push(await lockRegistry(registryDir));
    releases.push(await lockRegistry(tombstoneDir));
    current = await load(file); ledger = await load(ledgerFile);
    if (recoveryOnly && current === undefined) throw new Error('A checkpoint registry is required for service recovery.');
    // Only a missing file starts empty; a JSON null document fails validation.
    if (current !== undefined && ledger === undefined) throw new Error('Registry ledger is missing.');
    if (ledger === undefined) ledger = { schemaVersion: 2, issuedPickerIds: [], pickers: [], accounts: [], issuedCharacterIds: [], characters: [] };
    validateLedger(ledger);
    if (current === undefined && ledger.schemaVersion === 1 && !ledger.issuedPickerIds.length && !ledger.pickers.length && !ledger.accounts.length) ledger = { ...ledger, schemaVersion: 2, issuedCharacterIds: [], characters: [] };
    const validateTarget = (next, nextLedger) => {
      validate(next); validateLedger(nextLedger); validateCharacters(next, caps); createRegistryCaps(next, caps).checkInitial(nextLedger);
      if (nextLedger.issuedCharacterIds.length > caps.issuedCharacterIds || nextLedger.characters.length > caps.retiredCharacters) throw characterError('The character ID history limit has been reached. Existing IDs cannot be reused.');
    };
    // Checkpoint reconciliation runs before gameplay is staged or installed.
    // Keep schema 1 until ordinary startup can read both legacy and owned rosters.
    const deferred = recoveryOnly && current?.schemaVersion === 1;
    if (!deferred && (current?.schemaVersion === 1 || current?.schemaVersion === 2 && ledger.schemaVersion === 1)) {
      [current, ledger] = await migrateCharacterDocuments(current, { document: ledger, file: ledgerFile }, { registryDir, pickerRoot, legacyDir, point, validateV1: validate,
        validateTarget });
    } else if (current?.schemaVersion === 2) {
      [current, ledger] = await migrateCharacterDocuments(current, { document: ledger, file: ledgerFile }, { registryDir, pickerRoot, legacyDir, point, validateTarget });
    }
    validateLedger(ledger);
    if (!deferred && current !== undefined && (![2, 3].includes(current.schemaVersion) || ledger.schemaVersion !== 2)) {
      if (current.schemaVersion > 3) validate(current);
      throw new Error('Registry and ledger versions do not match. Restore the matching pair or character migration intent.');
    }
    if (current === undefined && (ledger.issuedPickerIds.length || ledger.pickers.length || ledger.accounts.length || ledger.issuedCharacterIds.length)) {
      throw new Error(`Registry file ${file} is missing but ledger ${ledgerFile} has been used. Restore registry.json from a service backup or a known-good checkpoint, keeping the existing ledger.json.`);
    }
    if (current === undefined) current = { schemaVersion: 2, accounts: [], pickers: [], capabilities: [], characters: [] };
    validate(current);
    if (current.pickers.some(p => !ledger.issuedPickerIds.includes(p.id) || !['active', 'retired'].includes(p.lifecycle) && !ledger.pickers.some(t => t.pickerId === p.id))) bad();
    current = reconcile(current, ledger); validate(current);
    if (current.schemaVersion >= 2) validateCharacters(current, caps);
    validateGroupInvites(current);
    if (current.characters?.some(c => !ledger.issuedCharacterIds.includes(c.id))
      || current.groupInvites?.some(i => i.transaction?.newCharacter && !ledger.issuedCharacterIds.includes(i.acceptingCharacterId))) bad();
    capCounts = createRegistryCaps(current, caps, onCapCheck); capCounts.checkInitial(ledger); rebuildIndexes(); rebuildLedgerIndexes();
    // A published preimage is also the upgrade intent. Finish it before any
    // startup repair or new request can change its v2 source bytes.
    if (!recoveryOnly && current.schemaVersion === 2) {
      let backedUp = false;
      try { await lstat(path.join(registryDir, 'registry.pre-invites-v2.json')); backedUp = true; }
      catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      if (backedUp) await groupInvites.resumeVersion();
    }
    await finishRelinkRetirements();
    // Reconcile before recovery can create a directory or expose any index.
    await saveLedger(ledger); await save(current);
    if (!recoveryOnly) {
      for (const account of [...current.accounts]) if (account.pendingCreation) await createCharacter(account.id, { requestId: account.pendingCreation.requestId, runescapeName: account.pendingCreation.runescapeName, acknowledgeDuplicate: true });
      for (const picker of current.pickers.filter(p => p.lifecycle === 'active' && p.provisioning === 'reserved')) await provision(picker.id);
    }
  } catch (failure) {
    for (const release of releases.reverse()) await release().catch(() => {});
    throw failure;
  }
  const api = {
    groupInvitePoint(name, pickerId) { return point(name, pickerId); },
    createGroupInvite(accountId, pickerId, replaceId) { return enqueue(() => groupInvites.create(accountId, pickerId, replaceId)); },
    listGroupInvites(accountId, pickerId) { usable(); return groupInvites.list(accountId, pickerId); },
    previewGroupInvite(secret) { usable(); return groupInvites.preview(secret); },
    revokeGroupInvite(accountId, pickerId, id) { return enqueue(() => groupInvites.revoke(accountId, pickerId, id)); },
    beginGroupJoin(secret, accountId, input) { return enqueue(() => groupInvites.begin(secret, accountId, input)); },
    finishGroupJoin(id) { return enqueue(() => groupInvites.finish(id)); },
    groupJoinTransactions() { usable(); return groupInvites.transactions(); },
    groupJoinEligible(accountId, characterId) { usable(); return groupInvites.eligible(accountId, characterId); },
    cleanGroupInvites() { return enqueue(() => groupInvites.clean()); },
    pickerJoining(id) { return (current.groupInvites ?? []).some(i => i.transaction?.source?.pickerId === id); },
    pickerAdmissionPending(id) { return (current.groupInvites ?? []).some(i => i.transaction && (i.pickerId === id || i.transaction.source?.pickerId === id)); },
    // Diagnostic read, never used by request admission. Tests compare a rescan.
    capCounts() { usable(); return capCounts.snapshot(); },
    // Queue-held read-only checkpoint. No provider subjects or capabilities may
    // leave the server; explicit account IDs and memberships survive recovery.
    withRecoveryCheckpoint(work) { return enqueue(() => work(registryRecoveryDocument(current, caps))); },
    getAccount(id) { usable(); return visibleAccount(id); },
    listAccounts() { usable(); return [...accountIndex.keys()].map(visibleAccount).filter(Boolean); },
    getCharacter(id) { usable(); return copy(characterIndex.get(id)); },
    listCharacters(accountId) {
      usable();
      return [...characterIndex.values()].filter(c => c.accountId === accountId && c.lifecycle === 'active').map(c => {
        const picker = visiblePicker(pickerIndex.get(c.placement.pickerId));
        const membership = visibleAccount(accountId)?.memberships.find(m => m.pickerId === picker?.id && m.memberId === c.placement.memberId);
        return { ...copy(c), role: membership?.role ?? null, groupLabel: picker?.kind === 'legacy-shared' ? 'Shared game' : picker?.seats.length > 1 ? 'Group game' : 'Solo game', playerCount: picker?.seats.length ?? 0,
          available: Boolean(membership && picker?.lifecycle === 'active' && picker.provisioning === 'ready'), href: `/characters/${c.id}` };
      });
    },
    selectCharacter(accountId, requested, pickerId) {
      usable(); const account = visibleAccount(accountId);
      const available = id => { const c = characterIndex.get(id), picker = pickerIndex.get(c?.placement?.pickerId);
        return c?.lifecycle === 'active' && c.accountId === accountId && picker?.lifecycle === 'active' && !blockedPicker(picker.id) && !api.pickerJoining(picker.id) && picker.provisioning === 'ready'
          && account?.memberships.some(m => m.pickerId === picker.id && m.memberId === c.placement.memberId && m.role !== 'viewer') ? copy(c) : null; };
      if (requested) { const character = available(requested); if (!character || pickerId && character.placement.pickerId !== pickerId) throw error(403, 'That character is unavailable or does not belong to this group. Open your character menu.'); return character; }
      if (account?.lastCharacterId) { const last = available(account.lastCharacterId); if (last && (!pickerId || last.placement.pickerId === pickerId)) return last; }
      const choices = [...characterIndex.values()].filter(c => c.accountId === accountId && (!pickerId || c.placement?.pickerId === pickerId)).map(c => available(c.id)).filter(Boolean);
      return choices.length === 1 ? choices[0] : null;
    },
    rememberCharacter(accountId, characterId) { return enqueue(async () => {
      const character = characterIndex.get(characterId);
      if (character?.accountId !== accountId || character.lifecycle !== 'active' || blockedPicker(character.placement.pickerId)) throw error(403, 'Character access denied.');
      const next = copy(current), account = requireAccount(next, accountId); account.lastCharacterId = characterId;
      await save(next, { accounts: [account] });
    }); },
    addCharacter(accountId, input) { return enqueue(() => createCharacter(accountId, input)); },
    // Names remain a projection of schema-1 gameplay until the separate rename
    // workflow ships. Publish after gameplay, retry before replies and on open.
    updateCharacterNames(pickerId, members) { return enqueue(async () => {
      if (pickerId === 'legacy') pickerId = current.pickers.find(p => p.kind === 'legacy-shared')?.id;
      const updates = current.characters.filter(c => c.lifecycle === 'active' && c.placement.pickerId === pickerId)
        .map(c => {
          const member = members.find(m => m.id === c.placement.memberId);
          if (!member) throw characterError('Saved roster does not match the character placement. Review the mapping before continuing.');
          return [c.id, characterName(member.runescapeName)];
        })
        .filter(([id, name]) => characterIndex.get(id).runescapeName !== name);
      if (!updates.length) return;
      const next = copy(current);
      for (const [id, name] of updates) next.characters.find(c => c.id === id).runescapeName = name;
      await save(next, { characters: true });
    }); },
    accountsForMember(pickerId, memberId) { usable(); return [...(memberAccounts.get(JSON.stringify([pickerId, memberId])) ?? [])].filter(id => !retiredAccounts.has(id)); },
    findIdentity(provider, subject) { usable(); registryIdentity(provider, subject); return visibleAccount(providerIndex.get(identityKey(provider, subject))); },
    getPicker(id) { usable(); return visiblePicker(pickerIndex.get(id)); },
    listPickers() { usable(); return current.pickers.map(visiblePicker); },
    pickerDirectory(id) {
      usable(); if (typeof id !== 'string' || !PICKER.test(id)) throw error(400, 'Invalid picker ID.');
      const picker = requirePicker(current, id);
      if (picker.kind === 'legacy-shared') { if (!legacyDir) throw new Error('Legacy directory is not configured.'); return legacyDir; }
      return path.join(pickerRoot, id);
    },
    issueRelinkCode(accountId, { expiresInMs = 24 * 60 * 60 * 1000 } = {}) { return enqueue(async () => {
      const account = relinkTarget(accountId);
      if (!account) throw error(409, 'This account cannot be reclaimed.');
      if (!Number.isSafeInteger(expiresInMs) || expiresInMs <= 0 || expiresInMs > 24 * 60 * 60 * 1000) throw error(400, 'Invalid claim lifetime.');
      const code = generateToken(), next = copy(current);
      const expiresAt = new Date(now() + expiresInMs).toISOString();
      next.relinkCodes = (next.relinkCodes ?? []).filter(c => c.accountId !== accountId && Date.parse(c.expiresAt) > now());
      next.relinkCodes.push({ accountId, hash: createHash('sha256').update(code).digest('hex'), expiresAt });
      await save(next, { relinkCodes: true }); return { code, expiresAt };
    }); },
    checkRelink(code, provider, subject) { usable(); return copy(checkRelink(code, provider, subject)); },
    claimIdentity(code, provider, subject, { emptyAccountId = null, onCommit } = {}) { return enqueue(async () => {
      const { target, source, hash } = checkRelink(code, provider, subject);
      if ((source?.id ?? null) !== emptyAccountId) throw error(409, 'This account claim is unavailable. Ask the operator for a new link.');
      const next = copy(current);
      if (source) {
        const nextLedger = copy(ledger); retireAccount(nextLedger, source.id, true); enforceCaps(next, nextLedger);
        requireAccount(next, source.id).identities = requireAccount(next, source.id).identities.filter(i => i.provider !== provider || i.subject !== subject);
        next.relinkRetirements = [source.id];
      }
      addIdentity(next, requireAccount(next, target.id), provider, subject);
      next.relinkCodes = next.relinkCodes.filter(c => c.hash !== hash);
      // The sole commit publishes the identity move, consumption and retirement intent.
      await point('relink-before-commit'); await save(next, { accounts: [requireAccount(next, target.id), ...(source ? [requireAccount(next, source.id)] : [])], relinkCodes: true, relinkRetirements: true });
      try {
        onCommit?.(source?.defaultPickerId);
        await point('relink-committed'); await finishRelinkRetirements();
      } catch (failure) { failed = true; throw failure; }
      return requireAccount(current, target.id);
    }); },
    ensureIdentity(provider, subject) { return enqueue(async () => { const next = copy(current), account = ensureIdentity(next, provider, subject); await save(next, { accounts: [account] }); return account; }); },
    linkIdentity(accountId, provider, subject) { return enqueue(async () => { const next = copy(current), account = requireAccount(next, accountId); addIdentity(next, account, provider, subject); await save(next, { accounts: [account] }); return account; }); },
    unlinkIdentity(accountId, provider) { return enqueue(async () => {
      if (!['discord', 'google'].includes(provider)) throw error(400, 'Invalid sign-in provider.');
      const next = copy(current), account = requireAccount(next, accountId); account.identities = account.identities.filter(i => i.provider !== provider); await save(next, { accounts: [account] }); return account;
    }); },
    firstLogin(provider, subject) { return enqueue(async () => {
      registryIdentity(provider, subject);
      // Refuse admission before persisting a new login or consuming an ID.
      const existing = accountForIdentity(current, provider, subject);
      if (!existing || !existing.initialProvisioned && !existing.pendingCreation) checkPickerAllocation();
      if (!existing && current.characters.filter(c => c.lifecycle === 'active').length >= caps.characters) throw characterError('The service character limit has been reached. Existing maps are unchanged.');
      if (!existing && ledger.issuedCharacterIds.length >= caps.issuedCharacterIds) throw characterError('The character ID history limit has been reached. Existing IDs cannot be reused.');
      const next = copy(current), account = ensureIdentity(next, provider, subject); await save(next, { accounts: [account] });
      const picker = await ensureDefault(account.id); return { account: requireAccount(current, account.id), picker };
    }); },
    // Reserve gameplay slots before a replacement commit. This only grows the
    // roster allowlist, never assigns accounts or capabilities. If a state write
    // fails, unused slots are harmless and the preceding state remains loadable.
    reserveTransferMembers(pickerId, memberIds) { return enqueue(async () => {
      registryMembers(memberIds);
      const next = copy(current), picker = activePicker(next, pickerId);
      if (picker.kind !== 'default') throw error(403, 'Only owned pickers can reserve imported member slots.');
      const required = next.accounts.flatMap(a => a.memberships.filter(m => m.pickerId === pickerId && m.role !== 'viewer').map(m => m.memberId));
      if (required.some(id => !memberIds.includes(id))) throw error(422, 'Roster mapping must keep every assigned participant.');
      picker.memberIds = [...new Set([...picker.memberIds, ...memberIds])];
      await save(next, { pickers: [picker] }); return picker;
    }); },
    ensureDefaultPicker(accountId) { return enqueue(() => ensureDefault(accountId)); },
    attachMembership(accountId, membership) { return enqueue(async () => {
      const next = copy(current), account = requireAccount(next, accountId), picker = activePicker(next, membership?.pickerId);
      if (!object(membership, ['pickerId', 'role', 'memberId']) || !roles.includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !picker.memberIds.includes(membership.memberId)) || (membership.role === 'owner' && (picker.kind !== 'default' || picker.ownerAccountId !== accountId))) throw error(400, 'Invalid picker membership.');
      const existing = account.memberships.find(m => m.pickerId === picker.id && m.memberId === membership.memberId);
      if (existing && existing.role !== membership.role) throw error(409, 'Membership is already assigned.');
      if (!existing) account.memberships.push(copy(membership));
      if (membership.role !== 'viewer') {
        bindCharacter(next, account, picker, membership.memberId, { requestId: `slot-${picker.id}-${membership.memberId}` });
        await saveCharacterBindings(next, { accounts: [account], pickers: [picker] });
      } else await save(next, { accounts: [account] });
      return account;
    }); },
    removeMembership(accountId, pickerId, memberId) { return enqueue(async () => {
      const next = copy(current), account = requireAccount(next, accountId);
      if (account.memberships.some(m => m.pickerId === pickerId && m.memberId === memberId && m.role === 'owner')) throw error(409, 'Delete the owned picker before removing its owner.');
      account.memberships = account.memberships.filter(m => m.pickerId !== pickerId || m.memberId !== memberId);
      const character = next.characters.find(c => c.accountId === accountId && c.lifecycle === 'active' && c.placement.pickerId === pickerId && c.placement.memberId === memberId);
      if (character) throw characterError('Removing character access requires the later leave/remove workflow. Existing access is unchanged.');
      const removedCapabilities = [];
      next.capabilities = next.capabilities.filter(c => {
        if (c.accountId !== accountId || c.pickerId !== pickerId || c.memberId !== memberId) return true;
        removedCapabilities.push(c); return false;
      });
      await save(next, { accounts: [account], removedCapabilities }); return account;
    }); },
    assertLegacyClaim(memberId, accountId) {
      usable();
      const picker = current.pickers.find(p => p.kind === 'legacy-shared' && p.lifecycle === 'active');
      if (!picker?.memberIds.includes(memberId)) throw error(409, 'Shared-game access is unavailable.');
      const character = characterIndex.get(picker.seats.find(s => s.memberId === memberId)?.characterId);
      if (character && character.accountId !== accountId) throw characterError('Character ownership transfers are unavailable. Existing ownership and access are unchanged.');
    },
    registerLegacy(plan) { return enqueue(async () => {
      if (!legacyDir || !object(plan, ['accounts', 'memberIds', 'droppedMemberships']) || !Array.isArray(plan.accounts)) throw new TypeError('Invalid legacy registration.');
      registryMembers(plan.memberIds);
      if (plan.memberIds.length !== 2) throw new TypeError('Legacy registration requires two established members.');
      let picker = current.pickers.find(p => p.kind === 'legacy-shared');
      if (picker && (picker.lifecycle !== 'active' || JSON.stringify(picker.memberIds) !== JSON.stringify(plan.memberIds))) throw error(409, 'Legacy picker is already registered differently.');
      const next = copy(current);
      // Validate the complete plan before reserving an ID or changing the registry.
      for (const input of plan.accounts) {
        if (!object(input, ['id', 'identities', 'memberships']) || !REGISTRY_ACCOUNT.test(input.id) || ledger.accounts.some(t => t.accountId === input.id) || !Array.isArray(input.identities) || !Array.isArray(input.memberships)) throw new TypeError('Invalid legacy registration.');
        let account = next.accounts.find(a => a.id === input.id);
        if (!account) { account = { id: input.id, identities: [], memberships: [], defaultPickerId: null, createdAt: timestamp(), initialProvisioned: true, lastCharacterId: null, pendingCreation: null }; next.accounts.push(account); }
        for (const identity of input.identities) {
          if (!object(identity, ['provider', 'subject'])) throw new TypeError('Invalid legacy registration.');
          addIdentity(next, account, identity.provider, identity.subject);
        }
        for (const membership of input.memberships) if (!object(membership, ['role', 'memberId']) || !['player', 'viewer'].includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !plan.memberIds.includes(membership.memberId))) throw new TypeError('Invalid legacy registration.');
      }
      const accounts = [...new Set(plan.accounts.map(input => input.id))].map(id => requireAccount(next, id));
      enforceCaps(next, ledger, { accounts });
      if (!picker) {
        const id = await allocate();
        picker = { id, kind: 'legacy-shared', ownerAccountId: null, ownerCharacterId: null, seats: [], reservations: [], lifecycle: 'active', provisioning: 'ready', memberIds: copy(plan.memberIds), createdAt: timestamp() }; next.pickers.push(picker);
      }
      else picker = requirePicker(next, picker.id);
      for (const input of plan.accounts) for (const membership of input.memberships) {
        const account = requireAccount(next, input.id);
        if (!account.memberships.some(m => m.pickerId === picker.id && m.memberId === membership.memberId && m.role === membership.role)) account.memberships.push({ pickerId: picker.id, ...membership });
        if (membership.role !== 'viewer') bindCharacter(next, account, picker, membership.memberId, { requestId: `legacy-${membership.memberId}` });
      }
      await saveCharacterBindings(next, { accounts, pickers: [picker] }); return picker;
    }); },
    setCapability(input) { return enqueue(async () => {
      if (!object(input, ['kind', 'hash', 'pickerId', 'accountId', 'memberId']) || !kinds.includes(input.kind) || typeof input.hash !== 'string' || !HASH.test(input.hash)) throw error(400, 'Invalid capability index entry.');
      const picker = pickerIndex.get(input.pickerId);
      if (!picker) throw error(404, 'Picker not found.');
      if (picker.lifecycle !== 'active' || tombstoneIndex.has(picker.id)) throw error(409, 'Picker is unavailable.');
      const existing = capabilityIndex.get(capabilityKey(input.kind, input.hash));
      if (existing && JSON.stringify(existing) !== JSON.stringify(input)) {
        if (['pickerId', 'accountId', 'memberId'].some(key => existing[key] !== input[key])) throw error(409, 'Capability hash is already assigned.');
      }
      if (existing) return input;
      const record = { kind: input.kind, hash: input.hash, pickerId: input.pickerId, accountId: input.accountId, memberId: input.memberId };
      const next = { ...current, capabilities: [...current.capabilities, record] };
      await save(next, { addedCapabilities: [record] }); return input;
    }); },
    resolveCapability(kind, hash) {
      usable(); if (!kinds.includes(kind) || typeof hash !== 'string' || !HASH.test(hash)) return null;
      const capability = capabilityIndex.get(capabilityKey(kind, hash));
      return capability && !blockedPicker(capability.pickerId) && !retiredAccounts.has(capability.accountId) ? copy(capability) : null;
    },
    revokeCapability(kind, hash) { return enqueue(async () => {
      const existing = capabilityIndex.get(capabilityKey(kind, hash)); if (!existing) return;
      const next = { ...current, capabilities: current.capabilities.filter(c => c.kind !== kind || c.hash !== hash) };
      await save(next, { removedCapabilities: [existing] });
    }); },
    beginPickerDeletion(id, { onTombstone } = {}) { return enqueue(async () => {
      if (requirePicker(current, id).kind === 'legacy-shared') throw error(409, 'The shared picker cannot be deleted.');
      const next = copy(ledger); deletion(next, id); await saveLedger(next); onTombstone?.(); await point('picker-tombstoned', id);
      await applyTombstones(); return requirePicker(current, id);
    }); },
    completePickerDeletion(id) { return enqueue(async () => {
      const next = copy(ledger), tombstone = next.pickers.find(t => t.pickerId === id);
      if (!tombstone) throw error(409, 'Begin picker deletion first.');
      const picker = current.pickers.find(p => p.id === id);
      // Runtime integration must drain writers and remove owned data/binding first.
      if (picker?.kind === 'legacy-shared') throw error(409, 'Legacy shared data requires operator recovery.');
      for (const target of [path.join(pickerRoot, id), path.join(pickerRoot, id) + '.dataset.json']) {
        try { await lstat(target); throw error(409, 'Picker data must be purged before completing deletion.'); }
        catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      }
      if (tombstone.lifecycle !== 'deleted') { tombstone.lifecycle = 'deleted'; tombstone.deletedAt = timestamp(); await saveLedger(next); await point('picker-deleted', id); }
      await applyTombstones(); return { pickerId: id, lifecycle: 'deleted' };
    }); },
    deleteAccount(accountId, { runtimePurge = false, onTombstone } = {}) { return enqueue(async () => {
      const account = current.accounts.find(a => a.id === accountId);
      if (!account && !ledger.accounts.some(t => t.accountId === accountId)) throw error(404, 'Account not found.');
      const next = copy(ledger);
      retireAccount(next, accountId, runtimePurge);
      await saveLedger(next); onTombstone?.(); await point('account-tombstoned', account?.defaultPickerId ?? null); await applyTombstones();
      return { accountId };
    }); },
    isAccountDeleted(id) { usable(); return retiredAccounts.has(id); },
    deletionRecords() { usable(); return copy({ pickers: ledger.pickers, accounts: ledger.accounts }); },
    deletionDirectory(id) {
      usable(); if (!tombstoneIndex.has(id) || current.pickers.some(p => p.id === id && p.kind === 'legacy-shared')) throw error(409, 'Owned picker tombstone required.');
      return path.join(pickerRoot, id);
    },
    advanceDeletion(kind, id, purgeProgress) { return enqueue(async () => {
      const next = copy(ledger), entry = kind === 'picker' ? next.pickers.find(t => t.pickerId === id) : kind === 'account' ? next.accounts.find(t => t.accountId === id) : null;
      if (!entry) throw error(409, 'Deletion tombstone required.');
      entry.purgeProgress = purgeProgress; await saveLedger(next);
      await point(`${kind}-purge-${purgeProgress}`, kind === 'picker' ? id : null);
    }); },
    reconcileTombstones() { return enqueue(applyTombstones); },
    close() { return closing ??= (async () => {
      closed = true; await queue;
      const results = await Promise.allSettled(releases.reverse().map(release => release()));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    })(); },
  };
  // A schema-1 checkpoint can only reconcile existing deletion decisions. It
  // must not expose login, character, identity or provisioning operations.
  return recoveryOnly ? Object.fromEntries(['withRecoveryCheckpoint', 'reconcileTombstones', 'isAccountDeleted',
    'deletionRecords', 'deletionDirectory', 'advanceDeletion', 'completePickerDeletion', 'close'].map(name => [name, api[name]])) : api;
}

export function registryRecoveryDocument(document, caps = { characters: Number.MAX_SAFE_INTEGER, charactersPerAccount: Number.MAX_SAFE_INTEGER }) {
  validate(document);
  // Standalone checkpoint inspection has no live configuration. Enforce its
  // bindings here; the configured writer enforces capacity when installing it.
  if (document.schemaVersion >= 2) validateCharacters(document, caps);
  validateGroupInvites(document);
  if (document.groupInvites?.some(i => i.transaction)) throw error(409, 'Group admission is pending. Resume it before taking a checkpoint.');
  if (document.relinkRetirements?.length) throw error(409, 'Account retirement is pending. Restart the service before taking a checkpoint.');
  return { schemaVersion: document.schemaVersion,
    accounts: document.accounts.map(account => ({ ...copy(account), identities: [] })),
    pickers: copy(document.pickers).map(p => document.schemaVersion === 3 ? { ...p, reservations: [] } : p), capabilities: [], ...(document.schemaVersion >= 2 ? { characters: copy(document.characters) } : {}),
    ...(document.schemaVersion === 3 ? { groupInvites: document.groupInvites.map(i => ({ ...copy(i), secretHash: null, ...(i.status === 'pending' ? { status: 'revoked', terminalAt: i.createdAt } : {}) })) } : {}) };
}
