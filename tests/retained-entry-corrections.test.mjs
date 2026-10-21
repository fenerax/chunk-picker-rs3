import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bundle from '../app/data/retained-entry-corrections.2026-10-12.v2.json' with { type: 'json' };
import { applyRetainedTaskCorrections } from '../app/data/retained-task-corrections.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';

const bytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url));
const raw = JSON.parse(bytes);
const guildLabel = "Gain access to the ~|Warriors' Guild|~";
const mandrithLabel = 'Receive a slayer assignment from ~|Mandrith|~';

test('H6 provenance pins two reviewed pages and exact authored inputs', () => {
  assert.equal(bundle.provenance.referenceSha256, sha256RepositoryText(bytes));
  assert.equal(bundle.provenance.generatorSha256, sha256RepositoryText(readFileSync(new URL(`../${bundle.provenance.generator}`, import.meta.url))));
  assert.equal(bundle.corrections.length, 3);
  assert.equal(bundle.wiki.length, 2);
  for (const pin of bundle.wiki) {
    assert.equal(pin.url, `https://runescape.wiki/w/Special:PermanentLink/${pin.revisionId}`);
    assert.match(pin.contentSha256, /^[a-f0-9]{64}$/);
  }
});

test('both guild mirrors and Mandrith overlay preserve identity, geography and immutable input', () => {
  const before = JSON.stringify(raw);
  const after = applyRetainedTaskCorrections(raw, { strict: true });
  for (const correction of bundle.corrections) {
    const original = raw.challenges[correction.category][correction.label];
    const row = after.challenges[correction.category][correction.label];
    assert.equal(permanentTaskId(correction.category, correction.label, row), correction.id);
    for (const field of ['Chunks', 'NPCs', 'Primary', 'Priority', 'NoPet', 'NoBoost', 'Not F2P']) assert.deepEqual(row[field], original[field]);
  }
  for (const category of ['Attack', 'Strength']) {
    assert.equal(after.challenges[category][guildLabel].Level, 1);
    assert.deepEqual(after.challenges[category][guildLabel].Skills, {});
    assert.equal(after.challenges[category][guildLabel].RequirementAlternatives.length, 69);
  }
  assert.deepEqual(after.challenges.Combat[mandrithLabel].Skills, { Slayer: 95 });
  assert.equal(after.challenges.Combat[mandrithLabel].Level, 120);
  assert.equal(after.challenges.Slayer[mandrithLabel], raw.challenges.Slayer[mandrithLabel]);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(applyRetainedTaskCorrections(after, { strict: true }), after);
});

test('generated guild clauses exactly encode summed130 OR either99 for every base pair', () => {
  const clauses = bundle.corrections[0].changes.find(change => change.field === 'RequirementAlternatives').after;
  for (let Attack = 1; Attack <= 120; Attack++) for (let Strength = 1; Strength <= 120; Strength++) {
    const actual = clauses.some(clause => Object.entries(clause.Skills).every(([skill, level]) => ({ Attack, Strength })[skill] >= level));
    assert.equal(actual, Attack + Strength >= 130 || Attack >= 99 || Strength >= 99, `${Attack}/${Strength}`);
  }
});

test('guild engine accepts uneven pairs and mastery, rejects129 and temporary boosts', () => {
  const data = { chunks: { '11319': { Sections: { '1': { Spawn: { 'Fixture potion': 1 } } } } },
    codeItems: { boostItems: { Attack: { 'Fixture potion': 10 }, Strength: { 'Fixture potion': 10 } } }, challenges: {
    Attack: { [guildLabel]: raw.challenges.Attack[guildLabel] }, Strength: { [guildLabel]: raw.challenges.Strength[guildLabel] },
  } };
  const engine = createTaskEngine(data, { retainedTaskCorrections: true });
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['11319'] }]);
  saved.taskRules = { Boosting: true };
  for (const [Attack, Strength, expected] of [[65,65,'available'], [70,60,'available'], [60,70,'available'], [99,1,'available'], [1,99,'available'], [98,32,'available'], [32,98,'available'], [64,65,'blocked'], [98,1,'blocked']]) {
    saved.members[0].passiveLevels = { Attack, Strength };
    const result = engine.evaluate(saved, 'a');
    assert.equal(result.tasks.length, 2);
    assert.ok(result.items.some(item => item.name === 'Fixture potion'), 'The boost item is reachable.');
    for (const row of result.tasks) {
      assert.equal(row.status, expected, `${row.category} ${Attack}/${Strength}: ${JSON.stringify(row.blockers)}`);
      if (expected === 'blocked') {
        const detail = row.blockers.find(blocker => blocker.kind === 'requirements').detail;
        assert.ok(detail.length < 200);
        assert.equal(detail, 'Requires Attack + Strength 130, or Attack 99, or Strength 99 (base levels).');
      }
    }
  }
});

test('Mandrith Combat mirror rejects Slayer94 and accepts95 at Combat120', () => {
  const engine = createTaskEngine({ chunks: { '12341': { NPC: { Mandrith: 1 } } }, challenges: { Combat: { [mandrithLabel]: raw.challenges.Combat[mandrithLabel] } } }, { retainedTaskCorrections: true });
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }]);
  saved.rules['content.f2p'] = false;
  saved.members[0].passiveLevels = { Combat: 120, Slayer: 94 };
  assert.equal(engine.evaluate(saved, 'a').tasks[0].status, 'blocked');
  saved.members[0].passiveLevels.Slayer = 95;
  assert.equal(engine.evaluate(saved, 'a').tasks[0].status, 'available');
});

test('H6 exact-record guards preserve custom fields and fail strict audit', () => {
  for (const correction of bundle.corrections) {
    const custom = { ...raw.challenges[correction.category][correction.label], Priority: 99 };
    const input = { challenges: { [correction.category]: { [correction.label]: custom } } };
    assert.equal(applyRetainedTaskCorrections(input, { corrections: [correction] }), input);
    assert.throws(() => applyRetainedTaskCorrections(input, { corrections: [correction], strict: true }), /drift/);
  }
});
