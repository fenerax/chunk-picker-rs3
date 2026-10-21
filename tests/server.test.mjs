import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../app/server.mjs';
import { createGroupState, exportBackup, importLegacyMaps } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool } from '../app/core/rules.mjs';
import { duoFixture } from './fixtures/partner.mjs';
import { buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';

const definitions = { chunks: { '100': {}, '101': {}, '102': {} }, walkableChunks: ['100', '101', '102'], walkableChunksF2P: ['100', '101', '102'] };
const taskMap = { 'Example quest': 't_1' };
const command = { type: 'set-rule', ruleId: 'content.f2p', value: false };
const taskDefinitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { 'Example quest': { Chunks: ['12341'], QuestPoints: 1 }, 'Future quest': { Chunks: ['12342'] } } } };

test('permanent ID lookup exposes current metadata and aliases with read-only invitation access', async t => {
  const id = 'rs3:task:lookup-fixture', oldLabel = 'Original quest', currentLabel = 'Corrected quest';
  const data = { ...taskDefinitions, challenges: { Quest: { [currentLabel]: { PickerId: id } } } };
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  state.tasks = [{ id, category: 'Quest', label: oldLabel }];
  state.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, category: 'Quest', kind: 'task', label: oldLabel, aliases: [legacyTaskId('Quest', oldLabel)] } },
    aliases: { [legacyTaskId('Quest', oldLabel)]: id }, unresolved: [] };
  const { origin, api } = await fixture(t, { definitions: data, taskMap: {}, initialState: state });
  const route = `/api/ids/${encodeURIComponent(id)}`;
  assert.equal((await fetch(`${origin}${route}`)).status, 401);
  const before = (await (await api('/api/state')).json()).state;
  const lookup = await api(route);
  assert.equal(lookup.status, 200);
  const metadata = await lookup.json();
  assert.equal(metadata.id, id); assert.equal(metadata.label, currentLabel); assert.equal(metadata.kind, 'task');
  assert.ok(metadata.aliases.includes(legacyTaskId('Quest', oldLabel)));
  assert.ok(metadata.aliases.includes(legacyTaskId('Quest', currentLabel)));
  assert.equal((await api(route, {})).status, 404);
  assert.equal((await api(`/api/ids/${encodeURIComponent('rs3:task:missing')}`)).status, 404);
  assert.deepEqual((await (await api('/api/state')).json()).state, before);
  for (const module of ['/tasks/identity.mjs', '/data/identity-registry.mjs']) assert.equal((await api(module)).status, 200);
});

test('worker projects own obligations consistently into activity, equipment, collections and predictions', async t => {
  const duo = duoFixture(), saved = buildEquipmentCatalogue(duo.data).find(row => row.label.includes('Partner sword'));
  duo.state.tasks.push({ id: saved.id, label: saved.label, category: saved.category }); duo.state.members[0].taskStatus = { [saved.id]: { challengeCompleted: true, backlogged: true } };
  const { api } = await fixture(t, { definitions: duo.data, taskMap: {}, initialState: duo.state });
  const result = await (await api('/api/tasks?memberId=player1')).json();
  assert.ok(!result.presentation.tasks.some(row => ['Partner', 'PartnerItem', 'Train'].includes(row.rawLabel)));
  assert.ok(result.presentation.tasks.some(row => row.rawLabel === 'Own'));
  assert.ok(!result.tasks.some(row => row.generated && ['Kill X','Every Drop','All Shops'].includes(row.record?.Label)));
  assert.ok(!result.activityInfo.activities.some(row => row.label === 'Partner'));
  assert.ok(!result.equipmentPlanning.recommendations.some(row => row.equipment.name === 'Partner sword'));
  const preserved = result.tasks.find(row => row.id === saved.id);
  assert.equal(preserved.obligation, false); assert.equal(preserved.hidden, true);
  assert.deepEqual((await (await api('/api/state')).json()).state.members[0].taskStatus[saved.id], duo.state.members[0].taskStatus[saved.id]);
  const prediction = await (await api('/api/predict?memberId=player1&chunkId=12851')).json();
  assert.ok(prediction.delta.tasksAdded.some(row => row.rawLabel === 'Partner'));
  assert.ok(prediction.delta.tasksAdded.some(row => row.record?.Label === 'Kill X'));
  assert.equal(result.partnerConnections.byChunk['12851'].connected, true);
  for (const route of ['/core/territory.mjs', '/data/lodestones.mjs']) assert.equal((await api(route)).status, 200, `Browser dependency ${route} is served`);
});

