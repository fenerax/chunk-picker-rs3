import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewCache, replaceView } from '../app/web/browser-state.mjs';
import { appendTaskHow } from '../app/web/task-how.mjs';
import { appendTaskWhy } from '../app/web/task-why.mjs';
import { createScreenLoading } from '../app/web/screen-loading.mjs';
import { createScreenContext } from '../app/web/screen-context.mjs';
import { projectTaskState } from '../app/web/command-state.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const configured = options => { const cache = createViewCache({ storage: null, ...options }); cache.configure(['dataset', 'picker', 'actor', 'member', 'write']); return cache; };
class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; this.events = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(key, action) { this.events[key] = action; }
  contains(child) { return this === child || this.children.some(node => node.contains?.(child)); }
}
const document = { createElement: tag => new Node(tag) };
const button = (label, action) => { const node = new Node('button'); node.textContent = label; node.events.click = action; return node; };
const text = node => typeof node === 'string' ? node : [node.textContent ?? '', ...(node.children ?? []).map(text)].join(' ');
const task = { id: 'synthetic:task', label: 'Synthetic goal', category: 'Extra', status: 'available' };
const proof = label => ({ proofStatus: 'complete', root: 'root', nodes: { root: { kind: 'task', label, allOf: [] } } });

test('exact and older cached answers are always provisional; newer empty answers replace them', () => {
  const cache = configured(); cache.remember('view', 'key', 7, { rows: ['old'] });
  assert.equal(cache.peek('view', 'key', 7).updating, true);
  assert.equal(cache.peek('view', 'key', 8).revision, 7);
  assert.equal(cache.peek('view', 'key', 6), undefined);
  cache.remember('view', 'key', 8, { rows: [] });
  assert.deepEqual(cache.peek('view', 'key', 8).value, { rows: [] });
  assert.equal(cache.peek('view', 'another', 8), undefined);
});

test('dataset, picker, actor, member and permission changes clear memory and persisted display data', async () => {
  let record;
  const storage = { read: async () => record, write: async value => { record = structuredClone(value); } };
  const cache = configured({ storage });
  for (let field = 0; field < 5; field++) {
    const scope = ['dataset', 'picker', 'actor', 'member', 'write'];
    cache.configure(scope); cache.remember('how', 'key', 7, proof('old')); await cache.flushed();
    const token = cache.token(); scope[field] += '-changed'; cache.configure(scope);
    assert.equal(cache.current(token), false); assert.equal(cache.peek('how', 'key', 7), undefined);
    await cache.hydrate(); await cache.flushed();
    assert.equal(cache.stats().entries, 0); assert.equal(record.entries.length, 0);
  }
  cache.clear(); await cache.flushed(); assert.equal(record, null);
});

test('small display JSON hydrates only inside the same scope and storage errors fall back to live reads', async () => {
  let record;
  const storage = { read: async () => record, write: async value => { record = structuredClone(value); } };
  const a = configured({ storage }); a.remember('preview', 'key', 7, { count: 2 }); await a.flushed();
  const b = configured({ storage }); await b.hydrate(); assert.equal(b.peek('preview', 'key', 7).value.count, 2);
  const blocked = configured({ storage: { read: () => Promise.reject(Error('denied')), write: () => Promise.reject(Error('quota')) } });
  await blocked.hydrate(); blocked.remember('view', 'key', 1, {}); await blocked.flushed(); assert.equal(blocked.stats().entries, 1);
});

test('late IndexedDB reads and queued writes cannot resurrect a retired scope', async () => {
  const read = deferred(), records = [];
  const cache = configured({ storage: { read: () => read.promise, write: async value => records.push(value) } });
  const loading = cache.hydrate(); await flush();
  cache.remember('view', 'old', 7, {}); cache.clear(); cache.configure(['new']); cache.remember('view', 'new', 8, {});
  read.resolve({ scope: JSON.stringify(['dataset', 'picker', 'actor', 'member', 'write']), entries: [{ view: 'view', key: 'old', revision: 7, value: {} }] });
  await loading; await cache.flushed();
  assert.equal(cache.peek('view', 'old', 9), undefined); assert.ok(cache.peek('view', 'new', 9));
  assert.deepEqual(records.at(-1).entries.map(row => row.key), ['new']);
});

