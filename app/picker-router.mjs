const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('./profile-spans.mjs') : undefined;
import { createPickerAdmission, COLD_OPEN_ADMISSION } from './picker-admission.mjs';
import { setTimeout as admissionDelay } from 'node:timers/promises';
import { createPickerCheckpoint } from './picker-router-checkpoint.mjs';
import { createHash } from 'node:crypto';
import { isImportRoute, readBackupRequest, receiveBackupRequest } from './backup-transfer.mjs';
import { routedBody, rememberRoutedBody, httpError, json } from './picker-context-http.mjs';
import { checkBodyWith } from './security/json.mjs';
import { createPickerDeletion } from './picker-router-deletion.mjs';
import { requestContext, checkRequestOrigin } from './security/request.mjs';
import { reconcileTombstones } from './storage/tombstones.mjs';
import { storeWriteBlocked } from './storage/snapshot.mjs';

const digest = key => createHash('sha256').update(key).digest('hex');
const selectorKeys = new Set(['picker', 'pickerId']);
const retry = () => Object.assign(httpError(503, 'The picker is unavailable. Retry in a moment.'), { retryAfter: 1 });

/** The only residency and HTTP selection boundary. IDs from requests are checks,
 * never inputs to acquisition, registry path lookup or capability registration. */
export function createPickerRouter({ registry, legacy, openContext, publicOrigin, requestContextFor = requestContext,
  pickerLimits, onAdmission, unauthenticated = () => {}, backupRetentionMs, maxOpenContexts = 7, idleCloseMs = 10 * 60 * 1000, maxConcurrentImports = 1 }) {
  if (!Number.isSafeInteger(maxOpenContexts) || maxOpenContexts < 1 || !Number.isSafeInteger(idleCloseMs) || idleCloseMs < 1) throw new TypeError('Invalid picker residency limits.');
  if (!Number.isSafeInteger(maxConcurrentImports) || maxConcurrentImports < 1) throw new TypeError('Invalid picker import limit.');
  const entries = new Map();
  const admission = pickerLimits && createPickerAdmission({ limits: pickerLimits, onEvent: onAdmission });
  // Process-wide budget for owned backup parsers, on top of each context's own
  // single-import guard, so many owners cannot each materialize a large backup
  // at once. Legacy keeps its own guard and is outside this budget.
  let imports = 0;
  // Owned backup bodies are received after authorization but before their
  // context is acquired, so a slow body never pins residency. One receipt per
  // picker; deletion cuts off the deleted picker's receipt.
  const receiving = new Map();
  let queue = Promise.resolve(), closed = false, closing;
  const deletion = createPickerDeletion({ registry, legacy, backupRetentionMs, afterPurge: () => pickerLimits?.forgetDeleted(),
    fencePicker: id => { const pending = receiving.get(id); if (pending && !pending.complete) pending.destroy(); const entry = entries.get(id); if (entry && !entry.closing) entry.context.fenceDeletion(); },
    fenceSessions: () => {
      legacy.fenceRevokedSessions();
      for (const entry of entries.values()) if (!entry.closing) entry.context.fenceRevokedSessions();
    },
    drainPicker: (id, phase) => drainPicker(id, phase),
  });
  function drainPicker(id, phase) {
      if (phase === 'revoke') {
        const entry = entries.get(id);
        if (entry && !entry.closing) { clearTimeout(entry.timer); return entry.revoking ??= entry.context.revokeDeletion(); }
        return;
      }
      // Reserve the closing entry under the queue, then drain only this picker
      // outside it. Closing entries cannot be selected as capacity victims.
      return serialize(() => {
        const entry = entries.get(id);
        if (entry) { clearTimeout(entry.timer); entry.closing = true; }
        return entry;
      }).then(async entry => { if (entry) { await entry.revoking; await evict(entry); } });
  }
  function serialize(operation) {
    const pending = queue.then(operation); queue = pending.catch(() => {}); return pending;
  }
  const checkpoint = createPickerCheckpoint({ serialize, entries, registry, legacy });
  async function evict(entry) {
    clearTimeout(entry.timer);
    entry.closing = true;
    // Keep the entry until close drains, so no writer can reopen alongside it.
    try { await entry.context.close(); } finally { entries.delete(entry.id); }
  }
  const checkpointBlocked = entry => storeWriteBlocked(registry.pickerDirectory(entry.id));
  function idle(entry) {
    clearTimeout(entry.timer);
    if (closed || entry.closing || entries.get(entry.id) !== entry || entry.active || entry.streams.size) return;
    entry.timer = setTimeout(() => {
      void serialize(async () => {
        if (closed || entry.closing || entries.get(entry.id) !== entry || entry.active || entry.streams.size) return;
        // A checkpoint holds this directory: closing now would hold the queue behind the copy.
        if (checkpointBlocked(entry)) return idle(entry);
        await evict(entry);
      }).catch(() => {});
    }, idleCloseMs);
    entry.timer.unref();
  }
  async function acquire(id, owner, signal) {
    const attempt = () => checkpoint.open(id, () => serialize(async () => {
      signal?.throwIfAborted();
      if (closed) throw retry();
      if (registry.getPicker(id)?.lifecycle !== 'active') throw httpError(403, 'Picker access denied.');
      let entry = entries.get(id);
      if (entry?.closing) return null;
      if (!entry) {
        if (maxOpenContexts === 1) throw retry();
        if (entries.size >= maxOpenContexts - 1) {
          // Only idle contexts may be evicted. Wait outside the residency queue
          // if every context is busy or held by a checkpoint.
          const victim = [...entries.values()].find(candidate => !candidate.active && !candidate.closing && !checkpointBlocked(candidate));
          if (!victim) return null;
          await evict(victim);
          signal?.throwIfAborted();
        }
        const context = await openContext(id);
        if (closed || signal?.aborted || registry.getPicker(id)?.lifecycle !== 'active') { await context.close(); signal?.throwIfAborted(); throw retry(); }
        entry = { id, context, active: 0, streams: new Set() };
      }
      clearTimeout(entry.timer);
      entries.delete(id); entries.set(id, entry); entry.active++;
      return entry;
    }));
    // Warm acquisition has no await between checking closing/active and pinning
    // the entry. That is atomic with victim selection on the event loop, so an
    // unrelated cold factory must not hold it behind the residency queue. The
    // per-directory checkpoint barrier still applies; recheck after that wait.
    if (entries.has(id)) {
      const entry = await checkpoint.open(id, () => {
        signal?.throwIfAborted();
        if (closed) throw retry();
        if (registry.getPicker(id)?.lifecycle !== 'active') throw httpError(403, 'Picker access denied.');
        const warm = entries.get(id);
        if (!warm || warm.closing) return null;
        clearTimeout(warm.timer); entries.delete(id); entries.set(id, warm); warm.active++; return warm;
      });
      if (entry) return entry;
    }
    const open = async admittedSignal => {
      signal = admittedSignal ?? signal;
      for (let retries = 0; ; retries++) {
        signal?.throwIfAborted();
        const entry = await attempt();
        if (entry) return entry;
        if (!admission || retries >= COLD_OPEN_ADMISSION.maxRetries) throw retry();
        await admissionDelay(COLD_OPEN_ADMISSION.retryMs, undefined, { signal });
      }
    };
    const work = PROFILE_ENABLED ? profile.bind(signal => profile.span('context.open', () => open(signal))) : open;
    return admission ? admission.run(owner, work, signal) : work(signal);
  }
  function authenticate(request, security, pickerId) {
    const identity = legacy.authenticate(request, security);
    // Auth endpoints live on legacy so OAuth pending state and session issuance
    // have one owner, including explicit provider linking and sign-out.
    const auth = pickerId === 'legacy' && (request.url ?? '').startsWith('/auth/');
    if (identity && !auth && (identity.pickerId ?? 'legacy') !== pickerId) throw httpError(403, 'Picker access denied.');
    return identity;
  }
  async function contextFor(request, security, bindBody, receiveBackup, signal) {
    let identity, legacyCredential;
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
      try { legacyCredential = legacy.authenticatePlugin(request); }
      catch (error) { unauthenticated(security.rateKey); throw error; }
    }
    // Preserve legacy rejection without consuming unauthenticated uploads.
    if (!identity && !key) { bindBody?.({ accountId: `client:${security.rateKey}`, pickerId: 'legacy' }); return { context: legacy }; }
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
    // JSON selectors are checked when the handler reads its body, after its own
    // route, role, origin and size admission. The router never buffers JSON.
    if (!backup) checkBodyWith(request, checkBody);
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
    bindBody?.(legacyCredential ? pickerLimits.pluginScope(request, pickerId, legacyCredential.player) : pickerLimits.scope(capability ?? identity, pickerId));
    if (pathname.startsWith('/auth/') || pathname.startsWith('/join/')) return { context: legacy };
    if (['/api/picker/delete', '/api/account/delete'].includes(route)) return { deletion: route, identity, security };
    if (pickerId === 'legacy') return { context: legacy, legacyBackup: backup, checkBody };
    if (!identity && !capability) throw httpError(401, 'Access required.');
    if (backup) await receiveBackup(pickerId, identity);
    const entry = await acquire(pickerId, pickerLimits?.scope(capability ?? identity, pickerId), signal);
    return { context: entry.context, entry, backup, checkBody };
  }
  return {
    checkpoint,
    async reclaimIdentity(code, provider, subject) {
      const { source } = registry.checkRelink(code, provider, subject);
      let entry;
      const commit = () => registry.claimIdentity(code, provider, subject, { emptyAccountId: source?.id ?? null,
        onCommit: id => { if (id) entries.get(id)?.context.fenceDeletion(); legacy.fenceRevokedSessions(); } });
      let account;
      try {
        if (source) {
          const picker = registry.getPicker(source.defaultPickerId);
          if (!picker || picker.kind !== 'default') throw httpError(409, 'This sign-in already has gameplay or memberships.');
          entry = await acquire(picker.id, pickerLimits?.scope(source, picker.id));
          account = await entry.context.withEmptyDefault(commit);
        } else account = await commit();
      } finally { if (entry) { entry.active--; idle(entry); } }
      await reconcileTombstones({ registry, revokeSessions: scope => legacy.revokeDeletionSessions(scope),
        revokeAccount: id => legacy.revokeDeletedAccount(id), drainPicker });
      pickerLimits?.forgetDeleted();
      return account;
    },
    accountDeletionToken: deletion.accountDeletionToken,
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
      let entry, releaseImport, releaseCheckpoint, bindBody, upload, receivingId;
      const controller = new AbortController();
      const disconnected = () => { if (!response.writableEnded) controller.abort(); };
      request.once('aborted', disconnected); response.once('close', disconnected);
      if (request.aborted || response.destroyed) controller.abort();
      try {
        if (closed) throw retry();
        releaseCheckpoint = await checkpoint.enter();
        if (closed) throw retry();
        const options = { ...listener, publicOrigin };
        const security = listener.ingressRole === 'public' ? requestContext(request, options) : requestContextFor(request, options);
        bindBody = pickerLimits?.body(request);
        // Mirrors the context's admitImport checks that need no context, so no
        // body is buffered for a request admitImport would refuse.
        const receiveBackup = async (pickerId, identity) => {
          if (!identity) throw httpError(401, 'Access required.');
          if (identity.pickerId !== pickerId || identity.role !== 'owner' || identity.readOnly) throw httpError(403, 'Picker owner access required.');
          checkRequestOrigin(request, security);
          if (receiving.has(pickerId)) throw httpError(503, 'Another backup is being checked or imported. Wait for it to finish, then try again.');
          receiving.set(pickerId, request); receivingId = pickerId;
          bindBody?.importing();
          upload = await receiveBackupRequest(request, { idleTimeoutMs: pickerLimits.config.importBodyIdleMs, totalTimeoutMs: pickerLimits.config.importBodyTotalMs });
        };
        const selected = await contextFor(request, security, bindBody, receiveBackup, controller.signal); entry = selected.entry;
        controller.signal.throwIfAborted();
        // Match the route exactly as the sign-in handler decodes it, after any
        // /pickers/<id> prefix is rewritten away.
        let signInRoute; try { signInRoute = decodeURIComponent((request.url ?? '/').split('?')[0]); } catch {}
        if (request.method === 'GET' && /^\/auth\/(?:link\/)?(?:discord|google)$/.test(signInRoute ?? '')) pickerLimits?.registration(security.rateKey);
        if (selected.deletion) { await deletion.handle(request, response, selected); return; }
        if (selected.legacyBackup) selected.context.checkImportBody(request, selected.checkBody);
        if (selected.backup) {
          releaseImport = selected.context.admitImport(request, security);
          if (imports >= maxConcurrentImports) throw Object.assign(httpError(503, 'Another backup is being checked. Wait a moment, then try again.'), { retryAfter: 5 });
          imports++;
          const releaseOwn = releaseImport; let counted = true;
          releaseImport = () => { if (counted) { counted = false; imports--; } releaseOwn(); };
          const imported = await readBackupRequest(upload);
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
      } finally { request.off('aborted', disconnected); response.off('close', disconnected); if (receiving.get(receivingId) === request) receiving.delete(receivingId); bindBody?.release(); releaseCheckpoint?.(); releaseImport?.(); if (entry) { entry.active--; if (entries.get(entry.id) === entry) idle(entry); } }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      closing = Promise.all([admission?.close(), deletion.drain()]).then(() => serialize(async () => { await Promise.all([...entries.values()].map(evict)); }));
      return closing;
    },
  };
}
