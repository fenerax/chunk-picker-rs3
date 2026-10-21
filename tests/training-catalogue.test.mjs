import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from '../app/data/training/methods.f2p.json' with { type: 'json' };
import prices from '../app/data/training/ge-prices.2026-10-08.json' with { type: 'json' };
import definitions from '../rs3-chunkpicker-chunkinfo-export.json' with { type: 'json' };
import resourceSelectors from '../app/data/cache-resource-selectors.2026-10-08.v1.json' with { type: 'json' };
import { FISHING_METHODS, FISHING_SOURCES } from '../app/training/fishing-rules.mjs';

const skillNames = 'Attack Strength Defence Constitution Ranged Prayer Magic Runecrafting Crafting Mining Smithing Fishing Cooking Firemaking Woodcutting Fletching Dungeoneering Agility Herblore Thieving Farming Hunter Slayer Divination Construction Archaeology Summoning Invention Necromancy'.split(' ');
const byId = new Map(catalogue.methods.map(method => [method.id, method]));
const sources = new Map(catalogue.sources.map(source => [source.id, source]));
const priceByItem = new Map(prices.items.map(row => [row.item, row]));

test('catalogue explicitly covers every RS3 skill and honours members-skill F2P caps', () => {
  assert.deepEqual(new Set(catalogue.skills.map(row => row.skill)), new Set(skillNames));
  assert.equal(catalogue.skills.length, 29);
  assert.equal(byId.size, catalogue.methods.length);
  assert.ok(catalogue.methods.length >= 75);
  for (const row of catalogue.skills) {
    assert.equal(row.members, false);
    if (row.skill === 'Invention') {
      assert.equal(row.status, 'unavailable');
      assert.equal(row.f2pCap, 1);
      assert.equal(catalogue.methods.filter(method => method.skill === row.skill).length, 0);
    } else {
      const methods = catalogue.methods.filter(method => method.skill === row.skill);
      assert.ok(methods.length, row.skill);
      for (const method of methods) {
        assert.equal(method.members, false);
        assert.ok(method.level >= 1 && method.level <= method.maxLevel && method.maxLevel <= row.f2pCap, method.id);
      }
    }
    if (['Construction', 'Archaeology', 'Necromancy'].includes(row.skill)) assert.equal(row.f2pCap, 20);
    if (['Agility', 'Herblore', 'Thieving', 'Farming', 'Hunter', 'Slayer', 'Divination', 'Summoning'].includes(row.skill)) assert.equal(row.f2pCap, 5);
  }
});

test('every method and price refers to dated primary sources with truthful nullable facts', () => {
  assert.equal(sources.size, catalogue.sources.length);
  for (const source of catalogue.sources) {
    assert.match(source.retrieved, /^2026-10-(?:0[78]|12|13)$/);
    assert.ok(source.url.startsWith('https://runescape.wiki/') || source.url.startsWith('https://api.weirdgloop.org/') || source.url.startsWith('https://secure.runescape.com/m=news/'));
    assert.ok(!source.url.includes('Pay-to-play') && !source.url.includes('oldschool.'));
    if (source.revision) assert.ok(source.url.endsWith('oldid=' + source.revision));
  }
  for (const method of catalogue.methods) {
    assert.ok(Array.isArray(method.matches), method.id);
    assert.ok(method.sourceIds.length && method.assumptions.length, method.id);
    for (const id of [...method.sourceIds, ...method.economics.sourceIds]) assert.ok(sources.has(id), method.id + ': ' + id);
    assert.ok(method.xpPerAction === null || Number.isFinite(method.xpPerAction) && method.xpPerAction > 0, method.id);
    assert.ok(method.xpPerHour === null || Number.isFinite(method.xpPerHour) && method.xpPerHour > 0, method.id);
    for (const row of [...method.inputs, ...method.outputs]) {
      assert.ok(row.item);
      assert.ok(row.quantity === null || Number.isFinite(row.quantity) && row.quantity > 0, method.id);
    }
    for (const profile of method.rateProfiles ?? []) {
      assert.ok(profile.minLevel >= method.level && profile.minLevel <= method.maxLevel, method.id);
      assert.ok(Number.isFinite(profile.xpPerHour) && profile.xpPerHour > 0);
    }
    if (method.estimateQuality.startsWith('modelled')) assert.match(method.assumptions.join(' '), /80% uptime|0\.8/);
  }
});