test('entry, byte and persistent-size bounds exclude large results and never retain mutable inputs', async () => {
  let record;
  const cache = configured({ maxEntries: 2, maxBytes: 200, entryBytes: 150, persistentEntryBytes: 40,
    storage: { read: async () => null, write: async value => { record = value; } } });
  const value = { count: 2 }; cache.remember('view', 'a', 1, value); value.count = 99;
  assert.equal(cache.peek('view', 'a', 1).value.count, 2);
  cache.remember('view', 'large', 1, 'x'.repeat(200)); assert.equal(cache.peek('view', 'large', 1), undefined);
  cache.remember('view', 'b', 1, 'x'.repeat(25)); cache.remember('view', 'c', 1, {});
  assert.equal(cache.stats().entries, 2); assert.ok(cache.stats().bytes <= 200); assert.equal(cache.peek('view', 'a', 1), undefined);
  await cache.flushed(); assert.deepEqual(record.entries.map(row => row.key), ['c']);
});

test('How paints cached content synchronously, then replaces it; late permission and close responses are ignored', async () => {
  const cache = configured(), row = new Node('div'), pending = deferred();
  cache.remember('how', task.id, 6, proof('Old path'));
  const toggle = appendTaskHow(row, task, { document, button, cache, revision: () => 7, scope: () => 'member:7', load: () => pending.promise });
  const opening = toggle.events.click(); assert.match(text(row), /Updating….*Old path/);
  pending.resolve(proof('New path')); await opening;
  assert.match(text(row), /New path/); assert.doesNotMatch(text(row), /Old path|Updating…/);
  await toggle.events.click();
  const late = deferred(); const secondRow = new Node('div');
  const second = appendTaskHow(secondRow, task, { document, button, cache, revision: () => 7, scope: () => 'member:7', load: () => late.promise });
  const response = second.events.click(); cache.configure(['different-permission']); second.events.click(); late.resolve(proof('Must not appear')); await response;
  assert.doesNotMatch(text(secondRow), /Must not appear/); assert.equal(cache.stats().entries, 0);
});

test('Why caches the small derived explanation, not a full result or rule function', async () => {
  const cache = configured(), row = new Node('div'); let calls = 0;
  const toggle = appendTaskWhy(row, task, { document, button, icon: () => new Node('span'), cache, revision: () => 7, scope: () => 'member:7',
    load: async () => { calls++; return { task, result: { tasks: [task], presentation: {} }, describeRule: () => undefined }; } });
  await toggle.events.click(); await toggle.events.click();
  const reopening = toggle.events.click(); assert.match(text(row), /Updating….*Why this task/); await reopening;
  assert.equal(calls, 2); assert.doesNotMatch(text(row), /Updating…/);
  assert.ok(cache.stats().bytes < 10000);
});

test('first load paints only inert matching-member state and skips a late snapshot after live hydration', async () => {
  const cache = configured(), nodes = new Map(['task-engine-status', 'map-counts', 'active-tasks'].map(id => [id, new Node('div')]));
  cache.remember('startup', 'shell', 7, { memberId: 'member', revision: 7, tasks: [task], unlocked: 2, pool: 3 });
  const c = { viewCache: cache, memberId: 'member', $: id => nodes.get(id), plain: String, el: (tag, label) => Object.assign(new Node(tag), { textContent: label ?? '' }), perfMark() {} };
  createScreenLoading(c); await c.paintStartupView();
  assert.match(text(nodes.get('active-tasks')), /Synthetic goal/); assert.match(text(nodes.get('task-engine-status')), /Updating…/);
  assert.ok(!nodes.get('active-tasks').children.some(row => row.tagName === 'button' || row.tagName === 'input'));
  nodes.get('active-tasks').replaceChildren(); c.memberId = 'other'; await c.paintStartupView(); assert.equal(nodes.get('active-tasks').children.length, 0);
  c.memberId = 'member'; c.state = { revision: 8 }; await c.paintStartupView(); assert.equal(nodes.get('active-tasks').children.length, 0);
});

test('optimistic backlog, note and tick projections compose without changing acknowledged revision or history', () => {
  const state = { revision: 7, history: [], members: [{ id: 'member', taskStatus: { goal: { note: 'saved' } } }] };
  const edits = [{ type: 'set-task-status', memberId: 'member', taskId: 'goal', backlogged: true, backlogReason: 'later' },
    { type: 'set-task-status', memberId: 'member', taskId: 'goal', note: 'draft', challengeCompleted: true }];
  const projected = projectTaskState(state, edits);
  assert.deepEqual(projected.members[0].taskStatus.goal, { note: 'draft', backlogged: true, backlogReason: 'later', challengeCompleted: true });
  assert.equal(projected.history, state.history); assert.equal(projected.revision, 7);
  assert.deepEqual(projectTaskState(state, []).members[0].taskStatus.goal, { note: 'saved' });
});

