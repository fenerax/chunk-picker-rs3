const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('./profile-spans.mjs') : undefined;
import { createPickerAdmission, COLD_OPEN_ADMISSION } from './picker-admission.mjs';
import { setTimeout as admissionDelay } from 'node:timers/promises';
import { createPickerCheckpoint } from './picker-router-checkpoint.mjs';
import { createHash } from 'node:crypto';
import { isImportRoute, readBackupRequest, receiveBackupRequest } from './backup-transfer.mjs';
import { reserveImportUser } from './import-jobs.mjs';
import { routedBody, rememberRoutedBody, httpError, json, bodyJSON } from './picker-context-http.mjs';
import { characterMenuPage } from './character-menu.mjs';
import { createGroupInviteService } from './group-invite-service.mjs';
import { createGroupHandoverHandler } from './group-handover-http.mjs';
import { createGroupDepartureService } from './group-departure-service.mjs';
import { createGroupDepartureHandler } from './group-departure-http.mjs';
import { checkBodyWith } from './security/json.mjs';
import { createPickerDeletion } from './picker-router-deletion.mjs';
import { requestContext, checkRequestOrigin } from './security/request.mjs';
import { reconcileTombstones, backupDeletionDisclosure } from './storage/tombstones.mjs';
import { storeWriteBlocked } from './storage/snapshot.mjs';

const digest = key => createHash('sha256').update(key).digest('hex');
const selectorKeys = new Set(['picker', 'pickerId']);
const retry = () => Object.assign(httpError(503, 'The picker is unavailable. Retry in a moment.'), { retryAfter: 1 });

/** The only residency and HTTP selection boundary. IDs from requests are checks,
 * never inputs to acquisition, registry path lookup or capability registration. */
