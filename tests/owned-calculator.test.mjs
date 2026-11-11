// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { buildOwnedBase } from '../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../app/storage/owned-base-schema.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createResidentState, applyResidentCommand, materializeResidentState } from '../app/core/state.mjs';
import { hasResidentIdentities } from '../app/core/resident-copy.mjs';
import { withIdentityDictionaryCallCountsForTests, identityValue, identityJSONParts } from '../app/tasks/identity-dictionary.mjs';
import { buildIdentityIndex } from '../app/tasks/identity.mjs';
import { hasCompleteMigrationCatalogue } from '../app/tasks/migration.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { automaticTravelInputKey } from '../app/core/travel-inputs.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { registerOwnedCalculatorBase, ownedCalculatorInput, createOwnedCalculatorReceiver, OWNED_CALCULATOR_TRANSPORT } from '../app/tasks/owned-transport.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { warmResultKey } from '../app/tasks/warm-results.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { fixture, first, second, generated, custom, now, taskCatalogue } from './helpers/owned-format2-fixture.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const deleted = 'rs3:task:synthetic-deleted';
const definitions = { challenges: { Synthetic: { 'Synthetic first': { PickerId: first, Chunks: ['12850'] },
  'Synthetic second': { PickerId: second, Chunks: ['12851'] } } }, chunks: { '12850': {}, '12851': {} },
  drops: {}, equipment: {}, codeItems: {}, walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'] };
const world = buildWorld(definitions);
const workerData = genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface },
  skillGuideCatalogue: { skills: [], tasks: [] } });
const clock = new URL('./helpers/fixed-performance-clock.mjs', import.meta.url).href;
function data() {
  const original = fixture();
  const built = buildOwnedBase({ dataset: { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion,
    digest: selectedDataset.digest }, tasks: [...original.base.tasks, { id: deleted, label: 'Deleted base row', category: 'Synthetic' }],
  identityRegistry: original.base.identityRegistry });
  const state = original.state;
  state.members[0].unlocked = ['12850'];
  state.tasks[2] = { ...state.tasks[2], memberIds: ['member-2'] };
  state.provenance = { ownedCatalogue: { retiredIds: [second] } };
  // Retired rows remain addressable, and deleted rows remain omitted.
  state.members[1].completedTasks = [second];
  let resident = createResidentState(state, built.base);
  const commands = [
    { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first, generated] },
    { type: 'update-task', taskId: custom, task: { label: 'Assigned custom', memberIds: ['member-2'] } },
    { type: 'add-task', task: { id: 'custom:deleted-with-undo', label: 'Undo preimage', category: 'Custom' } },
    { type: 'delete-task', taskId: 'custom:deleted-with-undo' },
  ];
  for (const command of commands) resident = applyResidentCommand(resident, command, { now, world, taskCatalogue });
  registerOwnedCalculatorBase(built.base, built.pin);
  return { ...built, resident, logical: materializeResidentState(resident), manifest: createOwnedBaseManifest([built.pin]) };
}
function canonical(value) {
  if (value instanceof SharedArrayBuffer || ArrayBuffer.isView(value)) return Buffer.from(value instanceof SharedArrayBuffer ? value : value.buffer, value.byteOffset ?? 0, value.byteLength).toString('hex');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['evaluationMs', 'timingMs'].includes(key)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
async function client(worker) {
  const [ready] = await once(worker, 'message'); assert.equal(ready.type, 'ready');
  let sequence = 0, installations = 0;
  return { get installations() { return installations; }, send(message) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const messages = [];
      const cleanup = () => { worker.off('message', receive); worker.off('error', error); worker.off('exit', exit); };
      const error = cause => { cleanup(); reject(cause); }, exit = () => error(new Error('Calculator exited.'));
      const receive = response => {
        if (response.id !== id) return;
        if (response.type === 'progress' && response.ownedBaseInstalled) { installations++; return; }
        messages.push(canonical(response));
        if (!['progress', 'prediction-prepared'].includes(response.type)) { cleanup(); resolve(messages); }
      };
      worker.on('message', receive); worker.on('error', error); worker.on('exit', exit);
      worker.postMessage({ id, pickerId: A, memberId: 'member-1', input: 'synthetic-input', ...message });
    });
  } };
}

