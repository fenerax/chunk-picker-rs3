import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { applyCommand, createGroupState } from '../app/core/state.mjs';
import { projectPlayResult, projectPlayState } from '../app/play-view.mjs';
import { createCompletedModel, filterCompletedRows, groupCompletedRows } from '../app/web/completed-model.mjs';

const registry = createRuleRegistry();
const task = (id, label = id, category = 'Mining', extra = {}) => ({ id, label, category, ...extra });
const member = (id, name, extra = {}) => ({ id, name, completedTasks: [], taskStatus: {}, ...extra });
const state = (tasks, members, extra = {}) => ({ tasks, members, rules: { 'tasks.completion': 'any' }, history: [], ...extra });
const model = (saved, result, memberId = 'actor1', now = '2026-10-09T12:00:00Z') => createCompletedModel({ state: saved, result, memberId, registry, now });
const statusEvent = (revision, memberId, taskId, challengeCompleted, extra = {}) => ({ id: `revision-${revision}`, revision,
  type: 'set-task-status', at: `2026-10-0${revision}T12:00:00Z`, command: { memberId, taskId, challengeCompleted }, ...extra });

test('shared completion lists exact who and when without changing either player', () => {
  const row = task('mine', 'Mine ore'), saved = state([row], [member('actor1', 'Player'), member('reed', 'Reed', { taskStatus: { mine: { challengeCompleted: true } } })],
    { history: [statusEvent(8, 'reed', 'mine', true)] });
  const before = structuredClone(saved), ledger = model(saved, { tasks: [row] });
  assert.equal(ledger.rows.length, 1);
  assert.deepEqual(ledger.rows[0].facts, { personal: false, actual: false, group: true, completedBy: ['reed'], requiredBy: ['actor1', 'reed'] });
  assert.deepEqual(ledger.rows[0].completions, [{ memberId: 'reed', name: 'Reed', memberName: 'Reed', kind: 'ticked', taskId: 'mine', at: '2026-10-08T12:00:00Z', imported: false }]);
  assert.equal(ledger.summary.thisWeek, 1);
  assert.deepEqual(saved, before);
});

test('latest current check ignores undone events, notes and cleared checks', () => {
  const row = task('mine'), saved = state([row], [member('actor1', 'Player', { taskStatus: { mine: { challengeCompleted: true } } })], { history: [
    statusEvent(1, 'actor1', 'mine', true), statusEvent(2, 'actor1', 'mine', false),
    statusEvent(3, 'actor1', 'mine', true), statusEvent(4, 'actor1', 'mine', true, { undoneRevision: 5 }),
    { type: 'set-task-status', at: '2026-10-09T12:00:00Z', command: { memberId: 'actor1', taskId: 'mine', note: 'A note' } },
  ] });
  assert.equal(model(saved, { tasks: [row] }).rows[0].latestAt, '2026-10-03T12:00:00Z');
  saved.members[0].taskStatus.mine.challengeCompleted = false;
  assert.equal(model(saved, { tasks: [row] }).rows.length, 0);
  saved.members[0].taskStatus.mine.challengeCompleted = true;
  saved.history.push(statusEvent(6, 'actor1', 'mine', false));
  assert.equal(model(saved, { tasks: [row] }).rows[0].latestAt, null, 'A contradictory latest clear cannot lend an older date to current evidence.');
});

test('unknown dates remain unknown and never imply imported provenance', () => {
  const saved = state([task('old')], [member('actor1', 'Player', { taskStatus: { old: { challengeCompleted: true } } })]);
  const ledger = model(saved, { tasks: [] });
  assert.equal(ledger.rows.length, 1, 'A saved completion absent from generated results remains visible.');
  assert.equal(ledger.rows[0].completions[0].imported, false);
  assert.equal(ledger.rows[0].latestAt, null);
  assert.equal(ledger.summary.unknownDates, 1);
  assert.equal(ledger.summary.recent, 0);
});

