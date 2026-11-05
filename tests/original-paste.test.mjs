import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { serialize } from 'node:v8';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { readBackupRequest } = await import('../app/backup-transfer.mjs');
const { createTransferReviews } = await import('../app/save-transfer.mjs');
const { projectBrowserState } = await import('../app/web/browser-state.mjs');
const { createOriginalPasteUpload } = await import('../app/web/backup-transfer.mjs');
const { readOriginalPaste, normalizeOriginalPaste, originalChunkList, originalRuleDecision, MAX_ORIGINAL_PASTE_BYTES } = await import('../app/original-paste.mjs');
const dataset = { datasetId: 'duo-legacy', coordinateSystem: 'surface-grid-v1', capabilities: {} };
const world = { chunks: new Map(['12850', '12594', '13106', '12338'].map(id => [id, { id }])), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
const document = extra => ({ format: 'rs3-original-paste', chunksText: '12850', rulesText: '{}', ...extra });
const currentState = () => {
  const state = createGroupState([{ id: 'destination', name: 'Destination player' }, { id: 'other', name: 'Other player' }]);
  state.tasks = [
    { id: 'rs3:task:synthetic-ore', category: 'Mining', label: 'Synthetic ore' },
    { id: 'rs3:task:synthetic-tree', category: 'Woodcutting', label: 'Synthetic tree' },
  ];
  return state;
};
const migration = { taskMap: { 'Synthetic ore': 't_1', 'Synthetic tree': 't_1' }, catalogue: currentState().tasks.map(task => ({ ...task, rawLabel: task.label })) };
const gameplay = () => ({ chunks: { selected: { '12594': 2, '*fb*_13106': 1 }, potential: { '12338': '12338' } },
  chunkinfo: { checkedAllTasks: { Mining: { t_1: true, t_unknown: true }, Woodcutting: { t_1: true } },
    backlog: { Mining: { t_1: '' } }, favoriteTasks: { Mining: { t_1: true } } },
  chunkNotes: 'Synthetic-_-2Gjournal', chunkOrder: { '1': 12850 }, futureField: { nested: ['unrecognized'] } });

test('CSV and documented chunk URL decode locally, with original selection ordering', () => {
  assert.deepEqual(originalChunkList('12850,12594,12850'), { unlocked: ['12850', '12594'], selected: [] });
  assert.deepEqual(originalChunkList('https://gitgeddes.github.io/ChunkPicker/?fv'), { unlocked: ['12850'], selected: [] });
  assert.throws(() => originalChunkList('https://other.example/?fv'), /comma-separated/);
  assert.throws(() => originalChunkList('not-a-map-code'), /later browser-read/);
  assert.throws(() => originalChunkList('12850,NaN'), /comma-separated/);
  // All 2,303 documented grid positions, using independent one-cell tokens.
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let index = 0; index < 2303; index++) {
    let value = index, token = '';
    do { token = alphabet[value % 62] + token; value = Math.floor(value / 62); } while (value);
    assert.deepEqual(originalChunkList(`gitgeddes.github.io/ChunkPicker/?${token}`).unlocked,
      [String(7494 + 256 * (index % 47) - Math.floor(index / 47))]);
  }
});

test('category-aware checks, ranks, Firebase keys and empty backlog reasons survive; unknowns stay reported', () => {
  const input = document({ gameplayText: JSON.stringify(gameplay()), includeTasks: true, rulesText: '{"F2P":true,"Future rule":false}', includeRules: true });
  const result = normalizeOriginalPaste(input, { current: currentState(), world, dataset, migration });
  const member = result.state.members[0];
  assert.deepEqual(member.selected, ['13106', '12594']);
  assert.deepEqual(member.pendingRoll, ['12338']);
  assert.deepEqual(member.completedTasks, []);
  assert.deepEqual(member.taskStatus['rs3:task:synthetic-ore'], { challengeCompleted: true, backlogged: true, backlogReason: '', favorite: true });
  assert.equal(member.taskStatus['rs3:task:synthetic-tree'].challengeCompleted, true);
  assert.ok(result.report.records.some(row => row.key === 't_unknown'));
  assert.equal(result.archive.gameplayText, input.gameplayText);
  assert.equal(result.archive.rules.length, 2);
  assert.ok(result.archive.rules.every(row => row.outcome === 'unsupported' && !row.applied));
  assert.equal(member.sourceMapId, null);
  assert.equal(result.report.counts.dropped, 0);
});