test('digest transport matches every calculator reply, including Preview projections and Undo-bearing state', async () => {
  const f = data(), input = ownedCalculatorInput(f.resident);
  const requests = [
    { type: 'evaluate' },
    ...['full', 'play-v1'].map(resultView => ({ type: 'evaluate', resultTransport: 'json-shared-v1', resultView, duoProjection: true, duoSidebarProjection: true })),
    { type: 'evaluate', memberId: 'member-2' },
    { type: 'why-task', chunkId: first }, { type: 'how-task', chunkId: first },
    { type: 'predict', chunkId: '12851', predictionProgress: true, previewProgress: true },
    { type: 'chunk-planning', chunkId: '12851' }, { type: 'chunk-planning', chunkId: '12851', residentOnly: true },
    { type: 'sandbox', chunkId: { changes: { unlockChunks: ['12851'], doneTasks: [first] } }, resultTransport: 'json-shared-v1' },
    { type: 'area-check', chunkId: { chunkIds: ['12851'], asMembers: true } },
    { type: 'roll-pool' }, { type: 'roll-pool', draft: { changes: { unlockChunks: ['12851'] } } },
    { type: 'death-estimates', chunkIds: ['12851'] }, { type: 'prepare-rules' },
  ];
  const expected = [];
  const full = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData, execArgv: ['--import', clock] });
  try {
    const c = await client(full);
    for (const request of requests) {
      const replies = await c.send({ ...request, state: f.logical });
      assert.equal(replies.at(-1).error, undefined, request.type); expected.push(replies);
    }
  } finally { await full.terminate(); }
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData, execArgv: ['--import', clock] });
  try {
    const c = await client(worker);
    for (const [index, request] of requests.entries()) {
      const replies = await c.send({ ...request, stateTransport: OWNED_CALCULATOR_TRANSPORT, ownedDocument: input.document,
        ...(index === 0 ? { ownedBase: input.installation } : {}) });
      assert.equal(replies.at(-1).error, undefined, request.type);
      assert.deepEqual(replies, expected[index], request.type);
    }
    assert.equal(c.installations, 1);
    const otherGroup = await c.send({ pickerId: B, type: 'evaluate', stateTransport: OWNED_CALCULATOR_TRANSPORT, ownedDocument: input.document });
    assert.deepEqual(otherGroup.at(-1).result, expected[0].at(-1).result);
    assert.equal(c.installations, 1, 'base outlives the requesting group');
  } finally { await worker.terminate(); }
});

test('bounded verified receiver refuses missing, corrupt, wrong-pin and wrong-dataset bases without fallback', async () => {
  const f = data(), input = ownedCalculatorInput(f.resident), receive = createOwnedCalculatorReceiver(f.pin.dataset.digest);
  const refuses = packet => assert.throws(() => receive(packet), { code: 'OWNED_CALCULATOR_BASE_REFUSED' });
  refuses({ document: input.document });
  const badBytes = input.installation.bytes.slice(0); Buffer.from(badBytes)[0] ^= 1;
  refuses({ ...input, installation: { ...input.installation, bytes: badBytes } });
  refuses({ ...input, installation: { ...input.installation, bytes: new SharedArrayBuffer(0) } });
  assert.throws(() => createOwnedCalculatorReceiver(f.pin.dataset.digest, { limits: { bytes: input.installation.bytes.byteLength - 1 } })(input), { code: 'OWNED_CALCULATOR_BASE_REFUSED' });
  const installed = receive(structuredClone(input));
  assert.deepEqual(materializeResidentState(installed), f.logical);
  refuses({ document: { ...input.document, storage: { ...input.document.storage, base: { ...input.document.storage.base, sha256: 'c'.repeat(64) } } } });
  refuses({ document: input.document, installation: { ...input.installation, pin: { ...f.pin, dataset: { ...f.pin.dataset, digest: 'd'.repeat(64) } } } });
  refuses({ ...input, installation: { ...input.installation, bytes: badBytes } });
  assert.throws(() => createOwnedCalculatorReceiver('e'.repeat(64))(input), { code: 'OWNED_CALCULATOR_BASE_REFUSED' });
  await withIdentityDictionaryCallCountsForTests(counts => {
    const again = receive({ document: structuredClone(input.document) });
    assert(hasResidentIdentities(again));
    assert.equal(again.tasks[0], installed.tasks[0]);
    assert.equal(identityValue(again.identityRegistry.entries, second), identityValue(installed.identityRegistry.entries, second));
    assert.equal(counts.materializations, 0); assert.equal(counts.fullCopies, 0);
  });
});

