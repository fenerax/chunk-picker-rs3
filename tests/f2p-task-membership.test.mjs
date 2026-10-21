import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { collectBaseItemSources } from '../app/tasks/access.mjs';
import { itemMembership, pickerEntityMembership } from '../app/data/item-membership.mjs';
import { sourceMembershipBlocker, sourceMembershipRecord, sourceMembershipRequiredItems } from '../app/data/source-membership.mjs';

// Retained records are read-only reference inputs. These tests use synthetic
// geography and progress, never either player's save or a running server.
const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const options = { retainedTaskCorrections: true, equipmentCorrections: true,
  cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false };
const memberItem = 'Magic shortbow';
const names = result => new Set(result.items.map(row => row.name));
const row = (result, category, label) => result.tasks.find(task => task.id === taskId(category, label));
const membership = task => task.blockers.filter(blocker => blocker.kind === 'membership');

function state(f2p = true) {
  return { rules: { 'content.f2p': f2p }, members: [{ id: 'a', name: 'Synthetic player', sourceMapId: 'fixture',
    unlocked: ['1', '12597'], selected: [], completedTasks: [] }],
  legacy: { maps: { fixture: { chunkinfo: { passiveSkill: { Crafting: 99, Fletching: 99, Magic: 99, Woodcutting: 99, Firemaking: 99 } } } } } };
}

function definitions(challenges, additions = {}) {
  return { chunks: { '1': {}, '12597': { Sections: { '1': {} } } },
    walkableChunks: ['1', '12597'], walkableChunksF2P: ['1', '12597'], sections: {}, codeItems: {},
    challenges, ...additions };
}

function sourceAccess({ spawns = [], shops = [], monsters = [], objects = [] } = {}) {
  return { bases: new Set(['1']), sections: new Set(), areas: new Set(),
    spawns: new Map(spawns.map(name => [name, 1])), shops: new Set(shops), monsters: new Set(monsters), objects: new Set(objects),
    locations: new Map([
      ...spawns.map(name => [`Spawn:${name}`, ['1']]), ...shops.map(name => [`Shop:${name}`, ['1']]),
      ...monsters.map(name => [`Monster:${name}`, ['1']]), ...objects.map(name => [`Object:${name}`, ['1']]),
    ]) };
}

for (const kind of ['spawn', 'shop', 'drop', 'object']) {
  test(`known member item is rejected from an otherwise admitted ${kind} source only in F2P`, () => {
    assert.equal(itemMembership(memberItem).members, true);
    const freeItem = 'Ashes', source = `Synthetic ${kind} source`;
    const data = definitions({}, {
      shopItems: { [source]: { [memberItem]: true, [freeItem]: true } },
      drops: { [source]: { [memberItem]: { '1': 'Always' }, [freeItem]: { '1': 'Always' } } },
      objectItems: { [source]: { [memberItem]: true, [freeItem]: true } },
    });
    const access = sourceAccess(kind === 'spawn' ? { spawns: [memberItem, freeItem] }
      : { [{ shop: 'shops', drop: 'monsters', object: 'objects' }[kind]]: [source] });
    const before = structuredClone({ data, access });
    const free = collectBaseItemSources(data, access, { rules: { F2P: true } });
    assert.equal(free.items.has(memberItem), false);
    assert.equal(free.sources.has(memberItem), false);
    assert(free.items.has(freeItem));
    assert(free.diagnostics.some(blocker => blocker.code === 'members-only-item' && blocker.item === memberItem && blocker.sourceKind === kind));
    const unrestricted = collectBaseItemSources(data, access, { rules: { F2P: false } });
    assert(unrestricted.sources.get(memberItem).some(reason => reason.kind === kind));
    assert(unrestricted.sources.get(freeItem).some(reason => reason.kind === kind));
    assert.deepEqual({ data, access }, before);
  });
}

