import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { constants as zlibConstants, crc32, deflateRawSync, gzipSync, gunzipSync } from 'node:zlib';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { projectDuoPlayResult, projectDuoSidebarResult } from '../app/duo-play-view.mjs';
import { projectMapTaskLocations } from '../app/tasks/map-task-locations.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createTaskReuseFingerprint, taskReuseInputKey, createUnlockResultCache } from '../app/tasks/unlock-reuse.mjs';

const state = () => {
  const value = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  value.members[0].unlocked = ['12341']; value.members[0].selected = ['12342'];
  value.members[1].unlocked = ['12343'];
  return value;
};
function shared(value) {
  const bytes = Buffer.from(JSON.stringify(value)), buffer = new SharedArrayBuffer(bytes.length);
  Buffer.from(buffer).set(bytes); return buffer;
}
const reuse = (input = state(), memberId = 'actor1', sourceRevision = 0, marker = 'warm') => ({
  taskInputKey: taskReuseInputKey(input), memberId, sourceRevision, priority: 0,
  playJSON: shared({ format: 'play-v1', tasks: [{ id: marker }] }),
  duoJSON: shared({ tasks: [{ id: marker }], peer: true }),
  duoSidebarJSON: shared({ tasks: [{ id: marker }], projection: 'duo-sidebar-v1' }),
});

test('unlock reuse ignores save and roll bookkeeping while retaining every task input', () => {
  const original = state(), input = taskReuseInputKey(original), copy = structuredClone(original);
  copy.revision++; copy.history = [{ type: 'saved' }]; copy.provenance = { changed: true };
  copy.progressSnapshots = { days: [[1, 2, 3]] };
  copy.taskClaims = { quest: { memberId: 'actor1', at: '2026-10-12T12:00:00Z' } };
  copy.members[0].preferences = { startingChunk: '12342', mapShowTaskCounts: false };
  copy.members[0].journal = 'Plans'; copy.groupGoals = { changed: true }; copy.ruleReviews = { changed: true };
  copy.members[0].selected = []; copy.members[0].pendingRoll = ['12344']; copy.members[0].blacklisted = ['12345'];
  assert.equal(taskReuseInputKey(copy), input);
  const changes = [
    value => value.rules['access.shared'] = false,
    value => value.taskRules = { 'Show Best in Slot Tasks': false },
    value => value.members.reverse(),
    value => value.tasks.push({ id: 'custom:new', category: 'Custom', label: 'new' }),
    value => value.identityRegistry = { entries: { changed: true } },
    value => value.legacy = { maps: { 'synthetic-map': { rules: { changed: true } } } },
  ];
  for (const memberIndex of [0, 1]) for (const [field, changed] of Object.entries({ unlocked: ['12346'],
    completedTasks: ['quest'], taskStatus: { quest: { backlogged: true } }, taskRules: { quests: false },
    taskAlternatives: { Quest: { group: 'quest' } }, teleports: [{ id: 'teleport', chunkId: '12346' }],
    teleportOverrides: { teleport: true }, sourceBacklogs: { objects: { Tree: true } }, sectionOverrides: { '12341-1': false },
    areaOverrides: { cave: true }, primaryOverrides: { Mining: false }, passiveLevels: { Mining: 30 },
    maxLevels: { Mining: 40 }, slayerLock: { level: 10 }, skillProgress: { Mining: { level: 20 } },
    questProgress: { quest: 'completed' }, transportFacts: { changed: true } })) {
    changes.push(value => value.members[memberIndex][field] = changed);
  }
  for (const change of changes) { const value = structuredClone(original); change(value); assert.notEqual(taskReuseInputKey(value), input); }
  const fingerprint = createTaskReuseFingerprint();
  assert.equal(fingerprint(original), input);
  assert.equal(fingerprint({ ...original, revision: 5 }), input);
  original.tasks = [{ id: 'custom:new' }];
  assert.notEqual(fingerprint(original), input, 'Immutable catalogue replacement invalidates its cached digest');
});

test('unlock cache bounds bytes and entries, preserves likely choices and expires stale revisions', () => {
  const original = state(), first = reuse(original), second = reuse(original, 'reed');
  const cache = createUnlockResultCache({ limit: 1, byteLimit: 1000 });
  assert.equal(cache.admit(first, 1), true);
  assert.equal(cache.get(first.taskInputKey, 'actor1', 0), undefined);
  assert.equal(cache.get(first.taskInputKey, 'actor1', 1).memberId, 'actor1');
  assert.equal(cache.get(first.taskInputKey, 'reed', 1), undefined);
  assert.equal(cache.admit(second, 0), false);
  assert.equal(cache.admit(second, 2), true);
  assert.equal(cache.get(first.taskInputKey, 'actor1', 1), undefined);
  assert.equal(cache.get(second.taskInputKey, 'reed', 1).memberId, 'reed');
  assert.ok(cache.getDiagnostics().bytes <= 1000);
  const oversized = new SharedArrayBuffer(2000); Buffer.from(oversized).set(randomBytes(2000));
  assert.equal(cache.admit({ ...first, playJSON: oversized }, 3), false);
  assert.equal(cache.getDiagnostics().entries, 1);
  cache.supersede(2); assert.equal(cache.getDiagnostics().entries, 0); assert.equal(cache.getDiagnostics().bytes, 0);
  cache.admit(first); cache.clear(); assert.equal(cache.getDiagnostics().bytes, 0);
});

test('compressed reuse releases source buffers and inflates exact independent projections on demand', () => {
  const proposal = reuse(), tasks = Array.from({ length: 3000 }, (_, id) => ({ id, label: 'Repeated synthetic task', access: true }));
  proposal.playJSON = shared({ tasks }); proposal.duoJSON = shared({ tasks }); proposal.duoSidebarJSON = shared({ tasks });
  const cache = createUnlockResultCache({ limit: 2, byteLimit: 30000 });
  const original = Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON'].map(key => [key, Buffer.from(proposal[key]).toString()]));
  assert.equal(cache.admit(proposal, 1, 'candidate'), true);
  const diagnostics = cache.getDiagnostics();
  assert.equal(diagnostics.encoding, 'gzip'); assert.equal(diagnostics.compressedBytes, diagnostics.bytes);
  assert.ok(diagnostics.rawBytes > diagnostics.compressedBytes * 5);
  assert.ok(diagnostics.compressedBytes <= diagnostics.byteLimit);
  // Admission snapshots bytes instead of retaining the worker's mutable SAB.
  Buffer.from(proposal.playJSON).fill(0);
  const first = cache.get(proposal.taskInputKey, proposal.memberId, 1);
  for (const [key, value] of Object.entries(original)) { assert(Buffer.isBuffer(first[key])); assert.equal(first[key].toString(), value); }
  first.playJSON.fill(0);
  assert.equal(cache.get(proposal.taskInputKey, proposal.memberId, 1).playJSON.toString(), original.playJSON);
  assert.equal(cache.get(proposal.taskInputKey, proposal.memberId, NaN), undefined);
  cache.clear(); assert.equal(cache.getDiagnostics().rawBytes, 0); assert.equal(cache.getDiagnostics().compressedBytes, 0);
});

