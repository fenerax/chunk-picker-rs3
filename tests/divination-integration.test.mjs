import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import definitions from '../rs3-chunkpicker-chunkinfo-export.json' with { type: 'json' };
import remnants from '../app/data/cache-divination.2026-10-13.v1.json' with { type: 'json' };
import { analyzeAreaCheck } from '../app/tasks/area-check.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { divinationEvidence as evidence } from '../app/data/divination-training.mjs';

const options = { dataset: selectedDataset, cacheWalking: true, cacheResources: true };
const world = buildWorld(definitions, options);
const engine = createTaskEngine(definitions, options);
const legacy = createTaskEngine(definitions, { ...options, divinationTraining: false });
const member = (unlocked, extras = {}) => ({ id: 'a', name: 'A', runescapeName: 'A', unlocked, selected: [], completedTasks: [], ...extras });
const state = (unlocked, { f2p = false, ...extras } = {}) => ({ rules: { 'content.f2p': f2p }, members: [member(unlocked, extras)], tasks: [] });
const colossiRow = result => result.tasks.find(row => row.id === evidence.colossi.pickerId);
const research = readFileSync(new URL('../docs/research/members-start.md', import.meta.url), 'utf8');
const namedInventory = research.split('Here are all **47')[1].split('The same local boundary audit')[0];
const named = [...namedInventory.matchAll(/^\| (\d{5}) \|[^\n]*\| L[13] \|$/gm)].map(match => match[1]);
const unnamed = /`(16440, 16695,[^`]+)`/.exec(research)[1].split(', ');
const footprint = [...named, ...unnamed];

test('78-square members-start footprint exposes conditional Colossi 77 beyond the F2P 5 reference', () => {
  assert.equal(named.length, 47); assert.equal(unnamed.length, 31); assert.equal(new Set(footprint).size, 78);
  const input = state(footprint);
  const saved = JSON.stringify(input);
  const area = analyzeAreaCheck(input, 'a', { chunkIds: footprint, asMembers: true }, { engine, definitions, world });
  const divination = area.rows.find(row => row.skill === 'Divination').alone;
  assert.equal(divination.methodCount, 1); assert.equal(divination.availableCount, 0);
  assert.equal(divination.lowest.level, 77); assert.equal(divination.highest.level, 77);
  assert.equal(divination.methods[0].status, 'blocked');
  assert.equal(divination.gapTarget, null, 'blocked duties are absent from the ordinary active list');
  assert.equal(divination.bootstrapGap, null);
  const before = legacy.evaluate(input, 'a');
  const blocked = engine.evaluate(input, 'a');
  assert.ok(before.training.Divination.level <= 5);
  assert.ok(blocked.training.Divination.level <= 5);
  assert.ok(!blocked.access.components.includes('18485-1000006'));
  assert.ok(!blocked.access.objects.includes('Colossus remnants')); 
  assert.equal(colossiRow(blocked).level, 77);
  assert.equal(colossiRow(blocked).status, 'blocked');
  assert.ok(colossiRow(blocked).blockers.some(blocker => blocker.kind === 'personal-completion'));
  const completed = engine.evaluate(state(footprint, { completedTasks: [evidence.colossi.pickerId] }), 'a');
  assert.ok(completed.training.Divination.level >= 77);
  assert.equal(colossiRow(completed).personalCompleted, true);
  assert.equal(JSON.stringify(input), saved);
});

test('ordinary Draynor F2P reference retains the same Divination training and harvesting task as overlay disabled', () => {
  const input = state(['12338', '12339', '12337'], { f2p: true, sectionOverrides: { '12338-1': true } });
  const before = legacy.evaluate(input, 'a');
  const after = engine.evaluate(input, 'a');
  assert.deepEqual(after.training.Divination, before.training.Divination);
  assert.equal(after.training.Divination.level, 5);
  const pale = taskId('Divination', 'Harvest a ~|pale wisp|~');
  const priorRow = before.tasks.find(row => row.id === pale);
  const nextRow = after.tasks.find(row => row.id === pale);
  assert.equal(nextRow.status, priorRow.status);
  assert.equal(nextRow.primaryMethod, priorRow.primaryMethod);
  assert.equal(nextRow.level, priorRow.level);
});

test('members north Falador retains its level-10 flickering band and excludes distant higher colonies', () => {
  const result = engine.evaluate(state(['11829'], { sectionOverrides: { '11829-1': true } }), 'a');
  const flickering = result.tasks.find(row => row.id === taskId('Divination', 'Harvest a ~|flickering wisp|~'));
  assert.ok(!flickering.blockers.some(blocker => blocker.kind === 'npc')); 
  assert.equal(flickering.level, 10);
  assert.ok(!result.access.objects.includes('Colossus remnants'));
});

test('exact remnants component is members-only and an isolated component does not supply the resource', () => {
  assert.deepEqual(remnants.placements[0].components, ['18485:6']);
  assert.deepEqual(remnants.mappings[0].evidenceObjectIds, [140893]);
  const f2p = engine.evaluate(state(footprint, { f2p: true, completedTasks: [evidence.colossi.pickerId] }), 'a');
  assert.ok(!f2p.access.objects.includes('Colossus remnants'));
  assert.ok(f2p.training.Divination.level <= 5);
  const isolated = engine.evaluate(state(['18485'], { startingChunk: '18485', completedTasks: [evidence.colossi.pickerId], sectionOverrides: { '18485-1000006': false } }), 'a');
  assert.ok(!isolated.access.components.includes('18485-1000006'));
  assert.ok(!isolated.access.objects.includes('Colossus remnants'));
});




test('neighbouring Divine Fall map marker alone does not inventory Colossi Divination', () => {
  const result = analyzeAreaCheck(state([]), 'a', { chunkIds: ['18486'], asMembers: true }, { engine, definitions, world });
  assert.equal(result.rows.find(row => row.skill === 'Divination').alone.methodCount, 0);
});

test('positively seeded exact remnants component supplies members, while F2P rejects the same seed', () => {
  const extras = { completedTasks: [evidence.colossi.pickerId], sectionOverrides: { '18485-1000006': true } };
  const members = engine.evaluate(state(['18485'], extras), 'a');
  assert.ok(members.access.components.includes('18485-1000006'));
  assert.ok(members.access.objects.includes('Colossus remnants'));
  const free = engine.evaluate(state(['18485'], { ...extras, f2p: true }), 'a');
  assert.ok(!free.access.objects.includes('Colossus remnants'));
});
