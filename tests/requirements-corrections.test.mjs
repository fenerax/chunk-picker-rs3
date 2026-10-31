import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import corrections from '../app/data/requirements-corrections.2026-10-31.v1.mjs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { selectedDefinitionOverlays } from '../app/data/selected-definition-overlays.mjs';
import { createDefinitionPipeline, prepareTaskDefinitions, prepareServerDefinitions, prepareWorkerDefinitions, preparedDefinitionStages } from '../app/dataset-pipeline.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { findDuplicateJsonKeys } from '../scripts/lib/json-duplicates.mjs';
import { collectBaseItemSources } from '../app/tasks/access.mjs';

const bytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8');
const raw = JSON.parse(bytes);
const baseline = createDefinitionPipeline({ overlays: selectedDefinitionOverlays.filter(row => row.id !== corrections.id) })
  .prepareTaskDefinitions(raw, selectedDataset);
const corrected = applyDefinitionOverlays(baseline, [corrections]);
const findLabel = (category, text) => {
  const hits = Object.keys(corrected.challenges[category]).filter(label => label.includes(text));
  assert.equal(hits.length, 1, text);
  return hits[0];
};
const record = (category, text) => corrected.challenges[category][findLabel(category, text)];
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  retainedTaskCorrections: false, retainedUnsupportedCorrections: false, metadataCorrections: false,
  equipmentCorrections: false, divinationTraining: false, skillGuideTasks: false, skillGuideMilestones: false };
const state = (levels = {}) => ({ rules: { 'content.f2p': false, Minigame: true, 'Group Content': true },
  members: [{ id: 'a', unlocked: ['100'], completedTasks: [], passiveLevels: levels }] });
const evaluate = (definitions, saved) => createTaskEngine(definitions, options).evaluate(saved, 'a');
const taskRow = (result, label) => result.tasks.find(row => row.rawLabel === label);
const simple = () => ({ chunks: { 100: {} }, challenges: { Extra: {}, Nonskill: {}, Farming: {}, Necromancy: {}, Quest: {} },
  codeItems: { tasksPlus: {} }, shopItems: {}, taskUnlocks: { Shops: {} } });
function install(d, category, label, replacement = {}) {
  d.challenges[category][label] = { ...structuredClone(corrected.challenges[category][label]), ...replacement };
}
const checkStatus = (d, saved, label, expected) => {
  const row = taskRow(evaluate(d, saved), label);
  assert.equal(row.status, expected, JSON.stringify(row.blockers));
};

test('the archival duplicate allowlist pins every path and competing value, not just the total', () => {
  const expected = JSON.parse(readFileSync(new URL('../app/data/requirements-duplicate-baseline.2026-10-31.v1.json', import.meta.url)));
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const signature = text => findDuplicateJsonKeys(text).map(({ path, firstLine, laterLine, before, after }) => ({
    path, firstLine, laterLine, beforeSha256: hash(before), afterSha256: hash(after), identical: JSON.stringify(before) === JSON.stringify(after),
  }));
  assert.deepEqual(signature(bytes), expected.duplicates);
  assert.equal(expected.duplicates.length, 111);
  assert.equal(new Set(expected.duplicates.map(row => JSON.stringify(row.path))).size, 97);
  const newCollision = bytes.replace('"challenges": {', '"new collision":1,"new collision":2,"challenges": {');
  assert.notDeepEqual(signature(newCollision), expected.duplicates);
  const lines = bytes.split('\n');
  const index = expected.duplicates[0].firstLine - 1, originalLine = lines[index];
  lines[index] = originalLine.replace('Dungeons of Daemonheim', 'Changed dungeon');
  assert.notEqual(lines[index], originalLine);
  assert.notDeepEqual(signature(lines.join('\n')), expected.duplicates);
});