test('unfinished gzip object prefixes compose a single gzip member with a small suffix and valid trailer', () => {
  const proposal = reuse(), cache = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  assert.equal(cache.admit(proposal, 1, 'candidate'), true);
  const value = cache.get(proposal.taskInputKey, proposal.memberId, 1);
  let storedPayloadBytes = 0, originalPayloadBytes = 0;
  for (const key of ['playJSON', 'duoJSON', 'duoSidebarJSON']) {
    const prefix = value.gzipJSONPrefixes[key], raw = Buffer.from(proposal[key]);
    const metadata = value.gzipJSONPrefixMetadata[key];
    assert(Buffer.isBuffer(prefix)); assert.deepEqual(gunzipSync(prefix, { finishFlush: zlibConstants.Z_SYNC_FLUSH }), raw.subarray(0, -1));
    assert.throws(() => gunzipSync(prefix), { code: 'Z_BUF_ERROR' }, 'retained stream is unfinished');
    assert.deepEqual(metadata, { crc32: crc32(raw.subarray(0, -1)), rawLength: raw.length - 1 });
    assert.deepEqual(value[key], raw); storedPayloadBytes += prefix.length + 1; originalPayloadBytes += raw.length;
    const suffix = Buffer.from(',"revision":1,"cache":{"unlockPredictionHit":true,"label":"Player ☃"}}');
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(crc32(suffix, metadata.crc32), 0); trailer.writeUInt32LE((metadata.rawLength + suffix.length) >>> 0, 4);
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.concat([prefix, deflateRawSync(suffix, { level: 1 }), trailer]))), {
      ...JSON.parse(raw), revision: 1, cache: { unlockPredictionHit: true, label: 'Player ☃' },
    });
  }
  const metadataBytes = Buffer.byteLength(JSON.stringify([proposal.taskInputKey, proposal.memberId, proposal.sourceRevision, 'candidate']));
  const gzipMetadataBytes = Buffer.byteLength(JSON.stringify(value.gzipJSONPrefixMetadata));
  assert.equal(cache.getDiagnostics().bytes, storedPayloadBytes + metadataBytes + gzipMetadataBytes, 'quota counts prefixes, final bytes and stream metadata');
  assert.equal(cache.getDiagnostics().rawBytes, originalPayloadBytes + metadataBytes);
  value.gzipJSONPrefixes.playJSON.fill(0);
  assert.deepEqual(cache.get(proposal.taskInputKey, proposal.memberId, 1).playJSON, Buffer.from(proposal.playJSON));
  assert.deepEqual(gunzipSync(cache.get(proposal.taskInputKey, proposal.memberId, 1).gzipJSONPrefixes.playJSON,
    { finishFlush: zlibConstants.Z_SYNC_FLUSH }), Buffer.from(proposal.playJSON).subarray(0, -1));
  value.gzipJSONPrefixMetadata.playJSON.crc32 = 0;
  assert.equal(cache.get(proposal.taskInputKey, proposal.memberId, 1).gzipJSONPrefixMetadata.playJSON.crc32, crc32(Buffer.from(proposal.playJSON).subarray(0, -1)));
  const mixed = { ...proposal, duoJSON: shared(['synthetic array']), duoSidebarJSON: new SharedArrayBuffer(0) };
  assert.equal(cache.admit(mixed, 1, 'candidate'), true);
  const arbitrary = cache.get(proposal.taskInputKey, proposal.memberId, 1);
  assert.equal(arbitrary.gzipJSONPrefixes.duoJSON, undefined); assert.equal(arbitrary.gzipJSONPrefixes.duoSidebarJSON, undefined);
  assert.deepEqual(arbitrary.duoJSON, Buffer.from(mixed.duoJSON)); assert.deepEqual(arbitrary.duoSidebarJSON, Buffer.alloc(0));
});

test('worker-compressed prefix admission copies bytes and get inflates only requested projections', () => {
  const proposal = reuse(), keys = ['playJSON', 'duoJSON', 'duoSidebarJSON'];
  const sharedBytes = bytes => { const buffer = new SharedArrayBuffer(bytes.length); Buffer.from(buffer).set(bytes); return buffer; };
  const encoded = Object.fromEntries(keys.map(key => [key, gzipSync(Buffer.from(proposal[key]).subarray(0, -1), { level: 9, finishFlush: zlibConstants.Z_SYNC_FLUSH })]));
  proposal.gzipJSONPrefixMetadata = Object.fromEntries(keys.map(key => [key, {
    crc32: crc32(Buffer.from(proposal[key]).subarray(0, -1)), rawLength: proposal[key].byteLength - 1,
  }]));
  proposal.gzipJSONPrefixes = Object.fromEntries(keys.map(key => [key, sharedBytes(encoded[key])]));
  const cache = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  assert.equal(cache.admit(proposal, 1), true);
  const retained = cache.get(proposal.taskInputKey, proposal.memberId, 1);
  for (const key of keys) {
    assert.equal(typeof Object.getOwnPropertyDescriptor(retained, key).get, 'function');
    assert.deepEqual(retained.gzipJSONPrefixes[key], encoded[key], 'admission uses worker encoding unchanged');
    Buffer.from(proposal.gzipJSONPrefixes[key]).fill(0);
    assert.deepEqual(retained[key], Buffer.from(proposal[key]), 'retention owns the compressed copy');
    assert.equal(retained[key], retained[key], 'a projection is inflated once per get result');
  }
  assert.notEqual(cache.get(proposal.taskInputKey, proposal.memberId, 1).playJSON, retained.playJSON);
  const metadataBytes = Buffer.byteLength(JSON.stringify([proposal.taskInputKey, proposal.memberId, proposal.sourceRevision]));
  assert.equal(cache.getDiagnostics().compressedBytes, metadataBytes + Buffer.byteLength(JSON.stringify(proposal.gzipJSONPrefixMetadata))
    + keys.reduce((sum, key) => sum + encoded[key].length + 1, 0));
  for (const prefixes of [{ playJSON: Buffer.from('not shared') }, { playJSON: new SharedArrayBuffer(0) }, { unknown: sharedBytes(encoded.playJSON) }]) {
    assert.equal(cache.admit({ ...proposal, gzipJSONPrefixes: prefixes }, 3), false);
  }
  assert.equal(cache.admit({ ...proposal, duoJSON: shared([]), gzipJSONPrefixes: { duoJSON: sharedBytes(encoded.duoJSON) } }, 3), false,
    'prefix composition requires the original final object brace');
  for (const metadata of [{ playJSON: { crc32: -1, rawLength: proposal.playJSON.byteLength - 1 } },
    { playJSON: { crc32: 0, rawLength: 99999 } }, { unknown: { crc32: 0, rawLength: 0 } }]) {
    assert.equal(cache.admit({ ...proposal, gzipJSONPrefixMetadata: metadata }, 3), false);
  }
  // Worker bytes are trusted compressed output: validation does not inflate
  // unrelated projections in the HTTP thread, even if one is corrupt.
  const lazy = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  assert.equal(lazy.admit({ ...proposal, gzipJSONPrefixes: { playJSON: sharedBytes(encoded.playJSON), duoJSON: sharedBytes(Buffer.from('invalid gzip')) },
    gzipJSONPrefixMetadata: { playJSON: proposal.gzipJSONPrefixMetadata.playJSON } }), true);
  const pending = lazy.get(proposal.taskInputKey, proposal.memberId, 1);
  assert.deepEqual(pending.playJSON, Buffer.from(proposal.playJSON));
  assert.throws(() => pending.duoJSON, { code: 'Z_DATA_ERROR' });
  const legacy = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  const closed = Object.fromEntries(keys.map(key => [key, sharedBytes(gzipSync(Buffer.from(proposal[key]).subarray(0, -1), { level: 1 }))]));
  assert.equal(legacy.admit({ ...proposal, gzipJSONPrefixes: closed, gzipJSONPrefixMetadata: undefined }), true);
  const old = legacy.get(proposal.taskInputKey, proposal.memberId, 1);
  assert.equal(old.gzipJSONPrefixMetadata, undefined, 'legacy closed prefixes are not eligible for unfinished-stream suffix composition');
  for (const key of keys) assert.deepEqual(old[key], Buffer.from(proposal[key]));
});

test('candidate pairs admit atomically, evict together and touch every member of their prediction origin', () => {
  const pair = chunk => {
    const input = state(); input.members[0].unlocked.push(chunk);
    return [reuse(input, 'actor1', 0, chunk), reuse(input, 'reed', 0, chunk)];
  };
  const a = pair('12344'), b = pair('12345'), c = pair('12346');
  const retained = (cache, proposal) => !!cache.get(proposal.taskInputKey, proposal.memberId, 1);
  const cache = createUnlockResultCache({ limit: 4, byteLimit: 10000 });
  assert.equal(cache.admitMany(a, 1, 'a'), true); assert.equal(cache.admitMany(b, 1, 'b'), true);
  const bytes = cache.getDiagnostics().bytes;
  assert.equal(cache.touchPrediction('a'), true); assert.equal(cache.getDiagnostics().bytes, bytes);
  assert.equal(cache.admitMany(c, 2, 'c'), true);
  assert.ok(a.every(entry => retained(cache, entry)), 'cached Preview protects both owners');
  assert.ok(b.every(entry => !retained(cache, entry)), 'eviction releases the complete lower-priority pair');
  assert.ok(c.every(entry => retained(cache, entry)));
  const stable = createUnlockResultCache({ limit: 3, byteLimit: 10000 });
  assert.equal(stable.admitMany(a, 0, 'a'), true);
  assert.equal(stable.admitMany(b, 0, 'b'), false);
  assert.equal(stable.getDiagnostics().entries, 2, 'failed pair admission retains neither newcomer');
  assert.ok(a.every(entry => retained(stable, entry))); assert.ok(b.every(entry => !retained(stable, entry)));
});

