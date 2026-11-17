// Frozen schema-1 reader gates from the parent of the stage-1 design commit.
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { generateToken } from '../../app/security/tokens.mjs';
import path from 'node:path';
import { durableDirectory, lockRegistry, syncDirectory, writeRegistryJson } from '../../app/storage/registry-lock.mjs';
import { REGISTRY_ACCOUNT, registryIdentity, registryMembers, registryObject as object } from '../../app/storage/registry-legacy.mjs';
import { createRegistryCaps } from '../../app/storage/registry-caps.mjs';

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
  retiredAccounts: 1000000, membershipsPerAccount: 1000, membersPerPicker: 100, capabilities: 20000, capabilitiesPerPicker: 100 });
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

function validate(document, selection) {
  if (!object(document, ['schemaVersion', 'accounts', 'pickers', 'capabilities', 'relinkCodes', 'relinkRetirements']) || document.schemaVersion !== 1 || !Array.isArray(document.accounts) || !Array.isArray(document.pickers) || !Array.isArray(document.capabilities)) bad();
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
    if (!object(picker, ['id', 'kind', 'ownerAccountId', 'lifecycle', 'provisioning', 'memberIds', 'createdAt']) || !PICKER.test(picker.id) || pickers.has(picker.id) || !['default', 'legacy-shared'].includes(picker.kind) || !['active', 'deleting', 'deleted'].includes(picker.lifecycle) || !['reserved', 'ready'].includes(picker.provisioning) || !date(picker.createdAt)) bad();
    registryMembers(picker.memberIds);
    if (picker.kind === 'legacy-shared') { if (++legacy > 1 || picker.ownerAccountId !== null || picker.provisioning !== 'ready' || picker.memberIds.length !== 2) bad(); }
    else if (!REGISTRY_ACCOUNT.test(picker.ownerAccountId)) bad();
    pickers.set(picker.id, picker);
  }
  for (const account of accountRows) {
    if (selection && account.deleted) { accounts.set(account.id, null); continue; }
    if (!object(account, ['id', 'identities', 'memberships', 'defaultPickerId', 'createdAt']) || !REGISTRY_ACCOUNT.test(account.id) || accounts.has(account.id) || !Array.isArray(account.identities) || account.identities.length > 2 || !Array.isArray(account.memberships) || !date(account.createdAt)) bad();
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
      if (!account || account.defaultPickerId !== picker.id || !account.memberships.some(m => m.pickerId === picker.id && m.role === 'owner')) bad();
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


export { validate as validateOriginalRegistry, validateLedger as validateOriginalLedger };
