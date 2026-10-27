import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../.local/public-ingress-tests/', import.meta.url));
// Set the provider and all optional input overrides before importing server code.
// These tests create generated saves and never open the operator's dataset/save.
process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
  'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE',
  'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_STARTUP_TIMING_LOG']) delete process.env[key];
process.env.RS3_GAME_DATA_DIR = path.join(root, 'unused-game-data');
process.env.RS3_MAP_ASSETS_DIR = path.join(root, 'unused-map-assets');
const { createServer, startServer, routePermissions, apiPermission } = await import('../app/server.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { prepareGameStorage } = await import('../app/game-profile.mjs');

const publicOrigin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const definitions = { chunks: { '11825': { Name: 'Port Sarim' }, '11569': { Name: 'Musa Point' } },
  challenges: {}, walkableChunks: ['11825', '11569'], walkableChunksF2P: ['11825', '11569'] };
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
const joinPath = created => new URL(created.link).pathname;
const overlayKey = created => new URLSearchParams(new URL(created.link).hash.slice(1)).get('key');
const scope = 'widget=count&player=duo&variant=full';
const concrete = route => route.replace(':id', '00000000-0000-0000-0000-000000000000');

// Native HTTP preserves Host, including deliberately invalid authorities. Fetch
// can silently replace it and would miss the actual listener boundary.
function request(origin, route, { body, rawBody, method = body === undefined && rawBody === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const requestHeaders = Object.fromEntries(Object.entries({
      ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), Origin: origin }), ...headers,
    }).filter(([, value]) => value !== undefined));
    const req = http.request(origin + route, { method, agent: false, headers: requestHeaders }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode,
        headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
    });
    req.setTimeout(10000, () => req.destroy(new Error(`Timed out: ${method} ${route}`)));
    req.on('error', reject); req.end(bytes);
  });
}

async function openEvents(origin, route, headers) {
  let req;
  const response = await new Promise((resolve, reject) => {
    req = http.request(origin + route, { agent: false, headers }, resolve);
    req.setTimeout(10000, () => req.destroy(new Error(`Timed out: ${route}`)));
    req.on('error', reject); req.end();
  });
  assert.equal(response.statusCode, 200, route);
  assert.match(response.headers['content-type'], /^text\/event-stream/);
  response.setEncoding('utf8');
  const iterator = response[Symbol.asyncIterator]();
  let buffered = '';
  return {
    async nextEvent(name) {
      while (true) {
        let boundary;
        while ((boundary = buffered.indexOf('\n\n')) !== -1) {
          const record = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
          if (/^event: (.+)$/m.exec(record)?.[1] === name) return JSON.parse(/^data: (.+)$/m.exec(record)[1]);
        }
        const next = await iterator.next();
        assert.equal(next.done, false, `Stream ended before ${name}`);
        buffered += next.value;
      }
    },
    close() { response.destroy(); req.destroy(); },
  };
}

