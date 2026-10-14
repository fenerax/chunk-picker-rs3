import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks, selectEquipmentRecommendations, buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';
import { migrateGameplay } from '../app/tasks/migration.mjs';

const task = (category, name, level = 1, record = {}, extras = {}) => ({ id: taskId(category, name), category, rawLabel: name, label: name, level, status: 'available', record: { Level: level, ...record }, ...extras });
const state = rules => ({ members: [{ id: 'a', sourceMapId: 'demo', unlocked: ['1'], completedTasks: [], taskRules: rules ?? {} }] });
const result = tasks => ({ tasks, items: [], access: {}, training: {} });
const names = presentation => presentation.tasks.map(row => row.rawLabel);
const select = (tasks, rules, definitions) => selectPresentedTasks(result(tasks), state(rules), 'a', definitions);

test('legacy raw skill alternative resolves its permanent identity after a label correction', () => {
  const id = 'rs3:task:fixture-renamed-choice', oldRaw = 'Misspelled tree';
  const preferred = task('Woodcutting', 'Correct tree', 60, { Primary: true, Priority: 2 }, { id });
  const other = task('Woodcutting', 'Other tree', 60, { Primary: true, Priority: 1 });
  const saved = state();
  saved.legacy = { maps: { demo: { chunkinfo: { altChallenges: { Woodcutting: { '60': oldRaw } } } } } };
  saved.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, category: 'Woodcutting', label: 'Correct tree', kind: 'task' } }, aliases: { [oldRaw]: id }, unresolved: [] };
  const output = selectPresentedTasks(result([other, preferred]), saved, 'a');
  assert.deepEqual(output.tasks.map(row => row.id), [id]);
  assert.ok(!output.diagnostics.some(row => row.kind === 'unavailable-task-alternative'));
  saved.legacy.maps.demo.chunkinfo.altChallenges.Woodcutting['60'] = 'Unknown historical tree';
  const unresolved = selectPresentedTasks(result([other, preferred]), saved, 'a');
  assert.deepEqual(unresolved.tasks.map(row => row.id), [other.id]);
  assert.ok(unresolved.diagnostics.some(row => row.kind === 'unavailable-task-alternative'));
});

test('active skill goal is the highest level; equally demanding methods are alternatives', () => {
  const low = task('Woodcutting', 'Oak', 15, { Primary: true });
  const high = task('Woodcutting', 'Yew', 60, { Primary: true, Priority: 2 });
  const other = task('Woodcutting', 'Alternative yew', 60, { Primary: true, Priority: 3 });
  const selected = select([low, high, other]);
  assert.deepEqual(names(selected), ['Yew']);
  assert.deepEqual(selected.alternatives[high.id], [other.id]);
  assert.match(selected.suppressed[low.id][0], /higher skill goal/);
});

test('lower Priority wins a level tie; primary wins a tie with the same priority', () => {
  const tasks = [task('Mining', 'Regular', 50), task('Mining', 'Primary', 50, { Primary: true }), task('Mining', 'Priority method', 50, { Priority: 1 })];
  assert.deepEqual(names(select(tasks)), ['Priority method']);
  assert.deepEqual(names(select(tasks.slice(0, 2))), ['Primary']);
});



test('whole quest mode retains zero-point completions and hides intermediate ManualShow rows', () => {
  const tasks = [task('Quest', 'Step', 1, { BaseQuest: 'Example' }), task('Quest', 'Manual step', 1, { ManualShow: true }), task('Quest', 'Miniquest complete', 1, { QuestPoints: 0 }), task('Quest', 'Quest complete', 1, { QuestPoints: 1 })];
  assert.deepEqual(names(select(tasks, { 'Show Quest Tasks Complete': true })), ['Miniquest complete', 'Quest complete']);
  assert.equal(select(tasks, { 'Show Quest Tasks Complete': false }).tasks.length, 4);
  assert.equal(select(tasks, { 'Show Quest Tasks': false }).tasks.length, 0);
});

test('whole achievement mode recognizes ManualShow presence and Achievement controls Diary display', () => {
  const tasks = [task('Diary', 'Individual'), task('Diary', 'Complete tier', 1, { ManualShow: true }), task('Diary', 'Explicit marker', 1, { ManualShow: false }), task('Extra', 'Other extra')];
  assert.deepEqual(names(select(tasks, { 'Show Diary Tasks Complete': true })), ['Complete tier', 'Explicit marker', 'Other extra']);
  assert.deepEqual(names(select(tasks, { Achievement: false })), ['Other extra']);
  assert.deepEqual(names(select(tasks, { 'Show Diary Tasks': false })), tasks.map(row => row.rawLabel));
});



