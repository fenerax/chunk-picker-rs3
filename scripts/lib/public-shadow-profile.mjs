// Operator-only disposable-save profile. No application imports at module load:
// the same harness must exercise the exact app bytes in an external export.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const omittedSidecars = new Set(['access-token', 'store.lock', 'invites.json', 'overlays.json', 'usage.json', 'feedback.json']);
const fail = code => { throw Object.assign(new Error('Shadow assertion failed.'), { shadowCode: code }); };
const check = (condition, code) => { if (!condition) fail(code); };

/** Preserve array order and gameplay fields; omit only measured durations. */
export function normalizeShadow(value, parent = '') {
  if (Array.isArray(value)) return value.map(row => normalizeShadow(row));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'timingMs'
    && !(parent === 'metrics' && key === 'elapsedMs')
    && !(parent === 'cache' && ['evaluationMs', 'requestMs'].includes(key)))
    .map(key => [key, normalizeShadow(value[key], key)]));
}

export function shadowHash(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(normalizeShadow(value))).digest('hex');
}

/** M7 restores every private utility; compare the actual capability object. */
export function shadowCapabilities(capabilities, mode) {
  check(['private', 'public'].includes(mode), 'INVALID_MODE');
  check(capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities), 'INVALID_CAPABILITIES');
  for (const [feature, code] of [['originalSync', 'ORIGINAL_SYNC_CAPABILITY'], ['gallery', 'GALLERY_CAPABILITY'], ['projectUpdates', 'PROJECT_UPDATES_CAPABILITY']]) {
    check((capabilities.features?.[feature] ?? true) === true, code);
  }
  return capabilities;
}

export const shadowAddonRoutes = Object.freeze({
  modules: Object.freeze(['/original-sync.mjs']),
  gallery: Object.freeze(['/gallery', '/gallery/preview', '/gallery.mjs', '/gallery.css', '/gallery-catalogue.mjs',
    '/gallery-preview.mjs', '/gallery-capture.mjs', '/gallery-fixtures.mjs', '/gallery-fixture-data.json',
    '/gallery-safety.mjs', '/gallery-usage.mjs', '/gallery-usage-fixture.mjs']),
  feeds: Object.freeze(['/api/migration', '/api/changelog', '/api/roadmap']),
});

/** The established original-sync fixture double has no network fallback. */
export function recordedOriginalSync(capture, instant) {
  let reads = 0;
  const options = { now: () => new Date(instant), retries: 0, fetchImpl: async (url, request) => {
    const parsed = new URL(url), match = /^\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(parsed.pathname);
    check(request?.method === 'GET' && parsed.origin === capture.metadata.sourceOrigin && !parsed.search && !parsed.hash
      && (parsed.pathname === '/version.json' || match && capture.metadata.sourceFields.includes(match[2])), 'ORIGINAL_FIXTURE_REQUEST');
    reads++;
    return new Response(JSON.stringify(match ? capture.maps[match[1]][match[2]] ?? null : capture.metadata.sourceVersion ?? null));
  } };
  return { options, reads: () => reads };
}

/** Assert access before byte comparisons, including conditional asset requests. */
export async function checkShadowAddonAccess(request, headers, role) {
  check(['admin', 'member', 'viewer', 'overlay', 'unauthenticated'].includes(role), 'INVALID_ROLE');
  const rows = [];
  const denied = role === 'overlay' || role === 'unauthenticated';
  for (const route of [...shadowAddonRoutes.modules, ...shadowAddonRoutes.feeds, ...shadowAddonRoutes.gallery]) {
    const expected = role === 'overlay' ? 401 : shadowAddonRoutes.gallery.includes(route) ? role === 'admin' ? 200 : 404 : denied ? 401 : 200;
    const response = await request(route, { headers, expected }); await response.body?.cancel();
    rows.push([role, route, expected]);
    // One denied asset exercises HEAD/conditional authorization while keeping
    // all synthetic unauthenticated probes inside the ordinary rate limit.
    if (shadowAddonRoutes.gallery.includes(route) && (role === 'admin' || route === '/gallery-fixtures.mjs')) {
      for (const extra of [{ method: 'HEAD' }, { headers: { ...headers, 'If-None-Match': '"shadow-denied"' } }]) {
        const checked = await request(route, { headers, expected, ...extra }); await checked.body?.cancel();
      }
    }
  }
  const expected = denied ? 401 : role === 'viewer' ? 403 : 400;
  // A malformed body checks authorization without creating an upstream preview.
  const response = await request('/api/original-sync/preview', { headers, body: { forbidden: true }, expected });
  await response.body?.cancel(); rows.push([role, 'original-sync-preview', expected]);
  return rows;
}

