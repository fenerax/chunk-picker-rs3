import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import f2p from '../app/data/training/methods.f2p.json' with { type: 'json' };
import catalogue, { divinationMethods } from '../app/data/training/catalogue.mjs';
import { applyDivinationTraining, divinationEvidence as evidence, divinationTierAlias, divinationTierLabel, divinationTierSelectors } from '../app/data/divination-training.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildTrainingAvailability } from '../app/tasks/training-availability.mjs';
import { planTraining, trainingMethodBlockers } from '../app/tasks/training-planner.mjs';
import { personalQuestProgressBlocker } from '../app/tasks/personal-quest-progress.mjs';

const definitions = { chunks: { '1': { NPC: Object.fromEntries(evidence.tiers.map(tier => [tier.name + ' wisp', true])), Object: { 'Colossus remnants': true } } },
  challenges: { Divination: Object.fromEntries(evidence.tiers.map(tier => [divinationTierLabel(tier), { Level: tier.level, Primary: true, NPCs: [tier.name + ' wisp'] }])),
    Quest: { 'Fate of the Gods': { QuestPoints: 2, Chunks: ['1'] }, 'Heralds of Crimson': { QuestPoints: 1, Chunks: ['1'] } } },
  codeItems: {}, sections: {}, walkableChunks: ['1'], walkableChunksF2P: ['1'] };
const methods = new Map(divinationMethods.map(method => [method.id, method]));
const colossi = methods.get('divination.colossi');
const access = extras => ({ members: true, access: { objects: ['Colossus remnants'], npcs: evidence.tiers.flatMap(divinationTierSelectors) }, completedQuests: [], completedTasks: [], ...extras });

test('all 13 retained harvesting tiers keep their original levels and permanent IDs', () => {
  const expected = [1, 10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95];
  assert.deepEqual(evidence.tiers.map(tier => tier.level), expected);
  const patched = applyDivinationTraining(definitions);
  const before = createTaskEngine(definitions, { divinationTraining: false });
  const after = createTaskEngine(definitions, { dataset: selectedDataset, cacheWalking: false, reviewedOverlays: false });
  for (const tier of evidence.tiers) {
    const label = divinationTierLabel(tier);
    assert.equal(definitions.challenges.Divination[label].Level, tier.level);
    assert.equal(patched.challenges.Divination[label].Level, tier.level);
    assert.deepEqual(patched.challenges.Divination[label].NPCs, [divinationTierAlias(tier)]);
    assert.equal(before.catalogue.find(row => row.rawLabel === label).id, after.catalogue.find(row => row.rawLabel === label).id);
  }
});

test('12 enriched tiers and stationary springs extend aliases without granting spawns or enriched pale', () => {
  const patched = applyDivinationTraining(definitions);
  assert.equal(evidence.tiers.filter(tier => tier.enrichedRevision).length, 12);
  for (const tier of evidence.tiers) {
    const selectors = patched.codeItems.npcsPlus[divinationTierAlias(tier)];
    assert.equal(selectors.length, tier.name === 'Pale' ? 2 : 4);
    assert.ok(selectors.includes(`${tier.name} spring`));
    assert.equal(selectors.some(name => name.startsWith('Enriched ')), tier.name !== 'Pale');
  }
  assert.strictEqual(patched.chunks, definitions.chunks);
  assert.equal(JSON.stringify(patched.chunks), JSON.stringify(definitions.chunks));
});

test('overlay is idempotent and preserves custom harvesting and Colossi records', () => {
  const patched = applyDivinationTraining(definitions);
  assert.deepEqual(applyDivinationTraining(patched), patched);
  const label = divinationTierLabel(evidence.tiers[0]);
  const custom = { Level: 1, Primary: true, NPCs: ['Custom source'], Description: 'Keep my method' };
  const customColossi = { PickerId: evidence.colossi.pickerId, Level: 78, Objects: ['Custom remnants'] };
  const input = { ...definitions, challenges: { ...definitions.challenges, Divination: { ...definitions.challenges.Divination, [label]: custom, CustomColossi: customColossi } } };
  const result = applyDivinationTraining(input);
  assert.strictEqual(result.challenges.Divination[label], custom);
  assert.strictEqual(result.challenges.Divination.CustomColossi, customColossi);
  assert.equal(result.challenges.Divination[evidence.colossi.label], undefined);
});

