import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDuoTasks, duoCommandTarget, createDuoResultCache } from '../app/web/duo-tasks.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';

const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
const task = (id, extra = {}) => ({ id, label: id, category: 'Extra', status: 'available', ...extra });
const state = () => ({ revision: 5, rules: {}, tasks: [], members: [
  { id: 'actor1', name: 'Player', completedTasks: [], taskStatus: {} },
  { id: 'reed', name: 'Reed', completedTasks: [], taskStatus: {} },
] });
const result = (memberId, tasks, presented = tasks) => ({ memberId, stateRevision: 5, tasks, presentation: { tasks: presented, suppressed: {} } });
const select = (snapshot, results, options = {}) => selectDuoTasks({ state: snapshot, results, registry, selectedMemberId: 'actor1', ...options });
const ids = value => value.rows.map(row => row.id);

test('blocked inspection retains owner-specific imported rows with no engine result', () => {
  const snapshot = state(), imported = task('imported'); snapshot.tasks = [imported];
  snapshot.members[1].taskStatus.imported = { note: 'Preserved' };
  const results = [result('actor1', []), result('reed', [])];
  assert.deepEqual(ids(select(snapshot, results, { showAll: true })), []);
  const view = select(snapshot, results, { showBlocked: true });
  assert.deepEqual(ids(view), ['imported']); assert.deepEqual(view.rows[0].memberIds, ['reed']);
  assert.match(view.rows[0].task.blockers[0].detail, /Preserved imported task/);
});

test('inspection under personal completion rules retains the unfinished partner contribution', () => {
  const snapshot = state(), shared = task('shared');
  snapshot.rules['tasks.completion'] = 'personal';
  snapshot.members[0].taskStatus.shared = { challengeCompleted: true };
  const results = [result('actor1', [shared], []), result('reed', [shared])];
  for (const options of [{}, { showAll: true }, { showBlocked: true }]) {
    const view = select(snapshot, results, options);
    assert.deepEqual(ids(view), ['shared']); assert.deepEqual(view.rows[0].memberIds, ['reed']);
    assert.deepEqual(ids(select(snapshot, results, { ...options, ownerFilter: 'actor1' })), []);
    assert.deepEqual(ids(select(snapshot, results, { ...options, ownerFilter: 'reed' })), ['shared']);
  }
  assert.deepEqual(select(snapshot, results, { showAll: true, showCompleted: true }).rows[0].memberIds, ['actor1', 'reed']);
});

test('inspection switches broaden both personal catalogues without reviving hidden, never-show or backlogged rows', () => {
  const snapshot = state(), active = task('active'), lower = task('lower'), blocked = task('blocked', { status: 'blocked', blockers: [{ detail: 'Needs Mining 40' }] });
  const excluded = [task('hidden', { hidden: true }), task('never', { neverShow: true }), task('never-ref'), task('resource', { obligation: false }), task('backlog')];
  snapshot.members[0].taskStatus.backlog = { backlogged: true };
  snapshot.members[1].taskStatus.backlog = { backlogged: true };
  const a = result('actor1', [active, lower, blocked, ...excluded], [active]), b = result('reed', [lower, { ...blocked, blockers: [{ detail: 'Needs item' }] }, ...excluded], []);
  a.neverShowIds = b.neverShowIds = ['never-ref'];
  assert.deepEqual(ids(select(snapshot, [a, b])), ['active']);
  assert.deepEqual(new Set(ids(select(snapshot, [a, b], { showAll: true }))), new Set(['active', 'lower']));
  for (const ownerFilter of ['all', 'actor1', 'reed', 'both']) {
    const view = select(snapshot, [a, b], { showBlocked: true, ownerFilter });
    const shared = view.rows.find(row => row.id === blocked.id);
    assert.ok(shared, ownerFilter); assert.equal(shared.tasksByMember.actor1.blockers[0].detail, 'Needs Mining 40');
    assert.equal(shared.tasksByMember.reed.blockers[0].detail, 'Needs item');
    if (ownerFilter === 'reed') { assert.equal(shared.memberId, 'reed'); assert.equal(shared.task.blockers[0].detail, 'Needs item'); }
    assert.equal(view.rows.some(row => excluded.some(task => task.id === row.id)), false);
  }
  assert.deepEqual(ids(select(snapshot, [a, b], { searchAll: true, ownerFilter: 'both' })), ['lower']);
});

