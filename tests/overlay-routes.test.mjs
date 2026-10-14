import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { resolveDataset } from '../app/datasets.mjs';
import { prepareGameStorage } from '../app/game-profile.mjs';

const root = fileURLToPath(new URL('../.local/overlay-tests/', import.meta.url));
const definitions = { chunks: { '11825': { Name: '<b>Port Sarim</b>' }, '11569': { Name: 'Musa Point' } }, walkableChunks: ['11825', '11569'], walkableChunksF2P: ['11825', '11569'] };
const keyFrom = link => new URLSearchParams(new URL(link).hash.slice(1)).get('key');
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
const scope = (widget = 'goals', player = 'actor1') => `widget=${widget}&player=${player}&variant=full`;

async function fixture(t, options = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'server-'));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['11825'], journal: 'Private journal' }, { id: 'reed', name: 'Reed', unlocked: ['11569'] }]);
  initialState.tasks = [{ id: 'custom:goal', label: '<b>Get a hammer</b>', category: 'custom', memberIds: ['actor1'] }];
  initialState.members[0].taskStatus = { 'custom:goal': { favorite: true, note: 'Private task note' } };
  let app, origin;
  async function start(initial) {
    app = await createServer({ dataDir, definitions, taskMap: {}, initialState: initial, host: '127.0.0.1', port: 0, predictionPrewarm: false, ...options });
    await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  }
  await start(initialState);
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const request = (route, { body, headers = {}, ...rest } = {}) => fetch(`${origin}${route}`, { redirect: 'manual', ...rest,
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...headers } });
  const admin = (route, body, headers = {}) => request(route, { body, headers: { Authorization: `Bearer ${app.store.getAccessToken()}`, ...headers } });
  const overlay = (route, key, extra = {}) => request(route, { ...extra, headers: { Authorization: `Bearer ${key}`, ...extra.headers } });
  async function create(widget = 'goals', player = 'actor1', options = {}) {
    const response = await admin('/api/overlays', { label: 'OBS source', widget, player, ...options });
    assert.equal(response.status, 201); return response.json();
  }
  async function invite(input) {
    const response = await admin('/api/invites', input); assert.equal(response.status, 201);
    const created = await response.json();
    const joined = await request(new URL(created.link).pathname);
    assert.equal(joined.status, 303); return { ...created, cookie: cookieFrom(joined) };
  }
  return { dataDir, get app() { return app; }, get origin() { return origin; }, request, admin, overlay, create, invite,
    async restart() { await app.close(); await start(); } };
}

