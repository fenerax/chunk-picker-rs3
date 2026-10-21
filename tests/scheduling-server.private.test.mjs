import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get as httpGet } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { constants, crc32, gzipSync, inflateRawSync } from 'node:zlib';

// Only this three-chunk reference and controlled workers enter these servers.
// Every durable save lives in an owned, ignored directory inside this worktree.
const definitions = { chunks: { '12341': {}, '12342': {}, '12343': {} },
  walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'], challenges: {} };
const scratchRoot = fileURLToPath(new URL('../.local/tests/', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Controlled request did not arrive.'); await delay(5); }
}
function sharedJSON(value) {
  const bytes = Buffer.from(JSON.stringify(value)), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes); return shared;
}
function laneFactory() {
  const workers = [], calls = [];
  const create = () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true }, evaluationMs: 0 }));
      else if (message.type !== 'cancel' && message.type !== 'supersede') calls.push({ worker, message });
    };
    worker.terminate = async () => { worker.emit('exit', 0); };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], dynamicCatalogue: [], compileMs: 0 }));
    return worker;
  };
  const finish = (index = calls.length - 1) => {
    const { worker, message } = calls[index];
    const result = { tasks: [], presentation: { tasks: [], alternatives: {} }, access: { areas: [] }, metrics: { availableCount: 0, elapsedMs: 0 } };
    const value = message.type === 'evaluate' ? { resultJSON: sharedJSON(result), playJSON: sharedJSON({ ...result, format: 'play-v1' }),
      duoJSON: sharedJSON({ ...result, format: 'play-v1', projection: 'duo-v1' }), duoSidebarJSON: sharedJSON({ ...result, format: 'play-v1', projection: 'duo-sidebar-v1' }) }
      : { result: message.type === 'death-estimates' ? { estimates: [] }
        : message.type === 'chunk-planning' ? { format: 'chunk-planning-v1', rows: [] }
          : { delta: { tasksAdded: [] }, unusedPredictionDetail: 'Not an acknowledgement field' } };
    worker.emit('message', { id: message.id, ...value, evaluationMs: 0 });
  };
  return { create, workers, calls, finish };
}
async function fixture(t, { serializedStateInput = false, predictionPrewarm = false } = {}) {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(path.join(scratchRoot, 'scheduling-server-'));
  assert.equal(path.dirname(directory), path.resolve(scratchRoot));
  const foreground = laneFactory(), peer = laneFactory(), side = laneFactory(), death = laneFactory(), clock = createManualClock();
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  initialState.members[0].unlocked = ['12341']; initialState.members[1].unlocked = ['12342'];
  if (predictionPrewarm) initialState.members[0].selected = ['12343'];
  const webRoot = path.join(directory, 'web'); await mkdir(webRoot); await writeFile(path.join(webRoot, 'index.html'), '<p>Synthetic scheduling fixture</p>');
  const dataDir = path.join(directory, 'data');
  let application;
  t.after(async () => { try { await application?.close(); } finally { application = undefined; await rm(directory, { recursive: true, force: true }); } });
  application = await createServer({ dataset: fixtureDataset, definitions, taskMap: {}, initialState, webRoot, dataDir, port: 0, predictionPrewarm, shutdownDeadlineMs: 500, schedulingClock: clock,
    taskWorkerOptions: { workerFactory: foreground.create, duoWorkerFactory: peer.create, predictionWorkerFactory: side.create,
      deathWorkerFactory: death.create, serializedStateInput, deadlineMs: 3000, predictionDeadlineMs: 3000, deathDeadlineMs: 3000 } });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const api = (route, body, transportHeaders = {}) => fetch(`${origin}${route}`, { headers: { Authorization: `Bearer ${application.store.getAccessToken()}`, Origin: origin, ...transportHeaders,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const revision = application.store.getInfo().revision;
  return { application, api, revision, foreground, peer, side, death, dataDir, clock };
}
const groupPath = revision => `/api/tasks?memberId=player1&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`;
const peerPath = revision => `/api/tasks?memberId=player2&view=play-v1&lane=duo-v1&peerFor=player1&revision=${revision}`;

test('Group gate holds death and planning after selected tasks finish until the current peer arrives', async t => {
  const f = await fixture(t), selected = f.api(groupPath(f.revision));
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); assert.equal((await selected).status, 200);
  const planning = f.api('/api/chunk-planning?memberId=player1&chunkId=12342'), death = f.api('/api/death-estimates?memberId=player1&chunkId=12342');
  await delay(60); assert.equal(f.side.calls.length, 0); assert.equal(f.death.calls.length, 0);
  const peer = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 1);
  await delay(30); assert.equal(f.side.calls.length, 0); assert.equal(f.death.calls.length, 0);
  f.peer.finish(); assert.equal((await peer).status, 200);
  await until(() => f.side.calls.length === 1 && f.death.calls.length === 1);
  f.side.finish(); f.death.finish(); assert.equal((await planning).status, 200); assert.equal((await death).status, 200);
});

test('switching a settled Personal list to Group at the same revision reinstates the peer gate', async t => {
  const f = await fixture(t), personal = f.api('/api/tasks?memberId=player1&view=play-v1');
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); assert.equal((await personal).status, 200);
  assert.equal((await f.api(groupPath(f.revision))).status, 200);
  const death = f.api('/api/death-estimates?memberId=player1&chunkId=12342');
  await delay(50); assert.equal(f.death.calls.length, 0);
  const peer = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 1); f.peer.finish(); assert.equal((await peer).status, 200);
  await until(() => f.death.calls.length === 1); f.death.finish(); assert.equal((await death).status, 200);
});

test('API-only side callers do not need a browser compact-list request to release them', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/state')).status, 200);
  const planning = f.api('/api/chunk-planning?memberId=player1&chunkId=12342'), death = f.api('/api/death-estimates?memberId=player1&chunkId=12342');
  await until(() => f.side.calls.length === 1 && f.death.calls.length === 1);
  assert.equal(f.foreground.calls.length, 0); f.side.finish(); f.death.finish();
  assert.equal((await planning).status, 200); assert.equal((await death).status, 200);
});

