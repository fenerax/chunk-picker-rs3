import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { createRuneMetricsControls, skillChangeText } from '../app/web/runemetrics.mjs';
import { createInfoPanels } from '../app/web/info-panels.mjs';

const snapshot = revision => ({
  previewId: 'review-a', stateRevision: revision, memberId: 'a', runescapeName: 'AccountA', fetchedAt: '2026-10-07T12:00:00Z', cached: true,
  skills: [
    { skill: 'Mining', before: { level: 5, xp: 400 }, after: { level: 6, xp: 550.5 } },
    { skill: 'Attack', before: { level: 4, xp: 300 }, after: { level: 3, xp: 200 } },
    { skill: 'Strength', before: null, after: { level: 1, xp: 0 } },
  ],
  quests: [{ taskId: 'quest:test', title: 'A completed quest', label: 'Whole quest completion' }],
  unmatched: { skills: [{ id: 99, level: 12 }], quests: [{ title: 'Quest step only', reason: 'No whole-completion record' }] },
  counts: { completedQuests: 13, matchedQuests: 12, unmatchedQuests: 1 },
});

function harness({ advanced = false, canWrite = true } = {}) {
  class Node {
    constructor(tag, text, cls) { Object.assign(this, { tag, textContent: text ?? '', className: cls ?? '', children: [], events: {}, attributes: {}, value: '', disabled: false }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
    focus() {}
  }
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const state = { revision: 7, members: [
    { id: 'a', name: 'Player', runescapeName: 'AccountA', runeMetricsSync: { runescapeName: 'AccountA', fetchedAt: '2026-10-06T12:00:00Z' }, completedTasks: [], skillProgress: {} },
    { id: 'b', name: 'Reed', runescapeName: 'AccountB', completedTasks: [] },
  ] };
  const ui = { generation: 3, memberId: 'a', open: true, refreshed: 0, nodes: [] };
  const attempts = { fetch: [], apply: [], commands: [] };
  const generation = ui.generation;
  const context = {
    preferences: () => ({ advanced }), canWrite: () => canWrite,
    el, plain: value => value,
    field: (label, input) => { const node = el('label'); node.append(el('span', label), input); return node; },
    button: (label, action) => { const node = el('button', label); node.events.click = action; return node; },
    list: rows => { const node = el('ul'); node.append(...rows.map(row => el('li', row))); return node; },
    details: (title, ...children) => { const node = el('details'); node.append(el('summary', title), ...children); return node; },
    state: () => state, memberId: () => ui.memberId,
    command: async (command, revision) => { attempts.commands.push({ command, revision }); },
    api: async (...args) => { attempts.fetch.push(args); return ui.fetchResponse ? await ui.fetchResponse : snapshot(state.revision); },
    applyRuneMetrics: async (...args) => { attempts.apply.push(args); return ui.applyResponse ? await ui.applyResponse : { state }; },
  };
  const controls = createRuneMetricsControls(context, { memberId: 'a', isCurrent: () => ui.open && ui.generation === generation, onApplied: () => { ui.refreshed++; } });
  ui.nodes = [controls];
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
  const find = (tag, text) => walk(ui.nodes).find(node => node.tag === tag && (text === undefined || node.textContent === text));
  const text = () => walk(ui.nodes).map(node => node.textContent).join('\n');
  const click = label => find('button', label).events.click();
  return { state, ui, attempts, context, find, text, click, walk };
}

test('account editing and fetch are explicit, bound to the selected personal member', async () => {
  const h = harness();
  assert.equal(h.find('input').value, 'AccountA');
  assert.match(h.text(), /Player · Last applied web snapshot:/);
  assert.match(h.text(), /apply them as personal progress/);
  assert.deepEqual(h.attempts, { fetch: [], apply: [], commands: [] });
  h.find('input').value = 'RenamedA'; h.find('input').events.input();
  await h.click('Sync progress');
  assert.equal(h.attempts.fetch.length, 0);
  assert.match(h.text(), /Save this player’s RuneScape account name/);
  await h.click('Save RuneScape name');
  assert.deepEqual(h.attempts.commands, [{ command: { type: 'set-runescape-name', memberId: 'a', name: 'RenamedA' }, revision: 7 }]);
  assert.equal(h.ui.refreshed, 1);
});

test('preview shows increases, decreases, unknown prior XP, personal quests and unmatched evidence without applying', async () => {
  const h = harness(); await h.click('Sync progress');
  assert.equal(h.attempts.fetch[0][0], '/api/runemetrics/preview');
  assert.deepEqual(h.attempts.fetch[0][1], { memberId: 'a' });
  assert.match(h.text(), /recent saved result/);
  assert.match(h.text(), /13 completed quests returned · 12 matched · 1 unmatched/);
  assert.ok(h.find('li', 'Mining: level 5 → 6 (+1) · XP 400 → 550.5 (+150.5)'));
  assert.equal(h.find('li', 'Attack: level 4 → 3 (−1) · XP 300 → 200 (−100)').className, 'warning');
  assert.ok(h.find('li', 'Strength: level unknown → 1 · XP unknown → 0'));
  assert.ok(h.find('li', 'A completed quest → Whole quest completion'));
  assert.ok(h.find('li', 'Unknown skill · reported level 12'));
  assert.ok(h.find('li', 'Quest step only · Could not match this to a quest completion in this app.'));
  assert.equal(h.attempts.apply.length, 0); assert.equal(h.attempts.commands.length, 0);
  await h.click('Cancel preview');
  assert.equal(h.find('button', 'Apply progress snapshot'), undefined);
  assert.equal(h.attempts.apply.length, 0);
});

test('only Apply sends the reviewed token and revision, and a completed click cannot apply twice', async () => {
  const h = harness(); await h.click('Sync progress');
  const apply = h.find('button', 'Apply progress snapshot');
  await apply.events.click(); await apply.events.click();
  assert.deepEqual(h.attempts.apply, [['review-a', 7]]);
  assert.equal(h.ui.refreshed, 1);
});

test('sync names the selected source and the unavailable state offers no Apply or warning', async () => {
  const h = harness();
  h.ui.fetchResponse = { ...snapshot(7), source: 'game-plugin', sourceLabel: 'Game plugin' };
  await h.click('Sync progress');
  assert.match(h.text(), /Source: Game plugin/);
  assert.doesNotMatch(h.text(), /Saved revision/);
  h.ui.fetchResponse = { available: false, memberId: 'a', runescapeName: 'AccountA', source: 'official-api',
    message: 'The new RuneScape API is not available yet. Levels sync from the game plugin now.' };
  await h.click('Sync progress');
  assert.equal(h.find('button', 'Apply progress snapshot'), undefined);
  assert.match(h.text(), /game plugin now/);
  assert.equal(h.walk(h.ui.nodes).find(node => node.attributes.role === 'status').className, 'info-meta');
  assert.equal(h.attempts.apply.length, 0);
});

test('a usable fallback preview keeps the one closure message visible alongside Apply', async () => {
  const h = harness();
  const message = 'RuneMetrics has closed; levels and quests come from the game plugin until the new Jagex API is connected';
  h.ui.fetchResponse = { ...snapshot(7), source: 'hiscores', sourceLabel: 'RS3 hiscores', message };
  await h.click('Sync progress');
  assert.equal(h.walk(h.ui.nodes).find(node => node.attributes.role === 'status').textContent, message);
  assert.ok(h.find('button', 'Apply progress snapshot'));
  assert.equal(h.text().split(message).length - 1, 1);
});

test('plugin sync does not require a saved web account name', async () => {
  const h = harness(); h.state.members[0].runescapeName = ''; h.find('input').value = '';
  h.ui.fetchResponse = { ...snapshot(7), runescapeName: '', source: 'game-plugin', sourceLabel: 'Game plugin' };
  await h.click('Sync progress');
  assert.match(h.text(), /Source: Game plugin/);
  assert.ok(h.find('button', 'Apply progress snapshot'));
});

test('edited account and changed shared revision invalidate the reviewed apply', async () => {
  const h = harness(); await h.click('Sync progress');
  const apply = h.find('button', 'Apply progress snapshot'); h.state.revision++;
  await apply.events.click();
  assert.equal(h.attempts.apply.length, 0); assert.equal(apply.disabled, true);
  assert.match(h.text(), /Fetch a new progress preview and review it/);
  await h.click('Sync progress');
  const refreshed = h.find('button', 'Apply progress snapshot');
  h.find('input').value = 'AccountB'; h.find('input').events.input();
  await refreshed.events.click();
  assert.equal(h.attempts.apply.length, 0);
});

test('a stale server response does not retry Apply and requires a new preview', async () => {
  const h = harness(); await h.click('Sync progress');
  h.ui.applyResponse = Promise.reject(Object.assign(new Error('Stale review'), { status: 409 }));
  const apply = h.find('button', 'Apply progress snapshot');
  await apply.events.click(); await apply.events.click();
  assert.equal(h.attempts.apply.length, 1); assert.equal(apply.disabled, true);
  assert.match(h.text(), /Fetch a new progress preview and review it/);
  assert.equal(h.ui.refreshed, 0);
});

test('an expired or failed Apply token requires a freshly fetched review', async () => {
  const h = harness(); await h.click('Sync progress');
  h.ui.applyResponse = Promise.reject(new Error('Preview expired. Fetch a new snapshot.'));
  const expired = h.find('button', 'Apply progress snapshot');
  await expired.events.click(); await expired.events.click();
  assert.equal(h.attempts.apply.length, 1); assert.equal(expired.disabled, true);
  assert.match(h.text(), /Preview expired/);
  h.ui.applyResponse = undefined;
  await h.click('Sync progress'); await h.click('Apply progress snapshot');
  assert.equal(h.attempts.fetch.length, 2); assert.equal(h.attempts.apply.length, 2);
});

test('late preview success or failure cannot update a switched, closed or superseded dialog', async () => {
  for (const outcome of ['resolve', 'reject']) {
    for (const invalidation of ['member', 'close', 'generation', 'cancel']) {
      const h = harness(); let settle;
      h.ui.fetchResponse = new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; });
      const pending = h.click('Sync progress');
      if (invalidation === 'member') h.ui.memberId = 'b';
      else if (invalidation === 'close') h.ui.open = false;
      else if (invalidation === 'generation') h.ui.generation++;
      else await h.click('Cancel preview');
      const prior = h.text();
      settle(outcome === 'resolve' ? snapshot(7) : new Error('Late private-profile failure'));
      await assert.doesNotReject(pending);
      assert.equal(h.text(), prior, `${outcome}, ${invalidation}`);
      assert.equal(h.find('button', 'Apply progress snapshot'), undefined);
    }
  }
});

