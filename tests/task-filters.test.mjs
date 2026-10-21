import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaskFilters, selectTaskFilters, isTaskPinned, createTaskPinChecker, readTaskFilters, writeTaskFilters, TASK_FILTERS_STORAGE_KEY } from '../app/web/task-filters-model.mjs';

const task = (id, extra = {}) => ({ id, label: id, category: 'Mining', status: 'available', blockers: [], ...extra });
const state = () => ({ members: [{ id: 'actor1', taskStatus: {} }, { id: 'reed', taskStatus: {} }] });
const group = (id, own, partner) => ({ id, task: own ?? partner, memberIds: [...(own ? ['actor1'] : []), ...(partner ? ['reed'] : [])], tasksByMember: { ...(own ? { actor1: own } : {}), ...(partner ? { reed: partner } : {}) } });
const ids = result => result.rows.map(row => row.id);
const select = (rows, filters = {}, options = {}) => selectTaskFilters(rows, { filters, memberId: 'actor1', ...options });
const defaults = { skills: [], doable: false, pinned: false, hidePartnerClaims: false, onlyMyClaims: false, sort: 'default', folded: [] };

test('group search, skill, doable and pin predicates must match one owner and display that owner’s evidence', () => {
  const snapshot = state(), own = task('shared', { label: 'Personal ore', category: 'Mining' }), partner = task('shared', { label: 'Partner logs', category: 'Woodcutting' });
  const row = group('shared', own, partner); row.factsByMember = { actor1: { personal: false }, reed: { personal: true } };
  snapshot.members[0].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { pinned: true }, { state: snapshot, search: 'logs' })), []);
  snapshot.members[1].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { pinned: true, skills: ['Mining'] }, { state: snapshot, search: 'logs' })), []);
  const view = select([row], { pinned: true, skills: ['Woodcutting'], doable: true }, { state: snapshot, search: 'logs' });
  assert.deepEqual(ids(view), ['shared']); assert.equal(view.rows[0].memberId, 'reed'); assert.strictEqual(view.rows[0].task, partner);
  assert.strictEqual(view.rows[0].facts, row.factsByMember.reed); assert.deepEqual(view.rows[0].displayMemberIds, ['reed']);
  assert.deepEqual(ids(select([row], {}, { search: 'logs', ownerFilter: 'actor1' })), []);
});

test('personal secondary filter restricts every group predicate to the selected map player', () => {
  const snapshot = state(), row = group('shared', task('shared'), task('shared'));
  row.filterMemberIds = ['actor1']; snapshot.members[1].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { pinned: true }, { state: snapshot })), []);
  assert.equal(isTaskPinned(row, { state: snapshot, memberId: 'actor1' }), false);
  snapshot.members[0].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { pinned: true }, { state: snapshot, ownerFilter: 'both' })), ['shared']);
  assert.deepEqual(ids(select([row], {}, { state: snapshot, ownerFilter: 'reed' })), []);
});

test('claim filters use the selected player and canonical shared claim across personal and group views', () => {
  const snapshot = state();
  snapshot.taskClaims = { own: { memberId: 'actor1', at: 'today' }, partner: { memberId: 'reed', at: 'today' }, unknown: { memberId: 'removed', at: 'today' } };
  const rows = ['own', 'partner', 'free', 'unknown'].map(id => task(id));
  const before = structuredClone({ rows, snapshot });
  assert.deepEqual(ids(select(rows, { hidePartnerClaims: true }, { state: snapshot })), ['own', 'free', 'unknown']);
  assert.deepEqual(ids(select(rows, { onlyMyClaims: true }, { state: snapshot })), ['own']);
  assert.deepEqual(ids(select(rows, { hidePartnerClaims: true, onlyMyClaims: true }, { state: snapshot, selectedMemberId: 'reed' })), ['partner']);
  const combined = rows.map(row => group(row.id, row, row));
  assert.deepEqual(ids(select(combined, { onlyMyClaims: true }, { state: snapshot, ownerFilter: 'reed' })), ['own']);
  assert.equal(select(combined, { hidePartnerClaims: true }, { state: snapshot }).hidden, 1);
  assert.deepEqual({ rows, snapshot }, before);
});

