import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { buildWhyChain } from '../app/tasks/why-chain.mjs';
import { savedWhyChain, forgetSavedWhyChain } from '../app/task-why-http.mjs';
import { createWhyChainDisclosure, renderWhyChain } from '../app/web/task-why-chain.mjs';
import { apiPermission } from '../app/picker-context-http.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

import { caveFixture } from './fixtures/why-chain.mjs';

const walk = root => [root, ...(root.children ?? []).flatMap(walk)];
const labels = root => walk(root).map(value => value.label).join(' ');

test('monster → area → either entrance → quest → skill, with chunk AND item gates', () => {
  const { result, definitions } = caveFixture(), before = structuredClone(result);
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' });
  const nodes = walk(chain.root), ids = nodes.filter(node => node.taskId).map(node => node.taskId);
  assert.deepEqual(ids, ['slay', 'caves', 'cellar', 'quest2', 'quest1', 'hole']);
  assert.match(labels(chain.root), /Agility 13.*no training/);
  assert.match(labels(chain.root), /Swamp shore.*Need Rope/);
  const entrances = nodes.find(node => node.mode === 'any' && node.children?.length === 2);
  assert.ok(entrances); assert.equal(entrances.required, 1);
  const hole = nodes.find(node => node.taskId === 'hole');
  assert.equal(hole.mode, 'all'); assert.equal(hole.children.length, 2);
  assert.equal(chain.truncated, false); assert.deepEqual(result, before);
});

test('cycles are visible and do not recurse forever', () => {
  const { result, definitions } = caveFixture();
  result.tasks[5].record = { Tasks: { 'Cave quest 2': 'Quest' } };
  result.tasks[5].blockers = [{ kind: 'tasks', detail: 'Requires Cave quest 2 (Quest).' }];
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' });
  assert.ok(walk(chain.root).some(node => node.label === '…' && /earlier step/.test(node.detail)));
  assert.ok(chain.nodeCount < 60);
});

test('real engine blockers resolve through the synthetic cave-shaped definitions', () => {
  const { result, definitions } = caveFixture();
  definitions.chunks['100'] = { Connect: { 'Swamp caves': true } };
  definitions.challenges = {};
  for (const row of result.tasks) (definitions.challenges[row.category] ??= {})[row.rawLabel] = row.record;
  const calculated = createTaskEngine(definitions, { reviewedOverlays: false }).evaluate({ rules: { 'content.f2p': false }, members: [{ id: 'player', unlocked: ['100'], completedTasks: [] }] }, 'player');
  const root = calculated.tasks.find(row => row.label === 'Slay a small cave bug');
  const chain = buildWhyChain(calculated, definitions, { taskId: root.id });
  assert.match(labels(chain.root), /Agility 13.*no training/);
  assert.match(labels(chain.root), /Need Rope/);
  assert.equal(walk(chain.root).filter(row => row.taskId).length, 6);
});

test('source-specific access diagnostics link their task gate even in a reachable location', () => {
  const { result, definitions } = caveFixture();
  result.access.diagnostics = [{ code: 'task-required', source: 'Cave bug#Level 6', location: 'Swamp caves', task: 'Cave quest 1', category: 'Quest' }];
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' });
  assert.equal(walk(chain.root).filter(node => node.taskId === 'quest1').length, 2);
});

test('node and depth caps are hard bounds and show ellipsis', () => {
  const { result, definitions } = caveFixture();
  for (const limits of [{ maxNodes: 10 }, { maxDepth: 4 }, { maxNodes: 2 }]) {
    const chain = buildWhyChain(result, definitions, { taskId: 'slay' }, limits);
    assert.equal(chain.truncated, true);
    assert.ok(walk(chain.root).some(node => node.label === '…' || node.detail?.includes('…and')));
    assert.ok(walk(chain.root).length <= chain.maxNodes);
    assert.ok(chain.nodeCount <= chain.maxNodes);
    const depth = node => Math.max(0, ...(node.children ?? []).map(child => 1 + depth(child)));
    assert.ok(depth(chain.root) <= chain.maxDepth);
  }
});