test('finishing a candidate pair replaces its intermediate result and prioritizes prepared pairs over unrelated halves', () => {
  const a = reuse(), peer = reuse(state(), 'reed'), changed = state(); changed.members[0].unlocked.push('12344');
  const other = reuse(changed), cache = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  assert.equal(cache.admit(a, 0, 'a'), true); assert.equal(cache.admit(other, 0, 'other'), true);
  assert.equal(cache.admitMany([a, peer], 0, 'a'), true);
  assert.equal(cache.getDiagnostics().entries, 2);
  assert.equal(cache.get(other.taskInputKey, other.memberId, 1), undefined);
  assert.ok(cache.get(a.taskInputKey, a.memberId, 1)); assert.ok(cache.get(peer.taskInputKey, peer.memberId, 1));
  const before = cache.getDiagnostics(), oversized = new SharedArrayBuffer(20000); Buffer.from(oversized).set(randomBytes(20000));
  assert.equal(cache.admitMany([{ ...a, playJSON: oversized }, peer], 3, 'a'), false);
  assert.equal(cache.getDiagnostics().bytes, before.bytes);
  assert.deepEqual(cache.get(a.taskInputKey, a.memberId, 1).playJSON, Buffer.from(a.playJSON), 'failed replacement preserves exact previous bytes');
  assert.equal(cache.admitMany([a, { ...peer, sourceRevision: -1 }], 3, 'bad'), false);
  assert.equal(cache.admitMany([a, a], 3, 'duplicate'), false);
  cache.supersede(2); assert.equal(cache.getDiagnostics().entries, 0); assert.equal(cache.getDiagnostics().rawBytes, 0);
  const interested = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  interested.admit(a, 0, 'a'); interested.touchPrediction('a'); interested.admit(other, 2, 'other');
  assert.equal(interested.admitMany([a, peer], 0, 'a'), true, 'partner completion inherits the explicit interest in intermediate bytes');
  assert.ok(interested.get(peer.taskInputKey, peer.memberId, 1));
  assert.equal(interested.get(other.taskInputKey, other.memberId, 1), undefined);
});

test('prediction completeness requires every requested member under one origin, signature and source revision', () => {
  const own = reuse(), peer = reuse(state(), 'reed'), changed = state(); changed.members[0].unlocked.push('12344');
  const cache = createUnlockResultCache({ limit: 6, byteLimit: 10000 });
  cache.admit(own, 1, 'origin');
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed'], 0), false);
  cache.admit(reuse(changed, 'reed'), 1, 'origin');
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed'], 0), false, 'different hypothetical signatures cannot form a pair');
  cache.admit(peer, 1, 'other');
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed'], 0), false, 'an unrelated origin cannot complete the pair');
  cache.admit({ ...peer, sourceRevision: 1 }, 1, 'origin');
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed']), false, 'different source revisions cannot form a pair');
  cache.admit(peer, 1, 'origin');
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed'], 0), true);
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'reed'], 1), false);
  assert.equal(cache.hasCompletePrediction('origin', ['actor1', 'unknown'], 0), false);
  assert.equal(cache.getDiagnostics().hits, 0, 'completeness never fetches or inflates projections');
});

test('recent explicit previews replace oldest explicit bytes while equal bulk choices stay stable', () => {
  const proposals = ['12342', '12344', '12345', '12346'].map(chunk => {
    const input = state(); input.members[0].unlocked.push(chunk); return reuse(input, 'actor1', 0, chunk);
  });
  const retained = (cache, proposal) => !!cache.get(proposal.taskInputKey, 'actor1', 1);
  const cache = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  cache.admit(proposals[0], 3, 'a'); cache.admit(proposals[1], 3, 'b');
  assert.equal(cache.admit(proposals[2], 3, 'c'), true);
  assert.equal(retained(cache, proposals[0]), false);
  assert(retained(cache, proposals[1])); assert(retained(cache, proposals[2]));
  const bytes = cache.getDiagnostics().bytes;
  assert.equal(cache.touchPrediction('b'), true); assert.equal(cache.getDiagnostics().bytes, bytes);
  assert.equal(cache.admit(proposals[3], 3, 'd'), true);
  assert(retained(cache, proposals[1])); assert(retained(cache, proposals[3]));
  assert.equal(retained(cache, proposals[2]), false);
  assert.equal(cache.touchPrediction('missing'), false); assert.equal(cache.touchPrediction(undefined), false);
  for (const priority of [0, 1, 2]) {
    const bulk = createUnlockResultCache({ limit: 1, byteLimit: 10000 });
    bulk.admit(proposals[0], priority, 'early');
    assert.equal(bulk.admit(proposals[1], priority, 'later'), false);
    assert(retained(bulk, proposals[0])); assert.equal(retained(bulk, proposals[1]), false);
  }
  const mixed = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  mixed.admit(proposals[0], 3, 'explicit'); mixed.admit(proposals[1], 0, 'bulk');
  mixed.admit(proposals[2], 3, 'new explicit');
  assert(retained(mixed, proposals[0]), 'lower priority is evicted before an older explicit preview');
  assert.equal(retained(mixed, proposals[1]), false); assert(retained(mixed, proposals[2]));
});

test('prediction origin metadata is byte-bounded, retained on replacement and cleared with projections', () => {
  const proposal = reuse(), plain = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  plain.admit(proposal, 1);
  const origin = 'preview ☃ "key"', keyed = createUnlockResultCache({ limit: 2, byteLimit: 10000 });
  keyed.admit(proposal, 1, origin);
  assert.equal(keyed.getDiagnostics().bytes - plain.getDiagnostics().bytes, Buffer.byteLength(JSON.stringify(origin)) + 1);
  const bytes = keyed.getDiagnostics().bytes;
  assert.equal(keyed.touchPrediction(origin), true);
  keyed.admit(proposal, 0);
  assert.equal(keyed.getDiagnostics().bytes, bytes); assert.equal(keyed.touchPrediction(origin), true);
  const tight = createUnlockResultCache({ limit: 2, byteLimit: plain.getDiagnostics().bytes });
  assert.equal(tight.admit(proposal, 3, origin), false); assert.equal(tight.getDiagnostics().bytes, 0);
  assert.equal(tight.touchPrediction(origin), false);
  keyed.supersede(2); assert.equal(keyed.touchPrediction(origin), false); assert.equal(keyed.getDiagnostics().bytes, 0);
  keyed.admit(proposal, 1, origin); keyed.clear(); assert.equal(keyed.touchPrediction(origin), false);
});