test('reviewed repairs are atomic, idempotent, immutable and preserve every existing task identity', () => {
  assert.equal(applyDefinitionOverlays(corrected, [corrections]), corrected);
  assert.notEqual(corrected, baseline);
  assert.equal(raw.challenges.Extra[findLabel('Extra', 'outfit piece (blueprint)')].Requirements, undefined);
  for (const patch of corrections.patches.filter(patch => patch.path[0] === 'challenges' && patch.beforePresent)) {
    const [, category, label] = patch.path;
    if (!raw.challenges[category][label]) continue;
    assert.equal(permanentTaskId(category, label, corrected.challenges[category][label]), permanentTaskId(category, label, raw.challenges[category][label]));
  }
  const drift = structuredClone(baseline);
  drift.challenges.Extra[findLabel('Extra', 'outfit piece (blueprint)')].Requirements = { Invention: 99 };
  assert.throws(() => applyDefinitionOverlays(drift, [corrections]), /drift/);
  assert.equal(drift.challenges.Extra[findLabel('Extra', 'outfit piece (blueprint)')].Requirements.Invention, 99);
});

test('server, worker and direct selected preparation all include the same factual overlay', () => {
  const direct = prepareTaskDefinitions(raw, selectedDataset);
  assert.deepEqual(direct.challenges, corrected.challenges);
  const server = prepareServerDefinitions(raw, selectedDataset);
  assert.deepEqual(server.challenges, direct.challenges);
  const transported = structuredClone(server);
  assert.equal(prepareWorkerDefinitions(transported, selectedDataset, preparedDefinitionStages(server)), transported);
  assert.equal(prepareTaskDefinitions(server, selectedDataset), server);
});

test('F5 blueprint purchases require the unboosted shop levels', () => {
  for (const [name, levels] of [['Dungeoneering outfit piece (blueprint)', { Dungeoneering: 80, Invention: 20 }],
    ...['Demon', 'Dragon', 'Undead'].map(name => [name + ' Slayer ability codex blueprint', { Invention: 88 }])]) {
    const label = findLabel('Extra', name), d = simple();
    install(d, 'Extra', label, { Shops: [], Items: [], Category: [] });
    assert.deepEqual(d.challenges.Extra[label].Requirements, levels);
    assert.equal(d.challenges.Extra[label].NoBoost, true);
    checkStatus(d, state(levels), label, 'available');
    for (const skill of Object.keys(levels)) checkStatus(d, state({ ...levels, [skill]: levels[skill] - 1 }), label, 'blocked');
  }
});

test('F7 collector upgrades require their respective base cleaner', () => {
  for (const item of ['Seedicide', 'Herbicide']) {
    const label = findLabel('Extra', 'Upgrade the ~|' + item.toLowerCase()), d = simple();
    install(d, 'Extra', label, { Shops: [], Category: [] });
    checkStatus(d, state(), label, 'blocked');
    d.chunks[100].Spawn = { [item]: 1 };
    checkStatus(d, state(), label, 'available');
    d.chunks[100].Spawn = { [item === 'Seedicide' ? 'Herbicide' : 'Seedicide']: 1 };
    checkStatus(d, state(), label, 'blocked');
  }
});

test('F7 a usable barn needs Farming 49, Construction 60 and one complete building route', () => {
  const label = findLabel('Extra', 'fully upgrade the ~|storm barn'), d = simple();
  install(d, 'Extra', label, { Shops: [], Category: [] });
  d.codeItems.tasksPlus['StormBarnBuildingRoute[+]'] = corrected.codeItems.tasksPlus['StormBarnBuildingRoute[+]'];
  for (const helper of d.codeItems.tasksPlus['StormBarnBuildingRoute[+]']) install(d, 'Nonskill', helper, { Shops: [] });
  for (const items of [['Rune nails', 'Mahogany plank'], ['Large animal pen kit']]) {
    d.chunks[100].Spawn = Object.fromEntries(items.map(item => [item, 1]));
    checkStatus(d, state({ Farming: 49, Construction: 60 }), label, 'available');
    checkStatus(d, state({ Farming: 48, Construction: 60 }), label, 'blocked');
    checkStatus(d, state({ Farming: 49, Construction: 59 }), label, 'blocked');
  }
  for (const items of [[], ['Rune nails'], ['Mahogany plank']]) {
    d.chunks[100].Spawn = Object.fromEntries(items.map(item => [item, 1]));
    checkStatus(d, state({ Farming: 49, Construction: 60 }), label, 'blocked');
  }
});