test('composed catalogue adds exactly 14 members methods while retaining the F2P pale trial at 5', () => {
  assert.equal(divinationMethods.length, 14);
  assert.deepEqual(catalogue.methods.slice(0, f2p.methods.length).filter(method => method.skill !== 'Divination'), f2p.methods.filter(method => method.skill !== 'Divination'));
  const trial = f2p.methods.filter(method => method.skill === 'Divination');
  assert.equal(trial.length, 1);
  assert.equal(trial[0].maxLevel, 5);
  const springTrial = planTraining('Divination', 1, 5, { members: false, access: { npcs: ['Pale spring'] } });
  assert.ok(springTrial.availableMethods.some(method => method.methodId === trial[0].id && method.maxLevel === 5));
  assert.equal(planTraining('Divination', 1, 6, { members: false, access: { npcs: ['Pale spring'] } }).status, 'unavailable');
  const pale = methods.get('divination.pale-harvest.members');
  assert.equal(pale.level, 1); assert.equal(pale.maxLevel, 99); assert.equal(pale.members, true);
  for (const method of divinationMethods) {
    assert.equal(method.members, true); assert.equal(method.xpPerHour, null);
    assert.equal(method.xpPerAction, null); assert.equal(method.economics.gpPerAction, null);
  }
});

test('F2P planner rejects Divination 6 and excludes every members method despite sources and completion hints', () => {
  const available = access({ members: false, completedQuests: ['Heralds of Crimson', 'Fate of the Gods'], completedTasks: [{ category: 'Divination', id: evidence.colossi.pickerId }], skills: { Divination: 99 }, primaryOverrides: { Divination: true }, maxLevels: { Divination: 99 } });
  const overCap = planTraining('Divination', 1, 6, available);
  assert.equal(overCap.status, 'unavailable'); assert.equal(overCap.issues[0].code, 'skill-cap');
  const trial = planTraining('Divination', 1, 5, available);
  assert.ok(trial.availableMethods.length > 0);
  assert.ok(trial.availableMethods.every(row => !methods.has(row.methodId)));
  for (const method of divinationMethods) assert.ok(trainingMethodBlockers(method, available).some(blocker => blocker.kind === 'membership'));
});

test('members pale harvesting remains admitted from 5 to 99 without inventing a rate', () => {
  const plan = planTraining('Divination', 5, 99, access({ access: { npcs: ['Pale spring'] } }));
  assert.ok(plan.availableMethods.some(row => row.methodId === 'divination.pale-harvest.members' && row.maxLevel === 99));
  assert.equal(plan.plans['best-xp'].complete, false);
});

test('Colossi 77 requires partial personal quest proof, supplied by the method completion or full Heralds completion', () => {
  assert.equal(colossi.level, 77);
  assert.equal(colossi.requirements[1].progress, 'partial');
  assert.ok(trainingMethodBlockers(colossi, access()).some(blocker => blocker.kind === 'personal-completion'));
  assert.deepEqual(trainingMethodBlockers(colossi, access({ completedQuests: ['Heralds of Crimson'] })), []);
  assert.deepEqual(trainingMethodBlockers(colossi, access({ completedTasks: [{ category: 'Divination', id: evidence.colossi.pickerId }] })), []);
  assert.ok(trainingMethodBlockers(colossi, access({ access: { objects: ['Divine Fall', 'Mining colossus'] }, completedQuests: ['Heralds of Crimson'] })).some(blocker => blocker.kind === 'object'));
});

