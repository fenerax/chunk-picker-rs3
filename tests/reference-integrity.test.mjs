import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { prepareTaskDefinitions, createDefinitionPipeline } from '../app/dataset-pipeline.mjs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { buildAccessIndex, calculateAccess, collectBaseItemSources } from '../app/tasks/access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { bossGates } from '../app/data/boss-gates.mjs';
import { closedBossMonsters, evaluateBossGates } from '../app/tasks/boss-gates.mjs';
import overlay from '../app/data/reference-corrections.2026-10-31.v1.mjs';
import { duplicateAliasChildren, referenceIssues, referenceNamespaces } from '../scripts/lib/reference-integrity.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const raw = read('../rs3-chunkpicker-chunkinfo-export.json');
const prepared = prepareTaskDefinitions(raw, selectedDataset);
const data = applyDefinitionOverlays(prepared, [overlay]);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = (root, path) => path.reduce((value, part) => value?.[part], root);
const index = buildAccessIndex(data, { dataset: selectedDataset });
const runtimeObjects = [];
for (const catalogue of [index.world.cacheResources, index.world.cacheArchaeology].filter(Boolean))
  for (const groups of catalogue.byComponent.values()) for (const record of groups.values()) runtimeObjects.push(...record.names);
const namespaces = referenceNamespaces(data, { runtimeObjects });

test('selected server and serialized worker preparation include the core-owned reference overlay', () => {
  const pipeline = createDefinitionPipeline();
  const server = pipeline.prepareServerDefinitions(raw, selectedDataset);
  const worker = pipeline.prepareWorkerDefinitions(structuredClone(server), selectedDataset, pipeline.preparedDefinitionStages(server));
  for (const patch of overlay.patches) {
    const expected = patch.afterPresent ? patch.after : undefined;
    assert.deepEqual(at(prepared, patch.path), expected);
    assert.deepEqual(at(server, patch.path), expected);
    assert.deepEqual(at(worker, patch.path), expected);
  }
});

test('all guarded reference patches apply atomically, preserve task IDs and reject input drift', () => {
  const beforeHash = hash(raw);
  const after = applyDefinitionOverlays(raw, [overlay]);
  for (const patch of overlay.patches) {
    assert.deepEqual(at(after, patch.path), patch.afterPresent ? patch.after : undefined, patch.path.join('/'));
    if (patch.path[0] === 'challenges') {
      const [, category, label] = patch.path;
      assert.equal(permanentTaskId(category, label, after.challenges[category][label]), permanentTaskId(category, label, raw.challenges[category][label]));
    }
    const drift = {};
    let parent = drift;
    for (const part of patch.path.slice(0,-1)) parent = parent[part] = {};
    parent[patch.path.at(-1)] = { unexpected: 'drift' };
    assert.throws(() => applyDefinitionOverlays(drift, [{ ...overlay, patches: [patch] }]), /drift/);
  }
  assert.equal(hash(raw), beforeHash);
  assert.equal(applyDefinitionOverlays(after, [overlay]), after);
  for (const category of Object.keys(raw.challenges)) assert.deepEqual(Object.keys(after.challenges[category]), Object.keys(raw.challenges[category]));
});

test('every corrected ordinary selector names an exact existing source or output', () => {
  for (const patch of overlay.patches.filter(patch => patch.replacements)) for (const { from, to } of patch.replacements) {
    assert.equal(namespaces[patch.path.at(-1)].has(to), true, `${from} -> ${to}`);
    assert.equal([at(data, patch.path)].flat().some(token => token.replaceAll('*','') === from), false);
    assert.equal([at(data, patch.path)].flat().some(token => token.replaceAll('*','') === to), true);
  }
});

test('Lumbridge cooking range requires the correct Cook\'s Assistant quest and stays closed without it', () => {
  const fixture = { chunks: { '12850': { Sections: { '1': { Object: { 'Cooking range': 1 } } } } },
    taskUnlocks: { Objects: { 'Cooking range': { '12850-1': data.taskUnlocks.Objects['Cooking range']['12850-1'] } } } };
  const accessIndex = buildAccessIndex(fixture, { cacheWalking: false, cacheResources: false, cacheArchaeology: false });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'a', unlocked: ['12850'] }] };
  const check = tasks => calculateAccess(accessIndex, state, 'a', { validTasks: new Set(tasks) }).objects.has('Cooking range');
  assert.equal(check([]), false);
  assert.equal(check(["Quest\0~|Cooks' Assistant|~ Complete the quest"]), false);
  assert.equal(check(["Quest\0~|Cook's Assistant|~ Complete the quest"]), true);
});

