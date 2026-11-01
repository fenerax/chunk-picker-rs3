import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { createSnapshotCache, snapshotBytes, createWorkerCacheBudget, trackPlanningIndex, trackSnapshotCore } from '../app/tasks/snapshot-cache.mjs';
import { createEligibilityBudget, createEligibilityCache } from '../app/tasks/eligibility-cache.mjs';

const value = label => ({ baseline: { tasks: [{ label: label.repeat(400) }], metrics: {} }, estimates: new Map() });
const state = { revision: 1, members: [{ id: 'same', unlocked: [] }] };
const cost = snapshotBytes(value('a'), state) + 10;

test('complete and sandbox snapshots evict globally by measured bytes and LRU', () => {
  const budget = createEligibilityBudget({ byteLimit: 2 * cost });
  const complete = new Map(), sandbox = new Map();
  const a = createSnapshotCache(complete, budget), b = createSnapshotCache(sandbox, budget);
  const first = value('a'), second = value('b');
  a.set('a', first, state, '1'); b.set('b', second, state, '2');
  assert.equal(budget.size, 2); a.refresh(first);
  a.set('c', value('c'), state, '3');
  assert.equal(sandbox.size, 0); assert.equal(complete.size, 2);
  assert.ok(budget.bytes <= budget.byteLimit);
});

test('one picker cannot monopolize the shared budget, including eligibility storage', () => {
  const budget = createWorkerCacheBudget(8 * cost), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('peer', value('z'), state, 'peer');
  for (let i = 0; i < 30; i++) cache.set(String(i), value('a'), state, 'noisy');
  assert.ok(entries.has('peer')); assert.ok(entries.size <= 5);
  const bytes = Buffer.alloc(cost); assert.equal(budget.admit(bytes, () => {}), true);
  assert.ok(budget.bytes <= budget.byteLimit);
  assert.equal(budget.admit(Buffer.alloc(Math.floor(8 * cost / 3) + 1), () => {}), false);
});

test('lazy growth is remeasured, evicted snapshots cannot become unaccounted entries', () => {
  const budget = createEligibilityBudget({ byteLimit: 2 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a'), second = value('b');
  cache.set('a', first, state, '1'); cache.set('b', second, state, '2');
  first.planningIndex = { byLocation: new Map([['x', 'x'.repeat(20 * cost)]]), clueLocations: new Map() }; cache.refresh(first);
  assert.equal(entries.has('a'), false); assert.equal(budget.size, 1);
  delete first.planningIndex; cache.set('a', first, state, '1');
  assert.equal(budget.size, 2); assert.ok(budget.bytes <= budget.byteLimit);
  first.estimates.set('estimate', 'x'.repeat(20 * cost)); cache.refresh(first);
  assert.equal(entries.has('a'), false);
});

test('oversized snapshots are usable by the caller without retaining their state', () => {
  const budget = createWorkerCacheBudget(16), entries = new Map(), cache = createSnapshotCache(entries, budget);
  const result = value('a'); cache.set('key', result, state, 'one');
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  assert.equal(result.baseline.tasks.length, 1);
});

test('same-sized estimate replacement and prediction closures are charged before reuse', () => {
  const budget = createEligibilityBudget({ byteLimit: 3 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a');
  first.estimates.set('estimate', 'small'); cache.set('a', first, state, '1');
  first.estimates.set('estimate', 'x'.repeat(20 * cost)); cache.refresh(first, true);
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  const second = value('b'); cache.set('b', second, state, '2');
  cache.capture(second, { ...state, payload: 'x'.repeat(20 * cost) });
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
});

test('snapshot churn preserves the reserved shared eligibility space', () => {
  const budget = createWorkerCacheBudget(12 * cost), entries = new Map();
  const cache = createSnapshotCache(entries, budget), proof = Buffer.alloc(3 * cost);
  let proofEvictions = 0;
  assert.equal(budget.admit(proof, () => proofEvictions++), true);
  for (let i = 0; i < 40; i++) cache.set(String(i), value('a'), state, String(i));
  assert.equal(proofEvictions, 0); assert.equal(budget.touch(proof), true);
  assert.ok(budget.bytes <= budget.byteLimit); assert.ok(entries.size < 40);
});

test('a prediction clone is charged independently when its input aliases the baseline state', () => {
  const budget = createEligibilityBudget({ byteLimit: 10 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a');
  cache.set('a', first, state, '1'); const before = budget.bytes;
  cache.capture(first, state);
  assert.ok(budget.bytes > before, 'the private validated clone cannot be hidden by serialization aliasing');
});


test('lazy views and locations are charged without walking the stable baseline again', () => {
  let reads = 0, locations;
  const baseline = { tasks: [], metrics: {}, get stable() { reads++; return 'x'.repeat(4000); } };
  const snapshot = { baseline, estimates: new Map() };
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget, { locations: () => locations });
  cache.set('a', snapshot, state, '1');
  assert.equal(reads, 1);
  const initial = budget.bytes;
  locations = { task: ['10000'] }; cache.refresh(snapshot);
  assert.equal(reads, 1); assert.ok(budget.bytes > initial);
  baseline.currentBiS = { items: ['item'] }; baseline.activityInfo = { tasks: ['task'] };
  snapshot.includeViews = true; cache.refresh(snapshot);
  assert.equal(reads, 1);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, undefined, locations) + 2);
  const measuredReads = reads; cache.set('a', snapshot, state, '1');
  assert.equal(reads, measuredReads);
  assert.ok(budget.bytes <= budget.byteLimit);
});

test('context removal stays conservatively charged; replacement and forced changes are measured', () => {
  const snapshot = value('a');
  let context = { equipment: 'x'.repeat(4000), state };
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget, { context: () => context });
  cache.set('a', snapshot, state, '1'); const before = budget.bytes;
  context = undefined; cache.refresh(snapshot);
  assert.equal(budget.bytes, before);
  assert.ok(budget.bytes >= snapshotBytes(snapshot, state) + 2);
  context = { equipment: 'x'.repeat(8000), state }; cache.refresh(snapshot);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, context) + 2);
  snapshot.estimates.set('same', 'small'); cache.refresh(snapshot);
  snapshot.estimates.set('same', 'x'.repeat(20000)); cache.refresh(snapshot, true);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, context) + 2);
});


