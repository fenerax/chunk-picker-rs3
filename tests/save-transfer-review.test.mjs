import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { createGroupState } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { runImportJob } from '../app/import-jobs.mjs';
import { transferDigest } from '../app/save-transfer.mjs';
import { createScreenDialogs } from '../app/web/screen-dialogs.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';

test('apply seeds worker fingerprints before subscribers without trusting uploaded digest metadata', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'synthetic-import-fingerprint-'));
  const roster = [{ id: 'one', name: 'Synthetic player' }];
  const world = { chunks: new Map([['100', { id: '100' }]]), neighbors: new Map(), walkable: new Set(['100']), f2p: new Set(['100']) };
  const store = await openStore({ dataDir, initialState: createGroupState(roster), world, retention: false });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  store.getGameplayFingerprint(); void store.getCalculationSnapshot().taskInputKey;
  const incoming = createGroupState(roster);
  incoming.tasks = [{ id: 'custom:synthetic', category: 'Custom', label: 'Synthetic fingerprint marker' }];
  incoming.provenance = { syntheticFingerprintMarker: true };
  const prepared = await store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state: incoming },
    fingerprints: { gameplay: 'Untrusted upload metadata' } }),
  { world, route: '/api/restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} } });
  let observed, listenerError;
  store.subscribe(() => {
    try { observed = { gameplay: store.getGameplayFingerprint(), tasks: store.getCalculationSnapshot().taskInputKey }; }
    catch (error) { listenerError = error; }
  });
  const stringify = JSON.stringify;
  JSON.stringify = (value, ...args) => {
    if (value?.restore?.incomingProvenance?.syntheticFingerprintMarker
      || Array.isArray(value) && value[0]?.label === 'Synthetic fingerprint marker') throw new Error('Static tree walked on writer');
    return stringify(value, ...args);
  };
  let applied;
  try { applied = await store.applyTransfer(prepared.ticket, 0); }
  finally { JSON.stringify = stringify; }
  assert.equal(listenerError, undefined);
  assert.equal(observed.gameplay, createGameplayFingerprint()(applied.state));
  assert.equal(observed.tasks, taskReuseInputKey(store.getCalculationSnapshot().state));
  const before = observed;
  await store.commandSerialized({ type: 'set-note', memberId: 'one', chunkId: '100', note: 'Synthetic changed note' }, 1);
  assert.notEqual(observed.gameplay, before.gameplay);
  assert.equal(observed.tasks, before.tasks);
});

test('queue wait has its own busy deadline and does not consume active checking time', async () => {
  const wedge = runImportJob({}, { workerURL: new URL('data:text/javascript,while(true){}'), timeoutMs: 500 });
  const wedged = assert.rejects(wedge, error => error.status === 422);
  const expired = runImportJob({}, { queueWaitMs: 30, userId: 'expired' });
  await assert.rejects(expired, error => error.status === 503 && error.retryAfter === 5 && /busy.*try again/i.test(error.message));
  const budget = { remainingMs: 5000 };
  const next = runImportJob({ kind: 'parse', chunks: [Buffer.from('{}')], headers: { 'content-type': 'application/json' } },
    { budget, timeoutMs: 5000, userId: 'expired' });
  await wedged;
  assert.deepEqual((await next).body, {});
  assert.ok(budget.remainingMs > 0);
});

test('batched transfer digest preserves exact JSON bytes across Unicode batch boundaries', () => {
  for (const text of ['x'.repeat(65525) + '🎲'.repeat(40), 'x'.repeat(65526) + '🎲'.repeat(40), '\ud800']) {
    const value = { text, omitted: undefined, array: [undefined, null, false] };
    assert.equal(transferDigest(value), createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  }
});

test('heavy-note preview retains required renderer fields and exact counts', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-heavy-note-preview-'));
  const initial = createGroupState([{ id: 'one', name: 'Synthetic player' }]);
  const store = await openStore({ dataDir: directory, initialState: initial, retention: false });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = createGroupState([{ id: 'one', name: 'Synthetic player' }]);
  state.tasks = Array.from({ length: 150 }, (_, i) => ({ id: `custom:${i}`, label: `Synthetic ${i}`, category: 'Custom' }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  state.members[0].notes = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i + 100), 'n'.repeat(600)]));
  const preview = await store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state } }), {
    route: '/api/restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() },
  });
  const incoming = preview.response.state.members[0];
  assert.ok(Array.isArray(incoming.completedTasks));
  assert.equal(incoming.counts.completedTasks, 150);
  assert.equal(incoming.counts.notes, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(preview.response.state)) < 16 * 1024);
  const el = (tag, text = '') => ({ tag, text, children: [], append(...children) { this.children.push(...children); } });
  const c = { el, advanced: () => false, details: el, list: values => el('ul', values.join(' ')) };
  createScreenDialogs(c);
  const rendered = c.replacementSummary(preview.response.preview, preview.response.state);
  assert.match(JSON.stringify(rendered), /150 personal game completions/);
  assert.doesNotThrow(() => c.replacementSummary(preview.response.preview, { members: [{ id: 'one' }] }));
});

