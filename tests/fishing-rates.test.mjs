import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import data from '../app/data/training/fishing-rates.v1.json' with {type: 'json'};
import { FISHING_METHODS, FISHING_BOUNDS, FISHING_SOURCES, FISHING_FORMULA, FISHING_UNMODELLED_METHODS, lookupFishingRate } from '../app/training/fishing-rates.mjs';
import { generateFishingCatalogue } from '../scripts/training/fishing-generate.mjs';
import { wikiFishingReference, genericFishingAlternative } from '../scripts/training/fishing-wiki-reference.mjs';
const rate = args => lookupFishingRate(args, data);
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/fishing/${name}.json`, import.meta.url), 'utf8'));

test('versioned offline catalogue regenerates byte-for-byte and remains compact', async () => {
  assert.deepEqual(generateFishingCatalogue(), data);
  const json = await readFile(new URL('../app/data/training/fishing-rates.v1.json', import.meta.url), 'utf8');
  assert.equal(json, `${JSON.stringify(generateFishingCatalogue())}\n`);
  assert.ok(gzipSync(json).length < 15000);
  assert.deepEqual(data.supportedLevels, FISHING_BOUNDS);
  for (const source of FISHING_SOURCES) assert.ok(source.url.endsWith(`oldid=${source.oldid}`));
});

test('genuine pinned sources establish ordered rolls, formula, cadence and F2P scope', async () => {
  const calculator = await fixture('calculator.37011173'), raw = await fixture('data.37011174');
  assert.ok(calculator.source.includes('math.floor( ( (99-lvl)*lo + (lvl-1)*hi ) / 98 )'));
  assert.ok(calculator.source.includes('(1-rollingChance) *math.max(math.min(rawchance/256, 1), 0)'));
  assert.ok(calculator.source.includes('3600/((u.delay or 4) * 0.6) * newRollingChance'));
  assert.ok(raw.source.indexOf('name = "salmon"') < raw.source.indexOf('name = "trout"'));
  assert.ok(raw.source.indexOf('name = "swordfish"') < raw.source.indexOf('name = "tuna"'));
  const mechanics = (await fixture('mechanics.37195568')).source;
  assert.ok(mechanics.includes('{{Ticks|5|long}} for cavefish, rocktail, lava eel, monkfish, tuna/swordfish spots'));
  assert.ok(mechanics.includes('{{Ticks|4|long}} for all other spots'));
  assert.ok(mechanics.includes('higher level fishing tools do not typically come with increases'));
  // The ordinary fish table lists eleven F2P species; minnow is separately evidenced.
  const f2pRows = [...mechanics.matchAll(/\| \{\{Plinkt\|Raw ([^|}]+)[^\n]*\n\|(\d+)\n\|([\d.]+)\n\|\{\{Members\|no\}\}/g)];
  assert.deepEqual(f2pRows.map(match => match[1]).sort(), ['shrimps', 'crayfish', 'sardine', 'herring', 'anchovies', 'trout', 'pike', 'salmon', 'tuna', 'lobster', 'swordfish'].sort());
  const minnow = (await fixture('minnow.36688690')).source;
  assert.ok(minnow.includes('|members = No'));
  assert.ok(minnow.includes('|bait = No'));
  assert.ok(minnow.includes('|xp = 12'));
  assert.ok((await fixture('rainbow-fish.37019589')).source.includes('|members = Yes'));
  const success = (await fixture('success.37009675')).source;
  assert.ok(success.includes('The value is then scaled up by 10,000'));
  assert.ok(success.includes('2550001'));
  const metadata = await fixture('revision-metadata');
  for (const row of metadata) {
    const snapshot = await fixture(row.file.replace(/\.json$/, ''));
    assert.equal(createHash('sha256').update(snapshot.source).digest('hex'), row.sourceSha256);
    assert.equal(snapshot.oldid, row.oldid);
  }
  assert.equal(calculator.timestamp, '2026-04-15T10:52:36Z');
  assert.equal(raw.timestamp, '2026-04-15T10:58:30Z');
});

test('independent source-derived calculator matches all672 eligible method/level cases and967 species', () => {
  let count = 0, speciesCount = 0, worstXp = 0, worstFish = 0;
  for (const method of FISHING_METHODS) for (let fishingLevel = method.level; fishingLevel <= 99; fishingLevel++) {
    const args = {methodId: method.id, fishingLevel};
    const ours = rate(args), reference = wikiFishingReference(args);
    close(ours.xpPerHour, reference.xpPerHour);
    close(ours.fishPerHour, reference.fishPerHour);
    close(ours.catchChance, reference.catchChance);
    assert.deepEqual(ours.species.map(row => row.id), reference.species.map(row => row.id));
    close(ours.nothingChance + ours.species.reduce((total, row) => total + row.catchChance, 0), 1);
    assert.ok(ours.fishPerHour <= ours.attemptsPerHour);
    for (const [index, row] of ours.species.entries()) {
      for (const field of ['rawChance', 'catchChance', 'fishPerHour', 'xpPerHour']) close(row[field], reference.species[index][field]);
      speciesCount++;
    }
    worstXp = Math.max(worstXp, Math.abs(ours.xpPerHour - reference.xpPerHour));
    worstFish = Math.max(worstFish, Math.abs(ours.fishPerHour - reference.fishPerHour));
    count++;
  }
  assert.equal(count, 672); assert.equal(speciesCount, 967);
  console.log(`Fishing wiki grid ${count} methods/levels, ${speciesCount} catches: max XP/hour delta ${worstXp}; fish/hour ${worstFish}; tolerance1e-10.`);
});

test('generic article denominator difference is measured over the same672 cases', () => {
  let count = 0, maxRelativeXpIncrease = 0, maxFishPerHourIncrease = 0, maxXpPerHourIncrease = 0;
  for (const method of FISHING_METHODS) for (let fishingLevel = method.level; fishingLevel <= 99; fishingLevel++) {
    const args = {methodId: method.id, fishingLevel};
    const pinned = wikiFishingReference(args), alternate = genericFishingAlternative(args);
    assert.ok(alternate.xpPerHour >= pinned.xpPerHour);
    maxRelativeXpIncrease = Math.max(maxRelativeXpIncrease, alternate.xpPerHour / pinned.xpPerHour - 1);
    maxFishPerHourIncrease = Math.max(maxFishPerHourIncrease, alternate.fishPerHour - pinned.fishPerHour);
    maxXpPerHourIncrease = Math.max(maxXpPerHourIncrease, alternate.xpPerHour - pinned.xpPerHour);
    count++;
  }
  const expected = FISHING_FORMULA.alternateComparison;
  assert.equal(count, expected.eligibleCases);
  close(maxRelativeXpIncrease, expected.maxRelativeXpIncrease);
  close(maxFishPerHourIncrease, expected.maxFishPerHourIncrease);
  close(maxXpPerHourIncrease, expected.maxXpPerHourIncrease);
  assert.ok(maxRelativeXpIncrease < .004);
  console.log(`Generic alternative ${count}: max XP +${(maxRelativeXpIncrease * 100).toFixed(7)}%; +${maxFishPerHourIncrease.toFixed(6)} fish/hour; +${maxXpPerHourIncrease.toFixed(6)} XP/hour (separate maxima).`);
});

test('mixed methods skip locked species and unlock the higher fish before the lower conditional roll', () => {
  for (const [methodId, unlock, lower, higher] of [
    ['small-net', 15, 'shrimps', 'anchovies'], ['sea-bait', 10, 'sardine', 'herring'],
    ['fly-fishing', 30, 'trout', 'salmon'], ['harpoon', 50, 'tuna', 'swordfish'],
  ]) {
    const before = rate({methodId, fishingLevel: unlock - 1}), after = rate({methodId, fishingLevel: unlock});
    assert.deepEqual(before.species.map(row => row.id), [lower]);
    assert.deepEqual(after.species.map(row => row.id), [higher, lower]);
    close(after.species[1].catchChance, (1 - after.species[0].rawChance) * after.species[1].rawChance);
    assert.ok(after.species[1].catchChance < after.species[1].rawChance);
    assert.ok(after.fishPerHour < after.species.reduce((sum, row) => sum + row.rawChance * after.attemptsPerHour, 0));
  }
  const net99 = rate({methodId: 'small-net', fishingLevel: 99});
  close(net99.catchChance, 1); close(net99.fishPerHour, 1500); close(net99.xpPerHour, 37500);
  assert.deepEqual(net99.species.map(row => row.fishPerHour), [750, 750]);
  const fly99 = rate({methodId: 'fly-fishing', fishingLevel: 99});
  close(fly99.xpPerHour, 74531.25); close(fly99.fishPerHour, 1265.625);
  assert.deepEqual(fly99.species.map(row => row.fishPerHour), [562.5, 703.125]);
  const harp99 = rate({methodId: 'harpoon', fishingLevel: 99});
  close(harp99.xpPerHour, 42000); close(harp99.fishPerHour, 468.75);
  assert.deepEqual(harp99.species.map(row => row.fishPerHour), [225, 243.75]);
});

test('method cadence and requirements apply to pike, minnow and all other F2P methods', () => {
  assert.equal(FISHING_METHODS.length, 8);
  for (const method of FISHING_METHODS) {
    const result = rate({methodId: method.id, fishingLevel: method.level});
    assert.equal(result.attemptTicks, method.id === 'harpoon' ? 5 : 4);
    assert.equal(result.attemptsPerHour, method.id === 'harpoon' ? 1200 : 1500);
    if (method.level > 1) assert.equal(rate({methodId: method.id, fishingLevel: method.level - 1}), null);
    assert.ok(result.assumptions.some(row => row.includes('Spot relocation timing is unknown')));
  }
  close(rate({methodId: 'minnow', fishingLevel: 1}).xpPerHour, 14062.5);
  close(rate({methodId: 'pike', fishingLevel: 99}).xpPerHour, 33750);
  assert.equal(rate({methodId: 'pike', fishingLevel: 25}).baitItem, 'Fishing bait');
  assert.equal(rate({methodId: 'minnow', fishingLevel: 1}).baitItem, null);
});

test('invalid inputs and corrupted packed rolls fail closed', () => {
  const args = {methodId: 'small-net', fishingLevel: 1};
  for (const invalid of [{fishingLevel: 0}, {fishingLevel: 100}, {fishingLevel: 1.5}, {fishingLevel: '50'},
    {fishingLevel: NaN}, {methodId: 'rainbow-fish'}, {methodId: 'bass'}, {methodId: 'giant-oyster'}]) assert.equal(rate({...args, ...invalid}), null);
  assert.equal(rate(null), null); assert.equal(rate({}), null);
  assert.equal(lookupFishingRate(args, {}), null);
  for (const rolls of [[], [48], [0, 48], [null, NaN], [null, Infinity], [null, -1], [null, 257], [null, .5]]) {
    assert.equal(lookupFishingRate(args, {...data, rates: {'small-net': [rolls]}}), null);
  }
  assert.equal(lookupFishingRate(args, {...data, tickSeconds: 1}), null);
  assert.equal(lookupFishingRate(args, {...data, packing: {denominator: 255}}), null);
});

test('dungeon fish, puzzle catches and monthly Oyster are explicit unknown-rate coverage', async () => {
  assert.equal(FISHING_UNMODELLED_METHODS.length, 8);
  assert.deepEqual(data.unmodelledMethods, FISHING_UNMODELLED_METHODS);
  const dungeon = (await fixture('dungeoneering.37062380')).source;
  assert.ok(dungeon.includes('After 14 chances the fishing spot will become depleted'));
  for (const method of FISHING_UNMODELLED_METHODS) {
    assert.equal(method.rateStatus, 'unknown');
    assert.equal(rate({methodId: method.id, fishingLevel: 99}), null);
    const source = FISHING_SOURCES.find(row => row.id === method.sourceId);
    const snapshot = await fixture(`${method.id === 'giant-oyster' ? 'oyster' : method.id}.${source.oldid}`);
    if (method.location === 'Daemonheim dungeon') {
      assert.ok(snapshot.source.includes('|members = No'));
      assert.ok(snapshot.source.includes(`|xp = ${method.xpPerFish}`));
      assert.equal(method.maxCatchChancesPerSpot, 14); assert.equal(method.respawns, false);
    }
  }
  assert.ok((await fixture('vile-fish.37146803')).source.includes('first three'));
  const cucumber = (await fixture('sea-cucumber.37020394')).source;
  assert.ok(cucumber.includes('|members = No'));
  assert.ok(cucumber.includes('once a month'));
  assert.ok(cucumber.includes('30 times'));
});
