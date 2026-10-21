import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyRetainedUnsupportedCorrections, retainedUnsupportedCorrections as bundle } from '../app/data/retained-unsupported-corrections.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const bytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)), raw = JSON.parse(bytes);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const options = { retainedUnsupportedCorrections: true, retainedTaskCorrections: true, metadataCorrections: true, equipmentCorrections: true, cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false };
const auditRow = suffix => bundle.audit.rows.find(row => row.id === `rs3:task:${suffix}`);
const target = suffix => { const row = auditRow(suffix); return raw.challenges[row.skill][row.rawLabel]; };
const state = (f2p = true) => ({ rules: { 'content.f2p': f2p }, taskRules: { 'Multi Step Processing': true }, members: [{ id: 'a', unlocked: ['100'], completedTasks: [], passiveLevels: { Runecrafting: 50, Smithing: 99, Divination: 92 } }] });
function fixture(suffixes, spawns = []) {
  const challenges = {};
  for (const suffix of suffixes) { const row = auditRow(suffix); (challenges[row.skill] ??= {})[row.rawLabel] = target(suffix); }
  return { codeItems: raw.codeItems, challenges, chunks: { 100: { Spawn: Object.fromEntries(spawns.map(name => [name, 1])), Object: { 'Dragonkin anvil': 1 } } } };
}

test('H4 records all 34 exact hidden unsupported identities with dated public evidence', () => {
  assert.equal(bundle.provenance.referenceSha256, sha256RepositoryText(bytes));
  assert.equal(bundle.provenance.generatorSha256, sha256RepositoryText(readFileSync(new URL(`../${bundle.provenance.generator}`, import.meta.url))));
  assert.equal(bundle.audit.rows.length, 34);
  assert.equal(new Set(bundle.audit.rows.map(row => row.id)).size, 34);
  assert.equal(bundle.audit.supportedRows, 18); assert.equal(bundle.audit.keptHiddenRows, 16);
  assert.equal(bundle.audit.f2pRows, 1); assert.equal(bundle.audit.outputVarRows, 0);
  for (const row of bundle.audit.rows) {
    const record = raw.challenges[row.skill][row.rawLabel];
    assert.equal(permanentTaskId(row.skill, row.rawLabel, record), row.id);
    assert.equal(hash(record), row.beforeRecordSha256);
    assert(row.retainedUnsupportedReasons.length && row.reason.length);
    assert(bundle.wiki.some(pin => pin.title === row.wikiTitle));
  }
  for (const pin of bundle.wiki) { assert(Number.isSafeInteger(pin.revisionId)); assert.equal(pin.url, `https://runescape.wiki/w/Special:PermanentLink/${pin.revisionId}`); assert.match(pin.contentSha256, /^[a-f0-9]{64}$/); }
});

test('H4 overlay is immutable, idempotent and keeps all task identities', () => {
  const before = JSON.stringify(raw), after = applyRetainedUnsupportedCorrections(raw, { strict: true });
  for (const row of bundle.audit.rows) {
    const record = after.challenges[row.skill][row.rawLabel];
    assert.equal(permanentTaskId(row.skill, row.rawLabel, record), row.id);
    assert.equal(record['Not F2P'], row.membership === 'members');
  }
  assert.equal(after.challenges.Mining, raw.challenges.Mining);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(applyRetainedUnsupportedCorrections(after, { strict: true }), after);
});

test('H4 rejects custom task/alias drift atomically and leaves unrelated malformed requirements unsupported', () => {
  const correction = bundle.corrections.find(row => row.id === 'rs3:task:0019c5');
  for (const kind of ['task', 'source-alias', 'target-alias']) {
    const custom = structuredClone(raw);
    if (kind === 'task') custom.challenges[correction.category][correction.label].Priority = 999;
    if (kind === 'source-alias') custom.codeItems.itemsPlus['RunecrafterRobe[+]'].push('Custom item');
    if (kind === 'target-alias') custom.codeItems.itemsPlus['OrdinaryRunecrafterRobe[+]'] = ['Custom item'];
    assert.equal(applyRetainedUnsupportedCorrections(custom, { corrections: [correction] }), custom);
    assert.throws(() => applyRetainedUnsupportedCorrections(custom, { corrections: [correction], strict: true }), /drift/);
  }
  const malformed = { chunks: { 100: {} }, challenges: { Crafting: { 'Unreviewed malformed alias': { Items: ['NoSuchGroup[+]'] } } } };
  assert.equal(createTaskEngine(malformed, options).evaluate(state(), 'a').tasks[0].status, 'unsupported');
  assert.throws(() => applyRetainedUnsupportedCorrections(raw, { corrections: [{ ...correction, changes: [{ field: 'NeverShow', after: true }] }] }), /Unsupported/);
});

