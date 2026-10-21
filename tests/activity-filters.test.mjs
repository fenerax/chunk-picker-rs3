import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_FILTERS_STORAGE_KEY, normalizeActivityFilters, readActivityFilters, writeActivityFilters, activityStatus, selectActivityRows, createActivityFilterControls } from '../app/web/activity-filters.mjs';

const task = (id, extra = {}) => ({ id, status: 'available', blockers: [], ...extra });
const ids = rows => rows.map(row => row.id);
const defaults = { statuses: [], questStatuses: [], sort: 'default' };
const memory = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('normalization rejects malformed records and supplies independent tab defaults', () => {
  for (const value of [undefined, null, 42, true, 'bad', []]) assert.deepEqual(normalizeActivityFilters(value), {});
  assert.deepEqual(normalizeActivityFilters({ Skills: {}, Broken: 4, Other: [] }), { Skills: defaults });
  const result = normalizeActivityFilters({ A: {}, B: {} }); result.A.statuses.push('done');
  assert.deepEqual(result.B, defaults);
});

test('normalization retains only valid distinct display choices without mutation', () => {
  const input = { Quests: { statuses: ['done', 'done', 'doable', 'bad'], questStatuses: ['not-started', 'can-do-now', 'not-started', false], sort: 'level' }, Skills: { statuses: 'done', sort: 'name' } };
  const before = structuredClone(input);
  assert.deepEqual(normalizeActivityFilters(input), { Quests: { statuses: ['done', 'doable'], questStatuses: ['not-started', 'can-do-now'], sort: 'level' }, Skills: defaults });
  assert.deepEqual(input, before);
});

test('storage round trips all tab choices in one versioned browser key', () => {
  const storage = memory(), input = { Quests: { questStatuses: ['in-progress'], sort: 'level' }, Skills: { statuses: ['blocked'] } };
  assert.equal(writeActivityFilters(storage, input), true);
  assert.equal(storage.values.size, 1); assert.equal(ACTIVITY_FILTERS_STORAGE_KEY, 'rs3:activity-info-filters:v1');
  assert.deepEqual(readActivityFilters(storage), normalizeActivityFilters(input));
});

test('corrupt or denied storage is safe', () => {
  for (const raw of ['{bad', 'null', '42', '[]', '"bad"']) assert.deepEqual(readActivityFilters({ getItem: () => raw }), {});
  assert.deepEqual(readActivityFilters({ getItem: () => { throw Error('Denied'); } }), {});
  assert.equal(writeActivityFilters({ setItem: () => { throw Error('Quota'); } }, {}), false);
  assert.equal(writeActivityFilters(undefined, {}), false); assert.equal(writeActivityFilters({}, {}), false);
});

test('classification gives completion precedence over readiness and existing blockers', () => {
  assert.deepEqual([
    task('personal', { personalCompleted: true, blockers: ['level'] }),
    task('shared', { challengeSatisfied: true, status: 'blocked' }),
    task('ready'), task('no-blockers', { blockers: undefined }),
    task('status', { status: 'blocked' }), task('detail', { blockers: ['missing'] }), task('unknown', { status: undefined }),
  ].map(activityStatus), ['done', 'done', 'doable', 'doable', 'blocked', 'blocked', 'blocked']);
});

test('groups use whole completion and any doable step, rather than completed steps as whole completion', () => {
  assert.equal(activityStatus({ tasks: [task('step')], wholeCompletion: [task('whole', { challengeSatisfied: true })] }), 'done');
  assert.equal(activityStatus({ tasks: [task('completed-step', { personalCompleted: true }), task('ready')] }), 'doable');
  assert.equal(activityStatus({ tasks: [task('completed-step', { personalCompleted: true }), task('blocked', { status: 'blocked' })] }), 'blocked');
  assert.equal(activityStatus({ tasks: [] }), 'blocked');
});

test('activity status chips combine with OR and preserve rows and input', () => {
  const rows = [task('done', { personalCompleted: true }), task('ready'), task('blocked', { blockers: ['item'] })], before = structuredClone(rows);
  assert.deepEqual(ids(selectActivityRows(rows, { statuses: ['done', 'blocked'] })), ['done', 'blocked']);
  assert.deepEqual(ids(selectActivityRows(rows, {})), ['done', 'ready', 'blocked']);
  assert.notStrictEqual(selectActivityRows(rows), rows); assert.strictEqual(selectActivityRows(rows)[0], rows[0]);
  assert.deepEqual(rows, before); assert.deepEqual(selectActivityRows(undefined), []);
});