test('unsupported lazy data releases its charge and a repaired snapshot can be admitted again', () => {
  const snapshot = value('a');
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  snapshot.playResult = { unsupported() {} }; cache.refresh(snapshot);
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  snapshot.playResult = { tasks: [] }; cache.set('a', snapshot, state, '1');
  assert.equal(entries.size, 1);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state) + 2);
});


test('large sandbox and planning aliases share the baseline charge', () => {
  const task = { payload: 'x'.repeat(4000) };
  const snapshot = { baseline: { tasks: [task], metrics: {} }, estimates: new Map() };
  const budget = createEligibilityBudget({ byteLimit: 8000 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  snapshot.playResult = { tasks: [task] };
  snapshot.sandboxDelta = { added: [task] };
  snapshot.planningIndex = { byLocation: new Map([['location', task]]), clueLocations: new Map() };
  cache.refresh(snapshot);
  assert.equal(entries.size, 1, 'shared payloads must fit without duplicate bulk charges');
  assert.ok(budget.bytes < 5000);
  assert.ok(budget.bytes <= budget.byteLimit);
});


test('a burst of large snapshots sharing a measured state never exceeds byte limits', () => {
  const byteLimit = 800000, ownerByteLimit = 300000, snapshotByteLimit = 600000;
  const budget = createEligibilityBudget({ byteLimit, ownerByteLimit, snapshotByteLimit });
  const entries = new Map(), cache = createSnapshotCache(entries, budget);
  const sharedState = { ...state, payload: 's'.repeat(70000) };
  const proof = Buffer.allocUnsafeSlow(180000);
  assert.ok(budget.admit(proof, () => assert.fail('snapshot churn evicted reserved proof')));
  const owners = new Map();
  for (let i = 0; i < 60; i++) {
    const owner = String(i % 3), key = String(i), shared = { payload: 'x'.repeat(80000) };
    const snapshot = { baseline: { tasks: Array(1500).fill(shared), metrics: {} }, estimates: new Map() };
    cache.set(key, snapshot, sharedState, owner); owners.set(key, owner);
    const exact = [...entries].reduce((sum, [key, value]) => sum + snapshotBytes(value, sharedState) + Buffer.byteLength(key) + Buffer.byteLength(owners.get(key)), 0);
    const independent = [...entries.values()].reduce((sum, value) => sum + serialize([value.baseline, value.estimates, sharedState]).byteLength, 0);
    assert.ok(budget.bytes >= proof.byteLength + independent, 'independent native payload sizes are covered');
    assert.ok(budget.bytes >= proof.byteLength + exact, 'all retained payloads are covered');
    assert.ok(budget.bytes <= byteLimit); assert.ok(exact <= snapshotByteLimit);
    for (const owner of ['0', '1', '2']) {
      const own = [...entries].filter(([key]) => owners.get(key) === owner)
        .reduce((sum, [key, value]) => sum + snapshotBytes(value, sharedState) + Buffer.byteLength(key) + Buffer.byteLength(owner), 0);
      assert.ok(own <= ownerByteLimit);
    }
  }
  assert.ok(entries.size < 60); assert.ok(budget.touch(proof));
});


test('immutable state sizing is shared across member snapshots and forced refresh measures changes', () => {
  let reads = 0;
  const sharedState = { ...state, get payload() { reads++; return 's'.repeat(70000); } };
  const entries = new Map(), budget = createWorkerCacheBudget(1024 * 1024), cache = createSnapshotCache(entries, budget);
  cache.set('a', value('a'), sharedState, '1'); cache.set('b', value('b'), sharedState, '1');
  assert.equal(reads, 1); const before = budget.bytes;
  sharedState.extra = 'x'.repeat(10000); cache.refresh(entries.get('a'), true);
  assert.equal(reads, 2); assert.ok(budget.bytes > before);
  // Replacing a state root must get its own measurement, including large data.
  cache.set('c', value('c'), { ...state, payload: 'x'.repeat(2 * 1024 * 1024) }, '2');
  assert.equal(entries.has('c'), false); assert.ok(budget.bytes <= budget.byteLimit);
});

test('planning growth bounds native bytes without walking the stable baseline again', () => {
  let reads = 0;
  const shared = { text: 'wide \u6f22\u5b57 and Latin \u00e9' };
  const tasks = Array.from({ length: 80 }, (_, i) => ({ id: `task-${i}`, record: { shared, payload: 'x'.repeat(1000) } }));
  const snapshot = { baseline: { tasks, metrics: {}, get stable() { reads++; return 'large'.repeat(1000); } }, estimates: new Map() };
  const entries = new Map(), budget = createWorkerCacheBudget(64 * 1024 * 1024), cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  assert.equal(reads, 1);
  const byLocation = new Map();
  for (let i = 0; i < 1000; i++) byLocation.set(`location-${i}`, new Map(tasks.slice(0, 20).map(task => [task.id, {
    task, evidence: [{ location: `location-${i}`, reason: 'ASCII \u00e9 \u6f22\u5b57 ^ evidence' }],
  }])));
  const marker = {};
  snapshot.planningIndex = trackPlanningIndex({ byLocation, clueLocations: new Map([['clue', Array(20000).fill(marker)]]) }, snapshot.baseline);
  cache.refresh(snapshot);
  assert.equal(reads, 1, 'new planning data must not reserialize the baseline');
  assert.equal(entries.size, 1);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state) + 2, 'producer fast path agrees with independent validated sizing');
  const native = () => serialize([snapshot.baseline, snapshot.baseline.processing, snapshot.planningIndex.byLocation,
    snapshot.planningIndex.clueLocations, snapshot.playResult, snapshot.sandboxDelta, snapshot.estimates, state]).byteLength;
  assert.ok(budget.bytes >= native(), 'cover an independent joint native measurement, including reference-ID growth');
  const playAlias = {};
  snapshot.playResult = { repeated: Array(20000).fill(playAlias) };
  cache.refresh(snapshot);
  assert.ok(budget.bytes >= native());
  const row = byLocation.values().next().value.values().next().value;
  row.evidence.push({ location: 'new', reason: '\u6f22'.repeat(5000) });
  cache.refresh(snapshot, true);
  assert.ok(budget.bytes >= native(), 'forced in-place planning growth is covered');
  row.evidence[0].extra = 'z'.repeat(30000); cache.refresh(snapshot, true);
  assert.ok(budget.bytes >= native(), 'forced unknown fields revoke the producer proof');
});

