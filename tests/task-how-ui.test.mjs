import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewCache } from '../app/web/browser-state.mjs';
import { appendTaskHow, renderTaskHow, taskHowSteps } from '../app/web/task-how.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { pathDefinitions, pathState, caveDefinitions, caveState } from './task-how-fixture.mjs';
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

test('generated goals open details without loading or painting a cached proof', async () => {
  for (const category of ['BiS', 'Collection', 'Construction']) for (const readOnly of [false, true]) {
    const generated = { ...task, id: `generated:${category}`, category, generated: true };
    const cache = createViewCache({ storage: undefined }); cache.configure({ picker: 'fixture' });
    cache.remember('how', generated.id, 0, proof);
    const row = new Node('div'); let opened;
    const toggle = appendTaskHow(row, generated, { document, button, cache, readOnly,
      openDetails: value => { opened = value; }, load: () => assert.fail('generated goals must not request How') });
    assert.equal(toggle.textContent, 'Details');
    await toggle.events.click();
    assert.equal(opened, generated);
    assert.equal(row.children.length, 1, 'no cached or empty route panel');
  }
});

test('generated goal details explain the route limit without offering How or an empty list', () => {
  const row = new Node('div');
  const toggle = appendTaskHow(row, { ...task, generated: true }, { document, button,
    load: () => assert.fail('generated goals must not request How') });
  assert.equal(toggle, undefined);
  assert.match(text(row), /Step-by-step routes.*generated goals/);
  assert.match(text(row), /sources.*details/i);
  assert.equal(row.children.some(node => ['button', 'ol'].includes(node.tagName)), false);
});

test('empty proof output explains the missing route instead of rendering an empty step list', () => {
  for (const advanced of [false, true]) {
    const rendered = renderTaskHow({ proofStatus: 'partial', nodes: {} }, { document, advanced });
    assert.equal(rendered.children.some(node => node.tagName === 'ol'), false);
    assert.match(text(rendered), /No step-by-step route is available/);
  }
});
test('How labels cached revisions as updating until the live answer replaces them', async () => {
  for (const cachedRevision of [6, 7, 8]) {
    const cache = createViewCache({ storage: undefined }); cache.configure({ picker: 'fixture' });
    const old = structuredClone(proof); old.nodes.a.label = 'Cached answer';
    cache.remember('how', task.id, cachedRevision, old);
    const row = new Node('div'); let resolve;
    const toggle = appendTaskHow(row, task, { document, button, cache, revision: () => 7,
      scope: () => 'one:7', load: () => new Promise(done => { resolve = done; }) });
    const pending = toggle.events.click();
    assert.equal(text(row).includes('Cached answer'), cachedRevision <= 7);
    assert.equal(text(row).includes('Updating…'), cachedRevision <= 7);
    resolve(proof); await pending;
    assert.doesNotMatch(text(row), /Cached answer/); assert.match(text(row), /Do the task/);
  }
});
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

for (const advanced of [false, true]) {
  test(`selected all/any/count placements render truthful visible steps (${advanced ? 'Advanced' : 'default'})`, () => {
    const engine = createTaskEngine(pathDefinitions());
    for (const [goal, expected] of [
      ['Use both stations', 'Use both stations — in West and East.'],
      ['Use any station', 'Use any station — in West.'],
      ['Use two stations', 'Use two stations — in West and East.'],
      ['Use shared preparation', 'Use shared preparation — in West and East.'],
    ]) {
      const proof = engine.how(pathState(), 'one', taskId('Extra', goal));
      const input = structuredClone(proof), rendered = renderTaskHow(proof, { document, advanced });
      const list = rendered.children.find(node => node.tagName === 'ol');
      assert.equal(list.children.at(-1).textContent, expected);
      assert.doesNotMatch(text(rendered), /West or East|in North/);
      assert.equal(list.children.filter(node => node.textContent === 'Prepare — in West.').length, goal === 'Use shared preparation' ? 1 : 0);
      assert.deepEqual(proof, input);
    }
  });
  test(`historical access gap is neutral in visible text (${advanced ? 'Advanced' : 'default'})`, () => {
    const proof = createTaskEngine(pathDefinitions()).how(pathState(), 'one', taskId('Extra', 'Use historical supply'));
    const rendered = renderTaskHow(proof, { document, advanced });
    const messages = rendered.children.find(node => node.tagName === 'ol').children.map(node => node.textContent);
    assert.deepEqual(messages, advanced ? [
      'This supply comes from a recorded completion; its current production access is not established.',
      'You recorded completing Producer.',
      'Get Token.', 'Obtain Token.', 'Obtain Token.',
      'The task passes the current membership, rule and source policies.', 'Use historical supply.',
    ] : [
      'This supply comes from a recorded completion; its current production access is not established.',
      'You recorded completing Producer.',
      'Get Token.', 'Use historical supply.',
    ]);
    assert.match(text(rendered), /partial explanation/);
    assert.doesNotMatch(text(rendered), /partner access/);
  });
}