test('quest progress choices combine with OR while Can do now intersects progress', () => {
  const rows = [task('new-ready', { questStatus: 'not-started', canDoNow: true }), task('started-ready', { questStatus: 'in-progress', canDoNow: true }), task('started-blocked', { questStatus: 'in-progress', canDoNow: false }), task('done', { questStatus: 'done', personalCompleted: true, canDoNow: false })];
  assert.deepEqual(ids(selectActivityRows(rows, { questStatuses: ['not-started', 'in-progress'] })), ['new-ready', 'started-ready', 'started-blocked']);
  assert.deepEqual(ids(selectActivityRows(rows, { questStatuses: ['in-progress', 'can-do-now'] })), ['started-ready']);
  assert.deepEqual(ids(selectActivityRows(rows, { questStatuses: ['can-do-now'] })), ['new-ready', 'started-ready']);
  assert.deepEqual(ids(selectActivityRows(rows, { statuses: ['done'], questStatuses: ['done'] })), ['done']);
});

test('level sort is stable, places zero and unknown levels last, and uses group level', () => {
  const rows = [task('missing'), task('ten-a', { level: 10 }), task('one', { level: 1 }), task('ten-b', { level: 10 }), task('zero', { level: 0 }), task('nan', { level: NaN }), task('string', { level: '2' }), { id: 'group', level: 5, tasks: [task('child', { level: 99 })] }];
  assert.deepEqual(ids(selectActivityRows(rows, { sort: 'level' })), ['one', 'group', 'ten-a', 'ten-b', 'missing', 'zero', 'nan', 'string']);
  assert.equal(rows[0].id, 'missing');
});

class Node {
  constructor(tag, text, className = '') { Object.assign(this, { tag, textContent: text ?? '', className, children: [], attributes: {}, events: {} }); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, action) { this.events[key] = action; }
  emit(key) { this.events[key]?.(); }
}
function harness(options = {}, storage = memory()) {
  let changes = 0;
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const button = (text, action, cls) => { const node = el('button', text, cls); node.addEventListener('click', action); return node; };
  const controls = createActivityFilterControls({ el, button, storage }, { tab: 'Quests', quests: true, ...options, onChange: () => changes++ });
  const group = label => controls.element.children.find(node => node.attributes['aria-label'] === label);
  const chip = (label, text) => group(label).children.find(node => node.textContent === text);
  const sort = controls.element.children.find(node => node.tag === 'label').children.find(node => node.tag === 'select');
  return { controls, storage, group, chip, sort, changes: () => changes };
}

test('chips update in place, expose pressed state, persist once, and notify once per change', () => {
  const h = harness(), done = h.chip('Activity status', 'Done');
  assert.equal(h.controls.element.className, 'activity-filter-controls'); assert.equal(done.className, 'filter-chip');
  assert.equal(h.group('Activity status').attributes.role, 'group');
  assert.equal(h.chip('Activity status', 'All').attributes['aria-pressed'], 'true');
  done.emit('click'); h.chip('Activity status', 'Blocked').emit('click');
  assert.deepEqual(h.controls.preferences().statuses, ['done', 'blocked']); assert.equal(h.changes(), 2);
  assert.strictEqual(h.chip('Activity status', 'Done'), done); assert.equal(done.attributes['aria-pressed'], 'true');
  assert.equal(h.chip('Activity status', 'All').attributes['aria-pressed'], 'false');
  done.emit('click'); assert.deepEqual(h.controls.preferences().statuses, ['blocked']);
  h.chip('Activity status', 'All').emit('click'); assert.deepEqual(h.controls.preferences().statuses, []);
  h.chip('Quest progress', 'In progress').emit('click'); h.chip('Quest progress', 'Can do now').emit('click');
  h.sort.value = 'level'; h.sort.emit('change');
  assert.deepEqual(readActivityFilters(h.storage).Quests, h.controls.preferences());
  const reopened = harness({}, h.storage);
  assert.equal(reopened.sort.value, 'level'); assert.equal(reopened.chip('Quest progress', 'In progress').attributes['aria-pressed'], 'true');
  assert.equal(reopened.changes(), 0);
});

test('quest search can hide activity chips and independent tabs retain each others choices', () => {
  const storage = memory(), quest = harness({ tab: 'Quest search', activity: false }, storage), skills = harness({ tab: 'Skills', quests: false }, storage);
  assert.equal(quest.group('Activity status'), undefined); assert.equal(skills.group('Quest progress'), undefined);
  quest.chip('Quest progress', 'Not started').emit('click'); skills.chip('Activity status', 'Doable').emit('click');
  quest.chip('Quest progress', 'Can do now').emit('click');
  assert.deepEqual(readActivityFilters(storage), { 'Quest search': { ...defaults, questStatuses: ['not-started', 'can-do-now'] }, Skills: { ...defaults, statuses: ['doable'] } });
});

test('denied storage still allows controls to update and notify', () => {
  const h = harness({}, { getItem: () => { throw Error('Denied'); }, setItem: () => { throw Error('Denied'); } });
  h.chip('Activity status', 'Done').emit('click'); h.sort.value = 'level'; h.sort.emit('change');
  assert.deepEqual(h.controls.preferences(), { ...defaults, statuses: ['done'], sort: 'level' }); assert.equal(h.changes(), 2);
});
