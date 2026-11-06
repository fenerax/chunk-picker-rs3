// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createTaskWhyIndex, taskWhyDisplay, WHY_INDEX_BUDGET } from '../app/tasks/task-why-display.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { buildWhyChain } from '../app/tasks/why-chain.mjs';
import { createWorkerCacheBudget, createSnapshotCache, snapshotBytes } from '../app/tasks/snapshot-cache.mjs';
import { savedWhyChain, createSavedWhyEvidence } from '../app/task-why-http.mjs';
import { createWhyChainDisclosure, loadWhyChain } from '../app/web/task-why-chain.mjs';
import { whyScaleFixture } from './fixtures/why-scale.mjs';

const wire = value => JSON.parse(JSON.stringify(value));
const selectors = [{ taskId: 'slay' }, { master: 'Example master', assignment: 'Cave bugs' }];
class Node {
  constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.events = {}; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  setAttribute() {}
  addEventListener(name, action) { this.events[name] = action; }
}
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const context = api => ({ api, el: (tag, value) => new Node(tag, value),
  button: (label, action) => Object.assign(new Node('button', label), { action }),
  details: (label, body) => { const node = new Node('details', label); node.append(body); return node; } });

test('20.5k task evidence uses a charged reusable index and selected traversal budgets', t => {
  const { result, state } = whyScaleFixture(20_560), indexStats = {};
  const index = createTaskWhyIndex(result, { stats: indexStats }); assert.ok(index);
  assert.ok(indexStats.work <= WHY_INDEX_BUDGET.work); assert.ok(indexStats.allocation <= WHY_INDEX_BUDGET.allocation);
  const budget = createWorkerCacheBudget(), entries = new Map(), cache = createSnapshotCache(entries, budget);
  const snapshot = { baseline: result, estimates: new Map() };
  assert.equal(cache.set('fixture', snapshot, state, 'player'), true); const before = budget.bytes;
  snapshot.whyIndex = index; assert.equal(cache.set('fixture', snapshot, state, 'player'), true);
  assert.ok(budget.bytes > before); assert.equal(budget.bytes, snapshotBytes(snapshot, state) + Buffer.byteLength('fixtureplayer'));
  for (const id of ['slay', 'quest2', 'synthetic:160', 'synthetic:161']) {
    const stats = {}, display = taskWhyDisplay(result, id, 'player', 7, { index, stats }); assert.ok(display, id);
    assert.deepEqual(wire(explainTask(display.task, display)), wire(explainTask(result.tasks.find(row => row.id === id), { result })));
    assert.ok(stats.work < 32_768, `${id}: reads traverse selected buckets, not the catalogue`);
    const size = Buffer.byteLength(JSON.stringify(display)); assert.ok(size < 8192);
    t.diagnostic(JSON.stringify({ taskId: id, narrowCalls: 1, rawBytes: size, work: stats.work }));
  }
  assert.equal(snapshot.whyIndex, index); cache.refresh(snapshot); assert.ok(entries.has('fixture'));
  const oversized = new Array(1_000_000);
  Object.defineProperty(oversized, 0, { get() { assert.fail('oversized selected inputs must refuse before traversal'); } });
  result.tasks[0].sources = oversized;
  const refused = {}; assert.equal(taskWhyDisplay(result, result.tasks[0].id, 'player', 7, { index, stats: refused }), undefined);
  assert.equal(refused.derived, 0); assert.equal(refused.serialized, 0);
  budget.forget(snapshot); entries.clear(); assert.equal(budget.bytes, 0);
});

test('Lumbridge-only 20,436-task saved Why-chain refusals recover for tasks and Slayer', async t => {
  const { result, definitions, state } = whyScaleFixture(), raw = Buffer.from(JSON.stringify(result));
  assert.equal(result.tasks.length, 20_436); assert.deepEqual(state.members[0].unlocked, ['12850']);
  assert.ok(raw.length > 22_000_000 && raw.length < 30_000_000, String(raw.length));
  const entry = { revision: 7, fullGzip: gzipSync(raw) }, evidence = createSavedWhyEvidence(); t.after(() => evidence.close());
  for (const selector of selectors) {
    let narrow = 0, full = 0;
    const c = context(async () => { narrow++; return savedWhyChain(new URLSearchParams({ memberId: 'player', revision: '7', ...selector }), {
      revision: 7, members: new Set(['player']), entry, definitions, currentRevision: () => 7, evidence,
    }); });
    const chain = await loadWhyChain(c, selector, { memberId: 'player', revision: 7,
      loadFull: async () => { full += 2; return { result, definitions }; } });
    assert.deepEqual(chain, { ...buildWhyChain(result, definitions, selector), memberId: 'player', stateRevision: 7 });
    assert.equal(narrow, 1); assert.equal(full, 2); assert.equal(evidence.stats().bytes, 0);
    t.diagnostic(JSON.stringify({ synthetic: true, tasks: result.tasks.length, fullRawBytes: raw.length, fallbackCalls: narrow + full, chainRawBytes: Buffer.byteLength(JSON.stringify(chain)) }));
  }
});

test('adversarial indexed fan-out refuses before sorting and full details still answer', async () => {
  const { result, definitions } = whyScaleFixture(20_560);
  for (const row of result.tasks.slice(20)) row.record.Tasks = { 'Swamp caves': 'Nonskill' };
  const index = createTaskWhyIndex(result); assert.ok(index);
  const stats = {}; assert.equal(taskWhyDisplay(result, 'caves', 'player', 7, { index, stats }), undefined);
  assert.ok(stats.work <= 400_000); assert.equal(stats.serialized, 0);
  const c = context(async () => { throw { code: 'TASK_WHY_UNAVAILABLE', status: 409 }; });
  const chain = await loadWhyChain(c, { taskId: 'slay' }, { memberId: 'player', revision: 7, loadFull: async () => ({ result, definitions }) });
  assert.deepEqual(chain.root, buildWhyChain(result, definitions, { taskId: 'slay' }).root);
  const stats2 = {}, tasks = new Array(1_000_000);
  Object.defineProperty(tasks, 0, { get() { assert.fail('row admission must precede index allocation'); } });
  assert.equal(createTaskWhyIndex({ tasks }, { stats: stats2 }), undefined); assert.equal(stats2.work, 0);
});

test('both disclosures recover after refusal and a transient full-loader failure; stale full details never paint', async () => {
  const { result, definitions } = whyScaleFixture(50);
  for (const selector of selectors) {
    let calls = 0, full = 0;
    const c = context(async () => { calls++; throw { status: 409, code: 'TASK_WHY_UNAVAILABLE' }; });
    const node = createWhyChainDisclosure(c, selector, { memberId: 'player', revision: 7, loadFull: async () => {
      if (++full === 1) throw new Error('Full details temporarily unavailable'); return { result, definitions };
    } });
    node.open = true; await node.events.toggle(); assert.match(text(node), /Retry Why not/);
    await node.children[0].children[1].action(); assert.doesNotMatch(text(node), /Retry Why not/);
    assert.match(text(node), /All needed:|Either route/); assert.equal(calls, 2); assert.equal(full, 2);
    await node.events.toggle(); assert.equal(calls, 2);
    for (const bad of [{ ...result, stateRevision: 6 }, { ...result, memberId: 'peer' }, { ...result, format: 'play-v1' }]) {
      await assert.rejects(loadWhyChain(c, selector, { memberId: 'player', revision: 7, loadFull: async () => ({ result: bad, definitions }) }), /Saved details changed/);
    }
  }
});
