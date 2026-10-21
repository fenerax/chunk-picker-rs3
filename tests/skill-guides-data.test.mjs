import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillGuideCatalogue, applySkillGuideTasks } from '../app/data/skill-guides.mjs';
import { compareSkillGuides, reliableTrainingBreakpoints, isF2PGuideEntry, proposeGeneratedGuideTasks,
  reviewedGuideMetadataCorrections } from '../scripts/research/build-skill-guides.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url));
const reference = JSON.parse(read('rs3-chunkpicker-chunkinfo-export.json'));
const training = JSON.parse(read('app/data/training/methods.f2p.json'));
const wiki = JSON.parse(read('docs/research/skill-guides-wiki.2026-10-08.v1.json'));
const report = JSON.parse(read('docs/research/skill-guides-comparison.2026-10-08.v1.json'));

test('all skill-guide coverage and exact-candidate comparisons reproduce from portable data', () => {
  assert.equal(skillGuideCatalogue.skills.length, 29);
  const comparison = compareSkillGuides(skillGuideCatalogue, reference, training);
  assert.deepEqual(comparison.counts, report.counts);
  assert.deepEqual(comparison.bySkill, report.bySkill);
  assert.deepEqual(comparison.comparisons, report.comparisons);
  assert.ok(skillGuideCatalogue.entries.length > 6000);
  assert.equal(new Set(skillGuideCatalogue.entries.map(entry => entry.id)).size, skillGuideCatalogue.entries.length);
  for (const entry of skillGuideCatalogue.entries) {
    assert.ok(typeof entry.name === 'string' && entry.name);
    assert.ok(typeof entry.members === 'boolean' || entry.members === null);
    assert.equal(entry.source.major, 22);
    assert.equal(entry.source.minor * 32 + entry.source.subid, entry.structId);
  }
});

test('item icons, ambiguous same-product actions and level disagreements stay advisory', () => {
  const guide = { skills: [{ name: 'Cooking' }], entries: [{ id: 'entry', structId: 1, skill: 'Cooking', name: 'Stop burning trout',
    item: { name: 'Trout' }, level: 49, members: false, category: { name: 'Food burning' } }] };
  const definitions = { challenges: { Cooking: { Cook: { Level: 15, Output: 'Trout' }, Other: { Level: 20, Output: 'Trout' } } } };
  const before = structuredClone(definitions), result = compareSkillGuides(guide, definitions, { methods: [] });
  assert.equal(result.comparisons[0].ambiguity, true);
  assert.equal(result.comparisons[0].levelDisagreements.length, 2);
  assert.deepEqual(definitions, before);
  assert.equal(applySkillGuideTasks(definitions, { catalogue: { generatedTasks: [] } }), definitions);
});

test('F2P counts respect unknown membership and trial/current skill caps', () => {
  assert.equal(isF2PGuideEntry({ skill: 'Woodcutting', members: null, level: 1 }), false);
  assert.equal(isF2PGuideEntry({ skill: 'Archaeology', members: false, level: 20 }), true);
  assert.equal(isF2PGuideEntry({ skill: 'Archaeology', members: false, level: 21 }), false);
  assert.equal(isF2PGuideEntry({ skill: 'Agility', members: false, level: 6 }), false);
  assert.equal(isF2PGuideEntry({ skill: 'Magic', members: false, level: 120 }), false);
  assert.equal(isF2PGuideEntry({ skill: 'Invention', members: false, level: 1 }), false);
});

test('four generated unlocks require exact guide/Wiki levels and preserve authored selectors without producing items', () => {
  assert.equal(skillGuideCatalogue.generatedTasks.length, 4);
  assert.equal(skillGuideCatalogue.metadataCorrections.length, 1);
  assert.deepEqual(reviewedGuideMetadataCorrections(skillGuideCatalogue, reference, wiki), skillGuideCatalogue.metadataCorrections);
  const corrected = structuredClone(reference);
  corrected.challenges.Cooking['Cook a ~|trout|~']['Not F2P'] = false;
  assert.deepEqual(proposeGeneratedGuideTasks(skillGuideCatalogue, corrected, wiki), skillGuideCatalogue.generatedTasks);
  assert.deepEqual(proposeGeneratedGuideTasks(skillGuideCatalogue, corrected, { samples: [] }), []);
  for (const task of skillGuideCatalogue.generatedTasks) {
    const original = reference.challenges[task.category][task.selectorEvidence.sourceLabel];
    assert.equal(task.record.Primary, false);
    assert.equal(task.record.NoBoost, true);
    assert.equal(task.record.Output, undefined);
    assert.deepEqual(task.record.Items, original.Items);
    assert.deepEqual(task.record.Objects, original.Objects);
    assert.equal(task.selectorEvidence.wiki.noBurnLevel, task.record.Level);
    assert.equal(task.selectorEvidence.wiki.members, false);
  }
});

test('invalid identities, unverified entries and missing selectors reject generation before engine compilation', () => {
  const original = skillGuideCatalogue.generatedTasks[0], clone = structuredClone(original);
  assert.throws(() => applySkillGuideTasks(reference, { catalogue: { ...skillGuideCatalogue, generatedTasks: [original, { ...clone, label: 'Duplicate identity' }] } }), /Duplicate generated/);
  assert.throws(() => applySkillGuideTasks(reference, { catalogue: { ...skillGuideCatalogue, generatedTasks: [{ ...clone, entryIds: ['invented'] }] } }), /Unverified guide entry/);
  const missing = structuredClone(clone); delete missing.record.Items; delete missing.record.Objects;
  assert.throws(() => applySkillGuideTasks(reference, { catalogue: { ...skillGuideCatalogue, generatedTasks: [missing] } }), /exact selector/);
  const enabled = applySkillGuideTasks(reference);
  assert.equal(applySkillGuideTasks(enabled), enabled);
  assert.ok(!reference.challenges.Cooking[original.label]);
  const renamed = { challenges: { Cooking: { 'Custom renamed goal': { ...original.record } } } };
  assert.equal(applySkillGuideTasks(renamed, { catalogue: { ...skillGuideCatalogue, generatedTasks: [original] } }), renamed);
});

test('reliable breakpoints and repository LF provenance match their versioned evidence', () => {
  assert.deepEqual(reliableTrainingBreakpoints(skillGuideCatalogue, training), skillGuideCatalogue.trainingBreakpoints);
  for (const document of [skillGuideCatalogue, report]) for (const field of ['reference', 'training', 'builder', 'wikiValidation']) {
    const source = document.provenance[field];
    assert.equal(source.sha256, sha256RepositoryText(read(source.path)), field);
  }
  assert.equal(wiki.provenance.validator.sha256, sha256RepositoryText(read(wiki.provenance.validator.path)));
});