test('cancelled fetch cannot overwrite a newer on-demand review', async () => {
  const h = harness(); let resolveOld;
  h.ui.fetchResponse = new Promise(resolve => { resolveOld = resolve; });
  const old = h.click('Sync progress'); await h.click('Cancel preview');
  h.ui.fetchResponse = undefined; await h.click('Sync progress');
  resolveOld({ ...snapshot(7), previewId: 'old-review', skills: [] }); await old;
  await h.click('Apply progress snapshot');
  assert.deepEqual(h.attempts.apply, [['review-a', 7]]);
});

test('late Apply completion does not reopen a newer dialog, while the explicit request stays bound', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const h = harness(); await h.click('Sync progress'); let settle;
    h.ui.applyResponse = new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; });
    const pending = h.click('Apply progress snapshot'); h.ui.generation++;
    const prior = h.text(); settle(outcome === 'resolve' ? { state: h.state } : new Error('Late save failure'));
    await pending;
    assert.deepEqual(h.attempts.apply, [['review-a', 7]]);
    assert.equal(h.ui.refreshed, 0); assert.equal(h.text(), prior);
  }
});

test('a preview for a different member or account cannot be accepted', async () => {
  for (const changed of [{ memberId: 'b' }, { runescapeName: 'AccountB' }]) {
    const h = harness(); h.ui.fetchResponse = { ...snapshot(7), ...changed }; await h.click('Sync progress');
    assert.equal(h.find('button', 'Apply progress snapshot'), undefined);
    assert.match(h.text(), /account changed while fetching/); assert.equal(h.attempts.apply.length, 0);
  }
});