test('known net guide economics reconcile to the retained dated API values', () => {
  assert.equal(prices.priceDate, '2026-10-07');
  assert.equal(prices.fetchedAt, '2026-10-08');
  assert.ok(prices.url.startsWith('https://api.weirdgloop.org/exchange/history/rs/latest?name='));
  for (const row of prices.items) {
    if (row.price !== null) {
      assert.ok(Number.isFinite(row.price) && row.price >= 0);
      assert.ok(row.timestamp.startsWith(prices.priceDate));
    }
  }
  for (const method of catalogue.methods.filter(method => Number.isFinite(method.economics.gpPerAction))) {
    const value = row => {
      assert.ok(Number.isFinite(row.quantity), method.id);
      const price = row.item === 'Coins' ? 1 : priceByItem.get(row.item)?.price;
      assert.ok(Number.isFinite(price), method.id + ': ' + row.item);
      return row.quantity * price;
    };
    const expected = method.outputs.reduce((sum, row) => sum + value(row), 0) - method.inputs.reduce((sum, row) => sum + value(row), 0);
    assert.ok(Math.abs(expected - method.economics.gpPerAction) < 1e-8, method.id);
    if (method.inputs.length || method.outputs.length) {
      assert.equal(method.economics.priceDate, prices.priceDate);
      assert.ok(method.economics.sourceIds.includes(prices.sourceId));
    }
  }
  assert.equal(byId.get('crafting.flax').economics.gpPerAction, 551);
  assert.equal(byId.get('crafting.sapphire-necklace').economics.gpPerAction, 815);
  assert.equal(byId.get('summoning.spirit-wolf').economics.gpPerAction, null, 'untradeable gold charms are never priced as free');
});

test('Fishing disposition preserves kept stock without claiming route banking rates', () => {
  for (const id of ['fishing.crayfish', 'fishing.trout']) {
    const power = byId.get(id), banked = byId.get(id + '.bank');
    assert.equal(power.outputDisposition, 'drop');
    assert.deepEqual(power.outputs, []);
    assert.ok(power.economics.gpPerAction <= 0);
    assert.equal(power.xpPerHour, null);
    assert.equal(power.rateProfiles, undefined);
    assert.equal(banked.xpPerHour, null);
    assert.equal(banked.rateProfiles, undefined);
    assert.equal(banked.outputs[0].quantity, 1);
    assert.equal(banked.outputDisposition, 'keep');
    assert.deepEqual(power.fishingCurve, banked.fishingCurve);
    assert.match(banked.label, /keep the catch/);
    assert.match(banked.assumptions.join(' '), /route banking and noting are excluded/);
  }
  for (const method of catalogue.methods.filter(row => row.skill === 'Mining')) {
    assert.equal(method.xpPerAction, null);
    assert.equal(method.outputs[0].quantity, null);
    assert.equal(method.economics.gpPerAction, null);
  }
});

