import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from '../app/web/sandbox.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
class Node {
  constructor(tag, text, cls) { this.tag = tag; this.textContent = text ?? ''; this.className = cls ?? ''; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, action) { this.events[name] = action; }
}
function harness({ api, ensureReady } = {}) {
  const state = freeze({ revision: 7, history: [{ type: 'saved' }], tasks: [{ id: 'saved', label: 'Saved task' }], rules: { shared: true },
    members: [{ id: 'a', name: 'Player', unlocked: ['1'], selected: ['2'], blacklisted: ['3'], pendingRoll: ['4', '5'], completedTasks: ['game'],
      taskStatus: { saved: { challengeCompleted: true, favorite: true, note: 'Saved note' }, game: { favorite: true } }, taskRules: { Skills: true } },
    { id: 'b', name: 'Reed', unlocked: ['9'], taskStatus: {} }] });
  const result = freeze({ format: 'play-v1', memberId: 'a', stateRevision: 7, tasks: [{ id: 'saved' }] });
  const saved = { state, result, fullResult: { complete: true }, shownResult: result,
    memberId: 'a', statePools: freeze({ a: { eligible: [{ id: '2' }, { id: '3' }, { id: '4' }, { id: '6' }], excluded: [], accessible: [] }, b: { eligible: [] } }) };
  let current = saved;
  const requests = [], displays = [], modeChanges = [], errors = [], banner = new Node('section'), toggle = new Node('button');
  const response = body => ({ format: 'sandbox-v1', memberId: body.memberId, stateRevision: body.baseRevision, changes: body.changes,
    result: { format: 'play-v1', memberId: body.memberId, stateRevision: body.baseRevision, tasks: [{ id: `new:${body.changes.unlockChunks.join(',')}` }] },
    rollPool: { eligible: [{ id: '6' }, { id: '7' }], excluded: [], accessible: [] }, possibleCount: 1,
    delta: { tasksAdded: [{ id: `new:${body.changes.unlockChunks.join(',')}` }], tasksRemoved: [], itemsAdded: [], itemsRemoved: [] },
    ...(body.previewChunkId ? { prediction: { delta: { tasksAdded: Array.from({ length: Number(body.previewChunkId) }, (_, index) => ({ id: `p:${index}` })) }, coverage: {}, metrics: {} } } : {}),
    ...(body.planningChunkId ? { planning: { format: 'chunk-planning-v1', chunkId: body.planningChunkId, rows: [{ task: { id: 'hypothetical' }, evidence: [] }], clueLocations: [], access: {} } } : {}) });
  const sandbox = createSandbox({ getSnapshot: () => current, display: value => { current = value; displays.push(value); }, ensureReady: ensureReady ?? (async () => {}),
    api: (path, body, signal) => { requests.push({ path, body, signal }); return api ? api(path, body, signal, response) : Promise.resolve(response(body)); },
    el: (tag, text, cls) => new Node(tag, text, cls), button: (text, action, cls) => { const node = new Node('button', text, cls); node.events.click = action; return node; },
    showError: error => errors.push(error), onModeChange: value => modeChanges.push(value), banner, toggle });
  return { sandbox, saved, requests, displays, modeChanges, errors, banner, toggle, response, current: () => current };
}

test('entry waits for ready, cancellation cannot enter later, and exit restores exact saved references', async () => {
  const ready = deferred(), h = harness({ ensureReady: () => ready.promise });
  const entering = h.sandbox.enter(); assert.equal(h.sandbox.active, false); h.sandbox.exit(); ready.resolve(); await entering;
  assert.equal(h.sandbox.active, false); assert.equal(h.requests.length, 0);
  await h.sandbox.enter(); await h.sandbox.toggleChunk('2');
  h.sandbox.exit();
  for (const field of ['state', 'statePools', 'result', 'fullResult', 'shownResult']) assert.equal(h.current()[field], h.saved[field]);
  assert.deepEqual(h.modeChanges, [true, false]); assert.equal(h.sandbox.active, false);
});