test('Activity Info displays observed account progress separately from planning controls', async () => {
  const h = harness();
  h.state.members[0].skillProgress.Mining = { level: 6, xp: 550.5, source: 'runemetrics', runescapeName: 'AccountA', fetchedAt: '2026-10-07T12:00:00Z' };
  const result = { memberId: 'a', stateRevision: 7, tasks: [], playerControls: {}, activityInfo: {
    skills: [{ skill: 'Mining', reachableLevel: 99, availableTasks: [], blockedTasks: [], primaryMethods: [], selectedGoals: [], explanation: 'Planning ceiling.' }],
    quests: [], achievements: [], activities: [], slayer: {}, clues: { tiers: [], limitations: [] }, coverage: { limitations: [] },
  } };
  const panels = createInfoPanels({ ...h.context, ensureResult: async () => result,
    dialogGeneration: () => h.ui.generation, beginDialogRequest: () => ++h.ui.generation, isDialogOpen: () => h.ui.open,
    openDialog: (title, ...nodes) => { h.ui.nodes = nodes; h.ui.open = true; return ++h.ui.generation; },
  });
  await panels.activityInfo();
  assert.ok(h.find('summary', 'Progress sync'));
  // Skills open as a tile grid; a tile shows the synced level and opens that skill's detail.
  const tile = h.walk(h.ui.nodes).find(node => node.tag === 'button' && node.attributes?.['aria-label']?.startsWith('Mining: level 6'));
  assert.ok(tile, 'Mining tile carries the observed level');
  await tile.events.click();
  assert.match(h.text(), /Level 6 · 550\.5 XP \(RuneMetrics\)/);
  const manual = h.walk(h.ui.nodes).find(node => node.tag === 'details' && node.children[0]?.textContent === 'Training assumptions');
  manual.open = true; manual.events.toggle();
  assert.match(h.text(), /Progress sync records actual account levels and XP separately/);
});

