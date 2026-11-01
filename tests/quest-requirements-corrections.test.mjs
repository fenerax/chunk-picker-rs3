import test from 'node:test';
import assert from 'node:assert/strict';
import corrections from '../app/data/quest-requirements-corrections.2026-10-31.v1.mjs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { createGroupState } from '../app/core/state.mjs';

// Synthetic source graph: only the reviewed row contracts come from public
// correction metadata. No pack, save, member, rule setting or live map is read.
const baseline = { challenges: { Quest: {}, Nonskill: {} }, codeItems: { tasksPlus: {}, itemsPlus: {}, chunksPlus: {} } };
for (const patch of corrections.patches) if (patch.beforePresent) {
  let parent = baseline;
  for (const key of patch.path.slice(0, -1)) parent = parent[key] ??= {};
  parent[patch.path.at(-1)] = structuredClone(patch.before);
}
const corrected = applyDefinitionOverlays(baseline, [corrections]);
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  retainedTaskCorrections: false, retainedUnsupportedCorrections: false, metadataCorrections: false,
  equipmentCorrections: false, divinationTraining: false, skillGuideTasks: false, skillGuideMilestones: false };
const label = (title, step = '1') => `~|${title}|~ ${step}`;
function fixture(title, step = '1') {
  const key = label(title, step);
  const d = { chunks: { 100: {} }, challenges: { Quest: {}, Nonskill: {} }, codeItems: structuredClone(corrected.codeItems) };
  const install = (name, category) => {
    if (d.challenges[category][name]) return;
    const r = structuredClone(corrected.challenges[category]?.[name] ?? {});
    // Supply and map access are varied explicitly by each test. Preserve all
    // gates under test, including nested recipe items and skill requirements.
    if (category === 'Quest') for (const field of ['Chunks', 'Objects']) delete r[field];
    d.challenges[category][name] = r;
    for (const [dependency, cat] of Object.entries(r.Tasks ?? {})) {
      for (const child of d.codeItems.tasksPlus[dependency] ?? [dependency]) install(child, cat);
    }
  };
  install(key, 'Quest');
  const saved = createGroupState([{ id: 'a', name: 'Fixture', unlocked: ['100'] }]);
  saved.rules['content.f2p'] = false; saved.taskRules = { Boosting: true };
  const row = () => createTaskEngine(d, options).evaluate(saved, 'a').tasks.find(r => r.rawLabel === key);
  const status = expected => assert.equal(row().status, expected, JSON.stringify(row().blockers));
  return { d, saved, row, status };
}
const supply = (f, names) => { f.d.chunks[100].Spawn = Object.fromEntries(names.map(name => [name, 1])); };
const boosts = (f, skills) => { f.d.codeItems.boostItems = Object.fromEntries(skills.map(skill => [skill, { 'Fixture boost': 2 }])); };

test('QFIX1 guards every correction, cites all 18 findings and preserves identities and immutable input', () => {
  const bytes = JSON.stringify(baseline);
  assert.equal(applyDefinitionOverlays(corrected, [corrections]), corrected);
  assert.equal(JSON.stringify(baseline), bytes);
  assert.deepEqual([...new Set(corrections.patches.flatMap(p => p.findings))].sort(), Array.from({ length: 18 }, (_, i) => 'H' + String(i + 1).padStart(2, '0')));
  const ids = new Set();
  for (const patch of corrections.patches) {
    for (const pin of [patch.evidence].flat()) {
      assert.ok(Number.isSafeInteger(pin.revision));
      assert.equal(pin.url, `https://runescape.wiki/w/Special:PermanentLink/${pin.revision}`);
    }
    if (patch.path[0] !== 'challenges') continue;
    const [, category, key] = patch.path;
    if (patch.beforePresent) assert.equal(permanentTaskId(category, key, patch.before), permanentTaskId(category, key, patch.after));
    else { assert.match(patch.after.PickerId, /^rs3:task:qfix1-/); assert.ok(!ids.has(patch.after.PickerId)); ids.add(patch.after.PickerId); }
  }
  const drift = structuredClone(baseline); drift.challenges.Quest[label('Regicide')].Skills.Agility++;
  assert.throws(() => applyDefinitionOverlays(drift, [corrections]), /drift/);
  assert.equal(drift.challenges.Quest[label('Regicide')].Skills.Agility, 57);
});

