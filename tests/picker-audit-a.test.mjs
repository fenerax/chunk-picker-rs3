import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE',
  'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
  'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DEFAULTS_FILE']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { selectedDataset: baseDataset } = await import('../app/dataset-runtime.mjs');
const { routePermissions } = await import('../app/picker-context-http.mjs');
const origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const subjects = [101, 102];
const legacyMembers = [
  { id: 'synthetic-legacy-one', name: 'Player 8', mapId: 'synthetic-map-one' },
  { id: 'synthetic-legacy-two', name: 'Player 9', mapId: 'synthetic-map-two' },
];
const definitions = { challenges: {}, chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
function request(base, route, { body, rawBody, headers = {}, method = body === undefined && rawBody === undefined ? 'GET' : 'POST', stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = rawBody ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
    const req = http.request(base + route, { method, agent: false, headers: {
      ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length, Origin: origin } : {}), ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      const result = () => ({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(),
        json: () => JSON.parse(Buffer.concat(chunks).toString()), req, res, chunks });
      if (stream) resolve(result()); else res.on('end', () => resolve(result()));
    });
    req.on('error', reject); req.end(bytes);
  });
}
async function fixture(t, { originalSync, enabled = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-audit-a-'));
  const secret = path.join(root, 'synthetic-secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE'];
  const previous = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  let app;
  t.after(async () => {
    await app?.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of envKeys.entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  });
  const grants = new Map(), access = new Map(); let nextCode = 0;
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant);
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), grant.challenge);
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  const dataset = { ...baseDataset, gameDefaults: { members: legacyMembers, masterLabel: 'Player 8' },
    capabilities: { ...baseDataset.capabilities, features: { ...baseDataset.capabilities.features, originalSync: !!originalSync } } };
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones') };
  app = await createServer({ dataset, dataDir: path.join(root, 'legacy'), definitions, taskMap: {},
    initialState: createGroupState(legacyMembers.map(({ mapId, ...member }) => ({ ...member, sourceMapId: mapId }))), port: 0, loopbackPort: 0, loopbackRole: 'public',
    publicOrigin: origin, signIn: 'optional', signInProvider: provider, multiPicker: enabled ? multiPicker : undefined, originalSync,
    predictionPrewarm: false, shutdownDeadlineMs: 500, rateLimits: { unauthenticated: 10000, expensivePerIdentity: 10000 } });
  await app.listen();
  const send = (route, cookie, options = {}) => request(`http://127.0.0.1:${app.loopbackAddress().port}`, route,
    { ...options, headers: { ...proxy, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  async function login(subject) {
    const start = await send('/auth/discord'); assert.equal(start.status, 303);
    const auth = new URL(start.headers.location), code = String(++nextCode);
    grants.set(code, { subject: String(subject), challenge: auth.searchParams.get('code_challenge') });
    const callback = await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,
      start.headers['set-cookie'][0].split(';')[0]);
    assert.equal(callback.status, 303, callback.text);
    return callback.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  const privateSend = (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route,
    { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(),
      Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } });
  const note = (cookie, text, expectedRevision = 0, extra = {}) => send('/api/command', cookie,
    { body: { expectedRevision, command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, ...extra } });
  return { root, send, privateSend, login, note, app, multiPicker };
}

test('MP12A-1: owned picker dataset responses omit shared-game identity and map bindings', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]);
  const state = (await f.send('/api/state', cookie)).json().state;
  assert.deepEqual(state.members.map(member => member.id), ['owner']);
  const leakedRoutes = [];
  for (const route of ['/api/dataset-runtime', '/data/dataset-runtime.json']) {
    const response = await f.send(route, cookie); assert.equal(response.status, 200);
    assert.deepEqual(response.json().gameDefaults, { members: [], masterLabel: 'Administrator' });
    assert.equal(response.json().capabilities.features.originalSync, false);
    if (legacyMembers.some(member => [member.id, member.name, member.mapId].some(value => response.text.includes(value)))) leakedRoutes.push(route);
  }
  assert.deepEqual(leakedRoutes, [], 'Shared-game defaults must not cross the owned-picker response boundary');
});

test('MP13: legacy dataset payload bytes are unchanged with routing absent or present', async t => {
  const { datasetBrowserPayload } = await import('../app/dataset-catalogues.mjs');
  for (const enabled of [false, true]) {
    const f = await fixture(t, { enabled });
    const expected = JSON.stringify(await datasetBrowserPayload({ ...baseDataset,
      gameDefaults: { members: legacyMembers, masterLabel: 'Player 8' },
      capabilities: { ...baseDataset.capabilities, features: { ...baseDataset.capabilities.features, originalSync: false } } }));
    for (const route of ['/api/dataset-runtime', '/data/dataset-runtime.json']) {
      const response = await f.privateSend(route);
      assert.equal(response.status, 200);
      assert.equal(response.text, expected);
    }
  }
});

