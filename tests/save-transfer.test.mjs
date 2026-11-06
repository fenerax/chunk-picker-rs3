import test from 'node:test';
import assert from 'node:assert/strict';
import { originalChunkURL, legacyChunkIndex } from '../app/original-chunk-url.mjs';
import { mapTransferRoster, requireTransferDataset, transferManifest, transferReport, createTransferReviews } from '../app/save-transfer.mjs';
import { createGroupState, validateState, applyCommand } from '../app/core/state.mjs';
import { reconcilePluginHandled } from '../app/storage/plugin-handled.mjs';

const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, coordinateSystem: 'surface-grid-v1', identityNamespace: 'rs3', digest: 'a'.repeat(64) };
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Independent test decoder for one-token-per-index URLs; no original code.
const decode = url => url.split('?')[1].split(',').filter(Boolean).map(token => {
  const index = [...token].reduce((n, char) => n * 62 + alphabet.indexOf(char), 0);
  return String(7494 + 256 * (index % 47) - Math.floor(index / 47));
});

test('original chunk URL round trips every synthetic cell, including four corners', () => {
  const ids = Array.from({ length: 2303 }, (_, i) => String(7494 + 256 * (i % 47) - Math.floor(i / 47)));
  const world = { chunks: new Map(ids.map(id => [id, {}])) };
  assert.deepEqual(decode(originalChunkURL(ids, dataset, world)), ids);
  for (const index of [0, 46, 2256, 2302]) assert.equal(legacyChunkIndex(ids[index]), index);
  assert.equal(originalChunkURL(['12850'], dataset, world), 'https://gitgeddes.github.io/ChunkPicker/?fv');
  assert.equal(originalChunkURL([], dataset, world), 'https://gitgeddes.github.io/ChunkPicker/?');
});

test('chunk URL refuses sections, unsafe numbers, out-of-grid IDs and every other contract', () => {
  for (const id of ['7494-1', '0', '-1', '9007199254740993', '7445', '7238', '19526', '7495']) assert.throws(() => legacyChunkIndex(id));
  const world = { chunks: new Map([['12850', {}], ['7445', {}]]) };
  assert.throws(() => originalChunkURL(['12851'], dataset, world), /not a full cell/);
  assert.throws(() => originalChunkURL(['7445'], dataset, world), /outside/);
  for (const contract of [{ datasetId: 'open-starter' }, { datasetId: 'open-f2p' }, { coordinateSystem: 'other' }, { identityNamespace: 'other' }, { datasetContractVersion: 2 }]) {
    assert.throws(() => originalChunkURL(['12850'], { ...dataset, ...contract }, world), /full legacy RS3/);
  }
});

test('dataset checks refuse ID, digest, contract, namespace and coordinate mismatches atomically', () => {
  const state = createGroupState([{ id: 'source', name: 'Player 1' }]);
  state.provenance = { dataset: { id: dataset.datasetId, contractVersion: 1, digest: dataset.digest } };
  const backup = { state, transfer: transferManifest(dataset, state.members) };
  requireTransferDataset(dataset, backup);
  for (const field of ['id', 'contractVersion', 'digest', 'coordinateSystem', 'identityNamespace']) {
    const broken = structuredClone(backup); broken.transfer.dataset[field] = 'different';
    assert.throws(() => requireTransferDataset(dataset, broken), /mismatch/);
  }
  assert.throws(() => requireTransferDataset({ ...dataset, datasetId: 'open-starter' }, backup), /Dataset mismatch/);
});