test('saved own derived goals stay visible when backlogged or their equip level becomes blocked', async t => {
  const duo = duoFixture(); duo.data.equipment['Own sword'].requirements = { Crafting: 50 };
  duo.data.chunks['12850'].Monster = { Rat: true }; duo.state.members[0].taskRules['Kill X'] = false;
  const saved = buildEquipmentCatalogue(duo.data).find(row => row.label.includes('Own sword'));
  const collection = createCollectionEngine(duo.data).catalogue.find(row => row.label.includes('Kill X Rat'));
  duo.state.tasks.push({ id: saved.id, label: saved.label, category: saved.category }, { id: collection.id, label: collection.label, category: collection.category }); duo.state.members[0].taskStatus = { [saved.id]: { challengeCompleted: true, backlogged: true }, [collection.id]: { challengeCompleted: true, backlogged: true } };
  const { api } = await fixture(t, { definitions: duo.data, taskMap: {}, initialState: duo.state });
  const result = await (await api('/api/tasks?memberId=player1')).json(), row = result.tasks.find(row => row.id === saved.id);
  assert.equal(row.obligation, true); assert.equal(row.hidden, false); assert.equal(row.status, 'blocked');
  assert.equal(result.tasks.find(row => row.id === collection.id).obligation, true); assert.equal(result.tasks.find(row => row.id === collection.id).hidden, false);
  assert.deepEqual((await (await api('/api/state')).json()).state.members[0].taskStatus[saved.id], duo.state.members[0].taskStatus[saved.id]);
});

test('worker collection goals predict without saving and register only a checked goal with exact undo', async t => {
  const collectionDefinitions = { chunks: { '12341': { Monster: { Goblin: true }, Shop: { Store: true } }, '12342': { Monster: { Rat: true } } },
    walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'], challenges: {},
    drops: { Goblin: { Bones: { '1': 'Always' } }, Rat: { Tail: { '1': '1/2' } } }, shopItems: { Store: { Hammer: true } } };
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  initialState.rules['content.f2p'] = false;
  initialState.members[0].unlocked = ['12341'];
  initialState.members[0].taskRules = { 'Kill X': true, 'Kill X Amount': '25', 'Every Drop': true, 'All Shops': true };
  const { api } = await fixture(t, { definitions: collectionDefinitions, taskMap: {}, initialState });
  const before = (await (await api('/api/state')).json()).state;
  const result = await (await api('/api/tasks?memberId=player1')).json();
  const kill = result.tasks.find(row => row.record?.Label === 'Kill X');
  assert.equal(kill.label, 'Kill 25 Goblin');
  assert.ok(result.presentation.tasks.some(row => row.id === kill.id));
  assert.ok(result.tasks.some(row => row.record?.Label === 'Every Drop'));
  assert.ok(result.tasks.some(row => row.record?.Label === 'All Shops'));
  assert.equal(before.tasks.length, 0);
  const prediction = await (await api('/api/predict?memberId=player1&chunkId=12342')).json();
  assert.ok(prediction.delta.tasksAdded.some(row => row.label === 'Kill 25 Rat'));
  assert.deepEqual((await (await api('/api/state')).json()).state, before);
  const checked = await api('/api/command', { expectedRevision: before.revision, command: { type: 'set-task-status', memberId: 'player1', taskId: kill.id, challengeCompleted: true } });
  assert.equal(checked.status, 200);
  const saved = (await checked.json()).state;
  assert.deepEqual(saved.tasks, [{ id: kill.id, label: 'Kill X Goblin', category: 'Extra' }]);
  assert.deepEqual(saved.members[1], before.members[1]);
  assert.deepEqual((await (await api('/api/backup')).json()).state.tasks, saved.tasks);
  const after = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(after.tasks.find(row => row.id === kill.id).challengeSatisfied, true);
  await api('/api/command', { expectedRevision: saved.revision, command: { type: 'undo' } });
  const undone = (await (await api('/api/state')).json()).state;
  assert.deepEqual(undone.tasks, before.tasks);
  assert.deepEqual(undone.members, before.members);
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-duo-server-'));
  const webRoot = path.join(directory, 'web');
  await mkdir(webRoot);
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><p>Authored picker</p>');
  let application = await createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), webRoot, definitions, taskMap, port: 0, shutdownDeadlineMs: 500, ...options });
  await application.listen();
  t.after(async () => {
    try { await application?.close(); }
    finally { application = undefined; await rm(directory, { recursive: true, force: true }); }
  });
  const origin = `http://127.0.0.1:${application.address().port}`;
  const joined = await fetch(application.inviteUrl, { redirect: 'manual' });
  assert.equal(joined.status, 303);
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  async function api(route, body, extra = {}) {
    return fetch(`${origin}${route}`, { headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(extra.headers ?? {}) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')) });
  }
  return { application, origin, cookie, api, directory };
}

test('private invitation authenticates the authored app and APIs without health-token disclosure', async t => {
  const { application, origin, api } = await fixture(t);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/`)).status, 401);
  assert.equal((await fetch(`${origin}/join/invalid`, { redirect: 'manual' })).status, 401);
  const root = await api('/');
  assert.equal(root.status, 200);
  assert.match(await root.text(), /Authored picker/);
  const health = await (await api('/api/health')).json();
  assert.equal(health.ready, true);
  assert.ok(!JSON.stringify(health).includes(application.store.getAccessToken()));
  const state = await (await api('/api/state')).json();
  assert.equal(state.store.durable, true);
  assert.deepEqual(state.state.members.map(member => member.unlocked), [[], []]);
  const bearer = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${application.store.getAccessToken()}` } });
  assert.equal(bearer.status, 200);
});

