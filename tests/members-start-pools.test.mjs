import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeMembersStartOptions, membersStartPools, rollMembersStarts } from '../app/core/members-start.mjs';

const data = JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url)));
const members = [{ id: 'player1' }, { id: 'player2' }];
const ids = members.map(member => member.id);
const bank = chunkId => ({ chunkId, place: `Place ${chunkId}`, bank: 'Bank' });
const pairPools = (first, second = first) => [
  { memberId: 'player1', banks: first.map(bank) },
  { memberId: 'player2', banks: second.map(bank) },
];

test('runtime bank lists preserve the reviewed research and omit transport/mobile inventories', async () => {
  const research = JSON.parse(await readFile(new URL('../docs/research/members-start-banks.2026-10-12.v1.json', import.meta.url)));
  assert.equal(data.version, '2026-10-12.v1');
  assert.equal(data.reviewedOn, research.reviewedOn);
  assert.equal(data.optionA.length, 19);
  for (const key of ['optionA', 'optionAConditional', 'optionAF2PExtension', 'optionB', 'optionBConditional']) {
    assert.deepEqual(data[key], research[key]);
  }
  assert.equal(Object.hasOwn(data, 'optionATransportConditional'), false);
  assert.equal(Object.hasOwn(data, 'optionAMobileConditional'), false);
  assert.ok(data.checkedWikiRevisions.every(source => source.url.includes('?oldid=')));
});

test('normalization defaults safely and rejects unknown options, members and wrong types', () => {
  assert.deepEqual(normalizeMembersStartOptions({}, ids), {
    pool: 'optionA', includeConditional: false, includeF2P: false,
    switchToMembers: true, traderWoes: { player1: false, player2: false }, pairing: 'different',
  });
  for (const options of [null, [], { unexpected: true }, { pool: null }, { pool: 'A' }, { pairing: 'same' },
    { includeConditional: 1 }, { includeF2P: 'false' }, { switchToMembers: undefined },
    { traderWoes: true }, { traderWoes: { other: true } }, { traderWoes: { player1: 1 } }]) {
    assert.throws(() => normalizeMembersStartOptions(options, ids), TypeError);
  }
  assert.throws(() => normalizeMembersStartOptions({}, ['player1', 'player1']), TypeError);
});

test('A conditional confirmation includes all five entries; F2P extension deduplicates surface chunks', () => {
  const base = membersStartPools(data, members, {});
  assert.equal(base[0].banks.length, 19);
  const pools = membersStartPools(data, members, { includeConditional: true, includeF2P: true });
  const expected = new Set([...data.optionA, ...data.optionAConditional, ...data.optionAF2PExtension].map(bank => bank.chunkId));
  assert.equal(pools[0].banks.length, expected.size);
  assert.deepEqual(pools[0].banks, pools[1].banks);
  assert.equal(pools[0].banks.filter(bank => bank.chunkId === '11573').length, 1);
  assert.equal(pools[0].banks.filter(bank => bank.chunkId === '13365').length, 1);
  assert.ok(pools[0].banks.some(bank => bank.chunkId === '16690'));
});

test('asymmetric Trader Woes pools always produce a valid distinct Havenhythe assignment', () => {
  for (const eligible of ids) {
    const pools = membersStartPools(data, members, { pool: 'optionB', traderWoes: { [eligible]: true } });
    assert.equal(pools.find(pool => pool.memberId === eligible).banks.length, 2);
    assert.equal(pools.find(pool => pool.memberId !== eligible).banks.length, 1);
    for (const draw of [0, 0.25, 0.5, 0.999999]) {
      const result = rollMembersStarts(pools, 'different', () => draw);
      assert.equal(result.find(start => start.memberId === eligible).chunkId, '16690');
      assert.equal(result.find(start => start.memberId !== eligible).chunkId, '16692');
    }
  }
});

test('distinct common pools give every ordered assignment equal weight', () => {
  const pools = pairPools(['1', '2', '3']);
  const outcomes = Array.from({ length: 6 }, (_, index) => rollMembersStarts(pools, 'different', () => (index + 0.5) / 6)
    .map(start => start.chunkId).join(','));
  assert.deepEqual(new Set(outcomes), new Set(['1,2', '1,3', '2,1', '2,3', '3,1', '3,2']));
  const duo = pairPools(['1', '2']);
  assert.deepEqual(rollMembersStarts(duo, 'different', () => 0).map(start => start.chunkId), ['1', '2']);
  assert.deepEqual(rollMembersStarts(duo, 'different', () => 0.5).map(start => start.chunkId), ['2', '1']);
});