function fakeFactory() {
  const workers = [];
  const create = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message); worker.terminate = async () => {};
    worker.requests = () => worker.messages.filter(message => message.id && message.type !== 'cancel');
    worker.finish = fields => worker.emit('message', { id: worker.requests().at(-1).id, result: { delta: {} }, evaluationMs: 1, ...fields });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  return { create, workers };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('claim and display saves retain completed and in-flight prediction pairs through the next unlock', async t => {
  for (const phase of ['completed', 'in-flight']) await t.test(phase, async sub => {
    const foreground = fakeFactory(), prediction = fakeFactory();
    const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
    sub.after(() => scheduler.close());
    const before = state(), display = structuredClone(before), after = structuredClone(before);
    display.revision = 2; display.taskClaims = { quest: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
    display.members[0].preferences = { mapShowTaskCounts: false };
    after.revision = 3; after.members[0].unlocked.push('12342');
    after.taskClaims = display.taskClaims; after.members[0].preferences = display.members[0].preferences;
    const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'same');
    await nextTurn();
    const producer = prediction.workers[0];
    const finish = () => producer.finish({ unlockReuse: reuse(after), partnerUnlockReuse: reuse(after, 'reed', 0, 'peer') });
    if (phase === 'completed') { finish(); await preview; }
    const sent = producer.messages.length;
    scheduler.supersedeDisplay(1, 'same'); scheduler.supersedeDisplay(2, 'same');
    assert.equal(producer.messages.length, sent, 'display saves send no calculator control work');
    const currentPreview = scheduler.evaluate(display, 'actor1', 'predict', '12342', 'preview-current', 'same');
    if (phase === 'in-flight') finish();
    await preview; assert.equal((await currentPreview).hit, true);
    assert.equal(producer.requests().length, 1, 'display revision reuses the same prediction');
    assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
    scheduler.setRevision(3, 'unlocked');
    for (const memberId of ['actor1', 'reed']) {
      const hit = scheduler.preparedEvaluation(taskReuseInputKey(after), memberId, 3);
      assert.equal(hit?.resultCache.unlockPredictionHit, true, memberId);
    }
    assert.equal(foreground.workers[0].requests().length, 0);
    scheduler.setRevision(4, 'another-task-change');
    assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0, 'next incompatible save expires the pair');
  });
});

test('display revisions preserve an active saved owner and partner race without calculator messages', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory(), duo = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, duoWorkerFactory: duo.create });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before);
  after.revision = 3; after.members[0].unlocked.push('12342');
  const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'same');
  const obsolete = assert.rejects(preview, { status: 409 }); await nextTurn();
  const producer = prediction.workers[0];
  scheduler.supersedeDisplay(1, 'same'); scheduler.supersedeDisplay(2, 'same');
  const own = scheduler.evaluate(after, 'actor1', 'evaluate', undefined, 'saved', 'after', undefined, [], 'play-v1');
  await obsolete;
  producer.finish({ type: 'prediction-prepared', unlockReuse: reuse(after) });
  assert.equal((await own).resultCache.unlockPredictionHit, true);
  const sent = producer.messages.length;
  scheduler.supersedeDisplay(4, 'after'); after.revision = 4;
  assert.equal(producer.messages.length, sent);
  assert.equal(scheduler.preparedEvaluation(taskReuseInputKey(after), 'actor1', 4)?.resultCache.unlockPredictionHit, true);
  const peer = scheduler.evaluate(after, 'reed', 'evaluate', undefined, 'peer', 'after', undefined, [], 'play-v1', undefined, 'duo');
  await nextTurn();
  producer.finish({ unlockReuse: reuse(after), partnerUnlockReuse: reuse(after, 'reed', 0, 'peer') });
  assert.deepEqual((await peer).result.tasks, [{ id: 'peer' }]);
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  scheduler.setRevision(5, 'changed');
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0);
});

test('explicit cached Preview promotes prewarmed projection without calculation or replacing it with bulk', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create,
    predictionCacheLimit: 2, predictionCacheBytes: 10000 });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1;
  after.members[0].unlocked.push('12342'); after.members[0].selected = [];
  scheduler.prewarm(before, 'before', [{ memberId: 'actor1', chunkIds: ['12342'] }]);
  await nextTurn(); await nextTurn();
  prediction.workers[0].finish({ unlockReuse: { ...reuse(after), priority: 1 }, partnerUnlockReuse: { ...reuse(after, 'reed'), priority: 1 } });
  const cached = await scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
  assert.equal(cached.hit, true);
  assert.equal(prediction.workers[0].requests().length, 1, 'cached explicit Preview starts no worker calculation');
  const other = structuredClone(before); other.members[0].unlocked.push('12344'); other.revision = 1;
  scheduler.prewarm(before, 'before', [{ memberId: 'actor1', chunkIds: ['12344'] }]);
  await nextTurn(); await nextTurn();
  prediction.workers[0].finish({ unlockReuse: { ...reuse(other, 'actor1', 0, 'other'), priority: 2 },
    partnerUnlockReuse: { ...reuse(other, 'reed', 0, 'other peer'), priority: 2 } });
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  const calculated = scheduler.evaluate(after, 'actor1', 'evaluate', undefined, 'after', 'after', undefined, [], 'play-v1');
  const result = await calculated;
  assert.equal(result.resultCache.unlockPredictionHit, true);
  assert.deepEqual(result.result.tasks, [{ id: 'warm' }]);
  const peer = await scheduler.evaluate(after, 'reed', 'evaluate', undefined, 'peer-after', 'after', undefined, [], 'play-v1');
  assert.equal(peer.resultCache.unlockPredictionHit, true, 'cached explicit Preview promotes the complete pair');
  assert.equal(foreground.workers[0].requests().length, 0);
});

test('explicit Preview rebuilds a missing peer or evicted pair while active work still coalesces', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create,
    predictionCacheLimit: 2, predictionCacheBytes: 10000 });
  t.after(() => scheduler.close());
  const before = state(), hypothetical = chunk => {
    const after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push(chunk); return after;
  };
  const a = hypothetical('12342'), b = hypothetical('12344');
  const preview = chunk => scheduler.evaluate(before, 'actor1', 'predict', chunk, `preview:${chunk}`, 'before');
  const first = preview('12342'); await nextTurn();
  const producer = prediction.workers[0]; producer.finish({ unlockReuse: reuse(a) }); await first;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 1);
  const missingPeer = preview('12342');
  assert.equal(producer.requests().length, 2, 'cached delta cannot substitute for a missing partner result');
  producer.finish({ unlockReuse: reuse(a), partnerUnlockReuse: reuse(a, 'reed') }); assert.equal((await missingPeer).hit, false);
  assert.equal((await preview('12342')).hit, true); assert.equal(producer.requests().length, 2, 'complete retained pair keeps cached Preview fast');
  const other = preview('12344'); producer.finish({ unlockReuse: reuse(b), partnerUnlockReuse: reuse(b, 'reed') }); await other;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 2, 'delta cache retains both candidate responses');
  const evicted = preview('12342');
  assert.equal(producer.requests().length, 4, 'a cached delta whose pair was evicted reruns the prediction');
  producer.finish({ type: 'prediction-prepared', unlockReuse: reuse(a) });
  const coalesced = preview('12342');
  assert.equal(producer.requests().length, 4, 'active owner-only publication keeps the same pending calculation');
  producer.finish({ unlockReuse: reuse(a), partnerUnlockReuse: reuse(a, 'reed') });
  assert.equal((await evicted).hit, false); assert.equal((await coalesced).hit, true);
  assert.equal((await preview('12342')).hit, true); assert.equal(producer.requests().length, 4);
  const owned = preview('12341'); producer.finish(); await owned;
  assert.equal((await preview('12341')).hit, true, 'owned chunks need no hypothetical reusable pair');
  assert.equal(producer.requests().length, 5); assert.equal(foreground.workers[0].requests().length, 0);
});
async function savedRace(t, options = {}) {
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, ...options });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1;
  after.members[0].unlocked.push('12342'); after.members[0].selected = [];
  const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
  const previewRejected = assert.rejects(preview, { status: 409 });
  await nextTurn();
  return { scheduler, foreground, prediction, before, after, previewRejected,
    calculate(signal) { return scheduler.evaluate(after, 'actor1', 'evaluate', undefined, 'after', 'after', signal, [], 'play-v1', undefined, 'foreground', true); },
    finishForeground(marker = 'fresh') { foreground.workers.at(-1).finish({ playJSON: shared({ format: 'play-v1', tasks: [{ id: marker }] }) }); },
    finishPrediction(value = reuse(after)) { prediction.workers[0].finish({ unlockReuse: value }); },
  };
}