test('H4 default engine repairs exactly 18 rows and conservatively keeps the other 16 unsupported', () => {
  const saved = state(), before = JSON.stringify(saved);
  const baseline = createTaskEngine(raw, { ...options, retainedUnsupportedCorrections: false }).evaluate(saved, 'a');
  const updated = createTaskEngine(raw, options).evaluate(saved, 'a');
  assert.deepEqual(new Set(baseline.tasks.filter(row => row.status === 'unsupported').map(row => row.id)), new Set(bundle.audit.rows.map(row => row.id)));
  const rows = new Map(updated.tasks.map(row => [row.id, row]));
  for (const audited of bundle.audit.rows) {
    const row = rows.get(audited.id);
    assert.equal(row.status === 'unsupported', audited.decision !== 'support', `${audited.id}: ${row.explanation}`);
    if (audited.membership === 'members') assert(row.blockers.some(blocker => blocker.kind === 'membership'), audited.id);
    if (audited.decision !== 'support') assert(row.hidden, audited.id);
  }
  assert.equal(updated.coverage.unsupportedTasks, 16);
  assert.equal(JSON.stringify(saved), before);
});

test('ordinary cosmetic robes work in F2P while Master robes and missing supplies cannot satisfy the goal', () => {
  const suffix = '0019c5';
  for (const [spawns, expected] of [[['Runecrafter robe (green)'], 'available'], [['Master runecrafter robe'], 'blocked'], [[], 'blocked']]) {
    const data = fixture([suffix], spawns), saved = state(), before = JSON.stringify({ data, saved });
    const result = createTaskEngine(data, options).evaluate(saved, 'a');
    const row = result.tasks.find(row => row.id === auditRow(suffix).id);
    assert.equal(row.status, expected, row.explanation);
    assert(!row.blockers.some(blocker => blocker.kind === 'unsupported' || blocker.kind === 'membership'));
    assert.equal(JSON.stringify({ data, saved }), before);
  }
  const saved = state(); saved.members[0].passiveLevels.Runecrafting = 49;
  assert.equal(createTaskEngine(fixture([suffix], ['Runecrafter robe (green)']), options).evaluate(saved, 'a').tasks[0].status, 'blocked');
});

test('chaotic essence admits only melee weapons and never invents output from magic or missing supplies', () => {
  for (const [spawns, expected] of [[['Chaotic longsword'], true], [['Chaotic staff'], false], [[], false]]) {
    const result = createTaskEngine(fixture(['001c0e'], spawns), options).evaluate(state(false), 'a');
    assert.equal(result.items.some(item => item.name === 'Chaotic essence'), expected, JSON.stringify(result.tasks[0].blockers));
  }
  const result = createTaskEngine(fixture(['001c0e'], ['Chaotic longsword']), options).evaluate(state(), 'a');
  assert(!result.items.some(item => item.name === 'Chaotic essence'));
  const custom = fixture(['001c0e'], ['Chaotic staff']);
  custom.codeItems = structuredClone(custom.codeItems);
  custom.codeItems.itemsPlus['ChaoticMeleeWeapon[+]'].push('Chaotic staff');
  const correction = bundle.corrections.find(row => row.id === auditRow('001c0e').id);
  assert.equal(applyRetainedUnsupportedCorrections(custom, { corrections: [correction] }), custom);
  assert.throws(() => applyRetainedUnsupportedCorrections(custom, { corrections: [correction], strict: true }), /drift/);
  const drifted = createTaskEngine(custom, options).evaluate(state(false), 'a');
  assert.equal(drifted.tasks[0].status, 'unsupported');
  assert(!drifted.items.some(item => item.name === 'Chaotic essence'));
});

