import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { transferDigest } = await import('../app/save-transfer.mjs');
const { encodeImportBytes, decodeImportBytes } = await import('../app/import-bytes.mjs');

test('indexed hook dictionaries preserve property mutations and replacement returns', async () => {
  const input = { keep: 1, removed: 2, readded: 3, hidden: 4, nested: { value: 5 } };
  const decoded = await decodeImportBytes(await encodeImportBytes(input), { indexDictionaries: true });
  delete decoded.removed;
  delete decoded.readded; decoded.readded = 6;
  Object.defineProperty(decoded, 'hidden', { enumerable: false });
  Object.defineProperty(decoded, '__proto__', { value: 'synthetic', enumerable: true });
  decoded.added = 7; decoded.nested.value = 8;
  const returned = { ...decoded, nested: decoded.nested };
  const result = await decodeImportBytes(await encodeImportBytes(returned));
  assert.deepEqual(result, JSON.parse('{"keep":1,"nested":{"value":8},"readded":6,"__proto__":"synthetic","added":7}'));
});

test('one million small provenance entries with a no-op hook survive preview and apply', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-wide-hook-'));
  const roster = [{ id: 'one', name: 'Synthetic player' }];
  let calls = 0;
  const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false,
    prepareImportState(state) { calls++; return state; } });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = createGroupState(roster);
  state.provenance = { syntheticWide: {} };
  for (let i = 0; i < 1_000_000; i++) state.provenance.syntheticWide[`entry-${i}`] = i % 10;
  const input = serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state } });
  const inputBytes = input.length;
  const prepared = await store.prepareTransfer(input, { route: '/api/restore/preview',
    dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } });
  JSON.stringify(prepared.response); transferDigest(prepared.response);
  assert.equal(calls, 1);
  await store.applyTransfer(prepared.ticket, 0);
  const exported = JSON.parse((await store.exportBackup()).bytes);
  assert.equal(Object.keys(exported.state.provenance.restore.incomingProvenance.syntheticWide).length, 1_000_000);
  assert.equal(exported.state.provenance.restore.incomingProvenance.syntheticWide['entry-999999'], 9);
  t.diagnostic(JSON.stringify({ entries: 1_000_000, inputBytes, previewBytes: Buffer.byteLength(JSON.stringify(prepared.response)) }));
});
