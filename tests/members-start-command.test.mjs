import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEMBER_KEYS, createGroupState, validateState, applyCommand, applyValidatedCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const banks = JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url), 'utf8'));
const now = () => '2026-10-12T12:00:00.000Z';
const ids = [...new Set(Object.values(banks).filter(Array.isArray).flat().map(row => row.chunkId).filter(Boolean)), '100', '101', '102', '200', '201', '202'];
const world = { chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])), surface: new Set(ids), walkable: new Set(ids),
  f2p: new Set(['100', '200']), neighbors: new Map(), sectionTopology: new Map(ids.map(id => [id, new Set(['1'])])) };
const options = { world, membersStartBanks: banks, now, random: () => 0 };
const command = (extra = {}) => ({ type: 'go-members', options: { pool: 'optionA', ...extra } });

function fixture(memberCount = 2) {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }].slice(0, memberCount));
  state.rules = { 'content.f2p': true, 'roll.adjacent': false };
  state.tasks = [{ id: 'quest:retained', label: 'Retained quest', category: 'quest' },
    { id: 'diary:retained', label: 'Retained diary task', category: 'diary' }];
  for (const [index, member] of state.members.entries()) {
    const base = index ? '200' : '100';
    const runescapeName = index ? 'twosamplegim' : 'exampleGIMab';
    const provenance = { source: 'runemetrics', fetchedAt: now(), runescapeName };
    Object.assign(member, { unlocked: [base], selected: [index ? '201' : '101'], pendingRoll: [index ? '202' : '102'],
      sourceMapId: index ? 'qxb' : 'qxa',
      blacklisted: ['300'], completedTasks: ['quest:retained', 'diary:retained'], obtainedEquipment: ['Bronze sword'], notes: { [base]: 'Keep this note' },
      journal: 'Keep journal', taskRules: { Skills: true }, taskStatus: { 'quest:retained': { favorite: true, challengeCompleted: true } },
      sectionOverrides: { [`${base}-1`]: false }, preferences: { theme: 'dark', startingChunk: base },
      primaryOverrides: { Mining: false }, passiveLevels: { Mining: 10 }, maxLevels: { Mining: 40 },
      runescapeName, xpChoices: { 'quest:retained': ['Mining', null] }, taskAlternatives: { quest: { retained: 'quest:retained' } },
      teleports: [{ id: 'home', label: 'Retained teleport', destination: base, available: true, consumable: false }],
      teleportOverrides: { home: false }, sourceBacklogs: { objects: { Tree: false }, items: { Plank: true } },
      areaOverrides: { Cave: false }, slayerLock: { level: 50, monster: 'Manually Locked', boss: 'None' },
      stickers: { [base]: { type: 'star', color: '#ABCDEF', text: 'Retained' } },
      chunkColours: { [base]: 'blue' }, chunkColourNames: { blue: 'Later' },
      skillProgress: { Mining: { ...provenance, level: 40, xp: 40000 } },
      questProgress: { 'quest:retained': { ...provenance, title: 'Retained quest' } }, runeMetricsSync: provenance,
      achievementProgress: { 'diary:retained': { title: 'Retained diary task', achievementId: 7, source: 'game-plugin', fetchedAt: now(), memberId: member.id } },
      itemProgress: { 'diary:retained': { title: 'Retained item', gameItemId: 1205, evidence: 'owned', seen: 'owned when first seen; source unknown', source: 'game-plugin', fetchedAt: now(), memberId: member.id } },
      originalPickerSync: { sourceMapId: index ? 'qxb' : 'qxa', capturedAt: now(), appliedAt: now(), sourceHash: `sha256:${'a'.repeat(64)}`, groups: ['chunks', 'tasks'] },
      transportFacts: { levels: { Woodcutting: 12 }, currencies: { coins: 60 }, confirmations: { 'own-ferry': true } }, bossUnlocks: { telos: true } });
    assert.deepEqual(new Set(Object.keys(member)), new Set([...MEMBER_KEYS].filter(key => key !== 'f2pMap')),
      'Every existing member field needs an explicit preservation fixture; f2pMap is created by this command');
  }
  return validateState(state);
}