test('completed high skill challenge suppresses lower goals without inventing personal completion', () => {
  const completed = task('Mining', 'Already satisfied', 60, {}, { challengeSatisfied: true, personalCompleted: false });
  const lower = task('Mining', 'Lower', 50), higher = task('Mining', 'Higher', 70);
  assert.deepEqual(names(select([completed, lower, higher])), ['Higher']);
  assert.equal(completed.personalCompleted, false);
  assert.deepEqual(names(select([completed, lower])), []);
});

test('backlogged winner falls back to a lower available task; unavailable rows cannot be alternatives', () => {
  const high = task('Fishing', 'High', 60), low = task('Fishing', 'Low', 50), blocked = task('Fishing', 'Blocked', 60, {}, { status: 'blocked' });
  const saved = state(); saved.members[0].taskStatus = { [high.id]: { backlogged: true } };
  const selected = selectPresentedTasks(result([high, low, blocked]), saved, 'a');
  assert.deepEqual(names(selected), ['Low']);
  assert.deepEqual(selected.alternatives[low.id], []);
});

test('numeric boosts and task bans rank effective required levels', () => {
  const boosted = task('Mining', 'Boostable', 60), banned = task('Mining', 'No boost for this method', 58);
  const input = { ...result([boosted, banned]), items: [{ name: 'Potion', sources: [] }] };
  const defs = { codeItems: { boostItems: { Mining: { Potion: 5 } }, boostTaskBans: { Mining: { [banned.rawLabel]: ['Potion'] } } } };
  const selected = selectPresentedTasks(input, state({ Boosting: true }), 'a', defs);
  assert.deepEqual(names(selected), ['No boost for this method']);
  assert.equal(selected.effectiveLevels[boosted.id], 55);
  assert.equal(selected.effectiveLevels[banned.id], 58);
});


test('saved alternatives select only an available peer at the same effective level', () => {
  const first = task('Woodcutting', 'Default', 60, { Primary: true, Priority: 1 }), second = task('Woodcutting', 'Preference', 60, { Primary: true }), low = task('Woodcutting', 'Low', 20);
  const saved = state(); saved.members[0].taskAlternatives = { Woodcutting: { 60: second.id } };
  assert.deepEqual(names(selectPresentedTasks(result([first, second, low]), saved, 'a')), ['Preference']);
  saved.members[0].taskAlternatives.Woodcutting[60] = low.id;
  assert.deepEqual(names(selectPresentedTasks(result([first, second, low]), saved, 'a')), ['Default']);
});

test('converted personal legacy alternative remains selected and authored Automatic masks it', () => {
  const first = task('Mining', 'Ranked default', 60, { Primary: true, Priority: 1 });
  const preferred = task('Mining', 'Preferred ~|pickaxe|~', 60, { Primary: true, Priority: 2 });
  const saved = state();
  saved.legacy = { maps: { demo: { chunkinfo: { altChallenges: { Mining: { '*fb*_60': 'Preferred ~|pickaxe|~' } } } } }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'demo' }] } };
  const before = structuredClone(saved);
  assert.deepEqual(names(selectPresentedTasks(result([first, preferred]), saved, 'a')), [preferred.rawLabel]);
  assert.deepEqual(saved, before);
  saved.members[0].taskAlternatives = { Mining: { '60': null } };
  assert.deepEqual(names(selectPresentedTasks(result([first, preferred]), saved, 'a')), [first.rawLabel]);
  saved.members[0].taskAlternatives.Mining['60'] = preferred.id;
  assert.deepEqual(names(selectPresentedTasks(result([first, preferred]), saved, 'a')), [preferred.rawLabel]);
});

test('task alternative choice and null masking are isolated to the focused owner', () => {
  const first = task('Mining', 'Ranked default', 60, { Primary: true, Priority: 1 });
  const second = task('Mining', 'Map A choice', 60, { Primary: true, Priority: 2 });
  const third = task('Mining', 'Map B choice', 60, { Primary: true, Priority: 3 });
  const saved = state(); saved.members.push({ id: 'b', sourceMapId: 'other', unlocked: ['1'], completedTasks: [] });
  saved.legacy = { maps: {
    demo: { chunkinfo: { altChallenges: { Mining: { '60': second.rawLabel } } } },
    other: { chunkinfo: { altChallenges: { Mining: { '60': third.rawLabel } } } },
  }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'demo' }, { memberId: 'b', sourceMapId: 'other' }] } };
  const input = result([first, second, third]);
  assert.deepEqual(names(selectPresentedTasks(input, saved, 'a')), [second.rawLabel]);
  assert.deepEqual(names(selectPresentedTasks(input, saved, 'b')), [third.rawLabel]);
  saved.members[0].taskAlternatives = { Mining: { '60': null } };
  assert.deepEqual(names(selectPresentedTasks(input, saved, 'a')), [first.rawLabel]);
  assert.deepEqual(names(selectPresentedTasks(input, saved, 'b')), [third.rawLabel]);
});