test('MP13: browser startup renders the owned roster with neutral dataset defaults', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]);
  const payload = (await f.send('/data/dataset-runtime.json', cookie)).json();
  const loaded = (await f.send('/api/state', cookie)).json();
  const session = (await f.send('/api/session', cookie)).json();
  const source = async name => (await readFile(new URL('../app/web/' + name, import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const c = runInNewContext(await source('screen-context.mjs') + '\ncreateScreenContext();', { selectedDataset: payload });
  assert.equal(c.owners.length, 0);
  const noop = () => {}, node = { addEventListener: noop, append: noop, setAttribute: noop };
  const panel = () => ({ start: noop, setSession: noop, refresh: noop });
  let rendered = false, connected = false;
  Object.assign(c, { $: () => node, el: () => node, panelContext: { pickerSession: { initialize: noop, registerStop: noop } },
    api: async route => route === '/api/state' ? loaded : route === '/api/rules' ? { definitions: [] } : {},
    applySession: noop, taskIconPainter: { settle: noop }, categoryIconPainter: { settle: noop },
    gamePlugin: { refresh: noop }, bindControls: noop, connectEvents: () => { connected = true; },
    saved: noop, loadTasks: noop, supportsFeature: () => false, applyDatasetControls: noop,
    adopt: state => { c.state = state; rendered = true; assert.equal(c.owners[0].id, state.members[0].id); assert.equal(c.owners[0].name, 'Player 1'); } });
  runInNewContext(await source('screen-startup.mjs') + '\ncreateScreenStartup(c);', { c, document: {}, globalThis: {},
    createFeedback: panel, createUpdates: panel, createBackupStatus: panel, createAccountPanel: panel,
    createAccountsPanel: panel, createOverlayPanel: panel,
    createInvites: () => ({ loadSession: async () => session }),
    loadArtStatus: async () => {}, installPictureFallbacks: noop, observeArtStatus: noop,
    hydrateDisplayWorld: value => value, createRuleRegistryFromDefinitions: value => value,
    gameStorage: () => ({ getItem: () => null }),
    ChunkMap: class { centerOnUnlocked() {} setMapAssets() {} }, loadIcons: async () => {}, bindTaskViewPreferences: noop,
    createDuoCoordination: panel });
  await c.start();
  assert.equal(c.memberId, loaded.state.members[0].id);
  assert.equal(rendered, true); assert.equal(connected, true);
});

test('audit A: sessions, state, errors and headers contain only the caller account and picker', async t => {
  const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]);
  const left = (await f.send('/api/session', a)).json(), right = (await f.send('/api/session', b)).json();
  assert.notEqual(left.accountId, right.accountId); assert.notEqual(left.pickerId, right.pickerId);
  assert.equal((await f.note(b, 'Player 2')).status, 200);
  const foreign = [right.accountId, right.pickerId];
  for (const [route, status, options] of [
    ['/api/session', 200], ['/api/state', 200], ['/api/state?view=play-v1', 200], ['/api/history', 200],
    ['/api/history/1', 404], ['/api/coordination', 200], ['/api/health', 200], ['/api/diagnostics', 200],
    ['/api/command', 409, { body: { expectedRevision: 99, command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Player 1' } } }],
  ]) {
    const response = await f.send(route, a, options);
    assert.equal(response.status, status, route);
    const bytes = response.text + JSON.stringify(response.headers);
    for (const value of [...foreign, 'Player 2']) assert.equal(bytes.includes(value), false, route);
    assert.doesNotMatch(bytes, /"(?:subject|email|tokenHash)"/);
    assert.match(response.headers['cache-control'], /private/);
  }
  assert.equal(left.account.id, left.accountId); assert.equal(left.admin, false);
  assert.deepEqual(left.account.providers, ['discord']);
});

test('MP12A-2: restoring a source binding cannot read the shared original maps', async t => {
  const marker = 'Player 8 shared note';
  const sourceMaps = Object.fromEntries(legacyMembers.map(member => [member.mapId,
    { chunks: { unlocked: { '12342': true } }, chunkNotes: { '12342': marker } }]));
  let reads = 0;
  const f = await fixture(t, { originalSync: { retries: 0, fetchImpl: async url => {
    reads++;
    const match = /\/maps\/([^/]+)\/(\w+)\.json$/.exec(url);
    return Response.json(match ? sourceMaps[match[1]]?.[match[2]] ?? null : null);
  } } });
  const cookie = await f.login(subjects[0]);
  const exported = await f.send('/api/backup', cookie); assert.equal(exported.status, 200);
  const backup = exported.json();
  assert.deepEqual(backup.state.members.map(member => member.id), ['owner']);
  // The attacker changes only their own exported gameplay, never another store.
  backup.state.members[0].sourceMapId = legacyMembers[0].mapId;
  const restored = await f.send('/api/restore', cookie, { body: { backup, expectedRevision: 0 } });
  assert.equal(restored.status, 200, restored.text);
  assert.equal(reads, 0);
  const preview = await f.send('/api/original-sync/preview', cookie, { body: {} });
  assert.equal(preview.status, 404, preview.text);
  assert.equal(reads, 0, 'the configured shared source must not be contacted');
  assert.equal(preview.text.includes(marker), false, 'An owned-picker backup must not grant access to shared source notes');
  const command = await f.send('/api/command', cookie, { body: { expectedRevision: 1,
    command: { type: 'sync-original', previewId: randomUUID(), members: [] } } });
  assert.equal(command.status, 404);
  const memberRestored = await f.send('/api/member-restore', cookie, { body: { backup, memberId: 'owner', expectedRevision: 1 } });
  assert.equal(memberRestored.status, 200, memberRestored.text);
  assert.equal((await f.send('/api/original-sync/preview', cookie, { body: {} })).status, 404);
  const imported = await f.send('/api/import', cookie, { body: { expectedRevision: 2,
    document: { maps: { [legacyMembers[0].mapId]: { chunks: { unlocked: {}, selected: {} } } } },
    members: [{ id: 'owner', name: 'Player 1', mapId: legacyMembers[0].mapId }] } });
  assert.equal(imported.status, 422, imported.text); // Existing dataset-identity fence.
  assert.equal((await f.send('/api/state', cookie)).json().state.revision, 2);
  assert.equal((await f.send('/api/original-sync/preview', cookie, { body: {} })).status, 404);
  assert.equal(reads, 0);
  // The configured legacy client still fetches and previews the same source.
  const legacy = await f.privateSend('/api/original-sync/preview', { body: {} });
  assert.equal(legacy.status, 200, legacy.text);
  assert.ok(reads > 0);
  assert.equal(legacy.text.includes(marker), true);
});

test('audit A: every registered HTTP route rejects foreign selectors without opening the target store', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]); await f.login(subjects[1]);
  const own = (await f.send('/api/session', cookie)).json().pickerId;
  const registry = JSON.parse(await readFile(path.join(f.multiPicker.registryDir, 'registry.json')));
  const victim = registry.accounts.find(account => account.identities.some(identity => identity.subject === String(subjects[1])));
  const other = victim.defaultPickerId;
  let requests = 0;
  for (const [method, routes] of Object.entries(routePermissions)) for (const template of Object.keys(routes)) {
    const route = template.replace(':id', victim.id);
    for (const name of ['picker', 'pickerId']) {
      const response = await f.send(`${route}?${name}=${other}`, cookie, { method });
      assert.equal(response.status, 403, `${method} ${template} query ${name}`); requests++;
    }
    for (const header of ['X-Picker', 'X-Picker-Id']) {
      const response = await f.send(route, cookie, { method, headers: { [header]: other } });
      assert.equal(response.status, 403, `${method} ${template} ${header}`); requests++;
    }
    for (const scoped of [`/pickers/${other}${route}`, `/api/pickers/${other}${route.slice(4)}`]) {
      assert.equal((await f.send(scoped, cookie, { method })).status, 403, `${method} ${template} path`); requests++;
    }
  }
  for (const candidate of [other, victim.id, randomUUID(), 'legacy']) {
    const response = await f.send('/api/state?pickerId=' + candidate, cookie);
    assert.equal(response.status, 403);
    assert.deepEqual(response.json(), { message: 'Picker access denied.' });
  }
  assert.equal((await f.send('/api/state?picker=' + own + '&pickerId=' + own, cookie)).status, 200);
  await assert.rejects(readFile(path.join(f.multiPicker.pickerRoot, other, 'state.json')), { code: 'ENOENT' });
  assert.ok(requests > 500);
});