test('every rule gets an explicit decision; absent keys inherit and tasks/rules are opt-in', () => {
  const metadata = { defaults: { Quests: true, Partial: true }, definitions: [{ id: 'Quests', type: 'boolean' }, { id: 'Partial', type: 'boolean' }],
    behaviorFor: key => ({ status: key === 'Quests' ? 'category-gate' : 'partial', detail: 'Synthetic declared goal coverage.' }) };
  assert.equal(originalRuleDecision('Quests', false, metadata).outcome, 'equivalent');
  assert.equal(originalRuleDecision('Quests', 'false', metadata).outcome, 'unsupported');
  for (const key of ['F2P', 'Partial', 'Unknown']) assert.equal(originalRuleDecision(key, true, metadata).outcome, 'unsupported');
  const result = normalizeOriginalPaste(document({ gameplayText: JSON.stringify(gameplay()) }), { current: currentState(), world, dataset, migration });
  assert.deepEqual(result.state.members[0].taskStatus, {});
  assert.equal(result.state.members[0].taskRules, undefined);
  assert.throws(() => normalizeOriginalPaste(document(), { current: currentState(), world, dataset: { ...dataset, datasetId: 'open-f2p' } }), /full legacy/);
});

test('unknown chunks, huge values and unknown keys remain exact only in provenance; invalid structure and credentials fail closed', () => {
  const huge = 'x'.repeat(1024 * 1024);
  const input = document({ chunksText: '12850,999999', rulesText: JSON.stringify({ [huge]: huge }), gameplayText: JSON.stringify({ custom: huge }) });
  const result = normalizeOriginalPaste(input, { current: currentState(), world, dataset });
  assert.deepEqual(result.state.members[0].unlocked, ['12850']);
  assert.ok(result.report.records.some(row => row.key === '999999'));
  assert.equal(result.archive.rulesText, input.rulesText);
  const inspect = value => { if (typeof value === 'string') assert.ok(value.length <= 512); else if (value && typeof value === 'object') for (const child of Object.values(value)) inspect(child); };
  inspect(result.report);
  assert.ok(Buffer.byteLength(JSON.stringify(result.report)) < 256 * 1024);
  for (const gameplayText of ['null', '[]', '{"chunks":"bad"}', '{"nested":{"password":"synthetic"}}']) assert.throws(() => readOriginalPaste(document({ gameplayText })));
  assert.throws(() => readOriginalPaste(document({ rulesText: '['.repeat(129) + '0' + ']'.repeat(129) })), /nesting/);
  assert.throws(() => readOriginalPaste(document({ gameplayText: huge.repeat(8) })), error => error.status === 413);
});

test('decoded rule collisions, conflicting backlog aliases and long reasons are explicitly retained', () => {
  const captured = { chunkinfo: { backlog: { Mining: { t_1: 'first-_-2Greason', 'rs3:task:synthetic-ore': 'different' } } } };
  const result = normalizeOriginalPaste(document({ gameplayText: JSON.stringify(captured), includeTasks: true,
    rulesText: '{"Quests":true,"-_-51uests":false}', includeRules: true }), { current: currentState(), world, dataset, migration });
  assert.equal(result.state.members[0].taskStatus['rs3:task:synthetic-ore'].backlogged, undefined);
  assert.ok(result.report.records.some(row => /Conflicting backlog/.test(row.reason)));
  assert.ok(result.archive.rules.every(row => row.outcome === 'unsupported'));
  const long = 'r'.repeat(1024);
  const sampled = normalizeOriginalPaste(document({ gameplayText: JSON.stringify({ chunkinfo: { backlog: { Mining: { t_1: long } } } }), includeTasks: true }), { current: currentState(), world, dataset, migration });
  assert.equal(sampled.state.members[0].taskStatus['rs3:task:synthetic-ore'].backlogReason.length, 512);
  assert.ok(sampled.report.records.some(row => /bounded sample/.test(row.reason)));
  const decoded = normalizeOriginalPaste(document({ gameplayText: JSON.stringify({ chunkinfo: { backlog: { Mining: { t_1: 'first-_-2Greason' } } } }), includeTasks: true }), { current: currentState(), world, dataset, migration });
  assert.equal(decoded.state.members[0].taskStatus['rs3:task:synthetic-ore'].backlogReason, 'first/reason');
});