test('breadth-first admission keeps both entrance siblings and the short route under a tight budget', () => {
  const { result, definitions } = caveFixture();
  result.tasks[5].blockers = Array.from({ length: 80 }, (_, i) => ({ kind: 'items', detail: `Items: Long detour ${i}.` }));
  result.tasks[5].record.Items = Array.from({ length: 80 }, (_, i) => `Long detour ${i}`);
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' }, { maxNodes: 34 });
  const nodes = walk(chain.root);
  assert.ok(nodes.some(node => node.taskId === 'cellar'));
  assert.ok(nodes.some(node => node.taskId === 'hole'));
  assert.match(labels(chain.root), /Swamp shore.*Need Rope/);
  assert.equal(chain.truncated, true);
  assert.ok(nodes.length <= 34);
  const exact = buildWhyChain(result, definitions, { taskId: 'hole' }, { maxNodes: 3 });
  assert.deepEqual(exact.root.children.map(node => node.label), ['Need Swamp shore', 'Need Rope']);
  assert.equal(exact.nodeCount, 3);
});

test('training blockers show five simplest one-line methods and a remaining count without recursion', () => {
  const { result, definitions } = caveFixture();
  definitions.chunks['102'] = { Nickname: 'Practice grounds', Sections: { '1': {} } };
  for (let i = 0; i < 12; i++) result.tasks.push({ id: `method-${i}`, label: `Practice ${i}`, category: 'Agility',
    primaryMethod: true, level: 12 - i, status: 'blocked', record: { Chunks: ['102-1'] },
    blockers: [{ kind: 'chunks', detail: 'Chunks: 102-1.' }, { kind: 'tasks', detail: 'Requires Cave quest 1 (Quest).' }] });
  const chain = buildWhyChain(result, definitions, { taskId: 'quest1' });
  assert.match(chain.root.children[0].label, /Agility 13.*no training/);
  const summaries = chain.root.children[0].children;
  assert.equal(summaries.length, 6);
  assert.deepEqual(summaries.slice(0, 5).map(node => node.label.split(' — ')[0]), ['Practice 11', 'Practice 10', 'Practice 9', 'Practice 8', 'Practice 7']);
  assert.match(summaries[0].label, /Need Practice grounds \(chunk\)/);
  assert.equal(summaries[5].label, '+7 more training methods');
  assert.ok(summaries.every(node => !node.children.length));
  const text = walk(renderWhyChain(context(), chain)).map(node => node.textContent).join(' ');
  assert.match(text, /Some training methods to inspect:/);
  assert.doesNotMatch(text, /All needed:/);
});

test('consecutive cycle cuts collapse into one counted line', () => {
  const { result, definitions } = caveFixture();
  result.tasks[0].record = { Tasks: { 'Cave quest 2': 'Quest' } };
  result.tasks[0].blockers = [{ kind: 'tasks', detail: 'Requires Cave quest 2 (Quest).' }];
  for (const id of ['slay', 'quest2', 'quest1']) Object.assign(result.tasks.find(row => row.id === id), { label: 'Earlier step' });
  result.tasks[5].record = { CompletedTasks: ['slay', 'quest2', 'quest1'] };
  result.tasks[5].blockers = [{ kind: 'tasks', detail: 'Requires Earlier step (Quest).' }];
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' });
  const cuts = walk(chain.root).filter(node => node.kind === 'cut');
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].detail, 'and 3 more steps not shown.');
  assert.equal(chain.nodeCount, walk(chain.root).length);
});

test('location aliases and repeated alternatives dedupe while distinct monster variants stay separate', () => {
  const { result, definitions } = caveFixture();
  definitions.chunks['1000'] = { Name: 'Swamp caves', Monster: { 'Cave bug#Level 6': 1 } };
  definitions.chunks['Other caves'] = { Monster: { 'Cave bug#Level 11': 1 } };
  definitions.codeItems.tasksPlus['Enter the caves[+]'].push('Enter via the swamp hole');
  const chain = buildWhyChain(result, definitions, { taskId: 'slay' });
  assert.equal(walk(chain.root).filter(node => node.kind === 'location' && node.label === 'Swamp caves').length, 1);
  assert.equal(walk(chain.root).filter(node => node.taskId === 'hole').length, 1);
  assert.doesNotMatch(labels(chain.root), /Other caves|Level 11/);
  definitions.codeItems.slayerTasks['Cave bugs']['Cave bug#Level 11'] = true;
  const assignment = buildWhyChain(result, definitions, { master: 'Example master', assignment: 'Cave bugs' });
  assert.match(labels(assignment.root), /Cave bug \(Level 11\).*Other caves/);
});

