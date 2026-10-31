import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { durableDirectory, lockRegistry, syncDirectory, writeRegistryJson } from './registry-lock.mjs';
import { REGISTRY_ACCOUNT, registryIdentity, registryMembers, registryObject as object } from './registry-legacy.mjs';

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
export const DEFAULT_REGISTRY_CAPS = Object.freeze({ accounts: 1000, pickers: 1000, issuedPickerIds: 1000000,
  retiredAccounts: 1000000, membershipsPerAccount: 1000, membersPerPicker: 100, capabilities: 10000, capabilitiesPerPicker: 100 });
export const REGISTRY_PROVISION_POINTS = Object.freeze(['account-recorded', 'id-reserved', 'registry-reserved', 'directory-created', 'directory-synced', 'registry-ready']);

function validateLedger(ledger) {
  if (!object(ledger, ['schemaVersion', 'issuedPickerIds', 'pickers', 'accounts']) || ledger.schemaVersion !== 1 || !Array.isArray(ledger.issuedPickerIds) || !Array.isArray(ledger.pickers) || !Array.isArray(ledger.accounts)) bad();
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

function validate(document) {
  if (!object(document, ['schemaVersion', 'accounts', 'pickers', 'capabilities', 'relinkCodes', 'relinkRetirements']) || document.schemaVersion !== 1 || !Array.isArray(document.accounts) || !Array.isArray(document.pickers) || !Array.isArray(document.capabilities)) bad();
  if (document.relinkCodes !== undefined) {
    if (!Array.isArray(document.relinkCodes)) bad();
    const seen = new Set();
    for (const entry of document.relinkCodes) {
      if (!object(entry, ['accountId', 'hash', 'expiresAt']) || !REGISTRY_ACCOUNT.test(entry.accountId) || !HASH.test(entry.hash) || !date(entry.expiresAt) || seen.has(entry.accountId)) bad();
      seen.add(entry.accountId);
    }
  }
  if (document.relinkRetirements !== undefined && (!Array.isArray(document.relinkRetirements) || document.relinkRetirements.some(id => !REGISTRY_ACCOUNT.test(id)) || new Set(document.relinkRetirements).size !== document.relinkRetirements.length)) bad();
  const accounts = new Map(), pickers = new Map(), identities = new Set(), defaults = new Set();
  let legacy = 0;
  for (const picker of document.pickers) {
    if (!object(picker, ['id', 'kind', 'ownerAccountId', 'lifecycle', 'provisioning', 'memberIds', 'createdAt']) || !PICKER.test(picker.id) || pickers.has(picker.id) || !['default', 'legacy-shared'].includes(picker.kind) || !['active', 'deleting', 'deleted'].includes(picker.lifecycle) || !['reserved', 'ready'].includes(picker.provisioning) || !date(picker.createdAt)) bad();
    registryMembers(picker.memberIds);
    if (picker.kind === 'legacy-shared') { if (++legacy > 1 || picker.ownerAccountId !== null || picker.provisioning !== 'ready' || picker.memberIds.length !== 2) bad(); }
    else if (!REGISTRY_ACCOUNT.test(picker.ownerAccountId)) bad();
    pickers.set(picker.id, picker);
  }
  for (const account of document.accounts) {
    if (!object(account, ['id', 'identities', 'memberships', 'defaultPickerId', 'createdAt']) || !REGISTRY_ACCOUNT.test(account.id) || accounts.has(account.id) || !Array.isArray(account.identities) || account.identities.length > 2 || !Array.isArray(account.memberships) || !date(account.createdAt)) bad();
    accounts.set(account.id, account);
    const providers = new Set(), memberships = new Set();
    for (const identity of account.identities) {
      if (!object(identity, ['provider', 'subject'])) bad();
      registryIdentity(identity.provider, identity.subject);
      const key = identityKey(identity.provider, identity.subject);
      if (identities.has(key) || providers.has(identity.provider)) bad();
      identities.add(key); providers.add(identity.provider);
    }
    for (const membership of account.memberships) {
      const picker = pickers.get(membership?.pickerId);
      const key = JSON.stringify([membership?.pickerId, membership?.memberId]);
      if (!object(membership, ['pickerId', 'role', 'memberId']) || !picker || picker.lifecycle !== 'active' || !roles.includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !picker.memberIds.includes(membership.memberId)) || memberships.has(key) || (membership.role === 'owner' && (picker.kind !== 'default' || picker.ownerAccountId !== account.id))) bad();
      memberships.add(key);
    }
    if (account.defaultPickerId !== null) {
      const picker = pickers.get(account.defaultPickerId);
      if (!picker || picker.kind !== 'default' || picker.ownerAccountId !== account.id || picker.lifecycle === 'deleted' || defaults.has(picker.id)) bad();
      defaults.add(picker.id);
    }
  }
  for (const picker of document.pickers) {
    if (picker.kind === 'default' && picker.lifecycle === 'active') {
      const account = accounts.get(picker.ownerAccountId);
      if (!account || account.defaultPickerId !== picker.id || !account.memberships.some(m => m.pickerId === picker.id && m.role === 'owner')) bad();
    }
  }
  const capabilities = new Set();
  for (const capability of document.capabilities) {
    const account = accounts.get(capability?.accountId), picker = pickers.get(capability?.pickerId);
    const key = capabilityKey(capability?.kind, capability?.hash);
    if (!object(capability, ['kind', 'hash', 'pickerId', 'accountId', 'memberId']) || !kinds.includes(capability.kind) || typeof capability.hash !== 'string' || !HASH.test(capability.hash) || capabilities.has(key) || !picker || picker.lifecycle !== 'active' || picker.provisioning !== 'ready' || !account?.memberships.some(m => m.pickerId === picker.id && m.memberId === capability.memberId && (capability.kind !== 'plugin-key' || m.role !== 'viewer'))) bad();
    capabilities.add(key);
  }
  return document;
}

