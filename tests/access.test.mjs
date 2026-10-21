import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAccessIndex, calculateAccess, collectBaseItemSources } from '../app/tasks/access.mjs';

const state = (unlocked = ['100', '200'], extra = {}) => ({ rules: {}, members: [{ id: 'm', unlocked, ...extra }, { id: 'r', unlocked: ['200'] }] });
const definitions = () => ({ chunks: {
  100: { Sections: { 1: { Object: { Tree: 4 }, Spawn: { Knife: 2 } }, 2: { Object: { Furnace: 1 } }, 3: { Object: { Altar: 1 } } } },
  200: { Object: { Oak: 2 } }, 300: { Object: { 'Locked tree': 1 } },
}, sections: { 100: { 1: ['200'], 2: ['100-3'], 3: ['300'] }, 200: { 0: ['300'] } } });

test('F2P source admission respects member regions without excluding the same free spider and egg sources elsewhere', () => {
  const d = { chunks: {
    100: { Monster: { 'Deadly red spider': 1 }, Spawn: { "Red spiders' eggs": 1 }, Connect: { 'Edgeville Dungeon': true } },
    'Edgeville Dungeon': { Monster: { 'Deadly red spider': 1, Thug: 1 }, Spawn: { "Red spiders' eggs": 1 } },
  } };
  const doc = { rules: { 'content.f2p': true }, members: [{ id: 'm', unlocked: ['100'], sourceMapId: 'old' }] };
  doc.legacy = { maps: { old: { chunkinfo: { manualMonsters: { Monsters: { Thug: true } } } } } };
  const index = buildAccessIndex(d), saved = JSON.stringify({ d, doc });
  const free = calculateAccess(index, doc, 'm');
  assert(free.areas.has('Edgeville Dungeon'));
  assert(!free.monsters.has('Thug'));
  assert.deepEqual(free.locations.get('Monster:Deadly red spider'), ['100']);
  assert.deepEqual(free.locations.get("Spawn:Red spiders' eggs"), ['100']);
  assert.equal(free.spawns.get("Red spiders' eggs"), 1);
  assert(free.diagnostics.some(value => value.code === 'members-only-source' && value.source === 'Thug' && value.location === 'Manually Added*'));
  assert.equal(JSON.stringify({ d, doc }), saved);
  const paidDoc = structuredClone(doc);
  paidDoc.rules['content.f2p'] = false;
  const paid = calculateAccess(index, paidDoc, 'm');
  assert(paid.monsters.has('Thug'));
  assert(paid.locations.get('Monster:Deadly red spider').includes('Edgeville Dungeon'));
  assert(paid.locations.get("Spawn:Red spiders' eggs").includes('Edgeville Dungeon'));
});

test('ownership, section entry, and grid frontier are separate', () => {
  const index = buildAccessIndex(definitions());
  assert.equal(calculateAccess(index, state(['100']), 'm').sections.size, 0, 'Partner ownership cannot seed my obligation sections');
  const access = calculateAccess(index, state(), 'm');
  assert.deepEqual([...access.sections], ['100-1']);
  assert(access.objects.has('Tree'));
  assert(access.objects.has('Oak'));
  assert(!access.objects.has('Furnace'));
  assert(!access.objects.has('Altar'));
  assert(!access.objects.has('Locked tree'));
  const all = calculateAccess(index, state(['100', '300']), 'm');
  assert(all.sections.has('100-3'));
  assert(all.sections.has('100-2'));
});

test('base without entry stays unavailable and locked teleport never seeds access', () => {
  const access = calculateAccess(buildAccessIndex(definitions()), { rules: { 'access.shared': false }, members: [{ id: 'm', unlocked: ['100'], teleports: [{ destination: '300', available: true }] }] }, 'm');
  assert.equal(access.sections.size, 0);
  assert.equal(access.objects.size, 0);
  assert(access.diagnostics.some(value => value.code === 'section-entry-required'));
});

test('manual sections seed and block with migrated personal overrides winning legacy', () => {
  const doc = state(['100'], { sourceMapId: 'old', sectionOverrides: { '100-1': false, '100-2': true, '300-1': true } });
  doc.legacy = { maps: { old: { chunkinfo: { manualSections: { 100: { 1: true, 2: false } } } } } };
  const access = calculateAccess(buildAccessIndex(definitions()), doc, 'm');
  assert(!access.sections.has('100-1'));
  assert(access.sections.has('100-2'));
  assert(!access.sections.has('300-1'));
  assert(access.diagnostics.some(value => value.location === '300-1'));
});

