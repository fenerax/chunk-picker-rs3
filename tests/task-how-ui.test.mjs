import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTaskHow, renderTaskHow, taskHowSteps } from '../app/web/task-how.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { caveDefinitions, caveState } from './task-how-fixture.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { preferenceDefinitions, validatePreference } from '../app/core/preferences.mjs';
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, fn) { this.events[key] = fn; }
}
const document = { createElement: tag => new Node(tag) };
const button = (text, action, cls) => { const node = document.createElement('button'); node.textContent = text; node.className = cls; node.events.click = action; return node; };
const text = node => [node.textContent ?? '', ...node.children.map(text)].join(' ');
const proof = { proofStatus: 'partial', root: 'a', nodes: { a: { kind: 'task', label: 'Do the task.', subjectId: 'private:technical-id', rule: 'task-requirements', allOf: ['b'] }, b: { kind: 'gap', label: 'The picker cannot show the source yet.', allOf: [] } } };
const task = { id: 'task:x', label: 'Test task', status: 'available' };
test('player steps put supplies before the selected entrance and the goal last', () => {
  const definitions = caveDefinitions();
  definitions.chunks['12593'].Nickname = 'South marsh';
  const proof = createTaskEngine(definitions).how(caveState(), 'one', taskId('Extra', 'Defeat a cave bug'));
  const steps = taskHowSteps(proof, { locationName: id => id === '12593' ? 'South marsh' : '' }).map(step => step.label);
  assert.deepEqual(steps, [
    'Get Candle (light source) — item spawn in South marsh.',
    'Get Rope — item spawn in South marsh.',
    'Get into Swamp cave via Swamp entrance in South marsh.',
    'Defeat a cave bug — in Swamp cave.',
  ]);
  assert.doesNotMatch(steps.join(' '), /Do |your unlocked chunk|12593/);
  const advanced = taskHowSteps(proof, { advanced: true });
  assert.ok(advanced.some(step => step.node.kind === 'requirement'));
  const order = new Map(advanced.map((step, index) => [step.id, index]));
  for (const step of advanced) for (const child of step.node.allOf) assert.ok(order.get(child) < order.get(step.id));
});
test('training assumptions stay explicit after the starting method and before quest steps', () => {
  const proof = createTaskEngine(caveDefinitions()).how(caveState(['12850']), 'one', taskId('Extra', 'Defeat a cave bug'));
  const steps = taskHowSteps(proof).map(step => step.label);
  const method = steps.findIndex(label => label.startsWith('Balance on'));
  const assumption = steps.findIndex(label => label.includes('assumes you can train Agility to 13'));
  const quest1 = steps.findIndex(label => label.startsWith('The Lost Tribe step 1'));
  const quest2 = steps.findIndex(label => label.startsWith('The Lost Tribe step 2'));
  assert.ok(method < assumption && assumption < quest1 && quest1 < quest2);
});
test('an unbound NPC entry keeps the NPC witness visible instead of claiming a walking route', () => {
  const definitions = { chunks: { '100': { Nickname: 'Garden', NPC: { Guide: 1 } }, Minigame: { Connect: { '100': true }, Object: { Stile: 1 } } },
    challenges: { Nonskill: { Minigame: { UnlocksArea: true, NPCs: ['Guide'] } }, Agility: { 'Cross the stile': { Level: 1, Objects: ['Stile'] } } } };
  const proof = createTaskEngine(definitions).how(caveState(['100']), 'one', taskId('Agility', 'Cross the stile'));
  const labels = taskHowSteps(proof).map(step => step.label).join('\n');
  assert.equal(proof.proofStatus, 'partial');
  assert.match(labels, /Find Guide in Garden/);
  assert.match(labels, /hasn't linked Minigame to a reachable entrance/);
  assert.doesNotMatch(labels, /Get into Minigame from Garden/);
});
test('How is lazy, stale responses become retryable errors, and close cancels requests', async () => {
  const row = new Node('div'); let count = 0, scope = 'one:1', resolve, signal;
  const toggle = appendTaskHow(row, task, { document, button, scope: () => scope, load: (_, input) => { count++; signal = input; return new Promise(done => { resolve = done; }); } });
  assert.equal(count, 0);
  const loading = toggle.events.click(); assert.equal(count, 1); scope = 'one:2'; resolve(proof); await loading;
  assert.match(text(row), /saved state changed/); assert.match(text(row), /Retry How/);
  await toggle.events.click(); assert.equal(signal.aborted, true);
  const retry = toggle.events.click(); const panel = row.children[1]; toggle.events.click(); resolve(proof); await retry;
  assert.equal(panel.hidden, true); assert.equal(panel.attributes['aria-busy'], 'false');
});
test('viewer does not load; blocked tasks have no How; advanced gates technical detail', async () => {
  const row = new Node('div'); let count = 0;
  const toggle = appendTaskHow(row, task, { document, button, scope: () => '', readOnly: true, load: () => count++ });
  await toggle.events.click(); assert.equal(count, 0); assert.match(text(row), /saved view/);
  assert.equal(appendTaskHow(new Node('div'), { ...task, status: 'blocked' }, { document }), undefined);
  assert.match(text(renderTaskHow(proof, { document })), /partial explanation/);
  assert.doesNotMatch(text(renderTaskHow(proof, { document })), /technical-id|task-requirements/);
  assert.match(text(renderTaskHow(proof, { document, advanced: true })), /technical-id/);
});
test('request errors can be retried after failure', async () => {
  const row = new Node('div'); let count = 0;
  const toggle = appendTaskHow(row, task, { document, button, scope: () => '', load: async () => { if (++count === 1) throw new Error('Try later.'); return proof; } });
  await toggle.events.click(); assert.match(text(row), /Try later/);
  await row.children[1].children[1].events.click(); assert.equal(count, 2); assert.match(text(row), /Do the task/);
});
test('How preference defaults on, persists per player through History/backup/undo, and off renders nothing or loads anything', () => {
  assert.equal(preferenceDefinitions.find(row => row.id === 'showTaskHow').default, true);
  const original = createGroupState([{ id: 'one', name: 'Explorer' }, { id: 'two', name: 'Partner' }]);
  const changed = applyCommand(original, { type: 'set-preference', memberId: 'one', preferenceId: 'showTaskHow', value: false });
  assert.equal(changed.members[0].preferences.showTaskHow, false); assert.equal(changed.members[1].preferences, undefined);
  assert.equal(changed.history.at(-1).command.preferenceId, 'showTaskHow');
  const restored = importBackup(exportBackup(changed)); assert.equal(restored.members[0].preferences.showTaskHow, false);
  assert.deepEqual(applyCommand(restored, { type: 'undo' }).members, original.members);
  assert.throws(() => validatePreference('showTaskHow', 'false'), TypeError);
  const row = new Node('div'); let calls = 0;
  assert.equal(appendTaskHow(row, task, { document, button, enabled: false, scope: () => '', load: () => calls++ }), undefined);
  assert.equal(row.children.length, 0); assert.equal(calls, 0);
});
test('chunk-data access reads as one footnote, not a step or a partial banner', () => {
  const soft = { proofStatus: 'partial', root: 'a', gaps: [{ node: 'g', kind: 'resource-only-access' }], nodes: {
    a: { kind: 'task', label: 'Do the task.', taskLabel: 'Cut logs', allOf: ['g'] },
    g: { kind: 'gap', gap: 'resource-only-access', label: "The picker can use resources here, but hasn't proved a walking route into this place.", allOf: [] } } };
  const plain = text(renderTaskHow(soft, { document }));
  assert.doesNotMatch(plain, /partial explanation|hasn't proved a walking route/);
  assert.match(plain, /Cut logs/); assert.match(plain, /Places come from the chunk data/);
  assert.match(text(renderTaskHow(soft, { document, advanced: true })), /hasn't proved a walking route/);
  const mixed = { ...soft, gaps: [...soft.gaps, { node: 'p', kind: 'processing' }] };
  assert.match(text(renderTaskHow(mixed, { document })), /partial explanation/);
});
