import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { normalizeOriginalMap } from '../app/integrations/original-sync.mjs';
import { locallyChanged, capture as localCapture, definitions as localDefinitions, extraTasks, transferred } from './original-sync-local-fixture.mjs';

const capture = JSON.parse(await readFile(new URL('./fixtures/original-sync/capture.json', import.meta.url), 'utf8'));
const sources = ['qxa', 'qxb'].map(id => normalizeOriginalMap(capture.maps[id], id));
const ids = [...new Set([...sources.flatMap(source => [...source.unlocked, ...source.selected, ...source.blacklisted, ...source.pendingRoll]), '99999'])];
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, { name: `Chunk ${id}` }])), walkableChunks: ids, walkableChunksF2P: ids };
const allGroups = ['chunks', 'selections', 'blacklist', 'pendingRoll'];
function initial() {
  const state = createGroupState(sources.map((source, index) => ({ id: index ? 'player2' : 'player1', name: index ? 'Player 2' : 'Player 1', sourceMapId: source.sourceMapId,
    unlocked: source.unlocked.slice(1), selected: source.selected.slice(1).reverse(), blacklisted: source.blacklisted, pendingRoll: source.pendingRoll,
    taskRules: { ...source.taskRules, 'app-only': true }, notes: { [ids[0]]: 'Keep my note' }, preferences: { theme: 'dark' } })));
  state.tasks = [{ id: 'custom:keep', label: 'Keep this task', category: 'Custom' }];
  state.members[0].taskStatus = { 'custom:keep': { note: 'Personal status', challengeCompleted: true } };
  return state;
}
async function fixture(t, overrides = {}, serverOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-original-sync-'));
  let clock = new Date(capture.metadata.capturedAt), reads = 0;
  const app = await createServer({ dataset: fixtureDataset, dataDir: directory, port: 0, initialState: initial(), definitions, taskMap: {}, ...serverOptions, originalSync: {
    now: () => clock, retries: 0, fetchImpl: async (url, options) => {
      reads++; assert.equal(options.method, 'GET'); const match = /\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(url);
      return new Response(JSON.stringify(match ? capture.maps[match[1]][match[2]] ?? null : capture.metadata.sourceVersion ?? null));
    }, ...overrides,
  } });
  await app.listen(); const origin = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { await app.close(); assert.ok(path.basename(directory).startsWith('rs3-original-sync-')); await rm(directory, { recursive: true, force: true }); });
  const api = (route, body, extra = {}) => fetch(`${origin}${route}`, { headers: { Authorization: `Bearer ${app.store.getAccessToken()}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...extra }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const apply = (preview, members = preview.members.map(member => ({ memberId: member.id, groups: allGroups })), revision = preview.currentRevision) =>
    api('/api/command', { expectedRevision: revision, command: { type: 'sync-original', previewId: preview.previewId, members } });
  return { app, api, apply, origin, reads: () => reads, advance: ms => { clock = new Date(clock.getTime() + ms); } };
}

test('authenticated preview is read-only; reviewed command mirrors both owners durably in one undoable revision', async t => {
  const { app, api, apply, origin, reads } = await fixture(t);
  assert.equal(reads(), 0);
  assert.equal((await fetch(`${origin}/api/original-sync/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await api('/api/original-sync/preview', {}, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await api('/api/original-sync/preview', { sourceMapId: 'other' })).status, 400); assert.equal(reads(), 0);
  const before = app.store.getState();
  const preview = await (await api('/api/original-sync/preview', {})).json(); assert.equal(reads(), 33);
  assert.deepEqual(app.store.getState(), before);
  const response = await apply(preview); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const saved = app.store.getState(); assert.equal(saved.revision, before.revision + 1); assert.equal(saved.history.length, before.history.length + 1);
  for (const [index, member] of saved.members.entries()) {
    for (const field of ['unlocked', 'selected', 'blacklisted', 'pendingRoll']) assert.deepEqual(member[field], sources[index][field]);
    for (const field of ['notes', 'preferences', 'taskRules', 'taskStatus']) assert.deepEqual(member[field], before.members[index][field]);
    assert.equal(member.originalPickerSync.capturedAt, preview.capturedAt); assert.equal(member.originalPickerSync.sourceMapId, sources[index].sourceMapId);
  }
  assert.equal(saved.history.at(-1).type, 'sync-original'); assert.deepEqual(saved.rules, before.rules);
  assert.deepEqual((await (await api('/api/backup')).json()).state.members, saved.members);
  assert.equal((await apply(preview)).status, 410);
  const newPreview = await (await api('/api/original-sync/preview', {})).json(); assert.equal(newPreview.cached, true); assert.equal(reads(), 33);
  assert.equal(newPreview.members[0].lastSynced, saved.members[0].originalPickerSync.appliedAt);
  assert.equal((await api('/api/command', { expectedRevision: saved.revision, command: { type: 'undo' } })).status, 200);
  assert.deepEqual(app.store.getState().members, before.members);
});