test('relocated reference inputs preserve the task-map API and original asset URLs and bytes', async t => {
  const { api } = await fixture(t, { taskMap: undefined });
  const seed = await readFile(new URL('../reference/original-picker/tasksMap.json', import.meta.url));
  assert.deepEqual(await (await api('/api/task-map')).json(), JSON.parse(seed));
  for (const [route, name] of [['/assets/world.png', 'runescape_world_map.png'], ['/assets/background.png', 'Background-chunk.PNG']]) {
    const file = new URL(`../reference/original-picker/${name}`, import.meta.url), response = await api(route);
    // The images come with the art pack; without it the routes are absent.
    if (!existsSync(file)) { assert.equal(response.status, 404, route); continue; }
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file));
  }
});

test('auth does not allow original upstream scripts, store files, traversal or foreign-origin writes', async t => {
  const { origin, api, cookie } = await fixture(t);
  for (const route of ['/index.html', '/index.js', '/worker.js', '/modal.js', '/reference/original-picker/index.html', '/reference/original-picker/index.js', '/reference/original-picker/tasksMap.json', '/archive/data/map-connections.2026-10-08.v1.json', '/data/map-connections.2026-10-08.v1.json', '/.local/duo/access-token', '/storage/store.mjs', '/assets/../index.js', '/assets/%2e%2e%2findex.js', '/assets/%5c..%5cindex.js']) {
    assert.equal((await api(route)).status, 404, route);
  }
  const raw = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/`, { path: '/core/../server.mjs', headers: { Cookie: cookie } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }); request.on('error', reject);
  });
  assert.equal(raw, 404);
  const foreign = await api('/api/command', { expectedRevision: 0, command }, { headers: { Origin: 'https://foreign.example' } });
  assert.equal(foreign.status, 403);
  const missingOrigin = await fetch(`${origin}/api/command`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, command }) });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await (await api('/api/state')).json()).state.revision, 0);
});

test('reference APIs cache byte content with ETag and retain full local JSON', async t => {
  const { api } = await fixture(t);
  const response = await api('/api/definitions');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), definitions);
  assert.ok(response.headers.get('etag'));
  assert.equal((await api('/api/definitions', undefined, { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
  assert.deepEqual(await (await api('/api/task-map')).json(), taskMap);
  assert.equal((await api('/core/state.mjs')).status, 200);
  assert.equal((await api('/data/world.mjs')).status, 200);
});

test('browser entry point and its module dependencies are served through exact authenticated static routes', async t => {
  const { api, origin } = await fixture(t, { webRoot: path.resolve('app/web') });
  const seen = new Set();
  async function inspect(route) {
    if (seen.has(route)) return;
    seen.add(route);
    const response = await api(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), route.endsWith('.json') ? /application\/json/ : /javascript/, route);
    const source = await response.text();
    if (route.endsWith('.json')) { assert.doesNotThrow(() => JSON.parse(source)); return; }
    assert.ok(!/^\s*import\s+(?:[^;]*?\s+from\s+)?['"]node:/m.test(source), `${route} must be browser safe.`);
    for (const match of source.matchAll(/^import\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      assert.ok(match[1].startsWith('.'), `Browser import must resolve locally: ${match[1]}`);
      await inspect(new URL(match[1], `${origin}${route}`).pathname);
    }
    for (const match of source.matchAll(/datasetJSON\(["'](app\/data\/[^"']+\.json)["']\)/g)) await inspect(match[1].slice('app'.length));
  }
  for (const route of ['/main.mjs', '/core/state.mjs', '/core/planning.mjs']) await inspect(route);
  for (const route of ['/completed-range.mjs', '/completed-range-preference.mjs']) assert.ok(seen.has(route), `${route} must load with the completed review.`);
  for (const route of ['/map.mjs', '/display-world.mjs', '/core/rule-registry.mjs', '/core/rules.mjs']) assert.ok(seen.has(route), `${route} must be reachable from the entry point or optional full-state tools.`);
  for (const route of ['/data/world.mjs', '/tasks/rates.mjs']) assert.equal((await api(route)).status, 200, `Optional full reference dependency ${route} remains served.`);
  assert.ok(seen.has('/tasks/migration.mjs'), 'The rules module migration dependency must be reachable.');
  for (const route of ['/core/transport-access.mjs', '/core/automatic-transport.mjs', '/teleports.mjs', '/data/transport-routes.mjs', '/data/transport-routes.2026-10-09.v2.json']) assert.ok(seen.has(route), `${route} must be browser-loadable even when transport admission defaults off.`);
  assert.equal((await api('/teleports.css')).status, 200);
  assert.equal((await api('/data/transport-routes.2026-10-09.v1.json')).status, 404, 'Unselected historical component metadata is not served.');
  assert.equal((await api('/data/transport-routes.2026-10-08.v1.json')).status, 404, 'Unselected historical metadata is not served.');
  for (const route of ['/data/map-corrections.mjs', '/core/map-boundaries.mjs']) {
    assert.equal((await api(route)).status, 200, `${route} remains available to optional full-reference tools.`);
    assert.equal((await fetch(`${origin}${route}`)).status, 401);
  }
  assert.equal((await fetch(`${origin}/tasks/migration.mjs`)).status, 401);
  assert.equal((await api('/tasks/worker.mjs')).status, 404);
  assert.equal((await api('/tasks/engine.mjs')).status, 404);
});

test('retained snapshot routes require authentication and download validated JSON for reviewed restore', async t => {
  const { api, origin, application } = await fixture(t);
  assert.equal((await fetch(`${origin}/api/backups`)).status, 401);
  const before = await application.store.backup();
  await api('/api/command', { expectedRevision: 0, command });
  const { backups } = await (await api('/api/backups')).json();
  assert.equal(backups.length, 1);
  assert.match(backups[0].id, /\.json\.gz$/);
  assert.ok(!JSON.stringify(backups).includes(application.store.getAccessToken()));
  assert.equal((await fetch(`${origin}/api/backups/${backups[0].id}`)).status, 401);
  const downloaded = await api(`/api/backups/${backups[0].id}`);
  assert.match(downloaded.headers.get('content-disposition'), /\.json"$/);
  const backup = await downloaded.json();
  assert.deepEqual(backup, before);
  assert.equal((await api('/api/restore/preview', { backup })).status, 200);
  assert.equal(application.store.getState().revision, 1);
  assert.equal((await api('/api/backups/access-token')).status, 400);
  assert.equal((await api('/api/backups/%2e%2e%2fstate.json')).status, 404);
  assert.equal((await api('/api/backups/0000000000000000-aaaaaaaaaaaaaaaa.json.gz')).status, 404);
});

test('large state, save, conflict, restore, import and backup responses negotiate decodable gzip with a plain fallback', async t => {
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  initialState.legacy = { preservedGameplay: { notes: 'A saved gameplay note. '.repeat(1000) } };
  const { api } = await fixture(t, { initialState });
  const compressed = { headers: { 'Accept-Encoding': 'gzip' } };
  const plain = { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } };
  const zipped = await api('/api/state', undefined, compressed);
  assert.equal(zipped.headers.get('content-encoding'), 'gzip');
  assert.equal(zipped.headers.get('vary'), 'Accept-Encoding');
  assert.equal(zipped.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  const state = await zipped.json();
  const fallback = await api('/api/state', undefined, plain);
  assert.equal(fallback.headers.get('content-encoding'), null);
  assert.ok(Number(zipped.headers.get('content-length')) < Number(fallback.headers.get('content-length')));
  assert.deepEqual(await fallback.json(), state);
  const saved = await api('/api/command', { expectedRevision: 0, command }, compressed);
  assert.equal(saved.headers.get('content-encoding'), 'gzip');
  const changed = await saved.json();
  assert.equal(changed.state.revision, 1);
  assert.equal(changed.state.rules['content.f2p'], false);
  const conflicted = await api('/api/command', { expectedRevision: 0, command }, compressed);
  assert.equal(conflicted.status, 409);
  assert.equal(conflicted.headers.get('content-encoding'), 'gzip');
  const conflict = await conflicted.json();
  assert.deepEqual(conflict.state, changed.state);
  assert.deepEqual(conflict.pools, changed.pools);
  const restored = await api('/api/restore', { expectedRevision: 1, backup: exportBackup(initialState) }, compressed);
  assert.equal(restored.headers.get('content-encoding'), 'gzip');
  assert.equal((await restored.json()).state.revision, 2);
  const document = { maps: { qxa: { chunks: { unlocked: { '100': '100' }, selected: {} }, chunkNotes: { '100': 'Original map note. '.repeat(1000) } } } };
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }];
  const preview = await api('/api/import/preview', { document, members }, compressed);
  assert.equal(preview.headers.get('content-encoding'), 'gzip');
  assert.equal((await preview.json()).state.revision, 3);
  const imported = await api('/api/import', { document, members, expectedRevision: 2 }, compressed);
  assert.equal(imported.headers.get('content-encoding'), 'gzip');
  assert.equal((await imported.json()).state.revision, 3);
  const downloaded = await api('/api/backup', undefined, compressed);
  assert.equal(downloaded.headers.get('content-encoding'), 'gzip');
  assert.match(downloaded.headers.get('content-disposition'), /attachment; filename="rs3-duo-backup.json"/);
  assert.equal((await downloaded.json()).state.revision, 3);
  const savedPlain = await api('/api/command', { expectedRevision: 3, command }, plain);
  assert.equal(savedPlain.headers.get('content-encoding'), null);
  const plainState = (await savedPlain.json()).state;
  assert.equal(plainState.revision, 4);
  const conflictPlain = await api('/api/command', { expectedRevision: 3, command }, plain);
  assert.equal(conflictPlain.status, 409);
  assert.equal(conflictPlain.headers.get('content-encoding'), null);
  assert.deepEqual((await conflictPlain.json()).state, plainState);
});

test('state, mutations and conflicts include pools computed with server extension hooks from their exact snapshot', async t => {
  const registry = createRuleRegistry([{ id: 'house.extra', label: 'Extra destination', description: 'A server-authored candidate hook.', type: 'boolean', default: true,
    candidates: ({ value }) => value ? [{ id: '12342', detail: 'Custom destination.' }] : [] }]);
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }], registry);
  initialState.members[0].unlocked = ['12341'];
  initialState.rules['roll.adjacent'] = false;
  const { api, application } = await fixture(t, { registry, initialState, definitions: { chunks: taskDefinitions.chunks, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] } });
  const first = await (await api('/api/state')).json();
  assert.deepEqual(first.pools.player1, evaluateRollPool(application.world, first.state, 'player1', registry));
  assert.deepEqual(first.pools.player1.eligible.map(item => item.id), ['12342']);
  assert.equal(first.pools.player1.eligible[0].reasons[0].ruleId, 'house.extra');
  const descriptors = await (await api('/api/rules')).json();
  assert.ok(descriptors.definitions.some(rule => rule.id === 'house.extra' && rule.label === 'Extra destination'));
  assert.equal(descriptors.defaults['house.extra'], true);
  assert.ok(descriptors.definitions.every(rule => !Object.hasOwn(rule, 'candidates') && !Object.hasOwn(rule, 'exclude')));
  const changed = await (await api('/api/command', { expectedRevision: 0, command: { type: 'set-rule', ruleId: 'house.extra', value: false } })).json();
  assert.equal(changed.state.revision, 1);
  assert.deepEqual(changed.pools.player1.eligible, []);
  const response = await api('/api/command', { expectedRevision: 0, command });
  assert.equal(response.status, 409);
  const conflict = await response.json();
  assert.deepEqual(conflict.state, changed.state);
  assert.deepEqual(conflict.pools, changed.pools);
  const restored = await (await api('/api/restore', { expectedRevision: 1, backup: exportBackup(initialState, registry) })).json();
  assert.equal(restored.state.revision, 2);
  assert.deepEqual(restored.pools.player1.eligible.map(item => item.id), ['12342']);
});

test('two browser clients conflict safely and committed state survives a server restart', async t => {
  const { application, api, directory } = await fixture(t);
  const results = await Promise.all([api('/api/command', { expectedRevision: 0, command }), api('/api/command', { expectedRevision: 0, command })]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  const conflict = await results.find(response => response.status === 409).json();
  assert.equal(conflict.state.revision, 1);
  await application.close();
  let restarted = await createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), definitions, taskMap, port: 0, shutdownDeadlineMs: 500 });
  t.after(async () => { try { await restarted?.close(); } finally { restarted = undefined; } });
  await restarted.listen();
  const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/state`, { headers: { Authorization: `Bearer ${restarted.store.getAccessToken()}` } });
  assert.equal((await response.json()).state.rules['content.f2p'], false);
});

