// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { taskWhyDisplay, TASK_WHY_DISPLAY_LIMIT, WRITER_WHY_BUDGET } from '../app/tasks/task-why-display.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { savedWhyDisplay, validateWhyDisplay, createSavedWhyEvidence } from '../app/task-why-http.mjs';
import { createViewCache } from '../app/web/browser-state.mjs';
import { appendTaskWhy, loadTaskWhyEvidence, renderTaskWhy } from '../app/web/task-why.mjs';

const wire = value => JSON.parse(JSON.stringify(value));
const locationName = id => `Place ${id}`;
const describeRule = id => ({ label: id, section: 'Fixture rules', on: true, source: 'Personal override', value: id === 'Rare Drop Amount' ? 1000 : true });
function fixture(memberId, groupOn) {
  const tasks = [
    { id: 'locked', label: 'Locked quest', category: 'Quest', status: 'blocked', record: { Category: ['Quests'], Tasks: { 'Missing goal': 'Extra' } } },
    { id: 'missing', label: 'Missing goal', category: 'Extra', status: 'blocked', record: { Label: 'Special goals', Monsters: ['Fixture boss'] }, sourcePolicyRejections: [{ detail: 'Shared source is off.' }], sourceExclusion: { detail: 'Excluded source.' } },
    { id: 'set-low', label: 'Basic tool', category: 'Smithing', status: 'blocked', record: { Set: 'Tools' }, blockers: [{ kind: 'outclassed' }] },
    { id: 'set-high', label: 'Better tool', category: 'Smithing', status: 'available', record: { Set: 'Tools', Category: ['Tools'] } },
    { id: 'slayer', label: 'Slayer unlock', category: 'Slayer', status: 'blocked', record: {}, slayerUnlockGate: { ruleId: 'Slayer Unlock', open: false, reason: 'Need points.' } },
    ...['Nonskill', 'Diary', 'BiS', 'Woodcutting', 'Extra'].map((category, i) => ({ id: `kind-${i}`, label: `Goal ${i}`, category, status: 'available', record: { Tasks: { 'Missing goal': 'Extra' } } })),
  ];
  for (const task of tasks) task.sources = [{ kind: 'drop', source: 'Fixture boss', location: ['100-1', '200'], rate: '1/2000', probability: 0.0005 },
    { kind: 'shop', name: 'Fixture shop', location: { id: '300' } }, { kind: 'task', task: 'Prepare' }, { kind: 'drop', source: 'Fourth source', probability: 0.0001 }];
  tasks[1].status = memberId === 'one' || groupOn ? 'available' : 'blocked';
  return { tasks, bossGates: [{ boss: 'Fixture boss', monsters: ['Fixture boss'], open: groupOn, reason: memberId === 'one' ? 'Own gate.' : 'Personal gate.' }],
    presentation: { suppressed: { missing: ['Task is not available.', 'Personal requirement.', 'Second reason.'] },
      diagnostics: [{ kind: 'unavailable-task-alternative', chosen: 'missing', detail: 'Saved fallback choice.' }, { kind: 'unrelated', detail: 'Must not travel.' }] } };
}

class Node {
  constructor(tag) { this.tag = tag; this.children = []; }
  append(...children) { this.children.push(...children); }
}
const document = { createElement: tag => new Node(tag) };
const rendered = why => JSON.stringify(renderTaskWhy(why, { document }));

test('wire evidence preserves complete Why content and rendered order across task kinds, members and Group', () => {
  let cases = 0;
  for (const groupOn of [false, true]) for (const memberId of ['one', 'two']) {
    const result = fixture(memberId, groupOn), before = wire(result);
    for (const task of result.tasks) {
      const display = wire(taskWhyDisplay(result, task.id, memberId, 7));
      const full = explainTask(task, { result, describeRule, locationName });
      const narrow = explainTask(display.task, { ...display, describeRule, locationName });
      assert.deepEqual(wire(narrow), wire(full), `${groupOn}/${memberId}/${task.id}`);
      assert.equal(rendered(narrow), rendered(full));
      assert.ok(Buffer.byteLength(JSON.stringify(display)) <= TASK_WHY_DISPLAY_LIMIT);
      cases++;
    }
    assert.deepEqual(wire(result), before);
  }
  assert.equal(cases, 40);
});

test('saved evidence validates selectors, rejects old revisions during parse and never truncates', async t => {
  const evidence = createSavedWhyEvidence(); t.after(() => evidence.close());
  const result = fixture('one', false), entry = { revision: 7, fullGzip: gzipSync(JSON.stringify(result)) };
  const query = new URLSearchParams('view=display-v1&memberId=one&taskId=missing&revision=7');
  const scope = { revision: 7, members: new Set(['one', 'two']) };
  validateWhyDisplay(query, scope);
  assert.throws(() => validateWhyDisplay(query, { ...scope, revision: 8 }), { status: 409 });
  for (const extra of ['&taskId=locked', '&master=x', '&assignment=x']) assert.throws(() => validateWhyDisplay(new URLSearchParams(query + extra), scope), { status: 400 });
  assert.equal(await savedWhyDisplay(query, { revision: 7, currentRevision: () => 7 }), undefined);
  await assert.rejects(savedWhyDisplay(query, { revision: 7, entry, currentRevision: () => 8, evidence }), { status: 409 });
  const display = await savedWhyDisplay(query, { revision: 7, entry, currentRevision: () => 7, evidence });
  assert.equal(display.task.id, 'missing');
  result.tasks[1].sourceExclusion.detail = '🪨'.repeat(TASK_WHY_DISPLAY_LIMIT);
  assert.equal(taskWhyDisplay(result, 'missing', 'one', 7), undefined);
  assert.equal(taskWhyDisplay(result, 'absent', 'one', 7), undefined);
});