test('unrecognized planning shapes keep joint native sizing and shared aliases', () => {
  const task = { payload: 'x'.repeat(4000) }, snapshot = { baseline: { tasks: [task], metrics: {} } };
  const entries = new Map(), budget = createWorkerCacheBudget(1024 * 1024), cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  snapshot.planningIndex = { byLocation: new Map([['location', new Map([['task', {
    task, evidence: [{ location: 'location', reason: 'evidence', extra: 'x'.repeat(20000) }],
  }]])]]), clueLocations: new Map() };
  cache.refresh(snapshot);
  const native = serialize([snapshot.baseline, snapshot.planningIndex.byLocation, snapshot.planningIndex.clueLocations, state]).byteLength;
  assert.ok(budget.bytes >= native);
  assert.equal(entries.size, 1);
});


test('context-owned state is released after views materialize and replacement context is charged', () => {
  const input = { ...state, payload: 's'.repeat(200000) }, snapshot = value('a');
  let context = { state: input, equipment: {} };
  const entries = new Map(), budget = createWorkerCacheBudget(4 * 1024 * 1024);
  const cache = createSnapshotCache(entries, budget, { context: () => context, contextOwnsState: true });
  cache.set('a', snapshot, input, '1');
  const before = budget.bytes;
  assert.ok(before >= serialize(input).byteLength);
  context = undefined; cache.refresh(snapshot);
  assert.ok(budget.bytes < before - 190000, 'accounting metadata must not become a state owner');
  assert.ok(budget.bytes >= serialize(snapshot.baseline).byteLength);
  context = { state: { ...state, payload: 't'.repeat(300000) }, equipment: {} }; cache.refresh(snapshot);
  assert.ok(budget.bytes >= serialize(context.state).byteLength);
  assert.ok(budget.bytes <= budget.byteLimit);
});


