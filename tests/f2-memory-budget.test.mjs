// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/fixed-performance-clock.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRepresentation, createResponseCache, sendRepresentation } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';
import { serviceMemoryBudget } from '../app/service-memory-budget.mjs';
import { createStateSnapshotCache, retainedDataBytes } from '../app/tasks/retained-data.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { engineFixture, fixtureStates } from './fixtures/task-engine.mjs';
import { createIdentityDictionary, editIdentityDictionary } from '../app/tasks/identity-dictionary.mjs';
import { createGroupState, createResidentState } from '../app/core/state.mjs';
import { verifyOwnedBaseBytes } from '../app/storage/owned-base.mjs';
import { fixture as ownedFixture, first as ownedTaskId } from './helpers/owned-format2-fixture.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { createEligibilityBudget, createEligibilityCache, eligibilityInputKey } from '../app/tasks/eligibility-cache.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { openStore } from '../app/storage/store.mjs';
import { capProjection, inspectLedgers } from '../scripts/perf/owned-acceptance/steady-state.mjs';
import { createSnapshotHotSet } from '../app/tasks/snapshot-hot-set.mjs';
import { createSerializedSnapshotCache } from '../app/tasks/serialized-snapshot-cache.mjs';

const charge = ledger => ledger.dimensions.find(d => d.unit === 'chargeBytes');
const semantic = value => JSON.stringify(value);

test('service partitions include responses and cannot multiply with physical calculators', () => {
  for (const calculators of [1, 2, 4]) {
    const budget = serviceMemoryBudget({ env: { RS3_MEMORY_PROFILE: 'budget-672' }, calculators });
    assert.equal(budget.totalBytes, 672 * 1024 ** 2);
    assert.equal(budget.responseBytes, 128 * 1024 ** 2);
    assert(budget.allocatedBytes <= budget.totalBytes);
    assert.equal(budget.workerBytes * calculators, 256 * 1024 ** 2);
    assert.equal(budget.engineBytes * calculators, 128 * 1024 ** 2);
    assert.equal(budget.stateBytes * calculators, 32 * 1024 ** 2);
    const byBytes = serviceMemoryBudget({ env: { RS3_SERVICE_CACHE_BYTES: '704643072' }, calculators });
    assert.deepEqual({ ...byBytes, profile: budget.profile }, budget);
  }
  const configured = serviceMemoryBudget({ env: { RS3_SERVICE_CACHE_BYTES: '210', RS3_RESPONSE_CACHE_BYTES: '40' }, calculators: 2 });
  assert(configured.allocatedBytes <= 210);
  assert.throws(() => serviceMemoryBudget({ env: { RS3_SERVICE_CACHE_BYTES: '1', RS3_RESPONSE_CACHE_BYTES: '2' } }), TypeError);
  assert.throws(() => serviceMemoryBudget({ env: { RS3_MEMORY_PROFILE: 'unknown' } }), TypeError);
  assert.throws(() => serviceMemoryBudget({ env: { RS3_RESPONSE_CACHE_BYTES: '-1' } }), TypeError);
});

test('report-only global accounting never evicts or declines admissions and fails closed for proof', () => {
  const budget = createResponseCacheBudget({ maxBytes: null, maxEntries: null });
  const a = createResponseCache({ budget }), b = createResponseCache({ budget });
  a.set('a', createRepresentation('aaaa')); b.set('b', createRepresentation('bbbb'));
  assert.equal(budget.bytes, 8); assert(a.get('a')); assert(b.get('b'));
  const ledger = { ...budget.retentionLedger(), id: 'service', scope: 'shared' };
  assert.equal(charge(ledger).used, 8); assert.equal(charge(ledger).cap, null);
  assert.equal(charge(ledger).enforced, false); assert.equal(ledger.complete, false);
  assert(inspectLedgers([ledger]).some(reason => reason.includes('missing-enforced-cap')));
  a.clear(); b.clear(); assert.equal(budget.bytes, 0);
});

test('global pressure evicts across groups with a soft per-group floor and global LRU', () => {
  const budget = createResponseCacheBudget({ maxBytes: 12, maxEntries: 4, groupFloorBytes: 4 });
  const a = createResponseCache({ budget, group: 'a' }), b = createResponseCache({ budget, group: 'b' });
  a.set('a1', createRepresentation('aaaa')); b.set('b1', createRepresentation('bbbb'));
  a.set('a2', createRepresentation('cccc')); a.get('a1'); a.set('a3', createRepresentation('dddd'));
  assert.equal(a.get('a2'), undefined); assert(b.get('b1')); assert(a.get('a1')); assert(a.get('a3'));
  assert.equal(budget.bytes, 12); assert.equal(budget.size, 3);
  a.clear(); b.clear(); assert.equal(budget.bytes, 0); assert.equal(budget.size, 0);
});

