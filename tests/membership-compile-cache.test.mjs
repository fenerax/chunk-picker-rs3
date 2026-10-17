import test from 'node:test';
import assert from 'node:assert/strict';
import { starterValues, starterJSON } from '../app/open-starter-data.mjs';

// An isolated invented dataset exercises the real engine without private data.
process.env.RS3_DATASET = 'open-starter';
const trials = ['Agility', 'Herblore', 'Thieving', 'Farming', 'Hunter', 'Slayer', 'Summoning', 'Divination'];
starterValues['app/tasks/engine.mjs#skillCaps'] = Object.fromEntries([...trials, 'Construction', 'Archaeology', 'Necromancy'].map(skill => [skill, 99]));
starterValues['app/tasks/engine.mjs#TWENTY'] = new Set(['Construction', 'Archaeology', 'Necromancy']);
starterValues['app/tasks/engine.mjs#MAYBE_PRIMARY'] = new Set(['InsidePOH Primary']);
starterValues['app/tasks/engine.mjs#PRESENTATION_RULES'] = new Set(['InsidePOH Primary']);
const gate = { category: 'Nonskill', label: 'Enter inner hall', changes: [{ field: 'Not F2P', before: true, after: false }] };
const collection = { category: 'Quest', label: 'Tour free stop', changes: [{ field: 'Not F2P', before: true, after: false }] };
starterJSON['app/data/metadata-corrections.2026-10-08.v1.json'].wikiCorrections = [gate, collection];
const { membershipOutputItems } = await import('../app/tasks/membership.mjs');
const { createTaskEngine, f2pCap } = await import('../app/tasks/engine.mjs');
const { applyMetadataCorrections, wikiMetadataCorrections } = await import('../app/data/metadata-corrections.mjs');
const { selectPresentedTasks } = await import('../app/tasks/presentation.mjs');
const state = () => ({ rules: { 'content.f2p': true }, taskRules: {}, members: [{ id: 'a', unlocked: ['100'], completedTasks: [] }] });
const task = (result, label) => result.tasks.find(row => row.rawLabel === label);

test('Wiki-only corrections use the ordinary exact-target seam, without cache evidence', () => {
  const raw = { challenges: { Nonskill: { 'Enter inner hall': { 'Not F2P': true, Tasks: { 'Wear entry outfit': 'Nonskill' } } } } };
  assert.equal(wikiMetadataCorrections.length, 2);
  const corrected = applyMetadataCorrections(raw);
  assert.equal(corrected.challenges.Nonskill['Enter inner hall']['Not F2P'], false);
  assert.deepEqual(corrected.challenges.Nonskill['Enter inner hall'].Tasks, raw.challenges.Nonskill['Enter inner hall'].Tasks);
  assert.equal(raw.challenges.Nonskill['Enter inner hall']['Not F2P'], true);
  assert.equal(applyMetadataCorrections(corrected), corrected);
  const drift = { challenges: { Nonskill: { 'Enter inner hall': { 'Not F2P': 'custom' } } } };
  assert.equal(applyMetadataCorrections(drift), drift);
  assert.throws(() => applyMetadataCorrections(drift, { corrections: [gate], strict: true }), /drift/);
});