test('launch import refuses an existing gameplay store and leaves its state intact', async t => {
  const { application, api, directory } = await fixture(t);
  await api('/api/command', { expectedRevision: 0, command });
  await application.close();
  const initialImport = { maps: { qxa: { chunks: { unlocked: { '100': '100' }, selected: {} } }, qxb: { chunks: { unlocked: { '101': '101' }, selected: {} } } } };
  await assert.rejects(() => createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), definitions, taskMap, initialImport, port: 0 }), /already has gameplay/);
  let reopened = await createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), definitions, taskMap, port: 0, shutdownDeadlineMs: 500 });
  try {
    assert.equal(reopened.store.getState().revision, 1);
    assert.equal(reopened.store.getState().rules['content.f2p'], false);
    assert.deepEqual(reopened.store.getState().members[0].unlocked, []);
  } finally { try { await reopened.close(); } finally { reopened = undefined; } }
});

test('captured snapshot provenance survives launch, preview and API import using only known metadata fields', async t => {
  const metadata = { capturedAt: '2026-10-07T12:25:53.021Z', hash: `sha256:${'a'.repeat(64)}`, hashScope: 'maps',
    source: 'firebase-public-rest', sourceOrigin: 'https://chunkpickerrs3.firebaseio.com', sourceVersion: '6.9.39.1',
    sourceFields: ['chunks'], mapIds: ['qxa', 'qxb'], password: 'DO-NOT-RETAIN', accessToken: 'DO-NOT-RETAIN', unknown: { secret: 'DO-NOT-RETAIN' } };
  const document = { metadata, maps: { qxa: { chunks: { unlocked: { '100': '100' }, selected: {} } }, qxb: { chunks: { unlocked: { '101': '101' }, selected: {} } } } };
  const expected = { capturedAt: metadata.capturedAt, hash: metadata.hash, hashScope: 'maps', sourceVersion: '6.9.39.1', source: 'firebase-public-rest', sourceOrigin: metadata.sourceOrigin };
  const { application, api } = await fixture(t, { initialImport: document });
  const launch = application.store.getState();
  assert.equal(launch.provenance.restore.incomingProvenance.capturedAt, metadata.capturedAt);
  assert.deepEqual(launch.provenance.restore.incomingProvenance.capture, expected);
  assert.deepEqual(launch.members.map(member => member.sourceMapId), ['qxa', 'qxb']);
  assert.ok(!JSON.stringify(launch).includes('DO-NOT-RETAIN'));
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }, { id: 'player2', name: 'Player 2', mapId: 'qxb' }];
  const preview = await (await api('/api/import/preview', { document, members })).json();
  assert.deepEqual(preview.state.provenance.restore.incomingProvenance.capture, expected);
  assert.equal(application.store.getState().revision, 1);
  const explicitDate = '2026-10-07T13:00:00.000Z';
  const imported = await (await api('/api/import', { document, members, capturedAt: explicitDate, expectedRevision: 1 })).json();
  assert.equal(imported.state.provenance.restore.incomingProvenance.capturedAt, explicitDate);
  assert.deepEqual(imported.state.provenance.restore.incomingProvenance.capture, { ...expected, capturedAt: explicitDate });
  const invalid = await api('/api/import/preview', { document, members, capturedAt: { password: 'DO-NOT-RETAIN' } });
  assert.equal(invalid.status, 400);
  assert.equal(application.store.getState().revision, 2);
});