test('source prerequisites and level-one secondary tasks stay searchable, with extra tasks unpruned', () => {
  const tasks = [task('Nonskill', 'Access prerequisite'), task('Mining', 'Internal prerequisite', 1), task('Mining', 'Primary method', 1, { Primary: true }), ...Array.from({ length: 12 }, (_, i) => task('Extra', `Extra ${i}`))];
  const selected = select(tasks);
  assert.equal(selected.tasks.length, 13);
  assert.equal(tasks.length, 15);
  assert.ok(selected.suppressed[tasks[0].id]);
  assert.ok(selected.suppressed[tasks[1].id]);
});

test('selector preserves row identity, full engine result, and saved state', () => {
  const tasks = [task('Mining', 'Low', 10), task('Mining', 'High', 20)];
  const input = result(tasks), saved = state(), before = structuredClone({ input, saved });
  Object.freeze(tasks[0]); Object.freeze(tasks[1]); Object.freeze(tasks);
  const selected = selectPresentedTasks(input, saved, 'a');
  assert.equal(selected.tasks[0], tasks[1]);
  assert.deepEqual({ input, saved }, before);
  assert.doesNotThrow(() => JSON.stringify(selected));
});


test('real engine integration keeps recipe production when a lower task is not presented', () => {
  const definitions = { chunks: { '1': { Object: { Tree: true, Oak: true } } }, walkableChunksF2P: ['1'], codeItems: {}, sections: {}, challenges: {
    Woodcutting: { Logs: { Level: 1, Primary: true, Objects: ['Tree'], Output: 'Logs' }, Oak: { Level: 15, Primary: true, Objects: ['Oak'], Output: 'Oak logs' } },
    Extra: { UseLogs: { Items: ['Logs'] }, UseOak: { Items: ['Oak logs'] } },
  } };
  const saved = state(), evaluated = createTaskEngine(definitions).evaluate(saved, 'a');
  const selected = selectPresentedTasks(evaluated, saved, 'a', definitions);
  assert.deepEqual(names(selected), ['Oak', 'UseLogs', 'UseOak']);
  assert.ok(evaluated.items.some(item => item.name === 'Logs'));
  assert.equal(evaluated.tasks.find(row => row.rawLabel === 'Logs').status, 'available');
});

test('unknown member fails explicitly', () => {
  assert.throws(() => selectPresentedTasks(result([]), state(), 'missing'), /Unknown member/);
});

test('ordinary equipment prefers damage to tier and armour, with compatible stable BiS IDs', () => {
  const equipment = [{ name: 'Tank ring', slot: 'ring', tier: 60, sources: [] }, { name: "Explorer's ring 4", slot: 'ring', tier: 0, sources: [{ kind: 'reward' }] }];
  const definitions = { equipment: {
    'Tank ring': { class: 'none', slot: 'ring', armour: 100, lp: 100, melee_damage: 0 },
    "Explorer's ring 4": { class: 'none', slot: 'ring', armour: 0, lp: 0, melee_damage: 15, ranged_damage: 15, magic_damage: 15, necromancy_damage: 15, prayer: 1 },
  } };
  const selected = selectEquipmentRecommendations({ equipment }, {}, definitions);
  assert.equal(selected.recommendations.find(row => row.style === 'Melee').equipment.name, "Explorer's ring 4");
  const target = selected.tasks.find(row => row.equipmentName === "Explorer's ring 4");
  assert.ok(target.aliases.includes(`rs3:BiS:${encodeURIComponent("Obtain an ~|explorer's ring 4|~")}`));
  assert.match(target.id, /^rs3:goal:equipment:/);
  assert.ok(target.equipmentGoals.includes('Prayer BiS ring'));
  assert.equal(target.status, 'available');
});

test('prayer ties remain alternatives; armour uses armour then life points after damage ties', () => {
  const equipment = ['Robe A', 'Robe B'].map(name => ({ name, slot: 'torso', sources: [] }));
  const definitions = { equipment: {
    'Robe A': { class: 'all', prayer: 6, armour: 10, lp: 10 },
    'Robe B': { class: 'all', prayer: 6, armour: 10, lp: 20 },
  } };
  const selected = selectEquipmentRecommendations({ equipment }, {}, definitions);
  assert.equal(selected.recommendations.find(row => row.style === 'Melee').equipment.name, 'Robe B');
  assert.deepEqual(selected.recommendations.find(row => row.style === 'Prayer').alternatives, ['Robe B']);
  assert.equal(selected.catalogue.length, 2);
});