test('import hooks keep migration context and cannot publish an invalid returned state', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-hook-context-'));
  const roster = [{ id: 'one', name: 'Synthetic player' }];
  const world = { chunks: new Map() }, migration = { definitions: { challenges: {} }, taskMap: {}, catalogue: [] };
  let invalid = false;
  const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false, world,
    prepareImportState(input, context) {
      assert.equal(context.operation, 'replace');
      assert.equal(context.world, world);
      assert.equal(context.migration.state, input);
      assert.equal(Object.isFrozen(input.members[0]), false);
      assert.deepEqual(context.catalogue, migration.catalogue);
      if (invalid) return { ...input, members: null };
      (input.members[0].notes ??= {})['100'] = 'Synthetic context note';
    } });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const input = () => serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state: createGroupState(roster) } });
  const options = { route: '/api/restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world, migration };
  const prepared = await store.prepareTransfer(input(), options);
  await store.applyTransfer(prepared.ticket, 0);
  assert.equal((await store.backup()).state.members[0].notes['100'], 'Synthetic context note');
  invalid = true;
  await assert.rejects(store.prepareTransfer(input(), options), error => error.status === 400);
  assert.equal(store.getInfo().revision, 1);
});

test('32-member heavy-note preview reserves every roster entry, required field and exact count', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-roster-note-preview-'));
  const roster = Array.from({ length: 32 }, (_, i) => ({ id: `member-${i}`, name: `Synthetic player ${i}` }));
  const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = createGroupState(roster);
  for (const member of state.members) member.notes = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(100 + i), 'n'.repeat(600)]));
  const preview = await store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state } }), {
    route: '/api/restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() },
  });
  const response = preview.response;
  assert.equal(response.preview.members.length, 32);
  assert.equal(response.state.members.length, 32);
  assert.equal(response.sourceRoster.length, 32);
  assert.ok(Array.isArray(response.preview.rules.changed));
  assert.ok(Array.isArray(response.preview.warnings));
  assert.ok(Array.isArray(response.warnings));
  assert.deepEqual(response.preview.taskCounts, { added: 0, removed: 0, changed: 0 });
  for (const [i, member] of response.state.members.entries()) {
    assert.equal(member.id, roster[i].id);
    assert.equal(member.counts.notes, 100);
    assert.equal(response.preview.members[i].notes.addedCount, 100);
    assert.equal(response.preview.members[i].unlocked.addedCount, 0);
  }
  const bytes = Buffer.byteLength(JSON.stringify(response));
  assert.ok(bytes < 256 * 1024, `preview ${bytes} bytes`);
  const el = (tag, text = '') => ({ tag, text, children: [], append(...children) { this.children.push(...children); } });
  const c = { el, advanced: () => false, details: el, list: values => el('ul', values.join(' ')) };
  createScreenDialogs(c);
  assert.doesNotThrow(() => c.replacementSummary(response.preview, response.state));
  assert.doesNotThrow(() => c.replacementSummary({ members: [{ id: roster[0].id }] }, response.state));
  await store.applyTransfer(preview.ticket, 0);
  for (const member of (await store.backup()).state.members) assert.equal(Object.keys(member.notes).length, 100);
  t.diagnostic(JSON.stringify({ members: 32, notesPerMember: 100, noteCharacters: 600, previewBytes: bytes }));
});