test('final prediction pair reuses each owner and compact duo/sidebar bytes across a saved map switch', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory(), duo = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, duoWorkerFactory: duo.create });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
  const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before'); await nextTurn();
  const own = reuse(after, 'actor1', 0, 'own'), peer = reuse(after, 'reed', 0, 'peer');
  prediction.workers[0].finish({ unlockReuse: own, partnerUnlockReuse: peer }); await preview;
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  assert.equal(scheduler.getDiagnostics().unlockReuse.encoding, 'gzip');
  for (const [proposal, lane] of [[own, 'foreground'], [peer, 'duo'], [peer, 'foreground']]) {
    const result = await scheduler.evaluate(after, proposal.memberId, 'evaluate', undefined, `${proposal.memberId}:${lane}`, 'after',
      undefined, [], 'play-v1', undefined, lane, lane === 'foreground');
    assert.equal(result.resultCache.unlockPredictionHit, true);
    assert.deepEqual(result.result.tasks, JSON.parse(Buffer.from(proposal.playJSON)).tasks);
    assert.deepEqual(Buffer.from(result.duoJSON), Buffer.from(proposal.duoJSON));
    assert.deepEqual(Buffer.from(result.duoSidebarJSON), Buffer.from(proposal.duoSidebarJSON));
  }
  assert.equal(foreground.workers[0].requests().length, 0); assert.equal(duo.workers.length, 0);
});

test('prepared lookup skips unnecessary fingerprints and returns exact lazy owner/peer bytes while foreground sleeps', async t => {
  let now = 0, sequence = 0, fingerprints = 0;
  const timers = new Map(), idleClock = { now: () => now,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const foreground = fakeFactory(), prediction = fakeFactory(), duo = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create,
    duoWorkerFactory: duo.create, idleMs: 40, idleClock });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
  const key = taskReuseInputKey(after), fingerprint = () => { fingerprints++; return key; };
  scheduler.supersede(0, 'before');
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'actor1', 0), undefined);
  assert.equal(fingerprints, 0, 'empty retention avoids hashing the captured state');
  const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before'); await nextTurn();
  const own = reuse(after, 'actor1', 0, 'own'), peer = reuse(after, 'reed', 0, 'peer');
  prediction.workers[0].finish({ unlockReuse: own, partnerUnlockReuse: peer }); await preview;
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'actor1', 0), undefined, 'source revision cannot use its future hypothetical result');
  assert.equal(fingerprints, 1);
  scheduler.supersede(1, 'after');
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'actor1', 0), undefined);
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'reed', 2), undefined);
  assert.equal(fingerprints, 1, 'revision guard runs before a lazy fingerprint');
  now = 20; scheduler.resumePrewarm(); // Keep prediction bytes while foreground reaches its idle deadline.
  now = 41;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  await nextTurn();
  assert.equal(scheduler.getHealth().status, 'sleeping'); assert.equal(scheduler.getHealth().prediction.status, 'ready');
  for (const [proposal, input] of [[own, fingerprint], [peer, key]]) {
    const result = scheduler.preparedEvaluation(input, proposal.memberId, 1);
    assert.equal(result.hit, true); assert.equal(result.resultCache.unlockPredictionHit, true);
    for (const projection of ['playJSON', 'duoJSON', 'duoSidebarJSON']) {
      assert.equal(typeof Object.getOwnPropertyDescriptor(result, projection).get, 'function', 'prepared lookup preserves lazy bytes');
      assert.deepEqual(gunzipSync(result.gzipJSONPrefixes[projection], { finishFlush: zlibConstants.Z_SYNC_FLUSH }), Buffer.from(proposal[projection]).subarray(0, -1));
      assert.equal(result.gzipJSONPrefixMetadata[projection].rawLength, proposal[projection].byteLength - 1);
      assert.deepEqual(result[projection], Buffer.from(proposal[projection]));
    }
    assert.deepEqual(result.result.tasks, JSON.parse(Buffer.from(proposal.playJSON)).tasks);
  }
  assert.equal(fingerprints, 2);
  const changed = structuredClone(after); changed.members[1].unlocked.push('12344');
  assert.equal(scheduler.preparedEvaluation(taskReuseInputKey(changed), 'reed', 1), undefined, 'exact task signature is required');
  assert.equal(scheduler.preparedEvaluation(key, 'unknown member', 1), undefined);
  assert.equal(foreground.workers.length, 1); assert.equal(foreground.workers[0].requests().length, 0);
  assert.equal(duo.workers.length, 0); assert.equal(scheduler.getHealth().status, 'sleeping', 'prepared hits do not wake a worker');
  scheduler.supersede(2, 'newer');
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'reed', 2), undefined);
  assert.equal(fingerprints, 2, 'expired cache avoids hashing even at the current revision');
  await scheduler.close();
  assert.equal(scheduler.preparedEvaluation(fingerprint, 'reed', 2), undefined); assert.equal(fingerprints, 2);
});

test('active saved prediction publishes own result first and keeps the peer race pending until its final result', async t => {
  const duo = fakeFactory(), race = await savedRace(t, { duoWorkerFactory: duo.create }), own = race.calculate();
  const peer = race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'peer-after', 'after', undefined, [], 'play-v1', undefined, 'duo');
  let peerSettled = false; peer.then(() => { peerSettled = true; });
  await race.previewRejected; await nextTurn();
  assert.equal(race.prediction.workers[0].requests()[0].predictionProgress, true);
  const ownReuse = reuse(race.after, 'actor1', 0, 'own'), peerReuse = reuse(race.after, 'reed', 0, 'peer');
  race.prediction.workers[0].finish({ type: 'prediction-prepared', unlockReuse: ownReuse });
  const ownResult = await own;
  assert.equal(ownResult.resultCache.unlockPredictionHit, true); assert.deepEqual(ownResult.result.tasks, [{ id: 'own' }]);
  assert.equal(ownResult.gzipJSONPrefixMetadata.playJSON.rawLength, ownReuse.playJSON.byteLength - 1);
  await nextTurn(); assert.equal(peerSettled, false, 'owner publication cannot substitute for partner obligations');
  assert.equal(race.scheduler.getDiagnostics().predictionLane.queue.active, 1);
  race.prediction.workers[0].finish({ unlockReuse: ownReuse, partnerUnlockReuse: peerReuse });
  const peerResult = await peer;
  assert.equal(peerResult.resultCache.unlockPredictionHit, true); assert.deepEqual(peerResult.result.tasks, [{ id: 'peer' }]);
  assert.equal(peerResult.gzipJSONPrefixMetadata.playJSON.rawLength, peerReuse.playJSON.byteLength - 1);
  assert.deepEqual(Buffer.from(peerResult.duoSidebarJSON), Buffer.from(peerReuse.duoSidebarJSON));
  assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 2);
  assert.ok(duo.workers[0].messages.some(message => message.type === 'cancel'));
  race.finishForeground('late'); duo.workers[0].finish({ playJSON: shared({ tasks: [{ id: 'late peer' }] }) }); await nextTurn();
  const switched = await race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'switched', 'after', undefined, [], 'play-v1');
  assert.deepEqual(switched.result.tasks, [{ id: 'peer' }], 'late ordinary result cannot overwrite reusable partner bytes');
});

test('saved partner map and progress mismatches reject predicted peer bytes and keep fresh duo calculation', async t => {
  for (const [name, change] of [
    ['map', value => value.members[1].unlocked.push('12344')],
    ['progress', value => value.members[1].skillProgress = { Mining: { level: 30, xp: 13363 } }],
  ]) await t.test(name, async sub => {
    const duo = fakeFactory(), race = await savedRace(sub, { duoWorkerFactory: duo.create }), predicted = structuredClone(race.after);
    change(race.after);
    const peer = race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'changed-peer', 'after', undefined, [], 'play-v1', undefined, 'duo');
    let settled = false; peer.then(() => { settled = true; }); await race.previewRejected; await nextTurn();
    race.prediction.workers[0].finish({ unlockReuse: reuse(predicted), partnerUnlockReuse: reuse(predicted, 'reed', 0, 'stale peer') });
    await nextTurn(); assert.equal(settled, false, 'task input signature must include partner maps and personal progress');
    duo.workers[0].finish({ playJSON: shared({ tasks: [{ id: 'fresh peer' }] }), duoJSON: shared({ tasks: [{ id: 'fresh peer' }] }) });
    const result = await peer; assert.deepEqual(result.result.tasks, [{ id: 'fresh peer' }]);
    assert.equal(result.resultCache?.unlockPredictionHit, undefined);
  });
});

