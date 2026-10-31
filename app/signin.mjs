import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { renderSignInPage } from './signin-page.mjs';

export const SIGN_IN_ENDPOINTS = Object.freeze({
  discord: Object.freeze({ authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', user: 'https://discord.com/api/users/@me' }),
  google: Object.freeze({ authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token' }),
});
const PREAUTH = '__Host-rs3_preauth';
const PENDING_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;
const MAX_RESPONSE = 64 * 1024;
const random = () => randomBytes(32).toString('base64url');
const failure = (status, message) => Object.assign(new Error(message), { status });
function equal(one, two) {
  if (typeof one !== 'string' || typeof two !== 'string') return false;
  const a = Buffer.from(one), b = Buffer.from(two);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookie(request) {
  const values = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${PREAUTH}=`));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0].slice(PREAUTH.length + 1)) ? values[0].slice(PREAUTH.length + 1) : null;
}
const preauthCookie = token => `${PREAUTH}=${token ?? ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? PENDING_MS / 1000 : 0}`;
function addCookie(response, value) {
  const previous = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), value]);
}
function redirect(response, destination = '/') {
  response.writeHead(303, { Location: destination, 'Cache-Control': 'private, no-store' });
  response.end();
}
// Pages send Referrer-Policy: no-referrer, so browsers serialise a plain form
// POST's Origin as "null". Fetch Metadata still proves a same-origin submission;
// browsers forbid scripts from setting it, so a cross-site page cannot forge it.
function checkFormOrigin(request, security, checkRequestOrigin) {
  if (request.headers.origin === 'null' && request.headers['sec-fetch-site'] === 'same-origin') return;
  checkRequestOrigin(request, security);
}
function page(response, input, status = 200) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  response.end(renderSignInPage(input));
}

/** OAuth state and tokens remain in this process; only provider subjects reach storage. */
export async function openSignIn({ publicOrigin, mode = 'off', accounts, invites, provider = {}, unauthenticated = () => {},
  checkRequestOrigin, serializeMutation = operation => operation(), webRoot, pickerRegistry, syncLegacy, reclaimIdentity } = {}) {
  if (!['off', 'optional', 'required'].includes(mode)) throw new TypeError('RS3_SIGNIN must be off, optional or required.');
  if (mode !== 'off' && (!publicOrigin || new URL(publicOrigin).protocol !== 'https:' || new URL(publicOrigin).origin !== publicOrigin)) throw new TypeError('Sign-in requires an HTTPS public origin.');
  const now = provider?.now ?? Date.now;
  const fetchProvider = provider?.fetch ?? globalThis.fetch;
  const scheduleTimeout = provider?.setTimeout ?? setTimeout;
  const cancelTimeout = provider?.clearTimeout ?? clearTimeout;
  const configured = new Map();
  if (mode !== 'off') for (const name of ['discord', 'google']) {
    const prefix = `RS3_${name.toUpperCase()}`;
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const secretFile = process.env[`${prefix}_CLIENT_SECRET_FILE`];
    if (!clientId || !secretFile) continue;
    try {
      const secret = (await readFile(secretFile, 'utf8')).trim();
      if (!secret || secret.length > 16384 || clientId.length > 1024 || /[\u0000-\u0020\u007f]/.test(clientId)) throw new Error();
      configured.set(name, { clientId, secret });
    } catch { throw new Error('Sign-in provider configuration could not be loaded.'); }
  }
  const providers = [...configured.keys()];
  const pending = new Map();
  let closed = false;
  function ingress(security) {
    if (closed) throw failure(503, 'Please try again later.');
    if (mode === 'off') throw failure(404, 'Not found.');
    if (security.ingressRole !== 'public' || !security.secure || security.origin !== publicOrigin) throw failure(403, 'Sign-in requires the configured public HTTPS address.');
  }
  function prune() { for (const [key, entry] of pending) if (entry.expires <= now()) pending.delete(key); }
  function take(request, response) {
    prune();
    const key = cookie(request), entry = pending.get(key);
    if (key) pending.delete(key);
    addCookie(response, preauthCookie(null));
    return entry;
  }
  function put(request, response, input) {
    prune();
    const old = cookie(request);
    if (old) pending.delete(old);
    if (pending.size >= MAX_PENDING) throw failure(429, 'Please try again later.');
    const key = random(), entry = { ...input, expires: now() + PENDING_MS };
    pending.set(key, entry);
    addCookie(response, preauthCookie(key));
    return entry;
  }
  function liveInvite(id, requireMember = true) {
    const invite = invites.get(id);
    if (!invite || invite.revoked || invite.admin || invite.viewer || (requireMember && !invite.memberId)) throw failure(409, 'This player invite is no longer available.');
    return invite;
  }
  function inviteRequired(response) {
    page(response, { providers, heading: 'Invite required', message: 'This account has no membership yet. Open a player invite link to join this game.' }, 403);
  }
  const sharedIdentityConflict = 'This sign-in already has its own picker. Joining the shared game with it is not available yet.';
  function checkRegistryOwner(accountId, name, subject) {
    const owner = pickerRegistry?.findIdentity(name, subject);
    if (owner && owner.id !== accountId) throw failure(409, sharedIdentityConflict);
    const existing = accountId && pickerRegistry?.getAccount(accountId)?.identities.find(i => i.provider === name);
    if (existing && existing.subject !== subject) throw failure(409, 'This account already has a linked identity for this provider.');
  }
  async function createWithInvite(name, subject, inviteId) {
    checkRegistryOwner(undefined, name, subject);
    const invite = liveInvite(inviteId);
    if (invite.claimedAccountId) throw failure(409, 'This invitation has already been claimed.');
    const created = await accounts.ensureIdentity(name, subject);
    try {
      // Prepare membership before the durable claim, so a failed claim can
      // remove the entire new account without leaving a claimed invite behind.
      const account = await accounts.attachMembership(created.id, { inviteId: invite.id, role: 'player', memberId: invite.memberId });
      await invites.claim(invite.id, account.id);
      return account;
    } catch (error) { await accounts.delete(created.id); throw error; }
  }
  async function claim(account, inviteId) {
    for (const identity of account.identities) checkRegistryOwner(account.id, identity.provider, identity.subject);
    const invite = liveInvite(inviteId);
    // The invite owns the durable claim. A retry by the same owner repairs an
    // interrupted membership attachment without transferring ownership.
    await invites.claim(invite.id, account.id);
    return accounts.attachMembership(account.id, { inviteId: invite.id, role: 'player', memberId: invite.memberId });
  }
  function availableMembership(account) {
    return account.memberships.find(membership => {
      const invite = invites.get(membership.inviteId);
      return invite && !invite.revoked && !invite.admin && !invite.viewer && invite.memberId === membership.memberId && invite.claimedAccountId === account.id;
    });
  }
  async function issue(response, account, security, name, membership) {
    const selected = membership ?? availableMembership(account);
    if (!selected) {
      inviteRequired(response);
      return;
    }
    const token = await invites.issueAccountSession(account.id, selected.id, name);
    addCookie(response, invites.cookie(token, security));
    redirect(response);
  }
  async function jsonFromProvider(url, options) {
    const controller = new AbortController();
    const timer = scheduleTimeout(() => controller.abort(), 10000);
    timer.unref?.();
    try {
      const result = await fetchProvider(url, { ...options, redirect: 'manual', signal: controller.signal });
      if (!result || !result.ok || result.status >= 300 || Number(result.headers?.get?.('content-length')) > MAX_RESPONSE) throw new Error();
      let content;
      if (result.body?.getReader) {
        const reader = result.body.getReader(), chunks = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_RESPONSE) throw new Error();
            chunks.push(Buffer.from(part.value));
          }
          content = Buffer.concat(chunks).toString('utf8');
        } finally { await reader.cancel().catch(() => {}); }
      } else {
        content = await result.text();
        if (Buffer.byteLength(content) > MAX_RESPONSE) throw new Error();
      }
      const document = JSON.parse(content);
      if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error();
      return document;
    } catch { throw failure(502, 'Sign-in could not be completed. Please try again.'); }
    finally { cancelTimeout(timer); }
  }
  async function subjectFor(name, code, entry) {
    const config = configured.get(name), endpoints = SIGN_IN_ENDPOINTS[name];
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.secret,
      redirect_uri: `${publicOrigin}/auth/${name}/callback`, code, code_verifier: entry.verifier });
    const tokens = await jsonFromProvider(endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() });
    if (name === 'discord') {
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 8192 || /[\r\n]/.test(tokens.access_token)) throw failure(502, 'Sign-in could not be completed. Please try again.');
      const profile = await jsonFromProvider(endpoints.user, { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } });
      if (typeof profile.id !== 'string' || !/^[0-9]{1,30}$/.test(profile.id)) throw failure(502, 'Sign-in could not be completed. Please try again.');
      return profile.id;
    }
    // This ID token comes directly from Google's fixed TLS token endpoint;
    // it is never accepted from the browser or from an arbitrary URL.
    try {
      if (typeof tokens.id_token !== 'string' || tokens.id_token.length > MAX_RESPONSE) throw new Error();
      const parts = tokens.id_token.split('.');
      if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const seconds = Math.floor(now() / 1000);
      if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== config.clientId ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= seconds || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 60 || claims.iat > claims.exp ||
        !equal(claims.nonce, entry.nonce) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || /[\u0000-\u0020\u007f-\u009f]/.test(claims.sub)) throw new Error();
      return claims.sub;
    } catch { throw failure(502, 'Sign-in could not be completed. Please try again.'); }
  }
  return {
    async handle(request, response, { route, security, identity, budgeted = false } = {}) {
      if (!route.startsWith('/auth/')) return false;
      if (!budgeted) unauthenticated(security.rateKey);
      ingress(security);
      if (request.method === 'POST') checkFormOrigin(request, security, checkRequestOrigin);
      if ((route === '/auth/signin.css' || route === '/signin.css') && ['GET', 'HEAD'].includes(request.method)) {
        const css = await readFile(path.join(webRoot, 'signin.css'));
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'private, no-store' });
        response.end(request.method === 'HEAD' ? undefined : css); return true;
      }
      if (request.method === 'GET' && route === '/auth/reclaim' && pickerRegistry && reclaimIdentity) {
        const query = new URL(request.url, publicOrigin).searchParams;
        const code = query.get('code');
        if (query.getAll('code').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(code ?? '')) throw failure(409, 'This account claim is unavailable. Ask the operator for a new link.');
        put(request, response, { reclaimCode: code });
        // Strip the secret from the address before presenting provider links.
        response.setHeader('Referrer-Policy', 'no-referrer');
        redirect(response, '/auth/reclaim/signin'); return true;
      }
      if (request.method === 'GET' && route === '/auth/reclaim/signin' && pickerRegistry && reclaimIdentity) {
        const entry = pending.get(cookie(request));
        prune();
        if (!entry?.reclaimCode || entry.expires <= now()) throw failure(409, 'This account claim has expired. Reopen the operator’s link.');
        page(response, { providers, heading: 'Reclaim your account', message: 'Sign in to open your restored picker. An empty picker created after recovery will be retired.' }); return true;
      }
      if (request.method === 'GET' && route === '/auth/reclaim/done' && pickerRegistry) {
        if (identity?.kind !== 'account') throw failure(401, 'Sign in to open your restored picker.');
        page(response, { heading: 'Account reclaimed', message: 'Your sign-in is linked to your restored account.', home: true, help: false }); return true;
      }
      if (request.method === 'GET' && route === '/auth/signin') {
        take(request, response);
        page(response, { providers, heading: 'Sign in', message: providers.length ? 'Use your linked account to open this game.' : 'No sign-in providers are configured. Ask the game administrator for help.' }); return true;
      }
      if (request.method === 'POST' && route === '/auth/signout') {
        take(request, response); request.resume();
        await serializeMutation(() => invites.signOut(request));
        addCookie(response, invites.cookie('', security).replace(/Max-Age=\d+/, 'Max-Age=0'));
        redirect(response, '/auth/signin'); return true;
      }
      if (request.method === 'POST' && ['/auth/invite', '/auth/claim'].includes(route)) {
        const entry = take(request, response); request.resume();
        if (!entry?.inviteId || entry.provider) throw failure(400, 'This invitation has expired. Open the invite link again.');
        if (route === '/auth/invite') {
          if (mode !== 'optional') throw failure(403, 'Sign in to join this game.');
          liveInvite(entry.inviteId, false);
          const token = await serializeMutation(() => invites.joinById(entry.inviteId, security));
          if (!token) throw failure(409, 'This player invite is no longer available.');
          addCookie(response, invites.cookie(token, security)); redirect(response); return true;
        }
        if (identity?.kind !== 'account') throw failure(401, 'Sign in to claim this invite.');
        await serializeMutation(async () => {
          const active = invites.authenticate(request, security);
          if (active?.kind !== 'account' || active.accountId !== identity.accountId) throw failure(401, 'Sign in again to claim this invite.');
          const account = await claim(accounts.get(active.accountId), entry.inviteId);
          await syncLegacy?.();
          await issue(response, account, security, active.provider, account.memberships.find(item => item.id === entry.inviteId));
        });
        return true;
      }
      const callback = /^\/auth\/(discord|google)\/callback$/.exec(route);
      if (request.method === 'GET' && callback) {
        const name = callback[1], entry = take(request, response);
        const query = new URL(request.url, publicOrigin).searchParams;
        if (!configured.has(name) || !entry || entry.provider !== name || query.getAll('state').length !== 1 || !equal(query.get('state'), entry.state)) throw failure(400, 'This sign-in request has expired. Start again; if you were joining, reopen the invite link.');
        if (query.has('error')) {
          if (entry.inviteId || entry.reclaimCode) put(request, response, entry.reclaimCode ? { reclaimCode: entry.reclaimCode } : { inviteId: entry.inviteId });
          page(response, { providers, heading: 'Sign-in cancelled', message: 'You can try signing in again.' }, 400); return true;
        }
        const code = query.get('code');
        if (query.getAll('code').length !== 1 || !code || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code)) throw failure(400, 'Sign-in could not be completed. Please try again.');
        if (entry.accountId) {
          const active = invites.authenticate(request, security);
          if (active?.kind !== 'account' || active.accountId !== entry.accountId || !equal(active.sessionId, entry.sessionId)) throw failure(401, 'Sign in again before linking an account.');
        }
        let subject;
        try { subject = await subjectFor(name, code, entry); }
        catch (error) {
          if (entry.inviteId || entry.reclaimCode) put(request, response, entry.reclaimCode ? { reclaimCode: entry.reclaimCode } : { inviteId: entry.inviteId });
          throw error;
        }
        await serializeMutation(async () => {
          if (entry.reclaimCode && pickerRegistry && reclaimIdentity) {
            const account = await reclaimIdentity(entry.reclaimCode, name, subject);
            const picker = await pickerRegistry.ensureDefaultPicker(account.id);
            const token = await invites.issuePickerSession(account.id, picker.id, name);
            addCookie(response, invites.cookie(token, security)); redirect(response, '/auth/reclaim/done'); return;
          }
          // Explicit duo invites and established live memberships keep the invite path.
          // Otherwise provisioning belongs to the recoverable registry transaction.
          const legacy = accounts.findIdentity(name, subject);
          const active = entry.accountId ? invites.authenticate(request, security) : null;
          if (pickerRegistry && !entry.inviteId && (active?.pickerId || !entry.accountId && !availableMembership(legacy ?? { memberships: [] }))) {
            if (entry.accountId && (active?.accountId !== entry.accountId || !equal(active.sessionId, entry.sessionId))) throw failure(401, 'Sign in again before linking an account.');
            const result = entry.accountId
              ? { account: await pickerRegistry.linkIdentity(entry.accountId, name, subject), picker: await pickerRegistry.ensureDefaultPicker(entry.accountId) }
              : await pickerRegistry.firstLogin(name, subject);
            const token = await invites.issuePickerSession(result.account.id, result.picker.id, name);
            addCookie(response, invites.cookie(token, security)); redirect(response); return;
          }
          let account, claimed = false;
          if (entry.accountId) {
            const active = invites.authenticate(request, security);
            if (active?.kind !== 'account' || active.accountId !== entry.accountId || !equal(active.sessionId, entry.sessionId)) throw failure(401, 'Sign in again before linking an account.');
            checkRegistryOwner(entry.accountId, name, subject);
            account = await accounts.linkIdentity(entry.accountId, name, subject);
          } else {
            account = accounts.findIdentity(name, subject);
            if (!account) {
              if (!entry.inviteId) { inviteRequired(response); return; }
              account = await createWithInvite(name, subject, entry.inviteId);
              claimed = true;
            }
          }
          if (entry.inviteId && !claimed) account = await claim(account, entry.inviteId);
          await syncLegacy?.();
          await issue(response, account, security, name, entry.inviteId ? account.memberships.find(item => item.id === entry.inviteId) : undefined);
        });
        return true;
      }
      const start = /^\/auth\/(?:(link)\/)?(discord|google)$/.exec(route);
      if (request.method === 'GET' && start) {
        const name = start[2], config = configured.get(name);
        if (!config) throw failure(404, 'This sign-in provider is unavailable.');
        prune();
        const previous = pending.get(cookie(request));
        if (previous?.reclaimCode && start[1]) throw failure(409, 'Use the sign-in buttons on the claim page.');
        let accountId, sessionId;
        if (start[1]) {
          if (identity?.kind !== 'account' || !identity.sessionId) throw failure(401, 'Sign in before linking another provider.');
          accountId = identity.accountId; sessionId = identity.sessionId;
        }
        const inviteId = previous?.inviteId ?? (identity?.kind === 'invite' && !identity.admin && !identity.readOnly && identity.memberId ? identity.inviteId : undefined);
        const entry = put(request, response, { provider: name, state: random(), verifier: random(), ...(name === 'google' ? { nonce: random() } : {}),
          ...(previous?.reclaimCode ? { reclaimCode: previous.reclaimCode } : accountId ? { accountId, sessionId } : inviteId ? { inviteId } : {}) });
        const destination = new URL(SIGN_IN_ENDPOINTS[name].authorize);
        destination.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${publicOrigin}/auth/${name}/callback`, response_type: 'code',
          scope: name === 'discord' ? 'identify' : 'openid', state: entry.state, code_challenge: createHash('sha256').update(entry.verifier).digest('base64url'), code_challenge_method: 'S256',
          ...(entry.nonce ? { nonce: entry.nonce } : {}) }).toString();
        redirect(response, destination.href); return true;
      }
      throw failure(404, 'Not found.');
    },
    async join(request, response, { invite, security, identity } = {}) {
      if (mode === 'off' || invite?.admin || invite?.viewer) return false;
      ingress(security);
      if (invite) {
        if (identity?.pickerId) {
          page(response, { providers, heading: 'Unable to join', message: sharedIdentityConflict }, 409); return true;
        }
        if (invite.revoked) { take(request, response); throw failure(409, 'This player invite is no longer available.'); }
        put(request, response, { inviteId: invite.id });
        if (!invite.memberId) {
          page(response, { heading: 'Player invite', message: 'Ask the admin to choose a player for this invite before signing in',
            continueInvite: mode === 'optional' && !invite.claimedAccountId, help: false });
          return true;
        }
        page(response, { providers, heading: identity?.kind === 'account' ? 'Join this game' : 'Sign in to join',
          message: identity?.kind === 'account' ? 'Claim this player invite with your signed-in account.' : 'Sign in to keep your player access on this browser and other devices.',
          claim: identity?.kind === 'account', continueInvite: mode === 'optional' && !invite.claimedAccountId && identity?.kind !== 'account' });
      } else {
        take(request, response);
        page(response, { providers, heading: 'Sign in', message: providers.length ? 'Use your linked account to open this game.' : 'No sign-in providers are configured. Ask the game administrator for help.' });
      }
      return true;
    },
    sessionView(identity, security) {
      if (mode === 'off' || security?.ingressRole !== 'public' || !security.secure || security.origin !== publicOrigin) return {};
      const account = identity?.kind === 'account' ? (identity.pickerId ? pickerRegistry?.getAccount(identity.accountId) : accounts.get(identity.accountId)) : null;
      return { signIn: { mode, providers }, ...(account ? { account: { id: account.id, providers: account.identities.map(item => item.provider), provider: identity.provider } } : {}) };
    },
    errorPage(request, response, security, error, status) {
      if (mode === 'off' || request.method !== 'GET' || !(request.url ?? '').startsWith('/auth/') || security.ingressRole !== 'public' || !security.secure || security.origin !== publicOrigin) return false;
      const message = error.status ? error.message : 'Sign-in could not be completed. Please try again.';
      const heading = /already.*claimed/i.test(message) ? 'Invite already claimed' : /expired/i.test(message) ? 'Sign-in expired' : 'Unable to sign in';
      page(response, { providers, heading, message }, status); return true;
    },
    close() { closed = true; pending.clear(); configured.clear(); },
  };
}