test('shared ownership does not borrow other member section overrides', () => {
  const doc = state([], { sectionOverrides: {} });
  doc.members[1] = { id: 'r', unlocked: ['100'], sectionOverrides: { '100-2': true } };
  const index = buildAccessIndex(definitions());
  assert(!calculateAccess(index, doc, 'm').sections.has('100-2'));
  assert(calculateAccess(index, doc, 'r').sections.has('100-2'));
  doc.rules['access.shared'] = false;
  assert.equal(calculateAccess(index, doc, 'm').bases.size, 0);
});

test('named numeric aliases and backward entrances terminate cycles and diagnose missing edges', () => {
  const d = { chunks: { 100: { Object: { Tree: 1 } }, 2: { Name: 'Cave' }, Cave: { Connect: { 100: true, Hall: true, Missing: true }, Object: { Ore: 3 } }, Hall: { Connect: { Cave: true }, NPC: { Guide: 1 } } } };
  const access = calculateAccess(buildAccessIndex(d), state(), 'm');
  assert.deepEqual([...access.areas].sort(), ['Cave', 'Hall']);
  assert(access.objects.has('Ore'));
  assert(access.npcs.has('Guide'));
  assert(access.diagnostics.some(value => value.location === 'Missing'));
  assert.deepEqual(access.locations.get('Object:Ore'), ['Cave']);
});

test('gated entrances fail closed and exact task evidence unlocks them', () => {
  const d = { chunks: { 100: { Connect: { Cave: { Tasks: { 'Open door': 'Nonskill' } }, Vault: { Items: ['Key'] }, No: false } }, Cave: { Connect: { 100: true }, Object: { Ore: 1 } }, Vault: { Object: { Gold: 1 } }, No: {} } };
  const index = buildAccessIndex(d);
  const access = calculateAccess(index, state(), 'm');
  assert(!access.areas.has('Cave'));
  assert(access.possibleAreas.has('Cave'));
  assert.deepEqual(access.entranceSources.get('Cave'), ['100']);
  assert(!access.areas.has('Vault'));
  assert(!access.areas.has('No'));
  assert(access.diagnostics.some(value => value.code === 'unsupported-condition' && value.condition === 'Items'));
  assert(calculateAccess(index, state(), 'm', { validTasks: new Set(['Nonskill\u0000Open door']) }).areas.has('Cave'));
});

test('implicit area task and ConnectsSections respect entry and manual block', () => {
  const d = definitions();
  d.chunks.Cave = { Connect: { 200: true }, Object: { Ore: 1 } };
  d.challenges = { Nonskill: { Cave: { UnlocksArea: true, Tasks: { Quest: 'Quest' } }, Bridge: { ConnectsSections: true, Sections: ['100-1', '100-2'] } } };
  const index = buildAccessIndex(d), tasks = new Set(['Nonskill\u0000Cave', 'Nonskill\u0000Bridge']);
  assert(!calculateAccess(index, state(), 'm').areas.has('Cave'));
  const access = calculateAccess(index, state(), 'm', { validTasks: tasks });
  assert(access.areas.has('Cave'));
  assert(access.sections.has('100-2'));
  assert(!calculateAccess(index, state(['100'], { sectionOverrides: { '100-2': false } }), 'm', { validTasks: tasks }).sections.has('100-2'));
});

