import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { generateToken } from '../security/tokens.mjs';
import path from 'node:path';
import { durableDirectory, lockRegistry, syncDirectory, writeRegistryJson } from './registry-lock.mjs';
import { REGISTRY_ACCOUNT, registryIdentity, registryMembers, registryObject as object } from './registry-legacy.mjs';
import { createRegistryCaps } from './registry-caps.mjs';
import { CHARACTER_ID, newCharacterId, bindCharacter, validateCharacters, migrateCharacterDocuments, characterName, normalizedCharacterName, characterError } from './registry-characters.mjs';
import { createGroupInvites, validateGroupInvites } from './group-invites.mjs';
import { createGroupHandovers, validateHandovers } from './group-handovers.mjs';
import { createGroupDepartures, validateDepartures, departureSoloEligible } from './group-departures.mjs';
import { validateRetirements, migrateRetirements, registryV5, slotKey, reservedRetirementSlots, reservedRetiredCharacters } from './registry-retirements.mjs';
import { deletionPlan, requireLoginDeletionReady } from './character-deletions.mjs';
import { createLoginStorageBudget, loginStorageBudget } from './login-storage-budget.mjs';
import { storageBudget } from './storage-budget.mjs';

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
  characters: 3000, charactersPerAccount: 10, issuedCharacterIds: 1000000, retiredCharacters: 1000000, retiredSlots: 1000000 });
export const REGISTRY_PROVISION_POINTS = Object.freeze(['account-recorded', 'id-reserved', 'registry-reserved', 'directory-created', 'directory-synced', 'registry-ready']);

function validateLedger(ledger) {
  if (ledger?.schemaVersion > 3) throw new Error('Unsupported newer registry ledger version. Use a compatible release.');
  if (!object(ledger, ['schemaVersion', 'issuedPickerIds', 'pickers', 'accounts', ...(ledger?.schemaVersion >= 2 ? ['issuedCharacterIds', 'characters'] : []), ...(ledger?.schemaVersion === 3 ? ['slots', 'deletions'] : [])]) || ![1, 2, 3].includes(ledger.schemaVersion) || !Array.isArray(ledger.issuedPickerIds) || !Array.isArray(ledger.pickers) || !Array.isArray(ledger.accounts)) bad();
  if (ledger.schemaVersion >= 2 && (!Array.isArray(ledger.issuedCharacterIds) || ledger.issuedCharacterIds.some(id => !CHARACTER_ID.test(id)) || new Set(ledger.issuedCharacterIds).size !== ledger.issuedCharacterIds.length || !Array.isArray(ledger.characters) || ledger.schemaVersion === 2 && ledger.characters.length)) bad();
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
  validateRetirements(ledger); return ledger;
}