test('prediction-first owned state stays resident and matches flat state after deferred views', async () => {
  const f = data(), input = ownedCalculatorInput(f.resident), expected = [];
  const requests = [{ type: 'predict', chunkId: '12851' },
    { type: 'chunk-planning', chunkId: '12851', residentOnly: true }, { type: 'evaluate' }];
  for (const owned of [false, true]) {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData, execArgv: ['--import', clock] });
    try {
      const c = await client(worker);
      for (const [index, request] of requests.entries()) {
        const replies = await c.send({ ...request, ...(owned ? {
          stateTransport: OWNED_CALCULATOR_TRANSPORT, ownedDocument: input.document,
          ...(index === 0 ? { ownedBase: input.installation } : {}) } : { state: f.logical }) });
        assert.equal(replies.at(-1).error, undefined, request.type);
        assert.equal(replies.at(-1).residentPlanningMiss, undefined, request.type);
        if (owned) assert.deepStrictEqual(replies, expected[index], request.type);
        else expected.push(replies);
      }
    } finally { await worker.terminate(); }
  }
});

test('verified base byte eviction reloads exact input and saved delta bytes', () => {
  const f = data(), input = ownedCalculatorInput(f.resident), evicted = [];
  const original = JSON.stringify(input.document), reference = createOwnedCalculatorReceiver(f.pin.dataset.digest)(input);
  const expected = JSON.stringify(ownedCodec(f.base, f.pin).encode(reference));
  const receive = createOwnedCalculatorReceiver(f.pin.dataset.digest, { maxBytes: 0, onEvict: digest => evicted.push(digest) });
  for (const packet of [input, structuredClone(input)]) {
    const state = receive(packet);
    assert.deepEqual(materializeResidentState(state), f.logical);
    assert.equal(JSON.stringify(ownedCodec(f.base, f.pin).encode(state)), expected);
  }
  assert.equal(JSON.stringify(input.document), original);
  assert.deepEqual(evicted, [f.pin.sha256, f.pin.sha256]);
  const ledger = receive.retentionLedger();
  assert.equal(ledger.complete, true);
  assert.deepEqual(ledger.dimensions.map(row => [row.unit, row.used, row.cap]), [['entries', 0, 2], ['chargeBytes', 0, 0]]);
});

test('pooled base eviction requests installations again without changing calculator reply bytes', async t => {
  const f = data(), input = ownedCalculatorInput(f.resident), replies = [], sends = [];
  for (const cap of [1024 ** 2, 0]) {
    const sent = [];
    const scheduler = await createTaskScheduler({ maxCalculators: 1, workerData, workerFactory: data => {
      const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: data,
        env: { ...process.env, RS3_STATE_SNAPSHOT_BYTES: String(cap), RS3_CALCULATOR_CACHE_BYTES: '0' }, execArgv: ['--import', clock] });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = message => { if (message.type === 'evaluate') sent.push(!!message.ownedBase); return post(message); };
      return worker;
    } });
    t.after(() => scheduler.close());
    const values = [];
    for (const key of ['first', 'second']) {
      const value = await scheduler.forPicker(A).evaluate({ revision: f.logical.revision, members: f.logical.members }, 'member-1',
        'evaluate', undefined, key, 'synthetic-input', undefined, [], 'full', { owned: input, inputKey: 'synthetic-input' });
      values.push(JSON.stringify(value.result));
    }
    replies.push(values); sends.push(sent); await scheduler.close();
  }
  assert.deepEqual(replies[1], replies[0]);
  assert.deepEqual(sends, [[true, false], [true, true]]);
});