test('real server overlay boundary requires dedicated scope, denies writes/general APIs, and persists hash-only revocation', async t => {
  const f = await fixture(t, { publicOrigin: 'https://picker.example' });
  assert.deepEqual(await (await f.admin('/api/overlays')).json(), { links: [] });
  assert.equal((await f.request('/api/overlays', { method: 'POST', headers: { 'Content-Type': 'invalid' } })).status, 401, 'Admin auth runs before body parsing');
  const viewer = await f.invite({ label: 'Viewer', viewer: true }), player = await f.invite({ label: 'Player', memberId: 'actor1' });
  for (const identity of [viewer, player]) {
    for (const [route, body] of [['/api/overlays', undefined], ['/api/overlays', { widget: 'count', player: 'duo' }], ['/api/overlays/00000000-0000-0000-0000-000000000000/revoke', {}]]) {
      assert.equal((await f.request(route, { body, headers: { Cookie: identity.cookie } })).status, 403);
    }
  }
  const created = await f.create(), key = keyFrom(created.link), id = created.overlay.id;
  const adminJoin = await f.request(`/join/${f.app.store.getAccessToken()}`);
  const adminCookie = cookieFrom(adminJoin);
  for (const [route, mime] of [['/overlay-panel.mjs', 'text/javascript'], ['/overlay-panel.css', 'text/css']]) {
    assert.equal((await f.request(route)).status, 401);
    for (const cookie of [adminCookie, viewer.cookie, player.cookie]) {
      const resource = await f.request(route, { headers: { Cookie: cookie } });
      assert.equal(resource.status, 200, 'The signed-in app can load the overlay panel module and stylesheet');
      assert.equal(resource.headers.get('content-type').startsWith(mime), true);
    }
    assert.equal((await f.overlay(route, key)).status, 401);
  }
  for (const cookie of [adminCookie, viewer.cookie, player.cookie]) {
    for (const [route, body] of [['/api/state', undefined], ['/api/session', undefined], ['/api/overlays', undefined], ['/api/overlays', {}], ['/api/command', {}]]) {
      assert.equal((await f.overlay(route, key, { body, headers: { Cookie: cookie } })).status, 401, 'Overlay bearer cannot fall back to a picker cookie');
    }
  }
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(key), true);
  assert.equal(new URL(created.link).origin, 'https://picker.example');
  assert.equal(new URL(created.link).searchParams.has('key'), false);
  assert.equal(created.overlay.widget, 'goals'); assert.equal(created.overlay.player, 'actor1');
  const list = await (await f.admin('/api/overlays')).json();
  assert.deepEqual(list.links, [created.overlay]);
  assert.equal(JSON.stringify(list).includes(key), false); assert.equal(JSON.stringify(list).includes('tokenHash'), false);
  const disk = await readFile(path.join(f.dataDir, 'overlays.json'), 'utf8');
  assert.equal(disk.includes(key), false);
  assert.equal(JSON.parse(disk).links[0].tokenHash === createHash('sha256').update(key).digest('hex'), true);
  const response = await f.overlay(`/overlay/data?${scope()}`, key);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const payload = await response.json();
  assert.deepEqual(payload, { revision: 0, widget: 'goals', heading: 'Current goals', players: [{ name: 'Player', goals: [{ label: 'Get a hammer' }] }] });
  for (const privateField of ['journal', 'taskStatus', 'provenance', 'legacy', 'history', 'Private']) assert.equal(JSON.stringify(payload).includes(privateField), false);
  assert.equal((await f.overlay(`/overlay/data?${scope()}`, key, { method: 'HEAD' })).status, 200);
  for (const route of ['/overlay/data', '/overlay/events']) {
    assert.equal((await f.request(`${route}?${scope()}`)).status, 401);
    assert.equal((await f.admin(`${route}?${scope()}`)).status, 401, 'Master picker credential is not an overlay credential');
    assert.equal((await f.request(`${route}?${scope()}`, { headers: { Cookie: viewer.cookie } })).status, 401);
    assert.equal((await f.overlay(`${route}?${scope('count')}`, key)).status, 403);
    assert.equal((await f.overlay(`${route}?${scope('goals', 'reed')}`, key)).status, 403);
    assert.equal((await f.request(`${route}?${scope()}&key=${key}`)).status, 400);
  }
  for (const route of ['/api/state', '/api/history', '/api/backup', '/api/tasks?memberId=actor1', '/api/events', '/api/overlays']) assert.equal((await f.overlay(route, key)).status, 401);
  for (const route of ['/api/command', '/api/sandbox/evaluate', '/api/overlays', `/api/overlays/${id}/revoke`, '/api/unknown']) assert.equal((await f.overlay(route, key, { body: {} })).status, 401);
  for (const route of ['/overlay/data', '/overlay/events', '/overlay/goals', '/overlay/unknown']) assert.equal((await f.overlay(`${route}?${scope()}`, key, { body: {} })).status, 403);
  for (const route of ['/api/overlays/unknown', '/api/overlays/not-a-revoke']) assert.equal((await f.admin(route, {})).status, 403);
  assert.equal((await f.admin('/api/overlays', { widget: 'count', player: 'unknown' })).status, 400);
  assert.equal((await f.admin('/api/overlays', { widget: 'wrong', player: 'duo' })).status, 400);
  assert.equal((await f.admin('/api/overlays', { widget: 'goals', player: 'duo', variant: 'wrong' })).status, 400);
  assert.equal((await f.admin('/api/overlays', { widget: 'goals', player: 'duo', size: 'huge' })).status, 400);
  assert.equal((await f.admin('/api/overlays', { widget: 'count', player: 'duo' }, { Origin: 'https://other.example' })).status, 403);
  for (const route of ['/overlay/goals', '/overlay/roll', '/overlay/count', '/overlay/overlay.css', '/overlay/overlay-client.mjs']) {
    const shell = await f.request(route); assert.equal(shell.status, 200);
    assert.equal(shell.headers.get('referrer-policy'), 'no-referrer');
    assert.match(shell.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await f.request(route, { method: 'HEAD' })).status, 200);
    assert.equal((await f.request(route, { method: 'HEAD' })).headers.get('cache-control').includes('no-store'), true);
  }
  for (const route of ['/overlay/unknown', '/overlay/index.html', '/overlay/app.mjs', '/overlay/goals/extra']) assert.equal((await f.request(route)).status, 404);
  assert.equal((await f.request('/overlay/count?size=wrong')).status, 400);
  const backup = await (await f.admin('/api/backup')).text();
  assert.equal(backup.includes('tokenHash'), false); assert.equal(backup.includes(id), false);
  assert.equal(f.app.store.getInfo().revision, 0, 'Managing overlays never changes gameplay revision');
  await f.restart();
  assert.equal((await f.overlay(`/overlay/data?${scope()}`, key)).status, 200);
  assert.equal((await f.admin(`/api/overlays/${id}/revoke`, {})).status, 200);
  assert.equal((await f.overlay(`/overlay/data?${scope()}`, key)).status, 401);
  await f.restart();
  assert.equal((await f.overlay(`/overlay/data?${scope()}`, key)).status, 401);
  assert.equal((await (await f.admin('/api/overlays')).json()).links[0].revoked, true);
});