test('five corrected drop tables attach without losing entries and supply their placed monsters', () => {
  for (const patch of overlay.patches.filter(patch => patch.path[0] === 'drops' && !patch.afterPresent)) {
    const name = patch.path[1];
    const target = overlay.patches.find(row => row.path[0] === 'drops' && row.afterPresent && row.beforePresent === false && hash(row.after) === hash(patch.before)).path[1];
    assert.equal(namespaces.Monsters.has(target), true);
    assert.deepEqual(data.drops[target], raw.drops[name]);
    assert.equal(Object.hasOwn(data.drops, name), false);
    const fixture = { chunks: { '100': { Monster: { [target]: 1 } } }, drops: { [target]: data.drops[target] }, codeItems: data.codeItems };
    const accessIndex = buildAccessIndex(fixture, { cacheWalking: false, cacheResources: false, cacheArchaeology: false });
    const access = calculateAccess(accessIndex, { rules: { 'content.f2p': false }, members: [{ id: 'a', unlocked: ['100'] }] }, 'a');
    const supplies = collectBaseItemSources(fixture, access, { rules: { F2P: false } });
    assert.ok([...supplies.sources.values()].flat().some(source => source.source === target), target);
  }
});

test('aliases have unique children and all thirteen champion scrolls resolve', () => {
  assert.deepEqual(duplicateAliasChildren(data), []);
  const scrolls = data.codeItems.itemsPlus['ChampionScrolls[+]'];
  assert.equal(scrolls.length, 13);
  assert.ok(scrolls.includes("Goblin Champion's scroll"));
  assert.ok(scrolls.includes("Aberrant Spectre Champion's scroll"));
  for (const scroll of scrolls) assert.ok(namespaces.Items.has(scroll), scroll);
});

test('Falador helpers match gathering Woodcutting levels while retaining Farming levels', () => {
  for (const [variant, output, expected, farming] of [['Yew','Yew logs',70,60],['Magic','Magic logs',80,75]]) {
    const gathering = data.challenges.Woodcutting[`Cut ~|${output.toLowerCase()}|~`];
    assert.equal(gathering.Output, output);
    assert.equal(gathering.Level, expected);
    const helper = data.challenges.Nonskill[`Hard Falador tasks ~|It Spoiled My View|~ (${variant})*`];
    assert.equal(helper.Skills.Woodcutting, gathering.Level);
    assert.equal(helper.Skills.Farming, farming);
  }
});

test('boss gates cover the actual Black Stone Dragon and all six Legiones', () => {
  const closed = closedBossMonsters(evaluateBossGates());
  for (const monster of ['Black Stone Dragon','Legio Primus','Legio Secundus','Legio Tertius','Legio Quartus','Legio Quintus','Legio Sextus']) {
    assert.ok(namespaces.Monsters.has(monster));
    assert.ok(closed.has(monster), monster);
  }
  // This existing dormant Zuk-wave table has no placement; do not invent one.
  const dormant = new Set(['TzekHaar-Mej Disciple (TzKal-Zuk)']);
  for (const gate of bossGates) for (const monster of gate.monsters) {
    assert.ok(namespaces.Monsters.has(monster) || dormant.has(monster) && Object.hasOwn(data.drops, monster), `${gate.id}: ${monster}`);
  }
});

test('prepared references and source gates resolve or match exact reviewed outstanding exceptions', () => {
  const reviewed = read('./fixtures/reference-exceptions.2026-10-31.v1.json');
  const issues = referenceIssues(data, { runtimeObjects });
  assert.deepEqual(issues, reviewed.exceptions.map(({ reason, ...issue }) => issue));
  assert.ok(reviewed.exceptions.every(issue => typeof issue.reason === 'string' && issue.reason.length > 30));
  for (const kind of ['assignment','assignment-prerequisite','drop-case-join']) assert.deepEqual(issues.filter(issue => issue.kind === kind), [], kind);
});

test('integrity checks detect newly broken names, alias cardinality and assignment links', () => {
  const fixture = { chunks: { '100': { Spawn: { Known: 1 }, Monster: { Target: 1 } } }, challenges: { Extra: {
    Good: { Items: ['Known'] }, Bad: { Items: ['Missing'] }, Count: { Items: ['Repeated[+]x2'] }, Link: { Tasks: { Unknown: 'Quest' } },
  } }, codeItems: { itemsPlus: { 'Repeated[+]': ['Known','Known'] } }, slayerMasterTasks: { Master: { Missing: {} } } };
  const issues = referenceIssues(fixture);
  assert.equal(issues.filter(issue => issue.kind === 'task-selector').length, 2);
  assert.equal(issues.filter(issue => issue.kind === 'task-prerequisite').length, 1);
  assert.equal(issues.filter(issue => issue.kind === 'assignment').length, 1);
  assert.deepEqual(duplicateAliasChildren(fixture), [{ table: 'itemsPlus', name: 'Repeated[+]' }]);
});