test('source conditions preserve independent alternatives and task-added resources', () => {
  const d = { chunks: { 100: { Spawn: { Knife: 2 }, Monster: { Rat: 1 }, Shop: { Store: true } }, 200: { Spawn: { Knife: 3 } } },
    taskUnlocks: { Spawns: { Knife: { 100: [{ Gate: 'Nonskill' }] } }, Monsters: { 'Synthetic ogre': { 100: [{ Gate: 'Nonskill' }] } }, Items: { 'Knife^Rat': [{ Quest: 'Quest' }], 'Sapphire^': [{ Luck: 'Nonskill' }] }, Shops: { 'Store^Synthetic key': { 100: [{ Gate: 'Nonskill' }] } } },
    shopItems: { Store: { Knife: true } }, drops: { Rat: { Knife: { 1: 'Always' }, Table: { 2: '1/4' } }, 'Synthetic ogre': { 'Synthetic club': { 1: 'Always' } } }, codeItems: { dropTables: { Table: { Sapphire: '1/2@3', Nested: '1/2@1' }, Nested: { Coins: 'Always@5', Table: '1/2@1' } } } };
  const index = buildAccessIndex(d), access = calculateAccess(index, state(), 'm');
  assert.equal(access.spawns.get('Knife'), 3);
  assert(!access.monsters.has('Synthetic ogre'));
  const base = collectBaseItemSources(d, access);
  assert(base.items.has('Knife'));
  assert(!base.items.has('Synthetic key'));
  assert(!base.items.has('Sapphire'));
  assert(base.sources.get('Knife').every(reason => reason.source !== 'Rat'));
  assert(base.diagnostics.some(value => value.code === 'drop-table-cycle'));
  const tasks = new Set(['Nonskill\u0000Gate', 'Quest\u0000Quest', 'Nonskill\u0000Luck']);
  const fullAccess = calculateAccess(index, state(), 'm', { validTasks: tasks });
  const full = collectBaseItemSources(d, fullAccess, { validTasks: tasks });
  assert(full.items.has('Synthetic club'));
  assert(full.items.has('Synthetic key'));
  const sapphire = full.sources.get('Sapphire')[0];
  assert.equal(sapphire.quantity, '6');
  assert.equal(sapphire.probability, 1 / 8);
  assert.equal(sapphire.rate, '1/4 × 1/2');
  assert.deepEqual(full.sources.get('Knife').filter(reason => reason.kind === 'spawn').map(reason => reason.quantity).sort(), [2, 3]);
});

test('drop and shop rules filter source kinds without removing another source', () => {
  const d = { chunks: { 100: { Monster: { Boss: 1 }, Spawn: { Gem: 1 }, Shop: { Arcade: true } } }, drops: { Boss: { Gem: { 1: '1/10000' }, Table: { 1: 'Always' } } }, shopItems: { Arcade: { Coin: true } }, codeItems: { bossMonsters: { Boss: true }, minigameShops: { Arcade: true }, dropTables: { Table: { Rune: '1/2@1' } } } };
  const access = calculateAccess(buildAccessIndex(d), state(), 'm');
  const items = collectBaseItemSources(d, access, { rules: { Boss: false, Minigame: false } });
  assert(items.items.has('Gem'));
  assert(!items.items.has('Rune'));
  assert(!items.items.has('Coin'));
  assert.equal(collectBaseItemSources(d, access, { rules: { 'Rare Drop': false } }).sources.get('Gem').length, 1);
});

test('zero legacy drop cutoff includes all known direct and nested rates', () => {
  const d = { chunks: { 100: { Monster: { Rat: 1 } } },
    drops: { Rat: { Gem: { 1: '1/100000' }, Table: { 1: '1/100' }, Boundary: { 1: '1/999999999999999' }, Beyond: { 1: '1/10000000000000000' } } },
    codeItems: { dropTables: { Table: { Shard: '1/10000@1' } } } };
  const access = calculateAccess(buildAccessIndex(d), state(), 'm');
  for (const setting of ['rareDropNum', 'rareDropThreshold']) {
    const result = collectBaseItemSources(d, access, { rules: { 'Rare Drop': false, [setting]: '1/0' } });
    assert(result.items.has('Gem'));
    assert(result.items.has('Shard'));
    assert.equal(result.sources.get('Shard')[0].probability, (1 / 100) * (1 / 10000));
    assert(result.items.has('Boundary'));
    assert(result.items.has('Beyond'));
  }
  const limited = collectBaseItemSources(d, access, { rules: { 'Rare Drop': false, rareDropNum: '1/1000' } });
  assert(!limited.items.has('Gem'));
  assert(!limited.items.has('Shard'));
});