test('a member source restricts its source alone; the same free item survives an independent free source', () => {
  assert.equal(itemMembership('Ashes').members, false);
  assert.equal(sourceMembershipRecord('Object', 'Magic tree').members, true);
  const data = definitions({}, { objectItems: { 'Magic tree': { Ashes: true } } });
  const access = sourceAccess({ objects: ['Magic tree'], spawns: ['Ashes'] });
  const free = collectBaseItemSources(data, access, { rules: { F2P: true } });
  assert.deepEqual(free.sources.get('Ashes').map(reason => reason.kind), ['spawn']);
  assert(free.diagnostics.some(blocker => blocker.code === 'members-only-source' && blocker.item === 'Ashes' && blocker.source === 'Magic tree'));
  const unrestricted = collectBaseItemSources(data, access, { rules: { F2P: false } });
  assert.deepEqual(new Set(unrestricted.sources.get('Ashes').map(reason => reason.kind)), new Set(['spawn', 'object']));
});

test('mixed random outputs keep the free activity, filter member products and expand nested output tables', () => {
  const data = definitions({ Crafting: {
    'Synthetic mixed recipe': { Output: 'Synthetic outer table', Primary: true },
    'Synthetic member recipe': { Output: 'Synthetic member table', Primary: true },
  }, Extra: { 'Synthetic use free output': { Items: ['Ashes'] }, 'Synthetic use member output': { Items: [memberItem] } } }, {
    skillItems: { Crafting: {
      'Synthetic outer table': { 'Synthetic inner table': { '1': 'Always' } },
      'Synthetic inner table': { Ashes: { '1': 'Always' }, [memberItem]: { '1': 'Always' } },
      'Synthetic member table': { [memberItem]: { '1': 'Always' } },
    } },
  });
  const engine = createTaskEngine(data, options), saved = state(), before = structuredClone({ data, saved });
  const free = engine.evaluate(saved, 'a');
  assert.equal(row(free, 'Crafting', 'Synthetic mixed recipe').status, 'available');
  assert.equal(row(free, 'Crafting', 'Synthetic member recipe').status, 'blocked');
  assert(membership(row(free, 'Crafting', 'Synthetic member recipe')).some(blocker => blocker.item === memberItem && blocker.product));
  assert.equal(row(free, 'Extra', 'Synthetic use free output').status, 'available');
  assert.equal(row(free, 'Extra', 'Synthetic use member output').status, 'blocked');
  assert.deepEqual(names(free), new Set(['Ashes']));
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert.equal(row(unrestricted, 'Crafting', 'Synthetic member recipe').status, 'available');
  assert(names(unrestricted).has(memberItem));
  saved.rules['content.f2p'] = true;
  assert.equal(names(engine.evaluate(saved, 'a')).has(memberItem), false);
  assert.deepEqual({ data, saved }, before);
});

test('free quests remain available when a member reward is filtered', () => {
  const data = definitions({ Quest: { 'Synthetic free quest': { Reward: [memberItem, 'Ashes'], QuestPoints: 1 } } });
  const engine = createTaskEngine(data, options), saved = state();
  const free = engine.evaluate(saved, 'a');
  assert.equal(row(free, 'Quest', 'Synthetic free quest').status, 'available');
  assert.deepEqual(names(free), new Set(['Ashes']));
  assert.equal(free.points.QuestPointsNeeded, 1);
  saved.rules['content.f2p'] = false;
  assert.deepEqual(names(engine.evaluate(saved, 'a')), new Set(['Ashes', memberItem]));
});