test('batched metadata dictionaries equal cold one-correction applications without mutating shared inputs', () => {
  const rows = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`Task ${index}`,
    { QuestPoints: index, Requirements: { Crafting: 1 }, Chunks: ['100'] }]));
  Object.defineProperty(rows, '__proto__', { value: { QuestPoints: 0 }, enumerable: true });
  const raw = { chunks: { '100': {} }, challenges: { Quest: rows, Alias: rows, Extra: { Unchanged: { Items: ['Token'] } } } };
  const corrections = Array.from({ length: 50 }, (_, index) => ({ category: 'Quest', label: `Task ${index}`, changes: [
    { field: 'QuestPoints', before: index, after: index + 1 }, { field: 'Requirements.Crafting', before: 1, after: 2 },
  ] }));
  corrections.push(
    { category: 'Quest', label: 'Task 0', changes: [{ field: 'QuestPoints', before: 1, after: 99 }] },
    { category: 'Quest', label: 'Task 1', changes: [{ field: 'Chunks', before: ['100'], after: null, afterPresent: false }] },
    { category: 'Quest', label: 'Task 2', changes: [{ field: 'Skills.Mining', before: null, beforePresent: false, after: 7 }] },
    { category: 'Quest', label: '__proto__', changes: [{ field: 'QuestPoints', before: 0, after: 2 }] },
    { category: 'Alias', label: 'Task 0', changes: [{ field: 'QuestPoints', before: 0, after: 7 }] },
    { category: 'Quest', label: 'Missing', changes: [{ field: 'QuestPoints', before: 0, after: 1 }] },
    { category: 'Quest', label: 'Task 3', changes: [{ field: 'QuestPoints', before: 500, after: 501 }] },
  );
  const before = JSON.stringify(raw);
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(raw);
  const cold = corrections.reduce((data, correction) => applyMetadataCorrections(data, { corrections: [correction] }), raw);
  const batched = applyMetadataCorrections(raw, { corrections });
  assert.equal(JSON.stringify(batched), JSON.stringify(cold), 'complete bytes and property order match the original per-record copying path');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(batched.chunks, raw.chunks); assert.equal(batched.challenges.Extra, raw.challenges.Extra);
  assert.equal(batched.challenges.Alias['Task 2'], rows['Task 2'], 'aliased category maps remain independent');
  assert.equal(batched.challenges.Quest['Task 0'].QuestPoints, 99);
  assert.equal(batched.challenges.Alias['Task 0'].QuestPoints, 7);
  assert.equal(Object.hasOwn(batched.challenges.Quest, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(batched.challenges.Quest), Object.prototype);
  assert.equal(batched.challenges.Quest.__proto__.QuestPoints, 2);
  assert.equal(applyMetadataCorrections(batched, { corrections }), batched, 'no-op corrections preserve identity');
  assert.throws(() => applyMetadataCorrections(raw, { corrections: [corrections[0], corrections.at(-1)], strict: true }), /drift/);
  assert.equal(JSON.stringify(raw), before, 'strict failure preserves the complete original graph');
});

test('a corrected free gate preserves entry prerequisites and unlocks whole-quest presentation', () => {
  const raw = { chunks: { '100': { Sections: { '1': {}, '2': {} } } },
    sections: { '100': { '1': [] } }, challenges: {
      Nonskill: { 'Wear entry outfit': { Items: ['Entry outfit'] }, 'Enter inner hall': {
        Sections: ['100-1', '100-2'], ConnectsSections: true, 'Not F2P': true, Tasks: { 'Wear entry outfit': 'Nonskill' },
      } }, Quest: { 'Hall quest step': { Chunks: ['100-2'] }, 'Hall quest complete': { QuestPoints: 1, Tasks: { 'Hall quest step': 'Quest' } } },
    } };
  const input = state(); input.taskRules['Show Quest Tasks Complete'] = true;
  input.members[0].sectionOverrides = { '100-1': true };
  const options = { metadataCorrections: false };
  const before = createTaskEngine(raw, options).evaluate(input, 'a');
  assert.equal(task(before, 'Enter inner hall').blockers[0].kind, 'membership');
  const corrected = applyMetadataCorrections(raw);
  const noOutfit = createTaskEngine(corrected, options).evaluate(input, 'a');
  assert.equal(task(noOutfit, 'Hall quest complete').status, 'blocked');
  corrected.chunks['100'].Sections['1'].Shop = { Outfitter: true };
  corrected.shopItems = { Outfitter: { 'Entry outfit': 1 } };
  const result = createTaskEngine(corrected, options).evaluate(input, 'a');
  assert.ok(result.access.sections.includes('100-2'));
  assert.equal(task(result, 'Hall quest complete').status, 'available');
  assert.ok(selectPresentedTasks(result, input, 'a', corrected).tasks.some(row => row.rawLabel === 'Hall quest complete'));
});

