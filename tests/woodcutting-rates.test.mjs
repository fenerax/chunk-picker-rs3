import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import data from '../app/data/training/woodcutting-rates.v1.json' with {type: 'json'};
import { WOODCUTTING_TREES, WOODCUTTING_HATCHETS, WOODCUTTING_BOUNDS, WOODCUTTING_SOURCES, WOODCUTTING_FORMULA, WOODCUTTING_UNMODELLED_TREES, lookupWoodcuttingRate } from '../app/training/woodcutting-rates.mjs';
import { generateWoodcuttingCatalogue } from '../scripts/training/woodcutting-generate.mjs';
import { wikiWoodcuttingReference, genericWoodcuttingAlternative } from '../scripts/training/woodcutting-wiki-reference.mjs';
const rate = args => lookupWoodcuttingRate(args, data);
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/woodcutting/${name}.json`, import.meta.url), 'utf8'));

test('versioned catalogue regenerates byte-for-byte and stays below30KB gzip', async () => {
  assert.deepEqual(generateWoodcuttingCatalogue(), data);
  const json = await readFile(new URL('../app/data/training/woodcutting-rates.v1.json', import.meta.url), 'utf8');
  assert.equal(json, `${JSON.stringify(generateWoodcuttingCatalogue())}\n`);
  assert.ok(gzipSync(json).length < 30000);
  assert.deepEqual(data.supportedLevels, WOODCUTTING_BOUNDS);
  for (const source of WOODCUTTING_SOURCES.filter(row => row.oldid)) assert.ok(source.url.endsWith(`oldid=${source.oldid}`));
});

test('genuine pinned source snapshots establish rounding, timing, F2P scope and aura adjustment', async () => {
  const utils = await fixture('skill-utils.36640342'), calculator = await fixture('calculator.37183488');
  assert.ok(utils.source.includes('local tier_increment = math.floor(chop_chance / 2)'));
  assert.ok(utils.source.includes('math.floor((low*(99-level))/98) + math.floor((high*(level-1))/98)'));
  assert.ok(utils.source.includes('(p.jagex_interpolate(low, high, level) + 1)/(256 * mult)'));
  assert.ok(calculator.source.includes('local delay = 4'));
  assert.ok(calculator.source.includes('math.min(utils.stat_roll(newLo, newHi, level, woodcutting_mult), 1)'));
  const mechanics = await fixture('mechanics.37196294');
  assert.ok(mechanics.source.includes('players can only cut'));
  assert.ok(mechanics.source.includes('{{Ticks|4|long}}'));
  const aura = await fixture('jagex-aura-overhaul.2026-04-13');
  assert.ok(aura.source.includes('folded directly into your hatchets'));
  assert.ok(aura.source.includes('Mithril to Rune: +5%'));
  const normal = await fixture('normal.37201228');
  assert.ok(normal.source.includes('date=20 January 2025'));
  assert.ok(normal.source.includes('more than one log'));
  const metadata = await fixture('revision-metadata');
  const treeRevision = Object.values(metadata.response.query.pages).find(page => page.title === 'Module:SkillUtils/TreeData').revisions[0];
  assert.equal(treeRevision.revid, 36706827);
  assert.equal(treeRevision.timestamp, '2025-04-26T18:08:42Z');
});

test('independent pinned calculator agrees over every eligible tree/hatchet/level1–110', () => {
  let count = 0, worstXp = 0, worstLogs = 0;
  for (const tree of WOODCUTTING_TREES) for (const hatchet of WOODCUTTING_HATCHETS) {
    for (let level = Math.max(tree.level, hatchet.level); level <= 110; level++) {
      const args = {treeId: tree.id, hatchetId: hatchet.id, woodcuttingLevel: level};
      const ours = rate(args), reference = wikiWoodcuttingReference(args);
      close(ours.chopChance, reference.chopChance);
      close(ours.uninterruptedLogsPerHour, reference.logsPerHour);
      close(ours.uninterruptedXpPerHour, reference.xpPerHour);
      close(ours.fellingChance, reference.fellingChance);
      close(ours.logsPerHour, 3600 / (3600 / reference.logsPerHour + reference.fellingChance * tree.respawnSeconds));
      worstXp = Math.max(worstXp, Math.abs(ours.uninterruptedXpPerHour - reference.xpPerHour));
      worstLogs = Math.max(worstLogs, Math.abs(ours.uninterruptedLogsPerHour - reference.logsPerHour));
      count++;
    }
  }
  assert.equal(count, 3503);
  console.log(`Woodcutting wiki grid ${count}: worst uninterrupted XP/hour delta ${worstXp}; logs/hour ${worstLogs}; tolerance1e-10.`);
});

test('generic-article convention difference is measured and recorded over the same3503 cases', () => {
  let count = 0, maxRelativeIncrease = 0, maxLogs = 0, maxXp = 0;
  for (const tree of WOODCUTTING_TREES) for (const hatchet of WOODCUTTING_HATCHETS) {
    for (let level = Math.max(tree.level, hatchet.level); level <= 110; level++) {
      const args = {treeId: tree.id, hatchetId: hatchet.id, woodcuttingLevel: level};
      const reference = wikiWoodcuttingReference(args), alternative = genericWoodcuttingAlternative(args);
      assert.ok(alternative.chopChance >= reference.chopChance);
      maxRelativeIncrease = Math.max(maxRelativeIncrease, alternative.logsPerHour / reference.logsPerHour - 1);
      maxLogs = Math.max(maxLogs, alternative.logsPerHour - reference.logsPerHour);
      maxXp = Math.max(maxXp, alternative.xpPerHour - reference.xpPerHour);
      count++;
    }
  }
  const expected = WOODCUTTING_FORMULA.alternateComparison;
  assert.equal(count, expected.eligibleCases);
  close(maxRelativeIncrease, expected.maxRelativeIncrease);
  close(maxLogs, expected.maxUninterruptedLogsPerHourIncrease);
  close(maxXp, expected.maxUninterruptedXpPerHourIncrease);
  assert.ok(maxRelativeIncrease < .004);
  console.log(`Generic alternative ${count}: max +${(maxRelativeIncrease * 100).toFixed(7)}%; +${maxLogs.toFixed(6)} logs/hour; +${maxXp.toFixed(6)} XP/hour (separate maxima).`);
});

test('acadia75/rune retains the891-log ceiling and includes one-tree renewal downtime', () => {
  const result = rate({treeId: 'acadia', woodcuttingLevel: 75, hatchetId: 'rune'});
  close(result.chopChance, .59417265625);
  close(result.uninterruptedLogsPerHour, 891.258984375);
  close(result.uninterruptedXpPerHour, 71300.71875);
  close(result.downtimePerLogSeconds, 1.65);
  close(result.logsPerHour, 632.7745616707176);
  close(result.xpPerHour, 50621.96493365741);
  close(result.secondsPerLog, 2.4 * result.attemptsPerLog + result.downtimePerLogSeconds);
  assert.equal(result.provisionalDepletion, false);
});

test('felling and documented respawns reduce every one-tree estimate; normal assumptions are explicit', async () => {
  for (const tree of WOODCUTTING_TREES) {
    const result = rate({treeId: tree.id, woodcuttingLevel: 110});
    assert.ok(result.logsPerHour < result.uninterruptedLogsPerHour);
    close(result.xpPerHour / result.logsPerHour, tree.xpPerLog);
    close(result.downtimePerLogSeconds, tree.fellingChance * tree.respawnSeconds);
    const source = WOODCUTTING_SOURCES.find(row => row.id === `woodcutting-${tree.id}`);
    const text = (await fixture(`${tree.id}.${source.oldid}`)).source;
    assert.ok(text.includes(tree.id === 'normal' ? '35.4 - 58.8 seconds' : `${tree.respawnSeconds} seconds`));
  }
  const normal = rate({treeId: 'normal', woodcuttingLevel: 110});
  assert.equal(normal.provisionalDepletion, true);
  close(normal.fellingChance, 96 / 256);
  close(normal.respawnSeconds, (35.4 + 58.8) / 2);
  close(normal.downtimePerLogSeconds, 17.6625);
  assert.deepEqual(normal.respawnRangeSeconds, [35.4, 58.8]);
  assert.ok(normal.assumptions.some(text => text.includes('provisional')));
});

test('F2P hatchets follow their own level requirements and auto chooses best allowed', () => {
  assert.deepEqual(WOODCUTTING_HATCHETS.map(row => [row.id, row.level, row.power]), [
    ['bronze', 1, 100], ['iron', 10, 200], ['steel', 20, 300], ['black', 25, 350],
    ['mithril', 30, 420], ['adamant', 40, 525], ['rune', 50, 630],
  ]);
  for (const [index, hatchet] of WOODCUTTING_HATCHETS.entries()) {
    assert.equal(rate({treeId: 'normal', woodcuttingLevel: hatchet.level}).hatchetId, hatchet.id);
    if (index > 0) {
      assert.equal(rate({treeId: 'normal', woodcuttingLevel: hatchet.level - 1, hatchetId: hatchet.id}), null);
      assert.equal(rate({treeId: 'normal', woodcuttingLevel: hatchet.level - 1}).hatchetId, WOODCUTTING_HATCHETS[index - 1].id);
    }
  }
  assert.equal(rate({treeId: 'normal', woodcuttingLevel: 110}).hatchetId, 'rune');
});

test('levels above99 extrapolate and success is clamped, while invalid inputs fail closed', () => {
  const valid = {treeId: 'normal', woodcuttingLevel: 1, hatchetId: 'bronze'};
  for (const invalid of [{woodcuttingLevel: 0}, {woodcuttingLevel: 111}, {woodcuttingLevel: 1.5}, {woodcuttingLevel: '50'}, {woodcuttingLevel: NaN}, {hatchetId: 'rune'}, {hatchetId: 'dragon'}, {treeId: 'yew'}, {treeId: 'bloodwood'}, {treeId: 'achey'}]) assert.equal(rate({...valid, ...invalid}), null);
  assert.equal(rate(null), null);
  assert.equal(rate({}), null);
  assert.equal(lookupWoodcuttingRate(valid, {}), null);
  for (const bad of [0, -1, NaN, Infinity, 2560001, .5]) assert.equal(lookupWoodcuttingRate(valid, {...data, rates: {normal: {bronze: [bad]}}}), null);
  const cap = rate({treeId: 'normal', woodcuttingLevel: 110, hatchetId: 'rune'});
  assert.equal(cap.chopChance, 1);
  assert.equal(cap.uninterruptedLogsPerHour, 1500);
  assert.ok(rate({treeId: 'yew', woodcuttingLevel: 110}).chopChance > rate({treeId: 'yew', woodcuttingLevel: 99}).chopChance);
});

test('six additional F2P dungeon trees are recorded as unknown rates, not overworld projections', async () => {
  assert.equal(WOODCUTTING_UNMODELLED_TREES.length, 6);
  assert.deepEqual(data.unmodelledTrees, WOODCUTTING_UNMODELLED_TREES);
  const dungeon = (await fixture('dungeoneering.37062295')).source;
  for (const tree of WOODCUTTING_UNMODELLED_TREES) {
    assert.equal(tree.rateStatus, 'unknown');
    assert.equal(tree.respawns, false);
    assert.equal(rate({treeId: tree.id, woodcuttingLevel: 110}), null);
    assert.ok(dungeon.includes(`txt=${tree.label}`));
    const source = WOODCUTTING_SOURCES.find(row => row.id === tree.sourceId);
    const raw = (await fixture(`${tree.id}.${source.oldid}`)).source;
    assert.ok(raw.includes('|members = No'));
    assert.ok(raw.includes('|time = No'));
    assert.ok(raw.includes(`|xp = ${tree.xpPerLog}`));
  }
  assert.ok((await fixture('novite.37144646')).source.includes('cutting power tier of -1'));
  for (const name of ['achey.37135149', 'hollow.37136187', 'bloodwood.37191031']) assert.ok((await fixture(name)).source.includes('|members = Yes'));
});