test('going members resets both maps while retaining personal records and recording reproducible bank choices', () => {
  const original = fixture(), before = structuredClone(original);
  const actor = { kind: 'invite', inviteId: 'test-player', label: 'Player 2', memberId: 'player2' };
  const attributedOptions = { ...options, actor };
  const changed = applyCommand(original, command(), attributedOptions);
  assert.deepEqual(original, before);
  assert.equal(changed.rules['content.f2p'], false);
  assert.deepEqual(changed.tasks, before.tasks);
  const event = changed.history.at(-1);
  assert.deepEqual(event.actor, actor);
  assert.deepEqual(event.command.options, { pool: 'optionA', includeConditional: false, includeF2P: false,
    traderWoes: { player1: false, player2: false }, pairing: 'different', switchToMembers: true });
  assert.equal(event.command.starts.length, 2);
  assert.equal(new Set(event.command.starts.map(start => start.chunkId)).size, 2);
  assert.equal(event.command.bankVersion, banks.version);
  for (const [index, member] of changed.members.entries()) {
    const start = event.command.starts[index];
    assert.equal(start.memberId, member.id);
    assert.ok(banks.optionA.some(row => row.chunkId === start.chunkId && row.place === start.place));
    assert.deepEqual(member.unlocked, [start.chunkId]);
    assert.deepEqual(member.selected, []);
    assert.deepEqual(member.pendingRoll, []);
    assert.deepEqual(member.f2pMap, { unlocked: before.members[index].unlocked, at: now() });
    assert.deepEqual(member.preferences, { ...before.members[index].preferences, startingChunk: start.chunkId });
    assert.deepEqual(member.sectionOverrides, { ...before.members[index].sectionOverrides, [`${start.chunkId}-1`]: true });
    for (const key of Object.keys(before.members[index]).filter(key => !['unlocked', 'selected', 'pendingRoll', 'preferences', 'sectionOverrides'].includes(key))) {
      assert.deepEqual(member[key], before.members[index][key], `${member.id}.${key}`);
    }
  }
  assert.deepEqual(applyValidatedCommand(validateState(before), command(), attributedOptions), changed);
  assert.deepEqual(importBackup(exportBackup(changed)), changed);
  const undone = applyCommand(changed, { type: 'undo' }, options);
  assert.deepEqual(undone.members, before.members);
  assert.deepEqual(undone.rules, before.rules);
  assert.deepEqual(undone.tasks, before.tasks);
  assert.ok(undone.members.every(member => !Object.hasOwn(member, 'f2pMap')));
});

test('a solo members start retains the F2P map and personal records and can be undone', () => {
  const original = fixture(1), before = structuredClone(original);
  const changed = applyCommand(original, command(), options);
  const member = changed.members[0], start = changed.history.at(-1).command.starts[0];
  assert.deepEqual(original, before);
  assert.equal(changed.members.length, 1);
  assert.equal(changed.history.at(-1).command.starts.length, 1);
  assert.equal(start.memberId, member.id);
  assert.ok(banks.optionA.some(bank => bank.chunkId === start.chunkId));
  assert.deepEqual(member.unlocked, [start.chunkId]);
  assert.deepEqual(member.selected, []);
  assert.deepEqual(member.pendingRoll, []);
  assert.deepEqual(member.f2pMap, { unlocked: before.members[0].unlocked, at: now() });
  assert.equal(member.preferences.startingChunk, start.chunkId);
  assert.equal(member.sectionOverrides[`${start.chunkId}-1`], true);
  for (const key of Object.keys(before.members[0]).filter(key => !['unlocked', 'selected', 'pendingRoll', 'preferences', 'sectionOverrides'].includes(key))) {
    assert.deepEqual(member[key], before.members[0][key], key);
  }
  assert.equal(changed.rules['content.f2p'], false);
  assert.deepEqual(changed.tasks, before.tasks);
  assert.deepEqual(importBackup(exportBackup(changed)), changed);
  const repeated = applyCommand(changed, command({ pool: 'optionB', switchToMembers: false }), options);
  assert.deepEqual(repeated.members[0].unlocked, ['16692']);
  assert.deepEqual(repeated.members[0].f2pMap, member.f2pMap);
  const undone = applyCommand(changed, { type: 'undo' }, options);
  assert.deepEqual(undone.members, before.members);
  assert.deepEqual(undone.rules, before.rules);
  assert.deepEqual(undone.tasks, before.tasks);
});

