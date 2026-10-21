import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXpChoiceCatalogue, buildXpChoiceView, xpRewardSlots, validateXpChoices, resolveXpChoices } from '../app/core/xp-choices.mjs';

const task = { id: 'reward', label: 'Reward', rawLabel: '~|Reward|~', category: 'Quest', record: { XpReward: { Mining: 50, Anyx3: 1000, 'Mining|Woodcutting': 200 } } };
const identities = definitions => Object.entries(definitions.challenges).flatMap(([category, records]) =>
  Object.keys(records).map(rawLabel => ({ id: `${category}:${rawLabel}`, category, rawLabel, label: rawLabel })));
const membershipRows = definitions => [...buildXpChoiceCatalogue(definitions, identities(definitions)).values()];

test('trusted reward, task membership and task record flags each restrict XP choices', () => {
  const definitions = { challenges: { Quest: { reward: { XpReward: { Any: 100 }, 'Not F2P': true },
    task: { XpReward: { Any: 100 } }, record: { XpReward: { Any: 100 } }, free: { XpReward: { Any: 100 } } } } };
  const rows = identities(definitions).map(row => ({ ...row,
    ...(row.rawLabel === 'task' ? { members: true } : {}),
    ...(row.rawLabel === 'record' ? { record: { 'Not F2P': true } } : {}) }));
  const before = structuredClone(definitions);
  assert.deepEqual([...buildXpChoiceCatalogue(definitions, rows).values()].map(row => [row.rawLabel, row.members]),
    [['reward', true], ['task', true], ['record', true], ['free', false]]);
  assert.deepEqual(definitions, before);
});

test('required dependencies propagate membership through nested and cyclic graphs', () => {
  const definitions = { challenges: { Diary: {
    nested: { XpReward: { Any: 100 }, Tasks: { middle: 'Diary' } }, middle: { Tasks: { paid: 'Quest' } },
    cyclic: { XpReward: { Any: 100 }, Tasks: { loop: 'Diary' } },
    loop: { Tasks: { cyclic: 'Diary', paid: 'Quest' } },
    freeCycle: { XpReward: { Any: 100 }, Tasks: { freeLoop: 'Diary' } }, freeLoop: { Tasks: { freeCycle: 'Diary' } },
    unknown: { XpReward: { Any: 100 }, Tasks: { missing: 'Quest' } },
  }, Quest: { paid: { 'Not F2P': true } } } };
  assert.deepEqual(membershipRows(definitions).map(row => [row.rawLabel, row.members]),
    [['nested', true], ['cyclic', true], ['freeCycle', false], ['unknown', false]]);
});

test('diary geography needs only known numeric members areas and complete F2P area data', () => {
  const definitions = { walkableChunksF2P: ['100'], chunks: { 100: {}, 200: {}, 300: {} }, challenges: { Diary: {
    members: { XpReward: { Any: 100 }, Chunks: ['200-1', '300'] },
    mixed: { XpReward: { Any: 100 }, Chunks: ['200', '100-2'] },
    unknown: { XpReward: { Any: 100 }, Chunks: ['999'] },
    interior: { XpReward: { Any: 100 }, Chunks: ['City of Um'] },
    empty: { XpReward: { Any: 100 }, Chunks: [] },
  }, Quest: { freeQuest: { XpReward: { Any: 100 }, Chunks: ['200'] } } } };
  assert.deepEqual(membershipRows(definitions).map(row => [row.rawLabel, row.members]),
    [['members', true], ['mixed', false], ['unknown', false], ['interior', false], ['empty', false], ['freeQuest', false]]);
  delete definitions.walkableChunksF2P;
  assert(membershipRows(definitions).every(row => !row.members));
});

test('quest BaseQuest membership restricts associated rewards without requiring a dependency', () => {
  const definitions = { challenges: { Quest: { '~|Paid Quest|~ Complete the quest': { BaseQuest: 'Paid Quest', 'Not F2P': true } },
    Nonskill: { 'Bonus lamp': { BaseQuest: 'Paid Quest', XpReward: { Any: 100 } },
      'Free lamp': { BaseQuest: 'Other Quest', XpReward: { Any: 100 } } } } };
  assert.deepEqual(membershipRows(definitions).map(row => [row.rawLabel, row.members]), [['Bonus lamp', true], ['Free lamp', false]]);
});

test('reviewed missing source flags are exact and category-specific', () => {
  const quest = "~|Beneath Scabaras' Sands|~ Complete the quest";
  const diary = ['Varrock Achievements#Easy', 'Wilderness Achievements#Easy', 'Wilderness Achievements#Medium']
    .map(name => `~|${name}|~ Complete the ${name.split('#')[1]} Achievements`);
  const definitions = { challenges: { Quest: { [quest]: { XpReward: { Any: 100 } },
    '~|Missing, Presumed Death|~ Complete the quest': { XpReward: { Any: 100 } },
    "~|Three's Company (unabridged saga)|~ Complete the unabridged saga": { XpReward: { Any: 100 } } },
    Diary: Object.fromEntries(diary.map(label => [label, { XpReward: { Any: 100 } }])),
    Nonskill: { [quest]: { XpReward: { Any: 100 } } } } };
  assert.deepEqual(membershipRows(definitions).map(row => row.members), [true, false, false, true, true, true, false]);
});