test('claims join canonical registry identities without transferring ambiguous claims', () => {
  const snapshot = state();
  snapshot.identityRegistry = { entries: { canonical: { category: 'Mining' }, other: { category: 'Mining' } }, aliases: { old: 'canonical', uncertain: ['canonical', 'other'] } };
  snapshot.taskClaims = { canonical: { memberId: 'actor1', at: 'today' }, uncertain: { memberId: 'actor1', at: 'today' } };
  assert.deepEqual(ids(select([task('old'), task('uncertain'), task('other')], { onlyMyClaims: true }, { state: snapshot })), ['old']);
  assert.deepEqual(ids(select([task('canonical')], { onlyMyClaims: true })), []);
});

test('claim filters compose with owner, skill, doable and pinned checks', () => {
  const snapshot = state(), rows = [group('mine', task('mine', { blockers: ['Blocked'] }), task('mine')), group('theirs', task('theirs'), task('theirs'))];
  snapshot.taskClaims = { mine: { memberId: 'actor1', at: 'today' }, theirs: { memberId: 'reed', at: 'today' } };
  snapshot.members[0].taskStatus.mine = { favorite: true };
  assert.deepEqual(ids(select(rows, { onlyMyClaims: true, skills: ['Mining'], doable: true, pinned: true }, { state: snapshot })), []);
  snapshot.members[1].taskStatus.mine = { favorite: true };
  assert.deepEqual(ids(select(rows, { onlyMyClaims: true, skills: ['Mining'], doable: true, pinned: true }, { state: snapshot, ownerFilter: 'both' })), ['mine']);
});

test('normalization supplies fresh defaults for malformed values', () => {
  for (const value of [undefined, null, 1, 'name', true, [], { skills: 'Mining', doable: 'true', pinned: 1, hidePartnerClaims: 'true', onlyMyClaims: 1, sort: 'bad', folded: {} }]) assert.deepEqual(normalizeTaskFilters(value), defaults);
  const first = normalizeTaskFilters(); first.skills.push('Mining'); first.folded.push('Quests');
  assert.deepEqual(normalizeTaskFilters(), defaults);
});

test('normalization keeps valid booleans and sorts, trims and deduplicates lists without mutation', () => {
  const source = { skills: [' Mining ', 'Mining', '', null, 4, 'Quests'], doable: true, pinned: true, hidePartnerClaims: true, onlyMyClaims: true, sort: 'skill', folded: ['BiS', 'BiS', ' '] }, before = structuredClone(source);
  assert.deepEqual(normalizeTaskFilters(source), { skills: ['Mining', 'Quests'], doable: true, pinned: true, hidePartnerClaims: true, onlyMyClaims: true, sort: 'skill', folded: ['BiS'] });
  assert.deepEqual(source, before);
  for (const sort of ['default', 'level', 'skill', 'name']) assert.equal(normalizeTaskFilters({ sort }).sort, sort);
});

test('default preserves current order, original objects and input/state immutability', () => {
  const rows = [task('c'), task('a'), task('b')], snapshot = state(), before = structuredClone({ rows, snapshot });
  const result = select(rows, {}, { state: snapshot });
  assert.deepEqual(ids(result), ['c', 'a', 'b']); assert.notStrictEqual(result.rows, rows);
  assert.strictEqual(result.rows[0], rows[0]); assert.equal(result.hidden, 0);
  assert.deepEqual({ rows, snapshot }, before);
});

test('skills are multi-select canonical categories and do not use secondary skill mirrors', () => {
  const rows = [task('mine'), task('cook', { category: 'Cooking', skills: ['Mining'] }), task('quest', { category: 'Quests' }), task('achieve', { category: 'Achievements' }), task('gear', { category: 'BiS' })];
  assert.deepEqual(ids(select(rows, { skills: ['Mining', 'Quests'] })), ['mine', 'quest']);
  assert.deepEqual(ids(select(rows, { skills: ['Achievements'] })), ['achieve']);
  assert.deepEqual(ids(select(rows, { skills: ['BiS'] })), ['gear']);
  assert.deepEqual(select(rows, { skills: ['absent'] }).categories, ['Achievements', 'BiS', 'Cooking', 'Mining', 'Quests']);
  assert.equal(select(rows, { skills: ['absent'] }).hidden, 5);
});