test('F8 seeds alone cannot earn favour: level 50, Polletix and an eligible herb harvest are needed', () => {
  const d = simple(), label = 'Gain Crux Eqal favor';
  install(d, 'Nonskill', label, { Chunks: ['100'] });
  const harvest = findLabel('Farming', 'Grow a ~|grimy guam|~');
  install(d, 'Farming', harvest);
  d.codeItems.tasksPlus['CruxEqalHerbHarvest[+]'] = corrected.codeItems.tasksPlus['CruxEqalHerbHarvest[+]'];
  d.codeItems.itemsPlus = { 'HerbSeed[+]': ['Guam seed'] };
  d.chunks[100] = { NPC: { Polletix: 1 }, Object: { 'Herb patch': 1 }, Spawn: { 'Guam seed': 1 } };
  checkStatus(d, state({ Farming: 50 }), label, 'available');
  checkStatus(d, state({ Farming: 49 }), label, 'blocked');
  for (const field of ['NPC', 'Object', 'Spawn']) {
    const removed = d.chunks[100][field]; delete d.chunks[100][field];
    checkStatus(d, state({ Farming: 50 }), label, 'blocked'); d.chunks[100][field] = removed;
  }
});

test('F9 the removed Reaper unlock retains its ID and completion without an available obligation', () => {
  const label = findLabel('Extra', 'ability to buy further Reaper'), d = simple();
  install(d, 'Extra', label, { Shops: [], Items: [], Category: [] });
  const id = permanentTaskId('Extra', label, raw.challenges.Extra[label]), saved = state();
  assert.equal(d.challenges.Extra[label].NeverShow, true);
  checkStatus(d, saved, label, 'blocked');
  saved.members[0].completedTasks = [id];
  evaluate(d, saved);
  assert.deepEqual(saved.members[0].completedTasks, [id]);
  assert.equal(permanentTaskId('Extra', label, d.challenges.Extra[label]), id);
});

test('F11 previous tiers use OR, include Spirit Pacts, and upgrades require their specific predecessor', () => {
  const name = 'Spectral Scythe#Cast 2', label = findLabel('Extra', '~|' + name + '|~'), d = simple();
  const actual = record('Extra', '~|' + name + '|~');
  install(d, 'Extra', label, { Chunks: [], Requirements: {}, Category: [] });
  const previous = 'Necromancy talent: Spectral Scythe';
  const tierAlias = 'NecromancyTalentTier4[+]';
  d.codeItems.tasksPlus[tierAlias] = corrected.codeItems.tasksPlus[tierAlias];
  for (const helper of d.codeItems.tasksPlus[tierAlias]) {
    d.challenges.Nonskill[helper] = { ManualChecks: ['Unavailable alternative for this fixture.'] };
  }
  d.challenges.Quest["~|Rune Mythos|~ Complete the quest"] = {};
  checkStatus(d, state(), label, 'blocked');
  // Spirit Pact is a valid previous-tier member, but cannot replace the scythe predecessor.
  d.challenges.Nonskill['Necromancy talent: Spirit Pact I'] = {};
  checkStatus(d, state(), label, 'blocked');
  d.challenges.Nonskill[previous] = {};
  checkStatus(d, state(), label, 'available');
  assert.equal(actual.Tasks[previous], 'Nonskill');
  assert.match(actual.Description, /4,500 souls/);
  assert.match(record('Extra', '~|Conjure Undead Army|~').Description, /35,000 souls/);
  assert.equal(record('Extra', '~|Conjure Undead Army|~').Tasks['NecromancyTalentTier6[+]'], 'Nonskill');
  assert.equal(record('Extra', '~|Spectral Scythe|~').Tasks['~|Rune Mythos|~ Complete the quest'], 'Quest');
});