test('not done uses selected personal completion including quests, checks, aliases and completion families', () => {
  const snapshot = state(), tasks = [task('partner-done'), task('checked'), task('quest', { category: 'Quest' }), task('family', { completionIds: ['family', 'old-family'] }), task('blocked', { status: 'blocked' })];
  snapshot.members[0].taskStatus.checked = { challengeCompleted: true };
  snapshot.members[0].completedTasks = ['quest', 'old-family'];
  snapshot.members[1].taskStatus['partner-done'] = { challengeCompleted: true };
  const a = result('actor1', [...tasks, task('old-family')], []), b = result('reed', tasks, []);
  const before = structuredClone({ snapshot, a, b });
  const view = select(snapshot, [a, b], { personalFilter: 'not-done', showBlocked: true });
  assert.deepEqual(ids(view), ['partner-done']);
  assert.equal(view.rows[0].facts.group, true); assert.equal(view.rows[0].facts.personal, false);
  assert.deepEqual(view.rows[0].filterMemberIds, ['actor1']); assert.equal(view.rows[0].personalCompletion, true);
  assert.deepEqual(ids(select(snapshot, [a, b], { personalFilter: 'not-done', ownerFilter: 'reed' })), []);
  assert.deepEqual(ids(select(snapshot, [a, b], { personalFilter: 'not-done', ownerFilter: 'both' })), ['partner-done']);
  assert.deepEqual({ snapshot, a, b }, before);
});

test('only player compares partner availability independently of partner completion, backlog and presentation suppression', () => {
  const snapshot = state(), own = task('own'), shared = task('shared'), exclusive = task('exclusive'), resource = task('resource');
  snapshot.members[1].taskStatus = { shared: { challengeCompleted: true, backlogged: true } };
  const a = result('actor1', [own, shared, exclusive, resource], []), b = result('reed', [shared, { ...exclusive, status: 'blocked' }, { ...resource, obligation: false }], []);
  const view = select(snapshot, [a, b], { personalFilter: 'only-player' });
  assert.deepEqual(new Set(ids(view)), new Set(['own', 'exclusive', 'resource']));
  assert.equal(view.rows.find(row => row.id === 'exclusive').availabilityByMember.reed, undefined);
  assert.equal(view.rows.some(row => row.id === 'shared'), false, 'Partner can do a completed and backlogged task on their map.');
  assert.deepEqual(ids(select(snapshot, [a, b], { personalFilter: 'only-player', selectedMemberId: 'reed' })), []);
});

test('duo is the deduplicated union of personal presentations with the correct source owner', () => {
  const snapshot = state(), own = task('own'), shared = task('shared'), partner = task('partner');
  const a = result('actor1', [own, shared, task('partner-resource', { obligation: false }), task('lower-skill')], [own, shared]);
  const bShared = { ...shared, level: 10 }, b = result('reed', [partner, bShared], [partner, bShared, bShared]);
  const results = new Map([['actor1', a], ['reed', b]]), before = structuredClone({ snapshot, results });
  const view = select(snapshot, results);
  assert.deepEqual(new Set(ids(view)), new Set(['own', 'partner', 'shared']));
  assert.deepEqual(view.counts, { union: 3, byMember: { actor1: 2, reed: 2 }, shared: 1, completed: 0 });
  const both = view.rows.find(row => row.id === 'shared'), reed = view.rows.find(row => row.id === 'partner');
  assert.deepEqual(both.memberIds, ['actor1', 'reed']); assert.equal(both.label, 'Both'); assert.strictEqual(both.task, shared);
  assert.equal(reed.label, 'Reed'); assert.equal(reed.memberId, 'reed'); assert.strictEqual(reed.task, partner);
  assert.deepEqual(ids(select(snapshot, results, { ownerFilter: 'both' })), ['shared']);
  assert.deepEqual(new Set(ids(select(snapshot, results, { ownerFilter: 'reed' }))), new Set(['shared', 'partner']));
  assert.deepEqual(ids(select(snapshot, results, { filter: 'PARTNER' })), ['partner']);
  assert.strictEqual(select(snapshot, results, { selectedMemberId: 'reed' }).rows.find(row => row.id === 'shared').task, bShared);
  assert.deepEqual({ snapshot, results }, before);
});

