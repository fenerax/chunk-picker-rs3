import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { realisticSave } from './helpers/save-transfer-responsiveness.mjs';
// This is a synthetic storage/transport benchmark, independent of installed
// legacy metadata. Worker isolates inherit the same explicit small dataset.
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { readBackupRequest } = await import('../app/backup-transfer.mjs');
const { runImportJob, reserveImportUser, IMPORT_QUEUE_LIMIT } = await import('../app/import-jobs.mjs');
const { encodeImportBytes, decodeImportBytes } = await import('../app/import-bytes.mjs');

const run = promisify(execFile);
const roster = [{ id: 'one', name: 'Synthetic player' }];

// A fresh process per size prevents the previous save/Undo/baseline heap from
// affecting the next measurement. The child retains every assertion and ceiling.
for (const maximum of [false, true]) test(`${maximum ? 'maximum accepted' : 'real-sized'} synthetic preview AND apply keep the main thread responsive`, async t => {
  const { stdout } = await run(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/save-transfer-responsiveness.mjs', import.meta.url)), String(maximum)],
    { env: process.env, windowsHide: true, maxBuffer: 1024 * 1024 });
  t.diagnostic(stdout.trim());
});

test('four users can preview realistic 49 MiB saves without spending their active budget in the queue', async t => {
  let document = realisticSave();
  const bytes = Buffer.from(JSON.stringify({ backup: document })); document = undefined;
  const stores = [];
  for (let i = 0; i < IMPORT_QUEUE_LIMIT; i++) {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-queued-transfer-'));
    const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false });
    stores.push(store);
    t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  }
  const start = performance.now();
  const results = await Promise.all(stores.map(async (store, i) => {
    const request = Object.assign(Readable.from([bytes]), { headers: { 'content-type': 'application/json' }, complete: true });
    const parsed = await readBackupRequest(request, { defer: true });
    const preview = await store.prepareTransfer(parsed.input, { importBudget: parsed.budget, importUserId: `queued-user-${i}`,
      dataset: { datasetId: 'duo-legacy', capabilities: {} }, route: '/api/restore/preview', world: { chunks: new Map() } });
    assert.equal(preview.response.preview.taskCounts.added, 20_503);
    return Math.round(performance.now() - start);
  }));
  t.diagnostic(`Four realistic previews completed after ${results.join(', ')} ms`);
});

test('transfer bytes preserve proto keys as own data, metadata, and long string ropes', async () => {
  const source = { value: JSON.parse('{"__proto__":{"safe":true}}'), text: 'synthetic'.repeat(100_000), map: new Map([[undefined, new Set(['a'])]]),
    topology: new Uint32Array([65_536, 4_294_967_295]) };
  source.sameTopology = source.topology; source.textCopies = [source.text, source.text];
  const expected = structuredClone(source);
  const encoded = await encodeImportBytes(source);
  assert.ok(encoded.buffers.reduce((total, bytes) => total + bytes.byteLength, 0) < source.text.length * 2, 'Repeated immutable evidence strings cross the worker boundary once.');
  const decoded = await decodeImportBytes(structuredClone(encoded, { transfer: encoded.buffers }));
  assert.deepEqual(decoded, expected);
  assert.equal(Object.getPrototypeOf(decoded.value), Object.prototype);
  assert.equal(Object.prototype.safe, undefined);
});

test('queue bounds users and jobs, rejects a duplicate, and releases failed admissions', async () => {
  const releases = Array.from({ length: IMPORT_QUEUE_LIMIT }, (_, i) => reserveImportUser(`synthetic-${i}`));
  assert.throws(() => reserveImportUser('synthetic-0'), error => error.status === 503 && /busy/.test(error.message));
  assert.throws(() => reserveImportUser('synthetic-overflow'), error => error.status === 503);
  releases.forEach(release => release());
  reserveImportUser('synthetic-0')();
  const wedge = new URL('data:text/javascript,while(true){}');
  const job = runImportJob({}, { userId: 'synthetic-user', workerURL: wedge, timeoutMs: 100 });
  await assert.rejects(runImportJob({}, { userId: 'synthetic-user' }), error => error.status === 503);
  const queued = Array.from({ length: IMPORT_QUEUE_LIMIT - 1 }, (_, i) => runImportJob({ kind: 'parse', chunks: [Buffer.from('{}')], headers: { 'content-type': 'application/json' } }, { userId: `other-${i}` }));
  await assert.rejects(runImportJob({}, { userId: 'overflow' }), error => error.status === 503);
  await assert.rejects(job, error => error.status === 422);
  await Promise.all(queued);
  assert.deepEqual((await runImportJob({ kind: 'parse', chunks: [Buffer.from('{}')], headers: { 'content-type': 'application/json' } }, { userId: 'synthetic-user' })).body, {});
});