/** Compare only safe assertion identifiers, never response values or paths. */
export function compareShadowProfiles(baseline, candidate) {
  const differences = [...new Set([...Object.keys(baseline.hashes ?? {}), ...Object.keys(candidate.hashes ?? {})])]
    .sort().filter(key => baseline.hashes?.[key] !== candidate.hashes?.[key]);
  const countDifferences = [...new Set([...Object.keys(baseline.counts ?? {}), ...Object.keys(candidate.counts ?? {})])]
    .sort().filter(key => baseline.counts?.[key] !== candidate.counts?.[key]);
  const passed = differences.length === 0 && countDifferences.length === 0
    && [baseline, candidate].every(profile => profile.readOnlyUnchanged === true && profile.undoRestored === true
      && profile.accessChecked === true && profile.artChecked === true && profile.backupChecked === true
      && profile.originalSyncCapabilityChecked === true && profile.originalSyncRoutesChecked === true
      && profile.originalSyncWorkflowChecked === true && profile.galleryChecked === true && profile.projectUpdatesChecked === true);
  return { passed, differences, countDifferences };
}

async function gameplayFiles(directory, { normalized = false } = {}, relative = '') {
  const records = {};
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (!relative && omittedSidecars.has(entry.name)) continue;
    check(!entry.isSymbolicLink(), 'SAVE_LINK');
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(records, await gameplayFiles(directory, { normalized }, name));
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, name));
      let value = bytes;
      if (normalized) {
        const decoded = name.endsWith('.gz') ? gunzipSync(bytes) : bytes;
        if (/\.json(?:\.gz)?$/.test(name)) value = JSON.parse(decoded.toString('utf8'));
        else if (/\.(?:jsonl|ndjson)(?:\.gz)?$/.test(name)) value = decoded.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row));
      }
      records[name.replaceAll('\\', '/')] = shadowHash(value);
    }
  }
  return records;
}

async function freeShadowPort() {
  for (let port = 8900; port <= 8999; port++) {
    const probe = net.createServer();
    const available = await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  fail('NO_SCRATCH_PORT');
}

export function validateOverlayPayload(payload, widget = 'count') {
  const allowed = widget === 'count' ? ['revision', 'widget', 'heading', 'unlocked', 'total'] : ['revision', 'widget', 'heading', 'players'];
  check(payload && typeof payload === 'object' && Object.keys(payload).every(key => allowed.includes(key))
    && allowed.every(key => Object.hasOwn(payload, key)) && payload.widget === widget, 'OVERLAY_PAYLOAD_SCOPE');
  if (widget === 'count') check(Number.isSafeInteger(payload.unlocked) && Number.isSafeInteger(payload.total), 'OVERLAY_COUNTS');
  else {
    check(Array.isArray(payload.players), 'OVERLAY_PLAYERS');
    for (const player of payload.players) {
      check(Object.keys(player).sort().join(',') === 'goals,name' && Array.isArray(player.goals), 'OVERLAY_PLAYER_SCOPE');
      for (const goal of player.goals) check(Object.keys(goal).join(',') === 'label', 'OVERLAY_GOAL_SCOPE');
    }
  }
  return true;
}

/** No error messages, stacks, values, URLs or arbitrary exception properties. */
export function safeShadowFailure(stage, error) {
  return { failureStage: /^[a-z-]+$/.test(stage) ? stage : 'unknown',
    code: /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.shadowCode ?? '') ? error.shadowCode : 'PROFILE_FAILURE' };
}

