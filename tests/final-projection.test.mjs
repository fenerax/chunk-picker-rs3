import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { canonical } from '../tools/calc-check/compare.mjs';
import { buildWhyChain } from '../app/tasks/why-chain.mjs';
import { createProjectionRecorder, instrumentProjection } from '../scripts/perf/final-projection-builders.mjs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const definitions = () => ({
  chunks: {
    100: { Spawn: { Coin: 1 }, Connect: { Room: true } },
    101: { Object: { Tree: 1 }, NPC: { Supplier: 1 } }, Room: { Object: { Chest: 1 } },
  },
  challenges: {
    Nonskill: { Key: { Chunks: ['101'], Output: 'Key' }, Room: { UnlocksArea: true, Items: ['Key'] },
      'Circular key': { Items: ['Loop'], Output: 'Key' }, Loop: { Items: ['Key'], Output: 'Loop' },
      'Free supply': { Chunks: ['101'], Output: 'Supply' }, 'Constrained supply': { Chunks: ['100'], Reward: 'Supply' } },
    Woodcutting: { Cut: { Level: 1, Objects: ['Tree'], Primary: true, Output: 'Log' } },
    Quest: { Step: { Items: ['Log'], BaseQuest: 'Fixture quest' },
      Finish: { Chunks: ['101'], Tasks: { Step: 'Quest' }, BaseQuest: 'Fixture quest', QuestPoints: 1,
        FiniteRewards: [{ item: 'Prize', quantity: 10 }] },
      Unsupported: { Mystery: true, FiniteRewards: [{ item: 'Prize', quantity: 1 }] } },
    Extra: { Use: { Items: ['Supply'], NonShop: true, AllowedSources: ['Constrained supply'], Source: 'reward' },
      Local: { Objects: ['Chest'] }, Alias: { Items: ['Options[+]x2'] } },
  }, codeItems: { itemsPlus: { 'Options[+]': ['Coin', 'Key'] } },
});
const state = () => ({ rules: { 'content.f2p': false }, taskRules: {}, members: [
  { id: 'm', unlocked: ['100'], selected: [], pendingRoll: [], blacklisted: [], completedTasks: [] },
  { id: 'p', unlocked: ['101'], completedTasks: [] },
] });
const engine = (data, fast) => createTaskEngine(data, { reviewedOverlays: false, metadataCorrections: false,
  equipmentCorrections: false, projectionFast: fast });

test('projection matches reference through additions, gates, quests, source policies and removals', () => {
  const data = definitions(), fast = engine(data, true), reference = engine(data, false), input = state();
  const changes = [() => {}, s => s.members[0].unlocked.push('101'),
    s => s.members[0].completedTasks.push(taskId('Quest', 'Finish')),
    s => { s.members[0].sourceBacklogs = { items: { Key: true } }; },
    s => { s.members[0].taskStatus = { [taskId('Nonskill', 'Key')]: { backlogged: true } }; },
    s => { s.members[0].sourceBacklogs = {}; s.members[0].taskStatus = {}; s.members[0].unlocked = ['100']; s.members[0].blacklisted = ['101']; },
    s => { s.members.reverse(); s.members.find(m => m.id === 'p').unlocked = []; },
    s => { s.rules['access.shared'] = false; },
  ];
  for (const change of changes) {
    change(input);
    for (const member of input.members) {
      const expected = reference.evaluate(input, member.id), actual = fast.evaluate(input, member.id);
      assert.deepEqual(canonical(actual), canonical(expected));
      const uncached = { reuseEligibility: false, reuseObligations: false };
      const cold = reference.evaluate(input, member.id, uncached);
      assert.deepEqual(canonical(actual), canonical(cold));
      assert.deepEqual(canonical(fast.evaluate(input, member.id, uncached)), canonical(cold));
      for (const label of ['Use', 'Finish', 'Local']) {
        const category = label === 'Finish' ? 'Quest' : 'Extra', id = taskId(category, label);
        assert.deepEqual(canonical(fast.how(input, member.id, id, { baseline: actual })),
          canonical(reference.how(input, member.id, id, { baseline: expected })));
        assert.deepEqual(buildWhyChain(actual, data, { taskId: id }), buildWhyChain(expected, data, { taskId: id }));
      }
    }
  }
});