test('F2P views preserve authored and imported member allocations through mode switches', () => {
  const definitions = { challenges: { Diary: { authored: { XpReward: { Any: 100 }, 'Not F2P': true },
    imported: { XpReward: { Any: 100 }, 'Not F2P': true } } } };
  const catalogue = buildXpChoiceCatalogue(definitions, identities(definitions));
  const state = { rules: { 'content.f2p': true }, members: [{ id: 'm', sourceMapId: 'old', xpChoices: { 'Diary:authored': ['Mining'] } }],
    legacy: { maps: { old: { chunkinfo: { assignedXpRewards: { Diary: { imported: { Fishing: 100 } } } } } } } };
  const before = structuredClone(state), first = buildXpChoiceView(state, 'm', catalogue);
  assert(first.rows.every(row => !row.availableInMode));
  assert.deepEqual(first.rows.map(row => [row.source, row.choices, row.allocation]),
    [['authored', ['Mining'], { Mining: 100 }], ['imported', ['Fishing'], { Fishing: 100 }]]);
  assert.deepEqual(state, before);
  state.rules['content.f2p'] = false;
  assert(buildXpChoiceView(state, 'm', catalogue).rows.every(row => row.availableInMode));
  state.rules['content.f2p'] = true;
  assert.deepEqual(buildXpChoiceView(state, 'm', catalogue), first);
  assert.deepEqual(state, before);
});
test('reward slots expand AnyxN and restricted rewards, retaining fixed XP separately', () => {
  const slots = xpRewardSlots(task);
  assert.deepEqual(slots.map(slot => slot.amount), [1000, 1000, 1000, 200]);
  assert.deepEqual(slots[3].skills, ['Mining', 'Woodcutting']);
  validateXpChoices(task, ['Mining', 'Mining', null, 'Mining']);
  assert.throws(() => validateXpChoices(task, ['Mining']), /one selection/);
  assert.throws(() => validateXpChoices(task, ['Mining', null, null, 'Fishing']), /Invalid skill/);
});


test('unknown selectors stay outside the chooser without guessing a skill correction', () => {
  assert.deepEqual(xpRewardSlots({ XpReward: { Craft: 90000, 'Attack|Mystery': 500 } }), []);
  const catalogue = buildXpChoiceCatalogue({ challenges: { Quest: { '~|Reward|~': { XpReward: { Craft: 90000 } } } } }, [task]);
  assert.equal(catalogue.size, 0);
});

test('encoded imported choices retain provenance and recover equivalent repeated lamps', () => {
  const source = { ...task, record: { XpReward: { Anyx3: 1000 } } };
  const member = { id: 'm', sourceMapId: 'old' };
  const state = { members: [member], legacy: { maps: { old: { chunkinfo: { assignedXpRewards: { Quest: { '~%7CReward%7C~': { Mining: 2000, None: 1000 } } } } } } } };
  const saved = structuredClone(state), result = resolveXpChoices(state, member, source);
  assert.equal(result.source, 'imported'); assert.equal(result.ambiguous, false);
  assert.deepEqual(result.choices, ['Mining', 'Mining', null]);
  assert.match(result.importedPath, /assignedXpRewards/);
  assert.deepEqual(state, saved);
  member.xpChoices = { reward: [null, null, null] };
  assert.equal(resolveXpChoices(state, member, source).source, 'authored');
});

test('unknown or contradictory imported totals remain visible for review', () => {
  const member = { id: 'm', sourceMapId: 'old' };
  const state = { rules: {}, members: [member], legacy: { maps: { old: { chunkinfo: { assignedXpRewards: { Quest: { '~|Reward|~': { Mining: 17 } } } } } } } };
  const view = buildXpChoiceView(state, 'm', new Map([[task.id, task]]));
  assert.equal(view.rows[0].ambiguous, true);
  assert.deepEqual(view.rows[0].importedAllocation, { Mining: 17 });
  assert.deepEqual(view.rows[0].choices, [null, null, null, null]);
});

test('catalogue uses trusted task identity and marks members sources separately', () => {
  const catalogue = buildXpChoiceCatalogue({ challenges: { Quest: { '~|Reward|~': { XpReward: { Any: 500 }, 'Not F2P': true } } } }, [task]);
  const view = buildXpChoiceView({ members: [{ id: 'm' }], rules: {} }, 'm', catalogue);
  assert.equal(view.rows[0].id, task.id); assert.equal(view.rows[0].availableInMode, false);
  assert.equal(view.rows[0].slots.length, 1);
  assert.throws(() => validateXpChoices(catalogue.get(task.id), ['Mining'], { f2p: true }), /members-only/);
});

test('unmatched imported sources stay visible without offering a writable identity', () => {
  const state = { members: [{ id: 'm', sourceMapId: 'old' }], legacy: { maps: { old: { chunkinfo: {
    assignedXpRewards: { Nonskill: { 'Old lamp': { Mining: 1200 } } },
  } } } } };
  const row = buildXpChoiceView(state, 'm', new Map()).rows[0];
  assert.equal(row.id, null); assert.equal(row.unknownSource, true); assert.equal(row.availableInMode, false);
  assert.deepEqual(row.allocation, { Mining: 1200 }); assert.deepEqual(row.slots, []);
});