test('overlay SSE shares committed revision source and closes promptly on revoke and server shutdown', async t => {
  const f = await fixture(t), created = await f.create('count', 'duo'), key = keyFrom(created.link);
  const stream = await f.overlay(`/overlay/events?${scope('count', 'duo')}`, key);
  assert.equal(stream.status, 200); assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const reader = stream.body.getReader();
  let first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(first, 'event: revision\ndata: {"revision":0}\n\n');
  const command = await f.admin('/api/command', { expectedRevision: 0, command: { type: 'set-journal', memberId: 'actor1', note: 'Updated private journal' } });
  assert.equal(command.status, 200);
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.equal(update, 'event: revision\ndata: {"revision":1}\n\n');
  assert.equal((await f.admin(`/api/overlays/${created.overlay.id}/revoke`, {})).status, 200);
  assert.equal((await reader.read()).done, true);
  assert.equal((await f.overlay(`/overlay/events?${scope('count', 'duo')}`, key)).status, 401);
  const second = await f.create('count', 'duo');
  const live = await f.overlay(`/overlay/events?${scope('count', 'duo')}`, keyFrom(second.link));
  const liveReader = live.body.getReader(); await liveReader.read();
  await f.app.close(); assert.equal((await liveReader.read()).done, true);
});

test('goals choice is credential-scoped, cached separately and retains legacy personal-only links', async t => {
  const f = await fixture(t);
  const command = async command => {
    const response = await f.admin('/api/command', { expectedRevision: f.app.store.getInfo().revision, command });
    assert.equal(response.status, 200);
  };
  await command({ type: 'add-group-goal', goalId: 'group-goal:sample', text: 'Both get a pickaxe', completion: 'players' });
  const legacy = await f.create(), legacyKey = keyFrom(legacy.link);
  const file = path.join(f.dataDir, 'overlays.json'), disk = JSON.parse(await readFile(file, 'utf8'));
  delete disk.links[0].goals; await writeFile(file, JSON.stringify(disk)); await f.restart();
  const originalRead = f.app.store.getState;
  f.app.store.getState = () => { throw new Error('Overlay reads must not clone the whole save.'); };
  t.after(() => { f.app.store.getState = originalRead; });
  const personal = { revision: 1, widget: 'goals', heading: 'Current goals', players: [{ name: 'Player', goals: [{ label: 'Get a hammer' }] }] };
  assert.deepEqual(await (await f.overlay(`/overlay/data?${scope()}`, legacyKey)).json(), personal);
  const groupGoals = [{ label: 'Both get a pickaxe', players: [{ name: 'Player', done: false }, { name: 'Reed', done: false }] }];
  for (const goals of ['group', 'both']) {
    const player = goals === 'group' ? 'duo' : 'actor1';
    const created = await f.create('goals', player, { goals }), key = keyFrom(created.link);
    assert.equal(created.overlay.goals, goals); assert.equal(new URL(created.link).searchParams.get('goals'), goals);
    const route = `/overlay/data?${scope('goals', player)}&goals=${goals}`;
    for (let i = 0; i < 2; i++) assert.deepEqual(await (await f.overlay(route, key)).json(),
      { revision: 1, widget: 'goals', heading: 'Current goals', ...(goals === 'both' ? { players: personal.players } : {}), groupGoals });
    assert.equal((await f.overlay(`/overlay/data?${scope('goals', player)}`, key)).status, 403);
    assert.equal((await f.overlay(route, legacyKey)).status, 403);
    assert.equal((await f.overlay(`/overlay/events?${scope('goals', player)}&goals=personal`, key)).status, 403);
    assert.equal((await f.overlay('/api/state', key)).status, 401);
    assert.equal((await f.overlay('/api/command', key, { body: {} })).status, 401);
    await f.admin(`/api/overlays/${created.overlay.id}/revoke`, {});
    assert.equal((await f.overlay(route, key)).status, 401);
  }
  for (const body of [{ widget: 'goals', goals: 'unknown' }, { widget: 'goals', goals: null }, { widget: 'roll', goals: 'both' }, { widget: 'goals', goals: 'group', player: 'actor1' }]) {
    assert.equal((await f.admin('/api/overlays', body)).status, 400);
  }
  for (const query of ['goals=unknown', 'goals=both&goals=group']) assert.equal((await f.overlay(`/overlay/data?${scope()}&${query}`, legacyKey)).status, 400);
  assert.equal((await f.request('/overlay/count?goals=both')).status, 400);
});