test('large prolific and circular producer catalogues remain reference-equivalent and results stay private', () => {
  const data = definitions();
  for (let index = 0; index < 4200; index++) data.challenges.Nonskill[`Producer ${index}`] = { Chunks: [index % 2 ? '100' : '101'], Output: 'Supply' };
  const fast = engine(data, true), reference = engine(data, false), input = state();
  for (const unlocked of [['100'], ['100', '101'], []]) {
    input.members[0].unlocked = unlocked;
    const expected = reference.evaluate(input, 'm'), actual = fast.evaluate(input, 'm');
    assert.deepEqual(canonical(actual), canonical(expected));
    actual.tasks[0].sources.push({ kind: 'mutated' }); actual.items.length = 0;
    assert.deepEqual(canonical(fast.evaluate(input, 'm')), canonical(expected));
  }
  const changed = definitions(); changed.chunks[100].Spawn = { Other: 1 };
  assert.deepEqual(canonical(engine(changed, true).evaluate(input, 'm')), canonical(engine(changed, false).evaluate(input, 'm')));
});

test('zero switch overrides an explicit opt-in and row rewards retain supported/unsupported semantics', () => {
  const previous = process.env.RS3_FINAL_PROJECTION;
  try {
    process.env.RS3_FINAL_PROJECTION = '0';
    const input = state(); input.members[0].unlocked.push('101');
    const a = engine(definitions(), true).evaluate(input, 'm'), b = engine(definitions(), false).evaluate(input, 'm');
    assert.deepEqual(canonical(a), canonical(b));
    assert.ok(a.finiteRewards.length > 0);
    assert.ok(a.tasks.find(t => t.rawLabel === 'Unsupported').finiteRewards === undefined);
  } finally { if (previous === undefined) delete process.env.RS3_FINAL_PROJECTION; else process.env.RS3_FINAL_PROJECTION = previous; }
});

test('builder profile records a closed window and refuses changed source anchors', async () => {
  let clock = 0; const recorder = createProjectionRecorder(() => clock), row = recorder.start();
  clock = 1000; row.mark('checksMs'); clock = 3000; row.finish();
  assert.deepEqual(recorder.drain(), [{ start: 0, end: 3000, builders: { setupMs: 1, checksMs: 2 } }]);
  assert.deepEqual(recorder.drain(), []);
  const source = await readFile(new URL('../app/tasks/engine.mjs', import.meta.url), 'utf8');
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: instrumentProjection(source), encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.throws(() => instrumentProjection(source.replace('    let disconnectedDetail;', '    let changed;')), /Anchor/);
});

test('lazy producer witnesses preserve independent source constraints and exhausted false proofs', () => {
  const data = { chunks: { 100: {}, 101: {} }, challenges: {
    Nonskill: { First: { Chunks: ['100'], Items: ['Missing'], Output: 'Token' },
      Second: { Chunks: ['100'], Items: ['Missing'], Reward: 'Token' },
      Circular: { Items: ['Token'], Output: 'Token' },
      Unowned: { Chunks: ['101'], Items: ['Missing'], Reward: 'Token' } },
    Extra: { Need: { Items: ['Token'], NonShop: true, AllowedSources: ['First'], Source: 'reward' } },
  } };
  for (const [allowed, channel, own] of [[['First'], 'reward', true], [['Unowned'], 'reward', false], [['First'], 'shop', false]]) {
    data.challenges.Extra.Need.AllowedSources = allowed; data.challenges.Extra.Need.Source = channel;
    const input = state(); input.rules['access.shared'] = false; input.members[1].unlocked = [];
    const expected = engine(data, false).evaluate(input, 'm'), actual = engine(data, true).evaluate(input, 'm');
    assert.deepEqual(canonical(actual), canonical(expected));
    assert.equal(actual.tasks.find(row => row.rawLabel === 'Need').obligation, own);
    assert.equal(actual.items.some(row => row.name === 'Token'), false, 'potential own-map production is not admitted inventory');
  }
});

