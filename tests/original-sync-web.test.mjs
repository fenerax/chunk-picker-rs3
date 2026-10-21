import { readScreenGraph, screenFunctionSources, screenFunctionSource } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createOriginalSync } from '../app/web/original-sync.mjs';
import { groupGoalCommandTypes } from '../app/core/group-goal-types.mjs';

const member = (id, name, sourceMapId) => ({
  id, name, sourceMapId, lastSynced: '2026-10-06T12:00:00Z',
  chunks: { unlock: ['102'], lock: ['101'], keepLocal: ['103'] },
  selections: { add: ['103'], remove: ['102'], before: ['102', '104'], after: ['104', '103'], orderChanged: true },
  blacklist: { add: ['105'], remove: ['106'] },
  pendingRoll: { before: ['107'], after: ['108'], changed: true },
  rules: [{ id: 'F2P', before: false, after: true, shared: true }],
  tasks: {
    complete: [{ id: 'task:mine', label: 'Mine copper', category: 'Skill', sources: ['taskChecks'] }],
    keepLocal: [
      { id: 'task:cleaned', label: 'Mine tin', category: 'Skill', reason: 'Unticked here', sources: ['checkedAllTasks'] },
      { id: 'task:deferred', label: 'Chop oak', category: 'Skill', reason: 'Backlogged here' },
    ],
    keepCompleted: [{ id: 'task:fish', label: 'Catch shrimp', category: 'Skill' }],
    backlogAdd: [{ id: 'task:smith', label: 'Smith bronze', category: 'Skill', reason: 'Need copper first' }],
    keepBacklog: [{ id: 'task:cook', label: 'Cook shrimp', category: 'Skill', reason: 'Save food for later' }],
    unmapped: [{ category: 'Quest', originalId: 'old:quest', label: 'Unknown quest check', candidates: ['Quest A', 'Quest B'], reason: 'ambiguous legacy task ID', sources: ['taskChecks', 'notes'] }],
    backlogConflicts: [{ id: 'task:cook', label: 'Cook shrimp', category: 'Skill', reason: 'Original cooking note', localReason: 'Save food for later' }],
  },
  observations: { notes: { '101': 'Original map note' }, taskChecks: { 'task:a': true }, userTasks: { '101': ['Original custom goal'] } },
});
const snapshot = revision => ({ previewId: 'review-a', currentRevision: revision, capturedAt: '2026-10-07T12:00:00Z', expiresAt: '2100-01-01T00:00:00Z', warnings: ['Unknown source rule retained for inspection.'], members: [member('a', 'Player 1', 'qxa'), member('b', 'Player 2', 'qxb')] });