test('H08-H13 boosts affect only named skills and require both the rule and an available boost source', () => {
  for (const [title, levels, lowered, unboostable] of [
    ['Recipe for Disaster: Freeing King Awowogei', { Cooking: 70, Agility: 48 }, ['Cooking'], ['Agility']],
    ['Recipe for Disaster: Freeing Pirate Pete', { Cooking: 31 }, ['Cooking'], []],
    ['Recipe for Disaster: Freeing Skrach Uglogwee', { Cooking: 41, Firemaking: 20 }, ['Cooking', 'Firemaking'], []],
    ['Regicide', { Agility: 56 }, ['Agility'], []],
    ["Shades of Mort'ton", { Crafting: 20, Herblore: 15, Firemaking: 6 }, ['Firemaking'], ['Crafting', 'Herblore']],
  ]) {
    const f = fixture(title); boosts(f, Object.keys(levels)); supply(f, ['Fixture boost']);
    for (const skill of lowered) {
      f.saved.members[0].passiveLevels = { ...levels, [skill]: levels[skill] - 1 };
      f.status('available');
      f.saved.taskRules.Boosting = false; f.status('blocked'); f.saved.taskRules.Boosting = true;
      supply(f, []); f.status('blocked'); supply(f, ['Fixture boost']);
      f.saved.members[0].passiveLevels[skill] = levels[skill] - 3; f.status('blocked');
    }
    for (const skill of unboostable) {
      f.saved.members[0].passiveLevels = { ...levels, [skill]: levels[skill] - 1 }; f.status('blocked');
    }
  }
});

test('H04-H05 Cold War permits boosted Thieving OR Zanaris access while other skills remain unboostable', () => {
  const f = fixture('Cold War'), levels = { Hunter: 10, Construction: 34, Crafting: 30, Agility: 30, Thieving: 14 };
  const route = corrections.patches.find(p => p.path[1] === 'Nonskill' && p.after.Chunks?.includes('Zanaris')).path.at(-1);
  f.d.challenges.Nonskill[route].Chunks = ['101']; f.d.chunks[101] = {};
  boosts(f, Object.keys(levels)); supply(f, ['Fixture boost']); f.saved.members[0].passiveLevels = levels;
  f.status('available');
  f.saved.taskRules.Boosting = false; f.status('blocked');
  f.saved.members[0].unlocked.push('101'); f.saved.members[0].passiveLevels.Thieving = 1; f.status('available');
  f.saved.members[0].unlocked = ['100']; f.status('blocked');
  f.saved.taskRules.Boosting = true; f.saved.members[0].passiveLevels.Thieving = 15;
  for (const skill of ['Hunter', 'Construction', 'Crafting', 'Agility']) {
    f.saved.members[0].passiveLevels = { ...levels, Thieving: 15, [skill]: levels[skill] - 1 }; f.status('blocked');
  }
});

test('H02 barehanded tuna accepts Strength 35 with Fishing 55 and rejects either below its threshold', () => {
  const f = fixture('Barbarian Training', '2b4a1'); f.saved.taskRules.Boosting = false;
  f.saved.members[0].passiveLevels = { Strength: 35, Fishing: 55 }; f.status('available');
  f.saved.members[0].passiveLevels.Strength = 34; f.status('blocked');
  f.saved.members[0].passiveLevels = { Strength: 35, Fishing: 54 }; f.status('blocked');
});

test('H03 both smithing steps accept each complete metal recipe and reject mismatched bars, logs and levels', () => {
  const recipes = [['Bronze', 'Logs', 5], ['Iron', 'Oak logs', 10], ['Steel', 'Willow logs', 20], ['Mithril', 'Maple logs', 30], ['Adamant', 'Yew logs', 40], ['Rune', 'Magic logs', 50]];
  for (const step of ['2b4a4', '2b4a6']) {
    const f = fixture('Barbarian Training', step); f.saved.taskRules.Boosting = false;
    for (const [metal, logs, level] of recipes) {
      supply(f, [`${metal} bar`, logs]); f.saved.members[0].passiveLevels = { Smithing: level }; f.status('available');
      f.saved.members[0].passiveLevels.Smithing--; f.status('blocked');
      f.saved.members[0].passiveLevels.Smithing = 99;
      supply(f, [`${metal} bar`, logs === 'Logs' ? 'Oak logs' : 'Logs']); f.status('blocked');
      supply(f, [logs]); f.status('blocked'); supply(f, [`${metal} bar`]); f.status('blocked');
    }
  }
});

