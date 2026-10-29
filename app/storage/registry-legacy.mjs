import { readFile } from 'node:fs/promises';

export const REGISTRY_MEMBER = /^[A-Za-z0-9_-]{1,64}$/;
export const REGISTRY_ACCOUNT = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const registryObject = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
export function registryIdentity(provider, subject) {
  if (!['discord', 'google'].includes(provider) || typeof subject !== 'string' || !subject || subject.length > 255 || /[\u0000-\u0020\u007f-\u009f]/.test(subject)) throw new TypeError('Invalid registry identity.');
}
export function registryMembers(memberIds) {
  if (!Array.isArray(memberIds) || !memberIds.length || memberIds.some(id => typeof id !== 'string' || !REGISTRY_MEMBER.test(id)) || new Set(memberIds).size !== memberIds.length) throw new TypeError('Invalid registry members.');
}

/** Read only. The caller supplies member IDs validated against the existing save. */
export async function readLegacyAccounts({ accountsFile, memberIds }) {
  registryMembers(memberIds);
  try {
    const document = JSON.parse(await readFile(accountsFile, 'utf8'));
    if (!registryObject(document, ['schemaVersion', 'accounts']) || document.schemaVersion !== 1 || !Array.isArray(document.accounts) || document.accounts.length > 1000) throw new Error();
    const ids = new Set(), subjects = new Set();
    const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const accounts = document.accounts.map(account => {
      if (!registryObject(account, ['id', 'identities', 'memberships', 'createdAt', 'lastUsedAt']) || !REGISTRY_ACCOUNT.test(account.id) || ids.has(account.id) || !Array.isArray(account.identities) || account.identities.length > 2 || !Array.isArray(account.memberships) || account.memberships.length > 1000 || !date(account.createdAt) || !date(account.lastUsedAt)) throw new Error();
      ids.add(account.id);
      const providers = new Set(), invites = new Set();
      const identities = account.identities.map(identity => {
        if (!registryObject(identity, ['provider', 'subject', 'createdAt', 'lastUsedAt']) || !date(identity.createdAt) || !date(identity.lastUsedAt)) throw new Error();
        registryIdentity(identity.provider, identity.subject);
        const key = JSON.stringify([identity.provider, identity.subject]);
        if (providers.has(identity.provider) || subjects.has(key)) throw new Error();
        providers.add(identity.provider); subjects.add(key);
        return { provider: identity.provider, subject: identity.subject };
      });
      const memberships = [];
      for (const membership of account.memberships) {
        if (!registryObject(membership, ['id', 'inviteId', 'role', 'memberId']) || !REGISTRY_ACCOUNT.test(membership.inviteId) || membership.id !== membership.inviteId || invites.has(membership.id) || !['player', 'viewer'].includes(membership.role) || (membership.role === 'player' ? !memberIds.includes(membership.memberId) : membership.memberId !== null)) throw new Error();
        invites.add(membership.id);
        if (!memberships.some(item => item.role === membership.role && item.memberId === membership.memberId)) memberships.push({ role: membership.role, memberId: membership.memberId });
      }
      return { id: account.id, identities, memberships };
    });
    return { memberIds: [...memberIds], accounts };
  } catch (failure) {
    if (failure.code === 'ENOENT') throw failure;
    throw new Error('Invalid legacy account import.');
  }
}