test('chunk and challenge drafts accumulate against the frozen baseline, project member-only fields and undo each step', async () => {
  const h = harness(); await h.sandbox.enter();
  await h.sandbox.toggleChunk('2'); await h.sandbox.toggleChunk('1');
  await h.sandbox.command({ type: 'set-task-status', memberId: 'a', taskId: 'game', challengeCompleted: true });
  const state = h.current().state, member = state.members[0];
  assert.deepEqual(member.unlocked, ['2']); assert.deepEqual(member.selected, []);
  assert.equal(state.members[1], h.saved.state.members[1]); assert.equal(state.history, h.saved.state.history); assert.equal(state.rules, h.saved.state.rules);
  assert.equal(member.completedTasks, h.saved.state.members[0].completedTasks);
  assert.deepEqual(member.taskStatus.game, { favorite: true, challengeCompleted: true });
  assert.equal(member.taskStatus.saved, h.saved.state.members[0].taskStatus.saved);
  assert.deepEqual(h.sandbox.markers(), { unlockChunks: ['2'], lockChunks: ['1'] });
  assert.deepEqual(h.requests.at(-1).body.changes, { unlockChunks: ['2'], lockChunks: ['1'], doneTasks: ['game'] });
  assert.equal(h.sandbox.isNewTask('new:2'), true);
  await h.sandbox.undo(); assert.equal(h.current().state.members[0].taskStatus.game.challengeCompleted, undefined);
  await h.sandbox.undo(); assert.deepEqual(h.current().state.members[0].unlocked, ['1', '2']);
  await h.sandbox.undo(); assert.equal(h.current().state, h.saved.state); assert.equal(h.current().result, h.saved.result);
  assert.equal(h.sandbox.active, true);
  assert.ok(h.requests.every(row => row.path === '/api/sandbox/evaluate'));
});

test('locking an added unlock removes its draft; pending rolls become candidates when one choice changes', async () => {
  const h = harness(); await h.sandbox.enter();
  await h.sandbox.toggleChunk('4');
  assert.deepEqual(h.current().state.members[0].pendingRoll, []);
  assert.deepEqual(h.current().state.members[0].selected, ['2', '5']);
  assert.equal(h.saved.state.members[0].pendingRoll.length, 2);
  await h.sandbox.toggleChunk('4'); assert.equal(h.current().state, h.saved.state);
  await h.sandbox.undo(); assert.deepEqual(h.sandbox.markers().unlockChunks, ['4']);
  h.sandbox.reset(); assert.equal(h.current().state, h.saved.state); assert.equal(h.current().fullResult, h.saved.fullResult);
});

test('command guard permits only selected-member challenge additions, locks and task rule overrides', async () => {
  const h = harness(); await h.sandbox.enter();
  for (const command of [
    { type: 'roll', memberId: 'a' }, { type: 'complete-task', memberId: 'a', taskId: 'game', completed: true },
    { type: 'set-task-status', memberId: 'a', taskId: 'game', favorite: true },
    { type: 'set-task-status', memberId: 'a', taskId: 'game', challengeCompleted: true, note: 'secret' },
    { type: 'set-chunk', memberId: 'b', chunkId: '2', status: 'unlocked' },
    { type: 'set-chunk', memberId: 'a', chunkId: '2', status: 'selected' },
    { type: 'set-rule', memberId: 'a', ruleId: 'shared', value: false },
    { type: 'set-task-rule', memberId: 'a', ruleId: '__proto__', value: false },
  ]) await assert.rejects(h.sandbox.command(command), /Exit sandbox/);
  await assert.rejects(h.sandbox.command({ type: 'set-task-status', memberId: 'a', taskId: 'saved', challengeCompleted: false }), /already saved/);
  assert.equal(h.requests.length, 0);
  await h.sandbox.command({ type: 'set-task-rule', memberId: 'a', ruleId: 'Skills', value: false });
  assert.equal(h.current().state.members[0].taskRules.Skills, false); assert.equal(h.saved.state.members[0].taskRules.Skills, true);
  await h.sandbox.command({ type: 'set-task-rule', memberId: 'a', ruleId: 'Skills', value: true });
  assert.equal(h.current().state, h.saved.state);
  await h.sandbox.command({ type: 'set-task-status', memberId: 'a', taskId: 'new', challengeCompleted: true });
  await h.sandbox.command({ type: 'set-task-status', memberId: 'a', taskId: 'new', challengeCompleted: false });
  assert.equal(h.current().state, h.saved.state);
});