test('replacing a result preserves focus, selection, scroll and open disclosure state', () => {
  const active = Object.assign(new Node('input'), { id: 'filter', selectionStart: 2, selectionEnd: 4 });
  const next = Object.assign(new Node('input'), { id: 'filter', focus: () => { document.activeElement = next; }, setSelectionRange: (a,b) => { next.range = [a,b]; } });
  const host = new Node('div'), fold = { open: true }, replacement = { open: false }; let replaced = false;
  host.children = [active]; host.scrollTop = 25; document.activeElement = active;
  host.querySelectorAll = selector => selector === 'details' ? [replaced ? replacement : fold] : [replaced ? next : active];
  replaceView(host, () => { host.children = [next]; host.scrollTop = 0; replaced = true; }, document);
  assert.equal(document.activeElement, next); assert.deepEqual(next.range, [2,4]); assert.equal(host.scrollTop, 25); assert.equal(replacement.open, true);
  document.activeElement = undefined;
});

test('focus never moves to a different action that only shares its visible label', () => {
  const keyed = (key, onFocus) => Object.assign(new Node('button'), { textContent: 'Change in Rules → Tasks', dataset: { viewKey: key }, focus: onFocus });
  const host = new Node('div'); let hostFocused = false, wrongFocused = false;
  const old = keyed('rule:a'), replacement = keyed('rule:b', () => { wrongFocused = true; });
  host.focus = () => { hostFocused = true; };
  host.children = [old]; document.activeElement = old; let replaced = false;
  host.querySelectorAll = selector => selector === 'details' ? [] : [replaced ? replacement : old];
  replaceView(host, () => { host.children = [replacement]; replaced = true; }, document);
  assert.equal(wrongFocused, false); assert.equal(hostFocused, true);
  document.activeElement = undefined;
});

test('clear() resolves only after the stored snapshot is removed', async () => {
  let record = { scope: 'x', entries: [] }; const gate = deferred();
  const cache = configured({ storage: { read: async () => record, write: async value => { await gate.promise; record = value; } } });
  const clearing = cache.clear(); assert.ok(clearing instanceof Promise);
  await flush(); assert.notEqual(record, null);
  gate.resolve(); await clearing; assert.equal(record, null);
});

test('returning to a member waits for queued invalidations before reading IndexedDB', async () => {
  let record;
  const storage = { read: async () => record, write: async value => { await flush(); record = structuredClone(value); } };
  const cache = configured({ storage }); cache.remember('view', 'old', 7, {}); await cache.flushed();
  cache.configure(['another-member']); cache.configure(['dataset', 'picker', 'actor', 'member', 'write']);
  await cache.hydrate(); assert.equal(cache.peek('view', 'old', 7), undefined);
});

test('exact peek matches only the current revision and rejects older or newer entries', () => {
  const cache = configured();
  cache.remember('startup', 'shell', 7, { revision: 7 });
  assert.equal(cache.peek('startup', 'shell', 7, { exact: true })?.revision, 7);
  assert.equal(cache.peek('startup', 'shell', 8, { exact: true }), undefined);
  assert.equal(cache.peek('startup', 'shell', 6, { exact: true }), undefined);
});

