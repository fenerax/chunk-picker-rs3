import test from 'node:test';
import assert from 'node:assert/strict';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { originalTransfer } = await import('../app/original-transfer.mjs');
const { normalizeOriginalPaste, originalChunkList } = await import('../app/original-paste.mjs');
const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, coordinateSystem: 'surface-grid-v1', identityNamespace: 'rs3' };
const world = { chunks: new Map(['12850', '12594', '13106', '12338', '12082'].map(id => [id, { id }])) };
const defaults = { Extra: true, F2P: true };
const initial = () => createGroupState([{ id: 'synthetic', name: 'Synthetic player' }]);
function importOriginal(map) {
  const paste = { format: 'rs3-original-paste', chunksText: Object.keys(map.chunks.unlocked).join(','), rulesText: JSON.stringify(map.rules), gameplayText: JSON.stringify(map), includeRules: true, includeTasks: true };
  const result = normalizeOriginalPaste(paste, { current: initial(), world, dataset });
  const state = result.state;
  state.provenance = { originalPasteImports: [{ ...result.archive, memberId: state.members[0].id }] };
  return { state, member: state.members[0], report: result.report };
}
// Independent model of the public controls, not upstream executable code.
function originalUI(transfer) {
  const { unlocked, selected } = originalChunkList(transfer.url);
  const rules = JSON.parse(transfer.rulesJSON);
  return { chunks: { unlocked: Object.fromEntries(unlocked.map(id => [id, id])), selected: Object.fromEntries(selected.map((id, index) => [id, index + 1])), potential: {}, blacklisted: {} },
    rules: Object.fromEntries(Object.keys(defaults).map(key => [key, rules[key] || false])), chunkNotes: transfer.journal };
}
const exportOriginal = state => originalTransfer(state, state.members[0].id, dataset, world, { defaults });

test('picker → original controls → original-format import preserves cells, journal and retained rule values with explicit losses', () => {
  const source = initial(), member = source.members[0];
  Object.assign(member, { unlocked: ['12850'], selected: ['12594', '13106'], pendingRoll: ['12338'], blacklisted: ['12082'], journal: 'Synthetic journal\n🧭 Second line',
    notes: { '12850': 'Synthetic chunk note' }, taskRules: { Extra: false, SyntheticAppOnly: true },
    taskStatus: { 'rs3:task:synthetic-check': { challengeCompleted: true, backlogged: true, backlogReason: 'Synthetic reason', favorite: true } } });
  source.tasks = [{ id: 'rs3:task:synthetic-check', category: 'Extra', label: 'Synthetic challenge' }];
  const transfer = exportOriginal(source), accepted = originalUI(transfer), returned = importOriginal(accepted);
  assert.deepEqual(returned.member.unlocked, member.unlocked);
  assert.equal(returned.member.journal, member.journal);
  assert.equal(transfer.selectedOrderChanged, true);
  assert.deepEqual(returned.member.selected, ['13106', '12594']);
  assert.deepEqual(returned.member.pendingRoll, []); assert.deepEqual(returned.member.blacklisted, []);
  assert.deepEqual(returned.member.taskStatus, {}); assert.deepEqual(returned.member.notes ?? {}, {});
  assert.equal(returned.member.taskRules, undefined, 'The synthetic Extra rule is retained-only, never activated by guesswork');
  assert.deepEqual(JSON.parse(exportOriginal(returned.state).rulesJSON), accepted.rules, 'Retained original decisions allow a return without discarding that setting');
  assert.deepEqual(transfer.appOnlyRules, ['SyntheticAppOnly']);
  assert.deepEqual(Object.keys(transfer).sort(), ['appOnlyRuleCount', 'appOnlyRules', 'journal', 'message', 'resetRuleCount', 'resetRules', 'rulesJSON', 'selectedOrderChanged', 'url'].sort());
});

test('original format → import → export → original controls preserves supported pieces and identifies original-only losses', () => {
  const source = { chunks: { unlocked: { '12850': '12850' }, selected: { '13106': 1, '12594': 2 }, potential: { '12338': '12338' }, blacklisted: { '12082': '12082' } },
    rules: { Extra: false, F2P: true }, chunkNotes: 'Synthetic original journal',
    chunkinfo: { checkedAllTasks: { Extra: { t_unknown: true } }, backlog: { Extra: { t_unknown: '' } } },
    userTasks: { syntheticCustom: 'Synthetic custom task' }, chunkOrder: { '1': '12850' } };
  const imported = importOriginal(source), returned = originalUI(exportOriginal(imported.state));
  assert.deepEqual(returned.chunks.unlocked, source.chunks.unlocked);
  assert.deepEqual(Object.keys(returned.chunks.selected).sort(), Object.keys(source.chunks.selected).sort());
  assert.deepEqual(returned.rules, source.rules); assert.equal(returned.chunkNotes, source.chunkNotes);
  assert.deepEqual(returned.chunks.potential, {}); assert.deepEqual(returned.chunks.blacklisted, {});
  assert.equal(returned.chunkinfo, undefined); assert.equal(returned.userTasks, undefined); assert.equal(returned.chunkOrder, undefined);
  assert.ok(imported.report.records.some(row => row.key === 't_unknown'));
  assert.equal(imported.state.provenance.originalPasteImports[0].gameplayText, JSON.stringify(source));
});