test('object yields use admitted locations and retain item and object gates', () => {
  const d = { chunks: { 100: { Object: { Tree: 1, 'Ore rock': 1 } }, 200: { Object: { Tree: 1 } } },
    objectItems: { Tree: { Logs: { 1: 'Always' } }, 'Ore rock': { Ore: true } },
    taskUnlocks: { Objects: { Tree: { 100: [{ Gate: 'Nonskill' }] } }, Items: { Ore: [{ Mine: 'Mining' }] } } };
  const index = buildAccessIndex(d), access = calculateAccess(index, state(), 'm');
  const items = collectBaseItemSources(d, access);
  assert.deepEqual(items.sources.get('Logs'), [{ kind: 'object', source: 'Tree', location: '200', quantity: '1', rate: 'Always', probability: 1 }]);
  assert(!items.items.has('Ore'));
  const tasks = new Set(['Nonskill\u0000Gate', 'Mining\u0000Mine']);
  const full = collectBaseItemSources(d, calculateAccess(index, state(), 'm', { validTasks: tasks }), { validTasks: tasks });
  assert.deepEqual(full.sources.get('Logs').map(source => source.location).sort(), ['100', '200']);
  assert(full.items.has('Ore'));
});

test('personal source backlogs mask resources, stock, drops, spawns, and manual declarations', () => {
  const d = { chunks: { 100: { Object: { Sawmill: 1, Tree: 1 }, NPC: { Guide: 1 }, Monster: { Rat: 1 }, Shop: { Store: true }, Spawn: { Knife: 2, Logs: 1 } } },
    objectItems: { Tree: { Logs: true } }, shopItems: { Store: { Knife: true, Logs: true } }, drops: { Rat: { Knife: { 1: 'Always' } } },
    taskUnlocks: { Shops: { 'Store^Key': { 100: [] } } } };
  const doc = state(['100'], { sourceMapId: 'qxa' });
  doc.legacy = { maps: { qxa: { chunkinfo: { backloggedSources: { objects: { Sawmill: true, 'Manual-_-20anvil': true }, npcs: { Guide: true }, monsters: { Rat: true }, shops: { Store: true }, items: { Knife: true }, spawns: { Logs: true } }, manualMonsters: { Objects: { 'Manual-_-20anvil': false, 'Manual-_-20forge': false }, NPCs: { 'Manual-_-20guide': true }, Monsters: { 'Manual-_-20rat': true } } } } } };
  const access = calculateAccess(buildAccessIndex(d), doc, 'm');
  for (const [kind, name] of [['objects','Sawmill'],['objects','Manual anvil'],['npcs','Guide'],['monsters','Rat'],['shops','Store']]) assert(!access[kind].has(name));
  assert(access.objects.has('Manual forge')); // false declares a secondary source, not a deletion.
  assert(access.npcs.has('Manual guide'));
  assert(access.monsters.has('Manual rat'));
  const items = collectBaseItemSources(d, access);
  assert(!items.items.has('Knife'));
  assert(!items.items.has('Key'));
  assert(items.items.has('Logs')); // independently available from the unblocked tree.
  assert(items.sources.get('Logs').every(source => source.kind !== 'spawn'));
  // Sharing ownership never borrows the other member's source backlog.
  doc.members[1].unlocked = ['100'];
  assert(calculateAccess(buildAccessIndex(d), doc, 'r').objects.has('Sawmill'));
});

test('one legacy boundary decodes named-area blocks and Firebase section seeds per member', () => {
  const d = { chunks: { 100: { Sections: { 1: { Connect: { 'New Varrock': true }, Object: { Tree: 1 } } } }, 'New Varrock': { Object: { Chest: 1 } }, 'Old New Varrock': { Object: { Statue: 1 } } }, sections: { 100: { 1: [] } } };
  const doc = state(['100'], { sourceMapId: 'old' });
  doc.rules['content.f2p'] = false; // This test isolates legacy decoding from intrinsic area membership.
  doc.legacy = { maps: { old: { chunkinfo: { manualSections: { '*fb*_100': { '*fb*_1': true } }, manualAreas: { 'New-_-20Varrock': false, 'Old-_-20New-_-20Varrock': true } } } } };
  const index = buildAccessIndex(d), access = calculateAccess(index, doc, 'm');
  assert(access.sections.has('100-1'));
  assert(!access.areas.has('New Varrock'));
  assert(!access.objects.has('Chest'));
  assert(access.areas.has('Old New Varrock'));
  assert(access.objects.has('Statue'));
  doc.members[1].unlocked.push('100');
  doc.members[1].sectionOverrides = { '100-1': true };
  const other = calculateAccess(index, doc, 'r');
  assert(other.areas.has('New Varrock'));
  assert(!other.areas.has('Old New Varrock'));
});