async function fixture(t) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['11825'], journal: 'Private journal' },
    { id: 'reed', name: 'Reed', unlocked: ['11569'] }]);
  let app;
  let options = { dataset: selectedDataset, dataDir: path.join(directory, 'game'), host: '127.0.0.1', port: 0,
    ingressRole: 'private', loopbackPort: 0, loopbackRole: 'public', publicOrigin, definitions, taskMap: {},
    predictionPrewarm: false, shutdownDeadlineMs: 500, rateLimits: { failedJoins: 100 } };
  t.after(async () => { try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  async function start(state) { app = await createServer({ ...options, initialState: state }); await app.listen(); }
  await start(initialState);
  const origin = () => `http://127.0.0.1:${app.address().port}`;
  const publicAddress = () => `http://127.0.0.1:${app.loopbackAddress().port}`;
  const privateRequest = (route, extra) => request(origin(), route, extra);
  const admin = (route, body) => privateRequest(route, { body, headers: { Authorization: `Bearer ${app.store.getAccessToken()}` } });
  const joined = await privateRequest(`/join/${app.store.getAccessToken()}`);
  assert.equal(joined.status, 303);
  async function invite(input) {
    const created = await admin('/api/invites', input); assert.equal(created.status, 201);
    const result = await created.json();
    const destination = new URL(result.link);
    assert.equal(destination.origin, input.admin ? origin() : publicOrigin);
    const session = input.admin ? await request(destination.origin, destination.pathname) : await privateRequest(destination.pathname);
    assert.equal(session.status, 303);
    if (input.admin) assert.equal((await request(publicAddress(), destination.pathname)).status, 403);
    return { ...result, cookie: cookieFrom(session) };
  }
  return { get app() { return app; }, origin, publicAddress, privateRequest, admin, invite, masterCookie: cookieFrom(joined),
    publicRequest: (route, extra) => request(publicAddress(), route, extra),
    async restart(overrides) { await app.close(); options = { ...options, ...overrides }; await start(); },
  };
}

test('public loopback listener never promotes master/admin credentials from forwarding headers', { timeout: 30000 }, async t => {
  const f = await fixture(t), adminInvite = await f.invite({ label: 'Private administrator', admin: true });
  const player = await f.invite({ label: 'Player', memberId: 'actor1' });
  const master = f.app.store.getAccessToken();
  const credentials = [{ Authorization: `Bearer ${master}` }, { Cookie: `duo_access=${master}` },
    { Cookie: f.masterCookie }, { Cookie: adminInvite.cookie }];
  const headerCases = [
    {},
    { Host: 'picker.example' },
    { Host: '[::1]' },
    { ...proxy, 'Tailscale-Funnel-Request': '?1' },
    { ...proxy, 'Tailscale-Funnel-Request': '?0' },
    { ...proxy, 'X-Forwarded-For': '127.0.0.1' },
    { ...proxy, 'X-Forwarded-For': '100.64.0.0' },
    { ...proxy, 'X-Forwarded-For': 'not-an-address' },
    { ...proxy, 'X-Forwarded-For': '203.0.113.7, 127.0.0.1' },
    { Host: 'picker.example', 'X-Forwarded-For': '127.0.0.1' },
  ];
  for (const headers of headerCases) {
    for (const credential of credentials) {
      assert.equal((await f.publicRequest('/api/session', { headers: { ...headers, ...credential } })).status, 403,
        `public session: ${JSON.stringify({ headers, credential: Object.keys(credential) })}`);
    }
    for (const route of [`/join/${master}`, joinPath(adminInvite)]) {
      const denied = await f.publicRequest(route, { headers });
      assert.equal(denied.status, 403, 'Public administrator joins must be refused, including incomplete proxy metadata');
      assert.equal(denied.headers.get('set-cookie'), null);
    }
    assert.equal((await f.publicRequest('/api/session', { headers: { ...headers, Cookie: player.cookie } })).status, 200,
      'A public listener remains usable by ordinary sessions with these headers');
  }
  for (const headers of [{ Host: 'unrelated.example' }, { Host: 'localhost' }, { Host: 'picker.example.attacker.invalid' },
    { Host: '127.0.0.1', 'X-Forwarded-Host': 'unrelated.example' }]) {
    assert.equal((await f.publicRequest('/api/session', { headers: { ...headers, Cookie: player.cookie } })).status, 403);
  }
  // The same credential material still works on the distinct private socket.
  for (const headers of credentials) assert.equal((await f.privateRequest('/api/session', { headers })).status, 200);
  for (const route of [`/join/${master}`, joinPath(adminInvite)]) assert.equal((await f.privateRequest(route)).status, 303);
  assert.equal((await f.admin('/api/admin/master-link')).status, 200);
});

test('a public page visit with a leftover administrator cookie clears it instead of dead-ending', { timeout: 30000 }, async t => {
  const f = await fixture(t), adminInvite = await f.invite({ label: 'Private administrator', admin: true });
  const master = f.app.store.getAccessToken();
  for (const Cookie of [f.masterCookie, adminInvite.cookie, `duo_access=${master}`]) {
    for (const [route, location] of [['/', '/'], ['/?tab=tasks', '/?tab=tasks'], ['//evil.example/x', '/']]) {
      const page = await f.publicRequest(route, { headers: { ...proxy, Cookie } });
      assert.equal(page.status, 303, route); assert.equal(page.headers.get('location'), location);
      assert.match(page.headers.get('set-cookie'), /^duo_access=;.*Max-Age=0/);
    }
    assert.equal((await f.publicRequest('/api/session', { headers: { ...proxy, Cookie } })).status, 403, 'API calls keep the refusal');
    assert.equal((await f.publicRequest('/', { method: 'POST', headers: { ...proxy, Cookie } })).status, 403);
  }
  const bearer = await f.publicRequest('/', { headers: { ...proxy, Authorization: `Bearer ${master}` } });
  assert.equal(bearer.status, 403); assert.equal(bearer.headers.get('set-cookie'), null);
  assert.equal((await f.publicRequest('/', { headers: proxy })).status, 401, 'Without the cookie the page is an ordinary visit');
  assert.equal((await f.privateRequest('/api/session', { headers: { Cookie: f.masterCookie } })).status, 200, 'The private listener still accepts it');
});

test('early startup and ready handoff preserve each socket role with incomplete or spoofed proxy headers', { timeout: 30000 }, async () => {
  await mkdir(root, { recursive: true });
  for (const roles of [{ ingressRole: undefined, loopbackRole: 'public' }, { ingressRole: 'public', loopbackRole: undefined }]) {
    const directory = await mkdtemp(path.join(root, 'startup-')), dataDir = path.join(directory, 'game');
    const token = randomBytes(32).toString('base64url');
    let handle, release, entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const preparing = new Promise(resolve => { entered = resolve; });
    try {
      await prepareGameStorage(dataDir, selectedDataset);
      await mkdir(dataDir, { recursive: true });
      await writeFile(path.join(dataDir, 'access-token'), token);
      handle = await startServer({ dataset: selectedDataset, dataDir, definitions, taskMap: {}, publicOrigin, ...roles,
        host: '127.0.0.1', port: 0, loopbackPort: 0, predictionPrewarm: false, shutdownDeadlineMs: 500,
        initialState: createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['11825'] }]),
        async prepareState(state) { entered(); await blocked; return state; } });
      await preparing;
      const primary = `http://127.0.0.1:${handle.address().port}`, secondary = `http://127.0.0.1:${handle.loopbackAddress().port}`;
      const publicSocket = roles.ingressRole === 'public' ? primary : secondary;
      const privateSocket = roles.ingressRole === 'public' ? secondary : primary;
      for (const headers of [{}, { Host: 'picker.example' }, proxy,
        { ...proxy, 'X-Forwarded-For': '127.0.0.1' }, { ...proxy, 'X-Forwarded-For': 'malformed' },
        { ...proxy, 'X-Forwarded-For': '203.0.113.7, 127.0.0.1' },
        { Host: 'picker.example', 'X-Forwarded-For': '127.0.0.1' }]) {
        assert.equal((await request(publicSocket, '/api/health', { headers })).status, 401);
        for (const method of ['GET', 'HEAD']) {
          assert.equal((await request(publicSocket, '/api/health', { method, headers: { ...headers, Authorization: `Bearer ${token}` } })).status, 403);
        }
      }
      for (const headers of [{ Host: 'unrelated.example' }, { Host: 'localhost' }, { ...proxy, 'X-Forwarded-Host': 'unrelated.example' }]) {
        assert.equal((await request(publicSocket, '/api/health', { headers: { ...headers, Authorization: `Bearer ${token}` } })).status, 403);
      }
      const health = await request(privateSocket, '/api/health', { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(health.status, 200); assert.equal((await health.json()).ready, false);
      assert.equal((await request(publicSocket, '/api/command', { rawBody: '{invalid', headers: { Authorization: `Bearer ${token}` } })).status, 503);
      release();
      const app = await handle.ready;
      assert.equal(app.store.getInfo().revision, 0, 'Refused early writes were never queued');
      assert.equal((await request(publicSocket, '/api/health', { headers: { Authorization: `Bearer ${token}` } })).status, 403);
      const ready = await request(privateSocket, '/api/health', { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(ready.status, 200); assert.equal((await ready.json()).ready, true);
    } finally {
      release(); await handle?.close(); await rm(directory, { recursive: true, force: true });
    }
  }
});

test('every administrator API entry is forbidden on the public socket before credentials or bodies are handled', { timeout: 30000 }, async t => {
  const f = await fixture(t), administrator = await f.invite({ label: 'Administrator', admin: true });
  const player = await f.invite({ label: 'Player', memberId: 'actor1' });
  const credentials = [{}, { Cookie: player.cookie }, { Cookie: administrator.cookie }, { Cookie: f.masterCookie },
    { Cookie: `duo_access=${f.app.store.getAccessToken()}` }, { Authorization: `Bearer ${f.app.store.getAccessToken()}` }];
  let entries = 0;
  for (const [registeredMethod, routes] of Object.entries(routePermissions)) {
    for (const [template, permission] of Object.entries(routes)) {
      if (permission !== 'admin') continue;
      const route = concrete(template);
      for (const method of registeredMethod === 'GET' ? ['GET', 'HEAD'] : [registeredMethod]) {
        assert.equal(apiPermission(method, route), 'admin'); entries++;
        for (const headers of credentials) {
          const denied = await f.publicRequest(route, { method, ...(method === 'POST' ? { rawBody: '{invalid json' } : {}),
            headers: { ...proxy, Origin: publicOrigin, ...headers } });
          assert.equal(denied.status, 403, `${method} ${route} credentials=${Object.keys(headers)}`);
        }
      }
    }
  }
  assert.ok(entries > 20, 'The matrix includes the current GET/HEAD/POST administration surface');
  assert.equal(f.app.store.getInfo().revision, 0);
  assert.equal((await f.admin('/api/invites')).status, 200);
  assert.deepEqual(await (await f.admin('/api/overlays')).json(), { links: [] }, 'Separately dispatched overlay management was refused');
});

test('public viewer/player, OBS and native plugin workflows survive both public listener configurations', { timeout: 30000 }, async t => {
  const f = await fixture(t), viewer = await f.invite({ label: 'Spectator', viewer: true });
  const player = await f.invite({ label: 'Player', memberId: 'actor1' });
  const overlayResponse = await f.admin('/api/overlays', { label: 'OBS', widget: 'count', player: 'duo' });
  assert.equal(overlayResponse.status, 201);
  const key = overlayKey(await overlayResponse.json());
  const pluginResponse = await f.admin('/api/game-plugin/keys', { label: 'Native plugin', memberId: 'actor1' });
  assert.equal(pluginResponse.status, 201);
  const plugin = await pluginResponse.json(); assert.match(plugin.key, /^gpk_/);
  const master = f.app.store.getAccessToken();
  for (const lane of ['second public listener', 'primary public listener']) {
    if (lane === 'primary public listener') await f.restart({ ingressRole: 'public', loopbackPort: undefined });
    const origin = lane === 'second public listener' ? f.publicAddress() : f.origin();
    const call = (route, options) => request(origin, route, options);
    let playerCookie, viewerCookie;
    for (const [invite, readOnly] of [[viewer, true], [player, false]]) {
      const joined = await call(joinPath(invite), { headers: proxy });
      assert.equal(joined.status, 303, lane); assert.match(joined.headers.get('set-cookie'), /; Secure$/);
      const cookie = cookieFrom(joined), headers = { ...proxy, Cookie: cookie };
      const session = await call('/api/session', { headers }); assert.equal(session.status, 200);
      const identity = await session.json(); assert.equal(identity.admin, false); assert.equal(identity.adminAvailable, false); assert.equal(identity.readOnly, readOnly);
      assert.equal((await call('/api/state', { headers })).status, 200);
      if (readOnly) viewerCookie = cookie; else { playerCookie = cookie; assert.equal(identity.memberId, 'actor1'); }
    }
    const mutate = cookie => call('/api/command', { body: { expectedRevision: f.app.store.getInfo().revision,
      command: { type: 'set-journal', memberId: 'actor1', note: `Updated from ${lane}` } },
      headers: { ...proxy, Origin: publicOrigin, Cookie: cookie } });
    assert.equal((await mutate(viewerCookie)).status, 403);
    const playerEvents = await openEvents(origin, '/api/events', { ...proxy, Cookie: playerCookie });
    const obsEvents = await openEvents(origin, `/overlay/events?${scope}`, { Authorization: `Bearer ${key}` });
    try {
      const revision = f.app.store.getInfo().revision;
      assert.equal((await playerEvents.nextEvent('revision')).revision, revision);
      assert.deepEqual(await obsEvents.nextEvent('revision'), { revision });
      const data = await call(`/overlay/data?${scope}`, { headers: { Authorization: `Bearer ${key}` } });
      assert.equal(data.status, 200); assert.equal((await data.json()).widget, 'count');
      assert.equal((await call('/overlay/data?widget=count&player=actor1&variant=full', { headers: { Authorization: `Bearer ${key}` } })).status, 403);
      assert.equal((await call('/api/state', { headers: { Authorization: `Bearer ${key}` } })).status, 401);
      assert.equal((await call('/api/plugin/v1/status', { headers: { Authorization: `Bearer ${plugin.key}` } })).status, 200);
      assert.equal((await call('/api/plugin/v1/tasks', { headers: { Authorization: `Bearer ${plugin.key}` } })).status, 200);
      const report = await call('/api/plugin/v1/report', { body: { v: 1, seq: lane === 'second public listener' ? 0 : 1,
        sentAt: '2026-10-19T12:00:00Z', position: { x: 46, z: 49, floor: 0 } },
        headers: { Authorization: `Bearer ${plugin.key}`, Origin: undefined } });
      assert.equal(report.status, 200, 'No-Origin native reports with a literal loopback Host remain usable');
      assert.equal((await mutate(playerCookie)).status, 200);
      assert.equal((await playerEvents.nextEvent('revision')).revision, revision + 1);
      assert.deepEqual(await obsEvents.nextEvent('revision'), { revision: revision + 1 });
      for (const headers of [{ Authorization: `Bearer ${master}` }, { Cookie: f.masterCookie }]) {
        assert.equal((await call('/api/session', { headers })).status, 403, lane);
      }
      assert.equal((await call(`/join/${master}`)).status, 403, lane);
      assert.equal((await call('/api/overlays', { headers: { Cookie: playerCookie } })).status, 403, lane);
    } finally { playerEvents.close(); obsEvents.close(); }
  }
});