test('current rules override archived settings; collisions, invalid types and absent settings use reference defaults', () => {
  const state = initial();
  state.provenance = { originalPasteImports: [{ memberId: 'synthetic', rules: [{ key: 'Extra', value: false }, { key: 'Extra', value: true }] }] };
  assert.equal(JSON.parse(exportOriginal(state).rulesJSON).Extra, true);
  state.provenance.originalPasteImports[0].rules = [{ key: 'Extra', value: 'invalid boolean' }];
  assert.equal(JSON.parse(exportOriginal(state).rulesJSON).Extra, true);
  state.members[0].taskRules = { Extra: false };
  assert.equal(JSON.parse(exportOriginal(state).rulesJSON).Extra, false);
  state.rules['content.f2p'] = false;
  assert.equal(JSON.parse(exportOriginal(state).rulesJSON).F2P, false);
  state.members[0].taskRules.SyntheticCutoff = 0;
  const numeric = originalTransfer(state, 'synthetic', dataset, world, { defaults: { SyntheticCutoff: 3 } });
  assert.equal(JSON.parse(numeric.rulesJSON).SyntheticCutoff, 0);
  assert.equal(JSON.parse(numeric.rulesJSON).SyntheticCutoff || false, false, 'Original UI changes a numeric zero to false');
  assert.throws(() => originalTransfer(state, 'synthetic', { ...dataset, identityNamespace: 'other' }, world), /full legacy RS3/);
  state.members[0].selected = ['12850-1'];
  assert.throws(() => exportOriginal(state), /full cell/);
});

test('journal import reuses the existing decoder and 10000-character limit, with exact long evidence retained', () => {
  for (const [chunkNotes, expected] of [['Synthetic-_-2Gjournal', 'Synthetic/journal'], ['', ''], ['x'.repeat(10000), 'x'.repeat(10000)]]) {
    const result = importOriginal({ chunks: { unlocked: {} }, rules: {}, chunkNotes });
    assert.equal(result.member.journal, expected);
  }
  const long = 'x'.repeat(10001), result = importOriginal({ chunks: { unlocked: {} }, rules: {}, chunkNotes: long });
  assert.equal(result.member.journal, undefined);
  assert.ok(result.report.records.some(row => row.reason.includes('10000')));
  assert.ok(result.state.provenance.originalPasteImports[0].gameplayText.includes(long));
});

test('numeric rule amounts preserve accepted numbers and strings in current and retained settings', () => {
  const state = initial(), amounts = { 'Kill X Amount': '1', 'Rare Drop Amount': '1000' };
  const transfer = () => originalTransfer(state, 'synthetic', dataset, world, { defaults: amounts });
  state.members[0].taskRules = { 'Kill X Amount': 250, 'Rare Drop Amount': 512 };
  assert.deepEqual(JSON.parse(transfer().rulesJSON), { 'Kill X Amount': '250', 'Rare Drop Amount': '512' });
  state.members[0].taskRules = { 'Kill X Amount': '500', 'Rare Drop Amount': '1/1024' };
  assert.deepEqual(JSON.parse(transfer().rulesJSON), state.members[0].taskRules);
  delete state.members[0].taskRules;
  state.provenance = { originalPasteImports: [{ memberId: 'synthetic', rules: [{ key: 'Kill X Amount', value: 250 }, { key: 'Rare Drop Amount', value: 512 }] }] };
  assert.deepEqual(JSON.parse(transfer().rulesJSON), { 'Kill X Amount': '250', 'Rare Drop Amount': '512' });
  state.members[0].taskRules = { 'Kill X Amount': -1, 'Rare Drop Amount': Infinity };
  assert.deepEqual(JSON.parse(transfer().rulesJSON), amounts);
});

test('retained-only original rules survive repeated backup restore provenance without replacing newer imports', () => {
  const { state } = importOriginal({ chunks: { unlocked: { '12850': '12850' } }, rules: { Extra: false } });
  const before = exportOriginal(state);
  state.provenance = { restore: { incomingProvenance: { restore: { incomingProvenance: state.provenance } } } };
  assert.equal(exportOriginal(state).rulesJSON, before.rulesJSON);
  state.provenance.originalPasteImports = [{ memberId: state.members[0].id, rules: [{ key: 'Extra', value: true }] }];
  assert.equal(JSON.parse(exportOriginal(state).rulesJSON).Extra, true);
});

test('empty maps never offer the original importer an empty token that it would convert to grid cell zero', () => {
  const state = initial(); state.members[0].selected = ['12594']; state.members[0].journal = 'Synthetic empty-map journal';
  const result = exportOriginal(state);
  assert.equal(result.url, null); assert.match(result.message, /grid cell zero/);
  assert.equal(result.journal, state.members[0].journal); assert.ok(result.rulesJSON);
});