function reconcile(document, ledger) {
  const next = copy(document), blocked = new Map(ledger.pickers.map(entry => [entry.pickerId, entry]));
  const deletedAccounts = new Set(ledger.accounts.map(entry => entry.accountId));
  next.accounts = next.accounts.filter(account => !deletedAccounts.has(account.id));
  for (const picker of next.pickers) {
    const tombstone = blocked.get(picker.id);
    if (tombstone) picker.lifecycle = tombstone.lifecycle;
  }
  for (const account of next.accounts) {
    account.memberships = account.memberships.filter(m => !blocked.has(m.pickerId));
    if (blocked.get(account.defaultPickerId)?.lifecycle === 'deleted') account.defaultPickerId = null;
  }
  next.capabilities = next.capabilities.filter(c => !blocked.has(c.pickerId) && !deletedAccounts.has(c.accountId));
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
  crashPoint, pickerRandomBytes = randomBytes } = {}) {
  if ([registryDir, pickerRoot, tombstoneDir].some(dir => typeof dir !== 'string' || !dir)) throw new TypeError('Registry, picker and tombstone roots are required.');
  const caps = { ...DEFAULT_REGISTRY_CAPS, ...overrides };
  if (!object(overrides, Object.keys(DEFAULT_REGISTRY_CAPS)) || Object.values(caps).some(n => !Number.isSafeInteger(n) || n < 1)) throw new TypeError('Invalid registry caps.');
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
  let providerIndex, capabilityIndex, accountIndex, tombstoneIndex, retiredAccounts, issuedIds;
  const file = path.join(registryDir, 'registry.json'), ledgerFile = path.join(tombstoneDir, 'ledger.json');
  const timestamp = () => new Date(now()).toISOString();
  const usable = () => { if (closed || failed) throw new Error('Registry is closed or requires restart.'); };
  const rebuildIndexes = () => {
    accountIndex = new Map(current.accounts.map(a => [a.id, a]));
    providerIndex = new Map(current.accounts.flatMap(a => a.identities.map(i => [identityKey(i.provider, i.subject), a.id])));
    capabilityIndex = new Map(current.capabilities.map(c => [capabilityKey(c.kind, c.hash), c]));
  };
  const rebuildLedgerIndexes = () => {
    tombstoneIndex = new Map(ledger.pickers.map(t => [t.pickerId, t]));
    retiredAccounts = new Set(ledger.accounts.map(t => t.accountId));
    issuedIds = new Set(ledger.issuedPickerIds);
  };
  function enforceCaps(next, nextLedger = ledger) {
    const limited = next.accounts.length > caps.accounts || next.pickers.filter(p => p.lifecycle !== 'deleted').length > caps.pickers || nextLedger.issuedPickerIds.length > caps.issuedPickerIds || nextLedger.accounts.length > caps.retiredAccounts || next.capabilities.length > caps.capabilities || next.accounts.some(a => a.memberships.length > caps.membershipsPerAccount) || next.pickers.some(p => p.memberIds.length > caps.membersPerPicker || next.capabilities.filter(c => c.pickerId === p.id).length > caps.capabilitiesPerPicker);
    if (limited) throw error(409, 'Registry capacity has been reached.');
  }
  async function save(next) {
    validate(next); enforceCaps(next);
    try { await writeRegistryJson(file, next); current = next; rebuildIndexes(); }
    catch (failure) { failed = true; throw failure; }
  }
  async function saveLedger(next) {
    validateLedger(next); enforceCaps(current, next);
    try { await writeRegistryJson(ledgerFile, next); ledger = next; rebuildLedgerIndexes(); }
    catch (failure) { failed = true; throw failure; }
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
      if (next.accounts.length >= caps.accounts) throw error(409, 'Registry capacity has been reached.');
      let id;
      do { id = randomUUID(); } while (next.accounts.some(a => a.id === id) || retiredAccounts.has(id));
      account = { id, identities: [{ provider, subject }], memberships: [], defaultPickerId: null, createdAt: timestamp() };
      next.accounts.push(account);
    }
    return account;
  }
  async function allocate() {
    if (current.pickers.filter(p => p.lifecycle !== 'deleted').length >= caps.pickers) throw error(409, 'Registry capacity has been reached.');
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
      const next = copy(ledger); next.issuedPickerIds.push(id); await saveLedger(next);
      await point('id-reserved', id); return id;
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
    const next = copy(current); requirePicker(next, id).provisioning = 'ready'; await save(next);
    await point('registry-ready', id); return requirePicker(current, id);
  }
  async function ensureDefault(accountId) {
    const account = requireAccount(current, accountId);
    if (account.defaultPickerId) return provision(account.defaultPickerId);
    if (account.memberships.length >= caps.membershipsPerAccount) throw error(409, 'Registry capacity has been reached.');
    const id = await allocate(), next = copy(current), owner = requireAccount(next, accountId);
    const picker = { id, kind: 'default', ownerAccountId: accountId, lifecycle: 'active', provisioning: 'reserved', memberIds: ['owner'], createdAt: timestamp() };
    next.pickers.push(picker); owner.defaultPickerId = id;
    owner.memberships.push({ pickerId: id, role: 'owner', memberId: 'owner' });
    await save(next); await point('registry-reserved', id); return provision(id);
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
    const next = reconcile(current, ledger); delete next.relinkRetirements;
    await save(next); await point('relink-reconciled');
  }
  async function applyTombstones() {
    const next = reconcile(current, ledger);
    // Retired IDs can exist only in the external ledger after restoring an older checkpoint.
    validate(next);
    if (JSON.stringify(next) !== JSON.stringify(current)) await save(next);
    return { blockedPickerIds: ledger.pickers.map(t => t.pickerId), deletedAccountIds: ledger.accounts.map(t => t.accountId) };
  }
  const blockedPicker = id => tombstoneIndex.get(id);
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
    // Only a missing file starts empty; a JSON null document fails validation.
    if (current !== undefined && ledger === undefined) throw new Error('Registry ledger is missing.');
    if (current === undefined) current = { schemaVersion: 1, accounts: [], pickers: [], capabilities: [] };
    if (ledger === undefined) ledger = { schemaVersion: 1, issuedPickerIds: [], pickers: [], accounts: [] };
    validateLedger(ledger); validate(current);
    if (current.pickers.some(p => !ledger.issuedPickerIds.includes(p.id) || p.lifecycle !== 'active' && !ledger.pickers.some(t => t.pickerId === p.id))) bad();
    current = reconcile(current, ledger); validate(current); enforceCaps(current); rebuildIndexes(); rebuildLedgerIndexes();
    await finishRelinkRetirements();
    // Reconcile before recovery can create a directory or expose any index.
    await saveLedger(ledger); await save(current);
    for (const picker of current.pickers.filter(p => p.lifecycle === 'active' && p.provisioning === 'reserved')) await provision(picker.id);
  } catch (failure) {
    for (const release of releases.reverse()) await release().catch(() => {});
    throw failure;
  }
  return {
    // Queue-held read-only checkpoint. No provider subjects or capabilities may
    // leave the server; explicit account IDs and memberships survive recovery.
    withRecoveryCheckpoint(work) { return enqueue(() => work(registryRecoveryDocument(current))); },
    getAccount(id) { usable(); return visibleAccount(id); },
    listAccounts() { usable(); return [...accountIndex.keys()].map(visibleAccount).filter(Boolean); },
    findIdentity(provider, subject) { usable(); registryIdentity(provider, subject); return visibleAccount(providerIndex.get(identityKey(provider, subject))); },
    getPicker(id) { usable(); return visiblePicker(current.pickers.find(p => p.id === id)); },
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
      const code = randomBytes(32).toString('base64url'), next = copy(current);
      const expiresAt = new Date(now() + expiresInMs).toISOString();
      next.relinkCodes = (next.relinkCodes ?? []).filter(c => c.accountId !== accountId && Date.parse(c.expiresAt) > now());
      next.relinkCodes.push({ accountId, hash: createHash('sha256').update(code).digest('hex'), expiresAt });
      await save(next); return { code, expiresAt };
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
      await point('relink-before-commit'); await save(next);
      try {
        onCommit?.(source?.defaultPickerId);
        await point('relink-committed'); await finishRelinkRetirements();
      } catch (failure) { failed = true; throw failure; }
      return requireAccount(current, target.id);
    }); },
    ensureIdentity(provider, subject) { return enqueue(async () => { const next = copy(current), account = ensureIdentity(next, provider, subject); await save(next); return account; }); },
    linkIdentity(accountId, provider, subject) { return enqueue(async () => { const next = copy(current), account = requireAccount(next, accountId); addIdentity(next, account, provider, subject); await save(next); return account; }); },
    unlinkIdentity(accountId, provider) { return enqueue(async () => {
      if (!['discord', 'google'].includes(provider)) throw error(400, 'Invalid sign-in provider.');
      const next = copy(current), account = requireAccount(next, accountId); account.identities = account.identities.filter(i => i.provider !== provider); await save(next); return account;
    }); },
    firstLogin(provider, subject) { return enqueue(async () => {
      const next = copy(current), account = ensureIdentity(next, provider, subject); await save(next);
      await point('account-recorded', account.defaultPickerId);
      const picker = await ensureDefault(account.id); return { account: requireAccount(current, account.id), picker };
    }); },
    ensureDefaultPicker(accountId) { return enqueue(() => ensureDefault(accountId)); },
    attachMembership(accountId, membership) { return enqueue(async () => {
      const next = copy(current), account = requireAccount(next, accountId), picker = activePicker(next, membership?.pickerId);
      if (!object(membership, ['pickerId', 'role', 'memberId']) || !roles.includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !picker.memberIds.includes(membership.memberId)) || (membership.role === 'owner' && (picker.kind !== 'default' || picker.ownerAccountId !== accountId))) throw error(400, 'Invalid picker membership.');
      const existing = account.memberships.find(m => m.pickerId === picker.id && m.memberId === membership.memberId);
      if (existing && existing.role !== membership.role) throw error(409, 'Membership is already assigned.');
      if (!existing) account.memberships.push(copy(membership));
      await save(next); return account;
    }); },
    removeMembership(accountId, pickerId, memberId) { return enqueue(async () => {
      const next = copy(current), account = requireAccount(next, accountId);
      if (account.memberships.some(m => m.pickerId === pickerId && m.memberId === memberId && m.role === 'owner')) throw error(409, 'Delete the owned picker before removing its owner.');
      account.memberships = account.memberships.filter(m => m.pickerId !== pickerId || m.memberId !== memberId);
      next.capabilities = next.capabilities.filter(c => c.accountId !== accountId || c.pickerId !== pickerId || c.memberId !== memberId);
      await save(next); return account;
    }); },
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
        if (!account) { account = { id: input.id, identities: [], memberships: [], defaultPickerId: null, createdAt: timestamp() }; next.accounts.push(account); }
        for (const identity of input.identities) {
          if (!object(identity, ['provider', 'subject'])) throw new TypeError('Invalid legacy registration.');
          addIdentity(next, account, identity.provider, identity.subject);
        }
        for (const membership of input.memberships) if (!object(membership, ['role', 'memberId']) || !['player', 'viewer'].includes(membership.role) || (membership.role === 'viewer' ? membership.memberId !== null : !plan.memberIds.includes(membership.memberId))) throw new TypeError('Invalid legacy registration.');
      }
      validate(next); enforceCaps(next);
      if (!picker) {
        const id = await allocate();
        picker = { id, kind: 'legacy-shared', ownerAccountId: null, lifecycle: 'active', provisioning: 'ready', memberIds: copy(plan.memberIds), createdAt: timestamp() }; next.pickers.push(picker);
      }
      for (const input of plan.accounts) for (const membership of input.memberships) {
        const account = requireAccount(next, input.id);
        if (!account.memberships.some(m => m.pickerId === picker.id && m.memberId === membership.memberId && m.role === membership.role)) account.memberships.push({ pickerId: picker.id, ...membership });
      }
      await save(next); return picker;
    }); },
    setCapability(input) { return enqueue(async () => {
      const next = copy(current);
      if (!object(input, ['kind', 'hash', 'pickerId', 'accountId', 'memberId']) || !kinds.includes(input.kind) || typeof input.hash !== 'string' || !HASH.test(input.hash)) throw error(400, 'Invalid capability index entry.');
      activePicker(next, input.pickerId);
      const existing = next.capabilities.find(c => c.kind === input.kind && c.hash === input.hash);
      if (existing && JSON.stringify(existing) !== JSON.stringify(input)) {
        if (['pickerId', 'accountId', 'memberId'].some(key => existing[key] !== input[key])) throw error(409, 'Capability hash is already assigned.');
      }
      if (!existing) next.capabilities.push({ kind: input.kind, hash: input.hash, pickerId: input.pickerId, accountId: input.accountId, memberId: input.memberId });
      await save(next); return input;
    }); },
    resolveCapability(kind, hash) {
      usable(); if (!kinds.includes(kind) || typeof hash !== 'string' || !HASH.test(hash)) return null;
      const capability = capabilityIndex.get(capabilityKey(kind, hash));
      return capability && !blockedPicker(capability.pickerId) && !retiredAccounts.has(capability.accountId) ? copy(capability) : null;
    },
    revokeCapability(kind, hash) { return enqueue(async () => {
      const next = copy(current); next.capabilities = next.capabilities.filter(c => c.kind !== kind || c.hash !== hash); await save(next);
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
}

export function registryRecoveryDocument(document) {
  validate(document);
  if (document.relinkRetirements?.length) throw error(409, 'Account retirement is pending. Restart the service before taking a checkpoint.');
  return { schemaVersion: document.schemaVersion,
    accounts: document.accounts.map(account => ({ ...copy(account), identities: [] })),
    pickers: copy(document.pickers), capabilities: [] };
}