test('per-task loader uses one call; unavailable/unsupported responses keep the full-path fallback', async () => {
  const result = fixture('two', true), calls = [];
  const display = wire(taskWhyDisplay(result, 'missing', 'two', 7));
  const read = async path => { calls.push(path); return display; };
  assert.deepEqual(await loadTaskWhyEvidence(read, 'missing', 'two', 7, () => true), display);
  assert.equal(calls.length, 1); assert.match(calls[0], /view=display-v1.*memberId=two/);
  for (const error of [{ status: 409, code: 'TASK_WHY_UNAVAILABLE' }, { status: 404 }, { status: 400 }, { status: 503 }]) {
    let fullCalls = 0;
    const narrow = await loadTaskWhyEvidence(async () => { throw error; }, 'missing', 'two', 7, () => true);
    const value = narrow ?? await (async () => { fullCalls++; return result; })();
    assert.equal(value, result); assert.equal(fullCalls, 1);
  }
});

test('per-task loader never accepts a stale member, revision or changed browser scope', async () => {
  const display = wire(taskWhyDisplay(fixture('one', false), 'missing', 'one', 7));
  for (const value of [{ ...display, stateRevision: 6 }, { ...display, memberId: 'two' }]) {
    await assert.rejects(loadTaskWhyEvidence(async () => value, 'missing', 'one', 7, () => true), /saved state changed/);
  }
  await assert.rejects(loadTaskWhyEvidence(async () => display, 'missing', 'one', 7, () => false), /saved state changed/);
  await assert.rejects(loadTaskWhyEvidence(async () => { throw { status: 409 }; }, 'missing', 'one', 7, () => true), { status: 409 });
  await assert.rejects(loadTaskWhyEvidence(async () => { throw { code: 'TASK_WHY_UNAVAILABLE' }; }, 'missing', 'one', 7, () => false), /saved state changed/);
});

test('the shipped screen loader uses per-task evidence for selected and peer rows, and falls back unchanged', async () => {
  const source = (await readFile(new URL('../app/web/screen-tasks.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  for (const ownerId of ['one', 'two']) for (const available of [true, false]) {
    const result = { ...fixture(ownerId, true), memberId: ownerId, stateRevision: 7 }, calls = [];
    let duoOptions, whyOptions;
    const c = { state: { revision: 7, members: [{ id: 'one' }, { id: 'two' }] }, memberId: 'one',
      sandbox: { active: false, signature: () => '' }, canWrite: () => true, preferences: () => ({}),
      plain: String, world: { chunks: new Map(['100-1', '300'].map(id => [id, { name: id }])), areas: new Map() },
      $: () => ({ parentElement: { after() {} } }), el: () => ({}), duoDetails: new Map(), duoDetailRequests: new Map(),
      ensureFullResult: async () => { calls.push('full'); return result; }, ensureFullDefinitions: async () => { calls.push('definitions'); },
      api: async url => {
        calls.push(url);
        if (url.includes('/api/task-why?')) {
          if (!available) throw Object.assign(new Error('Unavailable'), { status: 409, code: 'TASK_WHY_UNAVAILABLE' });
          return wire(taskWhyDisplay(result, 'missing', ownerId, 7));
        }
        return result;
      },
    };
    runInContext(source + '\ncreateScreenTasks(c);', createContext({ c, document: { head: { append() {} } },
      createTaskClaimClock: () => ({}), createTaskIconPainter: () => ({}),
      createDuoTaskView: options => { duoOptions = options; return { controls() {} }; },
      appendTaskWhy: (row, task, options) => { whyOptions = options; }, appendTaskHow() {}, isCustomTask: () => false,
      loadTaskWhyEvidence, catalogued: value => value, createRuleDescriber: async () => describeRule,
    }));
    c.duoView(); duoOptions.appendWhy({}, result.tasks[1], ownerId);
    const loaded = await whyOptions.load(result.tasks[1]);
    assert.deepEqual(wire(explainTask(loaded.task, loaded)), wire(explainTask(result.tasks[1], { result, describeRule })));
    assert.equal(calls.filter(url => url.includes('/api/task-why?')).length, 1);
    if (available) assert.equal(calls.length, 1, 'no full tasks or definitions supplement');
    else if (ownerId === 'one') assert.deepEqual(calls.slice(1), ['full']);
    else assert.deepEqual(calls.slice(1), ['/api/tasks?memberId=two', 'definitions']);
  }
});

test('Why paints only an exact revision from the shared display cache', async () => {
  for (const cachedRevision of [6, 7]) {
  const make = tag => ({ tag, children: [], events: {}, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, setAttribute() {}, addEventListener(name, action) { this.events[name] = action; } });
  const doc = { createElement: make }, row = make('div'); let resolve;
  const cache = createViewCache({ storage: undefined }); cache.configure({ picker: 'fixture' });
  cache.remember('why', 'missing', cachedRevision, { rules: [], sources: [], neededFor: [], hidden: ['Cached answer'] });
  const toggle = appendTaskWhy(row, { id: 'missing', label: 'Missing goal' }, { document: doc, cache, revision: () => 7,
    button: (text, action) => { const node = make('button'); node.events.click = action; return node; }, icon: () => make('span'),
    load: () => new Promise(done => { resolve = done; }), scope: () => 'one:7' });
  const pending = toggle.events.click();
  assert.equal(JSON.stringify(row).includes('Cached answer'), cachedRevision === 7);
  resolve({ task: { id: 'missing', label: 'Current goal' }, result: { tasks: [] } }); await pending;
  assert.ok(!JSON.stringify(row).includes('Cached answer'));
  }
});

test('unrelated graph traversal and index allocation stop at admission budgets', () => {
  for (const limits of [undefined, WRITER_WHY_BUDGET]) {
    const stats = {}, tasks = new Array(1_000_000);
    Object.defineProperty(tasks, 0, { get() { assert.fail('must reject length before touching rows'); } });
    assert.equal(taskWhyDisplay({ tasks }, 'missing', 'one', 7, { limits, stats }), undefined);
    assert.equal(stats.work, 0); assert.equal(stats.allocation, 0); assert.equal(stats.serialized, 0);
  }
  const result = fixture('one', false), stats = {};
  result.tasks[0].record.Tasks = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`Dependency ${i}`, 'Extra']));
  assert.equal(taskWhyDisplay(result, 'missing', 'one', 7, { limits: WRITER_WHY_BUDGET, stats }), undefined);
  assert.ok(stats.work <= WRITER_WHY_BUDGET.work); assert.ok(stats.allocation <= WRITER_WHY_BUDGET.allocation);
  assert.equal(stats.serialized, 0);
});