for (const kind of ['task', 'drop', 'object']) {
  test(`nested Gem-to-Rare member rows are filtered from ${kind} loot while free activity and independent magic logs survive`, () => {
    const label = 'Synthetic gem loot activity', source = `Synthetic gem ${kind} source`;
    assert.equal(itemMembership('Magic logs').members, false);
    const data = definitions(kind === 'task' ? { Nonskill: { [label]: { Output: 'GemDropTable+' } } } : {}, {
      chunks: { '1': { Spawn: { 'Magic logs': 1 },
        ...(kind === 'drop' ? { Monster: { [source]: true } } : kind === 'object' ? { Object: { [source]: true } } : {}) } },
      drops: { [source]: { 'GemDropTable+': { '1': 'Always' } } },
      objectItems: { [source]: { 'GemDropTable+': { '1': 'Always' } } },
      codeItems: { dropTables: {
        'GemDropTable+': { 'Uncut sapphire': { '1': 'Always' }, Ashes: { '1': 'Always' }, 'RareDropTable+': { '1': 'Always' } },
        'RareDropTable+': { 'Magic logs': { '1': 'Always' } },
      } },
    });
    const saved = state(), before = structuredClone({ data, saved }), engine = createTaskEngine(data, options), free = engine.evaluate(saved, 'a');
    if (kind === 'task') assert.equal(row(free, 'Nonskill', label).status, 'available');
    assert.deepEqual(names(free), new Set(['Ashes', 'Uncut sapphire', 'Magic logs']));
    assert.deepEqual(free.items.find(item => item.name === 'Magic logs').sources.map(reason => reason.kind), ['spawn']);
    const gem = free.items.find(item => item.name === 'Uncut sapphire');
    assert(gem.sources.some(reason => reason.kind === kind && reason.tables?.includes('GemDropTable+')));
    assert.deepEqual({ data, saved }, before);
    saved.rules['content.f2p'] = false;
    const unrestricted = engine.evaluate(saved, 'a');
    assert(unrestricted.items.find(item => item.name === 'Magic logs').sources.some(reason => reason.kind === kind && reason.tables?.includes('RareDropTable+')));
  });
}

test('saved completion and manual supply facts cannot generate member products or restore a member activity in F2P', () => {
  const data = definitions({ Crafting: { 'Synthetic completed member recipe': { Output: memberItem, 'Output Object': 'Synthetic forge' } },
    Nonskill: { 'Synthetic completed member activity': { 'Not F2P': true, Output: 'Ashes', 'Output Object': 'Synthetic bench' } },
    Extra: { 'Synthetic use manual member item': { Items: [memberItem] } } });
  const saved = state();
  saved.members[0].completedTasks = [taskId('Crafting', 'Synthetic completed member recipe'), taskId('Nonskill', 'Synthetic completed member activity')];
  Object.assign(saved.legacy.maps.fixture.chunkinfo, { manualMonsters: { Items: { [memberItem]: true } }, manualEquipment: { [memberItem]: true } });
  const before = structuredClone({ data, saved }), engine = createTaskEngine(data, options), free = engine.evaluate(saved, 'a');
  assert.equal(row(free, 'Crafting', 'Synthetic completed member recipe').personalCompleted, true);
  assert.equal(row(free, 'Crafting', 'Synthetic completed member recipe').status, 'blocked');
  assert.equal(row(free, 'Nonskill', 'Synthetic completed member activity').status, 'blocked');
  assert.equal(row(free, 'Extra', 'Synthetic use manual member item').status, 'blocked');
  assert.equal(free.items.length, 0);
  assert.equal(free.access.objects.includes('Synthetic forge'), false);
  assert.equal(free.access.objects.includes('Synthetic bench'), false);
  assert(free.diagnostics.some(blocker => blocker.code === 'members-only-item' && blocker.item === memberItem));
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert.equal(row(unrestricted, 'Extra', 'Synthetic use manual member item').status, 'available');
  assert(names(unrestricted).has(memberItem));
  assert(unrestricted.access.objects.includes('Synthetic forge'));
  assert(unrestricted.access.objects.includes('Synthetic bench'));
});