function harness({ advanced = false, canWrite = true } = {}) {
  class Node {
    constructor(tag, text, cls) { Object.assign(this, { tag, textContent: text ?? '', className: cls ?? '', children: [], events: {}, attributes: {}, disabled: false }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
  }
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const state = { revision: 7, members: [{ id: 'a', name: 'Player 1' }, { id: 'b', name: 'Player 2' }] };
  const ui = { generation: 0, open: false, nodes: [] }, attempts = { fetch: [], commands: [] };
  const context = {
    preferences: () => ({ advanced }), canWrite: () => canWrite,
    el, plain: value => value.replace(/<[^>]*>/g, ''),
    button: (label, action) => { const node = el('button', label); node.events.click = action; return node; },
    list: rows => { const node = el('ul'); node.append(...rows.map(row => el('li', row))); return node; },
    details: (title, ...children) => { const node = el('details'); node.append(el('summary', title), ...children); return node; },
    state: () => state, world: () => ({ chunks: new Map([['102', { name: '<b>Lumbridge</b>' }]]) }), definitions: () => ({ chunks: { '103': { name: 'Varrock' } } }),
    dialogCurrent: generation => ui.open && ui.generation === generation,
    openDialog: (title, ...nodes) => { ui.title = title; ui.nodes = nodes; ui.open = true; return ++ui.generation; },
    closeDialog: generation => { if (context.dialogCurrent(generation)) { ui.open = false; ui.generation++; } },
    api: async (...args) => { attempts.fetch.push(args); return ui.fetchResponse ? await ui.fetchResponse : snapshot(state.revision); },
    command: async (...args) => { attempts.commands.push(args); return ui.applyResponse ? await ui.applyResponse : { state }; },
  };
  const controls = createOriginalSync(context);
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
  const find = (tag, text) => walk(ui.nodes).find(node => node.tag === tag && (text === undefined || node.textContent === text));
  const text = () => walk(ui.nodes).map(node => node.textContent).join('\n');
  const click = label => find('button', label).events.click();
  const check = (name, checked) => { const node = walk(ui.nodes).find(node => node.tag === 'input' && node.attributes['aria-label'] === name); node.checked = checked; node.events.change(); return node; };
  return { state, ui, attempts, context, controls, find, text, click, check, walk };
}

test('More action opens an on-demand, read-only review of both original maps', async () => {
  const h = harness(); assert.deepEqual(h.attempts, { fetch: [], commands: [] });
  await h.controls.open();
  assert.equal(h.ui.title, 'Sync from original picker');
  assert.equal(h.attempts.fetch[0][0], '/api/original-sync/preview');
  assert.deepEqual(h.attempts.fetch[0][1], {});
  assert.equal(h.attempts.commands.length, 0);
  assert.match(h.text(), /Player 1 · Original map/); assert.match(h.text(), /Player 2 · Original map/);
  assert.match(h.text(), /Last synced:/); assert.doesNotMatch(h.text(), /Saved revision|Original map qxa|Original map qxb/);
  assert.ok(h.find('li', 'Unlock Lumbridge')); assert.ok(h.find('li', 'Add candidate Varrock'));
  assert.ok(h.find('summary', 'Kept from this picker (1)')); assert.ok(h.find('li', 'Varrock'));
  assert.ok(h.find('summary', 'Candidate order changes'));
  assert.match(h.text(), /F2P is shared: applying it changes the content rules for both players/);
  assert.match(h.text(), /Original notes \(1\) · view only/); assert.match(h.text(), /Original map note/);
  assert.doesNotMatch(h.text(), /Original task checks \(1\) · view only/);
  assert.doesNotMatch(h.text(), /Original custom tasks|Original custom goal/);
  await h.click('Cancel'); assert.equal(h.ui.open, false); assert.equal(h.attempts.commands.length, 0);
});

test('Apply sends only selected member groups, token and reviewed revision through the command queue', async () => {
  const h = harness(); await h.controls.open();
  const checks = h.walk(h.ui.nodes).filter(node => node.tag === 'input');
  assert.equal(checks.length, 12);
  assert.equal(checks.filter(node => node.checked).length, 8);
  h.check('Player 1: Blacklist', false);
  for (const label of ['Unlocked chunks', 'Selected candidates', 'Blacklist', 'Pending roll']) h.check(`Player 2: ${label}`, false);
  h.check('Player 1: Rules (optional)', true);
  const apply = h.find('button', 'Apply selected changes'); await apply.events.click(); await apply.events.click();
  assert.equal(h.attempts.commands.length, 1);
  assert.deepEqual(h.attempts.commands[0].slice(0, 3), [{ type: 'sync-original', previewId: 'review-a', members: [{ memberId: 'a', groups: ['chunks', 'selections', 'pendingRoll', 'rules'] }] }, 7, undefined]);
  assert.equal(typeof h.attempts.commands[0][3], 'function');
  assert.equal(h.find('button', 'Apply selected changes'), undefined);
  assert.match(h.text(), /Selected original-picker changes applied/);
});

test('an unchanged pending offer remains visible for review without selecting an apply group', async () => {
  const h = harness(), value = snapshot(7);
  value.members[0].pendingRoll = { before: ['108', '109'], after: ['108', '109'], changed: false };
  h.ui.fetchResponse = value;
  await h.controls.open();
  assert.ok(h.find('summary', 'Pending roll choices'));
  assert.ok(h.find('li', '108')); assert.ok(h.find('li', '109'));
  assert.match(h.text(), /Pending roll: no changes/);
  assert.equal(h.walk(h.ui.nodes).some(node => node.tag === 'input' && node.attributes['aria-label'] === 'Player 1: Pending roll'), false);
});

test('Tasks review shows named lists, provenance and preserved backlog reasons before opting in', async () => {
  const h = harness(); await h.controls.open();
  for (const title of ['Complete challenge tasks', 'Keep completed challenge tasks', 'Add to backlog', 'Keep local backlog', 'Original tasks that could not be matched', 'Backlog reason conflicts']) assert.ok(h.find('summary', `${title} (1)`));
  assert.ok(h.find('li', 'Mine copper (Skill)'));
  assert.ok(h.find('summary', 'Kept from this picker (2)'));
  assert.ok(h.find('li', 'Mine tin (Skill) · Unticked here'));
  assert.ok(h.find('li', 'Chop oak (Skill) · Backlogged here'));
  assert.ok(h.find('li', 'Catch shrimp (Skill)'));
  assert.ok(h.find('li', 'Smith bronze (Skill) · Reason: Need copper first'));
  assert.ok(h.find('li', 'Cook shrimp (Skill) · Reason: Save food for later'));
  assert.ok(h.find('li', 'Unknown quest check (Quest) · Could not match this check to a task in this app.'));
  assert.ok(h.find('li', 'Cook shrimp (Skill) · Original reason: Original cooking note · Keep local reason: Save food for later'));
  const checks = h.walk(h.ui.nodes).filter(node => node.tag === 'input' && /Tasks \(optional\)/.test(node.attributes['aria-label']));
  assert.equal(checks.length, 2); assert.ok(checks.every(node => !node.checked));
  assert.match(h.text(), /Rules and Tasks are optional and unchecked by default/);
  assert.match(h.text(), /never remove local completions or backlog entries/);
  assert.match(h.text(), /Local unlocks and task cleanup are kept/);
  assert.match(h.text(), /Challenge checks never update actual personal quests or skills/);
  assert.equal(h.attempts.commands.length, 0);
});

test('Tasks opts in per player as one additive group and submits only the reviewed token', async () => {
  const h = harness(); await h.controls.open();
  for (const owner of ['Player 1', 'Player 2']) for (const label of ['Unlocked chunks', 'Selected candidates', 'Blacklist', 'Pending roll']) h.check(`${owner}: ${label}`, false);
  assert.equal(h.find('button', 'Apply selected changes').disabled, true);
  h.check('Player 1: Tasks (optional)', true);
  assert.equal(h.find('button', 'Apply selected changes').disabled, false);
  h.check('Player 1: Tasks (optional)', false);
  assert.equal(h.find('button', 'Apply selected changes').disabled, true);
  h.check('Player 2: Tasks (optional)', true);
  await h.click('Apply selected changes');
  assert.deepEqual(h.attempts.commands[0].slice(0, 3), [{ type: 'sync-original', previewId: 'review-a', members: [{ memberId: 'b', groups: ['tasks'] }] }, 7, undefined]);
});

test('preserved and unmapped Tasks remain reviewable without import additions', async () => {
  const h = harness(), value = snapshot(7);
  value.members = [value.members[0]];
  value.members[0].tasks.complete = []; value.members[0].tasks.backlogAdd = [];
  h.ui.fetchResponse = value; await h.controls.open();
  assert.equal(h.walk(h.ui.nodes).some(node => node.tag === 'input' && node.attributes['aria-label'] === 'Player 1: Tasks (optional)'), false);
  assert.ok(h.find('summary', 'Complete challenge tasks (0)'));
  assert.ok(h.find('summary', 'Add to backlog (0)'));
  for (const title of ['Keep completed challenge tasks', 'Keep local backlog', 'Original tasks that could not be matched', 'Backlog reason conflicts']) assert.ok(h.find('summary', `${title} (1)`));
  assert.match(h.text(), /Tasks \(optional\): no changes/);
});

test('local protections alone stay visible without selectable changes', async () => {
  const h = harness(), value = snapshot(7);
  value.members = [value.members[0]];
  const owner = value.members[0];
  Object.assign(owner, {
    chunks: { unlock: [], lock: [], keepLocal: ['103'] },
    selections: { add: [], remove: [], before: [], after: [], orderChanged: false },
    blacklist: { add: [], remove: [] }, pendingRoll: { before: [], after: [], changed: false }, rules: [],
    tasks: { complete: [], backlogAdd: [], keepLocal: [...owner.tasks.keepLocal, { id: 'task:other', label: 'Smelt bronze', category: 'Skill' }] },
  });
  h.ui.fetchResponse = value; await h.controls.open();
  assert.ok(h.find('summary', 'Kept from this picker (1)'));
  assert.ok(h.find('li', 'Varrock'));
  assert.ok(h.find('summary', 'Kept from this picker (3)'));
  assert.ok(h.find('li', 'Mine tin (Skill) · Unticked here'));
  assert.ok(h.find('li', 'Chop oak (Skill) · Backlogged here'));
  assert.ok(h.find('li', 'Smelt bronze (Skill)'));
  assert.match(h.text(), /Unlocked chunks: no changes/);
  assert.match(h.text(), /Tasks \(optional\): no changes/);
  assert.equal(h.walk(h.ui.nodes).filter(node => node.tag === 'input').length, 0);
  assert.equal(h.find('button', 'Apply selected changes').disabled, true);
  await h.click('Apply selected changes'); assert.equal(h.attempts.commands.length, 0);
  assert.doesNotMatch(h.text(), /task:cleaned|task:deferred|task:other|checkedAllTasks/);
});

test('backlog additions alone offer Tasks and older previews show empty task lists', async () => {
  const h = harness(), value = snapshot(7);
  value.members[0].tasks.complete = [];
  delete value.members[0].tasks.backlogConflicts;
  delete value.members[1].tasks;
  h.ui.fetchResponse = value; await h.controls.open();
  const checks = h.walk(h.ui.nodes).filter(node => node.tag === 'input' && /Tasks \(optional\)/.test(node.attributes['aria-label']));
  assert.equal(checks.length, 1); assert.equal(checks[0].attributes['aria-label'], 'Player 1: Tasks (optional)'); assert.equal(checks[0].checked, false);
  for (const title of ['Complete challenge tasks', 'Keep completed challenge tasks', 'Add to backlog', 'Keep local backlog', 'Original tasks that could not be matched', 'Backlog reason conflicts']) assert.ok(h.find('summary', `${title} (0)`));
});

test('original task labels and reasons render through plain text nodes', async () => {
  const h = harness(), value = snapshot(7);
  value.members[0].tasks.complete[0].label = '<b>Mine copper</b><img src=x onerror=alert(1)>';
  value.members[0].tasks.backlogAdd[0].reason = '<script>alert(1)</script>Need copper';
  value.members[0].tasks.keepLocal[0].label = '<b>Mine tin</b><img src=x onerror=alert(1)>';
  value.members[0].tasks.keepLocal[0].reason = '<b>Unticked here</b>';
  h.ui.fetchResponse = value; await h.controls.open();
  assert.ok(h.find('li', 'Mine copper (Skill)'));
  assert.ok(h.find('li', 'Smith bronze (Skill) · Reason: alert(1)Need copper'));
  assert.ok(h.find('li', 'Mine tin (Skill) · Unticked here'));
  assert.equal(h.walk(h.ui.nodes).some(node => ['script', 'img', 'b'].includes(node.tag) || 'innerHTML' in node), false);
});

test('no differences or no checked groups disables Apply', async () => {
  for (const noDifferences of [true, false]) {
    const h = harness();
    if (noDifferences) {
      const value = snapshot(7);
      for (const owner of value.members) Object.assign(owner, { chunks: { unlock: [], lock: [] }, selections: { add: [], remove: [], before: [], after: [], orderChanged: false }, blacklist: { add: [], remove: [] }, pendingRoll: { before: [], after: [], changed: false }, rules: [], tasks: { complete: [], keepCompleted: [], backlogAdd: [], keepBacklog: [], unmapped: [] } });
      h.ui.fetchResponse = value;
    }
    await h.controls.open();
    if (!noDifferences) for (const owner of ['Player 1', 'Player 2']) for (const label of ['Unlocked chunks', 'Selected candidates', 'Blacklist', 'Pending roll']) h.check(`${owner}: ${label}`, false);
    assert.equal(h.find('button', 'Apply selected changes').disabled, true);
    await h.click('Apply selected changes'); assert.equal(h.attempts.commands.length, 0);
  }
});

test('adopting a successful Apply revision leaves the success message visible', async () => {
  const h = harness(); await h.controls.open();
  h.context.command = async (...args) => { h.attempts.commands.push(args); h.state.revision++; h.controls.refresh(); return { state: h.state }; };
  await h.click('Apply selected changes'); h.controls.refresh();
  assert.match(h.text(), /Selected original-picker changes applied/); assert.doesNotMatch(h.text(), /Saved state changed/);
  assert.equal(h.find('button', 'Apply selected changes'), undefined);
});

test('incoming revision invalidates review immediately and a stale preview cannot render', async () => {
  const h = harness(); await h.controls.open(); const apply = h.find('button', 'Apply selected changes');
  h.state.revision++; h.controls.refresh();
  assert.equal(apply.disabled, true); assert.ok(h.walk(h.ui.nodes).filter(node => node.tag === 'input').every(node => node.disabled));
  await apply.events.click(); assert.equal(h.attempts.commands.length, 0); assert.match(h.text(), /Fetch a fresh original-picker preview/);
  h.ui.fetchResponse = snapshot(7); await h.click('Fetch fresh preview');
  assert.equal(h.find('button', 'Apply selected changes'), undefined);
  h.ui.fetchResponse = undefined; await h.click('Fetch fresh preview'); await h.click('Apply selected changes');
  assert.equal(h.attempts.commands[0][1], 8);
});

test('fetch failures are visible and can be retried without applying', async () => {
  const h = harness(); h.ui.fetchResponse = Promise.reject(new Error('Original map qxb could not be fetched.'));
  await h.controls.open(); assert.match(h.text(), /Original map qxb could not be fetched/);
  assert.ok(h.find('button', 'Retry fetch')); assert.equal(h.find('button', 'Apply selected changes'), undefined);
  h.ui.fetchResponse = undefined; await h.click('Retry fetch'); assert.equal(h.attempts.fetch.length, 2);
  assert.ok(h.find('button', 'Apply selected changes')); assert.equal(h.attempts.commands.length, 0);
});

test('late preview responses cannot update closed, cancelled or superseded dialogs', async () => {
  for (const outcome of ['resolve', 'reject']) for (const reason of ['close', 'cancel', 'generation']) {
    const h = harness(); let settle;
    h.ui.fetchResponse = new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; });
    const pending = h.controls.open();
    if (reason === 'close') h.ui.open = false;
    else if (reason === 'cancel') await h.click('Cancel');
    else h.ui.generation++;
    const before = h.text(); settle(outcome === 'resolve' ? snapshot(7) : new Error('Late source failure')); await pending;
    assert.equal(h.text(), before); assert.equal(h.find('button', 'Apply selected changes'), undefined);
  }
});