test('available partner resources, backlog, hidden, blocked and never-show tasks remain excluded', () => {
  const snapshot = state(); snapshot.tasks = [task('custom:shared'), task('custom:done')];
  snapshot.members[0].taskStatus = { shared: { backlogged: true }, 'custom:shared': { backlogged: true } };
  snapshot.members[1].taskStatus['custom:done'] = { challengeCompleted: true };
  const shared = task('shared'), excluded = [task('resource', { obligation: false }), task('hidden', { hidden: true }), task('blocked', { status: 'blocked' }), task('never', { record: { NeverShow: true } })];
  const results = { actor1: result('actor1', [shared, ...excluded]), reed: result('reed', [shared]) };
  const view = select(snapshot, results);
  assert.deepEqual(new Set(ids(view)), new Set(['shared', 'custom:shared']));
  for (const row of view.rows) assert.deepEqual(row.memberIds, ['reed']);
  assert.deepEqual(view.counts.byMember, { actor1: 0, reed: 2 });
  assert.equal(select(snapshot, { ...results, reed: { ...results.reed, stateRevision: 4 } }).rows.length, 0);
});

test('custom rows already in the result remain compatible with the personal task list', () => {
  const snapshot = state(), customRow = task('rs3:task:custom:known');
  snapshot.tasks = [customRow];
  assert.deepEqual(ids(select(snapshot, [result('actor1', [customRow], [])])), [customRow.id]);
});

test('persisted aliases deduplicate canonically and completion-family evidence stays personal', () => {
  const snapshot = state(), canonical = 'rs3:task:one';
  snapshot.identityRegistry = { entries: { [canonical]: { category: 'Extra' } }, aliases: { old: canonical } };
  snapshot.members[1].taskStatus.old = { challengeCompleted: true };
  const results = { actor1: result('actor1', [task(canonical)]), reed: result('reed', [task('old')]) };
  assert.deepEqual(ids(select(snapshot, results)), []);
  const view = select(snapshot, results, { showCompleted: true });
  assert.deepEqual(ids(view), [canonical]); assert.equal(view.rows[0].facts.personal, false);
  assert.equal(view.rows[0].factsByMember.reed.personal, true); assert.deepEqual(view.rows[0].facts.completedBy, ['reed']);
  const family = task('drop:new', { completionGroup: 'item:drop' }), old = task('drop:old');
  snapshot.tasks = [old]; snapshot.members[1].completedTasks = [old.id];
  const a = result('actor1', [family]), b = result('reed', [family]);
  for (const value of [a, b]) value.collectionPlanning = { completionGroups: { 'item:drop': ['drop:new', 'drop:old'] } };
  assert.deepEqual(ids(select(snapshot, [a, b])), []);
  assert.equal(select(snapshot, [a, b], { showCompleted: true }).rows[0].facts.actual, false);
  assert.deepEqual(snapshot.members[0].completedTasks, []);
});

test('completed display restores only completion-suppressed rows in full and play projections', () => {
  const snapshot = state(); snapshot.members[1].taskStatus.done = { challengeCompleted: true };
  snapshot.members[1].taskStatus.hiddenDone = { challengeCompleted: true };
  const a = result('actor1', [task('active'), task('done'), task('hiddenDone')], [task('active')]);
  a.presentation.suppressed = { done: ['Challenge already satisfied.'], hiddenDone: ['Challenge already satisfied.', 'Skill tasks are hidden.'] };
  const b = result('reed', [], []);
  for (const compact of [false, true]) {
    const results = compact ? [Object.assign(projectPlayResult(a), { memberId: a.memberId, stateRevision: 5 }), b] : [a, b];
    assert.deepEqual(ids(select(snapshot, results)), ['active']);
    const view = select(snapshot, results, { showCompleted: true });
    assert.deepEqual(ids(view), ['active', 'done']); assert.equal(view.completedRecoveryAvailable, true);
    assert.deepEqual(view.completedRows[0].facts.completedBy, ['reed']);
  }
  const unavailable = { ...a, presentation: { tasks: a.presentation.tasks } };
  const view = select(snapshot, [unavailable, b], { showCompleted: true });
  assert.deepEqual(ids(view), ['active']); assert.equal(view.completedRecoveryAvailable, false);
});