test('one group floor cannot defeat the service cap and static/other cache owners participate', () => {
  const budget = createResponseCacheBudget({ maxBytes: 4, maxEntries: 2, groupFloorBytes: 4096 });
  const a = createResponseCache({ budget }), b = createResponseCache({ budget });
  a.set('a', createRepresentation('aaaa')); b.set('static', createRepresentation('bbbb'));
  assert.equal(a.size, 0); assert.equal(budget.bytes, 4); b.clear();
});

test('pinned decoder reservations stay charged and admission declines without evicting them', () => {
  const budget = createResponseCacheBudget({ maxBytes: 8, maxEntries: 2 });
  const a = createResponseCache({ budget }), b = createResponseCache({ budget });
  let retired = false;
  const reservation = { retainedBytes: 8, pinned: true, onEvict: () => { retired = true; } };
  a.set('decode', reservation); b.set('other', createRepresentation('x'));
  assert.equal(b.size, 0); assert.equal(budget.bytes, 8);
  a.clear(); assert(retired); assert.equal(budget.bytes, 8);
  reservation.pinned = false; a.delete('decode'); assert.equal(budget.bytes, 0);
});

async function send(cache, encoding, method = 'GET', validator) {
  const key = 'synthetic-reply';
  const representation = cache.get(key) ?? cache.set(key, createRepresentation('{"synthetic":"same 🦊 bytes"}'));
  const output = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await sendRepresentation({ method, headers: { 'accept-encoding': encoding, ...(validator ? { 'if-none-match': validator } : {}) } }, output, representation);
  return { status: output.status, headers: output.headers, body: output.body };
}
test('global eviction preserves exact identity/gzip/brotli replies, validators, HEAD and 304', async () => {
  const roomy = createResponseCache({ budget: createResponseCacheBudget({ maxBytes: 4096 }) });
  const evicted = createResponseCache({ budget: createResponseCacheBudget({ maxBytes: 0 }) });
  for (const encoding of ['identity', 'gzip', 'br']) {
    const expected = await send(roomy, encoding), actual = await send(evicted, encoding);
    assert.deepEqual(actual, expected);
    assert.deepEqual(await send(evicted, encoding, 'HEAD'), await send(roomy, encoding, 'HEAD'));
    assert.deepEqual(await send(evicted, encoding, 'GET', expected.headers.ETag), await send(roomy, encoding, 'GET', expected.headers.ETag));
  }
  roomy.clear();
});

test('input payload and entry caps evict and charge complete backing buffers and resident identities', () => {
  const backing = new ArrayBuffer(4096), view = new Uint8Array(backing, 0, 1);
  assert(retainedDataBytes([view]) >= 4096);
  assert.equal(retainedDataBytes([view, view]), retainedDataBytes([view]));
  const identity = createIdentityDictionary(Object.freeze({ synthetic: Object.freeze({ id: 'synthetic', label: 'payload'.repeat(100) }) }));
  assert(retainedDataBytes([identity]) > 1400);
  const hidden = editIdentityDictionary(identity, [{ key: 'synthetic', delete: true }]);
  assert(retainedDataBytes([hidden]) >= retainedDataBytes([identity]), 'deleted rows still retain their immutable base');
  const state = { revision: 1, identity }, cost = retainedDataBytes([state]) + retainedDataBytes(['a']) + 256;
  const evicted = [], cache = createStateSnapshotCache({ maxBytes: cost, onEvict: key => evicted.push(key) });
  cache.set('a', state); assert.equal(cache.get('a'), state); assert.equal(cache.bytes, cost);
  cache.set('b', { ...state, revision: 2 }); assert.equal(cache.get('a'), undefined); assert.equal(cache.size, 1);
  assert.deepEqual(evicted, ['a']);
  cache.set('huge', { payload: 'x'.repeat(cost) }); assert.equal(cache.get('huge'), undefined);
  assert(charge(cache.retentionLedger()).used <= cost);
  cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
  assert.equal(cache.get('b'), undefined); assert(evicted.includes('b'));
});

