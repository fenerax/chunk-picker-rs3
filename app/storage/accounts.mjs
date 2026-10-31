import { withStoreWrite } from './snapshot.mjs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicWrite } from './invites.mjs';

const UUID = /^[a-f0-9-]{36}$/;
const MEMBER = /^[A-Za-z0-9_-]{1,64}$/;
const providers = new Set(['discord', 'google']);
const error = (status, message) => Object.assign(new Error(message), { status });
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
function identityInput(provider, subject) {
  if (!providers.has(provider) || typeof subject !== 'string' || !subject || subject.length > 255 || /[\u0000-\u0020\u007f-\u009f]/.test(subject)) throw error(400, 'Invalid sign-in identity.');
}
function validate(document) {
  if (!keys(document, ['schemaVersion', 'accounts']) || document.schemaVersion !== 1 || !Array.isArray(document.accounts) || document.accounts.length > 1000) throw new TypeError('Invalid account store.');
  const ids = new Set(), identities = new Set();
  for (const account of document.accounts) {
    if (!keys(account, ['id', 'identities', 'memberships', 'createdAt', 'lastUsedAt']) || !UUID.test(account.id) || ids.has(account.id) || !Array.isArray(account.identities) || account.identities.length > 2 || !Array.isArray(account.memberships) || account.memberships.length > 1000 || !validDate(account.createdAt) || !validDate(account.lastUsedAt)) throw new TypeError('Invalid account record.');
    ids.add(account.id);
    const linked = new Set(), memberships = new Set();
    for (const identity of account.identities) {
      if (!keys(identity, ['provider', 'subject', 'createdAt', 'lastUsedAt']) || !validDate(identity.createdAt) || !validDate(identity.lastUsedAt)) throw new TypeError('Invalid account identity.');
      identityInput(identity.provider, identity.subject);
      const key = JSON.stringify([identity.provider, identity.subject]);
      if (linked.has(identity.provider) || identities.has(key)) throw new TypeError('Duplicate account identity.');
      linked.add(identity.provider); identities.add(key);
    }
    for (const membership of account.memberships) {
      if (!keys(membership, ['id', 'inviteId', 'role', 'memberId']) || !UUID.test(membership.inviteId) || membership.id !== membership.inviteId || memberships.has(membership.id) || !['player', 'viewer'].includes(membership.role) || (membership.role === 'player' ? typeof membership.memberId !== 'string' || !MEMBER.test(membership.memberId) : membership.memberId !== null)) throw new TypeError('Invalid account membership.');
      memberships.add(membership.id);
    }
  }
  return document;
}