test('unreachable and unsupported weapon equipment cannot be synthesized as a BiS task', () => {
  const definitions = { equipment: {
    Missing: { class: 'all', slot: 'torso', armour: 100 },
    Weapon: { class: 'melee', slot: 'main hand weapon', speed: 3, tier: 50, ability_damage: 480 },
  } };
  const selected = selectEquipmentRecommendations({ equipment: [{ name: 'Weapon', slot: 'main hand weapon', sources: [] }] }, {}, definitions);
  assert.deepEqual(selected.tasks, []);
  assert.ok(selected.diagnostics.some(row => row.item === 'Weapon'));
});

test('equipment display toggles disable matching recommendations without mutating eligibility', () => {
  const input = { equipment: [{ name: 'Ring', slot: 'ring', sources: [] }] }, definitions = { equipment: { Ring: { class: 'none', melee_damage: 5, prayer: 2 } } };
  assert.ok(!selectEquipmentRecommendations(input, { 'Show Best in Slot Prayer Tasks': false }, definitions).recommendations.some(row => row.style === 'Prayer'));
  assert.deepEqual(selectEquipmentRecommendations(input, { 'Show Best in Slot Tasks': false }, definitions).tasks, []);
  assert.equal(input.equipment.length, 1);
});

test('potential equipment catalogue registers IDs without asserting availability', () => {
  const catalogue = buildEquipmentCatalogue({ equipment: { 'Magic boots': {}, 'An item': { formatted_name: 'custom item' } } });
  assert.equal(catalogue[0].rawLabel, 'Obtain ~|magic boots|~');
  assert.equal(catalogue[1].rawLabel, 'Obtain an ~|custom item|~');
  assert.ok(catalogue.every(row => !Object.hasOwn(row, 'status')));
});

test('converted completion and backlog stay cleared despite preserved legacy flags', () => {
  const target = task('Mining', 'Mine', 15, { Primary: true });
  const saved = state();
  saved.legacy = { maps: { demo: { chunkinfo: { completedChallenges: { Mining: { Mine: true } }, backlog: { Mining: { Mine: true } } } } } };
  const converted = migrateGameplay(saved, { definitions: { challenges: { Mining: { Mine: target.record } } } }).state;
  assert.ok(converted.members[0].taskStatus[target.id].challengeCompleted);
  assert.ok(converted.members[0].taskStatus[target.id].backlogged);
  converted.members[0].taskStatus[target.id] = { challengeCompleted: false, backlogged: false };
  assert.deepEqual(names(selectPresentedTasks(result([target]), converted, 'a')), ['Mine']);
  delete converted.members[0].taskStatus[target.id];
  assert.deepEqual(names(selectPresentedTasks(result([target]), converted, 'a')), ['Mine']);
  assert.equal(converted.legacy.maps.demo.chunkinfo.completedChallenges.Mining.Mine, true);
});

test('profile-cleared converted rules do not revive imported skill visibility settings', () => {
  const target = task('Mining', 'Mine', 15, { Primary: true });
  const saved = state();
  saved.legacy = { maps: { demo: { rules: { Skills: false, 'Show Skill Tasks': false } } } };
  const converted = migrateGameplay(saved, { definitions: { challenges: { Mining: { Mine: target.record } } } }).state;
  assert.deepEqual(names(selectPresentedTasks(result([target]), converted, 'a')), []);
  converted.members[0].taskRules = {};
  assert.deepEqual(names(selectPresentedTasks(result([target]), converted, 'a')), ['Mine']);
  converted.members[0].taskRules = { Skills: false };
  assert.deepEqual(names(selectPresentedTasks(result([target]), converted, 'a')), []);
});

test('migration authority belongs only to the converted owner and source map', () => {
  const target = task('Mining', 'Mine', 15, { Primary: true });
  const saved = state();
  saved.legacy = { maps: { demo: { rules: { Skills: false } } }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'other', sourceMapId: 'demo' }] } };
  assert.deepEqual(names(selectPresentedTasks(result([target]), saved, 'a')), []);
  saved.legacy.gameplayMigration.migratedMembers = [{ memberId: 'a', sourceMapId: 'demo' }];
  assert.deepEqual(names(selectPresentedTasks(result([target]), saved, 'a')), ['Mine']);
});
