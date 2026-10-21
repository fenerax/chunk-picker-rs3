import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { combatLevelFromSkills } from '../app/core/combat-level.mjs';
import evidence from '../app/data/combat-level-formula.2026-10-09.v1.json' with { type: 'json' };

test('known starting stats give Combat 3 while missing Constitution stays a conservative lower bound', () => {
  assert.equal(combatLevelFromSkills({ Constitution: 10 }), 3);
  assert.equal(combatLevelFromSkills({ Constitution: 10 }, { f2p: true }), 3);
  assert.equal(combatLevelFromSkills({}), 1);
  assert.equal(combatLevelFromSkills(null), 1);
  assert.equal(combatLevelFromSkills({ Attack: '60', Constitution: NaN, Defence: Infinity, Prayer: -1, Summoning: 2.5 }), 1);
});

test('current real maxima allow Combat 152 through all four offensive styles', () => {
  const secondary = { Defence: 99, Constitution: 99, Prayer: 99, Summoning: 99 };
  for (const offence of [{ Attack: 120, Strength: 120 }, { Magic: 120 }, { Ranged: 120 }, { Necromancy: 120 }]) {
    assert.equal(combatLevelFromSkills({ ...secondary, ...offence }), 152);
  }
  assert.equal(combatLevelFromSkills({ ...secondary, Attack: 99, Strength: 99 }), 138);
  assert.equal(combatLevelFromSkills({ ...secondary, Necromancy: 100 }), 139);
  assert.equal(combatLevelFromSkills({ ...secondary, Attack: 200, Strength: 200, Defence: 120, Constitution: 120 }), 152);
});

test('dominant offensive style wins without adding other styles to Combat', () => {
  assert.equal(combatLevelFromSkills({ Magic: 60 }), 39);
  assert.equal(combatLevelFromSkills({ Magic: 60, Ranged: 50, Attack: 30, Strength: 30, Necromancy: 40 }), 39);
  assert.equal(combatLevelFromSkills({ Attack: 100, Strength: 20, Magic: 60 }), 39);
});

test('Prayer and Summoning halves and final level all round down', () => {
  assert.equal(combatLevelFromSkills({ Magic: 10, Prayer: 3, Summoning: 3 }), 7);
  assert.equal(combatLevelFromSkills({ Magic: 10, Prayer: 4, Summoning: 4 }), 8);
  assert.equal(combatLevelFromSkills({ Attack: 50, Strength: 50, Defence: 55, Constitution: 54 }), 59);
  assert.equal(combatLevelFromSkills({ Attack: 50, Strength: 50, Defence: 55, Constitution: 55 }), 60);
});

test('F2P follows current calculator world rules rather than saved Summoning or members Necromancy', () => {
  const levels = { Attack: 120, Strength: 120, Defence: 99, Constitution: 99, Prayer: 99 };
  for (const Summoning of [1, 5, 99]) assert.equal(combatLevelFromSkills({ ...levels, Summoning }, { f2p: true }), 140);
  assert.equal(combatLevelFromSkills({ Necromancy: 120 }, { f2p: true }), 13);
  assert.equal(combatLevelFromSkills({ Necromancy: 20 }, { f2p: true }), 13);
  assert.equal(combatLevelFromSkills({ Magic: 79, Defence: 17, Constitution: 17 }, { f2p: true }), 60);
  assert.equal(combatLevelFromSkills({ Magic: 79, Defence: 17, Constitution: 17 }), 59);
});

test('formula provenance binds implementation LF bytes and current Wiki formula/calculator revisions', () => {
  assert.equal(evidence.moduleSha256, sha256RepositoryText(readFileSync(new URL('../app/core/combat-level.mjs', import.meta.url))));
  assert.deepEqual(evidence.wiki.map(pin => pin.revisionId), [37182070, 37009630, 36950979]);
  for (const pin of evidence.wiki) {
    assert.equal(pin.url, `https://runescape.wiki/w/Special:PermanentLink/${pin.revisionId}`);
    assert.match(pin.contentSha256, /^[a-f0-9]{64}$/);
  }
  for (const sample of evidence.examples) assert.equal(combatLevelFromSkills(sample.levels, sample.options), sample.expected, sample.name);
});
