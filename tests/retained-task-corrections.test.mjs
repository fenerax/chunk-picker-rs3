import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { applyRetainedTaskCorrections, retainedTaskCorrections as bundle } from '../app/data/retained-task-corrections.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';

const bytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url));
const raw = JSON.parse(bytes);
const correction = bundle.corrections[0];
const original = raw.challenges[correction.category][correction.label];
const sparse = record => ({ challenges: { Combat: { [correction.label]: record }, Diary: { Unrelated: { Skills: { Combat: 60 } } } } });

test('entry alternatives correct the retained gate while preserving task identity and authored geography', () => {
  const before = JSON.stringify(raw);
  const after = applyRetainedTaskCorrections(raw, { strict: true });
  const row = after.challenges.Combat[correction.label];
  assert.equal(row.Level, 1);
  assert.deepEqual(row.RequirementAlternatives, [{ Skills: { Combat: 60 } }, { TotalLevelNeeded: 1000 }]);
  assert.match(row.Description, /separate.*Teleport.*10 total boss kills/);
  assert.equal(permanentTaskId('Combat', correction.label, row), 'rs3:task:0003c5');
  assert.equal(permanentTaskId('Combat', correction.label, row), permanentTaskId('Combat', correction.label, original));
  assert.equal(row.Chunks, original.Chunks);
  assert.deepEqual(row.Chunks, ['12339']);
  assert.equal(row.Primary, false);
  assert.equal(row.Priority, 1);
  assert.equal(after.challenges.Mining, raw.challenges.Mining);
  assert.equal(after.challenges.Diary['~|Daemonheim Achievements#Easy|~ Setting Up'], raw.challenges.Diary['~|Daemonheim Achievements#Easy|~ Setting Up']);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(applyRetainedTaskCorrections(after, { strict: true }), after);
});

test('atomic exact-record guard preserves custom requirements and prevents partial corrections', () => {
  for (const record of [{ ...original, Level: 55 }, { ...original, Chunks: ['12340'] }, { ...original, Description: 'Custom facts' }, { ...original, RequirementAlternatives: [{ Skills: { Combat: 50 } }] }]) {
    const definitions = sparse(record);
    assert.equal(applyRetainedTaskCorrections(definitions), definitions);
    assert.throws(() => applyRetainedTaskCorrections(definitions, { corrections: bundle.corrections, strict: true }), /drift/);
  }
});

test('missing targets and unsupported fields are explicit audit errors', () => {
  const definitions = { challenges: { Combat: {} } };
  assert.equal(applyRetainedTaskCorrections(definitions), definitions);
  assert.throws(() => applyRetainedTaskCorrections(definitions, { strict: true }), /Missing retained task/);
  assert.throws(() => applyRetainedTaskCorrections(raw, { corrections: [{ ...correction, changes: [{ field: '__proto__', before: null, after: {} }] }] }), /Unsupported/);
  assert.throws(() => applyRetainedTaskCorrections(raw, { corrections: [{ ...correction, changes: [correction.changes[0], correction.changes[0]] }] }), /Unsupported/);
});

test('all new evidence pins and authored inputs remain reproducible with LF hashing', () => {
  assert.equal(bundle.provenance.referenceSha256, sha256RepositoryText(bytes));
  const generator = readFileSync(new URL(`../${bundle.provenance.generator}`, import.meta.url));
  assert.equal(bundle.provenance.generatorSha256, sha256RepositoryText(generator));
  assert.equal(readFileSync(new URL('../app/data/retained-task-corrections.2026-10-09.v1.json', import.meta.url)).includes('\r\n'), false);
  assert.equal(bundle.wiki.length, 31);
  for (const pin of bundle.wiki) {
    assert.ok(Number.isSafeInteger(pin.revisionId));
    assert.equal(pin.url, `https://runescape.wiki/w/Special:PermanentLink/${pin.revisionId}`);
    assert.match(pin.contentSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(bundle.wiki.find(row => row.title === "War's Retreat").facts.entryAnyOf, [{ combatLevel: 60 }, { totalLevel: 1000 }]);
  assert.equal(bundle.wiki.find(row => row.title === "War's Retreat Teleport").facts.totalBossKills, 10);
  assert.equal(bundle.wiki.find(row => row.title === "War's Retreat Teleport").facts.differentBossesRequired, false);
});

test('audit covers every retained numeric Combat gate without stripping genuine achievement requirements', () => {
  const all = Object.entries(raw.challenges).flatMap(([category, rows]) => Object.entries(rows).map(([label, record]) => ({ category, label, record })));
  const combat = all.filter(({ category, record }) => category === 'Combat' || ['Skills', 'SkillsNeeded', 'Requirements'].some(field => typeof record[field]?.Combat === 'number'));
  assert.equal(all.length, bundle.audit.retainedRows);
  assert.equal(combat.length, bundle.audit.combatGateRows);
  assert.equal(combat.length, 41);
  assert.deepEqual(new Set(bundle.audit.combatAudit.map(row => `${row.category}\u0000${row.label}`)), new Set(combat.map(row => `${row.category}\u0000${row.label}`)));
  for (const row of bundle.audit.combatAudit) assert.ok(bundle.wiki.some(pin => pin.title === row.wikiTitle));
  assert.deepEqual(bundle.audit.confirmedRecommendationAsRequirement, []);
  assert.equal(bundle.audit.recommendationTextRows, 2);
  const achievement = "~|Combat achievements#War's Retreat|~ On the Warpath";
  assert.equal(applyRetainedTaskCorrections(raw).challenges.Diary[achievement].Skills.Combat, 60);
  assert.equal(bundle.audit.recommendationTextAudit.find(row => row.category === 'Nonskill').wikiTitle, undefined);
});