test('staged oversized drafts leave the baseline and prior draft ledger untouched', () => {
  const baseline = value('a'), old = { playResult: { tasks: [] } };
  const budget = createWorkerCacheBudget(16 * cost), complete = new Map(), drafts = new Map();
  const current = createSnapshotCache(complete, budget), cache = createSnapshotCache(drafts, budget);
  current.set('base', baseline, state, 'one'); cache.set('draft', old, undefined, 'one');
  const before = budget.bytes, count = budget.size;
  const candidate = { baseline: { tasks: [{ payload: 'x'.repeat(100 * cost) }] }, playResult: old.playResult };
  cache.stage('draft', candidate, undefined, 'one');
  cache.capture(candidate, state); cache.refresh(candidate);
  assert.equal(budget.bytes, before, 'building optional fields must not publish an intermediate entry');
  assert.equal(cache.set('draft', candidate, undefined, 'one', { preserve: [baseline] }), false);
  assert.equal(complete.get('base'), baseline); assert.equal(drafts.get('draft'), old);
  assert.equal(budget.bytes, before); assert.equal(budget.size, count);
});

test('protected admission rejects combined pressure before evicting and copies prediction charges', () => {
  const entries = new Map(), budget = createEligibilityBudget({ byteLimit: 100 * cost, ownerByteLimit: 3 * cost });
  const cache = createSnapshotCache(entries, budget), baseline = value('a'), draft = value('b');
  cache.set('base', baseline, state, 'one'); cache.set('draft', draft, state, 'one');
  const before = budget.bytes;
  const large = { baseline: { tasks: [{ payload: 'x'.repeat(2 * cost) }] } };
  cache.stage('draft', large, undefined, 'one');
  assert.equal(cache.set('draft', large, undefined, 'one', { preserve: [baseline] }), false);
  assert.equal(entries.get('draft'), draft); assert.equal(entries.get('base'), baseline); assert.equal(budget.bytes, before);
  draft.predict = () => {}; cache.capture(draft, state);
  const copy = { ...draft }; cache.stage('draft', copy, state, 'one');
  assert.equal(cache.measure(copy), cache.measure(draft));
  assert.ok(cache.measure(copy) >= snapshotBytes(copy, state, undefined, undefined, serialize(state).byteLength) + 8);
});