test('shared-goal commands refresh the minimal projection through revision-only SSE, including Done and Undo', async t => {
  const f = await fixture(t), created = await f.create('goals', 'duo', { goals: 'group' }), key = keyFrom(created.link);
  const query = `${scope('goals', 'duo')}&goals=group`, stream = await f.overlay(`/overlay/events?${query}`, key);
  const reader = stream.body.getReader(); t.after(() => reader.cancel());
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'event: revision\ndata: {"revision":0}\n\n');
  const read = async () => (await f.overlay(`/overlay/data?${query}`, key)).json();
  assert.deepEqual(await read(), { revision: 0, widget: 'goals', heading: 'Current goals', groupGoals: [] });
  const command = async command => {
    const expectedRevision = f.app.store.getInfo().revision;
    assert.equal((await f.admin('/api/command', { expectedRevision, command })).status, 200);
    assert.equal(new TextDecoder().decode((await reader.read()).value), `event: revision\ndata: {"revision":${expectedRevision + 1}}\n\n`);
  };
  const goalId = 'group-goal:stream';
  await command({ type: 'add-group-goal', goalId, text: '<b>Both get a hammer</b>', completion: 'players', link: { kind: 'task', id: 'custom:goal', label: 'Private linked label' } });
  assert.deepEqual(await read(), { revision: 1, widget: 'goals', heading: 'Current goals', groupGoals: [
    { label: 'Both get a hammer', players: [{ name: 'Player', done: false }, { name: 'Reed', done: false }] },
  ] });
  await command({ type: 'set-group-goal-done', goalId, memberId: 'actor1', done: true });
  assert.deepEqual((await read()).groupGoals[0].players, [{ name: 'Player', done: true }, { name: 'Reed', done: false }]);
  await command({ type: 'update-group-goal', goalId, text: 'Both get a pickaxe', completion: 'players' });
  assert.equal((await read()).groupGoals[0].label, 'Both get a pickaxe');
  await command({ type: 'set-group-goal-done', goalId, memberId: 'reed', done: true });
  assert.deepEqual((await read()).groupGoals, []);
  await command({ type: 'undo' });
  assert.equal((await read()).groupGoals[0].players[1].done, false);
  await command({ type: 'remove-group-goal', goalId });
  assert.deepEqual((await read()).groupGoals, []);
});

test('administrator revoked while sending a body cannot finish creating an overlay', async t => {
  const f = await fixture(t), admin = await f.invite({ label: 'Temporary admin', admin: true });
  const body = JSON.stringify({ widget: 'count', player: 'duo' });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(`${f.origin}/api/overlays`, { method: 'POST', headers: { Cookie: admin.cookie, Origin: f.origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    request.on('error', reject); request.write(body.slice(0, 1));
  });
  const revoked = await f.admin(`/api/invites/${admin.invite.id}/revoke`, {}); assert.equal(revoked.status, 200);
  request.end(body.slice(1));
  assert.equal(await response, 401);
  assert.deepEqual(await (await f.admin('/api/overlays')).json(), { links: [] });
});

test('invalid overlay sidecar fails startup without retaining the gameplay directory lock', async t => {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'invalid-'));
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  await prepareGameStorage(dataDir, await resolveDataset());
  await writeFile(path.join(dataDir, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: [{ token: 'plaintext must not be accepted' }] }));
  const options = { dataDir, definitions, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false };
  await assert.rejects(createServer(options), /Invalid overlay record/);
  await writeFile(path.join(dataDir, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: [] }));
  app = await createServer(options);
  await app.listen();
  assert.ok(app.address().port > 0);
});