test('backup preview/import restore are memory-only until an expected-revision commit', async t => {
  const { api } = await fixture(t);
  const incoming = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  incoming.members[0].unlocked = ['100'];
  const backup = exportBackup(incoming);
  const preview = await api('/api/restore/preview', { backup });
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).members[0].unlocked.added, ['100']);
  assert.equal((await (await api('/api/state')).json()).state.revision, 0);
  const committed = await api('/api/restore', { backup, expectedRevision: 0 });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).state.revision, 1);
  const document = { maps: { test: { chunks: { unlocked: { '101': '101' }, selected: {} }, chunkNotes: { '101': 'Keep this note' } } } };
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'test' }];
  const importPreview = await (await api('/api/import/preview', { document, members })).json();
  assert.equal(importPreview.state.legacy.maps.test.chunkNotes['101'], 'Keep this note');
  assert.equal((await (await api('/api/state')).json()).state.revision, 1);
  const imported = await (await api('/api/import', { document, members, expectedRevision: 1 })).json();
  assert.equal(imported.state.revision, 2);
  assert.ok(imported.warnings.length);
  const saved = await api('/api/backup');
  assert.match(saved.headers.get('content-disposition'), /attachment/);
  assert.equal((await saved.json()).state.revision, 2);
});

test('invalid restore and malformed instance lock reject safely without replacing durable gameplay', async t => {
  const { application, api, directory } = await fixture(t);
  await api('/api/command', { expectedRevision: 0, command });
  const backup = await (await api('/api/backup')).json();
  backup.state.members[0].unlocked = ['0'];
  assert.equal((await api('/api/restore/preview', { backup })).status, 400);
  assert.equal((await api('/api/restore', { backup, expectedRevision: 1 })).status, 400);
  assert.equal((await (await api('/api/state')).json()).state.revision, 1);
  await application.close();
  await writeFile(path.join(directory, 'data', 'store.lock'), '{broken');
  await assert.rejects(() => createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), definitions, taskMap, port: 0 }), /unreadable lock/);
  await rm(path.join(directory, 'data', 'store.lock'));
  let recovered = await createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), definitions, taskMap, port: 0, shutdownDeadlineMs: 500 });
  try { assert.equal(recovered.store.getState().revision, 1); }
  finally { try { await recovered.close(); } finally { recovered = undefined; } }
});