export function createPickerRouter({ registry, legacy, openContext, publicOrigin, requestContextFor = requestContext,
  pickerLimits, onAdmission, admissionClock, importBodyClock, onImportBodyChunk, coldOpenAdmission, unauthenticated = () => {}, backupRetentionMs, maxOpenContexts = 7, idleCloseMs = 10 * 60 * 1000, maxConcurrentImports = 1 }) {
  if (!Number.isSafeInteger(maxOpenContexts) || maxOpenContexts < 1 || !Number.isSafeInteger(idleCloseMs) || idleCloseMs < 1) throw new TypeError('Invalid picker residency limits.');
  if (!Number.isSafeInteger(maxConcurrentImports) || maxConcurrentImports < 1) throw new TypeError('Invalid picker import limit.');
  const admissionBounds = Object.freeze({ ...COLD_OPEN_ADMISSION, ...coldOpenAdmission });
  for (const key of Object.keys(COLD_OPEN_ADMISSION)) if (!Number.isSafeInteger(admissionBounds[key]) || admissionBounds[key] < 1) throw new TypeError(`Invalid cold admission ${key}.`);
  const entries = new Map();
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
    async using(id, work) { const entry = await acquire(id, pickerLimits?.scope({ accountId: registry.getPicker(id)?.ownerAccountId }, id)); try { return await work(entry.context); } finally { entry.active--; idle(entry); } },
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
  const groupInvites = createGroupInviteService({ registry, acquire: id => acquire(id, pickerLimits?.scope({ accountId: registry.getPicker(id)?.ownerAccountId }, id)), release(entry) { entry.active--; idle(entry); },
    point: (name, pickerId) => registry.groupInvitePoint(name, pickerId) });
  const handover = createGroupHandoverHandler({ registry, authenticate: (request, security) => legacy.authenticate(request, security), limits: pickerLimits,
    async using(id, work) { const entry = await acquire(id, pickerLimits?.scope({ accountId: registry.getPicker(id)?.ownerAccountId }, id)); try { return await work(entry.context); } finally { entry.active--; idle(entry); } } });
  const departures = createGroupDepartureService({ registry: pickerLimits?.provisioningRegistry(registry) ?? registry, point: (name, id) => registry.groupInvitePoint(name, id),
    async using(id, work) { const entry = await acquire(id, pickerLimits?.scope({ accountId: registry.getPicker(id)?.ownerAccountId }, id)); try { return await work(entry.context); } finally { entry.active--; idle(entry); } } });
  const departureHTTP = createGroupDepartureHandler({ registry, service: departures, authenticate: (request, security) => legacy.authenticate(request, security), backupDisclosure: backupDeletionDisclosure(backupRetentionMs), available: () => maxOpenContexts >= 3 });
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
        if (!admission || retries >= admissionBounds.maxRetries) throw retry();
        await admissionDelay(admissionBounds.retryMs, undefined, { signal });
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
    const physical = registry.getPicker(identity?.pickerId)?.kind === 'legacy-shared' ? 'legacy' : identity?.pickerId ?? 'legacy';
    if (identity && !auth && physical !== pickerId) throw httpError(403, 'Picker access denied.');
    return identity;
  }
  async function contextFor(request, security, bindBody, receiveBackup, signal) {
    let identity, legacyCredential;
    try { identity = legacy.authenticate(request, security); } catch (error) {
      let page;
      try { page = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { throw error; }
      if (error.status === 403 && error.message === 'Administrator access requires a private connection.' && security.publicRequest && !request.headers.authorization && !page.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) return { context: legacy };
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
    const pickerId = key ? keyPicker : registry.getPicker(identity?.pickerId)?.kind === 'legacy-shared' ? 'legacy' : identity?.pickerId ?? 'legacy';
    const url = new URL(request.url, 'http://localhost');
    const selectors = [...url.searchParams].filter(([name]) => selectorKeys.has(name)).map(([, value]) => value);
    for (const name of ['x-picker-id', 'x-picker']) if (request.headers[name] !== undefined) selectors.push(request.headers[name]);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw httpError(400, 'Invalid URL.'); }
    const pathScope = /^(?:\/api)?\/pickers\/([^/]+)(\/.*|$)/.exec(pathname);
    if (identity?.accountScope && !identity.characterId && !identity.pickerId && pathname.startsWith('/api/') && pathname !== '/api/session') throw httpError(409, 'Select a character from your character menu before opening gameplay.');
    if (identity?.accountScope && !identity.characterId && !identity.pickerId && request.method === 'GET' && (pathname === '/' || pathScope && (!pathScope[2] || pathScope[2] === '/'))) return { redirect: '/characters' };
    if (pathScope) selectors.push(pathScope[1] === identity?.pickerId ? pickerId : pathScope[1]);
    if (identity?.characterId && !pathname.startsWith('/auth/') && !pathname.startsWith('/join/')) request.registryCharacterId = identity.characterId;
    const checkSelectors = () => {
      if (selectors.some(value => typeof value !== 'string' || value !== pickerId && !(pickerId === 'legacy' && value === identity?.pickerId))) throw httpError(403, 'Picker access denied.');
    };
    checkSelectors();
    if (identity?.accountScope && identity.role !== 'viewer' && request.method === 'GET' && (pathname === '/' || pathScope && (!pathScope[2] || pathScope[2] === '/')) && !url.searchParams.has('character')) {
      if (!identity.characterId) return { redirect: '/characters' };
      for (const name of selectorKeys) url.searchParams.delete(name);
      url.searchParams.set('character', identity.characterId);
      return { redirect: `/pickers/${identity.pickerId}/${url.search}` };
    }
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
      const characterSelectors = [];
      const visit = value => { if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) { if (name === 'characterId') characterSelectors.push(item); else if (item && typeof item === 'object') visit(item); } };
      visit(body);
      // Admission explicitly selects a source character using account authority.
      // The invite service validates that choice; it is not a gameplay selector.
      if (!pathname.startsWith('/auth/group-invite/') && characterSelectors.some(id => id !== identity?.characterId)) throw httpError(403, 'Conflicting character selection.');
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
    url.searchParams.delete('character');
    // Keep the authorized group when context authentication runs again after
    // stripping URL selectors, including viewers without an acting character.
    if (identity?.pickerId) request.registryPickerId = identity.pickerId;
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
    groupInvites,
    departures,
    deletion,
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
    authenticate,
    authenticateKey(request, pickerId, memberId) {
      const key = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
      const capability = key && registry.resolveCapability('plugin-key', digest(key));
      const picker = capability && registry.getPicker(capability.pickerId);
      const membership = capability && registry.getAccount(capability.accountId)?.memberships.find(m => m.pickerId === pickerId && m.memberId === memberId && m.role !== 'viewer');
      if (!capability || registry.pickerAdmissionPending(pickerId) || capability.pickerId !== pickerId || capability.memberId !== memberId || !membership
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
        const target = new URL(request.url, 'http://localhost');
        if (['/api/deletion', '/api/character/delete', '/api/picker/delete', '/api/account/delete'].includes(target.pathname)) { await deletion.handle(request, response, security, bindBody); return; }
        if (target.pathname === '/api/group-departure' || ['/past-maps', '/api/past-maps', '/past-maps.mjs', '/past-maps.css'].includes(target.pathname) || target.pathname.startsWith('/past-maps/') || target.pathname.startsWith('/api/past-maps/')) { await departureHTTP(request, response, security, bindBody); return; }
        if (target.pathname === '/api/group-handover') { await handover(request, response, security, bindBody); return; }
        if (target.pathname === '/api/group-invites') {
          const identity = legacy.authenticate(request, security);
          if (identity?.kind !== 'account' || !identity.characterId || registry.getPicker(identity.pickerId)?.ownerCharacterId !== identity.characterId) throw httpError(403, 'Select the group owner character to manage invitations.');
          bindBody?.({ accountId: identity.accountId, pickerId: identity.pickerId });
          if (request.method === 'GET') { await registry.cleanGroupInvites(); await json(request, response, 200, { invites: registry.listGroupInvites(identity.accountId, identity.pickerId) }); return; }
          if (request.method !== 'POST') throw httpError(405, 'Use GET or POST.');
          checkRequestOrigin(request, security);
          if (!publicOrigin || new URL(publicOrigin).protocol !== 'https:') throw httpError(409, 'Player invitations require a configured HTTPS public origin.');
          const body = await bodyJSON(request, 4096);
          if (Object.keys(body).some(k => !['revokeId', 'replaceId'].includes(k)) || body.revokeId && body.replaceId) throw httpError(400, 'Invalid invitation request.');
          if (body.revokeId) { await json(request, response, 200, await registry.revokeGroupInvite(identity.accountId, identity.pickerId, body.revokeId, identity.characterId)); return; }
          pickerLimits?.invitation(identity, identity.pickerId);
          const result = await registry.createGroupInvite(identity.accountId, identity.pickerId, body.replaceId, identity.characterId);
          const { secret, ...meta } = result;
          await json(request, response, 200, { ...meta, link: `${publicOrigin}/join/${secret}` }); return;
        }
        if (target.pathname === '/characters' || /^\/characters\/[^/]+$/.test(target.pathname) || target.pathname === '/api/characters') {
          const identity = legacy.authenticate(request, security);
          if (identity?.kind !== 'account') {
            if (request.method === 'GET' && target.pathname.startsWith('/characters')) {
              response.writeHead(303, { Location: `/auth/signin?returnTo=${encodeURIComponent(target.pathname + target.search)}`, 'Cache-Control': 'private, no-store' }); response.end(); return;
            }
            throw httpError(401, 'Sign in to open your characters.');
          }
          bindBody?.({ accountId: identity.accountId, pickerId: identity.pickerId ?? 'legacy' });
          if (target.pathname === '/api/characters') {
            if (request.method === 'GET') {
              const viewerMemberships = registry.getAccount(identity.accountId).memberships.filter(m => m.role === 'viewer').map(m => {
                const picker = registry.getPicker(m.pickerId);
                return { pickerId: m.pickerId, groupLabel: picker?.kind === 'legacy-shared' ? 'Shared game' : 'Group game',
                  playerCount: picker?.seats.length ?? 0, available: picker?.lifecycle === 'active' && picker.provisioning === 'ready', href: `/pickers/${m.pickerId}/` };
              });
              await json(request, response, 200, { accountId: identity.accountId, characters: registry.listCharacters(identity.accountId), viewerMemberships }); return;
            }
            if (request.method !== 'POST') throw httpError(405, 'Use GET or POST.');
            checkRequestOrigin(request, security);
            const body = await bodyJSON(request, 4096);
            if (Object.keys(body).some(name => !['requestId', 'runescapeName', 'acknowledgeDuplicate'].includes(name)) || body.acknowledgeDuplicate !== undefined && typeof body.acknowledgeDuplicate !== 'boolean') throw httpError(400, 'Invalid character creation request.');
            const result = await pickerLimits.provisioningRegistry(registry).addCharacter(identity.accountId, body);
            await json(request, response, 200, { character: { ...result.character, href: `/characters/${result.character.id}` } }); return;
          }
          if (request.method !== 'GET') throw httpError(405, 'Use GET.');
          if (target.pathname === '/characters') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }); response.end(characterMenuPage()); return;
          }
          const character = registry.selectCharacter(identity.accountId, target.pathname.slice('/characters/'.length));
          await registry.rememberCharacter(identity.accountId, character.id);
          response.writeHead(303, { Location: `/pickers/${character.placement.pickerId}/?character=${character.id}`, 'Cache-Control': 'private, no-store' }); response.end(); return;
        }
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
          upload = await receiveBackupRequest(request, { idleTimeoutMs: pickerLimits.config.importBodyIdleMs,
            totalTimeoutMs: pickerLimits.config.importBodyTotalMs, clock: importBodyClock, onChunk: onImportBodyChunk });
        };
        const selected = await contextFor(request, security, bindBody, receiveBackup, controller.signal); entry = selected.entry;
        if (selected.redirect) { response.writeHead(303, { Location: selected.redirect, 'Cache-Control': 'private, no-store' }); response.end(); return; }
        controller.signal.throwIfAborted();
        // Match the route exactly as the sign-in handler decodes it, after any
        // /pickers/<id> prefix is rewritten away.
        let signInRoute; try { signInRoute = decodeURIComponent((request.url ?? '/').split('?')[0]); } catch {}
        if (request.method === 'GET' && /^\/auth\/(?:link\/)?(?:discord|google)$/.test(signInRoute ?? '')) pickerLimits?.registration(security.rateKey);
        if (selected.deletion) { await deletion.handle(request, response, selected.security, bindBody); return; }
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
          const pathname = new URL(request.url, 'http://localhost').pathname;
          if ([403, 410].includes(error.status) && ['GET', 'HEAD'].includes(request.method) && (pathname.startsWith('/characters/') || pathname.startsWith('/pickers/'))) {
            const text = pathname.startsWith('/characters/') ? 'This character was deleted, moved, or is unavailable to this login.' : 'You are no longer a member of this group, or the group was deleted.';
            response.writeHead(error.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' }); response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Map unavailable</title><main><h1>Map unavailable</h1><p>${text}</p><a href="/characters">Open your character menu</a></main></html>`); return;
          }
          await json(request, response, error.status ?? (badInput ? 400 : 503), { message: error.status ? error.message : badInput ? 'Invalid request.' : 'The picker is unavailable. Retry in a moment.', ...(['DUPLICATE_CHARACTER_NAME', 'LOGIN_STORAGE_BUDGET_EXCEEDED'].includes(error.code) ? { code: error.code } : {}) });
        }
      } finally { request.off('aborted', disconnected); response.off('close', disconnected); if (receiving.get(receivingId) === request) receiving.delete(receivingId); bindBody?.release(); releaseCheckpoint?.(); releaseImport?.(); releaseImportUser?.(); if (entry) { entry.active--; if (entries.get(entry.id) === entry) idle(entry); } }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      closing = Promise.all([admission?.close(), deletion.drain(), groupInvites.close(), departures.close()]).then(() => serialize(async () => { await Promise.all([...entries.values()].map(evict)); }));
      return closing;
    },
  };
}
