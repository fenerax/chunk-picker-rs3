import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { houseStorageCatalogue, houseStorageRule } from '../app/data/poh-storage.mjs';
import { buildHouseStorageCatalogue, evaluateHouseStorage } from '../app/tasks/house-storage.mjs';
import { taskRuleDefinitions, taskRuleBehavior } from '../app/data/settings.mjs';

// Pure evaluator fixtures only: no server imports, file outputs or live state.
const quest = "There's No Place Like Home...";
const definitions = supplies => ({ chunks: { 100: { Object: { 'Furniture workbench': 1, 'Furniture storage': 1 }, Spawn: Object.fromEntries(supplies.map(name => [name, 1])) } },
  challenges: { Quest: { 'Complete housing tutorial': { BaseQuest: quest, Chunks: ['100'], QuestPoints: 1 } } } });
const state = (enabled = true, f2p = false, level = 120) => ({ rules: { 'content.f2p': f2p }, taskRules: { [houseStorageRule]: enabled },
  members: [{ id: 'm', unlocked: ['100'], completedTasks: [], passiveLevels: { Construction: level } }] });
const storageRows = result => result.tasks.filter(row => row.kind === 'house-storage');
const evaluate = (supplies, saved = state(), mutate = () => {}) => {
  const input = definitions(supplies); mutate(input);
  const before = structuredClone({ input, saved });
  const result = createTaskEngine(input).evaluate(saved, 'm');
  assert.deepEqual({ input, saved }, before);
  return result;
};

test('House storage tasks is a boolean optional rule, off by default', () => {
  const rule = taskRuleDefinitions.find(row => row.id === houseStorageRule);
  assert.equal(rule.label, 'House storage tasks'); assert.equal(rule.default, false); assert.equal(rule.type, 'boolean');
  assert.equal(taskRuleBehavior(houseStorageRule).status, 'implemented-scope');
  for (const saved of [state(false), { ...state(), taskRules: {} }]) {
    const result = evaluate(['Mask of Dragith Nurn', 'Oak plank'], saved);
    assert.deepEqual(storageRows(result), []); assert.equal(result.houseStorage.enabled, false);
  }
});

test('free items never invent F2P costume storage; automatic wooden bookcases have no fill tasks', () => {
  const result = evaluate(['Mask of Dragith Nurn', 'Oak plank', 'Plank', 'Steel nails', 'Silverlight', 'Teak plank'], state(true, true));
  assert.deepEqual(storageRows(result), []);
  assert.equal(result.houseStorage.exclusions[0].kind, 'membership');
  const bookcase = houseStorageCatalogue.furniture.find(row => row.name === 'Wooden bookcase');
  assert.equal(bookcase.members, false); assert.equal(bookcase.construction, 6); assert.equal(bookcase.generateTasks, false);
  assert(!buildHouseStorageCatalogue().some(row => row.slotId.includes('bookcase')));
});

test('mask storage uses the current armour case recipe and source, not historical levels', () => {
  const supplies = ['Mask of Dragith Nurn', 'Oak plank'];
  assert.equal(storageRows(evaluate(supplies, state(true, false, 45))).length, 0);
  const rows = storageRows(evaluate(supplies, state(true, false, 46)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].houseStorage.furniture, 'Oak armour case');
  assert.equal(rows[0].label, 'Store Mask of Dragith Nurn in your armour case');
  assert.deepEqual(rows[0].houseStorage.materials, { 'Oak plank': 3 });
  assert.match(rows[0].wikiPermalink, /Armour_case\?oldid=\d+$/);
  assert.equal(rows[0].primary, false); assert.equal(rows[0].primaryMethod, false);
  assert.equal(rows[0].status, 'available'); assert.equal(rows[0].obligation, true);
});

test('all pieces of a set must be obtainable and alternative pieces are OR within a component', () => {
  const mime = ['Mime mask', 'Mime top', 'Mime legs', 'Mime gloves', 'Mime boots'];
  assert(!storageRows(evaluate([...mime.slice(0, -1), 'Oak plank'])).some(row => row.slotId === 'mime-outfit'));
  assert(storageRows(evaluate([...mime, 'Oak plank'])).some(row => row.slotId === 'mime-outfit'));
  const catalogue = structuredClone(houseStorageCatalogue);
  catalogue.slots = [{ ...catalogue.slots.find(row => row.id === 'mime-outfit'), parts: [['Legs', 'Skirt'], ['Top']] }];
  const input = { rules: { [houseStorageRule]: true }, f2p: false, rows: [{ category: 'Quest', baseQuest: quest, record: { QuestPoints: 1 }, status: 'available' }],
    items: new Set(['Skirt', 'Top', 'Oak plank']), sourceList: () => [], access: { objects: new Set(['Furniture workbench', 'Furniture storage']) },
    ownAccess: { objects: new Set(['Furniture workbench', 'Furniture storage']) }, levels: { Construction: 44 }, caps: { Construction: 120 }, member: {}, completed: new Set(), challengeSatisfied: () => false };
  assert.equal(evaluateHouseStorage(input, catalogue).tasks.length, 1);
  input.items.delete('Top'); assert.equal(evaluateHouseStorage(input, catalogue).tasks.length, 0);
  input.items.add('Top'); catalogue.slots[0].historical = true;
  assert.equal(evaluateHouseStorage(input, catalogue).tasks.length, 0);
});