test('narrow facts catalogue retains undisplayed family evidence and competing saved aliases', () => {
  const snapshot = state(), shown = task('shown', { aliases: ['historical'] }), other = task('not-presented', { aliases: ['historical'] });
  snapshot.members[1].completedTasks = ['historical'];
  const view = select(snapshot, [result('actor1', [shown, other], [shown])]);
  assert.deepEqual(ids(view), ['shown'], 'Undisplayed competing alias must keep a historical key ambiguous.');
  const family = task('drop:new', { completionIds: ['drop:new', 'drop:old'] });
  snapshot.members[1].completedTasks = ['drop:old'];
  const results = [result('actor1', [family, task('drop:old')], [family])];
  assert.deepEqual(ids(select(snapshot, results)), []);
  assert.deepEqual(select(snapshot, results, { showCompleted: true }).rows[0].facts.completedBy, ['reed']);
});

test('narrow catalogue facts match the full engine index across every completion policy', () => {
  const snapshot = state(), displayed = [task('plain'), task('canonical', { aliases: ['old'] }), task('ambiguous-a', { aliases: ['uncertain'] }), task('drop:new', { completionGroup: 'drop' })];
  const catalogue = [...displayed, task('ambiguous-b', { aliases: ['uncertain'] }), task('drop:old'), task('unused')];
  snapshot.members[0].taskStatus = { old: { challengeCompleted: true } };
  snapshot.members[1].completedTasks = ['plain', 'uncertain', 'drop:old'];
  const completionGroups = { drop: ['drop:new', 'drop:old'] };
  const a = { ...result('actor1', catalogue, displayed), collectionPlanning: { completionGroups } };
  for (const mode of ['any', 'all', 'personal']) {
    snapshot.rules = { 'tasks.completion': mode };
    const full = createTaskFactsIndex(snapshot, 'actor1', registry, { tasks: catalogue, completionGroups });
    const view = select(snapshot, [a], { showCompleted: true });
    for (const row of view.rows) assert.deepEqual(row.facts, full.get(row.task.id, row.task.completionIds), `${mode}: ${row.id}`);
  }
});