let stage = 'arguments';
export async function runShadowProfile({ appRoot, dataDir, mode }) {
  check(process.env.RS3_HEAVY_LOCK_TOKEN && process.env.RS3_PUBLIC_SHADOW_DISPOSABLE === '1', 'DISPOSABLE_LOCK_REQUIRED');
  check(path.isAbsolute(appRoot ?? '') && path.isAbsolute(dataDir ?? '') && ['private', 'public'].includes(mode), 'ABSOLUTE_ARGUMENTS_REQUIRED');
  check(process.env.RS3_PARITY_INSTANT && Number.isFinite(Date.parse(process.env.RS3_PARITY_INSTANT)), 'PARITY_INSTANT_REQUIRED');
  check(Date.now() === Date.parse(process.env.RS3_PARITY_INSTANT) && Math.random() === 0.375, 'INPUT_PRELOAD_REQUIRED');
  process.env.RS3_LOOPBACK_PORT = '';
  const runtimeRoot = await realpath(appRoot), saveRoot = await realpath(dataDir);
  const operatorLocal = path.resolve(fileURLToPath(new URL('../../', import.meta.url)), '.local');
  const relativeSave = path.relative(operatorLocal, saveRoot);
  check(relativeSave && relativeSave !== '..' && !relativeSave.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeSave), 'OPERATOR_SCRATCH_REQUIRED');
  check(saveRoot !== runtimeRoot && saveRoot !== path.join(runtimeRoot, '.local', 'duo'), 'DISPOSABLE_SAVE_REQUIRED');
  for (const filename of ['access-token', 'store.lock']) {
    try { await lstat(path.join(saveRoot, filename)); fail('COPIED_CREDENTIAL_OR_LOCK'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // These copied credentials are never exercised. Every tested invite is fresh.
  for (const filename of ['invites.json', 'overlays.json']) await rm(path.join(saveRoot, filename), { force: true });
  const before = await gameplayFiles(saveRoot);
  const disk = JSON.parse(await readFile(path.join(saveRoot, 'state.json'), 'utf8'));
  const revisionBefore = (disk.state ?? disk).revision;
  // Keep explicit storage selection present even during module initialization.
  process.argv.push('--data-dir', saveRoot);
  const load = relative => import(pathToFileURL(path.join(runtimeRoot, 'app', relative)).href);
  stage = 'app-import';
  const { createServer } = await load('server.mjs');
  const { createRuleRegistry, evaluateRollPool } = await load('core/rules.mjs');
  const { selectedDataset } = await load('dataset-runtime.mjs');
  const recordedCapture = JSON.parse(await readFile(new URL('../../tests/fixtures/original-sync/capture.json', import.meta.url), 'utf8'));
  const original = recordedOriginalSync(recordedCapture, process.env.RS3_PARITY_INSTANT);
  let application;
  try {
    stage = 'server-startup';
    application = await createServer({ dataDir: saveRoot, port: await freeShadowPort(), host: '127.0.0.1', loopbackPort: undefined,
      predictionPrewarm: false, now: () => new Date(process.env.RS3_PARITY_INSTANT), random: () => 0.375,
      originalSync: original.options,
      idleMemoryOptions: { delayMs: 60000 } });
    await application.listen();
    const origin = `http://127.0.0.1:${application.address().port}`;
    const master = { Authorization: `Bearer ${application.store.getAccessToken()}` };
    async function request(route, { body, headers = master, method = body === undefined ? 'GET' : 'POST', expected = 200 } = {}) {
      const response = await fetch(origin + route, { method, redirect: 'manual', headers: { ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status !== expected) { await response.body?.cancel(); fail(`HTTP_${expected}_EXPECTED_${response.status}`); }
      return response;
    }
    const json = async (route, options) => (await request(route, options)).json();
    const hashes = {}, counts = {}, registry = createRuleRegistry(), state = application.store.getState();
    stage = 'tasks-and-roll-pools';
    check(state.members.length >= 2, 'DUO_MEMBERS_REQUIRED');
    const memberTaskIds = [];
    hashes.savedGameplay = shadowHash(state);
    for (const [position, member] of state.members.entries()) {
      const result = await json(`/api/tasks?memberId=${encodeURIComponent(member.id)}`);
      memberTaskIds.push((result.tasks ?? []).map(task => task.id));
      hashes[`member${position}.fullTasks`] = shadowHash(result);
      hashes[`member${position}.taskOrder`] = shadowHash((result.tasks ?? []).map(task => [task.id, task.status]));
      hashes[`member${position}.blockedReasons`] = shadowHash((result.tasks ?? []).map(task => ({ id: task.id,
        ...Object.fromEntries(Object.entries(task).filter(([key]) => /reason|block|condition/i.test(key))) })));
      const pool = evaluateRollPool(application.world, state, member.id, registry);
      hashes[`member${position}.rollPool`] = shadowHash(pool);
      counts[`member${position}.tasks`] = result.tasks?.length ?? 0;
      counts[`member${position}.eligibleRolls`] = pool.eligible.length;
      counts[`member${position}.excludedRolls`] = pool.excluded.length;
      counts[`member${position}.blockedTasks`] = (result.tasks ?? []).filter(task => task.status === 'blocked').length;
      stage = 'transport-and-training';
      hashes[`member${position}.teleports`] = shadowHash(await json(`/api/teleports?member=${encodeURIComponent(member.id)}`));
      for (const skill of ['Mining', 'Woodcutting', 'Fishing']) {
        const query = new URLSearchParams({ memberId: member.id, skill, fromLevel: '1', targetLevel: '10', preference: 'best-xp' });
        hashes[`member${position}.training.${skill}`] = shadowHash(await json(`/api/training-plan?${query}`));
      }
      stage = 'tasks-and-roll-pools';
    }
    stage = 'runtime-contract';
    const runtime = await json('/api/dataset-runtime');
    hashes.runtime = shadowHash({ ...runtime, capabilities: shadowCapabilities(runtime.capabilities, mode) });
    hashes.datasetInputs = shadowHash(selectedDataset.files);
    counts.members = state.members.length;
    stage = 'restored-private-utilities';
    for (const route of shadowAddonRoutes.feeds) hashes[route.slice(5)] = shadowHash(await json(route));
    const utilityRows = [];
    for (const route of [...shadowAddonRoutes.modules, ...shadowAddonRoutes.gallery]) {
      const response = await request(route), bytes = Buffer.from(await response.arrayBuffer());
      const etag = response.headers.get('etag'), type = response.headers.get('content-type');
      const head = await request(route, { method: 'HEAD' });
      check((await head.arrayBuffer()).byteLength === 0 && head.headers.get('etag') === etag
        && head.headers.get('content-type') === type, 'UTILITY_HEAD_CONTRACT');
      if (etag && !['/gallery', '/gallery/preview'].includes(route)) {
        const conditional = await request(route, { headers: { ...master, 'If-None-Match': etag }, expected: 304 });
        check((await conditional.arrayBuffer()).byteLength === 0, 'UTILITY_304_BODY');
      }
      utilityRows.push({ route, hash: shadowHash(bytes), bytes: bytes.length, type, etag });
    }
    const galleryRows = utilityRows.filter(row => shadowAddonRoutes.gallery.includes(row.route));
    hashes.galleryBytes = shadowHash(galleryRows);
    hashes.originalSyncModuleBytes = shadowHash(utilityRows.filter(row => shadowAddonRoutes.modules.includes(row.route)));
    counts.galleryRoutes = galleryRows.length;
    counts.galleryBytes = galleryRows.reduce((sum, row) => sum + row.bytes, 0);
    stage = 'original-sync-preview';
    check(original.reads() === 0, 'ORIGINAL_FIXTURE_EAGER_READ');
    const originalPreview = await json('/api/original-sync/preview', { body: {} });
    const { previewId: originalPreviewId, ...originalPreviewValue } = originalPreview;
    check(typeof originalPreviewId === 'string' && originalPreview.members.length === state.members.length
      && original.reads() === 33, 'ORIGINAL_FIXTURE_PREVIEW');
    hashes.originalPreview = shadowHash(originalPreviewValue);
    counts.originalFixtureReads = original.reads();
    stage = 'installed-art';
    const art = await json('/api/art-status');
    check(art.pack?.kind === 'art' && art.availableRoutes?.length > 0, 'INSTALLED_ART_REQUIRED');
    hashes.artStatus = shadowHash(art);
    // Every reported installed route is byte checked, including HEAD and 304.
    const artRows = [];
    for (const route of art.availableRoutes) {
      const response = await request(route), bytes = Buffer.from(await response.arrayBuffer());
      const etag = response.headers.get('etag');
      check(etag, 'ART_ETAG_REQUIRED');
      const head = await request(route, { method: 'HEAD' });
      check((await head.arrayBuffer()).byteLength === 0 && head.headers.get('etag') === etag
        && head.headers.get('content-type') === response.headers.get('content-type'), 'ART_HEAD_CONTRACT');
      const conditional = await request(route, { headers: { ...master, 'If-None-Match': etag }, expected: 304 });
      check((await conditional.arrayBuffer()).byteLength === 0, 'ART_304_BODY');
      if (!artRows.length) await request(route, { headers: {}, expected: 401 });
      artRows.push({ route, hash: shadowHash(bytes), bytes: bytes.length, type: response.headers.get('content-type'), etag });
    }
    hashes.artBytes = shadowHash(artRows); counts.artRoutes = artRows.length;
    stage = 'read-only-save-check';
    const readOnlyUnchanged = shadowHash(before) === shadowHash(await gameplayFiles(saveRoot))
      && application.store.getInfo().revision === revisionBefore;
    check(readOnlyUnchanged, 'READ_ONLY_CHANGED_GAMEPLAY');

    stage = 'scratch-access';
    async function invite(properties) {
      const created = await json('/api/invites', { body: { label: 'Disposable shadow invitation', ...properties }, expected: 201 });
      const joined = await request(new URL(created.link).pathname, { headers: {}, expected: 303 });
      const cookie = joined.headers.get('set-cookie')?.split(';')[0];
      check(cookie, 'SCRATCH_SESSION_REQUIRED');
      return { id: created.invite.id, linkPath: new URL(created.link).pathname, headers: { Cookie: cookie } };
    }
    const identities = { admin: await invite({ admin: true }), member: await invite({ memberId: state.members[0].id }), viewer: await invite({ viewer: true }) };
    const accessRows = await checkShadowAddonAccess(request, {}, 'unauthenticated');
    for (const [role, identity] of Object.entries(identities)) {
      const session = await json('/api/session', { headers: identity.headers });
      check(session.admin === (role === 'admin') && session.readOnly === (role === 'viewer'), 'SESSION_ROLE');
      hashes[`access.${role}.session`] = shadowHash(session);
      // Viewer saved/full task results may intentionally project different fields.
      hashes[`access.${role}.state`] = shadowHash(await json('/api/state', { headers: identity.headers }));
      accessRows.push(...await checkShadowAddonAccess(request, identity.headers, role));
      const expected = role === 'admin' ? 200 : 403;
      const response = await request('/api/invites', { headers: identity.headers, expected }); await response.body?.cancel();
      accessRows.push([role, 'admin-route', expected]);
      if (role === 'member' || role === 'viewer') {
        const route = artRows[0].route;
        const artResponse = await request(route, { headers: identity.headers });
        check(shadowHash(Buffer.from(await artResponse.arrayBuffer())) === artRows[0].hash, 'ROLE_ART_BYTES');
        const etag = artResponse.headers.get('etag');
        const head = await request(route, { headers: identity.headers, method: 'HEAD' });
        check((await head.arrayBuffer()).byteLength === 0 && head.headers.get('etag') === etag, 'ROLE_ART_HEAD');
        const conditional = await request(route, { headers: { ...identity.headers, 'If-None-Match': etag }, expected: 304 });
        check((await conditional.arrayBuffer()).byteLength === 0, 'ROLE_ART_304');
        accessRows.push([role, 'art-get-head-conditional', 200, 200, 304]);
      }
    }
    const forbiddenCommand = { expectedRevision: application.store.getInfo().revision,
      command: { type: 'set-note', memberId: state.members[0].id, chunkId: state.members[0].unlocked[0], note: 'Disposable shadow note' } };
    await request('/api/command', { headers: identities.viewer.headers, body: forbiddenCommand, expected: 403 });
    await request('/api/restore', { headers: identities.member.headers, body: { expectedRevision: application.store.getInfo().revision }, expected: 403 });
    await request('/api/command', { headers: identities.member.headers, body: { expectedRevision: application.store.getInfo().revision,
      command: { type: 'set-xp-choices', memberId: state.members[1].id, choices: {} } }, expected: 403 });
    await json(`/api/invites/${identities.viewer.id}/revoke`, { body: {} });
    await request('/api/state', { headers: identities.viewer.headers, expected: 401 });
    await request(identities.viewer.linkPath, { headers: {}, expected: 401 });
    hashes.accessBoundary = shadowHash([...accessRows, ['viewer-write', 403], ['member-restore', 403], ['cross-member-xp-write', 403], ['revoked-read', 401], ['revoked-join', 401]]);

    stage = 'scoped-overlay';
    const overlay = await json('/api/overlays', { body: { label: 'Disposable shadow overlay', widget: 'count', player: 'duo' }, expected: 201 });
    const key = new URLSearchParams(new URL(overlay.link).hash.slice(1)).get('key');
    check(key, 'OVERLAY_KEY_REQUIRED');
    const overlayHeaders = { Authorization: `Bearer ${key}` }, scope = '/overlay/data?widget=count&player=duo&variant=full';
    const payload = await json(scope, { headers: overlayHeaders }); validateOverlayPayload(payload);
    hashes.overlayAddonBoundary = shadowHash(await checkShadowAddonAccess(request, overlayHeaders, 'overlay'));
    check(original.reads() === 33, 'ORIGINAL_SCOPE_UPSTREAM_READ');
    hashes.overlayPayload = shadowHash(payload);
    await request('/api/state', { headers: overlayHeaders, expected: 401 });
    await request('/api/dataset-runtime', { headers: overlayHeaders, expected: 401 });
    await request(art.availableRoutes[0], { headers: overlayHeaders, expected: 401 });
    await request('/api/command', { headers: overlayHeaders, body: forbiddenCommand, expected: 401 });
    await request('/overlay/data?widget=count&player=absent&variant=full', { headers: overlayHeaders, expected: 403 });
    await request('/overlay/data?widget=goals&player=duo&variant=full', { headers: overlayHeaders, expected: 403 });
    await request(scope, { headers: master, expected: 401 });
    await json(`/api/overlays/${overlay.overlay.id}/revoke`, { body: {} });
    await request(scope, { headers: overlayHeaders, expected: 401 });
    check(application.store.getInfo().revision === revisionBefore, 'ACCESS_CHANGED_GAMEPLAY');

    stage = 'member-note-command';
    const noteMember = state.members[0], noteChunk = noteMember.unlocked[0];
    check(noteChunk, 'MEMBER_NOTE_INPUT_REQUIRED');
    const originalNote = noteMember.notes?.[noteChunk];
    hashes.memberNoteResult = shadowHash(await json('/api/command', { headers: identities.member.headers,
      body: { expectedRevision: application.store.getInfo().revision,
        command: { type: 'set-note', memberId: noteMember.id, chunkId: noteChunk, note: 'Disposable shadow member note' } } }));
    check(application.store.getState().members[0].notes?.[noteChunk] === 'Disposable shadow member note', 'MEMBER_NOTE_NOT_SAVED');
    stage = 'member-note-undo-command';
    hashes.memberNoteUndoResult = shadowHash(await json('/api/command', { headers: identities.member.headers,
      body: { expectedRevision: application.store.getInfo().revision, command: { type: 'undo' } } }));
    check(application.store.getState().members[0].notes?.[noteChunk] === originalNote, 'MEMBER_NOTE_UNDO');

    stage = 'roll-complete-history-undo';
    // Select a real member with a real available roll and an incomplete task.
    const position = state.members.findIndex((member, index) => !member.pendingRoll.length
      && evaluateRollPool(application.world, state, member.id, registry).eligible.length
      && memberTaskIds[index].some(id => !member.completedTasks.includes(id)));
    check(position >= 0, 'ROLL_AND_TASK_INPUT_REQUIRED');
    const member = state.members[position];
    const taskId = memberTaskIds[position].find(id => !member.completedTasks.includes(id));
    // Derived task registration can retain aliases after Undo. All aliases are
    // still compared across profiles in each full saved-state hash.
    const gameplay = value => ({ members: value.members, rules: value.rules, tasks: value.tasks });
    const beforeCommands = shadowHash(gameplay(state));
    async function command(value, headers = identities.member.headers) {
      stage = `command-${value.type}`;
      return json('/api/command', { headers, body: { expectedRevision: application.store.getInfo().revision, command: value } });
    }
    // An administrator scratch invite can act on any member; actor stays stable.
    const commandHeaders = identities.admin.headers;
    hashes.rollResult = shadowHash(await command({ type: 'roll', memberId: member.id, count: 1 }, commandHeaders));
    hashes.afterRollSave = shadowHash(await application.store.backup());
    hashes.completeResult = shadowHash(await command({ type: 'complete-task', memberId: member.id, taskId, completed: true }, commandHeaders));
    check(application.store.getState().members[position].completedTasks.includes(taskId), 'COMPLETION_NOT_SAVED');
    hashes.afterCompleteSave = shadowHash(await application.store.backup());
    hashes.commandHistory = shadowHash(await json('/api/history'));
    hashes.undoCompleteResult = shadowHash(await command({ type: 'undo' }, commandHeaders));
    hashes.undoRollResult = shadowHash(await command({ type: 'undo' }, commandHeaders));
    hashes.undoHistory = shadowHash(await json('/api/history'));
    const undoRestored = beforeCommands === shadowHash(gameplay(application.store.getState()));
    check(undoRestored, 'UNDO_DID_NOT_RESTORE_GAMEPLAY');
    hashes.afterUndoSave = shadowHash(await application.store.backup());

    stage = 'original-sync-apply-undo';
    const syncBefore = application.store.getState();
    const reviewed = await json('/api/original-sync/preview', { body: {} });
    const { previewId, ...reviewedValue } = reviewed;
    check(reviewed.cached === true && original.reads() === 33, 'ORIGINAL_FIXTURE_CACHE');
    hashes.originalCachedPreview = shadowHash(reviewedValue);
    const selections = reviewed.members.map(owner => ({ memberId: owner.id, groups: ['chunks', 'selections', 'blacklist', 'pendingRoll'] }));
    hashes.originalApply = shadowHash(await command({ type: 'sync-original', previewId, members: selections }, commandHeaders));
    check(application.store.getInfo().revision === syncBefore.revision + 1, 'ORIGINAL_APPLY_REVISION');
    for (const owner of reviewed.members) {
      const savedOwner = application.store.getState().members.find(member => member.id === owner.id);
      check(shadowHash(savedOwner.selected) === shadowHash(owner.selections.after), 'ORIGINAL_APPLY_SELECTIONS');
      check(shadowHash(savedOwner.pendingRoll) === shadowHash(owner.pendingRoll.after), 'ORIGINAL_APPLY_PENDING_ROLL');
      check(savedOwner.originalPickerSync?.capturedAt === reviewed.capturedAt
        && savedOwner.originalPickerSync?.sourceMapId === owner.sourceMapId, 'ORIGINAL_APPLY_PROVENANCE');
    }
    hashes.originalAppliedSave = shadowHash(await application.store.backup());
    hashes.originalAppliedHistory = shadowHash(await json('/api/history'));
    await request('/api/command', { body: { expectedRevision: application.store.getInfo().revision,
      command: { type: 'sync-original', previewId, members: selections } }, expected: 410 });
    hashes.originalUndo = shadowHash(await command({ type: 'undo' }, commandHeaders));
    check(shadowHash(gameplay(application.store.getState())) === shadowHash(gameplay(syncBefore)), 'ORIGINAL_UNDO_GAMEPLAY');
    hashes.originalUndoneSave = shadowHash(await application.store.backup());
    check(original.reads() === 33, 'ORIGINAL_UNEXPECTED_SOURCE_READ');

    stage = 'backup-export-import';
    const backup = await json('/api/backup');
    hashes.backupExport = shadowHash(backup);
    const compressed = await request('/api/backup?download=gzip');
    const expanded = JSON.parse(gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString('utf8'));
    check(shadowHash(expanded) === shadowHash(backup), 'GZIP_BACKUP_DIFFERENCE');
    hashes.backupPreview = shadowHash(await json('/api/restore/preview', { headers: commandHeaders,
      body: { backup, expectedRevision: application.store.getInfo().revision } }));
    const exportedNote = application.store.getState().members[0].notes?.[noteChunk];
    const changedNote = exportedNote === 'Disposable shadow backup change' ? 'Disposable shadow backup change again' : 'Disposable shadow backup change';
    hashes.backupMutation = shadowHash(await command({ type: 'set-note', memberId: noteMember.id, chunkId: noteChunk, note: changedNote }, commandHeaders));
    check(application.store.getState().members[0].notes?.[noteChunk] !== exportedNote, 'BACKUP_MUTATION_REQUIRED');
    hashes.beforeImportChangedSave = shadowHash(await application.store.backup());
    const restoreRevision = application.store.getInfo().revision;
    hashes.backupImport = shadowHash(await json('/api/restore', { headers: commandHeaders, body: { backup, expectedRevision: restoreRevision } }));
    check(application.store.getInfo().revision === restoreRevision + 1, 'RESTORE_REVISION');
    check(shadowHash(gameplay(application.store.getState())) === beforeCommands, 'RESTORE_GAMEPLAY');
    check(application.store.getState().members[0].notes?.[noteChunk] === exportedNote, 'RESTORE_EXPORTED_NOTE');
    hashes.afterImportSave = shadowHash(await application.store.backup());
    await request('/api/restore', { headers: commandHeaders, body: { backup, expectedRevision: restoreRevision }, expected: 409 });
    await request('/api/state', { headers: identities.viewer.headers, expected: 401 });
    await request(identities.viewer.linkPath, { headers: {}, expected: 401 });
    await request(scope, { headers: overlayHeaders, expected: 401 });
    hashes.revocationsAfterRestore = shadowHash(['viewer-session-401', 'viewer-join-401', 'overlay-401']);
    stage = 'final-save-journal';
    const finalFiles = await gameplayFiles(saveRoot, { normalized: true });
    hashes.gameplayFiles = shadowHash(finalFiles);
    counts.gameplayFiles = Object.keys(finalFiles).length;
    return { hashes, counts, readOnlyUnchanged, undoRestored, accessChecked: true, artChecked: true, backupChecked: true,
      originalSyncCapabilityChecked: true, originalSyncRoutesChecked: true,
      originalSyncWorkflowChecked: true, galleryChecked: true, projectUpdatesChecked: true,
      originalSync: 'recorded-fixture-only-preview-apply-undo',
      normalization: 'Sorted object keys; array order retained. Only timingMs, metrics.elapsedMs and cache.evaluationMs/requestMs omitted. Ephemeral original-sync previewId excluded from preview hashes only. Authentication, overlay credentials and operator telemetry excluded from gameplay files. All runtime capabilities compared exactly.' };
  } finally { await application?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [appRoot, dataDir, mode] = process.argv.slice(2);
    process.stdout.write(JSON.stringify(await runShadowProfile({ appRoot, dataDir, mode })) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify(safeShadowFailure(stage, error)) + '\n'); process.exitCode = 1; }
}