test('superseded fetch and apply callbacks preserve the newer dialog', async () => {
  const h = harness(); let resolveOld;
  h.ui.fetchResponse = new Promise(resolve => { resolveOld = resolve; }); const old = h.controls.open();
  await h.click('Cancel'); h.ui.fetchResponse = undefined; await h.controls.open();
  resolveOld({ ...snapshot(7), previewId: 'old-review' }); await old;
  let settle; h.ui.applyResponse = new Promise(resolve => { settle = resolve; });
  const pending = h.click('Apply selected changes'); h.ui.generation++;
  const before = h.text(); settle({ state: h.state }); await pending;
  assert.equal(h.attempts.commands[0][0].previewId, 'review-a'); assert.equal(h.attempts.commands[0][3](), false);
  assert.equal(h.text(), before);
});

test('validation failures let related groups be selected, while stale and expired reviews require refetch', async () => {
  const h = harness(); await h.controls.open(); h.check('Player 1: Selected candidates', false);
  h.ui.applyResponse = Promise.reject(new Error('Select chunks and selections together to avoid overlap.'));
  await h.click('Apply selected changes'); assert.match(h.text(), /Select chunks and selections together/);
  h.check('Player 1: Selected candidates', true); h.ui.applyResponse = undefined; await h.click('Apply selected changes');
  assert.equal(h.attempts.commands.length, 2);
  for (const error of [Object.assign(new Error('Stale review'), { status: 409 }), new Error('Original-picker preview expired.')]) {
    const x = harness(); await x.controls.open(); x.ui.applyResponse = Promise.reject(error);
    const apply = x.find('button', 'Apply selected changes'); await apply.events.click(); await apply.events.click();
    assert.equal(x.attempts.commands.length, 1); assert.equal(apply.disabled, true);
  }
  const expired = harness(); expired.ui.fetchResponse = { ...snapshot(7), expiresAt: '2000-01-01T00:00:00Z' };
  await expired.controls.open(); await expired.click('Apply selected changes'); assert.equal(expired.attempts.commands.length, 0); assert.match(expired.text(), /preview expired/);
});