test('a source gate with a missing location fails closed instead of silently exposing drops', () => {
  const d = { chunks: { 100: { Monster: { 'Boss (Hard Mode)': 1, Rat: 1 } } }, drops: { 'Boss (Hard Mode)': { Crown: { 1: 'Always' } }, Rat: { Bones: { 1: 'Always' } } }, taskUnlocks: { Monsters: { 'Boss (Hard Mode)': { 'Renamed missing lair': [{ 'Hard Mode Bosses': 'Nonskill' }] } } } };
  const access = calculateAccess(buildAccessIndex(d), state(), 'm', { validTasks: new Set(['Nonskill\u0000Hard Mode Bosses']) });
  assert(!access.monsters.has('Boss (Hard Mode)'));
  assert(access.monsters.has('Rat'));
  assert(access.diagnostics.some(record => record.code === 'missing-source-location'));
  assert(access.diagnostics.some(record => record.code === 'unresolved-source-gate'));
  const items = collectBaseItemSources(d, access);
  assert(!items.items.has('Crown'));
  assert(items.items.has('Bones'));
});

test('an interior whole-base abbreviation cannot seed an unentered section cycle', () => {
  const d = { chunks: { 100: { Sections: { 1: { Object: { Tower: 1 }, Connect: { Cave: true } }, 2: { Object: { Beach: 1 } }, 3: {} } }, Cave: { Connect: { 100: true }, Object: { Altar: 1 } } }, sections: { 100: { 1: ['100-3'], 2: [], 3: ['100-1'] } } };
  const index = buildAccessIndex(d), doc = state(['100'], { sectionOverrides: { '100-2': true } });
  const access = calculateAccess(index, doc, 'm');
  assert.deepEqual([...access.sections], ['100-2']);
  assert(!access.areas.has('Cave'));
  assert(!access.possibleAreas.has('Cave'));
  assert(!access.objects.has('Tower'));
  doc.members[0].sectionOverrides['100-1'] = true;
  const entered = calculateAccess(index, doc, 'm');
  assert(entered.areas.has('Cave'));
  assert(entered.sections.has('100-3'));
  assert.deepEqual(entered.entranceSources.get('Cave'), ['100-1']);
});

test('a reachable travel hub cannot bridge another unentered geographic section', () => {
  const d = { chunks: { 100: { Sections: { 1: { Connect: { 'Rune Essence mine': true }, Object: { Tower: 1 } }, 2: { Object: { Beach: 1 } } } }, 200: { Connect: { 'Rune Essence mine': true } }, 'Rune Essence mine': { Connect: { 100: true, 200: true }, Object: { 'Rune essence': 4 } } }, sections: { 100: { 1: ['300-1'], 2: [] } } };
  const index = buildAccessIndex(d), doc = state(['100', '200'], { sectionOverrides: { '100-2': true } });
  const access = calculateAccess(index, doc, 'm');
  assert(access.areas.has('Rune Essence mine'));
  assert(access.objects.has('Rune essence'));
  assert(!access.sections.has('100-1'));
  assert(!access.objects.has('Tower'));
  doc.members[0].areaOverrides = { 'Rune Essence mine': true };
  assert(!calculateAccess(index, doc, 'm').sections.has('100-1'));
  doc.members[0].sectionOverrides['100-1'] = true;
  assert(calculateAccess(index, doc, 'm').objects.has('Tower'));
});

test('authored source and area overrides beat legacy and remain automatic after migration', () => {
  const d = { chunks: { 100: { Object: { Sawmill: 1 }, Connect: { Cave: true } }, Cave: { Object: { Chest: 1 } } } };
  const doc = state(['100'], { sourceMapId: 'old', sourceBacklogs: { objects: { Sawmill: false } }, areaOverrides: { Cave: true } });
  doc.legacy = { maps: { old: { chunkinfo: { backloggedSources: { objects: { Sawmill: true } }, manualAreas: { Cave: false } } } } };
  const index = buildAccessIndex(d);
  assert(calculateAccess(index, doc, 'm').objects.has('Sawmill'));
  assert(calculateAccess(index, doc, 'm').areas.has('Cave'));
  doc.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'm', sourceMapId: 'old' }] };
  delete doc.members[0].areaOverrides.Cave;
  assert(calculateAccess(index, doc, 'm').areas.has('Cave'));
  doc.members[0].sourceBacklogs.objects.Sawmill = true;
  assert(!calculateAccess(index, doc, 'm').objects.has('Sawmill'));
});