test('oversized projection inputs never allocate the projection or serialize it', () => {
  const result = fixture('one', false), stats = {};
  const sources = new Array(1_000_000);
  Object.defineProperty(sources, 0, { get() { assert.fail('must reject oversized source array before walking it'); } });
  result.tasks[1].sources = sources;
  assert.equal(taskWhyDisplay(result, 'missing', 'one', 7, { stats }), undefined);
  assert.equal(stats.serialized, 0);
  assert.equal(stats.derived, 0);
  result.tasks[1].sources = [{ detail: 'x'.repeat(1_000_000) }];
  assert.equal(taskWhyDisplay(result, 'missing', 'one', 7, { stats }), undefined);
  assert.ok(stats.allocation < TASK_WHY_DISPLAY_LIMIT); assert.equal(stats.serialized, 0);
  result.tasks[1].sources = [];
  result.tasks.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `set-${i}`, label: 'Outclassed tool'.repeat(8), category: 'Smithing',
    record: { Set: 'Tools' }, blockers: [{ kind: 'outclassed' }] })));
  assert.equal(taskWhyDisplay(result, 'set-high', 'one', 7, { stats }), undefined);
  assert.equal(stats.serialized, 0, 'oversized set answer is rejected before mapping all its labels');
  assert.equal(stats.derived, 0);
});

test('transfer bytes are row-bounded as unrelated catalogue/definitions grow', t => {
  const result = fixture('one', false), taskId = 'missing';
  const base = taskWhyDisplay(result, taskId, 'one', 7);
  result.tasks.push(...Array.from({ length: 4000 }, (_, i) => ({ id: `unrelated-${i}`, label: `Unrelated ${i}`, category: 'Extra', record: { Description: `${i}:` + 'unrelated text '.repeat(80) } })));
  const definitions = { challenges: { Extra: Object.fromEntries(result.tasks.map(task => [task.label, task.record])) } };
  const narrow = Buffer.from(JSON.stringify(taskWhyDisplay(result, taskId, 'one', 7)));
  const full = Buffer.from(JSON.stringify(result)), defs = Buffer.from(JSON.stringify(definitions));
  assert.deepEqual(JSON.parse(narrow), wire(base));
  assert.ok(narrow.length < 4096);
  assert.ok(gzipSync(narrow).length < gzipSync(full).length + gzipSync(defs).length);
  t.diagnostic(JSON.stringify({ synthetic: true, full: { calls: 2, rawBytes: full.length + defs.length, gzipBytes: gzipSync(full).length + gzipSync(defs).length }, perTask: { calls: 1, rawBytes: narrow.length, gzipBytes: gzipSync(narrow).length } }));
});