test('calculator input refuses installed paths, invalid checksums and escaped static references without storage', async t => {
  const [{ calculatorInput }, fs, { tmpdir }, path, { gzipSync }, { createHash }] = await Promise.all([
    import('../scripts/perf/calculator-input.mjs'), import('node:fs/promises'), import('node:os'), import('node:path'), import('node:zlib'), import('node:crypto'),
  ]);
  await assert.rejects(() => calculatorInput(path.parse(process.cwd()).root), /InputLocation/);
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'projection-input-')); t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const root = path.join(dir, 'game'); await fs.mkdir(path.join(root,'static'),{recursive:true});
  if (!(await fs.realpath(root)).startsWith('/tmp/')) {
    await assert.rejects(() => calculatorInput(root), /InputLocation/);
    assert.deepEqual(await fs.readdir(root), ['static']); return;
  }
  const hash = createHash('sha256').update('{}').digest('hex'), id = `static-${hash}.json.gz`;
  const document = { format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1 },
    storage: { schemaVersion: 1, fields: { legacy: { id, sha256: hash } } } };
  await fs.writeFile(path.join(root,'state.json'),JSON.stringify(document));
  await fs.writeFile(path.join(root,'static',id),gzipSync(Buffer.from('{"different":true}')));
  await assert.rejects(() => calculatorInput(root), /Checksum/);
  await fs.rm(path.join(root,'static',id));
  await fs.writeFile(path.join(dir,'outside.gz'),gzipSync(Buffer.from('{}')));
  await fs.symlink(path.join(dir,'outside.gz'),path.join(root,'static',id));
  await assert.rejects(() => calculatorInput(root), /Reference/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['state.json','static']);
});

test('literal obligation cache preserves cycle guards, transitive reads, collisions and invalidation', async () => {
  const { createObligationCache } = await import('../app/tasks/obligation-cache.mjs');
  for (const hashBits of [1,256]) for(const maxEntries of [0,1,32]) {
    const cache=createObligationCache({hashBits,maxEntries}), literal={key:'literal'}, parent={key:'parent'};
    let accessible=true, calls=0;
    const leaf=visiting=>cache.evaluateLeaf(literal,visiting,()=>{calls++;if(visiting.has(literal.key))return false;visiting.add(literal.key);return accessible;});
    const root=visiting=>cache.evaluate(parent,visiting,()=>{if(visiting.has(parent.key))return false;visiting.add(parent.key);return leaf(new Set(visiting));});
    assert.equal(leaf(new Set()),true); const before=calls;
    assert.equal(leaf(new Set(['unrelated'])),true);
    if(maxEntries>0)assert.equal(calls,before,'unrelated mask collisions cannot invalidate a literal predicate');
    assert.equal(root(new Set()),true);
    assert.equal(root(new Set([literal.key])),false,'cached parent retains the literal key as a dependency');
    assert.equal(leaf(new Set()),true,'guarded result did not replace the independent literal value');
    accessible=false;cache.clear();assert.equal(root(new Set()),false);assert.equal(leaf(new Set()),false);
  }
});

test('calculator accepted-roll sequences retain valid history across repeated offers', async () => {
  const [{ acceptCalculatorRoll }, core, { createRuleRegistry }] = await Promise.all([
    import('../scripts/perf/calculator-sequences.mjs'), import('../app/core/state.mjs'), import('../app/core/rules.mjs'),
  ]);
  const registry=createRuleRegistry(), ids=Array.from({length:10},(_,i)=>String(100+i));
  const world={chunks:new Map(ids.map(id=>[id,{id}])),neighbors:new Map(ids.map(id=>[id,ids.filter(other=>other!==id)])),
    walkable:new Set(ids),f2p:new Set(ids),surface:new Set(ids)};
  let state=core.createGroupState([{id:'m',name:'Fixture',unlocked:['100']}]);
  for(let step=0;step<3;step++){
    const pool={pool:{eligible:ids.filter(id=>!state.members[0].unlocked.includes(id)).map(id=>({id,reasons:[]}))}};
    const before=structuredClone(state),result=acceptCalculatorRoll({core,world,registry},state,'m',pool,step,Date.UTC(2030,0,1)+step*4000);
    assert.deepEqual(state,before);
    assert.equal(result.previewState.members[0].pendingRoll.length,2);
    assert.equal(result.previewState.members[0].pendingRoll[0],result.chunkId);
    state=result.state;
    assert.ok(state.members[0].unlocked.includes(result.chunkId));
    assert.equal(state.members[0].pendingRoll.length,0);
    assert.equal(state.history.length,(step+1)*2);
    assert.deepEqual(core.validateState(state,registry),state);
  }
});

