import assert from 'node:assert/strict';
import { runImportJob } from '../../app/import-jobs.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkerPreparation, preparedCollectionKey, encodePreparedCollection } from '../../app/tasks/prepared-collection.mjs';

await assert.rejects(runImportJob({ kind: 'parse', chunks: [Buffer.from('{}')], headers: { 'content-type': 'application/json' } }),
  error => error.status === 422 && error.message.includes('available memory'));

// Optional publication fails closed too: calculators can rebuild the graph,
// and an oversized inherited flag never starts an unbounded publisher.
const directory = await mkdtemp(path.join(tmpdir(), 'publisher-heap-override-'));
const data = { datasetDigest: 'synthetic', definitions: {} };
const preparation = createWorkerPreparation(data, { directory });
try {
  preparation.accept({ preparedCollection: encodePreparedCollection(preparedCollectionKey(data), {}) });
  await preparation.settled();
  assert.equal(preparation.input().collectPreparedCollection, undefined);
  assert.deepEqual(await readdir(directory), []);
} finally { await preparation.clear(); await rm(directory, { recursive: true, force: true }); }