test('talent and prayer skill prerequisites do not depend on optional Extra display groups', () => {
  const d = simple();
  for (const [label, r] of Object.entries(corrected.challenges.Nonskill)) if (label.startsWith('Necromancy talent: ')) {
    install(d, 'Nonskill', label, { Chunks: [] });
    assert.equal(r.Category, undefined);
    assert.ok(Object.values(r.Tasks).every(category => category === 'Nonskill' || category === 'Quest'));
    assert.ok(r.Requirements.Necromancy >= 2);
  }
  for (const [alias, children] of Object.entries(corrected.codeItems.tasksPlus)) if (alias.startsWith('NecromancyTalentTier')) d.codeItems.tasksPlus[alias] = children;
  for (const title of ['Rune Mythos', 'Tomes of the Warlock', 'The Temple at Senntisten']) d.challenges.Quest[`~|${title}|~ Complete the quest`] = {};
  for (const label of Object.keys(corrected.challenges.Necromancy).filter(label => /Unlock the ~\|Spirit Pact/.test(label))) install(d, 'Necromancy', label, { Chunks: [] });
  const saved = state({ Necromancy: 99 });
  saved.rules['Unlock Abilities'] = false;
  const result = evaluate(d, saved);
  for (const label of Object.keys(d.challenges.Necromancy)) assert.equal(taskRow(result, label).status, 'available');
  assert.deepEqual(Object.keys(d.challenges.Extra), []);

  const prayer = simple(), label = findLabel('Prayer', 'Unlock and use the ~|Sanctity|~');
  prayer.challenges.Prayer = {};
  install(prayer, 'Prayer', label, { Chunks: [] });
  prayer.chunks[100].NPC = { Selene: 1 };
  install(prayer, 'Nonskill', 'Learn the Knight Waves training ground prayers');
  for (const title of ["King's Ransom", 'Necromancy!']) prayer.challenges.Quest[`~|${title}|~ Complete the quest`] = {};
  const prayerState = state({ Prayer: 70, Defence: 70, Necromancy: 60 });
  prayerState.rules['Unlock Prayers'] = false;
  checkStatus(prayer, prayerState, label, 'available');
  prayer.chunks[100].NPC = {};
  checkStatus(prayer, prayerState, label, 'blocked');
});

test('F12 Runespan portal purchase requires Runecrafting 66', () => {
  const label = findLabel('Extra', 'portal redirection'), d = simple();
  install(d, 'Extra', label, { Shops: [], Category: [] });
  checkStatus(d, state({ Runecrafting: 65 }), label, 'blocked');
  checkStatus(d, state({ Runecrafting: 66 }), label, 'available');
});

test('F14 advanced stock cannot leak through basic shop access or partner checkmarks', () => {
  const d = simple(), shop = 'Rewards (Barbarian Assault)';
  d.chunks[100].Shop = { [shop]: true };
  d.shopItems[shop] = { "Attacker's insignia": true, 'Penance trident': true, 'Penance master trident': true };
  d.challenges.Nonskill['Barbarian Assault rewards'] = {};
  for (const [label, r] of Object.entries(corrected.challenges.Nonskill)) if (r.PickerId?.startsWith('rs3:task:requirements-') && /Barbarian|penance master trident/.test(label)) install(d, 'Nonskill', label);
  for (const [selector, gate] of Object.entries(corrected.taskUnlocks.Shops)) if (selector.startsWith(shop + '^')) {
    d.taskUnlocks.Shops[selector] = { 100: Object.values(gate)[0] };
  }
  const saved = state();
  const items = () => new Set(evaluate(d, saved).items.map(row => row.name));
  assert.equal(items().has("Attacker's insignia"), false);
  assert.equal(items().has('Penance master trident'), true);
  d.shopItems[shop]['Penance trident'] = false;
  assert.equal(items().has('Penance master trident'), false);
  const gate = d.challenges.Nonskill["Purchase Barbarian Assault attacker's insignia"];
  saved.members.push({ id: 'b', unlocked: [], completedTasks: gate.CompletedTasks });
  assert.equal(items().has("Attacker's insignia"), false);
  saved.members[0].completedTasks = [...gate.CompletedTasks];
  assert.equal(items().has("Attacker's insignia"), true);
  for (const id of gate.CompletedTasks) {
    saved.members[0].completedTasks = gate.CompletedTasks.filter(other => id !== other);
    assert.equal(items().has("Attacker's insignia"), false);
  }
});