test('audit A: nested selectors and gzip or uploaded backups cannot cross the picker boundary', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]), otherCookie = await f.login(subjects[1]);
  const other = (await f.send('/api/session', otherCookie)).json().pickerId;
  for (const extra of [{ picker: other }, { nested: [{ pickerId: other }] }, { command: { type: 'set-note', picker: other } }]) {
    assert.equal((await f.note(cookie, 'Player 1', 0, extra)).status, 403);
  }
  const exported = (await f.send('/api/backup', cookie)).json();
  for (const route of ['/api/restore/preview', '/api/restore', '/api/member-restore/preview', '/api/member-restore']) {
    const rawBody = gzipSync(Buffer.from(JSON.stringify({ backup: exported, memberId: 'owner', expectedRevision: 0, nested: [{ picker: other }] })));
    const response = await f.send(route, cookie, { rawBody, headers: { 'Content-Encoding': 'gzip' } });
    assert.equal(response.status, 403, route);
  }
  const upload = structuredClone(exported); upload.state.provenance.pickerId = other;
  const response = await f.send('/api/restore/preview', cookie, { rawBody: gzipSync(Buffer.from(JSON.stringify({ file: upload }))),
    headers: { 'Content-Type': 'application/vnd.rs3-backup-upload+json', 'Content-Encoding': 'gzip', 'X-RS3-Import': JSON.stringify({ expectedRevision: 0 }) } });
  assert.equal(response.status, 403);
  assert.equal((await f.send('/api/state', cookie)).json().state.revision, 0);
  assert.equal((await f.send('/api/state', otherCookie)).json().state.revision, 0);
});