test('repeat overlay reads reuse tiny payloads and never clone full saves or Undo graphs', async t => {
  const f = await fixture(t), created = await f.create('roll', 'actor1'), key = keyFrom(created.link);
  const stateRead = f.app.store.getState, calculationRead = f.app.store.getCalculationState, historyRead = f.app.store.getRecentHistory;
  let calculations = 0, histories = 0;
  f.app.store.getState = () => { throw new Error('Full-save cloning is not needed for overlay reads.'); };
  f.app.store.getCalculationState = () => { calculations++; return calculationRead(); };
  f.app.store.getRecentHistory = limit => { histories++; return historyRead(limit); };
  try {
    for (let i = 0; i < 3; i++) {
      const response = await f.overlay(`/overlay/data?${scope('roll')}`, key);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { revision: 0, widget: 'roll', heading: 'Last roll', roll: null });
    }
    assert.equal(calculations, 1); assert.equal(histories, 1);
  } finally { f.app.store.getState = stateRead; f.app.store.getCalculationState = calculationRead; f.app.store.getRecentHistory = historyRead; }
});

test('last roll survives retained-history compaction and its archive result survives unrelated edits', async t => {
  const f = await fixture(t, { retention: { historyEntries: 2, backupDays: 90 } });
  const command = async value => {
    const response = await f.admin('/api/command', { expectedRevision: f.app.store.getInfo().revision, command: value });
    assert.equal(response.status, 200);
  };
  await command({ type: 'set-chunk', memberId: 'actor1', chunkId: '11569', status: 'selected' });
  await command({ type: 'roll', memberId: 'actor1', count: 1 });
  for (let i = 0; i < 7; i++) await command({ type: 'set-journal', memberId: 'actor1', note: `Private journal ${i}` });
  assert.equal(f.app.store.getRecentHistory(100).some(event => event.type === 'roll'), false);
  assert.ok(f.app.store.getInfo().retention.historyArchives > 0);
  const created = await f.create('roll', 'actor1'), key = keyFrom(created.link), original = f.app.store.queryHistory;
  let lookups = 0;
  f.app.store.queryHistory = input => { lookups++; assert.equal(input.type, 'map'); assert.equal(input.player, 'actor1'); assert.ok(input.limit <= 500); return original(input); };
  const data = async () => {
    const response = await f.overlay(`/overlay/data?${scope('roll')}`, key); assert.equal(response.status, 200); return response.json();
  };
  try {
    assert.deepEqual((await data()).roll, { player: 'Player', phase: 'unlocked', chunks: [{ id: '11569', name: 'Musa Point' }] });
    assert.equal(lookups, 1);
    await command({ type: 'set-journal', memberId: 'actor1', note: 'Another unrelated edit' });
    assert.equal((await data()).roll.chunks[0].id, '11569'); assert.equal(lookups, 1);
    await f.restart();
    const response = await f.overlay(`/overlay/data?${scope('roll')}`, key); assert.equal(response.status, 200);
    assert.equal((await response.json()).roll.chunks[0].id, '11569');
  } finally { f.app.store.queryHistory = original; }
});

test('async archive reads recheck revocation and convert revision conflicts to minimal errors', async t => {
  const f = await fixture(t), created = await f.create('roll', 'actor1'), key = keyFrom(created.link);
  const original = f.app.store.queryHistory;
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  f.app.store.queryHistory = async input => { started(); await blocked; return original(input); };
  const request = f.overlay(`/overlay/data?${scope('roll')}`, key);
  await entered;
  assert.equal((await f.admin(`/api/overlays/${created.overlay.id}/revoke`, {})).status, 200);
  release(); assert.equal((await request).status, 401);
  f.app.store.queryHistory = original;
  const next = await f.create('roll', 'reed');
  let resume, read;
  const hold = new Promise(resolve => { resume = resolve; });
  const ready = new Promise(resolve => { read = resolve; });
  f.app.store.queryHistory = async input => { read(); await hold; return original(input); };
  const pending = f.overlay(`/overlay/data?${scope('roll', 'reed')}`, keyFrom(next.link));
  await ready;
  assert.equal((await f.admin('/api/command', { expectedRevision: 0, command: { type: 'set-journal', memberId: 'reed', note: 'Private data must not leak through conflict' } })).status, 200);
  resume();
  const conflict = await pending; assert.equal(conflict.status, 409);
  assert.deepEqual(Object.keys(await conflict.json()), ['message']);
  f.app.store.queryHistory = original;
});