test('roster mapping remaps active references and preserves historical text and inverses as evidence', () => {
  let state = createGroupState([{ id: 'first', name: 'Player 1' }, { id: 'second', name: 'Player 2' }]);
  state = applyCommand(state, { type: 'add-task', task: { id: 'custom:sample', category: 'Custom', label: 'first', memberIds: ['first'] } });
  state.members[0].notes = { '100': 'first' };
  state.taskClaims = { 'custom:sample': { memberId: 'first', at: '2026-01-01T00:00:00.000Z' } };
  state.progressSnapshots = { schemaVersion: 1, memberIds: ['first', 'second'], days: [], truncated: false };
  state.members[0].skillProgress = { Mining: { source: 'game-plugin', memberId: 'first', fetchedAt: '2026-01-01T00:00:00.000Z', level: 1, xp: 0 } };
  state.groupGoals = [{ id: 'group-goal:test', text: 'first', completion: 'players', completedBy: ['first'], done: false }];
  state.finishLine = { items: {}, customItems: [{ id: 'finish:test', text: 'first', completedBy: ['second'] }] };
  state.provenance = { ...state.provenance, pluginAutoHandled: { first: { achievements: [1], items: ['custom:sample'] } } };
  assert.equal(mapTransferRoster(state, [{ id: 'owner' }]), null);
  const next = mapTransferRoster(state, [{ id: 'owner' }], { first: 'owner', second: 'partner' });
  assert.equal(next.members[0].notes['100'], 'first');
  assert.deepEqual(next.tasks[0].memberIds, ['owner']);
  assert.deepEqual(next.groupGoals[0].completedBy, ['owner']);
  assert.deepEqual(next.progressSnapshots.memberIds, ['owner', 'partner']);
  assert.equal(next.taskClaims['custom:sample'].memberId, 'owner');
  assert.equal(next.members[0].skillProgress.Mining.memberId, 'owner');
  assert.deepEqual(next.provenance.pluginAutoHandled, { owner: { achievements: [1], items: ['custom:sample'] } });
  assert.deepEqual(next.finishLine.customItems[0].completedBy, ['partner']);
  assert.deepEqual(next.provenance.transferRoster.history, state.history);
  assert.deepEqual(next.history, []);
  validateState(next);
  assert.throws(() => mapTransferRoster(state, [{ id: 'owner' }], { first: 'owner', second: 'owner' }), /different destination/);
});

test('transfer reports retain raw unknown chunk, task, rule and warning records', () => {
  const state = createGroupState([{ id: 'source', name: 'Player 1', unlocked: ['100'] }]);
  state.members[0].taskStatus = { 'custom:unknown': { backlogged: true, backlogReason: '' } };
  state.members[0].taskRules = { UnknownRule: true };
  const report = transferReport(state, { world: { chunks: new Map() }, knownRule: () => false, warnings: ['Synthetic warning'] });
  assert.deepEqual(report.records.map(row => row.field), ['unlocked', 'taskProgress', 'taskRules', 'migration']);
  assert.equal(report.records[1].rawValue.status.backlogReason, '');
  assert.equal(report.counts.dropped, 0);
  assert.equal(report.counts.preservedForReview, 4);
});

test('partial roster mapping excludes unselected suppression even when its ID collides with the destination', () => {
  const state = createGroupState([{ id: 'source', name: 'Source explorer' }]);
  state.provenance = { pluginAutoHandled: {
    source: { achievements: [1], items: ['custom:selected'] },
    owner: { achievements: [2], items: ['custom:other'] },
    absent: { achievements: [3], items: ['custom:absent'] },
  } };
  const mapped = mapTransferRoster(state, [{ id: 'owner' }], { source: 'owner' });
  assert.deepEqual(mapped.provenance.pluginAutoHandled, { owner: { achievements: [1], items: ['custom:selected'] } });
  assert.deepEqual(state.provenance.pluginAutoHandled.owner.achievements, [2], 'The source backup stays untouched');
});

test('suppression reconciliation rejects invalid or overflowing unions without dropping committed decisions', () => {
  const state = createGroupState([{ id: 'owner', name: 'Explorer' }]);
  state.provenance = { pluginAutoHandled: { owner: { achievements: [], items: Array.from({ length: 2000 }, (_, i) => `custom:${i}`) } } };
  const before = structuredClone(state);
  for (const record of [{ achievements: [], items: ['custom:overflow'] }, { achievements: [-1], items: [] }]) {
    assert.throws(() => reconcilePluginHandled(state, { provenance: { pluginAutoHandled: { owner: record } } }), /Invalid plugin suppression IDs/);
    assert.deepEqual(state, before);
  }
});

test('review receipts refuse changed uploads, mapping, identity, revision and expiration', () => {
  let now = 0; const reviews = createTransferReviews({ now: () => now });
  const body = { backup: { synthetic: true }, rosterMapping: { first: 'owner' } }, identity = { sessionId: 'synthetic-session' };
  body.previewToken = reviews.preview(body, identity, 3);
  reviews.check(body, identity, 3);
  for (const changed of [{ ...body, rosterMapping: { first: 'other' } }, { ...body, backup: {} }]) assert.throws(() => reviews.check(changed, identity, 3), /Preview/);
  assert.throws(() => reviews.check(body, { sessionId: 'other-session' }, 3), /Preview/);
  assert.throws(() => reviews.check(body, identity, 4), /Preview/);
  now = 900001; assert.throws(() => reviews.check(body, identity, 3), /Preview/);
});