test('section names prefer section metadata, then chunk nicknames, and ids appear only in Advanced', () => {
  const { result, definitions } = caveFixture();
  definitions.chunks['101'].Sections = { '1': { Name: 'Upper swamp' }, '2': {} };
  definitions.sections = { '101': { '3': { Nickname: 'Lower swamp' } } };
  for (const [id, name] of [['101-1', 'Upper swamp'], ['101-2', 'Swamp shore'], ['101-3', 'Lower swamp']]) {
    result.tasks[3].record.Chunks = [id];
    result.tasks[3].blockers = [{ kind: 'chunks', detail: `Chunks: ${id}.` }];
    const chain = buildWhyChain(result, definitions, { taskId: 'hole' });
    assert.match(labels(chain.root), new RegExp(`Need ${name}`));
    const c = context();
    assert.doesNotMatch(walk(renderWhyChain(c, chain)).map(node => node.textContent).join(' '), /101-[123]/);
    assert.match(walk(renderWhyChain(c, chain, { advanced: true })).map(node => node.textContent).join(' '), new RegExp(id));
  }
});

test('ineligible Slayer assignment follows the same monster chain and alternatives', () => {
  const { result, definitions } = caveFixture();
  const chain = buildWhyChain(result, definitions, { master: 'Example master', assignment: 'Cave bugs' });
  assert.match(labels(chain.root), /Agility 13/); assert.match(labels(chain.root), /Need Rope/);
  definitions.codeItems.slayerTasks['Cave bugs']['Other bug'] = true;
  const other = buildWhyChain(result, definitions, { master: 'Example master', assignment: 'Cave bugs' });
  const targets = walk(other.root).find(node => node.label === 'Possible target monsters');
  assert.equal(targets.mode, 'any'); assert.equal(targets.children.length, 2);
});

test('alias thresholds preserve distinct-count requirements', () => {
  const { result, definitions } = caveFixture();
  result.tasks[1].record.Tasks = { 'Enter the caves[+]x2': 'Nonskill' };
  result.tasks[1].blockers[0].detail = 'Requires Enter the caves[+]x2 (Nonskill).';
  const chain = buildWhyChain(result, definitions, { taskId: 'caves' });
  assert.ok(walk(chain.root).some(node => node.mode === 'any' && node.required === 2));
});

test('similar names cannot redirect a task or item dependency', () => {
  const { result, definitions } = caveFixture();
  result.tasks.push({ ...result.tasks[5], id: 'wrong', rawLabel: 'Different raw task', label: 'Cave quest 1' });
  const chain = buildWhyChain(result, definitions, { taskId: 'quest2' });
  assert.ok(!walk(chain.root).some(node => node.taskId === 'wrong'));
  result.tasks[3].record.Items = ['Rope', 'Rope coil'];
  result.tasks[3].blockers = [{ kind: 'items', detail: 'Items: Rope coil.' }];
  const item = buildWhyChain(result, definitions, { taskId: 'hole' });
  assert.deepEqual(walk(item.root).filter(node => node.kind === 'item').map(node => node.label), ['Need Rope coil']);
});

test('saved endpoint is read-only, bounded, and rejects stale or ambiguous selectors', async () => {
  const { result, definitions } = caveFixture(), fullGzip = gzipSync(JSON.stringify(result));
  const options = { revision: 7, members: new Set(['player']), entry: { revision: 7, fullGzip }, definitions, currentRevision: () => 7 };
  const query = text => new URLSearchParams(`memberId=player&revision=7&${text}`);
  assert.equal(apiPermission('GET', '/api/task-why'), 'read');
  assert.equal(apiPermission('POST', '/api/task-why'), undefined);
  const chain = await savedWhyChain(query('taskId=slay'), options);
  assert.equal(chain.memberId, 'player'); assert.equal(chain.stateRevision, 7);
  assert.equal(Object.hasOwn(chain, 'tasks'), false);
  assert.ok(JSON.stringify(chain).length < 15000);
  for (const [text, status] of [['taskId=missing', 404], ['taskId=slay&taskId=hole', 400], ['taskId=slay&master=x', 400], ['assignment=x', 400]])
    await assert.rejects(savedWhyChain(query(text), options), error => error.status === status);
  await assert.rejects(savedWhyChain(query('taskId=slay'), { ...options, revision: 8 }), error => error.status === 409);
  await assert.rejects(savedWhyChain(query('taskId=slay'), { ...options, currentRevision: () => 8 }), error => error.status === 409);
  await assert.rejects(savedWhyChain(query('taskId=slay'), { ...options, entry: undefined }), error => error.status === 409);
});

