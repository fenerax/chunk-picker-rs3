import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEMBER_KEYS, createGroupState, validateState, applyCommand, applyValidatedCommand, exportBackup, importBackup } from '../app/core/state.mjs';

const banks = JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url), 'utf8'));
const now = () => '2026-10-12T12:00:00.000Z';
const ids = [...new Set(Object.values(banks).filter(Array.isArray).flat().map(row => row.chunkId).filter(Boolean)), '100', '101', '102', '200', '201', '202'];
const world = { chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])), surface: new Set(ids), walkable: new Set(ids),
  f2p: new Set(['100', '200']), neighbors: new Map(), sectionTopology: new Map(ids.map(id => [id, new Set(['1'])])) };
const options = { world, membersStartBanks: banks, now, random: () => 0 };
const command = (extra = {}) => ({ type: 'go-members', options: { pool: 'optionA', ...extra } });

function fixture() {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
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
      transportFacts: { levels: { Woodcutting: 12 }, currencies: { coins: 60 }, confirmations: { 'own-ferry': true } } });
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