test('SSE broadcasts only committed revisions and failed saves preserve the current state', async t => {
  let fail = true;
  const { api, application, origin, cookie } = await fixture(t, { beforeCommit: () => { if (fail) throw new Error('Injected persistence failure'); } });
  const abort = new AbortController();
  const events = await fetch(`${origin}/api/events`, { headers: { Cookie: cookie }, signal: abort.signal });
  const reader = events.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"revision":0/);
  const failed = await api('/api/command', { expectedRevision: 0, command });
  assert.equal(failed.status, 500);
  assert.equal(application.store.getState().revision, 0);
  fail = false;
  const committed = await api('/api/command', { expectedRevision: 0, command });
  assert.equal(committed.status, 200);
  const notification = new TextDecoder().decode((await reader.read()).value);
  assert.match(notification, /"revision":1/);
  assert.ok(!notification.includes('members') && !notification.includes(application.store.getAccessToken()));
  abort.abort();
  await reader.cancel().catch(() => {});
});

test('task catalogue preparation runs before caller hooks and worker task routes cache gameplay inputs', async t => {
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  initialState.members[0].unlocked = ['12341'];
  const operations = [];
  const { api } = await fixture(t, { definitions: taskDefinitions, initialState, prepareState: async (state, context) => {
    assert.equal(state.tasks.length, 2);
    operations.push(context.operation);
    state.members[0].notes = { '12341': 'Caller hook ran last' };
    return state;
  } });
  const state = (await (await api('/api/state')).json()).state;
  assert.equal(state.tasks.length, 2);
  assert.equal(state.members[0].notes['12341'], 'Caller hook ran last');
  const first = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(first.stateRevision, 0);
  assert.equal(first.memberId, 'player1');
  assert.equal(first.cache.hit, false);
  assert.equal(first.cache.worker, true);
  assert.equal(first.tasks.find(task => task.label === 'Example quest').status, 'available');
  assert.equal(first.tasks.find(task => task.label === 'Future quest').status, 'blocked');
  const compressed = await api('/api/tasks?memberId=player1', undefined, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.deepEqual((await compressed.json()).tasks, first.tasks);
  const second = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(second.cache.hit, true);
  assert.deepEqual(second.tasks, first.tasks);
  assert.equal((await api('/api/tasks?memberId=missing')).status, 400);
  assert.equal((await api('/api/tasks')).status, 400);
  await api('/api/command', { expectedRevision: 0, command });
  const changed = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(changed.stateRevision, 1);
  assert.equal(changed.cache.hit, false);
  assert.deepEqual(operations, ['initialize', 'command']);
  const rules = await (await api('/api/rules')).json();
  assert.equal(rules.settings['content.f2p'], false);
  assert.ok(rules.definitions.some(rule => rule.id === 'tasks.completion'));
});

test('display preference saves reuse task facts at the new revision while personal completion invalidates them', async t => {
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  initialState.members[0].unlocked = ['12341'];
  const { api } = await fixture(t, { definitions: taskDefinitions, initialState });
  const first = await (await api('/api/tasks?memberId=player1')).json();
  await api('/api/command', { expectedRevision: 0, command: { type: 'set-preference', memberId: 'player1', preferenceId: 'ids', value: true } });
  const display = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(display.stateRevision, 1);
  assert.equal(display.cache.hit, true);
  assert.deepEqual(display.tasks, first.tasks);
  const id = first.tasks.find(task => task.label === 'Example quest').id;
  await api('/api/command', { expectedRevision: 1, command: { type: 'complete-task', memberId: 'player1', taskId: id, completed: true } });
  const completed = await (await api('/api/tasks?memberId=player1')).json();
  assert.equal(completed.stateRevision, 2);
  assert.equal(completed.cache.hit, false);
  assert.equal(completed.tasks.find(task => task.id === id).personalCompleted, true);
  const other = await (await api('/api/tasks?memberId=player2')).json();
  assert.equal(other.memberId, 'player2');
  assert.equal(other.cache.hit, false);
  assert.equal(other.tasks.find(task => task.id === id).personalCompleted, false);
});

test('migrated legacy challenge checks stay distinct from personal completion and diagnostics remain readable', async t => {
  const { api } = await fixture(t, { definitions: taskDefinitions });
  const document = { maps: { qxa: { chunks: { unlocked: { '12341': '12341' }, selected: {} },
    chunkinfo: { checkedAllTasks: { Quest: { t_1: true, t_missing: true } } } } } };
  const imported = await (await api('/api/import', { expectedRevision: 0, document, members: [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }] })).json();
  assert.equal(imported.state.tasks.length, 2);
  assert.deepEqual(imported.state.members[0].completedTasks, []);
  const evaluation = await (await api('/api/tasks?memberId=player1')).json();
  const checked = evaluation.tasks.find(task => task.label === 'Example quest');
  assert.equal(checked.personalCompleted, false);
  assert.equal(checked.challengeSatisfied, true);
  const migration = await (await api('/api/migration')).json();
  assert.equal(migration.stateRevision, 1);
  assert.equal(migration.report.unresolved.length, 1);
  assert.ok(migration.warnings.some(warning => warning.includes('t_missing')));
});