test('elder harvesting requires Fate of the Gods even when its enriched spring is reachable', () => {
  const elder = methods.get('divination.elder-harvest.members');
  const available = access({ access: { npcs: ['Enriched elder spring'] } });
  assert.ok(trainingMethodBlockers(elder, available).some(blocker => blocker.kind === 'quest'));
  assert.deepEqual(trainingMethodBlockers(elder, { ...available, completedQuests: ['Fate of the Gods'] }), []);
});

test('challenge-only and partner quest checkmarks do not become personal Colossi unlock proof', () => {
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'a', runescapeName: 'A' }, { id: 'b', runescapeName: 'B', completedTasks: [taskId('Quest', 'Heralds of Crimson')] }] };
  const row = { id: taskId('Quest', 'Heralds of Crimson'), category: 'Quest', rawLabel: 'Heralds of Crimson', label: 'Heralds of Crimson', record: { QuestPoints: 1 }, challengeSatisfied: true, personalCompleted: false };
  const methodRow = { id: evidence.colossi.pickerId, category: 'Divination', rawLabel: evidence.colossi.label, challengeSatisfied: true, personalCompleted: false };
  const available = buildTrainingAvailability({ tasks: [row, methodRow], access: { objects: ['Colossus remnants'] } }, { state, memberId: 'a' });
  assert.deepEqual(available.completedQuests, []); assert.deepEqual(available.completedTasks, []);
  assert.ok(trainingMethodBlockers(colossi, available).some(blocker => blocker.kind === 'personal-completion'));
});

test('untracked partial progress fails closed and full personal completion satisfies both progress gates', () => {
  assert.equal(personalQuestProgressBlocker({ quest: 'Heralds of Crimson', progress: 'partial' }).kind, 'personal-completion');
  assert.equal(personalQuestProgressBlocker({ quest: 'Heralds of Crimson', progress: 'partial' }, ['Heralds of Crimson']), null);
  assert.equal(personalQuestProgressBlocker({ quest: 'Fate of the Gods', progress: 'complete' }, ['Fate of the Gods']), null);
  assert.equal(personalQuestProgressBlocker({ quest: 'Heralds of Crimson', progress: 'started' }).kind, 'unsupported');
});


test('engine elder gate requires current personal Fate completion, not reachable tasks, partner checks or renamed progress', () => {
  const engine = createTaskEngine(definitions, { dataset: selectedDataset, cacheWalking: false, reviewedOverlays: false });
  const fateId = taskId('Quest', 'Fate of the Gods');
  const elderId = taskId('Divination', divinationTierLabel(evidence.tiers.find(tier => tier.name === 'Elder')));
  const member = extras => ({ id: 'a', name: 'A', runescapeName: 'A', unlocked: ['1'], completedTasks: [], passiveLevels: { Divination: 75 }, ...extras });
  const evaluate = (extras = {}, partner = {}) => engine.evaluate({ rules: { 'content.f2p': false }, members: [member(extras), { id: 'b', name: 'B', unlocked: ['1'], completedTasks: [], ...partner }], tasks: [] }, 'a');
  const elder = result => result.tasks.find(row => row.id === elderId);
  const reachable = evaluate();
  assert.equal(reachable.tasks.find(row => row.id === fateId).status, 'available');
  assert.ok(elder(reachable).blockers.some(blocker => blocker.kind === 'personal-completion'));
  assert.ok(elder(evaluate({}, { completedTasks: [fateId] })).blockers.some(blocker => blocker.kind === 'personal-completion'));
  assert.ok(elder(evaluate({ taskStatus: { [fateId]: { challengeCompleted: true } } })).blockers.some(blocker => blocker.kind === 'personal-completion'));
  assert.equal(elder(evaluate({ completedTasks: [fateId] })).status, 'available');
  assert.ok(elder(evaluate({ completedTasks: [fateId], questProgress: { [fateId]: { source: 'runemetrics', runescapeName: 'Old account', state: 'COMPLETED' } } })).blockers.some(blocker => blocker.kind === 'personal-completion'));
});