test('40 combined chunk edits are allowed and a 41st leaves the draft intact', async () => {
  const h = harness(); await h.sandbox.enter();
  await h.sandbox.toggleChunk('1');
  for (let id = 10; id < 49; id++) await h.sandbox.toggleChunk(String(id));
  assert.equal(h.sandbox.markers().unlockChunks.length, 39); assert.equal(h.sandbox.markers().lockChunks.length, 1);
  const signature = h.sandbox.signature();
  await assert.rejects(h.sandbox.toggleChunk('49'), /at most 40/); assert.equal(h.sandbox.signature(), signature);
});

test('bursts coalesce and a late calculation cannot overwrite a newer draft or reenter after exit', async () => {
  const pending = [], h = harness({ api: () => { const job = deferred(); pending.push(job); return job.promise; } });
  await h.sandbox.enter(); const first = h.sandbox.toggleChunk('2'), second = h.sandbox.toggleChunk('3');
  await flush(); assert.equal(h.requests.length, 1); assert.deepEqual(h.requests[0].body.changes.unlockChunks, ['2', '3']);
  const third = h.sandbox.toggleChunk('6'); pending[0].resolve(h.response(h.requests[0].body));
  await flush(); assert.equal(h.requests.length, 2); assert.deepEqual(h.current().state.members[0].unlocked, ['1', '2', '3', '6']);
  assert.equal(h.current().result, h.saved.result, 'obsolete result was not displayed');
  h.sandbox.exit(); pending[1].resolve(h.response(h.requests[1].body)); await Promise.all([first, second, third]);
  assert.equal(h.sandbox.active, false); assert.equal(h.current().state, h.saved.state); assert.equal(h.current().result, h.saved.result);
});

test('reset detaches the old runner so a new experiment cannot be evaluated by two drain loops', async () => {
  const pending = [], h = harness({ api: () => { const job = deferred(); pending.push(job); return job.promise; } });
  await h.sandbox.enter(); const old = h.sandbox.toggleChunk('2'); await flush();
  h.sandbox.reset(); assert.equal(h.current().state, h.saved.state);
  const fresh = h.sandbox.toggleChunk('3'); await flush();
  pending[0].resolve(h.response(h.requests[0].body)); await old; await flush();
  assert.equal(h.requests.length, 2);
  pending[1].resolve(h.response(h.requests[1].body)); await fresh;
  assert.equal(h.current().result.tasks[0].id, 'new:3');
});

test('preview cache keys include canonical accumulated changes and previews carry matching revision/member', async () => {
  const h = harness(); await h.sandbox.enter(); await h.sandbox.toggleChunk('3'); await h.sandbox.toggleChunk('2');
  const count = h.requests.length, one = h.sandbox.predictUnlock('6'), two = h.sandbox.predictUnlock('6');
  assert.equal(one, two); const preview = await one; assert.equal(h.requests.length, count + 1);
  assert.equal(preview.memberId, 'a'); assert.equal(preview.stateRevision, 7); assert.equal(preview.delta.tasksAdded.length, 6);
  assert.deepEqual(h.requests.at(-1).body, { memberId: 'a', baseRevision: 7, changes: { unlockChunks: ['2', '3'], lockChunks: [], doneTasks: [] }, previewChunkId: '6' });
  await h.sandbox.command({ type: 'set-task-rule', memberId: 'a', ruleId: 'Skills', value: false });
  const next = h.sandbox.predictUnlock('6'); assert.notEqual(next, one); await next;
  assert.deepEqual(h.requests.at(-1).body.changes.taskRules, { Skills: false });
});

test('late previews reject after reset and do not produce cache hits in a subsequent draft', async () => {
  const pending = deferred(), h = harness({ api: (path, body, signal, response) => body.previewChunkId ? pending.promise : Promise.resolve(response(body)) });
  await h.sandbox.enter(); const preview = h.sandbox.predictUnlock('6'); const check = assert.rejects(preview, /sandbox changed/);
  h.sandbox.reset(); pending.resolve(h.response(h.requests[0].body)); await check;
  assert.equal(h.current().state, h.saved.state);
});

