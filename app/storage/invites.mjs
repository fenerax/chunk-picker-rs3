import { withStoreWrite } from './snapshot.mjs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { loadGameDefaults } from '../game-defaults.mjs';

const COOKIE = 'duo_access';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const hash = token => createHash('sha256').update(token).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
function equals(one, two) {
  if (typeof one !== 'string' || typeof two !== 'string') return false;
  const a = Buffer.from(one), b = Buffer.from(two);
  return a.length === b.length && timingSafeEqual(a, b);
}
const safeText = value => value.replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]');
function publicInvite({ tokenHash, ...invite }) { return { ...invite, label: safeText(invite.label), viewer: invite.viewer ?? false }; }
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw error(400, 'Use an invite label from 1 to 80 characters.');
  return value.trim();
}
const MEMBER = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const PROVIDERS = new Set(['discord', 'google']);
function memberId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !MEMBER.test(value)) throw error(400, 'Choose a known player for the invite.');
  return value;
}
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validateInviteStore(document) {
  if (!document || Object.keys(document).some(key => !['schemaVersion', 'invites', 'sessions'].includes(key)) || document.schemaVersion !== 1 || !Array.isArray(document.invites) || !Array.isArray(document.sessions)) throw new TypeError('Invalid invite store.');
  const ids = new Set(), hashes = new Set();
  if (document.invites.length > 1000 || document.sessions.length > 10000) throw new TypeError('Invite store exceeds its limits.');
  for (const invite of document.invites) {
    if (Object.keys(invite).some(key => !['id', 'label', 'admin', 'viewer', 'createdAt', 'lastUsedAt', 'revoked', 'tokenHash', 'memberId', 'claimedAccountId', 'claimedAt'].includes(key)) ||
      typeof invite.id !== 'string' || !/^[a-f0-9-]{36}$/.test(invite.id) || ids.has(invite.id) || !HASH.test(invite.tokenHash) || hashes.has(invite.tokenHash) ||
      label(invite.label) !== invite.label || typeof invite.admin !== 'boolean' || !(invite.viewer === undefined || typeof invite.viewer === 'boolean') || (invite.viewer && (invite.admin || invite.memberId != null)) || typeof invite.revoked !== 'boolean' || !(invite.memberId === undefined || invite.memberId === null || (typeof invite.memberId === 'string' && MEMBER.test(invite.memberId))) || !validDate(invite.createdAt) || !(invite.lastUsedAt === null || validDate(invite.lastUsedAt)) ||
      (invite.claimedAccountId !== undefined && (!UUID.test(invite.claimedAccountId) || !validDate(invite.claimedAt) || invite.admin || invite.viewer || !invite.memberId)) || (invite.claimedAt !== undefined && invite.claimedAccountId === undefined)) throw new TypeError('Invalid invite record.');
    ids.add(invite.id); hashes.add(invite.tokenHash);
  }
  const sessionHashes = new Set();
  for (const session of document.sessions) {
    if (Object.keys(session).some(key => !['tokenHash', 'inviteId', 'expiresAt', 'accountId', 'membershipId', 'provider', 'pickerId'].includes(key)) || !HASH.test(session.tokenHash) || sessionHashes.has(session.tokenHash) ||
      !(session.inviteId === null || ids.has(session.inviteId)) || !validDate(session.expiresAt) ||
      (session.pickerId !== undefined ? !/^p_[0-9a-f]{32}$/.test(session.pickerId) || !UUID.test(session.accountId) || session.inviteId !== null || session.membershipId !== undefined || !PROVIDERS.has(session.provider) : session.accountId !== undefined ? !UUID.test(session.accountId) || session.membershipId !== session.inviteId || !UUID.test(session.membershipId) || !PROVIDERS.has(session.provider) : session.membershipId !== undefined || session.provider !== undefined)) throw new TypeError('Invalid invite session.');
    sessionHashes.add(session.tokenHash);
  }
  return document;
}
export async function atomicWrite(file, document) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (failure) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code) || attempt >= 6) throw failure;
        await delay(20 * 2 ** attempt);
      }
    }
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
}