test('positive original source provenance proves import but supplies no invented completion date', () => {
  const saved = state([task('old'), task('favorite')], [member('actor1', 'Player', { taskStatus: { old: { challengeCompleted: true }, favorite: { challengeCompleted: true } } })], {
    legacy: { gameplayMigration: { taskStatusProvenance: [
      { memberId: 'actor1', taskId: 'old', sources: ['completedChallenges'] },
      { memberId: 'actor1', taskId: 'favorite', sources: ['favoriteTasks', 'backlog'] },
    ] } },
  });
  let ledger = model(saved, { tasks: [] });
  assert.deepEqual(filterCompletedRows(ledger.rows, { attribution: 'imported' }).map(row => row.task.id), ['old']);
  assert.equal(ledger.rows.find(row => row.task.id === 'old').latestAt, null);
  saved.history = [statusEvent(7, 'actor1', 'old', false), statusEvent(8, 'actor1', 'old', true)];
  ledger = model(saved, { tasks: [] });
  assert.equal(ledger.rows.find(row => row.task.id === 'old').completions[0].imported, false, 'A later local recheck supersedes the original import.');
});

test('original sync provenance applies only to listed completion IDs and respects undo', () => {
  const saved = state([task('one'), task('two')], [member('actor1', 'Player', { taskStatus: { one: { challengeCompleted: true }, two: { challengeCompleted: true } } })], { history: [
    { type: 'sync-original', at: '2026-10-08T12:00:00Z', command: { members: [{ memberId: 'actor1', groups: ['tasks'], tasks: { complete: ['one'] } }] } },
    { type: 'sync-original', undoneRevision: 4, at: '2026-10-08T12:00:00Z', command: { members: [{ memberId: 'actor1', tasks: { complete: ['two'] } }] } },
  ] });
  const ledger = model(saved, { tasks: [] });
  assert.deepEqual(filterCompletedRows(ledger.rows, { attribution: 'imported' }).map(row => row.task.id), ['one']);
  assert.ok(ledger.rows.every(row => row.latestAt === null));
});

test('personal game completion and RuneMetrics observation stay separate from challenge ticks and dates', () => {
  const quest = task('quest', 'Quest completion', 'Quest'), saved = state([quest], [member('actor1', 'Player', {
    completedTasks: ['quest'], questProgress: { quest: { source: 'runemetrics', fetchedAt: '2026-10-08T12:00:00Z', runescapeName: 'Test', title: 'Quest completion' } },
  })], { history: [{ type: 'apply-runemetrics', at: '2026-10-08T13:00:00Z', command: { memberId: 'actor1', quests: [{ taskId: 'quest' }] } }] });
  let row = model(saved, { tasks: [quest] }).rows[0];
  assert.equal(row.facts.personal, false);
  assert.equal(row.facts.actual, true);
  assert.equal(row.latestAt, null);
  assert.equal(row.completions[0].source, 'runemetrics');
  assert.equal(row.completions[0].observedAt, '2026-10-08T12:00:00Z');
  assert.equal(row.completions[0].imported, false);
  delete saved.members[0].questProgress;
  row = model(saved, { tasks: [quest] }).rows[0];
  assert.equal(row.completions[0].source, undefined, 'Actual personal completion alone cannot be called RuneMetrics.');
  saved.history = [{ type: 'complete-task', at: '2026-10-07T12:00:00Z', command: { memberId: 'actor1', taskId: 'quest', completed: true } }];
  assert.equal(model(saved, { tasks: [quest] }).rows[0].latestAt, '2026-10-07T12:00:00Z');
});

test('selection follows personal, any and all policy and both is the personal union', () => {
  const row = task('one'), saved = state([row], [member('actor1', 'Player'), member('reed', 'Reed', { completedTasks: ['one'] })]);
  assert.equal(model(saved, { tasks: [row] }, 'actor1').rows.length, 1);
  saved.rules['tasks.completion'] = 'personal';
  assert.equal(model(saved, { tasks: [row] }, 'actor1').rows.length, 0);
  assert.equal(model(saved, { tasks: [row] }, 'reed').rows.length, 1);
  assert.equal(model(saved, [{ tasks: [row] }, { tasks: [row] }], 'both').rows.length, 1);
  assert.equal(model(saved, { tasks: [row] }, 'both').rows[0].facts.group, true);
  saved.rules['tasks.completion'] = 'all';
  assert.equal(model(saved, { tasks: [row] }, 'both').rows.length, 0);
  saved.members[0].taskStatus.one = { challengeCompleted: true };
  assert.equal(model(saved, { tasks: [row] }, 'both').rows[0].completions.length, 2);
  assert.throws(() => model(saved, {}, 'missing'), /Unknown member/);
});