/** Open under the gameplay store's existing exclusive data-directory lock. */
export async function openAccountStore({ dataDir, now = Date.now } = {}) {
  const file = path.join(dataDir, 'accounts.json');
  let current;
  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
  catch (failure) {
    if (failure.code !== 'ENOENT') throw new Error('Invalid account store.');
    current = { schemaVersion: 1, accounts: [] };
  }
  let queue = Promise.resolve(), closed = false;
  const uses = new Map();
  const clone = value => value ? structuredClone(value) : null;
  const find = (document, provider, subject) => document.accounts.find(account => account.identities.some(identity => identity.provider === provider && identity.subject === subject));
  function mutate(operation) {
    if (closed) return Promise.reject(new Error('Account store is closed.'));
    const pending = queue.then(() => withStoreWrite(dataDir, async () => {
      const next = structuredClone(current), result = operation(next);
      validate(next);
      await atomicWrite(file, next); current = next;
      return clone(result);
    }));
    queue = pending.catch(() => {});
    return pending;
  }
  function requireAccount(document, id) {
    const account = document.accounts.find(account => account.id === id);
    if (!account) throw error(404, 'Account not found.');
    return account;
  }
  return {
    get(id) { return clone(current.accounts.find(account => account.id === id)); },
    findIdentity(provider, subject) { identityInput(provider, subject); return clone(find(current, provider, subject)); },
    list() { return current.accounts.map(({ id, identities, memberships, createdAt, lastUsedAt }) => ({ id, providers: identities.map(identity => identity.provider), memberships: structuredClone(memberships), createdAt, lastUsedAt })); },
    touch(id, provider) {
      const account = current.accounts.find(item => item.id === id);
      const identity = account?.identities.find(item => item.provider === provider);
      if (!identity || now() - Date.parse(identity.lastUsedAt) < 60000) return Promise.resolve();
      const key = JSON.stringify([id, provider]);
      if (uses.has(key)) return uses.get(key);
      const pending = mutate(next => {
        const live = next.accounts.find(item => item.id === id);
        const linked = live?.identities.find(item => item.provider === provider);
        if (linked) { const timestamp = new Date(now()).toISOString(); linked.lastUsedAt = timestamp; live.lastUsedAt = timestamp; }
      }).finally(() => uses.delete(key));
      uses.set(key, pending);
      return pending;
    },
    ensureIdentity(provider, subject) {
      identityInput(provider, subject);
      return mutate(next => {
        const timestamp = new Date(now()).toISOString();
        let account = find(next, provider, subject);
        if (!account) {
          if (next.accounts.length >= 1000) throw error(409, 'The account limit has been reached.');
          account = { id: randomUUID(), identities: [{ provider, subject, createdAt: timestamp, lastUsedAt: timestamp }], memberships: [], createdAt: timestamp, lastUsedAt: timestamp };
          next.accounts.push(account);
        } else {
          account.identities.find(identity => identity.provider === provider).lastUsedAt = timestamp;
          account.lastUsedAt = timestamp;
        }
        return account;
      });
    },
    linkIdentity(id, provider, subject) {
      identityInput(provider, subject);
      return mutate(next => {
        const account = requireAccount(next, id), owner = find(next, provider, subject);
        if (owner && owner.id !== id) throw error(409, 'This sign-in identity is already linked to another account.');
        const existing = account.identities.find(identity => identity.provider === provider);
        if (existing && existing.subject !== subject) throw error(409, 'This account already has a linked identity for this provider.');
        const timestamp = new Date(now()).toISOString();
        if (existing) existing.lastUsedAt = timestamp;
        else account.identities.push({ provider, subject, createdAt: timestamp, lastUsedAt: timestamp });
        account.lastUsedAt = timestamp;
        return account;
      });
    },
    attachMembership(id, input) {
      if (!keys(input, ['inviteId', 'role', 'memberId']) || !UUID.test(input.inviteId) || !['player', 'viewer'].includes(input.role) || (input.role === 'player' ? typeof input.memberId !== 'string' || !MEMBER.test(input.memberId) : input.memberId != null)) throw error(400, 'Invalid account membership.');
      return mutate(next => {
        const account = requireAccount(next, id), existing = account.memberships.find(membership => membership.id === input.inviteId);
        const membership = { id: input.inviteId, inviteId: input.inviteId, role: input.role, memberId: input.memberId ?? null };
        if (existing && (existing.role !== membership.role || existing.memberId !== membership.memberId)) throw error(409, 'This membership is already assigned.');
        if (!existing) {
          if (account.memberships.length >= 1000) throw error(409, 'The membership limit has been reached.');
          account.memberships.push(membership);
        }
        return account;
      });
    },
    unlinkIdentity(id, provider) {
      if (!providers.has(provider)) throw error(400, 'Invalid sign-in provider.');
      return mutate(next => {
        const account = requireAccount(next, id);
        if (account.identities.some(identity => identity.provider === provider)) {
          account.identities = account.identities.filter(identity => identity.provider !== provider);
        }
        return account;
      });
    },
    revokeDeletion(id) { return mutate(next => { next.accounts = next.accounts.filter(account => account.id !== id); }); },
    delete(id) { return mutate(next => { requireAccount(next, id); next.accounts = next.accounts.filter(account => account.id !== id); return { id }; }); },
    async close() { closed = true; await queue; },
  };
}