test('saved parses are shared across clicks and invalidated on revision, replacement, or eviction', async t => {
  const { result, definitions } = caveFixture();
  const entry = { revision: 7, fullGzip: gzipSync(JSON.stringify(result)) };
  const options = { revision: 7, members: new Set(['player']), entry, definitions, currentRevision: () => options.revision };
  const query = () => new URLSearchParams(`memberId=player&revision=${options.revision}&taskId=slay`);
  const parse = t.mock.method(JSON, 'parse');
  await Promise.all([savedWhyChain(query(), options), savedWhyChain(query(), options)]);
  await savedWhyChain(query(), options);
  assert.equal(parse.mock.callCount(), 1);
  options.revision = entry.revision = 8;
  await savedWhyChain(query(), options);
  assert.equal(parse.mock.callCount(), 2);
  entry.fullGzip = gzipSync(JSON.stringify({ ...result, tasks: result.tasks.map(row => row.id === 'slay' ? { ...row, label: 'New calculation' } : row) }));
  assert.equal((await savedWhyChain(query(), options)).root.label, 'New calculation');
  assert.equal(parse.mock.callCount(), 3);
  forgetSavedWhyChain(entry);
  await savedWhyChain(query(), options);
  assert.equal(parse.mock.callCount(), 4);
  await savedWhyChain(query(), { ...options, entry: { ...entry } });
  assert.equal(parse.mock.callCount(), 5, 'Separate retained entries cannot share private evidence');
});

class Node {
  constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.events = {}; this.attributes = {}; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, action) { this.events[name] = action; }
}
function context(api) {
  const c = { api, el: (tag, text) => new Node(tag, text), button: (text, action) => Object.assign(new Node('button', text), { action }),
    details: (label, body) => { const node = new Node('details'); node.append(new Node('summary', label), body); return node; } };
  return c;
}
test('disclosure fetches once on demand, exposes all requirements, and never sends a command', async () => {
  const { result, definitions } = caveFixture(), requests = [];
  const chain = { ...buildWhyChain(result, definitions, { taskId: 'slay' }), memberId: 'player', stateRevision: 7 };
  const c = context(async url => { requests.push(url); return chain; });
  const node = createWhyChainDisclosure(c, { taskId: 'slay' }, { memberId: 'player', revision: 7 });
  assert.equal(requests.length, 0); node.open = true; await node.events.toggle();
  // toggle starts the async request; flush its continuation.
  await Promise.resolve();
  assert.equal(requests.length, 1); assert.match(requests[0], /^\/api\/task-why\?/);
  const text = walk(node).map(value => value.textContent).join(' ');
  assert.match(text, /All needed:/); assert.match(text, /Either route/);
  await node.events.toggle(); assert.equal(requests.length, 1);
  const simple = walk(renderWhyChain(c, chain)).map(value => value.textContent).join(' ');
  const advanced = walk(renderWhyChain(c, chain, { advanced: true })).map(value => value.textContent).join(' ');
  assert.doesNotMatch(simple, /currently reachable level/); assert.match(advanced, /currently reachable level/);
});

test('stale responses are discarded and errors can be retried', async () => {
  let resolve, current = true, requests = 0;
  const c = context(() => { requests++; return new Promise(done => { resolve = done; }); });
  const node = createWhyChainDisclosure(c, { taskId: 'slay' }, { memberId: 'player', revision: 7, current: () => current });
  node.open = true; node.events.toggle(); current = false; resolve({ memberId: 'player', stateRevision: 7 }); await Promise.resolve();
  assert.doesNotMatch(walk(node).map(value => value.textContent).join(' '), /All needed/);
  const retryContext = context(async () => { throw new Error('Please retry.'); });
  const retry = createWhyChainDisclosure(retryContext, { taskId: 'slay' }, { memberId: 'player', revision: 7 });
  retry.open = true; retry.events.toggle(); await Promise.resolve();
  assert.ok(walk(retry).some(value => value.textContent === 'Retry Why not?'));
});

test('sandbox assignment evidence builds lazily without a saved-map request', async () => {
  const { result, definitions } = caveFixture();
  const c = context(() => { throw new Error('Must not request the saved map for a preview.'); });
  const node = createWhyChainDisclosure(c, { master: 'Example master', assignment: 'Cave bugs' }, {
    memberId: 'player', revision: 7, result, definitions,
  });
  assert.ok(!walk(node).some(value => value.textContent.includes('Agility')));
  node.open = true; await node.events.toggle();
  assert.match(walk(node).map(value => value.textContent).join(' '), /Need Agility 13/);
});
