import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDuoPlayResult, projectDuoSidebarResult, projectDuoInspectionJSON } from '../app/duo-play-view.mjs';
import { selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';

const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
const task = (id, extra = {}) => ({ id, label: id, category: 'Extra', status: 'available', ...extra });
const snapshot = () => ({ revision: 5, rules: {}, tasks: [], members: [
  { id: 'actor1', name: 'Player', completedTasks: [], taskStatus: {} },
  { id: 'reed', name: 'Reed', completedTasks: [], taskStatus: {} },
] });
const result = (memberId, tasks, presented = tasks) => ({ memberId, stateRevision: 5, tasks, presentation: { tasks: presented, suppressed: {} } });
const select = (state, results, showCompleted = true) => selectDuoTasks({ state, results, registry, selectedMemberId: 'actor1', showCompleted });
const compare = (state, foreground, peer) => {
  const thin = projectDuoPlayResult(peer, state), before = select(state, [foreground, peer]), after = select(state, [foreground, thin]);
  assert.deepEqual(after, before);
  return thin;
};

test('inspection projection retains the complete ordinary play catalogue and evidence without mutating its bytes', () => {
  const tasks = [task('active', { level: 30, primary: true }), task('blocked', { status: 'blocked', blockers: [{ detail: 'Need a chisel.' }] }),
    task('intermediate', { level: 10, primary: true }), task('hidden-evidence', { hidden: true, aliases: ['old'], completionIds: ['family'] })];
  const play = projectPlayResult({ ...result('actor1', tasks, [tasks[0]]), collectionPlanning: { completionGroups: { family: ['hidden-evidence'] } } });
  const bytes = Buffer.from(JSON.stringify(play)), before = Buffer.from(bytes);
  const projected = JSON.parse(projectDuoInspectionJSON(bytes));
  assert.deepEqual(projected, { ...play, projection: 'duo-inspection-v1' });
  assert.deepEqual(bytes, before);
  assert.equal(projected.tasks[1].blockers[0].detail, 'Need a chisel.');
  assert.equal(projected.tasks[2].level, 10); assert.equal(projected.tasks[2].primary, true);
  assert.deepEqual(JSON.parse(projectDuoInspectionJSON(bytes, { neverShowIds: ['excluded'] })).neverShowIds, ['excluded']);
});

test('peer projection matches full-index facts for every completion policy and retains competing saved aliases', () => {
  const state = snapshot(), displayed = [task('plain'), task('canonical', { aliases: ['old'] }), task('ambiguous-a', { aliases: ['uncertain'] }), task('drop:new', { completionGroup: 'drop' })];
  const catalogue = [...displayed, task('ambiguous-b', { aliases: ['uncertain'] }), task('drop:old'), task('unused')];
  state.members[0].taskStatus = { old: { challengeCompleted: true } };
  state.members[1].completedTasks = ['plain', 'uncertain', 'drop:old'];
  const completionGroups = { drop: ['drop:new', 'drop:old'] }, foreground = result('actor1', [], []);
  const peer = { ...result('reed', catalogue, displayed), collectionPlanning: { completionGroups } };
  for (const mode of ['any', 'all', 'personal']) {
    state.rules = { 'tasks.completion': mode };
    const thin = compare(state, foreground, peer);
    assert.equal(thin.tasks.some(row => row.id === 'unused'), false);
    const full = createTaskFactsIndex(state, 'reed', registry, { tasks: catalogue, completionGroups });
    for (const row of select(state, [foreground, thin]).rows) assert.deepEqual(row.factsByMember.reed, full.get(row.id, row.task.completionIds));
  }
});

test('peer saved evidence remains complete for a family named only by the foreground result', () => {
  const state = snapshot(), shown = task('drop:new', { completionIds: ['drop:new', 'drop:old'] }), a = task('drop:old', { aliases: ['historical'] }), b = task('other', { aliases: ['historical'] });
  const foreground = result('actor1', [shown]), peer = result('reed', [a, b, task('unused')], []);
  state.members[1].completedTasks = ['historical'];
  const ambiguous = compare(state, foreground, peer);
  assert.deepEqual(ambiguous.tasks.map(row => row.id), ['drop:old', 'other']);
  assert.equal(select(state, [foreground, ambiguous]).rows[0].facts.group, false);
  state.members[1].completedTasks = ['drop:old'];
  const completed = compare(state, foreground, peer);
  assert.deepEqual(completed.tasks.map(row => row.id), ['drop:old']);
  assert.deepEqual(select(state, [foreground, completed]).rows[0].facts.completedBy, ['reed']);
});

test('peer projection retains completion recovery, custom rows and every saved canonical candidate without mutating ordinary play data', () => {
  const state = snapshot(), tasks = [task('active'), task('done'), task('custom:manual'), task('canonical'), task('competitor'), task('unused')];
  state.identityRegistry = { entries: { canonical: { category: 'Extra' }, competitor: { category: 'Extra' } }, aliases: { old: ['canonical', 'competitor'] } };
  state.members[1].completedTasks = ['old'];
  const full = result('reed', tasks, [tasks[0]]); full.presentation.suppressed.done = ['Challenge already satisfied.'];
  const play = { ...projectPlayResult(full), memberId: 'reed', stateRevision: 5 }, before = structuredClone(play);
  const thin = compare(state, result('actor1', [], []), play);
  assert.deepEqual(thin.tasks.map(row => row.id), ['active', 'done', 'custom:manual', 'canonical', 'competitor']);
  assert.deepEqual(play, before);
});

function disclosures(state, view, memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  const facts = createTaskFactsIndex(state, memberId, registry, { tasks: view.tasks,
    completionGroups: view.collectionPlanning?.completionGroups ?? {} });
  const rows = view.tasks.filter(row => row.obligation !== false && !row.hidden);
  const evidence = row => ({ id: row.id, facts: facts.get(row.id, row.completionIds) });
  return { completed: rows.filter(row => facts.get(row.id, row.completionIds).group).map(evidence),
    backlog: rows.filter(row => member.taskStatus?.[row.id]?.backlogged).map(evidence) };
}

test('sidebar projection preserves ordinary completed and backlog disclosures across every completion policy', () => {
  const state = snapshot(), shown = task('active'), tasks = [shown, task('both-done'), task('partner-done'),
    task('canonical', { aliases: ['old'] }), task('ambiguous', { aliases: ['uncertain'] }),
    task('ambiguous-peer', { aliases: ['uncertain'], hidden: true }), task('blocked-done', { status: 'blocked' }),
    task('backlog', { status: 'blocked' }), task('alias-backlog', { aliases: ['old-backlog'] }),
    task('hidden-done', { hidden: true }), task('resource-done', { obligation: false }),
    task('unused'), task('hidden-unused', { hidden: true }), task('resource-unused', { obligation: false })];
  state.members[0].taskStatus = { 'both-done': { challengeCompleted: true }, old: { challengeCompleted: true },
    'blocked-done': { challengeCompleted: true }, backlog: { backlogged: true }, 'old-backlog': { backlogged: true },
    'hidden-done': { challengeCompleted: true, backlogged: true }, 'resource-done': { challengeCompleted: true, backlogged: true } };
  state.members[1].completedTasks = ['both-done', 'partner-done', 'uncertain'];
  const full = result('actor1', tasks, [shown]);
  for (const mode of ['any', 'all', 'personal']) {
    state.rules = { 'tasks.completion': mode };
    const before = structuredClone({ state, full }), thin = projectDuoSidebarResult(full, state, registry);
    assert.equal(thin.projection, 'duo-sidebar-v1');
    assert.deepEqual(disclosures(state, thin, 'actor1'), disclosures(state, full, 'actor1'), mode);
    assert.deepEqual(select(state, [thin], false), select(state, [full], false), 'Disclosure rows do not create active obligations.');
    for (const row of disclosures(state, thin, 'actor1').completed) assert.notEqual(row.id, 'ambiguous');
    for (const section of Object.values(disclosures(state, thin, 'actor1'))) {
      assert.ok(section.every(row => !['hidden-done', 'resource-done', 'alias-backlog'].includes(row.id)));
    }
    for (const id of ['unused', 'hidden-unused', 'resource-unused']) assert.equal(thin.tasks.some(row => row.id === id), false);
    assert.deepEqual({ state, full }, before);
  }
});

test('sidebar completion outside presentation retains every family row and saved ambiguous alias', () => {
  const state = snapshot(), family = task('completed-parent', { completionGroup: 'family' });
  state.members[1].completedTasks = ['evidence-done', 'uncertain'];
  const tasks = [task('active'), family, task('evidence-done', { hidden: true, obligation: false }), task('family-unchecked'),
    task('ambiguous-parent', { aliases: ['uncertain'] }), task('ambiguous-hidden', { aliases: ['uncertain'], hidden: true }), task('unused')];
  const full = { ...result('actor1', tasks, [tasks[0]]), collectionPlanning: {
    completionGroups: { family: ['completed-parent', 'evidence-done', 'family-unchecked'] } } };
  const before = structuredClone({ state, full }), thin = projectDuoSidebarResult(full, state, registry);
  assert.deepEqual(disclosures(state, thin, 'actor1'), disclosures(state, full, 'actor1'));
  assert.deepEqual(disclosures(state, thin, 'actor1').completed.map(row => row.id), ['completed-parent']);
  for (const id of ['completed-parent', 'evidence-done', 'family-unchecked', 'ambiguous-parent', 'ambiguous-hidden']) {
    assert.ok(thin.tasks.some(row => row.id === id), id);
  }
  assert.equal(projectDuoPlayResult(full, state).tasks.some(row => row.id === 'completed-parent'), false,
    'The peer projection does not need an unrelated personal completed disclosure.');
  assert.deepEqual({ state, full }, before);
});

test('sidebar projection accepts an explicit result owner and rejects unknown members', () => {
  const state = snapshot(), full = { tasks: [task('own-backlog'), task('partner-backlog')], presentation: { tasks: [] } };
  state.members[0].taskStatus = { 'own-backlog': { backlogged: true } };
  state.members[1].taskStatus = { 'partner-backlog': { backlogged: true } };
  const thin = projectDuoSidebarResult(full, state, registry, 'reed');
  assert.deepEqual(disclosures(state, thin, 'reed').backlog.map(row => row.id), ['partner-backlog']);
  assert.throws(() => projectDuoSidebarResult(full, state, registry, 'unknown'), /Unknown member/);
});

test('peer sidebar projection preserves each owner disclosure when completion families are outside active presentation', () => {
  const state = snapshot(), active = task('active'), family = task('family-parent', { completionGroup: 'family' });
  const tasks = [active, family, task('family-evidence', { hidden: true, obligation: false }), task('family-unchecked'),
    task('personal-quest'), task('actor1-backlog', { status: 'blocked' }),
    task('reed-backlog', { status: 'blocked' }), task('canonical', { aliases: ['old'] }),
    task('ambiguous', { aliases: ['uncertain'] }), task('ambiguous-hidden', { aliases: ['uncertain'], hidden: true }),
    task('hidden-backlog', { hidden: true }), task('resource-backlog', { obligation: false }), task('unused')];
  state.members[0].completedTasks = ['family-evidence', 'personal-quest'];
  state.members[0].taskStatus = { 'actor1-backlog': { backlogged: true } };
  state.members[1].completedTasks = ['family-evidence', 'old', 'uncertain'];
  state.members[1].taskStatus = { 'reed-backlog': { backlogged: true }, 'hidden-backlog': { backlogged: true },
    'resource-backlog': { backlogged: true } };
  const views = state.members.map(member => ({ ...result(member.id, tasks, [active]), collectionPlanning: {
    completionGroups: { family: ['family-parent', 'family-evidence', 'family-unchecked'] } } }));
  const before = structuredClone({ state, views });
  for (const mode of ['any', 'all', 'personal']) {
    state.rules = { 'tasks.completion': mode };
    const projected = views.map(view => projectDuoSidebarResult(view, state, registry));
    for (const [index, view] of views.entries()) {
      const memberId = view.memberId, thin = projected[index];
      assert.deepEqual(disclosures(state, thin, memberId), disclosures(state, view, memberId), `${mode}: ${memberId}`);
      assert.ok(disclosures(state, thin, memberId).completed.some(row => row.id === 'family-parent'));
      assert.deepEqual(disclosures(state, thin, memberId).backlog.map(row => row.id), [`${memberId}-backlog`]);
      assert.ok(thin.tasks.some(row => row.id === 'family-unchecked'), 'Keep family facts beyond the saved evidence row.');
      const facts = createTaskFactsIndex(state, memberId, registry, { tasks: thin.tasks });
      assert.equal(facts.get('personal-quest').actual, memberId === 'actor1', 'Actual quest completion stays personal.');
      assert.equal(thin.tasks.some(row => row.id === 'unused'), false);
      assert.equal(projectDuoPlayResult(view, state).tasks.some(row => row.id === 'family-parent'), false,
        'The public active-only projection remains unchanged.');
    }
    assert.deepEqual(select(state, projected, false), select(state, views, false));
  }
  state.rules = before.state.rules;
  assert.deepEqual({ state, views }, before);
});