function validate(document, selection) {
  if (document?.schemaVersion > 5) throw new Error('Unsupported newer registry version. Use a compatible release.');
  const v2 = document?.schemaVersion >= 2;
  if (!object(document, ['schemaVersion', 'accounts', 'pickers', 'capabilities', 'relinkCodes', 'relinkRetirements', ...(v2 ? ['characters'] : []), ...(document?.schemaVersion >= 3 ? ['groupInvites'] : []), ...(document?.schemaVersion >= 4 ? ['handovers', 'departures', 'pastMaps'] : []), ...(document?.schemaVersion === 5 ? ['deletions'] : [])]) || ![1, 2, 3, 4, 5].includes(document.schemaVersion) || !Array.isArray(document.accounts) || !Array.isArray(document.pickers) || !Array.isArray(document.capabilities)) bad();
  if (document.schemaVersion === 5 && !Array.isArray(document.deletions)) bad();
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
    if (!object(picker, ['id', 'kind', 'ownerAccountId', 'lifecycle', 'provisioning', 'memberIds', 'createdAt', ...(v2 ? ['seats', 'reservations', 'ownerCharacterId'] : [])]) || !PICKER.test(picker.id) || pickers.has(picker.id) || !['default', 'legacy-shared'].includes(picker.kind) || !['active', 'deleting', 'deleted', ...(document.schemaVersion >= 3 ? ['retired'] : [])].includes(picker.lifecycle) || !['reserved', 'ready'].includes(picker.provisioning) || !date(picker.createdAt)) bad();
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
  if (ledger.schemaVersion === 3) {
    if (next.schemaVersion >= 5) next.deletions = copy(ledger.deletions);
    const deleted = new Set(ledger.characters.map(c => c.characterId));
    const pending = new Set(ledger.deletions.filter(d => !d.completedAt).flatMap(d => d.targets.map(t => t.characterId)));
    const provisionedAccounts = new Set(ledger.deletions.map(d => d.accountId));
    for (const a of next.accounts) {
      if (deletedAccounts.has(a.id)) continue;
      const obsoleteCreation = a.pendingCreation && deleted.has(a.pendingCreation.characterId);
      if (obsoleteCreation || !a.initialProvisioned && provisionedAccounts.has(a.id)) {
        a.initialProvisioned = true;
        if (obsoleteCreation) a.pendingCreation = null;
        if (!changes.accounts.includes(a)) changes.accounts.push(a);
      }
    }
    for (const c of next.characters ?? []) if (c.lifecycle === 'active') {
      const retired = ledger.slots.some(s => slotKey(s) === slotKey(c.placement));
      const moving = (next.departures ?? []).some(d => !d.completedAt && d.characterId === c.id)
        || (next.groupInvites ?? []).some(i => i.transaction && i.acceptingCharacterId === c.id);
      if (retired && !deleted.has(c.id) && !moving) throw new Error('Checkpoint predates a retired character binding. Restore the current character mapping; retired slots cannot be reactivated.');
      if (deleted.has(c.id) && !pending.has(c.id)) {
        const p = next.pickers.find(p => p.id === c.placement.pickerId);
        if (p?.ownerCharacterId === c.id && !blocked.has(p.id)) throw new Error('Checkpoint predates ownership handover. Restore the current owner mapping before recovery.');
        for (const a of next.accounts) {
          const memberships = a.memberships.filter(m => m.pickerId !== c.placement.pickerId || m.memberId !== c.placement.memberId);
          if (memberships.length !== a.memberships.length) { a.memberships = memberships; if (!changes.accounts.includes(a)) changes.accounts.push(a); }
          if (a.lastCharacterId === c.id) a.lastCharacterId = null;
        }
        next.capabilities = next.capabilities.filter(k => { if (k.pickerId !== c.placement.pickerId || k.memberId !== c.placement.memberId) return true; changes.removedCapabilities.push(k); return false; });
        c.lifecycle = 'retired'; c.placement = null; changes.characters = true;
      }
    }
  }
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
  crashPoint, pickerRandomBytes = randomBytes, betaPickerCap, onCapCheck, recoveryOnly = false, loginStorage: storageOptions = {} } = {}) {
  const loginLimits = loginStorageBudget(storageOptions);
  const groupMaxBytes = storageBudget().maxBytes;
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
  let lifecycleCapture = false, retained;
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
    await retained?.admit(next);
    if (changes.characters) requireCharacterAllocations(next);
    if (changes.characters || changes.relinkRetirements) checkRetirementCapacity(next, ledger);
    const accountRows = changes.accounts ?? [], pickerRows = changes.pickers ?? [];
    validate(next, { ...changes, accounts: accountRows, pickers: pickerRows, addedCapabilities: changes.addedCapabilities ?? [],
      account: id => accountIndex.get(id), picker: id => pickerIndex.get(id), identity: key => providerIndex.get(key) });
    if (changes.characters) validateCharacters(next, caps);
    validateGroupInvites(next);
    validateHandovers(next);
    validateDepartures(next);
    if (ledger.schemaVersion === 3) for (const c of next.characters) if (c.lifecycle === 'active' && ledger.slots.some(s => slotKey(s) === slotKey(c.placement))) {
      const pending = ledger.deletions.some(d => !d.completedAt && d.targets.some(t => t.characterId === c.id))
        || next.departures.some(d => !d.completedAt && d.characterId === c.id) || next.groupInvites.some(i => i.transaction && i.acceptingCharacterId === c.id);
      if (!pending) throw error(409, 'Retired character bindings cannot be reactivated. Restore the current character mapping.');
    }
    const commitCounts = enforceCaps(next, ledger, changes);
    // Retirement publishes outside checkpoints before the new binding. A
    // crash leaves a fenced existing intent, or refuses an obsolete mapping.
    if (ledger.schemaVersion === 3 && changes.characters) {
      const nextLedger = copy(ledger);
      for (const c of current.characters ?? []) if (c.lifecycle === 'active') {
        const after = next.characters.find(n => n.id === c.id);
        if (after?.lifecycle === 'active' && JSON.stringify(after.placement) === JSON.stringify(c.placement)) continue;
        if (!nextLedger.slots.some(s => slotKey(s) === slotKey(c.placement))) nextLedger.slots.push({ ...c.placement, characterId: c.id, retiredAt: timestamp() });
        if (after?.lifecycle !== 'active' && !nextLedger.characters.some(t => t.characterId === c.id)) nextLedger.characters.push({ characterId: c.id, deletedAt: timestamp() });
      }
      if (JSON.stringify(nextLedger) !== JSON.stringify(ledger)) { await saveLedger(nextLedger); await point('retirement-slot'); }
    }
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
    checkRetirementCapacity(current, next);
    // Pending login receipts reserve capacity without tombstoning the login
    // before its exact gameplay/credential cleanup has completed.
    if ((next.issuedCharacterIds?.length ?? 0) > caps.issuedCharacterIds || (next.characters?.length ?? 0) > caps.retiredCharacters) throw characterError('The character ID history limit has been reached. Existing IDs cannot be reused.');
    try { await writeRegistryJson(ledgerFile, next); ledger = next; rebuildLedgerIndexes(); }
    catch (failure) { failed = true; throw failure; }
  }
  function checkRetirementCapacity(doc, nextLedger) {
    const accounts = new Set([...nextLedger.accounts.map(a => a.accountId), ...(doc.relinkRetirements ?? [])]);
    for (const d of nextLedger.deletions ?? []) if (d.kind === 'account' && !d.completedAt) accounts.add(d.accountId);
    if (accounts.size > caps.retiredAccounts) throw characterError('The retired account record limit has been reached. Existing maps are unchanged. Ask the operator for help; existing records must be kept.');
    if (reservedRetirementSlots(doc, nextLedger) > caps.retiredSlots) throw characterError('The retired slot history limit has been reached. Existing maps are unchanged. Historical bindings cannot be reused.');
    if (reservedRetiredCharacters(doc, nextLedger) > caps.retiredCharacters) throw characterError('The retired character history limit has been reached. Existing maps are unchanged.');
  }
  async function saveCharacterBindings(next, changes) {
    requireCharacterAllocations(next);
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
    const pending = queue.then(() => (retained?.run ?? (work => work()))(async () => { if (failed) throw new Error('Registry requires restart.'); return copy(await operation()); }));
    queue = pending.catch(() => {}); return pending;
  }
  const requireAccount = (next, id) => { const account = next.accounts.find(a => a.id === id); if (!account) throw error(404, 'Account not found.'); return account; };
  const loginDeleting = id => (ledger.deletions ?? []).some(d => d.kind === 'account' && d.accountId === id && !d.completedAt);
  function requireAllocation(accountId) {
    if (loginDeleting(accountId)) throw error(409, 'Login deletion is completing. New characters and groups cannot be created. Retry after recovery.');
  }
  function requireCharacterAllocations(next) {
    const before = new Map((current.characters ?? []).map(c => [c.id, c]));
    for (const c of next.characters ?? []) if (c.lifecycle === 'active') {
      if (!before.has(c.id) || JSON.stringify(before.get(c.id).placement) !== JSON.stringify(c.placement)) requireAllocation(c.accountId);
    }
  }
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
    const count = capCounts.activePickers + (current.departures ?? []).filter(d => !d.completedAt).length;
    if (count >= caps.pickers) throw error(409, 'The picker limit has been reached. Existing maps are unchanged. Ask the operator about available capacity.');
    // Admission only: a lowered beta cap must not block reads, recovery or deletion.
    if (betaPickerCap !== undefined && count >= betaPickerCap) throw error(409, 'The beta is full. New groups are paused; existing maps are unchanged. Ask the operator about the next opening.');
    if (ledger.issuedPickerIds.length + (current.departures ?? []).filter(d => !d.completedAt && !issuedIds.has(d.destination.pickerId)).length >= caps.issuedPickerIds) throw error(409, 'The picker ID limit has been reached. Ask the operator for help; existing IDs cannot be reused.');
  }
  async function allocate(reserve = true, accountId) {
    if (accountId) requireAllocation(accountId);
    checkPickerAllocation();
    for (let attempt = 0; attempt < 128; attempt++) {
      const bits = pickerRandomBytes(16);
      if (!Buffer.isBuffer(bits) || bits.length !== 16) throw new TypeError('Expected 128 random bits.');
      const id = 'p_' + bits.toString('hex');
      if (issuedIds.has(id) || (current.departures ?? []).some(d => !d.completedAt && d.destination.pickerId === id)) continue;
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
    requireAllocation(picker.ownerAccountId);
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
    requireAllocation(accountId);
    const account = requireAccount(current, accountId);
    if (account.pendingCreation) return (await createCharacter(accountId, { ...account.pendingCreation, acknowledgeDuplicate: true })).picker;
    if (account.defaultPickerId) return provision(account.defaultPickerId);
    if (account.initialProvisioned) return null;
    return (await createCharacter(accountId, { requestId: 'initial' })).picker;
  }
  async function createCharacter(accountId, { requestId, runescapeName = null, acknowledgeDuplicate = false } = {}) {
    requireAllocation(accountId);
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
      const pickerId = await allocate(false, accountId);
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
    admit: next => retained?.admit(next),
    save: next => save(next, { accounts: next.accounts, pickers: next.pickers, characters: true, removedCapabilities: current.capabilities.filter(k => !next.capabilities.some(n => n.kind === k.kind && n.hash === k.hash)) }),
    async version() {
      if (current.schemaVersion >= 3) return;
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
  const handovers = createGroupHandovers({ read: () => current, now, point, registryDir,
    versionInvites: () => groupInvites.resumeVersion(),
    save: next => save(next, { accounts: next.accounts, pickers: next.pickers, characters: true }) });
  const departures = createGroupDepartures({ read: () => current, now, point, caps, allocate, pickerRoot, registryDir,
    admit: next => retained?.admit(next),
    version: () => retirementVersion(),
    async saveLedgerId(id) { if (!issuedIds.has(id)) { const next = copy(ledger); next.issuedPickerIds.push(id); await saveLedger(next); } },
    save: (next, removedCapabilities = []) => save(next, { accounts: next.accounts, pickers: next.pickers, characters: true, removedCapabilities }) });
  async function retirementVersion() {
    if (current.schemaVersion === 5 && ledger.schemaVersion === 3) return;
    await handovers.version();
    try { [current, ledger] = await migrateRetirements(current, ledger, { registryDir, ledgerFile, point, start: true, validate: validateRetirementTarget }); }
    catch (failure) { if (failure.status !== 409) failed = true; throw failure; }
    capCounts = createRegistryCaps(current, caps, onCapCheck); rebuildIndexes(); rebuildLedgerIndexes();
  }
  function validateRetirementTarget(next, nextLedger) {
    validate(next); validateLedger(nextLedger); validateCharacters(next, caps); validateGroupInvites(next); validateHandovers(next); validateDepartures(next);
    checkRetirementCapacity(next, nextLedger);
    createRegistryCaps(next, caps).checkInitial(nextLedger);
    if (nextLedger.issuedCharacterIds.length > caps.issuedCharacterIds || nextLedger.characters.length > caps.retiredCharacters || nextLedger.slots.length > caps.retiredSlots) throw characterError('The retirement history limit has been reached. Existing IDs and bindings cannot be reused.');
  }
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
    // An explicitly emptied login is still a reclaimable account. Recovery
    // restores its provider access without creating a replacement character.
    if (current.schemaVersion >= 5 && account && !account.identities.length && account.initialProvisioned && !account.pendingCreation
      && !current.characters.some(c => c.accountId === account.id && c.lifecycle === 'active')
      && current.deletions.some(d => d.completedAt && d.accountId === account.id && d.kind !== 'account')
      && !current.deletions.some(d => !d.completedAt && d.accountId === account.id)) return account;
    // A joined login can have no owned default after onboarding retirement.
    // Reclaim still restores its own character collection, never group ownership.
    if (current.schemaVersion >= 3 && account && !account.identities.length && current.characters.some(c => c.accountId === account.id && c.lifecycle === 'active'
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
      requireLoginDeletionReady(current, source.id);
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
    if (current?.schemaVersion === 1 && ledger.schemaVersion === 3) throw new Error('Checkpoint predates character mapping. Restore the current character registry while retaining the live retirement ledger.');
    if (current) [current, ledger] = await migrateRetirements(current, ledger, { registryDir, ledgerFile, point, validate: validateRetirementTarget });
    // Older checkpoints are disposable projections. The live ledger is never
    // replaced by their history, and supplies the v5 retirement receipts.
    if (current && ledger.schemaVersion === 3 && current.schemaVersion >= 2 && current.schemaVersion < 5) current = registryV5({ groupInvites: [], handovers: [], departures: [], pastMaps: [], ...current });
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
    if (!deferred && current !== undefined && (![2, 3, 4, 5].includes(current.schemaVersion) || ![2, 3].includes(ledger.schemaVersion) || current.schemaVersion === 5 && ledger.schemaVersion !== 3)) {
      if (current.schemaVersion > 5) validate(current);
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
    validateHandovers(current);
    validateDepartures(current);
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
    if (!recoveryOnly && current.schemaVersion === 3) {
      let backedUp = false;
      try { await lstat(path.join(registryDir, 'registry.pre-handovers-v3.json')); backedUp = true; }
      catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      if (backedUp) await handovers.version();
    }
    if (!recoveryOnly && current.schemaVersion >= 3 && current.schemaVersion < 5) await retirementVersion();
    await finishRelinkRetirements();
    // Reconcile before recovery can create a directory or expose any index.
    await saveLedger(ledger); await save(current);
    if (!recoveryOnly) {
      for (const account of [...current.accounts]) if (account.pendingCreation && !loginDeleting(account.id)) await createCharacter(account.id, { requestId: account.pendingCreation.requestId, runescapeName: account.pendingCreation.runescapeName, acknowledgeDuplicate: true });
      for (const picker of current.pickers.filter(p => p.lifecycle === 'active' && p.provisioning === 'reserved' && !loginDeleting(p.ownerAccountId))) await provision(picker.id);
    }
  } catch (failure) {
    for (const release of releases.reverse()) await release().catch(() => {});
    throw failure;
  }
  if (!recoveryOnly) retained = createLoginStorageBudget({ read: () => current, pickerRoot, registryDir,
    limits: loginLimits, groupMaxBytes });
  const api = {
    deletionPlan(accountId, input) { usable(); return copy(deletionPlan(current, accountId, input)); },
    deletionTransactions() { usable(); return copy(ledger.deletions ?? []); },
    getDeletion(id) { usable(); return copy(ledger.deletions?.find(d => d.id === id)); },
    beginCharacterDeletion(accountId, input, recheck = () => {}) { return enqueue(async () => {
      await recheck();
      if (lifecycleCapture) throw error(409, 'A service backup is in progress. Retry deletion after it finishes.');
      if (!REGISTRY_ACCOUNT.test(input.requestId)) throw error(400, 'A deletion request ID is required.');
      const old = ledger.deletions?.find(d => d.id === input.requestId);
      if (old) {
        if (old.accountId !== accountId || ['kind', 'characterId', 'pickerId', 'deleteGroup'].some(k => old[k] !== (input[k] ?? (k === 'deleteGroup' ? false : null)))) throw error(409, 'This deletion request ID was already used.');
        return old;
      }
      const plan = deletionPlan(current, accountId, input);
      if (plan.revision !== input.revision) throw error(409, 'The complete deletion target list changed. Review deletion again.');
      await retirementVersion();
      await recheck();
      if (ledger.deletions.length >= 20000) throw error(409, 'The deletion receipt limit has been reached. Existing maps are unchanged.');
      const d = { id: input.requestId, kind: plan.kind, accountId, characterId: plan.characterId, pickerId: plan.pickerId, deleteGroup: plan.deleteGroup,
        targets: plan.targets, groups: plan.groups, createdAt: timestamp(), completedAt: null, receiptProof: input.receiptProof ?? null };
      const nextLedger = copy(ledger); nextLedger.deletions.push(d);
      for (const t of d.targets) {
        if (!nextLedger.characters.some(c => c.characterId === t.characterId)) nextLedger.characters.push({ characterId: t.characterId, deletedAt: d.createdAt });
        if (!nextLedger.slots.some(s => slotKey(s) === slotKey(t))) nextLedger.slots.push({ pickerId: t.pickerId, memberId: t.memberId, characterId: t.characterId, retiredAt: d.createdAt });
      }
      await saveLedger(nextLedger); await point('deletion-intent');
      const next = copy(current); next.deletions = copy(ledger.deletions); await save(next); await point('deletion-registry-intent'); return d;
    }); },
    finishCharacterDeletion(id) { return enqueue(async () => {
      const nextLedger = copy(ledger), d = nextLedger.deletions.find(d => d.id === id);
      if (!d) throw error(409, 'Deletion intent required.');
      if (!d.completedAt) d.completedAt = timestamp();
      for (const pickerId of d.groups) deletion(nextLedger, pickerId);
      if (d.kind === 'account' && !nextLedger.accounts.some(a => a.accountId === d.accountId)) nextLedger.accounts.push({ accountId: d.accountId, deletedAt: d.completedAt, purgeProgress: 'pending' });
      await saveLedger(nextLedger); await point('deletion-retired');
      const changes = { accounts: [], pickers: [], removedCapabilities: [] }, next = reconcile(current, ledger, changes);
      for (const i of next.groupInvites) if (i.status === 'pending' && (d.groups.includes(i.pickerId) || d.targets.some(t => t.characterId === next.pickers.find(p => p.id === i.pickerId)?.ownerCharacterId))) {
        i.status = 'revoked'; i.terminalAt = timestamp(); const p = next.pickers.find(p => p.id === i.pickerId); p.reservations = p.reservations.filter(r => r.inviteId !== i.id); if (!changes.pickers.includes(p)) changes.pickers.push(p);
      }
      for (const h of next.handovers) if (h.status === 'pending' && d.targets.some(t => [h.fromCharacterId, h.toCharacterId].includes(t.characterId))) { h.status = 'cancelled'; h.resolvedAt = timestamp(); }
      await save(next, changes); await point('deletion-complete'); return d;
    }); },
    deletionCleanupMemberIds(pickerId) { return [...new Set((ledger.deletions ?? []).flatMap(d => d.targets.filter(t => t.pickerId === pickerId && !d.groups.includes(pickerId)).map(t => t.memberId)))]; },
    beginDeparture(accountId, characterId, pickerId, input) { return enqueue(() => { requireAllocation(accountId); requireAllocation(characterIndex.get(input?.characterId)?.accountId); if (lifecycleCapture) throw error(409, 'A service backup is in progress. Retry departure after it finishes.'); return departures.begin(accountId, characterId, pickerId, input); }); },
    prepareDeparture(id) { return enqueue(() => { requireAllocation(departures.get(id)?.accountId); return departures.prepare(id); }); },
    finishDeparture(id) { return enqueue(() => departures.finish(id)); },
    departureTransactions() { usable(); return departures.pending(); },
    getDeparture(id) { usable(); return departures.get(id); },
    departingMemberIds(pickerId) { return [...(current.departures ?? []).filter(d => !d.completedAt && d.source.pickerId === pickerId).map(d => d.source.memberId), ...(ledger.deletions ?? []).filter(d => !d.completedAt).flatMap(d => d.targets.filter(t => t.pickerId === pickerId).map(t => t.memberId))]; },
    retiredMemberIds(pickerId) { return [...new Set([...(current.departures ?? []).filter(d => d.completedAt && d.source.pickerId === pickerId).map(d => d.source.memberId), ...(ledger.slots ?? []).filter(s => s.pickerId === pickerId
      && !(ledger.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => slotKey(t) === slotKey(s)))
      && !(current.departures ?? []).some(d => !d.completedAt && slotKey(d.source) === slotKey(s))
      && !(current.groupInvites ?? []).some(i => i.transaction?.source && slotKey(i.transaction.source) === slotKey(s))).map(s => s.memberId)])]; },
    capturePastMap(meta, document) { return enqueue(() => departures.capture(meta, document)); },
    recoveryMemberDepartures(pickerId) {
      usable();
      const rows = new Map();
      for (const d of ledger.deletions ?? []) for (const t of d.targets) if (t.pickerId === pickerId && !d.groups.includes(pickerId)) {
        rows.set(t.memberId, { memberId: t.memberId, id: d.id + '-' + t.characterId, createdAt: d.createdAt });
      }
      const retired = new Set(api.retiredMemberIds(pickerId));
      for (const s of ledger.slots ?? []) if (s.pickerId === pickerId && retired.has(s.memberId) && !rows.has(s.memberId)) {
        const d = current.departures?.find(d => d.completedAt && slotKey(d.source) === slotKey(s));
        rows.set(s.memberId, { memberId: s.memberId, id: d?.id ?? `retired-${pickerId}-${s.memberId}`, createdAt: d?.createdAt ?? s.retiredAt });
      }
      return [...rows.values()];
    },
    listPastMaps(accountId) { usable(); return departures.list(accountId); },
    readPastMap(accountId, id) { usable(); return departures.readMap(accountId, id); },
    rejoinEligible(accountId, characterId) { usable(); return departureSoloEligible(current, accountId, characterId); },
    listGroupHandovers(accountId, characterId, pickerId) { usable(); return handovers.list(accountId, characterId, pickerId); },
    proposeGroupHandover(accountId, characterId, pickerId, input) { return enqueue(() => handovers.propose(accountId, characterId, pickerId, input)); },
    resolveGroupHandover(accountId, characterId, pickerId, id, action) { return enqueue(() => handovers.resolve(accountId, characterId, pickerId, id, action)); },
    groupInvitePoint(name, pickerId) { return point(name, pickerId); },
    createGroupInvite(accountId, pickerId, replaceId, characterId) { return enqueue(() => {
      requireAllocation(accountId);
      if (characterId && pickerIndex.get(pickerId)?.ownerCharacterId !== characterId) throw error(403, 'Select the current designated owner to manage invitations.');
      return groupInvites.create(accountId, pickerId, replaceId);
    }); },
    listGroupInvites(accountId, pickerId) { usable(); return groupInvites.list(accountId, pickerId); },
    previewGroupInvite(secret) { usable(); return groupInvites.preview(secret); },
    revokeGroupInvite(accountId, pickerId, id, characterId) { return enqueue(() => {
      if (characterId && pickerIndex.get(pickerId)?.ownerCharacterId !== characterId) throw error(403, 'Select the current designated owner to manage invitations.');
      return groupInvites.revoke(accountId, pickerId, id);
    }); },
    beginGroupJoin(secret, accountId, input) { return enqueue(() => { requireAllocation(accountId); if (lifecycleCapture) throw error(409, 'A service backup is in progress. Retry joining after it finishes.'); return groupInvites.begin(secret, accountId, input); }); },
    finishGroupJoin(id) { return enqueue(async () => {
      requireAllocation(groupInvites.transactions().find(i => i.id === id)?.acceptingAccountId);
      if (groupInvites.transactions().some(i => i.id === id && i.transaction.source)) await retirementVersion();
      return groupInvites.finish(id);
    }); },
    groupJoinTransactions() { usable(); return groupInvites.transactions(); },
    groupJoinConflict(id) { usable(); return groupInvites.conflict(id); },
    cancelConflictingGroupJoin(id) { return enqueue(() => groupInvites.cancelConflict(id)); },
    groupJoinEligible(accountId, characterId) { usable(); return groupInvites.eligible(accountId, characterId); },
    cleanGroupInvites() { return enqueue(() => groupInvites.clean()); },
    pickerJoining(id) { return (current.groupInvites ?? []).some(i => i.transaction?.source?.pickerId === id) || (current.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(id)); },
    pickerAdmissionPending(id) { return (ledger.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === id)) || (current.groupInvites ?? []).some(i => i.transaction && (i.pickerId === id || i.transaction.source?.pickerId === id)) || (current.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(id)); },
    // Diagnostic read, never used by request admission. Tests compare a rescan.
    capCounts() { usable(); return capCounts.snapshot(); },
    // Queue-held read-only checkpoint. No provider subjects or capabilities may
    // leave the server; explicit account IDs and memberships survive recovery.
    withRecoveryCheckpoint(work) { return enqueue(() => work(registryRecoveryDocument(current, caps, { allowPendingDeletion: recoveryOnly }))); },
    async withLifecycleCapture(work) {
      usable(); if (lifecycleCapture) throw error(503, 'A service backup is already running.'); lifecycleCapture = true;
      try { return await work(); } finally { lifecycleCapture = false; }
    },
    getAccount(id) { usable(); return visibleAccount(id); },
    listAccounts() { usable(); return [...accountIndex.keys()].map(visibleAccount).filter(Boolean); },
    getCharacter(id) { usable(); return copy(characterIndex.get(id)); },
    listCharacters(accountId) {
      usable();
      return [...characterIndex.values()].filter(c => c.accountId === accountId && c.lifecycle === 'active').map(c => {
        const picker = visiblePicker(pickerIndex.get(c.placement.pickerId));
        const membership = visibleAccount(accountId)?.memberships.find(m => m.pickerId === picker?.id && m.memberId === c.placement.memberId);
        return { ...copy(c), role: membership?.role ?? null, groupLabel: picker?.kind === 'legacy-shared' ? 'Shared game' : picker?.seats.length > 1 ? 'Group game' : 'Solo game', playerCount: picker?.seats.length ?? 0,
          available: Boolean(membership && picker?.lifecycle === 'active' && picker.provisioning === 'ready' && !api.pickerAdmissionPending(picker.id)), transitionPending: Boolean(picker && api.pickerAdmissionPending(picker.id)), href: `/characters/${c.id}` };
      });
    },
    selectCharacter(accountId, requested, pickerId) {
      usable(); const account = visibleAccount(accountId);
      const available = id => { const c = characterIndex.get(id), picker = pickerIndex.get(c?.placement?.pickerId);
        return c?.lifecycle === 'active' && !(ledger.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.characterId === id)) && c.accountId === accountId && picker?.lifecycle === 'active' && !blockedPicker(picker.id) && !api.pickerJoining(picker.id) && picker.provisioning === 'ready'
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
    // Names project authorized schema-1 gameplay. Publish after gameplay, retry
    // before replies and on open; metadata never grants rename authority.
    updateCharacterNames(pickerId, members) { return enqueue(async () => {
      if (pickerId === 'legacy') pickerId = current.pickers.find(p => p.kind === 'legacy-shared')?.id;
      const updates = current.characters.filter(c => c.lifecycle === 'active' && c.placement.pickerId === pickerId
        && !(ledger.deletions ?? []).some(d => d.targets.some(t => t.characterId === c.id))
        && !(current.departures ?? []).some(d => !d.completedAt && d.characterId === c.id && d.source.pickerId === pickerId))
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
    getPicker(id) { usable(); return visiblePicker(pickerIndex.get(id)) ?? copy(departures.destination(id)); },
    listPickers() { usable(); return current.pickers.map(visiblePicker); },
    pickerDirectory(id) {
      usable(); if (typeof id !== 'string' || !PICKER.test(id)) throw error(400, 'Invalid picker ID.');
      const picker = current.pickers.find(p => p.id === id) ?? departures.destination(id);
      if (!picker) throw error(404, 'Picker not found.');
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
        const nextLedger = copy(ledger); retireAccount(nextLedger, source.id, true); enforceCaps(next, nextLedger); checkRetirementCapacity(next, nextLedger);
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
      if (existing) requireAllocation(existing.id);
      if (!existing || !existing.initialProvisioned && !existing.pendingCreation) checkPickerAllocation();
      if (!existing && current.characters.filter(c => c.lifecycle === 'active').length >= caps.characters) throw characterError('The service character limit has been reached. Existing maps are unchanged.');
      if (!existing && ledger.issuedCharacterIds.length >= caps.issuedCharacterIds) throw characterError('The character ID history limit has been reached. Existing IDs cannot be reused.');
      const next = copy(current), account = ensureIdentity(next, provider, subject);
      if (!existing) {
        const proposal = copy(next); proposal.accounts.find(a => a.id === account.id).pendingCreation = { pickerId: 'new-picker' };
        await retained.admit(proposal);
      }
      await save(next, { accounts: [account] });
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
      if (api.retiredMemberIds(pickerId).some(id => memberIds.includes(id))) throw error(422, 'Historical slots cannot be restored into the active roster. Keep the current character mapping.');
      if (required.some(id => !memberIds.includes(id))) throw error(422, 'Roster mapping must keep every assigned participant.');
      picker.memberIds = [...new Set([...picker.memberIds, ...memberIds])];
      await save(next, { pickers: [picker] }); return picker;
    }); },
    ensureDefaultPicker(accountId) { return enqueue(() => ensureDefault(accountId)); },
    attachMembership(accountId, membership) { return enqueue(async () => {
      requireAllocation(accountId);
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
        if (input.memberships.some(m => m.role !== 'viewer' && !current.characters.some(c => c.lifecycle === 'active' && c.accountId === input.id && c.placement.pickerId === picker?.id && c.placement.memberId === m.memberId))) requireAllocation(input.id);
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
    revokeMemberPluginKeys(pickerId, memberId) { return enqueue(async () => {
      const picker = pickerId === 'legacy' ? current.pickers.find(p => p.kind === 'legacy-shared') : requirePicker(current, pickerId);
      if (!picker) return;
      const removedCapabilities = current.capabilities.filter(c => c.kind === 'plugin-key' && c.pickerId === picker.id && c.memberId === memberId);
      if (!removedCapabilities.length) return;
      const next = { ...current, capabilities: current.capabilities.filter(c => !removedCapabilities.includes(c)) };
      await save(next, { removedCapabilities });
    }); },
    beginPickerDeletion(id, { onTombstone } = {}) { return enqueue(async () => {
      if (requirePicker(current, id).kind === 'legacy-shared') throw error(409, 'The shared picker cannot be deleted.');
      if ((current.groupInvites ?? []).some(i => i.transaction && [i.pickerId, i.transaction.source?.pickerId].includes(id))
        || (current.departures ?? []).some(d => !d.completedAt && [d.source.pickerId, d.destination.pickerId].includes(id))
        || (current.handovers ?? []).some(h => h.status === 'pending' && h.pickerId === id)
        || (current.deletions ?? []).some(d => !d.completedAt && d.targets.some(t => t.pickerId === id))) throw error(409, 'A group lifecycle change is pending. Finish or cancel it before deleting this group.');
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
      requireLoginDeletionReady(current, accountId);
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
      retained?.close();
      const results = await Promise.allSettled(releases.reverse().map(release => release()));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    })(); },
  };
  // A schema-1 checkpoint can only reconcile existing deletion decisions. It
  // must not expose login, character, identity or provisioning operations.
  return recoveryOnly ? Object.fromEntries(['withRecoveryCheckpoint', 'reconcileTombstones', 'retiredMemberIds', 'recoveryMemberDepartures', 'isAccountDeleted',
    'deletionRecords', 'deletionDirectory', 'advanceDeletion', 'completePickerDeletion', 'close'].map(name => [name, api[name]])) : api;
}

export function registryRecoveryDocument(document, caps = { characters: Number.MAX_SAFE_INTEGER, charactersPerAccount: Number.MAX_SAFE_INTEGER }, { allowPendingDeletion = false } = {}) {
  validate(document);
  // Standalone checkpoint inspection has no live configuration. Enforce its
  // bindings here; the configured writer enforces capacity when installing it.
  if (document.schemaVersion >= 2) validateCharacters(document, caps);
  validateGroupInvites(document);
  validateHandovers(document);
  validateDepartures(document);
  if (document.departures?.some(d => !d.completedAt)) throw error(409, 'Departure is pending. Resume it before taking a checkpoint.');
  if (document.groupInvites?.some(i => i.transaction)) throw error(409, 'Group admission is pending. Resume it before taking a checkpoint.');
  if (document.relinkRetirements?.length) throw error(409, 'Account retirement is pending. Restart the service before taking a checkpoint.');
  if (!allowPendingDeletion && document.deletions?.some(d => !d.completedAt)) throw error(409, 'Deletion is pending. Resume it before taking a checkpoint.');
  return { schemaVersion: document.schemaVersion,
    accounts: document.accounts.map(account => ({ ...copy(account), identities: [] })),
    pickers: copy(document.pickers).map(p => document.schemaVersion >= 3 ? { ...p, reservations: [] } : p), capabilities: [], ...(document.schemaVersion >= 2 ? { characters: copy(document.characters) } : {}),
    ...(document.schemaVersion >= 3 ? { groupInvites: document.groupInvites.map(i => ({ ...copy(i), secretHash: null, ...(i.status === 'pending' ? { status: 'revoked', terminalAt: i.createdAt } : {}) })) } : {}),
    ...(document.schemaVersion >= 4 ? { handovers: document.handovers.map(h => ({ ...copy(h), ...(h.status === 'pending' ? { status: 'cancelled', resolvedAt: h.createdAt } : {}) })), departures: copy(document.departures), pastMaps: copy(document.pastMaps) } : {}),
    ...(document.schemaVersion === 5 ? { deletions: document.deletions.map(({ receiptProof, ...d }) => copy(d)) } : {}) };
}
