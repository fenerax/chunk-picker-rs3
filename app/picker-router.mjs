import { createHash } from 'node:crypto';
import { isImportRoute, readBackupRequest } from './backup-transfer.mjs';
import { bodyJSON, routedBody, rememberRoutedBody, httpError, json, MAX_BODY } from './picker-context-http.mjs';
import { requestContext } from './security/request.mjs';

const digest = key => createHash('sha256').update(key).digest('hex');
const selectorKeys = new Set(['picker', 'pickerId']);
const retry = () => Object.assign(httpError(503, 'The picker is unavailable. Retry in a moment.'), { retryAfter: 1 });

/** The only residency and HTTP selection boundary. IDs from requests are checks,
 * never inputs to acquisition, registry path lookup or capability registration. */
export function createPickerRouter({ registry, legacy, openContext, publicOrigin, requestContextFor = requestContext,
  unauthenticated = () => {}, maxOpenContexts = 8, idleCloseMs = 10 * 60 * 1000 }) {
  if (!Number.isSafeInteger(maxOpenContexts) || maxOpenContexts < 1 || !Number.isSafeInteger(idleCloseMs) || idleCloseMs < 1) throw new TypeError('Invalid picker residency limits.');
  const entries = new Map();
  let queue = Promise.resolve(), closed = false, closing;
  function serialize(operation) {
    const pending = queue.then(operation); queue = pending.catch(() => {}); return pending;
  }
  async function evict(entry) {
    clearTimeout(entry.timer);
    // Keep the entry until close drains, so no writer can reopen alongside it.
    try { await entry.context.close(); } finally { entries.delete(entry.id); }
  }
  function idle(entry) {
    clearTimeout(entry.timer);
    if (closed || entries.get(entry.id) !== entry || entry.active || entry.streams.size) return;
    entry.timer = setTimeout(() => {
      void serialize(async () => {
        if (!closed && entries.get(entry.id) === entry && !entry.active && !entry.streams.size) await evict(entry);
      }).catch(() => {});
    }, idleCloseMs);
    entry.timer.unref();
  }
  async function acquire(id) {
    return serialize(async () => {
      if (closed) throw retry();
      let entry = entries.get(id);
      if (!entry) {
        if (maxOpenContexts === 1) throw retry();
        if (entries.size >= maxOpenContexts - 1) {
          // Map order is the request LRU. Streams do not pin a heavy context
          // against capacity eviction. Accepted requests drain through close().
          await evict(entries.values().next().value);
        }
        const context = await openContext(id);
        if (closed) { await context.close(); throw retry(); }
        entry = { id, context, active: 0, streams: new Set() };
      }
      clearTimeout(entry.timer);
      entries.delete(id); entries.set(id, entry); entry.active++;
      return entry;
    });
  }
  function authenticate(request, security, pickerId) {
    const identity = legacy.authenticate(request, security);
    // Auth endpoints live on legacy so OAuth pending state and session issuance
    // have one owner, including explicit provider linking and sign-out.
    const auth = pickerId === 'legacy' && (request.url ?? '').startsWith('/auth/');
    if (identity && !auth && (identity.pickerId ?? 'legacy') !== pickerId) throw httpError(403, 'Picker access denied.');
    return identity;
  }
  async function contextFor(request, security) {
    let identity;
    try { identity = legacy.authenticate(request, security); } catch (error) {
      let page;
      try { page = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { throw error; }
      if (error.status === 403 && security.publicRequest && !request.headers.authorization && !page.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) return { context: legacy };
      throw error;
    }
    if (request.headers.authorization && request.headers.cookie) {
      const cookieIdentity = legacy.authenticate({ headers: { ...request.headers, authorization: undefined } }, security);
      if (cookieIdentity && identity && (cookieIdentity.pickerId ?? 'legacy') !== (identity.pickerId ?? 'legacy')) throw httpError(403, 'Conflicting credentials.');
    }
    const key = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
    const capability = key ? registry.resolveCapability('plugin-key', digest(key)) : null;
    if (key && !capability) {
      try { legacy.authenticatePlugin(request); }
      catch (error) { unauthenticated(security.rateKey); throw error; }
    }
    // Preserve legacy rejection without consuming unauthenticated uploads.
    if (!identity && !key) return { context: legacy };
    if (['GET', 'HEAD'].includes(request.method) && (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'])) throw httpError(400, 'Reads take no request body.');
    const keyPicker = capability?.pickerId ?? 'legacy';
    if (key && identity && keyPicker !== (identity.pickerId ?? 'legacy')) throw httpError(403, 'Conflicting credentials.');
    const pickerId = key ? keyPicker : identity?.pickerId ?? 'legacy';
    const url = new URL(request.url, 'http://localhost');
    const selectors = [...url.searchParams].filter(([name]) => selectorKeys.has(name)).map(([, value]) => value);
    for (const name of ['x-picker-id', 'x-picker']) if (request.headers[name] !== undefined) selectors.push(request.headers[name]);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw httpError(400, 'Invalid URL.'); }
    const pathScope = /^(?:\/api)?\/pickers\/([^/]+)(\/.*|$)/.exec(pathname);
    if (pathScope) selectors.push(pathScope[1]);
    const checkSelectors = () => {
      if (selectors.some(value => typeof value !== 'string' || value !== pickerId) || new Set(selectors).size > 1) throw httpError(403, 'Picker access denied.');
    };
    checkSelectors();
    const checkBody = body => {
      const pending = [body];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        for (const [name, item] of Object.entries(value)) {
          if (selectorKeys.has(name)) selectors.push(item);
          else if (item && typeof item === 'object') pending.push(item);
        }
      }
      checkSelectors();
      for (const name of selectorKeys) delete body[name];
    };
    const route = pathScope ? (pathname.startsWith('/api/') ? '/api' : '') + (pathScope[2] || '/') : pathname;
    const backup = isImportRoute(route) && request.method === 'POST';
    // Legacy backup admission and parsing stay entirely in its handler.
    // Owned backups acquire the context's import guard before any parser runs.
    if (!backup && /^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') && !['GET', 'HEAD'].includes(request.method)) {
      checkBody(await bodyJSON(request, MAX_BODY, { remember: true }));
    }
    checkSelectors();
    const current = legacy.authenticate(request, security);
    if (identity && (!current || current.accountId !== identity.accountId || current.sessionId !== identity.sessionId || current.kind !== identity.kind)) throw httpError(401, 'Access required.');
    if (identity?.pickerId && pathname === '/auth/claim') throw httpError(403, 'Picker access denied.');
    if (capability) {
      const picker = registry.getPicker(capability.pickerId);
      const member = registry.getAccount(capability.accountId)?.memberships.find(m => m.pickerId === capability.pickerId && m.memberId === capability.memberId);
      if (picker?.lifecycle !== 'active' || picker.provisioning !== 'ready' || !member || member.role === 'viewer') throw httpError(403, 'Picker access denied.');
    }
    if (identity?.pickerId) {
      const picker = registry.getPicker(identity.pickerId);
      if (picker?.lifecycle !== 'active' || picker.provisioning !== 'ready') throw httpError(403, 'Picker access denied.');
    }
    if (pathScope) url.pathname = (pathname.startsWith('/api/') ? '/api' : '') + (pathScope[2] || '/');
    for (const name of selectorKeys) url.searchParams.delete(name);
    request.url = url.pathname + url.search;
    // Pending OAuth callbacks and sign-out always use the one session issuer.
    if (pathname.startsWith('/auth/') || pathname.startsWith('/join/')) return { context: legacy };
    if (pickerId === 'legacy') return { context: legacy, legacyBackup: backup, checkBody };
    if (!identity && !capability) throw httpError(401, 'Access required.');
    const entry = await acquire(pickerId);
    return { context: entry.context, entry, backup, checkBody };
  }
  return {
    authenticate,
    authenticateKey(request, pickerId, memberId) {
      const key = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
      const capability = key && registry.resolveCapability('plugin-key', digest(key));
      const picker = capability && registry.getPicker(capability.pickerId);
      const membership = capability && registry.getAccount(capability.accountId)?.memberships.find(m => m.pickerId === pickerId && m.memberId === memberId && m.role !== 'viewer');
      if (!capability || capability.pickerId !== pickerId || capability.memberId !== memberId || !membership
        || picker.lifecycle !== 'active' || picker.provisioning !== 'ready') throw httpError(401, 'A game plugin key is required.');
    },
    async indexKey(identity, key, memberId) {
      if (!identity.pickerId) return;
      await registry.setCapability({ kind: 'plugin-key', hash: digest(key), pickerId: identity.pickerId, accountId: identity.accountId, memberId });
    },
    async removeKey(identity, hash, memberId) {
      if (!identity.pickerId) return;
      const capability = registry.resolveCapability('plugin-key', hash);
      if (capability && (capability.pickerId !== identity.pickerId || capability.accountId !== identity.accountId || capability.memberId !== memberId)) throw httpError(403, 'Picker access denied.');
      await registry.revokeCapability('plugin-key', hash);
    },
    async handle(request, response, listener) {
      let entry, releaseImport;
      try {
        if (closed) throw retry();
        const options = { ...listener, publicOrigin };
        const security = listener.ingressRole === 'public' ? requestContext(request, options) : requestContextFor(request, options);
        const selected = await contextFor(request, security); entry = selected.entry;
        if (selected.legacyBackup) selected.context.checkImportBody(request, selected.checkBody);
        if (selected.backup) {
          releaseImport = selected.context.admitImport(request, security);
          const imported = await readBackupRequest(request);
          selected.checkBody(imported.body);
          rememberRoutedBody(request, imported.body, 0); routedBody(request).imported = imported;
        }
        await selected.context.handle(request, response, listener);
        if (entry && !response.writableEnded && !response.destroyed) {
          entry.streams.add(response);
          response.once('close', () => { entry.streams.delete(response); idle(entry); });
        }
      } catch (error) {
        if (!response.headersSent && !response.destroyed) {
          if (!request.complete) response.setHeader('Connection', 'close');
          if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
          const badInput = error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError;
          await json(request, response, error.status ?? (badInput ? 400 : 503), { message: error.status ? error.message : badInput ? 'Invalid request.' : 'The picker is unavailable. Retry in a moment.' });
        }
      } finally { releaseImport?.(); if (entry) { entry.active--; if (entries.get(entry.id) === entry) idle(entry); } }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      closing = serialize(async () => { await Promise.all([...entries.values()].map(evict)); });
      return closing;
    },
  };
}
