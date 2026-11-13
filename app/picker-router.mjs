const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('./profile-spans.mjs') : undefined;
import { createPickerAdmission, COLD_OPEN_ADMISSION } from './picker-admission.mjs';
import { setTimeout as admissionDelay } from 'node:timers/promises';
import { createPickerCheckpoint } from './picker-router-checkpoint.mjs';
import { createHash } from 'node:crypto';
import { isImportRoute, readBackupRequest, receiveBackupRequest } from './backup-transfer.mjs';
import { reserveImportUser } from './import-jobs.mjs';
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
  pickerLimits, onAdmission, admissionClock, coldOpenAdmission, unauthenticated = () => {}, backupRetentionMs, maxOpenContexts = 7, idleCloseMs = 10 * 60 * 1000, maxConcurrentImports = 1 }) {
  if (!Number.isSafeInteger(maxOpenContexts) || maxOpenContexts < 1 || !Number.isSafeInteger(idleCloseMs) || idleCloseMs < 1) throw new TypeError('Invalid picker residency limits.');
  if (!Number.isSafeInteger(maxConcurrentImports) || maxConcurrentImports < 1) throw new TypeError('Invalid picker import limit.');
  const admissionBounds = Object.freeze({ ...COLD_OPEN_ADMISSION, ...coldOpenAdmission });
  for (const key of Object.keys(COLD_OPEN_ADMISSION)) if (!Number.isSafeInteger(admissionBounds[key]) || admissionBounds[key] < 1) throw new TypeError(`Invalid cold admission ${key}.`);
  const entries = new Map(), waiters = new Map();
  const admission = pickerLimits && createPickerAdmission({ limits: pickerLimits, onEvent: onAdmission, bounds: admissionBounds, clock: admissionClock });
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
    fencePicker: id => { const pending = receiving.get(id); if (pending && !pending.complete) pending.destroy(); const entry = entries.get(id); if (entry) { entry.deleting = true; if (!entry.closing) entry.context?.fenceDeletion(); } },
    fenceSessions: () => {
      legacy.fenceRevokedSessions();
      for (const entry of entries.values()) if (!entry.closing) entry.context?.fenceRevokedSessions();
    },
    drainPicker: (id, phase) => drainPicker(id, phase),
  });
  function drainPicker(id, phase) {
      if (phase === 'revoke') {
        const entry = entries.get(id);
        if (!entry) return;
        entry.deleting = true; clearTimeout(entry.timer);
        // An opening owns its directory until the factory and late close drain.
        // It must not race deletion's sidecar revocation or directory removal.
        if (!entry.published) return evict(entry);
        if (entry.closing) return;
        return entry.revoking ??= entry.context.revokeDeletion();
      }
      // Reserve the closing entry under the queue, then drain only this picker
      // outside it. Closing entries cannot be selected as capacity victims.
      return serialize(() => {
        const entry = entries.get(id);
        if (entry) { clearTimeout(entry.timer); entry.closing = true; }
        return entry;
      }).then(async entry => { if (entry) await evict(entry); });
  }
  function serialize(operation) {
    const pending = queue.then(operation); queue = pending.catch(() => {}); return pending;
  }
  const checkpoint = createPickerCheckpoint({ serialize, entries, registry, legacy });
  function evict(entry) {
    clearTimeout(entry.timer);
    entry.closing = true;
    return entry.draining ??= (async () => {
      await entry.opening?.catch(() => {});
      await closeContext(entry);
    })();
  }
  async function closeContext(entry) {
    entry.closing = true;
    await entry.revoking;
    // Keep even a failed close fenced. Only a fully drained context may give up
    // residency/storage ownership. All callers share this one close operation.
    if (entry.context) await (entry.contextClose ??= entry.context.close());
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
  }
  const checkpointBlocked = entry => storeWriteBlocked(registry.pickerDirectory(entry.id));
  const waiting = entry => waiters.get(entry.id)?.size;
  const available = entry => entry?.published && !entry.closing && !entry.deleting;
  function checkOpen(id) {
    if (closed) throw retry();
    if (registry.getPicker(id)?.lifecycle !== 'active') throw httpError(403, 'Picker access denied.');
  }
  function pin(entry, signal) {
    signal?.throwIfAborted(); checkOpen(entry.id);
    if (entries.get(entry.id) !== entry || !available(entry)) return null;
    clearTimeout(entry.timer);
    entries.delete(entry.id); entries.set(entry.id, entry); entry.active++;
    return entry;
  }
  function startOpen(entry) {
    entry.opening = (async () => {
      try {
        // Initialization participates in the directory's snapshot barrier. If a
        // checkpoint arrives during it, release this write before re-entering
        // for publication, so neither publication nor delivery bypasses it.
        await checkpoint.open(entry.id, async () => {
          checkOpen(entry.id);
          if (!entry.closing && !entry.deleting && waiting(entry)) entry.context = await openContext(entry.id);
        });
        if (!entry.context) return entry;
        const published = await checkpoint.open(entry.id, () => serialize(() => {
          if (closed || entry.closing || entry.deleting || !waiting(entry)
            || entries.get(entry.id) !== entry || registry.getPicker(entry.id)?.lifecycle !== 'active') return false;
          entry.published = true; return true;
        }));
        if (!published) {
          if (entry.deleting) { entry.context.fenceDeletion(); entry.revoking ??= entry.context.revokeDeletion(); }
          await closeContext(entry);
        }
      } catch (error) {
        await closeContext(entry); throw error;
      } finally {
        if (!entry.context && entries.get(entry.id) === entry) entries.delete(entry.id);
      }
      // Optional work starts only after the factory's storage barrier is gone.
      // The context tracks preparation so its own close still drains it.
      if (available(entry)) {
        void Promise.resolve().then(() => {
          if (!available(entry)) return;
          entry.context.startBackground?.(); return entry.context.prepare?.();
        }).catch(() => {});
      }
      return entry;
    })();
  }
  function idle(entry) {
    clearTimeout(entry.timer);
    if (closed || !available(entry) || entries.get(entry.id) !== entry || entry.active || waiting(entry) || entry.streams.size) return;
    entry.timer = setTimeout(() => {
      void serialize(() => {
        if (closed || !available(entry) || entries.get(entry.id) !== entry || entry.active || waiting(entry) || entry.streams.size) return;
        // A checkpoint holds this directory: closing now would hold the queue behind the copy.
        if (checkpointBlocked(entry)) return idle(entry);
        entry.closing = true; return entry;
      }).then(victim => victim && evict(victim)).catch(() => {});
    }, idleCloseMs);
    entry.timer.unref();
  }
  async function acquire(id, owner, signal) {
    // Warm acquisition has no await between checking closing/active and pinning
    // the entry. That is atomic with victim selection on the event loop, so an
    // unrelated cold factory must not hold it behind the residency queue. The
    // per-directory checkpoint barrier still applies; recheck after that wait.
    if (available(entries.get(id))) {
      const entry = await checkpoint.open(id, () => {
        const warm = entries.get(id);
        signal?.throwIfAborted(); checkOpen(id);
        return warm && pin(warm, signal);
      });
      if (entry) return entry;
    }
    const waiter = {}, group = waiters.get(id) ?? new Set();
    group.add(waiter); waiters.set(id, group);
    const detach = () => {
      if (!group.delete(waiter)) return;
      if (group.size) return;
      if (waiters.get(id) === group) waiters.delete(id);
      const entry = entries.get(id);
      if (!entry || entry.active) return;
      // Publication already made this a usable resident. A disconnect during
      // the handoff can leave it idle, just as a completed warm request does.
      if (available(entry)) { idle(entry); return; }
      // Once abandoned, fence the generation until its late factory and close
      // finish; a retry cannot attach to a context already being torn down.
      return evict(entry);
    };
    const open = async admittedSignal => {
      const workSignal = admittedSignal ?? signal;
      for (let retries = 0; ; retries++) {
        workSignal?.throwIfAborted();
        const selected = await serialize(() => {
          workSignal?.throwIfAborted(); checkOpen(id);
          let entry = entries.get(id);
          if (entry?.closing || entry?.deleting) return {};
          if (!entry) {
            if (maxOpenContexts === 1) throw retry();
            if (entries.size >= maxOpenContexts - 1) {
              const victim = [...entries.values()].find(candidate => available(candidate) && !candidate.active && !waiting(candidate) && !checkpointBlocked(candidate));
              if (victim) { victim.closing = true; return { victim }; }
              return {};
            }
            entry = { id, active: 0, streams: new Set(), published: false };
            entries.set(id, entry);
            startOpen(entry);
          }
          return { entry };
        });
        if (selected.victim) { await evict(selected.victim); workSignal?.throwIfAborted(); continue; }
        if (selected.entry) {
          const entry = await selected.entry.opening;
          if (entry.closing) await evict(entry);
          workSignal?.throwIfAborted(); checkOpen(id);
          if (available(entry)) return entry;
        }
        if (!admission || retries >= admissionBounds.maxRetries) throw retry();
        await admissionDelay(admissionBounds.retryMs, undefined, { signal: workSignal });
      }
    };
    const work = PROFILE_ENABLED ? profile.bind(signal => profile.span('context.open', () => open(signal))) : open;
    const disconnected = () => { void detach()?.catch(() => {}); };
    if (!admission) signal?.addEventListener('abort', disconnected, { once: true });
    try {
      const entry = await (admission ? admission.run(owner, work, signal, { onCancel: detach, sharedKey: id }) : work(signal));
      const pinned = await checkpoint.open(id, () => pin(entry, signal));
      if (!pinned) throw retry();
      return pinned;
    } finally {
      signal?.removeEventListener('abort', disconnected);
      // Successful pins belong to handle() now. Failed/cancelled acquisition
      // can leave a drain running, but admission keeps its started lease for it.
      void detach()?.catch(() => {});
    }
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
    getResidencyLimits: () => ({ maxOpenContexts, idleCloseMs,
      coldStartsPerAccount: pickerLimits?.config.coldStartsPerAccount, coldStartsGlobal: pickerLimits?.config.coldStartsGlobal,
      coldAdmission: { maxPending: admissionBounds.maxPending, perAccount: admissionBounds.perAccount, deadlineMs: admissionBounds.deadlineMs } }),
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
      let entry, releaseImport, releaseCheckpoint, bindBody, upload, receivingId, releaseImportUser;
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
          releaseImportUser = reserveImportUser(identity.accountId ?? identity.id ?? identity.sessionId ?? security.rateKey);
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
          const imported = await readBackupRequest(upload, { defer: true });
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
      } finally { request.off('aborted', disconnected); response.off('close', disconnected); if (receiving.get(receivingId) === request) receiving.delete(receivingId); bindBody?.release(); releaseCheckpoint?.(); releaseImport?.(); releaseImportUser?.(); if (entry) { entry.active--; if (entries.get(entry.id) === entry) idle(entry); } }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      const draining = serialize(() => [...entries.values()].map(entry => { entry.closing = true; return entry; }))
        .then(reserved => Promise.all(reserved.map(evict)));
      closing = Promise.all([admission?.close(), deletion.drain(), draining]).then(() => {});
      return closing;
    },
  };
}