test('doable requires available status and no existing blockers only', () => {
  const rows = [task('ready', { level: 99, requirements: [{ skill: 'Mining', level: 99 }] }), task('blocked-status', { status: 'blocked' }), task('blocked-detail', { blockers: [{ detail: 'Missing item' }] }), task('unknown', { status: undefined }), task('no-blocker-field', { blockers: undefined })];
  assert.deepEqual(ids(select(rows, { doable: true }, { state: state() })), ['ready', 'no-blocker-field']);
});

test('personal pinned uses the selected member only', () => {
  const snapshot = state(), rows = [task('own'), task('partner'), task('none')];
  snapshot.members[0].taskStatus.own = { favorite: true }; snapshot.members[1].taskStatus.partner = { favorite: true };
  assert.deepEqual(ids(select(rows, { pinned: true }, { state: snapshot })), ['own']);
  assert.deepEqual(ids(select(rows, { pinned: true }, { state: snapshot, memberId: 'reed' })), ['partner']);
  assert.equal(isTaskPinned(rows[0], { state: snapshot, memberId: 'actor1' }), true);
  assert.equal(isTaskPinned(rows[1], { state: snapshot, memberId: 'actor1' }), false);
});

test('skill, doable and pin filters combine without changing folds or rows', () => {
  const snapshot = state(), rows = [task('match'), task('wrong-skill', { category: 'Fishing' }), task('not-doable', { blockers: ['blocked'] }), task('not-pinned')];
  for (const id of ['match', 'wrong-skill', 'not-doable']) snapshot.members[0].taskStatus[id] = { favorite: true };
  const before = structuredClone({ snapshot, rows });
  assert.deepEqual(ids(select(rows, { skills: ['Mining'], doable: true, pinned: true, folded: ['Mining'] }, { state: snapshot })), ['match']);
  assert.deepEqual({ snapshot, rows }, before);
});

test('level sort is ascending with unknown/nonfinite levels last and stable ties', () => {
  const rows = [task('missing'), task('ten-a', { level: 10 }), task('one', { level: 1 }), task('ten-b', { level: 10 }), task('nan', { level: NaN }), task('infinity', { level: Infinity }), task('string', { level: '2' }), task('zero', { level: 0 })];
  assert.deepEqual(ids(select(rows, { sort: 'level' })), ['zero', 'one', 'ten-a', 'ten-b', 'missing', 'nan', 'infinity', 'string']);
  assert.equal(rows[0].id, 'missing');
});

test('skill sort uses category then alphabetical label and preserves ties', () => {
  const rows = [task('z', { category: 'Woodcutting', label: 'Alpha' }), task('b', { label: 'Zulu' }), task('first', { label: 'Alpha' }), task('second', { label: 'Alpha' }), task('a', { category: 'Achievements', label: 'Zulu' })];
  assert.deepEqual(ids(select(rows, { sort: 'skill' })), ['a', 'first', 'second', 'b', 'z']);
});

test('name sort uses task label, ignores group owner badges and preserves ties', () => {
  const rows = [group('c', task('c', { label: 'Zulu' }), undefined), group('a', task('a', { label: 'Alpha' }), undefined), group('b', task('b', { label: 'Alpha' }), undefined)];
  rows[0].label = 'Player'; rows[1].label = 'Reed';
  assert.deepEqual(ids(select(rows, { sort: 'name' })), ['a', 'b', 'c']);
});

test('group doable admits any qualifying owner for All or Both, and checks explicit owners personally', () => {
  const rows = [group('shared', task('shared', { blockers: ['Needs level'] }), task('shared')), group('only-actor1', task('only-actor1'), undefined), group('only-reed', undefined, task('only-reed'))];
  assert.deepEqual(ids(select(rows, { doable: true })), ['shared', 'only-actor1', 'only-reed']);
  assert.deepEqual(ids(select(rows, { doable: true }, { ownerFilter: 'actor1' })), ['only-actor1']);
  assert.deepEqual(ids(select(rows, { doable: true }, { ownerFilter: 'reed' })), ['shared', 'only-reed']);
  assert.deepEqual(ids(select(rows, { doable: true }, { ownerFilter: 'both' })), ['shared']);
});