const graph = await readScreenGraph();
const source = screenFunctionSources(graph);
const helperSource = screenFunctionSource(graph, 'command');
function commandHarness() {
  const requests = [], statuses = [], errors = [];
  const ctx = createContext({
    groupGoalCommandTypes, document: { activeElement: null }, canWrite: () => true, $: () => undefined, sandbox: { active: false }, queue: Promise.resolve(), state: { revision: 7, history: [] }, memberId: 'a', result: undefined,
    sessionMember: 'a', sessionAdmin: false, sessionReadOnly: false,
    saved: (...args) => statuses.push(args), showError: error => errors.push(error.message),
    reviewedNoteRevision: (_state, _payload, revision) => revision,
    recoverPendingCommand: async () => {},
    api: async (path, body) => { requests.push({ path, body }); if (ctx.failure) throw ctx.failure; return { state: { revision: 8, history: [] }, pools: {} }; },
    adopt: state => { ctx.state = state; },
  });
  runInContext(helperSource, ctx);
  return { ctx, requests, statuses, errors };
}

test('queued original sync abandons a closed review before dispatch and does not show a save failure', async () => {
  const h = commandHarness(); let release, current = true;
  h.ctx.queue = new Promise(resolve => { release = resolve; });
  const pending = h.ctx.command({ type: 'sync-original', previewId: 'a', members: [] }, 7, undefined, () => current);
  current = false; release(); await assert.rejects(pending, /review was closed/);
  await h.ctx.queue; assert.deepEqual(h.requests, []); assert.deepEqual(h.statuses, []); assert.deepEqual(h.errors, []);
});