test('aliases and completion families produce one current row retaining every underlying check', () => {
  const current = task('drop:new', 'Get Bones', 'Combat', { completionGroup: 'bones', aliases: ['old-name'] });
  const saved = state([task('drop:old'), task('drop:new'), task('drop:source')], [
    member('actor1', 'Player', { taskStatus: { 'drop:old': { challengeCompleted: true } } }),
    member('reed', 'Reed', { completedTasks: ['drop:source'] }),
  ], { history: [statusEvent(8, 'actor1', 'drop:old', true)] });
  const ledger = model(saved, { tasks: [current, task('drop:source', 'Get Bones elsewhere', 'Combat', { completionGroup: 'bones' })],
    collectionPlanning: { completionGroups: { bones: ['drop:new', 'drop:old', 'drop:source'] } } });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].task.id, 'drop:new');
  assert.deepEqual(ledger.rows[0].completions.map(value => value.taskId), ['drop:old', 'drop:source']);
  assert.equal(ledger.rows[0].facts.personal, false);
  assert.equal(ledger.summary.denominator, 1);
  const alias = state([current], [member('actor1', 'Player', { taskStatus: { 'old-name': { challengeCompleted: true } } })], { history: [statusEvent(8, 'actor1', 'old-name', true)] });
  assert.equal(model(alias, { tasks: [{ ...current, completionGroup: undefined }] }).rows[0].latestAt, '2026-10-08T12:00:00Z');
});

test('materialized saved identities add resolvable rows without manufacturing unresolved entries', () => {
  const saved = state([], [member('actor1', 'Player', { completedTasks: ['old-id', 'unresolved'] })], {
    identityRegistry: { entries: { canonical: { label: 'Saved quest', category: 'Quest' } }, aliases: { 'old-id': ['canonical'] } },
  });
  assert.deepEqual(model(saved, { tasks: [] }).rows.map(row => row.task.id), ['canonical']);
});