test('completed migrations reuse prepared gameplay without resurrecting cleared notes and hooks still run last', async t => {
  const document = { maps: { qxa: { chunks: { unlocked: { '12341': '12341' }, selected: {} }, chunkNotes: { '12341': 'Imported note' } } } };
  const initialState = importLegacyMaps(document, { members: [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }] }).state;
  const preparation = [];
  const { api } = await fixture(t, { definitions: taskDefinitions, initialState, prepareState: (state, context) => {
    preparation.push({ operation: context.operation, reused: context.migration.reused, tasks: state.tasks.length });
    return state;
  } });
  assert.equal((await (await api('/api/state')).json()).state.members[0].notes['12341'], 'Imported note');
  await api('/api/command', { expectedRevision: 0, command: { type: 'set-note', memberId: 'player1', chunkId: '12341', note: '' } });
  const after = (await (await api('/api/state')).json()).state;
  assert.ok(!Object.hasOwn(after.members[0].notes, '12341'));
  assert.equal(after.legacy.maps.qxa.chunkNotes['12341'], 'Imported note');
  assert.equal(after.legacy.gameplayMigration.schemaVersion, 2);
  assert.deepEqual(preparation, [{ operation: 'initialize', reused: false, tasks: 2 }, { operation: 'command', reused: true, tasks: 2 }]);
});