test('focused planning sends the whole hypothetical draft and caches only that exact draft and location', async () => {
  const h = harness(); await h.sandbox.enter(); await h.sandbox.toggleChunk('2');
  const one = h.sandbox.ensurePlanningResult('2'), repeated = h.sandbox.ensurePlanningResult('2');
  assert.equal(one, repeated); const evidence = await one;
  assert.equal(evidence.memberId, 'a'); assert.equal(evidence.stateRevision, 7); assert.equal(evidence.rows[0].task.id, 'hypothetical');
  assert.deepEqual(h.requests.at(-1).body, { memberId: 'a', baseRevision: 7, changes: { unlockChunks: ['2'], lockChunks: [], doneTasks: [] }, planningChunkId: '2' });
  await h.sandbox.toggleChunk('3'); const changed = h.sandbox.ensurePlanningResult('2'); assert.notEqual(one, changed); await changed;
  assert.deepEqual(h.requests.at(-1).body.changes.unlockChunks, ['2', '3']);
});

test('late focused planning rejects when its hypothetical map changes', async () => {
  const pending = deferred(), h = harness({ api: (path, body, signal, response) => body.planningChunkId ? pending.promise : Promise.resolve(response(body)) });
  await h.sandbox.enter(); const evidence = h.sandbox.ensurePlanningResult('2'); const check = assert.rejects(evidence, /sandbox changed/);
  await h.sandbox.toggleChunk('3'); pending.resolve(h.response(h.requests[0].body)); await check;
});

test('409 leaves a visible stale sandbox without adopting server state and reset preserves the stale warning', async () => {
  const h = harness({ api: async () => { throw Object.assign(new Error('Revision changed'), { status: 409, state: { revision: 99 } }); } });
  h.sandbox.mount(); await h.sandbox.enter(); await assert.rejects(h.sandbox.toggleChunk('2'), /Revision changed/);
  assert.equal(h.sandbox.stale, true); assert.equal(h.current().state.revision, 7);
  assert.equal(h.banner.hidden, false); assert.ok(h.banner.children.some(node => node.textContent.includes('stale')));
  await assert.rejects(h.sandbox.toggleChunk('3'), /stale/);
  h.sandbox.reset(); assert.equal(h.current().state, h.saved.state); assert.equal(h.sandbox.stale, true);
  h.sandbox.exit(); assert.equal(h.sandbox.stale, false);
});

test('sandbox banner keeps draft controls and does not sample the saved roll pool', async () => {
  const h = harness(); h.sandbox.mount(); await h.sandbox.enter();
  assert.equal(h.toggle.attributes['aria-pressed'], 'true'); assert.equal(h.banner.hidden, false);
  assert.equal(h.banner.children[0].textContent, 'Sandbox: nothing here is saved');
  assert.equal(h.banner.children.some(node => node.className.startsWith('sandbox-rank')), false);
  assert.equal(h.requests.length, 0);
  await h.sandbox.toggleChunk('2'); assert.equal(h.requests.length, 1);
  const controls = h.banner.children.find(node => node.className === 'sandbox-controls'); controls.children[2].events.click();
  assert.equal(h.banner.hidden, true); assert.equal(h.current().state, h.saved.state);
});

test('draft changes abort pending previews and planning, and same-ID undo starts fresh advisory requests', async () => {
  const h = harness({ api: (path, body, signal, response) => {
    if (!body.previewChunkId && !body.planningChunkId) return Promise.resolve(response(body));
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Canceled advisory'), { name: 'AbortError' })), { once: true }));
  } });
  await h.sandbox.enter(); const preview = h.sandbox.predictUnlock('6'), location = h.sandbox.ensurePlanningResult('2');
  const checks = [assert.rejects(preview, { name: 'AbortError' }), assert.rejects(location, { name: 'AbortError' })];
  const originalSignals = h.requests.map(row => row.signal);
  const editing = h.sandbox.toggleChunk('2');
  assert.ok(originalSignals.every(signal => signal.aborted));
  await editing; await h.sandbox.undo();
  const freshPreview = h.sandbox.predictUnlock('6'), freshLocation = h.sandbox.ensurePlanningResult('2');
  assert.notEqual(freshPreview, preview); assert.notEqual(freshLocation, location);
  const freshChecks = [assert.rejects(freshPreview, { name: 'AbortError' }), assert.rejects(freshLocation, { name: 'AbortError' })];
  await Promise.all(checks);
  assert.equal(h.sandbox.predictUnlock('6'), freshPreview, 'old cache cleanup cannot delete a fresh same-key request');
  h.sandbox.exit(); await Promise.all(freshChecks);
  assert.equal(h.current().state, h.saved.state);
});