const graph = await readScreenGraph();
const helperSource = screenFunctionSource(graph, 'applyRuneMetrics');
function saveHarness() {
  const requests = [], statuses = [], errors = [];
  const ctx = createContext({
    memberId: 'a', dialogGeneration: 3, state: { revision: 7 }, queue: Promise.resolve(),
    dialogCurrent: generation => generation === ctx.dialogGeneration && ctx.open,
    open: true, saved: (...args) => statuses.push(args), showError: error => errors.push(error.message),
    api: async (path, body) => { requests.push({ path, body }); if (ctx.failure) throw ctx.failure; return { state: { revision: 8 }, pools: { a: {} } }; },
    adopt: (state, pools) => { ctx.state = state; ctx.pools = pools; },
  });
  runInContext(helperSource, ctx);
  return { ctx, requests, statuses, errors };
}

test('main queues one apply, adopts committed state and uses shared save status', async () => {
  const h = saveHarness(); let release;
  h.ctx.queue = new Promise(resolve => { release = resolve; });
  const pending = h.ctx.applyRuneMetrics('review-a', 7);
  await Promise.resolve(); assert.equal(h.requests.length, 0);
  release(); await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [{ path: '/api/runemetrics/apply', body: { previewId: 'review-a', expectedRevision: 7 } }]);
  assert.equal(h.ctx.state.revision, 8); assert.ok(h.ctx.pools.a);
  assert.equal(h.statuses[0][0], 'Saving…'); assert.deepEqual(h.statuses.at(-1).slice(0, 3), ['Saved', false, 8]);
  assert.equal(h.statuses.at(-1)[3].confirmed, true);
});

test('an already dispatched main Apply adopts saved state while preserving a newer dialog', async () => {
  const h = saveHarness(); let resolve;
  h.ctx.api = async (path, body) => { h.requests.push({ path, body }); return await new Promise(done => { resolve = done; }); };
  const pending = h.ctx.applyRuneMetrics('review-a', 7);
  await Promise.resolve(); assert.equal(h.requests.length, 1);
  h.ctx.dialogGeneration = 4; h.ctx.memberId = 'b';
  resolve({ state: { revision: 8 }, pools: { b: {} } }); await pending;
  assert.equal(h.ctx.state.revision, 8); assert.equal(h.ctx.dialogGeneration, 4); assert.equal(h.ctx.memberId, 'b');
  assert.deepEqual(h.errors, []);
});

test('main never dispatches abandoned or stale queued reviews and never retries a conflict', async () => {
  for (const invalidation of ['member', 'close', 'generation', 'revision']) {
    const h = saveHarness(); let release;
    h.ctx.queue = new Promise(resolve => { release = resolve; });
    const pending = h.ctx.applyRuneMetrics('review-a', 7);
    if (invalidation === 'member') h.ctx.memberId = 'b';
    else if (invalidation === 'close') h.ctx.open = false;
    else if (invalidation === 'generation') h.ctx.dialogGeneration++;
    else h.ctx.state.revision++;
    release(); await assert.rejects(pending, /review|Saved state changed/);
    assert.equal(h.requests.length, 0, invalidation);
  }
  const h = saveHarness(); h.ctx.failure = Object.assign(new Error('Stale save'), { status: 409 });
  await assert.rejects(h.ctx.applyRuneMetrics('review-a', 7), /Fetch a new RuneMetrics preview/);
  assert.equal(h.requests.length, 1); assert.equal(h.statuses.at(-1)[0], 'Save failed');
});

test('XP-only differences and decreases are readable', () => {
  assert.equal(skillChangeText({ skill: 'Mining', before: { level: 6, xp: 550.5 }, after: { level: 6, xp: 500 } }), 'Mining: level 6 → 6 · XP 550.5 → 500 (−50.5)');
});


test('RuneMetrics sync keeps raw skill IDs and save revisions in Advanced, including viewer suppression', async () => {
  for (const [advanced, canWrite] of [[false, true], [true, true], [true, false]]) {
    const h = harness({ advanced, canWrite }); await h.click('Sync progress');
    const raw = advanced && canWrite;
    assert.equal(/Skill ID 99/.test(h.text()), raw);
    assert.equal(/Saved revision 7/.test(h.text()), raw);
    assert.match(h.text(), /reported level 12/);
    assert.equal(h.attempts.apply.length, 0);
  }
});