test('independent selection allows the same chunk and uses a separate bounded draw per member', () => {
  const draws = [0.9, 0.1];
  assert.deepEqual(rollMembersStarts(pairPools(['1', '2']), 'independent', () => draws.shift()), [
    { memberId: 'player1', chunkId: '2', place: 'Place 2' },
    { memberId: 'player2', chunkId: '1', place: 'Place 1' },
  ]);
  assert.deepEqual(rollMembersStarts(pairPools(['1', '2']), 'independent', () => 0).map(start => start.chunkId), ['1', '1']);
});

test('the sole shared chunk remains valid for different pairing', () => {
  const pools = membersStartPools(data, members, { pool: 'optionB' });
  assert.deepEqual(rollMembersStarts(pools, 'different', () => 0).map(start => start.chunkId), ['16692', '16692']);
});

test('invalid or empty pools and unbounded random values fail before producing starts', () => {
  for (const pools of [[], pairPools([]), pairPools(['1'], []), pairPools(['bad']),
    [{ memberId: 'player1', banks: [bank('1')] }, { memberId: 'player1', banks: [bank('2')] }]]) {
    assert.throws(() => rollMembersStarts(pools, 'different', () => 0), TypeError);
  }
  for (const draw of [-0.1, 1, NaN, Infinity, '0', undefined]) {
    assert.throws(() => rollMembersStarts(pairPools(['1']), 'different', () => draw), TypeError);
  }
  assert.throws(() => rollMembersStarts(pairPools(['1']), 'unknown', () => 0), TypeError);
});

for (const length of [1, 2, 3, 4, 5]) test(`${length}-player pools retain personal eligibility and independent draws`, () => {
  const roster = Array.from({ length }, (_, index) => ({ id: `synthetic${index}` }));
  const pools = membersStartPools({ optionB: [bank('1')], optionBConditional: [bank('2')] }, roster,
    { pool: 'optionB', traderWoes: { synthetic0: true } });
  assert.deepEqual(pools.map(pool => pool.banks.map(bank => bank.chunkId)), [['1', '2'], ...roster.slice(1).map(() => ['1'])]);
  let draws = 0;
  const starts = rollMembersStarts(pools, 'independent', () => { draws++; return 0.75; });
  assert.equal(draws, length);
  assert.deepEqual(starts.map(start => start.chunkId), ['2', ...roster.slice(1).map(() => '1')]);
  assert.deepEqual(starts.map(start => start.memberId), roster.map(member => member.id));
});

test('different pairing uniformly samples every globally minimum-overlap assignment for 1–5 players', () => {
  const cases = [
    ...[1, 2, 3, 4, 5].map(length => Array.from({ length }, () => ['1', '2', '3', '4', '5'])),
    [['1'], ['1'], ['1']],
    [['1', '2'], ['1'], ['2', '3']], // Greedy first-player selection can force an avoidable overlap.
    [['1'], ['1'], ['1', '2'], ['1', '2']],
    [['1', '2'], ['1', '2'], ['1', '2'], ['1', '2'], ['1', '2']],
    [['1'], ['1'], ['1'], ['2', '3', '4', '5'], ['2', '3', '4', '5']],
    [['1', '2'], ['1'], ['2', '3'], ['3', '4'], ['4', '5']],
  ];
  for (const lists of cases) {
    let all = [[]];
    for (const list of lists) all = all.flatMap(prefix => list.map(id => [...prefix, id]));
    const maximum = Math.max(...all.map(assignment => new Set(assignment).size));
    const best = all.filter(assignment => new Set(assignment).size === maximum);
    const pools = lists.map((list, index) => ({ memberId: `synthetic${index}`, banks: list.map(bank) }));
    const outcomes = best.map((_, index) => {
      let draws = 0;
      const starts = rollMembersStarts(pools, 'different', () => { draws++; return (index + 0.5) / best.length; });
      assert.equal(draws, 1);
      assert.deepEqual(starts.map(start => start.memberId), pools.map(pool => pool.memberId));
      for (const [member, start] of starts.entries()) {
        assert.ok(lists[member].includes(start.chunkId));
        assert.equal(start.place, `Place ${start.chunkId}`);
      }
      return starts.map(start => start.chunkId).join(',');
    });
    assert.deepEqual(new Set(outcomes), new Set(best.map(assignment => assignment.join(','))), JSON.stringify(lists));
  }
});

test('members-start helpers reject rosters outside 1–5 and invalid group draws', () => {
  for (const length of [0, 6]) {
    const roster = Array.from({ length }, (_, index) => `synthetic${index}`);
    assert.throws(() => normalizeMembersStartOptions({}, roster), /one to five/);
    assert.throws(() => rollMembersStarts(roster.map(memberId => ({ memberId, banks: [bank('1')] }))), /one to five/);
  }
  for (const draw of [-1, 1, NaN, Infinity, '0', undefined]) {
    assert.throws(() => rollMembersStarts(Array.from({ length: 5 }, (_, index) => ({ memberId: `synthetic${index}`, banks: [bank('1')] })),
      'different', () => draw), /Random must return/);
  }
});