test('migration fast path never skips schema-one upgrades or missing catalogue registration', async t => {
  const initialState = importLegacyMaps({ maps: { qxa: { chunks: { unlocked: { '12341': '12341' }, selected: {} }, chunkNotes: { '12341': 'Historical note cleared earlier' } } } },
    { members: [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }] }).state;
  initialState.tasks = [{ id: 'rs3:Quest:Example%20quest', label: 'Example quest', category: 'Quest' }, { id: 'rs3:Quest:Future%20quest', label: 'Future quest', category: 'Quest' }];
  initialState.legacy.gameplayMigration = { schemaVersion: 1, unresolved: [], taskStatusProvenance: [] };
  const preparation = [];
  const { api } = await fixture(t, { definitions: taskDefinitions, initialState, prepareState: (state, context) => {
    preparation.push(context.migration.reused);
    if (context.operation === 'initialize') state.tasks = state.tasks.filter(task => task.label !== 'Future quest');
    return state;
  } });
  const upgraded = (await (await api('/api/state')).json()).state;
  assert.equal(upgraded.legacy.gameplayMigration.schemaVersion, 2);
  assert.ok(!upgraded.members[0].notes?.['12341']);
  assert.equal(upgraded.tasks.length, 1);
  await api('/api/command', { expectedRevision: 0, command });
  const repaired = (await (await api('/api/state')).json()).state;
  assert.equal(repaired.tasks.length, 2);
  assert.equal(repaired.legacy.gameplayMigration.report.catalogueTasks, 2);
  assert.deepEqual(preparation, [false, false]);
});

test('predictions and profile previews run without changing durable state', async t => {
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  initialState.members[0].unlocked = ['12341'];
  const { api } = await fixture(t, { definitions: taskDefinitions, initialState });
  const before = (await (await api('/api/state')).json()).state;
  const prediction = await (await api('/api/predict?memberId=player1&chunkId=12342')).json();
  assert.equal(prediction.stateRevision, 0);
  assert.equal(prediction.cache.worker, true);
  assert.ok(prediction.delta.tasksAdded.some(task => task.label === 'Future quest'));
  assert.ok(prediction.delta.basesAdded.includes('12342'));
  assert.equal((await (await api('/api/predict?memberId=player1&chunkId=12342')).json()).cache.hit, true);
  assert.equal((await api('/api/predict?memberId=player1&chunkId=0')).status, 400);
  assert.equal((await api('/api/predict?memberId=player1&chunkId=999')).status, 400);
  const profile = { format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: { 'content.f2p': false }, taskRules: { Skills: false } };
  const preview = await (await api('/api/profile/preview', { profile, memberId: 'player1' })).json();
  assert.equal(preview.stateRevision, 0);
  assert.ok(preview.changes.rules.some(change => change.id === 'content.f2p'));
  assert.ok(preview.changes.taskRules.some(change => change.id === 'Skills'));
  assert.deepEqual((await (await api('/api/state')).json()).state, before);
});

test('a heavy task evaluation cannot block health or saves, and obsolete results are discarded', { timeout: 20000 }, async t => {
  const tasks = {};
  for (let index = 0; index < 1200; index++) tasks[`Task ${index}`] = { Chunks: ['12341'], ...(index < 1199 ? { Tasks: { [`Task ${index + 1}`]: 'Quest' } } : {}) };
  const heavyDefinitions = { ...taskDefinitions, challenges: { Quest: tasks } };
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  initialState.members[0].unlocked = ['12341'];
  const { api } = await fixture(t, { definitions: heavyDefinitions, initialState });
  const evaluating = api('/api/tasks?memberId=player1');
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  const saved = await api('/api/command', { expectedRevision: 0, command });
  assert.equal(saved.status, 200);
  const originalResult = await evaluating;
  assert.equal(originalResult.status, 409);
  assert.match((await originalResult.json()).message, /superseded/);
  assert.equal((await (await api('/api/state')).json()).state.revision, 1);
});