test('H01 requires a separate mogre/flippers gate alongside either urn route; only Slayer can be boosted', () => {
  const f = fixture("Kili's Knowledge", 'III');
  // Either synthetic urn route is reachable; the flippers gate must still hold.
  f.d.codeItems.tasksPlus['SoulUrnIII[+]'] = ['Fixture urn A', 'Fixture urn B'];
  f.d.challenges.Nonskill['Fixture urn A'] = {};
  f.d.challenges.Nonskill['Fixture urn B'] = { ManualChecks: ['Fixture unavailable'] };
  boosts(f, ['Slayer', 'Necromancy']);
  const items = ['Apple pie', 'Fishing explosive', "Necromancer's flippers", 'Fixture boost'];
  supply(f, items); f.d.chunks[100].Monster = { Mogre: 1 };
  f.saved.members[0].passiveLevels = { Slayer: 31, Necromancy: 50 }; f.status('available');
  f.saved.taskRules.Boosting = false; f.status('blocked');
  f.saved.taskRules.Boosting = true; f.saved.members[0].passiveLevels.Slayer = 26; f.status('blocked');
  f.saved.members[0].passiveLevels = { Slayer: 32, Necromancy: 49 }; f.status('blocked');
  f.saved.members[0].passiveLevels.Necromancy = 50;
  supply(f, items.filter(i => i !== "Necromancer's flippers")); f.status('blocked');
  supply(f, items); f.d.chunks[100].Monster = {}; f.status('blocked');
  f.d.chunks[100].Monster = { Mogre: 1 };
  f.d.challenges.Nonskill['Fixture urn A'] = { ManualChecks: ['Fixture unavailable'] };
  f.d.challenges.Nonskill['Fixture urn B'] = {}; f.status('available');
  f.d.challenges.Nonskill['Fixture urn B'] = { ManualChecks: ['Fixture unavailable'] }; f.status('blocked');
});

test('H06 cod and both ring variants are independent alternatives; H07 removes the personal Cooking gate', () => {
  const f = fixture('Cold War', '10');
  for (const item of ['Raw cod', 'Ring of charos', 'Ring of charos (a)']) { supply(f, [item]); f.status('available'); }
  supply(f, []); f.status('blocked');
  const dave = fixture('Recipe for Disaster: Freeing Evil Dave'); dave.saved.members[0].passiveLevels = { Cooking: 1 }; dave.status('available');
});

test('H14-H16 and H18 exact aliases keep cardinality and join synthetic sources', () => {
  for (const [alias, replacement, removed] of [['Zarosian Artefact[+]', 'Ceremonial mace', 'Cermonial mace'],
    ['Granite[+]', 'Granite (5kg)', 'Grantie (5kg)'], ['BigChompy8[+]', 'Raw potato', 'Potato']]) {
    const choices = corrected.codeItems.itemsPlus[alias];
    assert.ok(choices.includes(replacement)); assert.ok(!choices.includes(removed));
    assert.equal(choices.length, baseline.codeItems.itemsPlus[alias].length);
    const f = fixture('Cold War', '10');
    f.d.challenges.Quest[label('Cold War', '10')].Items = [alias === 'BigChompy8[+]' ? alias + 'x3' : alias];
    supply(f, alias === 'BigChompy8[+]' ? [replacement, 'Onion', 'Cabbage'] : [replacement]); f.status('available');
    supply(f, alias === 'BigChompy8[+]' ? [removed, 'Onion', 'Cabbage'] : [removed]); f.status('blocked');
  }
  const choices = corrected.codeItems.chunksPlus['PrayerAltarChunks[+]'];
  assert.ok(choices.includes('Nature grotto')); assert.ok(!choices.includes('Nature Grotto'));
  assert.equal(choices.length, baseline.codeItems.chunksPlus['PrayerAltarChunks[+]'].length);
  const f = fixture('Cold War', '10');
  f.d.challenges.Quest[label('Cold War', '10')].Items = [];
  f.d.challenges.Quest[label('Cold War', '10')].Chunks = ['PrayerAltarChunks[+]x4'];
  f.d.chunks[100].Connect = { 'Nature grotto': true };
  f.d.chunks['Nature grotto'] = {};
  const others = choices.filter(c => /^\d+$/.test(c)).slice(0, 3);
  for (const key of others) f.d.chunks[key] = {};
  f.saved.members[0].unlocked.push(...others); f.status('available');
  f.d.chunks[100].Connect = {}; f.status('blocked');
});

test('H17 only removes the ordinary black helm; granite and the two disguise pieces remain required', () => {
  const f = fixture("King's Ransom", '6'); f.saved.members[0].passiveLevels = { Magic: 45 };
  const items = ['Granite (5kg)', 'Bronze med helm', 'Iron chainbody']; supply(f, items); f.status('available');
  for (const removed of items) { supply(f, items.filter(i => i !== removed)); f.status('blocked'); }
});