test('group pinned and star respect All, personal owner and Both chips', () => {
  const snapshot = state(), rows = [group('shared', task('shared'), task('shared')), group('single', undefined, task('single'))];
  snapshot.members[1].taskStatus.shared = { favorite: true }; snapshot.members[1].taskStatus.single = { favorite: true };
  for (const ownerFilter of ['all', 'reed']) assert.deepEqual(ids(select(rows, { pinned: true }, { state: snapshot, ownerFilter })), ['shared', 'single']);
  assert.deepEqual(ids(select(rows, { pinned: true }, { state: snapshot, ownerFilter: 'actor1' })), []);
  assert.deepEqual(ids(select(rows, { pinned: true }, { state: snapshot, ownerFilter: 'both' })), ['shared']);
  assert.equal(isTaskPinned(rows[0], { state: snapshot, memberId: 'actor1', ownerFilter: 'actor1' }), false);
  assert.equal(isTaskPinned(rows[0], { state: snapshot, memberId: 'actor1', ownerFilter: 'reed' }), true);
  assert.equal(isTaskPinned(rows[1], { state: snapshot, memberId: 'actor1', ownerFilter: 'both' }), false);
});

test('render pin checker matches individual pin checks across every owner mode', () => {
  const snapshot = state(), rows = [group('shared', task('shared'), task('shared')), group('own', task('own'), undefined), group('partner', undefined, task('partner')), task('personal')];
  snapshot.members[0].taskStatus.personal = { favorite: true };
  snapshot.members[1].taskStatus.shared = { favorite: true };
  snapshot.members[1].taskStatus.partner = { favorite: true };
  for (const ownerFilter of ['all', 'actor1', 'reed', 'both']) {
    const options = { state: snapshot, memberId: 'actor1', ownerFilter }, pinned = createTaskPinChecker(options);
    assert.deepEqual(rows.map(pinned), rows.map(row => isTaskPinned(row, options)));
  }
});

test('doable plus pinned must be satisfied by the same admitted owner', () => {
  const snapshot = state(), row = group('shared', task('shared', { blockers: ['Blocked'] }), task('shared'));
  snapshot.members[0].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { doable: true, pinned: true }, { state: snapshot })), []);
  snapshot.members[1].taskStatus.shared = { favorite: true };
  assert.deepEqual(ids(select([row], { doable: true, pinned: true }, { state: snapshot })), ['shared']);
  assert.deepEqual(ids(select([row], { doable: true, pinned: true }, { state: snapshot, ownerFilter: 'actor1' })), []);
  assert.deepEqual(ids(select([row], { doable: true, pinned: true }, { state: snapshot, ownerFilter: 'both' })), ['shared']);
});

test('group pins recognize canonical row id, personal task id and explicit task aliases', () => {
  const snapshot = state(), row = group('canonical', task('old-actor1', { aliases: ['older'] }), task('old-reed'));
  for (const id of ['canonical', 'old-actor1', 'older']) {
    snapshot.members[0].taskStatus = { [id]: { favorite: true } };
    assert.equal(isTaskPinned(row, { state: snapshot, memberId: 'actor1', ownerFilter: 'actor1' }), true, id);
    assert.deepEqual(ids(select([row], { pinned: true }, { state: snapshot, ownerFilter: 'actor1' })), ['canonical']);
  }
  snapshot.members[0].taskStatus = { 'old-reed': { favorite: true } };
  assert.equal(isTaskPinned(row, { state: snapshot, memberId: 'actor1', ownerFilter: 'actor1' }), false);
});

test('registry aliases recover saved pins without importing ambiguous or unrelated pins', () => {
  const snapshot = state();
  snapshot.identityRegistry = { entries: { canonical: { category: 'Mining' }, other: { category: 'Mining' } }, aliases: { historical: 'canonical', uncertain: ['canonical', 'other'], unrelated: 'other' } };
  const row = task('canonical', { aliases: ['uncertain', 'unrelated'] });
  snapshot.members[0].taskStatus.historical = { favorite: true };
  assert.equal(isTaskPinned(row, { state: snapshot, memberId: 'actor1' }), true);
  snapshot.members[0].taskStatus = { uncertain: { favorite: true }, unrelated: { favorite: true } };
  assert.deepEqual(ids(select([row], { pinned: true }, { state: snapshot })), []);
});