test('archived local unlocks and cleanup survive restart, preview and trusted apply without original writes', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-original-local-'));
  const document = localCapture();
  let app, reads = 0;
  t.after(async () => {
    await app?.close();
    assert.ok(path.basename(directory).startsWith('rs3-original-local-'));
    await rm(directory, { recursive: true, force: true });
  });
  const options = { dataDir: directory, port: 0, initialState: locallyChanged(), definitions: localDefinitions, taskMap: {},
    predictionPrewarm: false, retention: { historyEntries: 1, backupDays: 90 }, originalSync: { retries: 0, fetchImpl: async (url, options) => {
      reads++; assert.equal(options.method, 'GET');
      const match = /\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(url);
      return new Response(JSON.stringify(match ? document.maps[match[1]][match[2]] ?? null : null));
    } } };
  app = await createServer({ dataset: fixtureDataset, ...options }); await app.listen();
  for (let i = 0; i < 3; i++) await app.store.command({ type: 'set-task-status', memberId: 'player1', taskId: extraTasks[2].id, note: `Review ${i}` }, app.store.getState().revision);
  assert.ok(app.store.getInfo().retention.historyArchives > 0);
  assert.equal(app.store.getState().history.some(event => event.type === 'clear-challenge-ticks'), false);
  await app.close();
  app = await createServer({ dataset: fixtureDataset, ...options }); await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const api = (route, body) => fetch(`${origin}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${app.store.getAccessToken()}`,
    'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  const before = app.store.getState();
  const response = await api('/api/original-sync/preview', {});
  assert.equal(response.status, 200);
  const preview = await response.json(), member = preview.members[0];
  assert.deepEqual(member.chunks.keepLocal, ['12851', '12852']);
  assert.deepEqual(member.chunks.lock, ['12855']);
  assert.equal(member.tasks.keepLocal.length, 174);
  assert.deepEqual(member.tasks.complete.map(task => task.id), [extraTasks[2].id]);
  assert.deepEqual(app.store.getState(), before);
  const applied = await api('/api/command', { expectedRevision: preview.currentRevision, command: { type: 'sync-original', previewId: preview.previewId,
    members: [{ memberId: 'player1', groups: ['chunks', 'selections', 'pendingRoll', 'tasks'] }] } });
  assert.equal(applied.status, 200, JSON.stringify(await applied.clone().json()));
  const saved = app.store.getState();
  assert.deepEqual(saved.members[0].unlocked, ['12850', '12851', '12852']);
  for (const task of transferred) {
    assert.equal(saved.members[0].taskStatus[task.id].challengeCompleted, false);
    assert.equal(saved.members[1].taskStatus[task.id].challengeCompleted, true);
  }
  assert.equal(reads, 33);
  const undone = await api('/api/command', { expectedRevision: saved.revision, command: { type: 'undo' } });
  assert.equal(undone.status, 200);
  assert.deepEqual(app.store.getState().members, before.members);
});

test('changed revision rejects the reviewed token even when caller substitutes the newest revision', async t => {
  const { app, api, apply } = await fixture(t);
  const preview = await (await api('/api/original-sync/preview', {})).json();
  await api('/api/command', { expectedRevision: preview.currentRevision, command: { type: 'set-note', memberId: 'player2', chunkId: ids[0], note: 'Concurrent note' } });
  const before = app.store.getState();
  for (const revision of [preview.currentRevision, before.revision]) {
    const result = await apply(preview, undefined, revision); assert.equal(result.status, 409);
    assert.equal((await result.json()).state.revision, before.revision); assert.deepEqual(app.store.getState(), before);
  }
});