test('F15 learning prayers requires Selene/Um and Sanctity also requires Knight Waves and Necromancy!', () => {
  for (const name of ['Sanctity', 'Sorrow', 'Ruination']) {
    const label = findLabel('Extra', 'Unlock the ~|' + name + '|~'), r = corrected.challenges.Extra[label];
    assert.deepEqual(r.NPCs, ['Selene']); assert.deepEqual(r.Chunks, ['City of Um']);
    assert.equal(r.Requirements.Prayer, undefined);
    assert.equal(r.Tasks['~|Necromancy!|~ Complete the quest'], 'Quest');
    assert.equal(r.NoBoost, true);
    const d = simple();
    install(d, 'Extra', label, { Chunks: ['100'], Items: [], Category: [] });
    d.chunks[100].NPC = { Selene: 1 };
    for (const [dependency, category] of Object.entries(r.Tasks)) d.challenges[category][dependency] = {};
    const saved = state({ Necromancy: r.Requirements.Necromancy });
    checkStatus(d, saved, label, 'available');
    d.chunks[100].NPC = {};
    checkStatus(d, saved, label, 'blocked');
    d.chunks[100].NPC = { Selene: 1 };
    for (const [dependency, category] of Object.entries(r.Tasks)) {
      d.challenges[category][dependency] = { ManualChecks: ['Fixture: missing learning prerequisite.'] };
      checkStatus(d, saved, label, 'blocked');
      d.challenges[category][dependency] = {};
    }
  }
  const r = record('Extra', 'Unlock the ~|Sanctity|~');
  assert.equal(r.Tasks['Unlock the ~|Knight Waves training ground|~ prayers'], 'Extra');
  assert.equal(r.Tasks['~|Necromancy!|~ Complete the quest'], 'Quest');
});

test('clear duplicate repairs preserve lost quest actions and restore both Guthixian collections', () => {
  const head = record('Quest', '~|Head of the Family (miniquest)|~ 2');
  assert.deepEqual(head.Chunks, ['16154-2', '15389-1']); assert.match(head.Description, /moai.*fish oil/);
  const tuai = record('Quest', "~|Tuai Leit's Own (miniquest)|~ 3");
  assert.ok(tuai.Items.includes('Rumberry') && tuai.Items.includes('Positive energy'));
  assert.ok(tuai.Chunks.includes('14883') && tuai.Chunks.includes('Aminishi Spirit Realm'));
  const museum = record('Nonskill', "collection 'Museum - Guthixian II'");
  const artiefax = record('Nonskill', "collection 'Guthixian II'");
  assert.deepEqual(museum.NPCs, ['Velucia']); assert.equal(museum.Output, undefined);
  assert.deepEqual(artiefax.NPCs, ['Artiefax']);
  assert.equal(record('Nonskill', "collection 'Guthixian I'").Output, "Guardian's tear");
  const children = corrected.codeItems.tasksPlus['AnyCollection[+]'];
  assert.equal(children.length, 78); assert.equal(new Set(children).size, 78);
  assert.ok(children.every(label => Object.hasOwn(corrected.challenges.Nonskill, label)));
});