test('owner filtering remains effective without new filters and categories precede it', () => {
  const rows = [group('own', task('own'), undefined), group('partner', undefined, task('partner', { category: 'Cooking' })), group('both', task('both', { category: 'Quests' }), task('both', { category: 'Quests' }))];
  const result = select(rows, {}, { ownerFilter: 'both' });
  assert.deepEqual(ids(result), ['both']); assert.equal(result.hidden, 2); assert.deepEqual(result.categories, ['Cooking', 'Mining', 'Quests']);
  assert.deepEqual(ids(select(rows, {}, { ownerFilter: 'unknown' })), []);
});

test('empty inputs, absent preferences and absent state are safe', () => {
  assert.deepEqual(selectTaskFilters(undefined), { rows: [], hidden: 0, categories: [] });
  assert.deepEqual(select([], { pinned: true }), { rows: [], hidden: 0, categories: [] });
  assert.equal(isTaskPinned(task('x')), false);
});

test('2000-row selection combines filters and sorts without losing rows or mutating input', () => {
  const snapshot = state(), rows = Array.from({ length: 2000 }, (_, index) => task(`task-${index}`, { category: index % 2 ? 'Fishing' : 'Mining', level: 2000 - index, blockers: index % 3 ? [] : ['Blocked'] }));
  for (let index = 0; index < rows.length; index += 4) snapshot.members[0].taskStatus[rows[index].id] = { favorite: true };
  const before = structuredClone({ rows, snapshot }), result = select(rows, { skills: ['Mining'], doable: true, pinned: true, sort: 'level' }, { state: snapshot });
  const expected = rows.filter((row, index) => index % 4 === 0 && index % 3 !== 0).slice().reverse();
  assert.deepEqual(result.rows, expected); assert.equal(result.hidden, 2000 - expected.length);
  assert.deepEqual({ rows, snapshot }, before);
});

test('storage round-trips normalized display filters and category folds at the versioned key', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readTaskFilters(storage), defaults);
  const filters = { skills: ['Mining', 'Mining'], doable: true, pinned: true, sort: 'level', folded: ['Mining', 'BiS'] };
  assert.equal(writeTaskFilters(storage, filters), true); assert.equal(values.size, 1); assert.equal(values.has('rs3:active-task-filters:v1'), true);
  assert.equal(TASK_FILTERS_STORAGE_KEY, 'rs3:active-task-filters:v1'); assert.deepEqual(readTaskFilters(storage), normalizeTaskFilters(filters));
});

test('storage handles corrupt JSON, malformed saved values and blocked reads/writes', () => {
  for (const raw of ['{broken', 'null', '42', '[]', '"wrong"']) assert.deepEqual(readTaskFilters({ getItem: () => raw }), defaults);
  assert.deepEqual(readTaskFilters({ getItem: () => { throw new Error('Blocked'); } }), defaults);
  assert.equal(writeTaskFilters({ setItem: () => { throw new Error('Quota'); } }, { doable: true }), false);
  assert.equal(writeTaskFilters({}, {}), false);
});


test('claim filters follow the session player while pins and owner filters follow the viewed map', () => {
  const snapshot = state();
  snapshot.taskClaims = { actor1Claim: {memberId:'actor1'}, reedClaim: {memberId:'reed'} };
  snapshot.members[0].taskStatus.reedClaim = {favorite:true};
  snapshot.members[1].taskStatus.actor1Claim = {favorite:true};
  const rows = ['actor1Claim', 'reedClaim', 'free'].map(id => task(id));
  const options = {state:snapshot, memberId:'actor1', claimMemberId:'reed'};
  assert.deepEqual(ids(select(rows, {onlyMyClaims:true}, options)), ['reedClaim']);
  assert.deepEqual(ids(select(rows, {hidePartnerClaims:true}, options)), ['reedClaim', 'free']);
  assert.deepEqual(ids(select(rows, {onlyMyClaims:true, pinned:true}, options)), ['reedClaim']);
  assert.deepEqual(ids(select(rows, {pinned:true}, options)), ['reedClaim']);
  const combined = rows.map(row => group(row.id, row, row));
  assert.deepEqual(ids(select(combined, {onlyMyClaims:true, pinned:true}, {...options, ownerFilter:'actor1'})), ['reedClaim']);
  assert.deepEqual(ids(select(combined, {onlyMyClaims:true, pinned:true}, {...options, ownerFilter:'reed'})), []);
});