// Project the selected, prepared aggregate onto isolated access gates. These
// public declarations exercise real tier membership without unrelated travel.
const hardPrefix = '~|Ardougne Achievements#Hard|~';
const hardParent = hardPrefix + ' Complete the Hard Achievements';
const artillery = hardPrefix + ' Artillery Strike';
const hardDuties = Object.keys(prepared.challenges.Diary[hardParent].Tasks).filter(label => label.startsWith(hardPrefix));
const diaryOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  retainedUnsupportedCorrections: false, divinationTraining: false, skillGuideTasks: false, skillGuideMilestones: false };
function hardFixture() {
  const parent = structuredClone(prepared.challenges.Diary[hardParent]);
  const Diary = { [hardParent]: { ...parent, Chunks: ['100'] } };
  for (const label of Object.keys(parent.Tasks)) Diary[label] = { BaseQuest: parent.BaseQuest,
    Category: ['Show Diary Tasks'], Chunks: ['200'] };
  const definitions = { chunks: { '100': {}, '200': {} }, challenges: { Diary } };
  const ids = Object.fromEntries(Object.entries(Diary).map(([label, record]) => [label, permanentTaskId('Diary', label, record)]));
  const saved = { rules: { 'content.f2p': false }, members: ['a', 'b'].map(id => ({ id, unlocked: ['100'],
    completedTasks: Object.keys(parent.Tasks).filter(label => label !== artillery).map(label => ids[label]),
    taskRules: { Achievement: true, 'Show Diary Tasks': true } })) };
  return { definitions, saved, ids };
}
function checkHard(fixture, available) {
  const before = structuredClone(fixture);
  const result = createTaskEngine(fixture.definitions, diaryOptions).evaluate(fixture.saved, 'a');
  assert.equal(result.tasks.find(row => row.rawLabel === hardParent).status, available ? 'available' : 'blocked');
  const rewards = prepared.challenges.Diary[hardParent].Reward;
  assert.equal(result.items.some(row => rewards.includes(row.name)), available, 'potential reward supply follows the whole tier gate');
  assert.equal(result.tasks.find(row => row.rawLabel === hardParent).personalCompleted, false, 'eligibility does not record a claim or completion');
  assert.deepEqual(fixture, before, 'evaluation preserves personal completion and reward ownership');
  return result;
}

test('Ardougne Hard declares all 17 required same-tier duties and retains every prior prerequisite', () => {
  assert.equal(hardDuties.length, 17);
  assert.ok(hardDuties.includes(artillery));
  assert.deepEqual(prepared.challenges.Diary[hardParent].Tasks,
    { ...raw.challenges.Diary[hardParent].Tasks, [artillery]: 'Diary' });
  assert.deepEqual(hardDuties.toSorted(), Object.entries(prepared.challenges.Diary)
    .filter(([label, record]) => label.startsWith(hardPrefix) && !record.ManualShow).map(([label]) => label).toSorted());
  const evidence = overlay.provenance.ardougneHard;
  assert.equal(evidence.tier.revisionId, 36199598);
  assert.equal(evidence.constituent.revisionId, 37053862);
  assert.equal(evidence.constituent.achievementId, 502);
  assert.ok(Object.keys(prepared.challenges.Diary[artillery].Tasks).some(label => label.includes('Catapult Construction')));
  assert.equal(prepared.challenges.Diary[artillery]['Not F2P'], true);
});

test('blocked Artillery Strike blocks the aggregate and reward under both Any and Complete settings', () => {
  for (const any of [false, true]) for (const complete of [false, true]) {
    const fixture = hardFixture();
    Object.assign(fixture.saved.members[0].taskRules, { 'Show Diary Tasks Any': any, 'Show Diary Tasks Complete': complete });
    const result = checkHard(fixture, false);
    assert.equal(result.tasks.find(row => row.rawLabel === artillery).status, 'blocked');
    fixture.saved.members[0].completedTasks.push(fixture.ids[artillery]);
    checkHard(fixture, true);
  }
});

test('every required constituent and the previous tier independently gate the Hard aggregate reward', () => {
  const fixture = hardFixture();
  fixture.saved.members[0].completedTasks.push(fixture.ids[artillery]);
  checkHard(fixture, true);
  for (const label of Object.keys(prepared.challenges.Diary[hardParent].Tasks)) {
    const blocked = structuredClone(fixture);
    blocked.saved.members[0].completedTasks = blocked.saved.members[0].completedTasks.filter(id => id !== fixture.ids[label]);
    checkHard(blocked, false);
  }
});

test('partner completion and challenge checks do not replace personal Artillery Strike completion', () => {
  for (const scope of ['any', 'all', 'personal']) {
    const fixture = hardFixture();
    fixture.saved.rules['tasks.completion'] = scope;
    fixture.saved.members[1].completedTasks.push(fixture.ids[artillery]);
    fixture.saved.members[0].taskStatus = { [fixture.ids[artillery]]: { challengeCompleted: true } };
    checkHard(fixture, false);
    fixture.saved.members[0].completedTasks.push(fixture.ids[artillery]);
    checkHard(fixture, true);
  }
});

test('all 17 attainable duties admit the aggregate and potential reward without granting a held reward', () => {
  const fixture = hardFixture();
  fixture.saved.members[0].completedTasks = [];
  fixture.saved.members[0].unlocked.push('200');
  const result = checkHard(fixture, true);
  assert.ok(hardDuties.every(label => result.tasks.find(row => row.rawLabel === label).status === 'available'));
  assert.ok(result.tasks.filter(row => hardDuties.includes(row.rawLabel)).every(row => !row.personalCompleted));
});