/** Open under the gameplay store's existing exclusive data-directory lock. */
export async function openInviteStore({ dataDir, masterToken, masterLabel, now = Date.now, accounts, signInMode = 'off', pickerRegistry } = {}) {
  if (!['off', 'optional', 'required'].includes(signInMode)) throw new Error('Invalid sign-in mode.');
  if (masterLabel === undefined) masterLabel = (await loadGameDefaults()).masterLabel;
  const file = path.join(dataDir, 'invites.json');
  let current;
  try { current = validateInviteStore(JSON.parse(await readFile(file, 'utf8'))); }
  catch (failure) { if (failure.code !== 'ENOENT') throw new Error('Invalid invite store.'); current = { schemaVersion: 1, invites: [], sessions: [] }; }
  let queue = Promise.resolve(), closed = false;
  const uses = new Map();
  function mutate(operation) {
    if (closed) return Promise.reject(new Error('Invite store is closed.'));
    const pending = queue.then(() => withStoreWrite(dataDir, async () => {
      const next = structuredClone(current);
      next.sessions = next.sessions.filter(session => Date.parse(session.expiresAt) > now());
      const result = operation(next);
      await atomicWrite(file, next); current = next;
      return result;
    }));
    queue = pending.catch(() => {});
    return pending;
  }
  function principal(inviteId) {
    if (inviteId === null) return { kind: 'master', label: masterLabel, admin: true, readOnly: false, capabilities: { canWrite: true }, memberId: null, actor: { kind: 'master', label: masterLabel } };
    const invite = current.invites.find(invite => invite.id === inviteId && !invite.revoked);
    return invite ? { kind: 'invite', label: safeText(invite.label), inviteId, admin: invite.admin, readOnly: invite.viewer ?? false, capabilities: { canWrite: !invite.viewer }, memberId: invite.memberId ?? null,
      actor: { kind: 'invite', inviteId, label: safeText(invite.label), ...(invite.memberId ? { memberId: invite.memberId } : {}) } } : null;
  }
  function accountPrincipal(session) {
    if (session.pickerId) {
      const account = pickerRegistry?.getAccount(session.accountId), picker = pickerRegistry?.getPicker(session.pickerId);
      const membership = account?.memberships.find(item => item.pickerId === session.pickerId);
      if (!membership || picker?.kind !== 'default' || picker.lifecycle !== 'active' || picker.provisioning !== 'ready'
        || !account.identities.some(item => item.provider === session.provider)) return null;
      const readOnly = membership.role === 'viewer', label = 'Player 1';
      return { kind: 'account', accountId: account.id, pickerId: picker.id, provider: session.provider,
        memberId: membership.memberId, role: membership.role, label, admin: false, readOnly,
        capabilities: { canWrite: !readOnly }, actor: { kind: 'invite', inviteId: account.id, memberId: membership.memberId, label } };
    }
    const account = accounts?.get(session.accountId);
    const membership = account?.memberships.find(item => item.id === session.membershipId && item.inviteId === session.inviteId);
    const invite = current.invites.find(item => item.id === session.inviteId && !item.revoked);
    if (!membership || !invite || invite.admin || invite.claimedAccountId !== account.id || membership.memberId !== (invite.memberId ?? null) || membership.role !== (invite.viewer ? 'viewer' : 'player') || !account.identities.some(identity => identity.provider === session.provider)) return null;
    return { ...principal(invite.id), kind: 'account', admin: false, readOnly: membership.role === 'viewer', capabilities: { canWrite: membership.role !== 'viewer' }, accountId: account.id, membershipId: membership.id, provider: session.provider, account: { id: account.id, providers: account.identities.map(identity => identity.provider) } };
  }
  function cookieToken(request) {
    return (request.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }
  function addSession(next, source) {
    const same = next.sessions.filter(session => source.accountId ? session.accountId === source.accountId : !session.accountId && session.inviteId === source.inviteId);
    const remove = new Set(same.slice(0, Math.max(0, same.length - 31)).map(session => session.tokenHash));
    next.sessions = next.sessions.filter(session => !remove.has(session.tokenHash));
    if (next.sessions.length >= 10000) throw error(429, 'Please try again later.');
    const token = randomBytes(32).toString('base64url');
    next.sessions.push({ tokenHash: hash(token), ...source, expiresAt: new Date(now() + SESSION_MS).toISOString() });
    return token;
  }
  function issueInvite(next, invite, context) {
    if (invite?.admin && context.publicRequest) throw error(403, 'Administrator access requires a private connection.');
    if (invite?.claimedAccountId || (signInMode === 'required' && invite && !invite.admin && !invite.viewer)) throw error(403, 'Sign in to use this invitation.');
    if (invite) invite.lastUsedAt = new Date(now()).toISOString();
    return addSession(next, { inviteId: invite?.id ?? null });
  }
  return {
    list() { return current.invites.map(publicInvite); },
    get(id) { const invite = current.invites.find(item => item.id === id && !item.revoked); return invite ? publicInvite(invite) : null; },
    inspectToken(token, context) {
      if (equals(token, masterToken)) {
        if (!context.masterAllowed) throw error(403, 'Administrator access requires a private connection.');
        return null;
      }
      if (!TOKEN.test(token ?? '')) return null;
      const invite = current.invites.find(item => !item.revoked && equals(item.tokenHash, hash(token)));
      if (invite?.admin && context.publicRequest) throw error(403, 'Administrator access requires a private connection.');
      return invite ? publicInvite(invite) : null;
    },
    claim(id, accountId) {
      return mutate(next => {
        const invite = next.invites.find(item => item.id === id && !item.revoked);
        if (!invite) throw error(404, 'Invite not found.');
        if (invite.admin || invite.viewer || !invite.memberId) throw error(403, 'Choose a player invitation.');
        if (!UUID.test(accountId) || !accounts?.get(accountId)) throw error(404, 'Account not found.');
        if (invite.claimedAccountId && invite.claimedAccountId !== accountId) throw error(409, 'This invitation has already been claimed.');
        if (!invite.claimedAccountId) { invite.claimedAccountId = accountId; invite.claimedAt = new Date(now()).toISOString(); }
        next.sessions = next.sessions.filter(session => session.inviteId !== id || session.accountId === accountId);
        return publicInvite(invite);
      });
    },
    issuePickerSession(accountId, pickerId, provider) {
      return mutate(next => {
        const source = { accountId, pickerId, provider, inviteId: null };
        if (!accountPrincipal(source)) throw error(403, 'Account access required.');
        return addSession(next, source);
      });
    },
    issueAccountSession(accountId, membershipId, provider) {
      return mutate(next => {
        const membership = accounts?.get(accountId)?.memberships.find(item => item.id === membershipId);
        const source = { accountId, membershipId, provider, inviteId: membership?.inviteId };
        if (!accountPrincipal(source)) throw error(403, 'Account access required.');
        const invite = next.invites.find(item => item.id === source.inviteId);
        if (!invite || invite.revoked || invite.claimedAccountId !== accountId) throw error(403, 'Account access required.');
        invite.lastUsedAt = new Date(now()).toISOString();
        return addSession(next, source);
      });
    },
    signOut(request) {
      const token = cookieToken(request);
      if (!TOKEN.test(token ?? '')) return Promise.resolve();
      return mutate(next => { const digest = hash(token); next.sessions = next.sessions.filter(session => !equals(session.tokenHash, digest)); });
    },
    revokeAccountSessions(accountId) { return mutate(next => { next.sessions = next.sessions.filter(session => session.accountId !== accountId); }); },
    async touch(identity) {
      if (!['invite', 'account'].includes(identity?.kind)) return Promise.resolve();
      if (identity.kind === 'account' && accountPrincipal(identity)) await accounts.touch(identity.accountId, identity.provider);
      const invite = current.invites.find(invite => invite.id === identity.inviteId && !invite.revoked);
      if (!invite || (invite.lastUsedAt && now() - Date.parse(invite.lastUsedAt) < 60000)) return Promise.resolve();
      if (uses.has(invite.id)) return uses.get(invite.id);
      const pending = mutate(next => {
        const live = next.invites.find(item => item.id === invite.id && !item.revoked);
        if (live) live.lastUsedAt = new Date(now()).toISOString();
      }).finally(() => uses.delete(invite.id));
      uses.set(invite.id, pending);
      return pending;
    },
    create(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['label', 'admin', 'viewer', 'memberId'].includes(key)) || (input.admin !== undefined && typeof input.admin !== 'boolean') || (input.viewer !== undefined && typeof input.viewer !== 'boolean')) throw error(400, 'Use label, optional admin or viewer flags and optional player.');
      if (input.viewer && input.admin) throw error(400, 'View-only links cannot have administrator access.');
      if (input.viewer && input.memberId != null) throw error(400, 'View-only links cannot be assigned to a player.');
      const name = label(safeText(label(input.label))), player = memberId(input.memberId);
      return mutate(next => {
        if (next.invites.length >= 1000) throw error(409, 'The invite limit has been reached.');
        const token = randomBytes(32).toString('base64url');
        const invite = { id: randomUUID(), label: name, admin: input.admin ?? false, viewer: input.viewer ?? false, ...(player ? { memberId: player } : {}), createdAt: new Date(now()).toISOString(), lastUsedAt: null, revoked: false, tokenHash: hash(token) };
        next.invites.push(invite);
        return { invite: publicInvite(invite), token };
      });
    },
    /** Which player's map this invite owns (for restoring that map only). */
    setMember(id, value) {
      const player = memberId(value);
      return mutate(next => {
        const invite = next.invites.find(invite => invite.id === id);
        if (!invite) throw error(404, 'Invite not found.');
        if (invite.viewer) throw error(400, 'View-only links cannot be assigned to a player.');
        if (invite.claimedAccountId && player !== invite.memberId) throw error(409, 'A claimed invitation cannot change players.');
        if (player) invite.memberId = player; else delete invite.memberId;
        return publicInvite(invite);
      });
    },
    revoke(id) {
      return mutate(next => {
        const invite = next.invites.find(invite => invite.id === id);
        if (!invite) throw error(404, 'Invite not found.');
        invite.revoked = true;
        next.sessions = next.sessions.filter(session => session.inviteId !== id);
        return publicInvite(invite);
      });
    },
    async join(token, context) {
      // Fixed token syntax prevents oversized input before hashing. Master format is legacy.
      if (!context.masterAllowed && equals(token, masterToken)) throw error(403, 'Administrator access requires a private connection.');
      const master = context.masterAllowed && equals(token, masterToken);
      if (!master && !TOKEN.test(token)) return null;
      return mutate(next => {
        const invite = master ? null : next.invites.find(invite => !invite.revoked && equals(invite.tokenHash, hash(token)));
        if (!master && !invite) throw error(401, 'Access required.');
        return issueInvite(next, invite, context);
      }).catch(failure => { if (failure.status === 401) return null; throw failure; });
    },
    joinById(id, context) {
      return mutate(next => {
        const invite = next.invites.find(item => item.id === id && !item.revoked);
        return invite ? issueInvite(next, invite, context) : null;
      });
    },
    authenticate(request, context) {
      const bearer = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
      const cookie = cookieToken(request);
      if (!context.masterAllowed && (equals(bearer, masterToken) || equals(cookie, masterToken))) throw error(403, 'Administrator access requires a private connection.');
      // Preserve private CLI bearer and existing master cookies, never on Funnel.
      if (context.masterAllowed && (equals(bearer, masterToken) || equals(cookie, masterToken))) return principal(null);
      if (!TOKEN.test(cookie ?? '')) return null;
      const digest = hash(cookie);
      const session = current.sessions.find(session => equals(session.tokenHash, digest) && Date.parse(session.expiresAt) > now());
      if (!session) return null;
      if (session.inviteId === null && !session.pickerId && !context.masterAllowed) throw error(403, 'Administrator access requires a private connection.');
      const invite = current.invites.find(item => item.id === session.inviteId);
      if (!session.accountId && invite && (invite.claimedAccountId || (signInMode === 'required' && !invite.admin && !invite.viewer))) return null;
      const identity = session.accountId ? accountPrincipal(session) : principal(session.inviteId);
      if (identity?.admin && context.publicRequest) throw error(403, 'Administrator access requires a private connection.');
      return identity ? { ...identity, sessionId: session.tokenHash, expiresAt: session.expiresAt } : null;
    },
    active(identity, context) {
      if (!identity || (context.publicRequest && identity.admin)) return false;
      if ((identity.expiresAt && Date.parse(identity.expiresAt) <= now()) || (identity.sessionId && !current.sessions.some(session => session.tokenHash === identity.sessionId && Date.parse(session.expiresAt) > now()))) return false;
      if (identity.kind === 'master') return context.masterAllowed;
      if (identity.kind === 'account') return !!accountPrincipal(identity);
      const invite = current.invites.find(item => item.id === identity.inviteId && !item.revoked);
      return !!invite && !invite.claimedAccountId && !(signInMode === 'required' && !invite.admin && !invite.viewer);
    },
    cookie(token, context) { return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${context.secure ? '; Secure' : ''}`; },
    async close() { closed = true; await queue; },
  };
}