test('preserved raw prediction wins only saved compact requests while obsolete Preview rejects 409', async t => {
  const race = await savedRace(t), calculated = race.calculate();
  await race.previewRejected;
  assert.equal(race.foreground.workers[0].requests().length, 1, 'fresh calculation starts without waiting for prediction');
  race.finishPrediction();
  const result = await calculated;
  assert.equal(result.hit, true); assert.equal(result.resultCache.unlockPredictionHit, true);
  assert.deepEqual(result.result.tasks, [{ id: 'warm' }]);
  assert.equal(JSON.parse(result.duoJSON).peer, true);
  assert.equal(JSON.parse(result.duoSidebarJSON).projection, 'duo-sidebar-v1');
  assert(race.foreground.workers[0].messages.some(message => message.type === 'cancel'), 'only losing ordinary waiter is cancelled');
  race.finishForeground('late');
  const cached = await race.calculate();
  assert.deepEqual(cached.result.tasks, [{ id: 'warm' }], 'late abandoned full result never replaces the winning projection');
  assert.equal(race.scheduler.getDiagnostics().predictionLane.cache.entries, 0, 'obsolete Preview delta never enters prediction cache');
});

test('fresh foreground result wins immediately without waiting for preserved prediction', async t => {
  const race = await savedRace(t), calculated = race.calculate();
  await race.previewRejected;
  race.finishForeground();
  const result = await calculated;
  assert.deepEqual(result.result.tasks, [{ id: 'fresh' }]);
  assert.equal(result.resultCache?.unlockPredictionHit, undefined);
  assert.equal(Atomics.load(new Int32Array(race.prediction.workers[0].requests()[0].cancellation), 0), 1,
    'the last losing follower cancels its detached producer');
  assert.equal(race.scheduler.getDiagnostics().predictionLane.queue.active, 1);
  race.finishPrediction(); await nextTurn();
  assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0, 'losing prediction has no detached saved waiter or cache admission');
});

test('mismatched partial owner bytes cannot keep an obsolete partner calculation after fresh tasks win', async t => {
  for (const publication of ['before save', 'after saved request']) await t.test(publication, async sub => {
    const race = await savedRace(sub), producer = race.prediction.workers[0];
    const wrong = structuredClone(race.after); wrong.members[0].unlocked.push('12344');
    const partial = { type: 'prediction-prepared', unlockReuse: reuse(wrong) };
    if (publication === 'before save') producer.finish(partial);
    const calculated = race.calculate(); await race.previewRejected;
    if (publication === 'after saved request') producer.finish(partial);
    await nextTurn();
    const retained = race.scheduler.getDiagnostics().unlockReuse.entries;
    race.finishForeground();
    const result = await calculated;
    assert.deepEqual(result.result.tasks, [{ id: 'fresh' }]);
    assert.equal(result.resultCache?.unlockPredictionHit, undefined);
    assert.equal(Atomics.load(new Int32Array(producer.requests()[0].cancellation), 0), 1,
      'resolved partial followers still release their unconfirmed obsolete producer');
    assert.ok(producer.messages.some(message => message.type === 'cancel'));
    producer.finish({ unlockReuse: reuse(wrong), partnerUnlockReuse: reuse(wrong, 'reed') }); await nextTurn();
    assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, retained, 'late mismatched partner bytes are discarded');
    assert.equal(race.scheduler.preparedEvaluation(taskReuseInputKey(race.after), 'actor1', race.after.revision), undefined);
  });
});

test('a remaining peer follower preserves the producer and confirmed owner reuse admits its late partner', async t => {
  const duo = fakeFactory(), race = await savedRace(t, { duoWorkerFactory: duo.create }), own = race.calculate();
  const peer = race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'peer-after', 'after', undefined, [], 'play-v1', undefined, 'duo');
  await race.previewRejected; await nextTurn(); race.finishForeground('fresh'); await own;
  const producer = race.prediction.workers[0], cancellation = new Int32Array(producer.requests()[0].cancellation);
  assert.equal(Atomics.load(cancellation, 0), 0, 'a remaining saved peer still needs the prediction');
  producer.finish({ unlockReuse: reuse(race.after), partnerUnlockReuse: reuse(race.after, 'reed', 0, 'peer') });
  assert.equal((await peer).resultCache.unlockPredictionHit, true);
  const confirmed = await savedRace(t), selected = confirmed.calculate(); await confirmed.previewRejected;
  const owner = reuse(confirmed.after), partner = reuse(confirmed.after, 'reed', 0, 'late peer');
  confirmed.prediction.workers[0].finish({ type: 'prediction-prepared', unlockReuse: owner });
  assert.equal((await selected).resultCache.unlockPredictionHit, true);
  assert.equal(Atomics.load(new Int32Array(confirmed.prediction.workers[0].requests()[0].cancellation), 0), 0);
  confirmed.prediction.workers[0].finish({ unlockReuse: owner, partnerUnlockReuse: partner }); await nextTurn();
  assert.equal(confirmed.scheduler.getDiagnostics().unlockReuse.entries, 2, 'validated saved owner interest preserves useful partner preparation');
  const switched = await confirmed.scheduler.evaluate(confirmed.after, 'reed', 'evaluate', undefined, 'switched', 'after', undefined, [], 'play-v1');
  assert.deepEqual(switched.result.tasks, [{ id: 'late peer' }]);
});

test('exact intermediate owner cache hits confirm partner preparation through both lookup APIs', async t => {
  for (const api of ['preparedEvaluation', 'evaluate']) await t.test(api, async sub => {
    const foreground = fakeFactory(), prediction = fakeFactory();
    const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
    sub.after(() => scheduler.close());
    const before = state(), after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
    const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
    const rejected = assert.rejects(preview, { status: 409 }); await nextTurn();
    const producer = prediction.workers[0], own = reuse(after), peer = reuse(after, 'reed', 0, 'late peer');
    producer.finish({ type: 'prediction-prepared', unlockReuse: own });
    scheduler.supersede(1, 'after'); await rejected;
    const hit = api === 'preparedEvaluation' ? scheduler.preparedEvaluation(taskReuseInputKey(after), 'actor1', 1)
      : await scheduler.evaluate(after, 'actor1', 'evaluate', undefined, 'saved', 'after', undefined, [], 'play-v1');
    assert.equal(hit.resultCache.unlockPredictionHit, true);
    assert.equal(foreground.workers[0].requests().length, 0, 'owner cache hit requires no ordinary calculation');
    assert.equal(Atomics.load(new Int32Array(producer.requests()[0].cancellation), 0), 0);
    producer.finish({ unlockReuse: own, partnerUnlockReuse: peer }); await nextTurn();
    assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2, 'validated owner cache interest admits the late complete pair');
    assert.deepEqual(scheduler.preparedEvaluation(taskReuseInputKey(after), 'reed', 1).result.tasks, [{ id: 'late peer' }]);
    const newer = structuredClone(after); newer.revision = 2; newer.members[0].unlocked.push('12344');
    const nextPreview = scheduler.evaluate(after, 'actor1', 'predict', '12344', 'next-preview', 'after');
    const nextRejected = assert.rejects(nextPreview, { status: 409 });
    producer.finish({ type: 'prediction-prepared', unlockReuse: reuse(newer, 'actor1', 1) });
    scheduler.supersede(2, 'newer'); await nextRejected;
    const nextHit = api === 'preparedEvaluation' ? scheduler.preparedEvaluation(taskReuseInputKey(newer), 'actor1', 2)
      : await scheduler.evaluate(newer, 'actor1', 'evaluate', undefined, 'newer', 'newer', undefined, [], 'play-v1');
    assert.equal(nextHit.resultCache.unlockPredictionHit, true);
    const nextRequest = producer.requests().at(-1); scheduler.supersede(3, 'third');
    assert.equal(Atomics.load(new Int32Array(nextRequest.cancellation), 0), 1, 'a second save still cancels confirmed obsolete partner work');
  });
});