test('preview tokens expire and HTTP commands cannot supply forged target data', async t => {
  const { api, apply, advance } = await fixture(t);
  const preview = await (await api('/api/original-sync/preview', {})).json();
  for (const command of [
    { type: 'sync-original', capturedAt: preview.capturedAt, sourceHash: capture.metadata.hash, members: [] },
    { type: 'sync-original', previewId: preview.previewId, members: [{ memberId: 'player1', groups: ['chunks'], unlocked: ['99999'] }] },
  ]) assert.equal((await api('/api/command', { expectedRevision: preview.currentRevision, command })).status, 400);
  advance(10 * 60 * 1000 + 1); assert.equal((await apply(preview)).status, 410);
  assert.equal((await api('/original-sync.mjs')).status, 200);
});

test('source failure and malformed captures return clear errors and leave durable gameplay unchanged', async t => {
  for (const [code, fetchImpl] of [
    ['ORIGINAL_NETWORK', async () => { throw new Error('network offline'); }],
    ['ORIGINAL_DATA_SHAPE', async () => new Response('null')],
  ]) {
    const { app, api } = await fixture(t, { fetchImpl }); const before = app.store.getState();
    const response = await api('/api/original-sync/preview', {}); assert.equal(response.status, 502);
    const error = await response.json(); assert.equal(error.code, code); assert.match(error.message, /original picker/);
    assert.deepEqual(app.store.getState(), before);
  }
});

test('reviewed Tasks uses server identity mapping, adds checks and reasons, and undoes one durable command', async t => {
  const task = { id: 'rs3:task:test:http-sync', label: 'Imported task', category: 'Cooking' };
  const state = initial(); state.tasks.push(task);
  state.identityRegistry = { schemaVersion: 1, entries: { [task.id]: { ...task, kind: 'task', aliases: ['Original task'] } }, aliases: {}, unresolved: [] };
  const live = structuredClone(capture);
  live.maps.qxa.chunkinfo = { checkedAllTasks: { Cooking: { t_http: true } }, backlog: { Cooking: { t_http: 'Gather ingredients first' } } };
  const { app, api, apply, advance } = await fixture(t, { fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); const match = /\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(url);
    return new Response(JSON.stringify(match ? live.maps[match[1]][match[2]] ?? null : live.metadata.sourceVersion ?? null));
  } }, { initialState: state, taskMap: { 'Original task': 't_http' } });
  const before = app.store.getState();
  const preview = await (await api('/api/original-sync/preview', {})).json();
  assert.deepEqual(preview.members[0].tasks.complete.map(row => row.id), [task.id]);
  assert.equal(preview.members[0].tasks.backlogAdd[0].reason, 'Gather ingredients first');
  assert.deepEqual(app.store.getState(), before);
  const groups = [{ memberId: 'player1', groups: ['tasks'] }];
  assert.equal((await apply(preview, [{ ...groups[0], tasks: { complete: [], backlog: [] } }])).status, 400);
  assert.equal((await apply(preview, groups)).status, 200);
  const saved = app.store.getState();
  assert.deepEqual(saved.members[0].taskStatus[task.id], { challengeCompleted: true, backlogged: true, backlogReason: 'Gather ingredients first' });
  assert.deepEqual(saved.members[0].completedTasks, before.members[0].completedTasks);
  assert.deepEqual(saved.rules, before.rules);
  assert.equal(saved.history.at(-1).type, 'sync-original');
  assert.deepEqual(saved.history.at(-1).command.members[0].tasks, { complete: [task.id], backlog: [{ taskId: task.id, reason: 'Gather ingredients first' }] });
  assert.equal((await api('/api/command', { expectedRevision: saved.revision, command: { type: 'undo' } })).status, 200);
  assert.deepEqual(app.store.getState().members, before.members);
  const stale = await (await api('/api/original-sync/preview', {})).json();
  await api('/api/command', { expectedRevision: stale.currentRevision, command: { type: 'set-note', memberId: 'player2', chunkId: ids[0], note: 'Concurrent change' } });
  assert.equal((await apply(stale, groups)).status, 409);
  const expired = await (await api('/api/original-sync/preview', {})).json();
  advance(10 * 60 * 1000 + 1); assert.equal((await apply(expired, groups)).status, 410);
});