test('innate melee, Ranged, Prayer and Combat routes render concrete witnesses before training assumptions', () => {
  const definitions = {
    chunks: {
      '100': {
        Nickname: 'Meadow',
        Monster: { Goblin: 1 },
        Spawn: { Shortbow: 1, 'Bronze arrows': 1 },
      },
    },
    drops: { Goblin: { Bones: { 1: 'Always' } } },
    codeItems: {
      boneItems: ['Bones'],
      ammoTools: { 'Bronze arrows': { Shortbow: 1 } },
      rangedItems: { Shortbow: 1 },
    },
    challenges: {
      Attack: { 'Wield bronze sword': { Level: 10 } },
      Ranged: { 'Wield oak bow': { Level: 10 } },
      Prayer: { 'Use thick skin': { Level: 10 } },
      Combat: { 'Reach combat 10': { Level: 10 } },
    },
  };
  const state = caveState(['100']);
  const engine = createTaskEngine(definitions);

  const attackProof = engine.how(state, 'one', taskId('Attack', 'Wield bronze sword'));
  assert.deepEqual(taskHowSteps(attackProof).map(step => step.label), [
    'Find Goblin in Meadow.',
    'The picker assumes you can train Attack to 10 because monster combat is reachable.',
    'Wield bronze sword.',
  ]);
  assert.doesNotMatch(text(renderTaskHow(attackProof, { document })), /partial explanation/);

  const rangedProof = engine.how(state, 'one', taskId('Ranged', 'Wield oak bow'));
  const rangedSteps = taskHowSteps(rangedProof).map(step => step.label);
  const monsterIdx = rangedSteps.indexOf('Find Goblin in Meadow.');
  const bowIdx = rangedSteps.indexOf('Get Shortbow — item spawn in Meadow.');
  const arrowIdx = rangedSteps.indexOf('Get Bronze arrows — item spawn in Meadow.');
  const rangedAssumeIdx = rangedSteps.indexOf('The picker assumes you can train Ranged to 10 because ranged combat is reachable.');
  const rangedGoalIdx = rangedSteps.indexOf('Wield oak bow.');
  assert.ok(monsterIdx >= 0 && bowIdx >= 0 && arrowIdx >= 0 && rangedAssumeIdx > monsterIdx && rangedAssumeIdx > bowIdx && rangedAssumeIdx > arrowIdx && rangedGoalIdx === rangedSteps.length - 1);
  assert.doesNotMatch(text(renderTaskHow(rangedProof, { document })), /partial explanation/);

  const prayerProof = engine.how(state, 'one', taskId('Prayer', 'Use thick skin'));
  assert.deepEqual(taskHowSteps(prayerProof).map(step => step.label), [
    'Get Bones — drop from Goblin in Meadow.',
    'The picker assumes you can train Prayer to 10 because a bone or ash source is reachable.',
    'Use thick skin.',
  ]);
  assert.doesNotMatch(text(renderTaskHow(prayerProof, { document })), /partial explanation/);

  const combatProof = engine.how(state, 'one', taskId('Combat', 'Reach combat 10'));
  assert.deepEqual(taskHowSteps(combatProof).map(step => step.label), [
    'Find Goblin in Meadow.',
    'The picker assumes you can train Combat to 10 because combat training is reachable.',
    'Reach combat 10.',
  ]);
  assert.doesNotMatch(text(renderTaskHow(combatProof, { document })), /partial explanation/);

  const advanced = taskHowSteps(rangedProof, { advanced: true });
  assert.ok(advanced.some(step => step.node.kind === 'training-method' && step.node.skill === 'Ranged'));
  const order = new Map(advanced.map((step, index) => [step.id, index]));
  for (const step of advanced) for (const child of step.node.allOf) assert.ok(order.get(child) < order.get(step.id));
});