test('wrong signature, member, revision and incomplete projection all fall back to fresh foreground', async t => {
  for (const [name, invalidate] of [
    ['fingerprint', value => value.taskInputKey = 'wrong'], ['member', value => value.memberId = 'reed'],
    ['source revision', value => value.sourceRevision = 1], ['sidebar projection', value => delete value.duoSidebarJSON],
  ]) await t.test(name, async sub => {
    const race = await savedRace(sub), calculated = race.calculate(); let settled = false;
    calculated.then(() => { settled = true; }); await race.previewRejected;
    const invalid = reuse(race.after); invalidate(invalid); race.finishPrediction(invalid);
    await nextTurn(); assert.equal(settled, false);
    race.finishForeground();
    assert.deepEqual((await calculated).result.tasks, [{ id: 'fresh' }]);
    assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
  });
});

test('subsequent incompatible save settles old race and ignores late preserved projection', async t => {
  const race = await savedRace(t), old = race.calculate();
  const rejected = assert.rejects(old, { status: 409 }); await race.previewRejected;
  const newer = structuredClone(race.after); newer.revision = 2; newer.members[1].unlocked.push('12344');
  const latest = race.scheduler.evaluate(newer, 'actor1', 'evaluate', undefined, 'newer', 'newer', undefined, [], 'play-v1');
  await rejected;
  race.finishPrediction(); race.finishForeground('obsolete'); await nextTurn();
  race.finishForeground('latest');
  assert.deepEqual((await latest).result.tasks, [{ id: 'latest' }]);
  assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
});

test('second save after owner publication cancels the detached prediction and rejects its pending peer', async t => {
  const duo = fakeFactory(), race = await savedRace(t, { duoWorkerFactory: duo.create }), own = race.calculate();
  const peer = race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'peer-after', 'after', undefined, [], 'play-v1', undefined, 'duo');
  const peerRejected = assert.rejects(peer, { status: 409 });
  await race.previewRejected; await nextTurn();
  const producer = race.prediction.workers[0], request = producer.requests()[0];
  const ownReuse = reuse(race.after, 'actor1', 0, 'own'), peerReuse = reuse(race.after, 'reed', 0, 'peer');
  producer.finish({ type: 'prediction-prepared', unlockReuse: ownReuse });
  assert.deepEqual((await own).result.tasks, [{ id: 'own' }]);
  assert.equal(Atomics.load(new Int32Array(request.cancellation), 0), 0, 'first save preserves useful partner work');
  assert.equal(producer.messages.filter(message => message.type === 'cancel').length, 0);
  race.scheduler.supersede(2, 'newer'); await peerRejected;
  assert.equal(Atomics.load(new Int32Array(request.cancellation), 0), 1, 'second save cancels work even after Preview left the pending map');
  assert.ok(producer.messages.some(message => message.type === 'cancel' && message.id === request.id));
  producer.finish({ unlockReuse: ownReuse, partnerUnlockReuse: peerReuse }); await nextTurn();
  assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
  assert.equal(race.scheduler.getDiagnostics().predictionLane.cache.entries, 0, 'late obsolete pair cannot enter either cache');
});

test('prediction producer failure falls back while requester disconnect and close settle both race branches', async t => {
  await t.test('producer failure', async sub => {
    const race = await savedRace(sub, { maxRestarts: 0 }), calculated = race.calculate();
    await race.previewRejected; race.prediction.workers[0].emit('error', new Error('producer failed'));
    race.finishForeground(); assert.deepEqual((await calculated).result.tasks, [{ id: 'fresh' }]);
    assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
  });
  await t.test('requester disconnect', async sub => {
    const race = await savedRace(sub), controller = new AbortController(), calculated = race.calculate(controller.signal);
    const rejected = assert.rejects(calculated, { name: 'AbortError' }); await race.previewRejected;
    controller.abort(); await rejected;
    race.finishPrediction(); race.finishForeground(); await nextTurn();
    assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
  });
  await t.test('close with detached active producer', async sub => {
    const race = await savedRace(sub), calculated = race.calculate();
    const rejected = assert.rejects(calculated, { status: 503 }); await race.previewRejected;
    await race.scheduler.close(); await rejected;
    assert.equal(race.scheduler.getHealth().prediction.status, 'closed');
  });
});

test('prediction winner does not cancel another waiter coalesced in the foreground calculation', async t => {
  const race = await savedRace(t), winner = race.calculate();
  await race.previewRejected;
  // Opaque caller keys coalesce at the lower lane. This other member cannot
  // follow Player's prediction and must still receive its ordinary response.
  const ordinary = race.scheduler.evaluate(race.after, 'reed', 'evaluate', undefined, 'after', 'after', undefined, [], 'play-v1');
  assert.equal(race.foreground.workers[0].requests().length, 1);
  race.finishPrediction(); assert.deepEqual((await winner).result.tasks, [{ id: 'warm' }]);
  assert.equal(race.foreground.workers[0].messages.filter(message => message.type === 'cancel').length, 0);
  race.finishForeground('coalesced');
  assert.deepEqual((await ordinary).result.tasks, [{ id: 'coalesced' }]);
});

test('saved follower pins active prediction through idle deadline and releases worker after completion', async t => {
  let now = 0, sequence = 0;
  const timers = new Map(), idleClock = { now: () => now,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const tick = async timestamp => {
    now = timestamp;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await nextTurn();
  };
  const race = await savedRace(t, { idleMs: 40, idleClock }), calculated = race.calculate();
  await race.previewRejected; await tick(41);
  assert.equal(race.scheduler.getHealth().prediction.status, 'ready');
  assert.equal(race.scheduler.getHealth().status, 'ready');
  race.finishPrediction(); await calculated;
  race.finishForeground(); await tick(82);
  assert.equal(race.scheduler.getHealth().prediction.status, 'sleeping');
  assert.equal(race.scheduler.getHealth().status, 'sleeping');
  assert.equal(race.scheduler.getDiagnostics().unlockReuse.entries, 0);
});

test('disconnecting the last saved follower after idle deadline releases the abandoned prediction worker', async t => {
  let now = 0, sequence = 0;
  const timers = new Map(), idleClock = { now: () => now,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const tick = async timestamp => {
    now = timestamp;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await nextTurn();
  };
  const race = await savedRace(t, { idleMs: 40, idleClock }), controller = new AbortController();
  const calculated = race.calculate(controller.signal), rejected = assert.rejects(calculated, { name: 'AbortError' });
  await race.previewRejected; await tick(41);
  assert.equal(race.scheduler.getHealth().prediction.status, 'ready');
  controller.abort(); await rejected; await tick(41);
  assert.equal(race.scheduler.getHealth().prediction.status, 'sleeping', 'elapsed idle timer must be rearmed after the final follower disconnects');
});

test('saved unlock promotes the exact compact selected/duo result without queueing calculation', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory(), duo = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, duoWorkerFactory: duo.create });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1;
  after.members[0].unlocked.push('12342'); after.members[0].selected = [];
  const predicted = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
  await new Promise(resolve => setImmediate(resolve));
  prediction.workers[0].finish({ unlockReuse: reuse(after) }); await predicted;
  const sharedState = shared(after), stateInput = { stateJSON: sharedState, inputKey: 'after', taskInputKey: taskReuseInputKey(after) };
  const result = await scheduler.evaluate({ revision: 1, members: [{ id: 'actor1' }, { id: 'reed' }] }, 'actor1', 'evaluate', undefined, 'saved', 'after', undefined, [], 'play-v1', stateInput, 'foreground', true);
  assert.equal(result.hit, true); assert.equal(result.resultCache.unlockPredictionHit, true);
  assert.deepEqual(result.result.tasks, [{ id: 'warm' }]);
  assert.equal(JSON.parse(result.duoSidebarJSON).projection, 'duo-sidebar-v1');
  assert.equal(foreground.workers[0].requests().length, 0);
  assert.equal(duo.workers.length, 0);
  const peer = scheduler.evaluate(after, 'reed', 'evaluate', undefined, 'peer', 'after', undefined, [], 'play-v1', undefined, 'duo');
  await new Promise(resolve => setImmediate(resolve)); duo.workers[0].finish(); await peer;
  assert.equal(duo.workers[0].requests().length, 1, 'One member prediction never substitutes for peer obligations');
  const changed = structuredClone(after); changed.members[1].unlocked.push('12344');
  const invalid = scheduler.evaluate(changed, 'actor1', 'evaluate', undefined, 'changed', 'changed', undefined, [], 'play-v1');
  foreground.workers[0].finish(); await invalid;
  assert.equal(foreground.workers[0].requests().length, 1, 'Changed shared capability input requires full calculation');
  const full = scheduler.evaluate(after, 'actor1', 'evaluate', undefined, 'detail', 'after');
  foreground.workers[0].finish(); await full;
  assert.equal(foreground.workers[0].requests().length, 2, 'Full detail panels hydrate normally');
  assert.ok(scheduler.getDiagnostics().unlockReuse.bytes <= scheduler.getDiagnostics().unlockReuse.byteLimit);
});

