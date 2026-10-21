import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNpcWikiPage, resolveNpcWikiNumber, proposeNpcCombatCorrection, calibrateNpcParam, inspectLifePointCandidates } from '../scripts/research/npc-metadata-evidence.mjs';

const page = content => parseNpcWikiPage({ title: 'Sample', revisions: [{ revid: 123, slots: { main: { content } } }] });
const candidate = (id, combatLevel, extra = {}) => ({ id, name: 'Sample', normalizedName: 'Sample', combatLevel, params: [], ...extra });
const proposal = (parsed, candidates) => proposeNpcCombatCorrection({ label: 'Sample', parsed, candidates, cache: { artifact: 'isolated-fixture.json', sha256: 'fixture' } });

test('exact ID binding handles multiple agreeing Wiki variants and shared metadata', () => {
  const parsed = page('{{Infobox Monster|name=Sample|version1=Brown|version2=White|id=41|level=1}}');
  assert.deepEqual(resolveNpcWikiNumber(parsed, 41, 'level').variants, ['Brown', 'White']);
  assert.equal(resolveNpcWikiNumber(parsed, 41, 'level').value, 1);
  assert.equal(resolveNpcWikiNumber(parsed, 42, 'level').value, null);
  const result = proposal(parsed, [candidate(41, 1)]);
  assert.equal(result.correction.combatLevel, 1);
  assert.equal(result.correction.field, 'combatLevel');
  assert.equal(Object.hasOwn(result.correction, 'members'), false);
});

test('generic name rejects cache ambiguity despite a matched normal Wiki variant', () => {
  const parsed = page('{{Infobox Monster|name=Sample|id=41|level=1}}');
  assert.equal(proposal(parsed, [candidate(41, 1), candidate(999, 111)]).reason, 'cache-name-variant-level-disagreement');
  assert.equal(proposal(parsed, [candidate(41, 1), candidate(999, null)]).reason, 'unknown-cache-combat-level');
});

test('explicit Wiki ID mismatch, suffix disagreement, unknowns and conflicts fail closed', () => {
  for (const content of [
    '{{Infobox Monster|name=Sample|id=41|level=1|level=2}}',
    '{{Infobox Monster|name=Sample|version1=First|id1=41|level1=1|version2=Second|id2=41|level2=2}}',
    '{{Infobox Monster|name=Sample|id=41|id=42|level=1}}',
    '{{Infobox Monster|name=Sample|id=41|level={{unknown}}}}',
  ]) assert.equal(proposal(page(content), [candidate(41, 1)]).correction, null);
  const parsed = page('{{Infobox Monster|name=Sample|id=41|level=1}}');
  assert.equal(proposal(parsed, [candidate(42, 1)]).reason, 'no-confirmed-explicit-wiki-id');
  assert.equal(proposal(parsed, [candidate(41, 2)]).correction, null);
  assert.equal(proposal(parsed, [candidate(41, 1, { normalizedName: 'Other name' })]).reason, 'non-exact-cache-name');
});

test('unspecified NPC combat metadata does not turn cache zero into Wiki confirmation', () => {
  const parsed = page('{{Infobox NPC|name=Sample|id=519|members=No|actions=Talk to}}');
  assert.equal(resolveNpcWikiNumber(parsed, 519, 'level').value, null);
  assert.equal(proposal(parsed, [candidate(519, 0)]).correction, null);
});

test('param calibration needs independent NPC names and all samples to match', () => {
  const parsedPages = [page('{{Infobox Monster|name=One|id=1|max_melee=15}}'), page('{{Infobox Monster|name=Two|id=2|max_melee=20}}')];
  const rows = [candidate(1, 1, { name: 'One', params: [{ prop: 641, intvalue: 150 }] }), candidate(2, 2, { name: 'Two', params: [{ prop: 641, intvalue: 200 }] })];
  const spec = { rows, parsedPages, prop: 641, divisor: 10, wikiField: 'max_melee', field: 'maxMeleeHit', sampleIds: [1,2] };
  assert.equal(calibrateNpcParam(spec).validated, true);
  assert.equal(calibrateNpcParam({ ...spec, divisor: 1 }).validated, false);
  assert.equal(calibrateNpcParam({ ...spec, rows: rows.map(row => ({ ...row, name: 'Same species' })) }).validated, false);
  assert.equal(calibrateNpcParam({ ...spec, rows: rows.map(row => ({ ...row, params: [...row.params, ...row.params] })) }).validated, false);
});

test('Hill giant numeric damage/LP coincidence cannot identify life points', () => {
  const parsedPages = [page('{{Infobox Monster|name=Chicken|id=41|lifepoints=250}}'), page('{{Infobox Monster|name=Cow|id=81|lifepoints=1000}}'), page('{{Infobox Monster|name=Hill giant|id=117|lifepoints=4500}}')];
  const rows = [candidate(41, 1, { params: [{ prop: 641, intvalue: 150 }] }), candidate(81, 2, { params: [{ prop: 641, intvalue: 200 }] }), candidate(117, 26, { params: [{ prop: 641, intvalue: 4500 }] })];
  const result = inspectLifePointCandidates(rows, parsedPages, [41,81,117]);
  assert.equal(result.status, 'unavailable-no-common-parameter-mapping');
  assert.deepEqual(result.candidates, []);
});