test('portent recipe needs the documented four-dose input, and F2P cannot receive its output', () => {
  for (const [potion, expected] of [['Prayer potion (4)', true], ['Prayer potion (3)', false]]) {
    const result = createTaskEngine(fixture(['000c84'], ['Luminous energy', potion]), options).evaluate(state(false), 'a');
    assert.equal(result.items.some(item => item.name === 'Portent of item protection'), expected, JSON.stringify(result.tasks[0].blockers));
  }
  const result = createTaskEngine(fixture(['000c84'], ['Luminous energy', 'Prayer potion (4)']), options).evaluate(state(), 'a');
  assert(!result.items.some(item => item.name === 'Portent of item protection'));
});

test('unresolved Bakami hard gates cannot supply jars or training even with accessible Arc supplies and saved completion', () => {
  const suffixes = ['0013b6', '0013b7', '0013b8', '0013b9', '0013ba', '0013bb', '0013bc', '0013bd'];
  const data = fixture(suffixes);
  data.chunks = { 14884: { Spawn: { 'Impling jar': 1 } } };
  const saved = state(false); saved.members[0].unlocked = ['14884']; saved.members[0].passiveLevels.Hunter = 90;
  saved.members[0].completedTasks = suffixes.map(suffix => auditRow(suffix).id);
  const before = JSON.stringify({ data, saved });
  const result = createTaskEngine(data, options).evaluate(saved, 'a');
  assert(result.items.some(item => item.name === 'Impling jar'));
  for (const suffix of suffixes) {
    const row = result.tasks.find(row => row.id === auditRow(suffix).id);
    assert.equal(row.status, 'unsupported'); assert.equal(row.primaryMethod, false); assert.equal(row.personalCompleted, true);
    assert(!result.items.some(item => item.name === target(suffix).Output));
  }
  assert.equal(result.training.Hunter.primary, false);
  assert.equal(JSON.stringify({ data, saved }), before);
  const noObservedLevel = structuredClone(saved); delete noObservedLevel.members[0].passiveLevels.Hunter;
  const completionOnly = createTaskEngine(data, options).evaluate(noObservedLevel, 'a');
  assert.equal(completionOnly.training.Hunter.level, 1);
  assert.equal(completionOnly.training.Hunter.passiveLevel, 1);
  assert.equal(completionOnly.training.Hunter.primary, false);
});

test('a completed unsupported Quest cannot unlock a primary Slayer assignment through personal prerequisites', () => {
  const label = 'Malformed prerequisite', id = permanentTaskId('Quest', label);
  const data = { chunks: { 100: { NPC: { Master: true } } }, codeItems: {}, challenges: {
    Quest: { [label]: { Mystery: true, QuestPoints: 1, XpReward: { Slayer: 10000 }, Output: 'Leaked reward' } },
    Slayer: { Assignment: { Level: 1, Primary: true, NPCs: ['Master'], Tasks: { [label]: 'Quest' } } },
  } };
  const saved = state(false); saved.members[0].completedTasks = [id];
  let result = createTaskEngine(data, options).evaluate(saved, 'a');
  assert.equal(result.tasks.find(row => row.category === 'Quest').personalCompleted, true);
  const assignment = result.tasks.find(row => row.category === 'Slayer');
  assert.equal(assignment.status, 'blocked');
  assert(assignment.blockers.some(blocker => blocker.kind === 'personal-completion'));
  assert.equal(result.training.Slayer.primary, false);
  assert.equal(result.training.Slayer.passiveLevel, 1);
  assert(!result.items.some(item => item.name === 'Leaked reward'));
  delete data.challenges.Quest[label].Mystery;
  result = createTaskEngine(data, options).evaluate(saved, 'a');
  assert.equal(result.tasks.find(row => row.category === 'Slayer').status, 'available');
  assert.equal(result.training.Slayer.primary, true);
});