test('late superseded and disconnected predictions cannot admit saved-unlock bytes', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
  const stale = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
  const rejection = assert.rejects(stale, { status: 409 });
  await new Promise(resolve => setImmediate(resolve));
  scheduler.supersede(1, 'after'); await rejection;
  prediction.workers[0].finish({ unlockReuse: reuse(after) });
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0);
  const controller = new AbortController();
  const disconnected = scheduler.evaluate(after, 'actor1', 'predict', '12343', 'preview2', 'after', controller.signal);
  const aborted = assert.rejects(disconnected, { name: 'AbortError' });
  controller.abort(); await aborted;
  prediction.workers[0].finish({ unlockReuse: reuse(after, 'actor1', 1) });
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0);
});

test('idle prediction shutdown releases both reusable owners and saved partner tasks wake normally', async t => {
  let now = 0, sequence = 0;
  const timers = new Map(), idleClock = { now: () => now,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, idleMs: 40, idleClock });
  t.after(() => scheduler.close());
  const before = state(), after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
  const predicted = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'before');
  await new Promise(resolve => setImmediate(resolve));
  prediction.workers[0].finish({ unlockReuse: reuse(after), partnerUnlockReuse: reuse(after, 'reed', 0, 'peer') }); await predicted;
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  now = 41;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0);
  assert.equal(scheduler.getDiagnostics().unlockReuse.compressedBytes, 0);
  assert.equal(scheduler.getDiagnostics().unlockReuse.rawBytes, 0);
  assert.equal(scheduler.getHealth().prediction.status, 'sleeping');
  const refreshed = scheduler.evaluate(after, 'reed', 'evaluate', undefined, 'after', 'after', undefined, [], 'play-v1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(foreground.workers.length, 2);
  foreground.workers[1].finish({ playJSON: shared({ tasks: [{ id: 'fresh after wake' }] }) });
  const result = await refreshed; assert.deepEqual(result.result.tasks, [{ id: 'fresh after wake' }]);
  assert.equal(result.resultCache?.unlockPredictionHit, undefined);
});

test('native prediction prepares both owners from the fresh saved fixed point and publishes progress only when requested', async t => {
  const definitions = { chunks: { '12341': { Object: { Tree: true } }, '12342': { Object: { Oak: true } }, '12343': { Spawn: { Coal: 1 } } },
    walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'], challenges: { Quest: {
      'Present quest': { Chunks: ['12341'] }, 'Future quest': { Chunks: ['12342'] }, 'Partner quest': { Chunks: ['12343'] },
    }, Woodcutting: {
      Logs: { Level: 1, Objects: ['Tree'], Primary: true, Output: 'Logs' },
      Oak: { Level: 15, Objects: ['Oak'], Primary: true, Output: 'Oak logs' },
    }, Extra: { 'Future chain': { Items: ['Oak logs', 'Coal'] } } } };
  const world = buildWorld(definitions), before = state();
  if (createRuleRegistry().get('content.f2p')) before.rules['content.f2p'] = false;
  for (const member of before.members) member.teleports = ['12341', '12342', '12343'].map(destination => ({
    id: `route:${destination}`, label: `Synthetic route ${destination}`, destination, available: true, consumable: false,
  }));
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate()); await once(worker, 'message');
  const send = async request => { const response = once(worker, 'message'); worker.postMessage({ id: 1, memberId: 'actor1', ...request }); return (await response)[0]; };
  const prediction = await send({ type: 'predict', state: before, chunkId: '12342' }); assert.equal(prediction.error, undefined);
  assert.equal(prediction.type, undefined, 'direct clients receive one final message by default');
  const after = applyCommand(before, { type: 'set-chunk', memberId: 'actor1', chunkId: '12342', status: 'unlocked' }, { world });
  assert.equal(prediction.unlockReuse.taskInputKey, taskReuseInputKey(after));
  assert.ok(prediction.result.delta.tasksAdded.some(task => task.label === 'Future quest'));
  const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  const registry = createRuleRegistry();
  for (const [memberId, prepared] of [['actor1', prediction.unlockReuse], ['reed', prediction.partnerUnlockReuse]]) {
    assert.equal(prepared.memberId, memberId); assert.equal(prepared.sourceRevision, before.revision);
    assert.equal(prepared.taskInputKey, taskReuseInputKey(after));
    for (const key of ['playJSON', 'duoJSON', 'duoSidebarJSON']) {
      const rawPrefix = Buffer.from(prepared[key]).subarray(0, -1);
      assert.deepEqual(prepared.gzipJSONPrefixMetadata[key], { crc32: crc32(rawPrefix), rawLength: rawPrefix.length });
      assert.deepEqual(gunzipSync(Buffer.from(prepared.gzipJSONPrefixes[key]), { finishFlush: zlibConstants.Z_SYNC_FLUSH }), rawPrefix);
    }
    const calculated = await send({ type: 'evaluate', state: after, memberId }); assert.equal(calculated.error, undefined);
    const play = { ...projectPlayResult(calculated.result), taskLocations: projectMapTaskLocations(definitions, calculated.result, world) };
    const chain = play.tasks.find(task => task.label === 'Future chain');
    assert.equal(chain.status, 'available', `${memberId}: future source joins the partner resource through the fixed point`);
    const futureQuest = calculated.result.tasks.find(task => task.label === 'Future quest');
    if (memberId === 'actor1') assert.deepEqual(play.taskLocations[futureQuest.id], ['12342'], 'the newly unlocked owner chunk is projected');
    else assert.equal(play.taskLocations[futureQuest.id], undefined, 'partner resources do not make another member own the task location');
    for (const [key, value] of Object.entries({ playJSON: play, duoJSON: projectDuoSidebarResult(play, after, registry, memberId),
      duoSidebarJSON: projectDuoSidebarResult(play, after, registry, memberId) })) {
      assert.deepEqual(normalize(JSON.parse(Buffer.from(prepared[key]))), normalize(value), `${memberId}:${key}`);
    }
  }
  const messages = await new Promise((resolve, reject) => {
    const received = [];
    const onMessage = message => {
      received.push(message);
      if (message.type === 'prediction-prepared') return;
      worker.off('message', onMessage); worker.off('error', onError); resolve(received);
    };
    const onError = error => { worker.off('message', onMessage); reject(error); };
    worker.on('message', onMessage); worker.once('error', onError);
    worker.postMessage({ id: 2, type: 'predict', state: before, memberId: 'actor1', chunkId: '12342', predictionProgress: true });
  });
  assert.equal(messages.length, 2); assert.equal(messages[0].type, 'prediction-prepared');
  assert.equal(messages[0].partnerUnlockReuse, undefined, 'the owner can publish before partner computation');
  assert.equal(messages[1].partnerUnlockReuse.memberId, 'reed');
  for (const key of ['playJSON', 'duoJSON', 'duoSidebarJSON']) {
    assert.deepEqual(normalize(JSON.parse(Buffer.from(messages[0].unlockReuse[key]))), normalize(JSON.parse(Buffer.from(prediction.unlockReuse[key]))));
    assert.deepEqual(normalize(JSON.parse(Buffer.from(messages[1].partnerUnlockReuse[key]))), normalize(JSON.parse(Buffer.from(prediction.partnerUnlockReuse[key]))));
  }
  assert.deepEqual(before.members[0].unlocked, ['12341']);
});