test('category grouping, search, attribution and date sorts are deterministic and read-only', () => {
  const rows = [task('alpha', 'Alpha ore', 'Mining'), task('beta', 'Beta quest', 'Quest'), task('gamma', 'Gamma ore', 'Mining')];
  const saved = state(rows, [member('actor1', 'Player', { taskStatus: { alpha: { challengeCompleted: true }, gamma: { challengeCompleted: true } } }),
    member('reed', 'Reed', { completedTasks: ['beta'] })], { history: [statusEvent(8, 'actor1', 'alpha', true), statusEvent(2, 'actor1', 'gamma', true)] });
  const ledger = model(saved, { tasks: [...rows, task('pending', 'Pending'), task('advisory', 'Advisory', 'Mining', { obligation: false })] });
  const before = ledger.rows.slice();
  assert.deepEqual(groupCompletedRows(ledger.rows).map(group => [group.category, group.count]), [['Mining', 2], ['Quest', 1]]);
  assert.deepEqual(filterCompletedRows(ledger.rows, { sort: 'recent' }).map(row => row.task.id), ['alpha', 'gamma', 'beta']);
  assert.deepEqual(filterCompletedRows(ledger.rows, { sort: 'oldest' }).map(row => row.task.id), ['gamma', 'alpha', 'beta']);
  assert.deepEqual(filterCompletedRows(ledger.rows, { sort: 'name' }).map(row => row.task.id), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(filterCompletedRows(ledger.rows, { query: 'ORE player', attribution: 'ticked:actor1' }).map(row => row.task.id), ['alpha', 'gamma']);
  assert.deepEqual(filterCompletedRows(ledger.rows, { attribution: 'done:reed' }).map(row => row.task.id), ['beta']);
  assert.equal(filterCompletedRows(ledger.rows, { attribution: 'ticked:reed' }).length, 0);
  assert.equal(ledger.summary.totalTasks, 4);
  assert.equal(ledger.summary.thisWeek, 1);
  assert.deepEqual(ledger.rows, before);
});

test('this week starts on local Monday, excludes future dates, and differs from last seven days', () => {
  const rows = [task('sunday'), task('monday'), task('future')], saved = state(rows, [member('actor1', 'Player', {
    taskStatus: Object.fromEntries(rows.map(row => [row.id, { challengeCompleted: true }])),
  })], { history: rows.map((row, index) => ({ type: 'set-task-status', at: ['2026-10-04T12:00:00Z', '2026-10-05T12:00:00Z', '2026-10-10T12:00:00Z'][index],
    command: { memberId: 'actor1', taskId: row.id, challengeCompleted: true } })) });
  const summary = model(saved, { tasks: rows }).summary;
  assert.equal(summary.thisWeek, 1);
  assert.equal(summary.recent, 2);
});

test('selected owner scope excludes partner-only saved rows, hidden tasks and advisory rows', () => {
  const own = task('own'), partner = task('partner'), shared = task('shared'), hidden = task('hidden', 'Hidden', 'Mining', { hidden: true });
  const advisory = task('advisory', 'Advisory', 'Mining', { obligation: false });
  const saved = state([own, partner, hidden, advisory], [
    member('actor1', 'Player', { taskStatus: { own: { challengeCompleted: true }, hidden: { challengeCompleted: true }, advisory: { challengeCompleted: true } } }),
    member('reed', 'Reed', { taskStatus: { partner: { challengeCompleted: true }, shared: { challengeCompleted: true } } }),
  ]);
  const results = [{ memberId: 'actor1', tasks: [shared, hidden, advisory] }, { memberId: 'reed', tasks: [partner] }];
  const ownModel = model(saved, results);
  assert.deepEqual(ownModel.rows.map(row => row.task.id), ['own', 'shared']);
  assert.equal(ownModel.summary.denominator, 2, 'Saved completions cannot exceed the possible-task denominator.');
  assert.deepEqual(model(saved, results, 'both').rows.map(row => row.task.id), ['own', 'partner', 'shared']);
});

test('RuneMetrics attribution requires per-quest source provenance', () => {
  const saved = state([task('manual', 'Manual', 'Quest'), task('synced', 'Synced', 'Quest')], [member('actor1', 'Player', {
    completedTasks: ['manual', 'synced'], runeMetricsSync: { source: 'runemetrics', fetchedAt: '2026-10-08T12:00:00Z', runescapeName: 'Test' },
    questProgress: { synced: { source: 'runemetrics', fetchedAt: '2026-10-08T12:00:00Z', runescapeName: 'Test' } },
  })]);
  assert.deepEqual(filterCompletedRows(model(saved, {}).rows, { attribution: 'runemetrics' }).map(row => row.task.id), ['synced']);
});

test('projected alias checks expose canonical command-valid IDs and unticking removes them', () => {
  const id = 'rs3:task:synthetic-trusted-goal', old = 'synthetic-old-goal';
  const goal = { id, label: 'Trusted goal', category: 'custom', rawLabel: 'Trusted goal', aliases: [old], kind: 'task' };
  let saved = createGroupState([{ id: 'actor1', name: 'Player' }]);
  saved.tasks = [{ id: old, label: goal.label, category: goal.category }];
  saved.members[0].taskStatus = { [old]: { challengeCompleted: true } };
  saved.identityRegistry = { schemaVersion: 1, entries: { [id]: goal }, aliases: { [old]: id }, unresolved: [] };
  const display = projectPlayState(saved), ledger = model(display, { tasks: [goal] });
  assert.equal(ledger.rows[0].completions[0].taskId, id);
  saved = applyCommand(saved, { type: 'set-task-status', memberId: 'actor1', taskId: ledger.rows[0].completions[0].taskId, challengeCompleted: false }, {
    registry, taskCatalogue: [goal], now: () => '2026-10-09T12:00:00Z',
  });
  assert.equal(model(projectPlayState(saved), { tasks: [goal] }).rows.length, 0);
});

test('play-v1 task projection preserves the completed ledger across player scopes and completion policies', () => {
  const alias = task('custom:alias', 'Mine imported ore', 'Mining', { aliases: ['old-ore-name'], obligation: true,
    record: { Description: 'Full detail is loaded only when requested.' }, blockers: [{ detail: 'A detailed blocker', code: 'metadata' }] });
  const drop = task('drop:current', 'Collect bones', 'Combat', { completionGroup: 'bones', obligation: true, generated: true });
  const variant = task('drop:variant', 'Collect bones elsewhere', 'Combat', { completionGroup: 'bones', obligation: true });
  const explicit = task('collection:current', 'Collect arrows', 'Fletching', { completionIds: ['collection:current', 'collection:old'], obligation: true });
  const quest = task('custom:quest', 'A finished quest', 'Quest', { obligation: true });
  const hidden = task('custom:hidden', 'Hidden task', 'Mining', { hidden: true, obligation: true });
  const advisory = task('custom:advisory', 'Advisory task', 'Mining', { obligation: false });
  const savedOnly = task('custom:saved-only', 'Saved historical check', 'Mining');
  const partnerOnly = task('custom:partner-only', 'Partner historical check', 'Mining');
  const saved = state([alias, task('drop:old'), task('collection:old'), quest, hidden, advisory, savedOnly, partnerOnly], [
    member('actor1', 'Player', { completedTasks: ['collection:old'], taskStatus: {
      'old-ore-name': { challengeCompleted: true }, 'custom:saved-only': { challengeCompleted: true },
      'custom:hidden': { challengeCompleted: true }, 'custom:advisory': { challengeCompleted: true },
    } }),
    member('reed', 'Reed', { completedTasks: ['custom:quest'], taskStatus: {
      'drop:old': { challengeCompleted: true }, 'custom:partner-only': { challengeCompleted: true },
    }, questProgress: { 'custom:quest': { source: 'runemetrics', fetchedAt: '2026-10-08T12:00:00Z', runescapeName: 'Test' } } }),
  ], { history: [statusEvent(8, 'reed', 'drop:old', true)], legacy: { gameplayMigration: { taskStatusProvenance: [
    { memberId: 'actor1', taskId: 'old-ore-name', sources: ['completedChallenges'] },
  ] } } });
  const full = { tasks: [alias, drop, variant, explicit, quest, hidden, advisory, task('custom:pending', 'Pending task')],
    collectionPlanning: { completionGroups: { bones: ['drop:current', 'drop:variant', 'drop:old'] } },
    presentation: { tasks: [alias, drop, variant, explicit, quest] }, metrics: { availableCount: 8 } };
  const projected = projectPlayResult(full);
  assert.equal(projected.tasks[0].record, undefined, 'The comparison exercises a genuinely smaller task projection.');
  const ledger = value => ({
    memberId: value.memberId,
    rows: value.rows.map(row => ({ id: row.task.id, category: row.category, facts: row.facts, completions: row.completions, latestAt: row.latestAt })),
    categories: value.categories.map(group => ({ category: group.category, count: group.count, ids: group.rows.map(row => row.task.id) })),
    summary: value.summary,
  });
  for (const policy of ['any', 'personal', 'all']) for (const selected of ['actor1', 'reed', 'both']) {
    saved.rules['tasks.completion'] = policy;
    assert.deepEqual(ledger(model(projectPlayState(saved), projected, selected)), ledger(model(saved, full, selected)), `${policy}/${selected}`);
  }
  saved.rules['tasks.completion'] = 'any';
  const completed = model(projectPlayState(saved), projected);
  assert.deepEqual(completed.rows.map(row => row.task.id).sort(), ['collection:current', 'custom:alias', 'custom:quest', 'custom:saved-only', 'drop:current']);
  assert.equal(completed.summary.imported, 1);
  assert.equal(filterCompletedRows(completed.rows, { attribution: 'runemetrics' })[0].task.id, quest.id);
  assert.equal(completed.rows.find(row => row.task.id === drop.id).completions[0].taskId, 'drop:old');
  assert.equal(completed.rows.find(row => row.task.id === explicit.id).completions[0].taskId, 'collection:old');
});