test('accessible F2P trial methods reach five and satisfy the four-skill quest requirement', () => {
  // Caps checked against each skill's Wiki page on 2026-10-17. Construction,
  // Archaeology and Necromancy permit 20; the other trial skills permit five.
  const challenges = Object.fromEntries([...trials, 'Construction', 'Archaeology', 'Necromancy'].map(skill => [skill, {
    [`Train ${skill}`]: { Level: 1, Objects: [`${skill} station`], Primary: true,
      ...(skill === 'Construction' ? { Category: ['InsidePOH Primary'] } : {}) },
    [`${skill} goal`]: { Level: 5, Objects: [`${skill} station`] },
  }]));
  challenges.Quest = { 'Four-skill quest start': { Skills: { Construction: 5, Farming: 5, Hunter: 5, Thieving: 5 }, NoBoost: true } };
  const definitions = { chunks: { '100': { Object: Object.fromEntries(Object.keys(challenges).filter(skill => skill !== 'Quest').map(skill => [`${skill} station`, true])) } }, challenges };
  const input = state(); input.taskRules = { InsidePOH: true, 'InsidePOH Primary': true };
  const engine = createTaskEngine(definitions), result = engine.evaluate(input, 'a');
  for (const skill of trials) {
    assert.equal(f2pCap(skill), 5);
    assert.equal(result.training[skill].level, 5, skill);
    assert.equal(task(result, `${skill} goal`).status, 'available', skill);
  }
  for (const skill of ['Construction', 'Archaeology', 'Necromancy']) assert.equal(result.training[skill].level, 20, skill);
  assert.equal(task(result, 'Four-skill quest start').status, 'available');
  const absent = structuredClone(definitions); delete absent.chunks['100'].Object['Construction station'];
  assert.equal(task(createTaskEngine(absent).evaluate(input, 'a'), 'Four-skill quest start').status, 'blocked');
  input.taskRules['InsidePOH Primary'] = false;
  const excluded = engine.evaluate(input, 'a');
  assert.equal(excluded.training.Construction.primary, false);
  assert.equal(task(excluded, 'Four-skill quest start').status, 'blocked');
});

test('partial free collections stay hidden under whole-quest rules while members completion stays blocked', () => {
  const raw = { chunks: { '100': {} }, challenges: { Quest: {
    'Tour free stop': { Chunks: ['100'], 'Not F2P': true },
    'Tour members stop': { 'Not F2P': true },
    'Tour complete': { QuestPoints: 0, 'Not F2P': true, Tasks: { 'Tour free stop': 'Quest', 'Tour members stop': 'Quest' } },
  } } };
  const definitions = applyMetadataCorrections(raw), input = state();
  input.taskRules['Show Quest Tasks Complete'] = true;
  const result = createTaskEngine(definitions).evaluate(input, 'a');
  assert.equal(task(result, 'Tour free stop').status, 'available');
  assert.equal(task(result, 'Tour complete').status, 'blocked');
  assert.equal(selectPresentedTasks(result, input, 'a', definitions).tasks.length, 0);
  input.taskRules['Show Quest Tasks Complete'] = false;
  const steps = createTaskEngine(definitions).evaluate(input, 'a');
  assert.ok(selectPresentedTasks(steps, input, 'a', definitions).tasks.some(row => row.rawLabel === 'Tour free stop'));
});


test('membership root expansion preserves mixed tables, duplicate order and root-specific cycle cutoffs', () => {
  const definitions = { skillItems: { Crafting: {
    A: { B: true, Ashes: true, 'Magic shortbow': false },
    B: { A: true, 'Magic shortbow': true },
    Outer: { A: true, B: true },
  }, Smithing: { A: { 'Iron bar': true } } } };
  const cache = new Map();
  for (const [category, root] of [['Crafting', 'A'], ['Crafting', 'B'], ['Crafting', 'Outer'], ['Smithing', 'A']]) {
    const expected = membershipOutputItems(category, root, definitions);
    assert.deepEqual(membershipOutputItems(category, root, definitions, new Set(), cache), expected);
    assert.deepEqual(membershipOutputItems(category, root, definitions, new Set(), cache), expected);
  }
  assert.deepEqual(cache.get('Crafting').get('Outer'), ['Magic shortbow', 'Ashes', 'Ashes', 'Magic shortbow']);
  assert.throws(() => cache.get('Crafting').get('A').push('Poison'), TypeError);
  assert.deepEqual(membershipOutputItems('Crafting', 'A', definitions, new Set(['B']), cache), ['Ashes'],
    'A nonempty recursion path bypasses the root memo.');
});