test('Havenhythe independent starts work with F2P settings retained and keep the first F2P snapshot on repeats', () => {
  const original = fixture(), first = applyCommand(original, command({ pool: 'optionB', pairing: 'independent', switchToMembers: false }), options);
  assert.equal(first.rules['content.f2p'], true);
  assert.deepEqual(first.members.map(member => member.unlocked), [['16692'], ['16692']]);
  const second = applyCommand(first, command({ pool: 'optionB', pairing: 'independent' }), { ...options, now: () => '2026-10-13T12:00:00.000Z' });
  assert.deepEqual(second.members.map(member => member.f2pMap), first.members.map(member => member.f2pMap));
  const undone = applyCommand(second, { type: 'undo' }, options);
  assert.deepEqual(undone.members, first.members);
  assert.deepEqual(undone.rules, first.rules);
});

test('going members rejects forged result fields, invalid options and malformed saved F2P maps atomically', () => {
  const original = fixture(), before = structuredClone(original);
  const quiet = { ...options, now: () => { throw Error('No clock on invalid input'); }, random: () => { throw Error('No draw on invalid input'); } };
  for (const invalid of [
    { type: 'go-members', options: { pool: 'unknown' } }, command({ includeConditional: 'false' }), command({ includeF2P: 1 }),
    command({ pairing: 'same' }), command({ switchToMembers: null }), command({ traderWoes: { absent: true } }),
    command({ traderWoes: { player1: 'true' } }), command({ injected: true }),
    { ...command(), starts: [{ memberId: 'player1', chunkId: '0', place: 'Forged' }] },
    { ...command(), bankVersion: 'forged' },
  ]) assert.throws(() => applyCommand(original, invalid, quiet), TypeError);
  assert.deepEqual(original, before);
  for (const f2pMap of [{ unlocked: ['0'], at: now() }, { unlocked: ['100', '100'], at: now() },
    { unlocked: ['100'], at: 'not-a-date' }, { unlocked: ['100'], at: now(), extra: true }]) {
    const invalid = structuredClone(original); invalid.members[0].f2pMap = f2pMap;
    assert.throws(() => validateState(invalid), TypeError);
  }
});

for (const length of [1, 2, 3, 4, 5]) test(`${length}-player members starts preserve separate maps, History and Undo`, () => {
  const original = createGroupState(Array.from({ length }, (_, index) => ({ id: `player${index + 1}`, name: `Player ${index + 1}`,
    unlocked: [index % 2 ? '200' : '100'] })));
  const before = structuredClone(original);
  const syntheticBanks = { version: 'synthetic-v1', optionA: ['101', '102', '200', '201', '202'].map(chunkId => ({ chunkId, place: `Bank ${chunkId}` })) };
  const changed = applyCommand(original, command(), { ...options, membersStartBanks: syntheticBanks });
  assert.deepEqual(original, before);
  const starts = changed.history.at(-1).command.starts;
  assert.equal(starts.length, length);
  assert.equal(new Set(starts.map(start => start.chunkId)).size, length);
  for (const [index, member] of changed.members.entries()) {
    assert.equal(starts[index].memberId, member.id);
    assert.deepEqual(member.unlocked, [starts[index].chunkId]);
    assert.equal(member.preferences.startingChunk, starts[index].chunkId);
    assert.deepEqual(member.f2pMap.unlocked, before.members[index].unlocked);
  }
  assert.deepEqual(importBackup(exportBackup(changed)), changed);
  const description = describeHistoryEvent(changed.history.at(-1), { memberName: id => original.members.find(member => member.id === id).name });
  for (const start of starts) assert.ok(description.includes(`${original.members.find(member => member.id === start.memberId).name} at ${start.place}`));
  if (length > 2) assert.match(description, /Restarted group maps/);
  assert.deepEqual(applyCommand(changed, { type: 'undo' }, options).members, before.members);
});

test('a five-player transition keeps personal bank eligibility when overlaps are unavoidable', () => {
  const original = createGroupState(Array.from({ length: 5 }, (_, index) => ({ id: `player${index + 1}`, name: `Player ${index + 1}` })));
  const syntheticBanks = { version: 'synthetic-v1', optionB: [{ chunkId: '101', place: 'First bank' }],
    optionBConditional: [{ chunkId: '102', place: 'Second bank' }] };
  const changed = applyCommand(original, command({ pool: 'optionB', traderWoes: { player5: true } }), { ...options, membersStartBanks: syntheticBanks });
  assert.deepEqual(changed.members.map(member => member.unlocked), [['101'], ['101'], ['101'], ['101'], ['102']]);
});