test('clear duplicate rate and quantity repairs survive production source expansion and cutoffs', () => {
  for (const source of ['Corpse mage', 'Dragith Nurn', 'Skoblin']) for (const item of ['Chargebow', 'Staff of air']) {
    assert.equal(corrected.drops[source][item]['1'], '5/524');
  }
  const access = { bases: new Set(['100']), sections: new Set(), areas: new Set(), shops: new Set(), objects: new Set(),
    monsters: new Set(['Giant mole (Hard Mode)']), spawns: new Map(), locations: new Map([['Monster:Giant mole (Hard Mode)', new Set(['100'])]]) };
  const result = collectBaseItemSources({ drops: { 'Giant mole (Hard Mode)': { Coins: corrected.drops['Giant mole (Hard Mode)'].Coins } } }, access,
    { rules: { 'content.f2p': false }, membershipChecks: { source: () => null, accessSource: () => null } });
  assert.deepEqual(result.sources.get('Coins').map(row => row.quantity), ['17500-22500', '25000-31000']);
  assert.deepEqual(corrected.skillItems.Nonskill['Lucky charm (Dragonkin Laboratory) loot']['Onyx dust'], { '10-15': '11/50', '1-5': '43/100' });
  assert.deepEqual(corrected.codeItems.dropTables['GemDropTable+']['Uncut diamond'], { '1': '2/128', '45-55 (noted)': '1/52428' });
});

test('duplicate elite-dungeon quantities and both gem/rare-table outcomes are retained by the native parser', () => {
  const tables = corrected.codeItems.dropTables;
  assert.equal(Object.keys(tables['TempleOfAminishiCurrencyDropTable+'].Coins).length, 2);
  assert.equal(Object.keys(tables['TempleOfAminishiSuppliesDropTable+']['Huge spiky rune salvage']).length, 5);
  assert.equal(Object.keys(tables['DragonkinLaboratoryCurrencyDropTable+'].Coins).length, 4);
  assert.equal(Object.keys(tables['ShadowReefCurrencyDropTable+'].Coins).length, 4);
  assert.equal(Object.keys(tables['ShadowReefSuppliesDropTable+']['Huge spiky rune salvage']).length, 5);
  assert.equal(tables['DragonkinLaboratoryCurrencyDropTable+'].Coins['500-1500'], '1/4');
  assert.equal(tables['ShadowReefCurrencyDropTable+'].Coins['20000-70000'], '1/100');
  for (const table of ['GemDropTable+', 'RareDropTable+', 'TempleOfAminishiSuppliesDropTable+']) {
    const access = { bases: new Set(['100']), sections: new Set(), areas: new Set(), shops: new Set(), objects: new Set(),
      monsters: new Set(['Fixture monster']), spawns: new Map(), locations: new Map([['Monster:Fixture monster', new Set(['100'])]]) };
    const definitions = { codeItems: { dropTables: { [table]: tables[table] } }, drops: { 'Fixture monster': { [table]: { 1: 'Always' } } } };
    const result = collectBaseItemSources(definitions, access, { rules: { F2P: false },
      membershipChecks: { source: () => null, accessSource: () => null } });
    const item = table === 'GemDropTable+' ? 'Uncut diamond' : table === 'RareDropTable+' ? 'Uncut dragonstone' : 'Huge spiky rune salvage';
    assert.equal(result.sources.get(item).length, table.includes('Supplies') ? 5 : 2);
    assert.equal(result.diagnostics.some(row => row.code === 'unsupported-drop-record'), false);
  }
});

test('duplicate locations and item requirements retain the required conjunctions', () => {
  for (const [category, text] of [['Archaeology', 'Gain access to the ~|Daemonheim Dig Site|~'],
    ['Quest', "~|Three's Company (abridged saga)|~ 1"], ['Quest', "~|Three's Company (unabridged saga)|~ 1"],
    ['Diary', '~|Daemonheim Achievements#Easy|~ Tales of Old'], ['Diary', '~|Daemonheim Achievements#Hard|~ Healing Factor']]) {
    assert.deepEqual(record(category, text).Chunks, ['Dungeons of Daemonheim', '13625-1']);
  }
  for (const name of ['hauyne', 'idocrase']) assert.deepEqual(record('Extra', 'Find ~|' + name + '|~').Items, ['City Quest Item[+]', 'Menaphos journal']);
  assert.equal(record('Extra', 'Obtain the ~|of Daemonheim|~ title').Tasks['Unlock ~|warped floors|~'], 'Dungeoneering');
});