test('every ordinary F2P Fishing method uses sourced level curves and native supply gates', () => {
  const methods = catalogue.methods.filter(method => method.skill === 'Fishing');
  assert.deepEqual(new Set(methods.map(method => method.fishingCurve?.methodId)), new Set(['crayfish', 'small-net', 'sea-bait', 'fly-fishing', 'pike', 'lobster', 'harpoon', 'minnow']));
  for (const method of methods) {
    const curve = FISHING_METHODS.find(row => row.id === method.fishingCurve.methodId);
    assert.ok(curve, method.id);
    assert.ok(method.level >= curve.level);
    assert.ok(method.requirements.some(row => row.kind === 'item' && row.name === curve.toolLabel));
    assert.deepEqual(method.inputs, curve.baitItem ? [{ item: curve.baitItem, quantity: 1 }] : []);
    const eligibleSpecies = curve.species.filter(row => row.level <= method.maxLevel);
    if (method.outputDisposition === 'keep') assert.deepEqual(new Set(method.outputs.map(row => row.item)), new Set(eligibleSpecies.map(row => row.item)));
    if (method.xpPerAction !== null) {
      assert.equal(eligibleSpecies.length, 1, method.id);
      assert.equal(method.xpPerAction, eligibleSpecies[0].xpPerFish);
    }
    assert.equal(method.fishingCurve.catalogue, 'fishing-rates.v1.json');
    assert.equal(method.xpPerHour, null);
    assert.equal(method.rateProfiles, undefined);
    assert.equal(method.estimateQuality, 'wiki-mechanics-estimate');
    assert.ok(method.sourceIds.includes('fishing-rate-calculator'));
    assert.match(method.assumptions.join(' '), /at the spot, no banking/);
    assert.match(method.assumptions.join(' '), /spot moves are not counted/);
    assert.ok(method.requirements.some(row => row.kind === 'object' && row.name.startsWith('Fishing spot')));
    for (const input of method.inputs) {
      assert.equal(input.quantity, 1);
      assert.ok(method.requirements.some(row => row.kind === 'item' && row.name === input.item));
    }
    if (method.outputs.length > 1) {
      assert.equal(method.xpPerAction, null);
      assert.equal(method.economics.gpPerAction, null);
      assert.ok(method.outputs.every(row => row.quantity === null));
    }
  }
  assert.deepEqual(byId.get('fishing.sea-bait').inputs, [{ item: 'Fishing bait', quantity: 1 }]);
  assert.deepEqual(byId.get('fishing.pike').inputs, [{ item: 'Fishing bait', quantity: 1 }]);
  assert.deepEqual(byId.get('fishing.minnow').inputs, []);
  assert.match(byId.get('fishing.minnow').assumptions.join(' '), /native task lists Fishing bait/);
  assert.equal(byId.get('fishing.tuna').level, 35);
  assert.equal(byId.get('fishing.tuna').maxLevel, 49);
  assert.equal(byId.get('fishing.swordfish').level, 50);
  assert.deepEqual(byId.get('fishing.swordfish').outputs.map(row => row.item), ['Raw tuna', 'Raw swordfish']);
  assert.equal(byId.get('fishing.trout').maxLevel, 29);
  assert.equal(byId.get('fishing.fly-mixed').level, 30);
  for (const id of ['fishing-data', 'fishing-rate-calculator', 'fishing-mechanics', 'fishing-minnow']) {
    const pinned = FISHING_SOURCES.find(row => row.id === id);
    assert.equal(sources.get(id).revision, pinned.oldid);
    assert.equal(sources.get(id).url, pinned.url);
  }
});

test('ordinary cooking hourly rates start only at the no-burn level', () => {
  for (const [id, level] of [['cooking.crayfish', 34], ['cooking.trout', 49], ['cooking.lobster', 74]]) {
    const method = byId.get(id);
    assert.equal(method.xpPerHour, null);
    assert.equal(method.rateProfiles[0].minLevel, level);
    assert.equal(method.economics.gpPerAction, null);
  }
});

test('all F2P core Mining rocks use level curves instead of flat guide rates', () => {
  const rocks = ['copper', 'tin', 'iron', 'coal', 'silver', 'mithril', 'adamantite', 'luminite', 'gold', 'runite'];
  assert.deepEqual(new Set(catalogue.methods.filter(method => method.skill === 'Mining').map(method => method.miningCurve?.rockId)), new Set(rocks));
  for (const rock of rocks) {
    const method = byId.get(`mining.${rock}`);
    assert.equal(method.xpPerHour, null);
    assert.equal(method.rateProfiles, undefined);
    assert.equal(method.xpPerAction, null);
    assert.equal(method.economics.gpPerAction, null);
    assert.ok(method.sourceIds.includes('mining-rate-calculator'));
    assert.ok(method.requirements[1].anyOf.some(tool => tool.name === 'Steel pickaxe + 1'));
  }
  assert.equal(byId.get('mining.silver').level, 20);
  assert.equal(byId.get('mining.gold').level, 40);
});