test('member alias alternatives preserve OR semantics and counted aliases require distinct admitted choices', () => {
  const data = definitions({ Extra: {
    'Synthetic all member choices': { Items: ['SyntheticMembers[+]'] },
    'Synthetic mixed choice': { Items: ['SyntheticMixed[+]'] },
    'Synthetic counted mixed': { Items: ['SyntheticMixed[+]x2'] },
    'Synthetic duplicate choices': { Items: ['SyntheticDuplicate[+]x2'] },
    'Synthetic free and unknown': { Items: ['SyntheticUnknown[+]x2'] },
  } }, {
    chunks: { '1': { Spawn: { Ashes: 1, [memberItem]: 1, 'Synthetic unknown item': 1 } } },
    codeItems: { itemsPlus: {
      'SyntheticMembers[+]': [memberItem, 'Magic longbow'], 'SyntheticMixed[+]': [memberItem, 'Ashes'],
      'SyntheticDuplicate[+]': ['Ashes', 'Ashes', memberItem], 'SyntheticUnknown[+]': ['Ashes', 'Synthetic unknown item', memberItem],
    } },
  });
  const engine = createTaskEngine(data, options), saved = state(), free = engine.evaluate(saved, 'a');
  assert.equal(row(free, 'Extra', 'Synthetic all member choices').status, 'blocked');
  assert.equal(row(free, 'Extra', 'Synthetic mixed choice').status, 'available');
  assert.equal(row(free, 'Extra', 'Synthetic counted mixed').status, 'blocked');
  assert.equal(row(free, 'Extra', 'Synthetic duplicate choices').status, 'blocked');
  assert.equal(row(free, 'Extra', 'Synthetic free and unknown').status, 'available');
  assert(membership(row(free, 'Extra', 'Synthetic counted mixed')).some(blocker => blocker.item === memberItem));
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert.equal(row(unrestricted, 'Extra', 'Synthetic counted mixed').status, 'available');
  assert.equal(row(unrestricted, 'Extra', 'Synthetic duplicate choices').status, 'available');
});

test('real engraving record exposes its missing member supply without banning the intrinsically free engraving action', () => {
  const label = "Engrave the onyx amulet after ~|Gunnar's Ground|~", quest = "~|Gunnar's Ground|~ Complete the quest";
  const record = reference.challenges.Crafting[label];
  assert.equal(Object.hasOwn(record, 'Items'), false);
  assert.equal(record.Level, 90);
  assert.equal(sourceMembershipBlocker('Task', label, true, 'Crafting'), null);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, record, true), ['Onyx amulet']);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, record, false), []);
  const data = definitions({ Crafting: { [label]: structuredClone(record) }, Quest: { [quest]: {} } });
  const saved = state(); saved.members[0].completedTasks = [taskId('Quest', quest)];
  const engine = createTaskEngine(data, options), before = structuredClone({ data, saved }), free = engine.evaluate(saved, 'a');
  assert(free.access.sections.includes('12597-1'));
  const blocked = row(free, 'Crafting', label);
  assert.equal(blocked.status, 'blocked');
  assert(membership(blocked).some(blocker => blocker.code === 'members-only-item' && blocker.item === 'Onyx amulet'));
  assert(membership(blocked).some(blocker => blocker.evidence === itemMembership('Onyx amulet').wiki.url));
  assert.match(blocked.explanation, /Onyx amulet/);
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  assert.equal(row(engine.evaluate(saved, 'a'), 'Crafting', label).status, 'available');
});