test('queued original sync uses reviewed revision and does not retry a server conflict', async () => {
  const h = commandHarness(); h.ctx.failure = Object.assign(new Error('Stale shared state'), { status: 409 });
  const payload = { type: 'sync-original', previewId: 'a', members: [{ memberId: 'a', groups: ['chunks'] }] };
  await assert.rejects(h.ctx.command(payload, 7, undefined, () => true), /Stale shared state/);
  await h.ctx.queue; assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), { path: '/api/command', body: { expectedRevision: 7, command: payload } });
});

test('original-sync mounts only for a supported dataset and retains the shared dialog refresh hook', async () => {
  const html = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="original-sync-open"/);
  assert.match(source, /if \(createOriginalSync && supportsFeature\?\.\('originalSync'\) !== false\)/);
  assert.match(source, /mountOriginalSyncControl\(c\)/);
  assert.match(source, /'original-sync-open': originalSync\.open/); assert.match(source, /originalSync\.refresh\(\)/);
});


test('raw original save data and named chunk IDs require Advanced and stay hidden for viewers', async () => {
  for (const [advanced, canWrite] of [[false, true], [true, true], [true, false]]) {
    const h = harness({ advanced, canWrite }); await h.controls.open();
    const raw = advanced && canWrite;
    assert.equal(!!h.find('pre'), raw);
    assert.equal(/Saved revision 7/.test(h.text()), raw);
    assert.equal(/Original ID: old:quest/.test(h.text()), raw);
    assert.equal(!!h.find('li', raw ? 'Unlock Lumbridge (102)' : 'Unlock Lumbridge'), true);
    assert.equal(/Sources: taskChecks/.test(h.text()), raw);
    assert.equal(/Sources: checkedAllTasks/.test(h.text()), raw);
    assert.ok(h.find('li', raw ? 'Varrock (103)' : 'Varrock'));
    assert.ok(h.find('li', raw ? 'Mine tin (Skill) · Unticked here · Sources: checkedAllTasks' : 'Mine tin (Skill) · Unticked here'));
    assert.doesNotMatch(h.text(), /task:cleaned|task:deferred/);
    assert.ok(h.find('summary', 'Original tasks that could not be matched (1)'));
    assert.equal(h.attempts.commands.length, 0);
  }
});