test('all ordinary F2P trees use hatchet-aware curves and retain fixed log XP', () => {
  const trees = ['normal', 'oak', 'willow', 'teak', 'maple', 'acadia', 'yew'];
  assert.deepEqual(new Set(catalogue.methods.filter(method => method.skill === 'Woodcutting').map(method => method.woodcuttingCurve?.treeId)), new Set(trees));
  for (const tree of trees) {
    const method = byId.get(`woodcutting.${tree}`);
    assert.equal(method.xpPerHour, null);
    assert.equal(method.rateProfiles, undefined);
    assert.equal(method.handlingSeconds, undefined);
    assert.ok(method.sourceIds.includes('woodcutting-rate-calculator'));
    assert.ok(method.requirements[1].anyOf.some(tool => tool.name === 'Black hatchet'));
    assert.ok(method.xpPerAction > 0);
    assert.equal(method.outputs[0].quantity, 1);
    assert.match(method.assumptions.join(' '), /at the tree, no banking/);
  }
});

test('timed artisan additions preserve cross-skill and teleport gates', () => {
  for (const skill of ['Smithing', 'Prayer', 'Magic', 'Runecrafting']) assert.ok(catalogue.methods.some(method => method.skill === skill && (method.xpPerHour > 0 || method.rateProfiles?.length)), skill);
  assert.equal(byId.get('smithing.iron-smelt').inputs.find(row => row.item === 'Iron ore').quantity, 2);
  assert.equal(byId.get('prayer.impious-sticks').xpPerHour, 8944);
  assert.equal(byId.get('prayer.accursed-maple-sticks').requiredSkills.Firemaking, 40);
  assert.equal(byId.get('magic.enchant-sapphire-amulet').level, 7);
  assert.equal(byId.get('magic.high-alchemy-rune-platebody').outputs[0].quantity, 2500);
  for (const id of ['runecrafting.air-teleport-cycle', 'runecrafting.body-teleport-cycle']) {
    assert.ok(byId.get(id).requirements.some(row => row.kind === 'unlock' && row.name === "War's Retreat Teleport"));
    assert.equal(byId.get(id).economics.gpPerAction, null, 'charged teleport supply is not free');
  }
});

test('facilities use native engine selectors and tutorials/assignment remain explicit gates', () => {
  const declaredObjects = new Set(Object.values(definitions.challenges).flatMap(group => Object.values(group).flatMap(row => row.Objects ?? [])));
  for (const location of resourceSelectors.retainedLocations) for (const [name] of location.objects ?? []) declaredObjects.add(name);
  function check(requirement) {
    if (requirement.anyOf) { assert.ok(requirement.anyOf.length > 1); requirement.anyOf.forEach(check); return; }
    assert.ok(['object', 'item', 'npc', 'monster', 'chunk', 'quest', 'task', 'assignment', 'skill', 'unlock'].includes(requirement.kind));
    assert.ok(requirement.name ?? requirement.id);
    if (requirement.kind === 'object') assert.ok(declaredObjects.has(requirement.name) || definitions.codeItems.objectsPlus[requirement.name], requirement.name);
    if (requirement.kind === 'task') assert.ok(definitions.challenges[requirement.category][requirement.name]);
  }
  catalogue.methods.forEach(method => method.requirements.forEach(check));
  assert.ok(byId.get('archaeology.venator-dagger').requirements.some(row => row.kind === 'task'));
  assert.ok(byId.get('necromancy.lesser-necroplasm').requirements.some(row => row.kind === 'quest' && row.name === 'Necromancy!'));
  assert.ok(byId.get('slayer.cow-assignment').requirements.some(row => row.kind === 'assignment'));
  assert.ok(byId.get('woodcutting.oak').requirements.some(row => row.anyOf?.some(tool => tool.name === 'Rune hatchet')));
});

test('legacy log-action IDs, recipe facts and task matching remain compatible', () => {
  assert.equal(byId.get('woodcutting.normal').xpPerAction, 25);
  assert.equal(byId.get('woodcutting.oak').woodcuttingCurve.treeId, 'oak');
  assert.equal(byId.get('woodcutting.willow').rateProfiles, undefined);
  assert.deepEqual(byId.get('firemaking.oak.bonfire').matches, ['Add ~|oak logs|~ to a bonfire']);
  assert.equal(byId.get('firemaking.oak.bonfire').processingSeconds, 4.2);
  assert.equal(byId.get('firemaking.willow.fire').processingSeconds, null);
  assert.equal(byId.get('fletching.oak.longbow').xpPerAction, 14.7);
  assert.equal(byId.get('fletching.oak.longbow').input, 'Oak logs');
  assert.equal(byId.get('fletching.oak.shafts').outputs[0].quantity, 20);
});