test('free magic logs remain usable for firemaking while member trees, bow products and the shaft recipe are gated', () => {
  const shafts = 'Fletch ~|shafts|~ using magic logs', cut = 'Cut ~|magic logs|~', fire = 'Light a fire using ~|magic logs|~';
  const recipeLabels = [shafts, 'Fletch a ~|magic shortbow (unstrung)|~', 'String a ~|magic shortbow|~',
    'Fletch a ~|magic longbow (unstrung)|~', 'String a ~|magic longbow|~', 'Fletch a ~|magic stock|~'];
  const data = definitions({
    Fletching: Object.fromEntries(recipeLabels.map(label => [label, structuredClone(reference.challenges.Fletching[label])])),
    Woodcutting: { [cut]: structuredClone(reference.challenges.Woodcutting[cut]) },
    Firemaking: { [fire]: structuredClone(reference.challenges.Firemaking[fire]) },
  }, { chunks: { '1': { Object: { 'Magic tree': true }, Spawn: { 'Magic logs': 1, Bowstring: 1 } } } });
  assert.equal(itemMembership('Magic logs').members, false);
  assert.equal(itemMembership('Shaft').members, false);
  assert.equal(reference.challenges.Fletching[shafts]['Not F2P'], undefined);
  const engine = createTaskEngine(data, options), saved = state(), before = structuredClone({ data, saved }), free = engine.evaluate(saved, 'a');
  assert(names(free).has('Magic logs'));
  assert.equal(row(free, 'Firemaking', fire).status, 'available');
  assert(names(free).has('Ashes'));
  assert.equal(free.access.objects.includes('Magic tree'), false);
  assert.equal(row(free, 'Woodcutting', cut).status, 'blocked');
  for (const label of recipeLabels) {
    assert.equal(row(free, 'Fletching', label).status, 'blocked', label);
    assert(membership(row(free, 'Fletching', label)).length, label);
    assert.equal(names(free).has(reference.challenges.Fletching[label].Output), false, label);
  }
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert(unrestricted.access.objects.includes('Magic tree'));
  assert.equal(row(unrestricted, 'Woodcutting', cut).status, 'available');
  for (const label of recipeLabels) {
    assert.equal(row(unrestricted, 'Fletching', label).status, 'available', label);
    assert(unrestricted.items.find(item => item.name === reference.challenges.Fletching[label].Output).sources.some(source => source.taskId === taskId('Fletching', label)), label);
  }
});

test('god staff wield tasks and the Wiki-resolved glory supply respect membership with synthetic level and source access', () => {
  const staves = ['Saradomin staff', 'Guthix staff', 'Zamorak staff'];
  for (const [index, name] of staves.entries()) assert.deepEqual(itemMembership(name).candidateIds, [[2415], [2416], [2417]][index]);
  const glory = itemMembership('Amulet of glory');
  assert.equal(glory.members, true);
  assert.equal(glory.reason, 'pinned-wiki-item-ids');
  assert.deepEqual(glory.resolvedIds, [1704]);
  const gloryLabel = 'Obtain an ~|amulet of glory|~';
  const data = definitions({ Magic: Object.fromEntries(staves.map(name => {
    const label = `Wield a ~|${name}|~`; return [label, structuredClone(reference.challenges.Magic[label])];
  })), Extra: { [gloryLabel]: structuredClone(reference.challenges.Extra[gloryLabel]) } }, {
    chunks: { '1': { Spawn: Object.fromEntries([...staves, 'Amulet of glory'].map(name => [name, 1])) } },
  });
  const engine = createTaskEngine(data, options), saved = state(), before = structuredClone({ data, saved }), free = engine.evaluate(saved, 'a');
  assert.equal(free.items.length, 0);
  for (const name of staves) {
    const task = row(free, 'Magic', `Wield a ~|${name}|~`);
    assert.equal(task.status, 'blocked');
    assert(membership(task).some(blocker => blocker.item === name));
  }
  assert.equal(row(free, 'Extra', gloryLabel).status, 'blocked');
  assert(membership(row(free, 'Extra', gloryLabel)).some(blocker => blocker.item === 'Amulet of glory'));
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  for (const name of staves) assert.equal(row(unrestricted, 'Magic', `Wield a ~|${name}|~`).status, 'available');
  assert.equal(row(unrestricted, 'Extra', gloryLabel).status, 'available');
  assert.deepEqual(names(unrestricted), new Set([...staves, 'Amulet of glory']));
});