test('owned catalogue metadata and overlaid rows enter the input, proof and response byte ledgers', async () => {
  const fixture = ownedFixture(), base = verifyOwnedBaseBytes(fixture.bytes, { dataset: fixture.pin.dataset, manifest: fixture.manifest });
  const state = createResidentState(fixture.state, base);
  const label = 'Synthetic catalogue label '.repeat(1024);
  const changed = createResidentState({ ...fixture.state, provenance: { ownedCatalogue: {
    retiredIds: [ownedTaskId], names: { [ownedTaskId]: label } } } }, base);
  state.members[0].completedTasks = [ownedTaskId];
  changed.members[0].completedTasks = [ownedTaskId];
  const metadataBytes = retainedDataBytes([changed]) - retainedDataBytes([state]);
  assert(metadataBytes >= label.length * 2);
  const inputs = createStateSnapshotCache({ maxBytes: 1024 ** 2 });
  inputs.set('before', state); const plainInputBytes = inputs.bytes;
  inputs.clear(); inputs.set('after', changed);
  assert(inputs.bytes >= plainInputBytes + metadataBytes - 16);
  const fingerprint = createTaskReuseFingerprint({ ownedCatalogueSemantics: true });
  assert.notEqual(fingerprint(state), fingerprint(changed));
  assert.notEqual(eligibilityInputKey(state, 'member-1', undefined, true), eligibilityInputKey(changed, 'member-1', undefined, true));
  const budget = createEligibilityBudget({ byteLimit: 1024 ** 2 });
  const proofs = createEligibilityCache({ budget, ownedCatalogueSemantics: true });
  const compute = state => ({ tasks: structuredClone(projectPlayState(state, { ownedCatalogueSemantics: true }).tasks), metrics: {} });
  const expected = compute(changed);
  proofs.evaluate(state, 'member-1', undefined, () => compute(state));
  const beforeProof = budget.bytes;
  const result = proofs.evaluate(changed, 'member-1', undefined, () => expected);
  assert.equal(result.tasks.find(row => row.id === ownedTaskId).label, label);
  assert(budget.bytes > beforeProof);
  assert.equal(budget.bytes, proofs.bytes);
  assert.deepEqual(proofs.evaluate(changed, 'member-1', undefined, () => assert.fail('Owned proof missed')), expected);
  const hot = createSnapshotHotSet();
  const snapshots = createSerializedSnapshotCache(budget, { hotSet: hot });
  assert.equal(snapshots.set('owned', { baseline: expected, revision: 1 }, changed, 'synthetic'), true);
  assert(charge(hot.retentionLedger()).used >= label.length * 2, 'Decoded catalogue overlay is charged in the shared hot graph');
  const responseBudget = createResponseCacheBudget({ maxBytes: 1024 ** 2 });
  const responses = createResponseCache({ budget: responseBudget });
  const bytes = JSON.stringify(expected);
  const response = responses.set('owned', createRepresentation(bytes));
  assert.equal(charge(responseBudget.retentionLedger()).used, Buffer.byteLength(bytes));
  assert.deepEqual((await response.encoded('identity')).bytes, Buffer.from(bytes));
  responses.clear(); proofs.clear(); snapshots.entries.clear(); inputs.clear();
  assert.equal(responseBudget.bytes, 0); assert.equal(budget.bytes, 0);
});

test('parsed variants and lazy indexes are evicted without changing engine answers or input bytes', () => {
  const definitions = engineFixture(), before = JSON.stringify(definitions);
  const retained = createTaskEngine(definitions, { variantByteLimit: 8 * 1024 * 1024 });
  const evicted = createTaskEngine(definitions, { variantByteLimit: 0 });
  for (const { state } of fixtureStates().slice(0, 4)) {
    const input = JSON.stringify(state);
    assert.equal(semantic(evicted.evaluate(state, 'm0')), semantic(retained.evaluate(state, 'm0')));
    assert.equal(JSON.stringify(state), input);
  }
  retained.prepare({});
  const roomy = retained.retentionLedger(), empty = evicted.retentionLedger();
  assert(roomy.parsedBytes > 0); assert.equal(empty.parsedBytes, 0); assert(empty.evictions > 0);
  assert.equal(empty.dimensions[0].used, 0); assert.equal(empty.complete, true);
  assert.equal(charge(empty).used, empty.fixedInputBytes);
  assert.equal(JSON.stringify(definitions), before);
});

test('lazy preparation that exceeds a nonzero parsed cap releases the variant and its indexes', () => {
  const data = engineFixture(), reference = createTaskEngine(data, { variantByteLimit: 8 * 1024 ** 2 });
  const initialBytes = reference.retentionLedger().parsedBytes;
  const capped = createTaskEngine(data, { variantByteLimit: initialBytes });
  assert.equal(capped.retentionLedger().dimensions[0].used, 1);
  capped.prepare({});
  assert.equal(capped.retentionLedger().dimensions[0].used, 0);
  const state = fixtureStates()[0].state;
  assert.equal(semantic(capped.evaluate(state, 'm0')), semantic(reference.evaluate(state, 'm0')));
  assert(capped.retentionLedger().parsedBytes <= initialBytes);
});

test('automatic travel denies engine completeness even after variant eviction or later manual preparation', () => {
  const engine = createTaskEngine(engineFixture(), { variantByteLimit: 0 });
  assert.equal(engine.retentionLedger().complete, true);
  engine.prepare({ 'travel.automatic': true });
  const ledger = engine.retentionLedger();
  assert.equal(ledger.parsedBytes, 0);
  assert.equal(ledger.complete, false);
  assert.deepEqual(ledger.blockers, ['automatic-transport-baseline-derived-bytes-unledgered']);
  engine.prepare({ 'travel.automatic': false });
  assert.equal(engine.retentionLedger().complete, false, 'variant eviction does not prove release of hidden roots');
});