test('literal root cache hits do not require a visiting set and release drops scratch proofs', async () => {
  const { createObligationCache } = await import('../app/tasks/obligation-cache.mjs');
  const cache = createObligationCache(), task = { key: 'negative-literal' };
  let calls = 0;
  const compute = () => { calls++; return false; };
  assert.equal(cache.evaluateLeaf(task, undefined, compute), false);
  assert.equal(cache.evaluateLeaf(task, undefined, compute), false);
  assert.equal(calls, 1);
  cache.release();
  assert.equal(cache.evaluateLeaf(task, undefined, compute), false);
  assert.equal(calls, 2);
  const recursive = { key: 'recursive' };
  let expansions = 0;
  assert.equal(cache.evaluate(recursive, undefined, () => { expansions++; return false; }), false);
  assert.equal(cache.evaluate(recursive, undefined, () => { expansions++; return true; }), false);
  assert.equal(expansions, 1, 'an absent root path is the same empty path');
});

test('deferred recursive paths keep sibling producer branches independent', () => {
  for (const reverse of [false, true]) {
    const recipes = {
      A: { Items: ['Out B', 'Out C'], Output: 'Out A' },
      B: { Items: ['Out C'], Output: 'Out B' },
      C: { Items: ['Out A'], Output: 'Out C' },
      Seed: { Chunks: ['101'], Output: 'Out C' },
      Finish: { Items: ['Out A', 'Out B'], NonShop: true },
    };
    const data = { chunks: { 100: {}, 101: {} }, challenges: { Nonskill: Object.fromEntries(reverse ? Object.entries(recipes).reverse() : Object.entries(recipes)) } };
    const fast = engine(data, true), reference = engine(data, false), input = state();
    input.rules['access.shared'] = false;
    for (const unlocked of [['100'], ['100', '101'], ['100'], ['101'], []]) {
      input.members[0].unlocked = unlocked;
      const expected = reference.evaluate(input, 'm', { reuseEligibility: false, reuseObligations: false });
      assert.deepEqual(canonical(fast.evaluate(input, 'm')), canonical(expected));
      assert.deepEqual(canonical(fast.evaluate(input, 'm', { reuseEligibility: false, reuseObligations: false })), canonical(expected));
      for (const label of ['A', 'B', 'C', 'Finish']) assert.deepEqual(canonical(fast.how(input, 'm', taskId('Nonskill', label))), canonical(reference.how(input, 'm', taskId('Nonskill', label))));
    }
  }
});

test('shared cache evaluators copy paths only for computation and preserve the legacy thunk API', async () => {
  const { createObligationCache } = await import('../app/tasks/obligation-cache.mjs');
  for (const method of ['evaluate', 'evaluateLeaf']) {
    const cache = createObligationCache(), task = { key: 'direct-task' }, caller = new Set();
    let calls = 0;
    const compute = (actualTask, path) => {
      calls++; assert.equal(actualTask, task); assert.ok(path instanceof Set); assert.notEqual(path, caller);
      if (path.has(task.key)) return true;
      path.add(task.key); return false;
    };
    assert.equal(cache[method](task, caller, compute, true), false);
    assert.equal(cache[method](task, caller, compute, true), false);
    assert.equal(calls, 1); assert.equal(caller.size, 0);
    assert.equal(cache[method](task, new Set([task.key]), compute, true), true);
    assert.equal(cache[method](task, undefined, compute, false), false, 'guarded result never overwrites the root proof');
    assert.equal(calls, 2);
    cache.clear();
    assert.equal(cache[method](task, undefined, compute, false), false);
    assert.equal(calls, 3);
    const legacy = { key: 'legacy-task' };
    assert.equal(cache[method](legacy, new Set(), function () { assert.equal(arguments.length, 0); return true; }, 'ambiguous'), true);
    const disabled = createObligationCache({ enabled: false });
    assert.equal(disabled[method](task, caller, compute, true), false);
    assert.equal(disabled[method](task, caller, compute, true), false);
    assert.equal(caller.size, 0); assert.equal(calls, 5);
  }
});