test('display furniture consumes its verified recipe item and toy goals explain shared retrieval', () => {
  const displays = storageRows(evaluate(['Silverlight', 'Anti-dragon shield', 'Teak plank'], state(true, false, 47)));
  assert(displays.some(row => row.houseStorage.furniture === 'Silverlight display'));
  assert(displays.some(row => row.houseStorage.furniture === 'Anti-dragon shield display'));
  assert.deepEqual(displays.find(row => row.slotId === 'silverlight-display').houseStorage.materials, { 'Teak plank': 2, Silverlight: 1 });
  const toy = storageRows(evaluate(['Cornucopia', 'Oak plank'], state(true, false, 50))).find(row => row.slotId === 'cornucopia');
  assert.equal(toy.houseStorage.automaticRetrieval, true); assert.match(toy.explanation, /Diango/);
});

test('personal completion and group challenge scope remain separate, IDs survive furniture upgrades', () => {
  const id = 'rs3:goal:house-storage:mask-of-dragith-nurn';
  const saved = state(); saved.members.push({ id: 'partner', unlocked: [], completedTasks: [id] });
  let row = storageRows(evaluate(['Mask of Dragith Nurn', 'Oak plank'], saved))[0];
  assert.equal(row.id, id); assert.equal(row.personalCompleted, false); assert.equal(row.challengeSatisfied, true);
  saved.rules['tasks.completion'] = 'all';
  row = storageRows(evaluate(['Mask of Dragith Nurn', 'Oak plank'], saved))[0]; assert.equal(row.challengeSatisfied, false);
  saved.members[0].completedTasks = [id]; saved.members[0].taskStatus = { [id]: { backlogged: true } };
  row = storageRows(evaluate(['Mask of Dragith Nurn', 'Mahogany plank'], saved))[0];
  assert.equal(row.id, id); assert.equal(row.houseStorage.furniture, 'Mahogany armour case');
  assert.equal(row.personalCompleted, true); assert.equal(row.challengeSatisfied, true); assert.equal(row.status, 'blocked');
});

test('catalogue preserves pinned provenance, item membership, all current furniture tiers and unique objectives', () => {
  assert.equal(houseStorageCatalogue.furniture.length, 39); assert.equal(houseStorageCatalogue.slots.length, 75);
  assert.equal(new Set(buildHouseStorageCatalogue().map(row => row.id)).size, 67);
  assert(!buildHouseStorageCatalogue().some(row => row.slotId.startsWith('golden-')));
  for (const furniture of houseStorageCatalogue.furniture) {
    assert.equal(typeof furniture.members, 'boolean'); assert(Number.isSafeInteger(furniture.construction));
    assert(Object.values(furniture.materials).every(amount => Number.isSafeInteger(amount) && amount > 0));
    assert.match(houseStorageCatalogue.sources[furniture.source].permalink, /^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/);
  }
  for (const item of houseStorageCatalogue.items) { assert.equal(typeof item.members, 'boolean'); assert.match(item.permalink, /oldid=\d+$/); }
  for (const slot of houseStorageCatalogue.slots) {
    assert(slot.parts.length); assert.equal(slot.storageMembers, true);
    for (const name of slot.parts.flat()) assert(houseStorageCatalogue.items.some(item => item.name.toLowerCase() === name.toLowerCase()), name);
  }
  assert.equal(houseStorageCatalogue.furniture.find(row => row.name === 'Eternal gilded magic wardrobe').construction, 114);
  assert.equal(houseStorageCatalogue.furniture.find(row => row.name === 'Oak treasure chest').rewardTiers[0], 'easy');
});

test('necklace rewards require the matching current chest tier and golden Barrows remains entitlement-gated', () => {
  assert(!storageRows(evaluate(['Strength amulet (t)', 'Oak plank'], state(true, false, 120))).some(row => row.label.includes('Strength amulet')));
  const medium = storageRows(evaluate(['Strength amulet (t)', 'Teak plank'], state(true, false, 66))).find(row => row.label.includes('Strength amulet'));
  assert.equal(medium.houseStorage.furniture, 'Teak treasure chest');
  assert.equal(medium.label, 'Store Strength amulet (t) in your treasure chest');
  assert(!storageRows(evaluate(['Amulet of fury (or)', 'Teak plank'])).some(row => row.label.includes('fury')));
  const elite = storageRows(evaluate(['Amulet of fury (or)', 'Mahogany plank'], state(true, false, 84))).find(row => row.label.includes('fury'));
  assert.equal(elite.houseStorage.furniture, 'Mahogany treasure chest');
  const golden = houseStorageCatalogue.slots.filter(row => row.requiresPersonalEventEntitlement);
  assert.equal(golden.length, 8); assert(golden.every(row => row.requiresFullRepair && row.generateTasks === false));
  const result = evaluate([...golden.flatMap(row => row.parts.flat()), 'Mahogany plank']);
  assert(!storageRows(result).some(row => row.label.includes('Golden')));
  assert(result.houseStorage.exclusions.filter(row => row.kind === 'unsupported-entitlement').length === 8);
});