test('service and hot-set subset caps are added once in both group projections', () => {
  const row = (id, cap, extra = {}) => ({ id, owner: 'response-caches', complete: true, scope: 'shared',
    dimensions: [{ unit: 'entries', used: 0, cap: 1, enforced: true },
      { unit: 'chargeBytes', used: 0, cap, enforced: true }], ...extra });
  const projection = capProjection([row('service', 128), row('group', 48, { scope: 'group', group: 0, includedInOtherCap: true }),
    row('worker', 384), row('hot', 128, { owner: 'hot-snapshot', includedInOtherCap: true }),
    ...['History', 'engine-variants', 'stateSnapshots'].map(owner => row(owner, 0, { owner }))]);
  assert.equal(projection.complete, true);
  assert.equal(projection.projectedTotal100GroupBytes, 512);
  assert.equal(projection.projectedTotal500GroupBytes, 512);
});

test('source ledgers supply real byte dimensions to the fail-closed proof inspector', () => {
  const cache = createResponseCache({ budget: createResponseCacheBudget({ maxBytes: 1024 }) });
  cache.set('synthetic', createRepresentation('synthetic'));
  const hot = createSnapshotHotSet({ byteLimit: 128 });
  hot.retain({}, 64, () => {});
  const state = createStateSnapshotCache({ maxBytes: 1024 }); state.set('synthetic', { revision: 1 });
  const engine = createTaskEngine(engineFixture(), { variantByteLimit: 128 * 1024 ** 2 });
  const owners = [cache.retentionLedger({ subset: true }), hot.retentionLedger(), state.retentionLedger(), engine.retentionLedger()]
    .map(row => ({ ...row, id: row.owner, scope: 'shared' }));
  const reasons = inspectLedgers(owners);
  assert.deepEqual(reasons, ['missing-owner:History']);
  for (const row of owners) assert(charge(row).used > 0);
  cache.clear();
});

test('response cache pressure preserves durable save bytes while archived History reload and Undo stay reachable', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-memory-budget-'));
  let store;
  t.after(async () => { await store?.close(); await rm(directory, { recursive: true, force: true }); });
  const registry = createRuleRegistry();
  const initialState = createGroupState([{ id: 'synthetic-member', name: 'Synthetic Player' },
    { id: 'synthetic-peer', name: 'Synthetic Peer' }], registry);
  const world = { chunks: new Map([['12850', { id: '12850', name: 'Synthetic chunk' }]]), neighbors: new Map(),
    walkable: new Set(['12850']), f2p: new Set(['12850']) };
  const now = () => '2026-11-11T00:00:00.000Z';
  const roomy = createResponseCache({ budget: createResponseCacheBudget({ maxBytes: 1024 ** 2 }) });
  const noCache = createResponseCache({ budget: createResponseCacheBudget({ maxBytes: 0 }) });
  store = await openStore({ dataDir: directory, initialState, world, registry, now, retention: { historyEntries: 1 } });
  for (let revision = 0; revision < 6; revision++) await store.command({ type: 'set-note',
    memberId: revision === 0 ? 'synthetic-member' : 'synthetic-peer', chunkId: '12850', note: String(revision) }, revision);
  assert(store.getInfo().retention.historyArchives > 0);
  const saved = await readFile(path.join(directory, 'state.json'));
  const expected = await store.queryHistory({ limit: 100 }), details = await store.readHistoryEvent(1);
  const snapshot = await store.getStateSnapshot();
  for (const cache of [roomy, noCache]) {
    const representation = cache.set('save', createRepresentation(snapshot.stateJSON));
    assert.deepEqual((await representation.encoded('identity')).bytes, Buffer.from(snapshot.stateJSON));
    await representation.encoded('gzip');
    assert.deepEqual(await readFile(path.join(directory, 'state.json')), saved);
  }
  roomy.clear(); await store.close();
  store = await openStore({ dataDir: directory, world, registry, now, retention: { historyEntries: 1 } });
  assert.deepEqual(await store.queryHistory({ limit: 100 }), expected);
  assert.deepEqual(await store.readHistoryEvent(1), details);
  assert.deepEqual(await readFile(path.join(directory, 'state.json')), saved);
  await store.command({ type: 'undo', undoRevision: 1 }, 6);
  assert.equal((await store.readHistoryEvent(1)).event.undoneRevision, 7);
  const ledger = store.retentionLedger();
  assert.equal(ledger.complete, false); assert.equal(charge(ledger).cap, null); assert(charge(ledger).used > 0);
});