test('free acadia firemaking remains available when its incidental rare loot requires membership', () => {
  const label = 'Light a fire using ~|acadia logs|~', record = reference.challenges.Firemaking[label];
  const loot = reference.skillItems.Firemaking[record.Output];
  assert.equal(itemMembership('Acadia logs').members, false);
  assert.deepEqual(Object.keys(loot).sort(), ['Fruit fly in amber', 'Menaphite honey bee']);
  for (const name of Object.keys(loot)) assert.equal(itemMembership(name).members, true);
  const data = definitions({ Firemaking: { [label]: structuredClone(record) } }, {
    chunks: { '1': { Spawn: { 'Acadia logs': 1 } } },
    skillItems: { Firemaking: { [record.Output]: structuredClone(loot) } },
  });
  const engine = createTaskEngine(data, options), saved = state(), before = structuredClone({ data, saved }), free = engine.evaluate(saved, 'a');
  const activity = row(free, 'Firemaking', label);
  assert.equal(activity.status, 'available');
  assert.equal(membership(activity).length, 0);
  assert.equal(free.training.Firemaking.primary, true);
  assert(free.access.objects.includes('Player fire'));
  assert.deepEqual(names(free), new Set(['Acadia logs']));
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert.equal(row(unrestricted, 'Firemaking', label).status, 'available');
  assert(unrestricted.access.objects.includes('Player fire'));
  for (const name of Object.keys(loot)) assert(unrestricted.items.find(item => item.name === name).sources.some(source => source.taskId === taskId('Firemaking', label)));
});

test('free Jacquelyn assignments yield virtual Slayer points while the Vannaka method still requires membership', () => {
  const freeLabel = 'Receive a slayer assignment from ~|Jacquelyn|~', memberLabel = 'Receive a slayer assignment from ~|Vannaka|~';
  const data = definitions({ Slayer: {
    [freeLabel]: structuredClone(reference.challenges.Slayer[freeLabel]),
    [memberLabel]: structuredClone(reference.challenges.Slayer[memberLabel]),
  } }, { chunks: { '1': { NPC: { Jacquelyn: true, Vannaka: true }, Monster: { 'Synthetic combat target': true } } } });
  // The identically named physical token is a real member item; the picker
  // output means the independently reviewed virtual currency, not that token.
  const physical = itemMembership('Slayer points');
  assert.equal(physical.members, true);
  assert.deepEqual(physical.candidateIds, [50250]);
  assert.equal(pickerEntityMembership('Slayer points').members, false);
  assert.equal(pickerEntityMembership('Slayer points').entityKind, 'currency');
  const saved = state();
  const before = structuredClone({ data, saved }), engine = createTaskEngine(data, options), free = engine.evaluate(saved, 'a');
  assert.equal(row(free, 'Slayer', freeLabel).status, 'available');
  assert.equal(membership(row(free, 'Slayer', freeLabel)).length, 0);
  assert.equal(row(free, 'Slayer', memberLabel).status, 'blocked');
  assert(membership(row(free, 'Slayer', memberLabel)).length);
  const points = free.items.find(item => item.name === 'Slayer points');
  assert(points);
  assert(points.sources.some(source => source.taskId === taskId('Slayer', freeLabel)));
  assert.equal(points.sources.some(source => source.taskId === taskId('Slayer', memberLabel)), false);
  assert.deepEqual({ data, saved }, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = engine.evaluate(saved, 'a');
  assert.equal(row(unrestricted, 'Slayer', freeLabel).status, 'available');
  assert.equal(row(unrestricted, 'Slayer', memberLabel).status, 'available');
  assert.deepEqual(new Set(unrestricted.items.find(item => item.name === 'Slayer points').sources.map(source => source.taskId)),
    new Set([taskId('Slayer', freeLabel), taskId('Slayer', memberLabel)]));
});