test('audit A: foreign plugin IDs and credentials cannot read, revoke or select another picker', async t => {
  const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]);
  const create = async cookie => {
    const response = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 1' } });
    assert.equal(response.status, 201, response.text); return response.json();
  };
  const left = await create(a), right = await create(b);
  const other = (await f.send('/api/session', b)).json().pickerId;
  const foreign = await f.send(`/api/game-plugin/keys/${right.record.id}/revoke`, a, { body: {} });
  const absent = await f.send(`/api/game-plugin/keys/${randomUUID()}/revoke`, a, { body: {} });
  assert.equal(foreign.status, 404); assert.equal(foreign.text, absent.text);
  assert.deepEqual((await f.send('/api/game-plugin', a)).json().keys.map(key => key.id), [left.record.id]);
  const headers = { Authorization: 'Bearer ' + left.key };
  assert.equal((await f.send('/api/plugin/v1/status', b, { headers })).status, 403);
  assert.equal((await f.send('/api/plugin/v1/status?pickerId=' + other, null, { headers })).status, 403);
  assert.equal((await f.send('/api/plugin/v1/tasks?pickerId=' + other, null, { headers })).status, 403);
  assert.equal((await f.send('/api/plugin/v1/report', null, { headers, body: { pickerId: other } })).status, 403);
  assert.equal((await f.send('/api/state', a, { headers })).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + right.key } })).status, 200);
});

test('audit A: owned cookies and plugin keys do not acquire overlay or operator authority', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]);
  const created = await f.privateSend('/api/overlays', { body: { label: 'Player 8', widget: 'count', player: legacyMembers[0].id } });
  assert.equal(created.status, 201, created.text);
  const link = new URL(created.json().link), key = new URLSearchParams(link.hash.slice(1)).get('key');
  const scope = '?widget=count&player=' + legacyMembers[0].id;
  assert.equal((await f.send('/overlay/data' + scope, null, { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  for (const route of ['/api/accounts', '/api/invites', '/api/overlays', '/api/usage', '/api/backup-status', '/api/admin/master-link']) {
    assert.equal((await f.send(route, cookie)).status, 403, route);
  }
  for (const route of ['/api/operator/snapshot', '/api/shutdown', '/api/worker-restart', '/api/overlays']) {
    assert.equal((await f.send(route, cookie, { body: {} })).status, 403, route);
  }
  assert.equal((await f.send('/overlay/data' + scope, cookie)).status, 401);
  assert.equal((await f.send('/overlay/events' + scope, cookie)).status, 401);
  assert.equal((await f.send('/overlay/data' + scope, cookie, { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  assert.equal((await f.send('/api/state', null, { headers: { Authorization: 'Bearer ' + key } })).status, 401);
});


test('MP13: option-absent legacy original sync still fetches configured sources', async t => {
  let reads = 0;
  const f = await fixture(t, { enabled: false, originalSync: { retries: 0, fetchImpl: async url => {
    reads++;
    return Response.json(url.endsWith('/chunks.json') ? { unlocked: {}, selected: {} } : null);
  } } });
  const response = await f.privateSend('/api/original-sync/preview', { body: {} });
  assert.equal(response.status, 200, response.text); assert.ok(reads > 0);
  assert.deepEqual(response.json().members.map(member => member.id), legacyMembers.map(member => member.id));
});