test('commands automatically target the sole owner and require an explicit choice for shared tasks', () => {
  assert.deepEqual(duoCommandTarget({ memberIds: ['reed'] }, 'actor1'), { memberId: 'reed', requiresChoice: false, memberIds: ['reed'], preferredMemberId: 'reed' });
  const both = { memberIds: ['actor1', 'reed'] }, target = duoCommandTarget(both, 'reed');
  assert.equal(target.memberId, undefined); assert.equal(target.requiresChoice, true); assert.equal(target.preferredMemberId, 'reed');
  assert.equal(duoCommandTarget(both, 'actor1', 'reed').memberId, 'reed');
  assert.throws(() => duoCommandTarget(both, 'actor1', 'other'), /does not own/);
  assert.throws(() => duoCommandTarget({ memberIds: [] }, 'actor1'), /no owning/);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cacheFixture = fetchResult => {
  const current = { revision: 5, selectedMemberId: 'actor1', memberIds: ['actor1', 'reed'], groupOn: false, sandbox: false };
  const changes = [], cache = createDuoResultCache({ getScope: () => current, fetchResult, onChange: value => changes.push(value) });
  return { current, changes, cache };
};

test('cache fetches partners only after foreground readiness; toggles and selected switches reuse results', async () => {
  const calls = [], { current, cache } = cacheFixture(async (id, revision) => { calls.push([id, revision]); return result(id, []); });
  await cache.ensure(); current.groupOn = true; await cache.ensure(); assert.deepEqual(calls, []);
  assert.equal(cache.remember(result('actor1', [])), true); await cache.ensure();
  assert.deepEqual(calls, [['reed', 5]]); assert.equal(cache.results().size, 2);
  current.groupOn = false; await cache.ensure(); current.groupOn = true; current.selectedMemberId = 'reed'; await cache.ensure();
  assert.equal(calls.length, 1); cache.results().clear(); assert.equal(cache.results().size, 2);
  current.revision = 6; assert.equal(cache.results().size, 0); assert.equal(cache.remember(result('actor1', [])), false);
  await cache.ensure(); assert.equal(calls.length, 1);
});

test('explicit early admission requests only missing partners while normal admission remains selected-gated', async () => {
  const response = deferred(), calls = [], { current, cache } = cacheFixture((id, revision) => { calls.push([id, revision]); return response.promise; });
  await cache.ensure({ allowBeforeSelected: true }); assert.deepEqual(calls, [], 'group off remains lazy');
  current.groupOn = true; current.sandbox = true;
  await cache.ensure({ allowBeforeSelected: true }); assert.deepEqual(calls, [], 'sandbox never fetches saved partners');
  current.sandbox = false; await cache.ensure(); assert.deepEqual(calls, []);
  const first = cache.ensure({ allowBeforeSelected: true }), second = cache.ensure({ allowBeforeSelected: true });
  await Promise.resolve(); assert.deepEqual(calls, [['reed', 5]]);
  cache.remember(result('actor1', [])); const normal = cache.ensure();
  response.resolve(result('reed', [])); await Promise.all([first, second, normal]);
  assert.equal(cache.results().size, 2); assert.equal(calls.length, 1);
});

test('early admissions discard late success and failures after saved-scope changes', async () => {
  for (const transition of ['revision', 'groupOff', 'sandbox']) for (const failure of [false, true]) {
    const response = deferred(), { current, cache, changes } = cacheFixture(() => response.promise);
    current.groupOn = true; const load = cache.ensure({ allowBeforeSelected: true }); await Promise.resolve();
    if (transition === 'revision') current.revision++;
    if (transition === 'groupOff') current.groupOn = false;
    if (transition === 'sandbox') current.sandbox = true;
    if (failure) response.reject(new Error('Old connection failed')); else response.resolve(result('reed', []));
    await load; assert.equal(cache.results().has('reed'), false); assert.equal(changes.length, 0);
  }
});

test('cache coalesces loads and drops stale revision, group-off and sandbox responses', async () => {
  for (const transition of ['revision', 'groupOff', 'sandbox']) {
    const request = deferred(), calls = [], { current, cache, changes } = cacheFixture(id => { calls.push(id); return request.promise; });
    current.groupOn = true; cache.remember(result('actor1', []));
    const first = cache.ensure(), second = cache.ensure(); await Promise.resolve(); assert.deepEqual(calls, ['reed']);
    if (transition === 'revision') current.revision++;
    if (transition === 'groupOff') current.groupOn = false;
    if (transition === 'sandbox') current.sandbox = true;
    request.resolve(result('reed', [])); await Promise.all([first, second]);
    assert.equal(cache.results().has('reed'), false); assert.equal(changes.length, 0);
    if (transition === 'sandbox') { current.sandbox = false; assert.equal(cache.results().size, 0); }
  }
});

test('cache failures and mismatched results remain retryable and never become cached', async () => {
  let count = 0;
  const { cache, current } = cacheFixture(async id => {
    count++; if (count === 1) throw new Error('Unavailable');
    if (count === 2) return { ...result(id, []), stateRevision: 4 };
    return result(id, []);
  });
  current.groupOn = true; cache.remember(result('actor1', []));
  await assert.rejects(cache.ensure(), /Unavailable/); assert.equal(cache.results().size, 1);
  await assert.rejects(cache.ensure(), /does not match/); assert.equal(cache.results().size, 1);
  await cache.ensure(); assert.equal(count, 3); assert.equal(cache.results().size, 2);
});

test('stale request failures do not reject newer revision or group-off loads', async () => {
  for (const transition of ['revision', 'groupOff', 'sandbox']) {
    const request = deferred(), { current, cache } = cacheFixture(() => request.promise);
    current.groupOn = true; cache.remember(result('actor1', []));
    const load = cache.ensure(); await Promise.resolve();
    if (transition === 'revision') current.revision++;
    if (transition === 'groupOff') current.groupOn = false;
    if (transition === 'sandbox') current.sandbox = true;
    request.reject(new Error('Old connection failed')); await load;
    assert.equal(cache.results().has('reed'), false);
  }
});


test('peer routing captures the selected member and revision before asynchronous fetch admission', async () => {
  const response = deferred(), calls = [], { current, cache } = cacheFixture((id, revision, peerFor) => { calls.push([id, revision, peerFor]); return response.promise; });
  current.groupOn = true;
  const early = cache.ensure({ allowBeforeSelected: true }); current.selectedMemberId = 'reed';
  await Promise.resolve(); assert.deepEqual(calls, [['reed', 5, 'actor1']]);
  response.resolve(result('reed', [])); await early;
});