test('prediction clone bounds reuse an immutable source and cover changed graph references', () => {
  const shared = { payload: 'wide \u6f22 ^'.repeat(1000) };
  const source = { tasks: Array(100).fill(shared), members: [{ id: 'one', unlocked: ['a'] }], rules: {} };
  const snapshot = { baseline: { tasks: [] } }, budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget); cache.set('a', snapshot, source, 'one');
  const hypothetical = { ...source, members: [{ id: 'one', unlocked: ['a', 'b'], alias: shared }] };
  const before = budget.bytes; snapshot.predict = () => {}; cache.capture(snapshot, hypothetical, source);
  assert.ok(budget.bytes - before >= serialize(hypothetical).byteLength);
  assert.ok(budget.bytes <= budget.byteLimit);
});


test('Latin-1 text with two-byte backing strings receives its full native charge', () => {
  const task = { id: 'task' }, baseline = { tasks: [task] };
  const reason = ('\u6f22' + 'a'.repeat(200)).slice(1);
  assert.ok(serialize(reason).byteLength > 400);
  const index = { byLocation: new Map([['location', new Map([['task', { task,
    evidence: Array.from({ length: 10000 }, () => ({ location: 'location', reason })) }]])]]), clueLocations: new Map() };
  const snapshot = { baseline, planningIndex: trackPlanningIndex(index, baseline) }, budget = createWorkerCacheBudget(32 * 1024 * 1024);
  const cache = createSnapshotCache(new Map(), budget); cache.set('a', snapshot, undefined, '1');
  assert.ok(budget.bytes >= serialize([baseline, index.byLocation, index.clueLocations]).byteLength);
});


test('releasing large measurement buffers never detaches retained caller data', () => {
  const data = new Uint8Array(200000).fill(7), state = { data }, snapshot = { baseline: { tasks: [{ data }] } };
  const budget = createWorkerCacheBudget(4 * 1024 * 1024), cache = createSnapshotCache(new Map(), budget);
  cache.set('a', snapshot, state, '1'); cache.refresh(snapshot, true);
  assert.equal(data.byteLength, 200000); assert.equal(data.buffer.byteLength, 200000);
  assert.ok(data.every(value => value === 7));
  assert.ok(budget.bytes >= serialize([snapshot.baseline, state]).byteLength);
});


test('producer proof bounds cover additions and aliases without rereading immutable engine rows', () => {
  let reads = 0;
  const source = { ...state, rules: {}, members: [{ id: 'same', completedTasks: [], taskStatus: {} }] };
  const producerBudget = createEligibilityBudget({ byteLimit: 8 * 1024 * 1024 });
  const proof = createEligibilityCache({ budget: producerBudget });
  const shared = { text: '漢 wide '.repeat(200) };
  const baseline = producerBudget.measureResult(() => proof.evaluate(source, 'same', undefined, () => ({
    tasks: Array.from({ length: 500 }, (_, i) => ({ id: `core-${i}`, challengeSatisfied: false,
      record: { get text() { reads++; return ('漢' + 'Latin slice '.repeat(40)).slice(1); }, shared } })),
    access: { shared, values: ['plain', '漢'] }, items: [], diagnostics: [{ text: 'original' }], metrics: { availableCount: 1 },
  })));
  trackSnapshotCore(baseline);
  const measured = reads;
  const core = [...baseline.tasks];
  baseline.tasks = [...core, { id: 'extra', record: { text: 'new 漢'.repeat(100) } }];
  baseline.diagnostics.push({ text: 'additional 漢'.repeat(80) });
  baseline.metrics.availableCount = 500000;
  baseline.presentation = { tasks: core, diagnostics: [], metrics: { count: core.length } };
  baseline.collectionPlanning = { extra: baseline.tasks.at(-1) };
  const snapshot = { baseline, playResult: { access: baseline.access, tasks: [{ id: 'extra' }] }, sandboxDelta: { count: 1 } };
  const budget = createWorkerCacheBudget(16 * 1024 * 1024), cache = createSnapshotCache(new Map(), budget);
  assert.equal(cache.set('a', snapshot, undefined, '1'), true);
  assert.equal(reads, measured, 'native sizing must not reread the already serialized core rows');
  const native = serialize([baseline, baseline.processing, undefined, undefined, snapshot.playResult, snapshot.sandboxDelta]).byteLength + 2;
  assert.ok(budget.bytes >= native, `producer bound ${budget.bytes} must cover independent native ${native}`);
  cache.refresh(snapshot, true);
  assert.ok(reads > measured, 'forced refresh revokes producer trust and measures the graph');
  assert.equal(budget.bytes, snapshotBytes(snapshot, undefined) + 2);
});