test('resolved area blocks distinguish a reachable entrance from permission to enter', () => {
  const d = { chunks: { 100: { Connect: { 'New Varrock': true } }, 'New Varrock': { Object: { Chest: 1 } } }, challenges: { Nonskill: { 'New Varrock': { UnlocksArea: true, Tasks: { Entry: 'Quest' } } } } };
  const index = buildAccessIndex(d), doc = state(['100'], { sourceMapId: 'old' });
  doc.rules['content.f2p'] = false; // Area overrides are tested independently from F2P admission.
  doc.legacy = { maps: { old: { chunkinfo: { manualAreas: { 'New-_-20Varrock': false } } } } };
  let access = calculateAccess(index, doc, 'm');
  assert(access.possibleAreas.has('New Varrock'));
  assert(access.blockedAreas.has('New Varrock'));
  assert(!access.areas.has('New Varrock'));
  assert(!access.objects.has('Chest'));
  doc.members[0].areaOverrides = { 'New Varrock': true };
  access = calculateAccess(index, doc, 'm');
  assert(!access.blockedAreas.has('New Varrock'));
  assert(access.areas.has('New Varrock'));
  assert(!calculateAccess(index, doc, 'r').blockedAreas.has('New Varrock'));
  doc.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'm', sourceMapId: 'old' }] };
  delete doc.members[0].areaOverrides['New Varrock'];
  access = calculateAccess(index, doc, 'm');
  assert(access.possibleAreas.has('New Varrock'));
  assert(!access.blockedAreas.has('New Varrock')); // automatic does not revive the old false.
  assert(!access.areas.has('New Varrock')); // the task gate still needs independent evidence.
});

test('reference regression uses its named cave and real subsection schema without mutation', () => {
  const d = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(d.chunks['12342']);
  const index = buildAccessIndex(d, { dataset: selectedDataset });
  const doc = state(['12342', '12341', '11574'], { sectionOverrides: { '12342-1': true, '12341-1': true } });
  const access = calculateAccess(index, doc, 'm');
  assert(access.areas.has('Burthorpe Slayer Cave'));
  assert(access.objects.has('Subterranean spring'));
  assert(access.monsters.has('Gelatinous abomination'));
  assert(access.sections.has('12342-2'));
  // Both Barbarian Village sections connect to the same accessible interior.
  assert(access.sections.has('12342-3'));
  doc.members[0].sectionOverrides['12342-3'] = false;
  assert(!calculateAccess(index, doc, 'm').sections.has('12342-3'));
  assert(access.questSteps.get('Druidic Ritual').includes('Burthorpe Slayer Cave'));
  assert.equal(JSON.stringify(d.chunks['12342']), before);
  const items = collectBaseItemSources(d, access);
  assert(items.items.has('Bronze pickaxe'));
  assert(items.items.has('Beer'));
});

test('saved personal and legacy area grants cannot override members-only admission in F2P', () => {
  const d = { chunks: { 100: { Connect: { 'New Varrock': true } }, 'New Varrock': { Object: { 'Synthetic chest': 1 } } } };
  const index = buildAccessIndex(d);
  for (const authored of [false, true]) {
    const doc = state(['100'], { sourceMapId: 'old', ...(authored ? { areaOverrides: { 'New Varrock': true } } : {}) });
    doc.rules['content.f2p'] = true;
    doc.legacy = { maps: { old: { chunkinfo: { manualAreas: { 'New-_-20Varrock': true } } } } };
    const free = calculateAccess(index, doc, 'm');
    assert(!free.areas.has('New Varrock'));
    assert(!free.objects.has('Synthetic chest'));
    assert(free.diagnostics.some(row => row.code === 'members-only-area' && row.location === 'New Varrock'));
    doc.rules['content.f2p'] = false;
    assert(calculateAccess(index, doc, 'm').areas.has('New Varrock'));
  }
});