test('multi-picker startup cache requires exact revision, matching identity tuple and an active session', async () => {
  const gate = deferred();
  const accountA = 'account-a', accountB = 'account-b';
  const characterA = 'c_' + 'a'.repeat(32), characterB = 'c_' + 'b'.repeat(32);
  const pickerA = 'p_' + 'a'.repeat(32), pickerB = 'p_' + 'b'.repeat(32);
  const baseSession = { multiPicker: true, accountId: accountA, characterId: characterA, pickerId: pickerA, datasetId: 'open-f2p', datasetDigest: 'digest-1', stateRevision: 7 };
  const makeContext = ({ storage = null, session = baseSession, stopped = false } = {}) => {
    const cache = createViewCache({ storage });
    cache.configure([session.datasetId, session.datasetDigest, session.pickerId, session.accountId, session.characterId, 'member']);
    const nodes = new Map(['task-engine-status', 'map-counts', 'active-tasks'].map(id => [id, new Node('div')]));
    const c = {
      viewCache: cache, viewSession: { ...session }, dataset: { id: session.datasetId, digest: session.datasetDigest },
      memberId: 'member', sandbox: { active: false }, statePools: { member: { eligible: [{ id: '1' }] } },
      member: () => ({ unlocked: ['1', '2'] }), panelContext: { pickerSession: { stopped } },
      $: id => nodes.get(id), plain: String, el: (tag, label) => Object.assign(new Node(tag), { textContent: label ?? '' }), perfMark() {},
    };
    createScreenLoading(c);
    return { c, cache, nodes };
  };

  let persisted;
  const storage = { read: async () => persisted, write: async value => { persisted = structuredClone(value); } };
  const writer = makeContext({ storage });
  writer.c.state = { revision: 7 };
  writer.c.rememberStartupView({ memberId: 'member', stateRevision: 7, tasks: [task], presentation: { tasks: [task] } });
  await writer.cache.flushed();

  const exact = makeContext({ storage });
  await exact.c.paintStartupView();
  assert.match(text(exact.nodes.get('active-tasks')), /Synthetic goal/);

  for (const stateRevision of [8, 6, undefined]) {
    const mismatch = makeContext({ storage, session: { ...baseSession, stateRevision } });
    await mismatch.c.paintStartupView();
    assert.equal(mismatch.nodes.get('active-tasks').children.length, 0, `expected refusal for revision ${stateRevision}`);
  }

  for (const [field, value] of [['accountId', accountB], ['characterId', characterB], ['characterId', null], ['pickerId', pickerB], ['datasetId', 'duo-legacy'], ['datasetDigest', 'digest-2']]) {
    const mismatch = makeContext({ session: { ...baseSession, [field]: value } });
    mismatch.cache.remember('startup', 'shell', 7, { ...baseSession, memberId: 'member', revision: 7, tasks: [task], unlocked: 2, pool: 1 });
    await mismatch.c.paintStartupView();
    assert.equal(mismatch.nodes.get('active-tasks').children.length, 0, `expected refusal when ${field} mismatches`);
  }

  const stopping = makeContext({ storage: { read: () => gate.promise, write: async () => {} } });
  const painting = stopping.c.paintStartupView();
  stopping.c.panelContext.pickerSession.stopped = true;
  gate.resolve(persisted);
  await painting;
  assert.equal(stopping.nodes.get('active-tasks').children.length, 0);
  const stoppedWriter = makeContext({ stopped: true });
  stoppedWriter.c.state = { revision: 7 };
  stoppedWriter.c.rememberStartupView({ memberId: 'member', stateRevision: 7, tasks: [task], presentation: { tasks: [task] } });
  assert.equal(stoppedWriter.cache.stats().entries, 0);
});

test('screen-context syncViewCache isolates characters in the same picker and dataset digest fallback', () => {
  const c = createScreenContext();
  const accountA = 'account-a', pickerA = 'p_' + 'a'.repeat(32);
  const characterA = 'c_' + 'a'.repeat(32), characterB = 'c_' + 'b'.repeat(32);
  c.memberId = 'owner';
  c.viewSession = { accountId: accountA, pickerId: pickerA, characterId: characterA, kind: 'account', datasetId: 'open-f2p', datasetDigest: 'd1' };
  c.syncViewCache();
  const firstToken = c.viewCache.token();
  c.viewCache.remember('startup', 'shell', 4, { memberId: 'owner', revision: 4, tasks: [task] });
  assert.ok(c.viewCache.peek('startup', 'shell', 4, { exact: true }));

  c.viewSession = { ...c.viewSession, characterId: characterB };
  c.syncViewCache();
  assert.equal(c.viewCache.current(firstToken), false);
  assert.equal(c.viewCache.peek('startup', 'shell', 4, { exact: true }), undefined);

  c.dataset = undefined;
  c.viewSession = { ...c.viewSession, datasetDigest: 'd1' };
  c.syncViewCache();
  const fallbackToken = c.viewCache.token();
  c.viewCache.remember('startup', 'shell', 4, { memberId: 'owner', revision: 4, tasks: [task] });
  c.viewSession = { ...c.viewSession, datasetDigest: 'd2' };
  c.syncViewCache();
  assert.equal(c.viewCache.current(fallbackToken), false);
  assert.equal(c.viewCache.peek('startup', 'shell', 4, { exact: true }), undefined);
});