test('owned commands, responses and pooled requests make no full identity copies', async t => {
  const f = data(), directory = await mkdtemp(path.join(tmpdir(), 'owned-calculator-'));
  let store, scheduler;
  t.after(async () => { await scheduler?.close(); await store?.close(); await rm(directory, { recursive: true, force: true }); });
  const sent = [];
  scheduler = await createTaskScheduler({ maxCalculators: 1, workerData, workerFactory: data => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: data });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { sent.push(message); post(message); }; return worker;
  } });
  store = await openStore({ dataDir: path.join(directory, 'group'), initialState: f.logical, world, now, retention: false, completionCodec: false,
    ownedFormat2: { pickerId: A, catalogueRoot: path.join(directory, 'catalogue'), dataset: f.pin.dataset, manifest: f.manifest, releaseBytes: f.bytes } });
  await withIdentityDictionaryCallCountsForTests(async counts => {
    await store.commandSerialized({ type: 'set-note', memberId: 'member-1', chunkId: '12850', note: 'Synthetic note' }, store.getInfo().revision, { view: 'play-v1' });
    await store.commandSerialized({ type: 'undo' }, store.getInfo().revision, { view: 'play-v1' });
    const capture = store.getCalculationSnapshot(), stateInput = { owned: capture.owned, inputKey: capture.taskInputKey, taskInputKey: capture.taskInputKey };
    for (const pickerId of [A, B]) {
      const response = await scheduler.forPicker(pickerId).evaluate({ revision: capture.revision, members: capture.members }, 'member-1', 'evaluate', undefined,
        `synthetic-${pickerId}`, stateInput.inputKey, undefined, [], 'full', stateInput);
      assert(response.result.tasks.length);
    }
    assert.equal(JSON.parse((await store.getStateSnapshot({ view: 'play-v1' })).stateJSON).revision, capture.revision);
    assert.equal(JSON.parse((await store.getStateSnapshot()).stateJSON).revision, capture.revision);
    assert.equal(counts.materializations, 0); assert.equal(counts.fullCopies, 0);
  });
  const jobs = sent.filter(message => message.stateTransport === OWNED_CALCULATOR_TRANSPORT);
  assert.equal(jobs.length, 2); assert.equal(jobs.filter(message => message.ownedBase).length, 1);
  for (const message of jobs) {
    assert.equal(message.state, undefined); assert.equal(message.stateJSON, undefined);
    assert(!Object.hasOwn(message.ownedDocument.state, 'tasks')); assert(!Object.hasOwn(message.ownedDocument.state, 'identityRegistry'));
    assert(!Object.hasOwn(message.ownedDocument.storage.delta.tasks.replacements, first));
  }
});

test('sparse display, lookup and fingerprints preserve aliases and exact logical JSON', () => {
  const f = data(), resident = f.resident, flat = f.logical;
  assert.deepEqual(projectPlayState(resident), projectPlayState(flat));
  assert.equal(taskReuseInputKey(resident), taskReuseInputKey(flat));
  assert.equal([...identityJSONParts(resident.identityRegistry)].join(''), JSON.stringify(flat.identityRegistry));
  assert.equal(automaticTravelInputKey(resident), automaticTravelInputKey(flat));
  assert.equal(warmResultKey('a'.repeat(64), { type: 'evaluate', state: resident }), warmResultKey('a'.repeat(64), { type: 'evaluate', state: flat }));
  for (const id of [first, second, generated]) assert.deepEqual(buildIdentityIndex(resident.tasks,
    { savedRegistry: resident.identityRegistry, lookupIds: new Set([id]) }).lookup(id), buildIdentityIndex(flat.tasks, { savedRegistry: flat.identityRegistry }).lookup(id));
  const codec = ownedCodec(f.base, f.pin), document = structuredClone(codec.encode(resident));
  document.storage.delta.identityRegistry.aliases.order = Object.keys(flat.identityRegistry.aliases).reverse();
  const reordered = codec.decode(structuredClone(document), { resident: true }).state;
  assert.equal([...identityJSONParts(reordered.identityRegistry.aliases)].join(''), JSON.stringify(Object.fromEntries(Object.entries(flat.identityRegistry.aliases).reverse())));
});

test('migration currency counts the complete flat task array despite a matching digest stamp', () => {
  const f = data(), ids = new Set([first, second]);
  assert.equal(hasCompleteMigrationCatalogue(f.resident, ids), true);
  assert.equal(hasCompleteMigrationCatalogue({ ...f.resident, tasks: f.resident.tasks.filter(task => task.id !== second),
    provenance: { dataset: f.pin.dataset }, storage: ownedCodec(f.base, f.pin).encode(f.resident).storage }, ids), false);
  const deltaOnly = Object.values(ownedCalculatorInput(f.resident).document.storage.delta.tasks.replacements);
  assert.equal(hasCompleteMigrationCatalogue({ ...f.resident, tasks: deltaOnly, provenance: { dataset: f.pin.dataset } }, ids), false);
});

test('process relay installs and reuses the same verified digest transport', async () => {
  const f = data(), input = ownedCalculatorInput(f.resident), worker = new ProcessWorker(workerData, { probeImport: clock });
  try {
    const c = await client(worker);
    const first = await c.send({ type: 'evaluate', stateTransport: OWNED_CALCULATOR_TRANSPORT, ownedDocument: input.document, ownedBase: input.installation });
    const second = await c.send({ type: 'evaluate', stateTransport: OWNED_CALCULATOR_TRANSPORT, ownedDocument: input.document });
    assert.equal(first.at(-1).error, undefined); assert.deepEqual(first.at(-1).result, second.at(-1).result);
    assert.equal(c.installations, 1);
  } finally { await worker.terminate(); }
});