async function storeFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-original-paste-'));
  const initial = currentState(); initial.members[0].unlocked = ['12594']; initial.members[1].unlocked = ['13106'];
  initial.members[0].taskRules = { retainedRule: true };
  const store = await openStore({ dataDir: directory, initialState: initial, world });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const options = { route: '/api/member-restore/preview', dataset, world, originalPasteEnabled: true, migration };
  return { store, options, initial };
}

test('paste uses existing roster review, replacement, retained save, durable provenance and Undo', async t => {
  const { store, options, initial } = await storeFixture(t);
  const input = document({ gameplayText: JSON.stringify(gameplay()), includeTasks: true });
  let body = { document: input, memberId: 'destination' };
  const mapping = await store.prepareTransfer(serialize(body), options);
  assert.equal(mapping.response.mappingRequired, true);
  body.sourceMemberId = 'original_paste';
  const reviewed = await store.prepareTransfer(serialize(body), options);
  assert.equal(reviewed.response.transferReport.counts.dropped, 0);
  const reviews = createTransferReviews(), actor = { id: 'synthetic-session' };
  body.previewToken = reviews.preview(body, actor, 0); reviews.check(body, actor, 0);
  assert.throws(() => reviews.check({ ...body, document: document({ chunksText: '12594' }) }, actor, 0), error => error.status === 409);
  const applied = await store.applyTransfer(reviewed.ticket, 0);
  assert.deepEqual(applied.state.members[1], initial.members[1]);
  assert.equal(applied.state.members[0].name, initial.members[0].name);
  assert.deepEqual(applied.state.members[0].taskRules, initial.members[0].taskRules);
  assert.deepEqual(applied.state.members[0].unlocked, ['12850']);
  assert.equal(applied.state.provenance.originalPasteImports[0].gameplayText, input.gameplayText);
  assert.equal((await store.listBackups()).length, 1);
  assert.equal(projectBrowserState(applied.state).provenance.originalPasteImports, undefined);
  const portable = await store.backup();
  assert.equal(portable.state.provenance.originalPasteImports[0].gameplayText, input.gameplayText);
  const decoded = await readBackupRequest(Object.assign(Readable.from([Buffer.from(JSON.stringify({ backup: portable }))]), { headers: { 'content-type': 'application/json' }, complete: true }), { defer: true });
  const nativeReview = await store.prepareTransfer(decoded.input, { ...options, route: '/api/restore/preview', originalPasteEnabled: false });
  assert.equal(nativeReview.response.transferReport.counts.dropped, 0);
  await store.command({ type: 'undo' }, 1);
  assert.deepEqual(store.getState().members, initial.members);
  assert.equal(store.getState().provenance.originalPasteImports[0].gameplayText, input.gameplayText);
  await assert.rejects(store.applyTransfer(reviewed.ticket, 0));
  await assert.rejects(store.prepareTransfer(serialize(body), { ...options, originalPasteEnabled: false }), error => error.status === 404);
});

test('browser paste transport uses normal bounded upload/parser and preserves split Unicode', async () => {
  const chunksText = '12850', rulesText = JSON.stringify({ synthetic: 'x'.repeat(16370) + '🎲' });
  const upload = await createOriginalPasteUpload({ chunksText, rulesText }, { memberId: 'destination' });
  const request = await upload.toBackupRequest();
  const stream = Object.assign(Readable.from([Buffer.from(await request.body.arrayBuffer())]), { headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value])), complete: true });
  const parsed = await readBackupRequest(stream, { defer: true });
  assert.equal(parsed.body.originalPaste, true);
  assert.ok(parsed.input instanceof Uint8Array);
  await assert.rejects(createOriginalPasteUpload({ rulesText: 'é'.repeat(MAX_ORIGINAL_PASTE_BYTES / 2 + 1) }, {}), /8 MiB/);
});
