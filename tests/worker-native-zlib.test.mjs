import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const url = file => new URL(`../${file}`, import.meta.url).href;

for (const mode of ['thread', 'process']) for (const site of ['owner', 'partner', 'dataset']) {
  test(`retirement constructs no native zlib handle (${mode}, ${site})`, () => {
    // A disposable process contains the pre-fix native abort. This getter is
    // evaluated by the REAL Zlib constructor after new binding.Zlib(), while
    // evaluating handle.init() arguments. No JavaScript exception can catch it.
    const preload = `
      import zlib from 'node:zlib';
      import { syncBuiltinESMExports } from 'node:module';
      import { isMainThread, parentPort } from 'node:worker_threads';
      if (!isMainThread) {
        const name = ${JSON.stringify(site)} === 'dataset' ? 'gunzipSync' : 'gzipSync';
        const original = zlib[name];
        for (const key of Object.keys(zlib)) {
          if (key !== name && typeof zlib[key] === 'function' && /gzip|gunzip|deflate|inflate|brotli|zstd|unzip/i.test(key)) {
            Object.defineProperty(zlib, key, { value: () => { throw new Error('Unexpected worker codec: ' + key); } });
          }
        }
        let calls = 0;
        zlib[name] = (bytes, options) => {
          const pause = ++calls === ${site === 'partner' ? 4 : 1};
          return original(bytes, {
            ...options,
            get rejectGarbageAfterEnd() {
              if (pause) {
                parentPort.postMessage({ type: 'uninitialized-handle' });
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
              }
              return false;
            },
          });
        };
        syncBuiltinESMExports();
      }
    `;
    const source = `
      import assert from 'node:assert/strict';
      import { Worker } from 'node:worker_threads';
      import { ProcessWorker } from ${JSON.stringify(url('app/tasks/process-worker.mjs'))};
      import { mkdtemp, mkdir, rm } from 'node:fs/promises';
      import { createGroupState } from ${JSON.stringify(url('app/core/state.mjs'))};
      import { buildWorld } from ${JSON.stringify(url('app/data/world.mjs'))};
      import { selectedDataset } from ${JSON.stringify(url('app/dataset-runtime.mjs'))};
      import { resolveDataset } from ${JSON.stringify(url('app/datasets.mjs'))};
      import { writeScaledCompanion } from ${JSON.stringify(url('scripts/perf/scale-dataset.mjs'))};
      import { createUnlockResultCache } from ${JSON.stringify(url('app/tasks/unlock-reuse.mjs'))};
      import { gzipSync, crc32, constants } from 'node:zlib';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      // ProcessWorker forks a script; never inherit this harness's --eval.
      process.execArgv.length = 0;
      // Preserve the adapter's native abort evidence, normally hidden by its
      // production stdio policy. This changes no worker or termination logic.
      const fork = childProcess.fork;
      childProcess.fork = (file, args, options) => {
        const child = fork(file, args, { ...options, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        child.stderr.pipe(process.stderr);
        return child;
      };
      syncBuiltinESMExports();
      const site = ${JSON.stringify(site)};
      let scratch, worker;
      try {
        let dataset = selectedDataset;
        if (site === 'dataset') {
          await mkdir('.local', { recursive: true });
          scratch = await mkdtemp('.local/worker-native-zlib-');
          const made = await writeScaledCompanion(scratch, { scale: 1 });
          dataset = await resolveDataset({ datasetId: 'duo-legacy',
            profilePath: made.environment.RS3_DATASET_PROFILE, profileSha256: made.environment.RS3_DATASET_PROFILE_SHA256,
            packsDir: made.environment.RS3_PACKS_DIR, selectionPath: made.environment.RS3_PACK_SELECTION });
        }
        const definitions = { chunks: { '100': {}, '116': {}, '132': {} },
          walkableChunks: ['100', '116', '132'], walkableChunksF2P: ['100', '116', '132'],
          challenges: { Quest: { 'Present quest': { Chunks: ['100'] }, 'Future quest': { Chunks: ['116'] } } } };
        const world = buildWorld(definitions, { cacheWalking: false });
        const data = { definitions, world: { chunks: world.chunks, surface: world.surface },
          datasetSelection: { ...dataset.workerSelection(), datasetId: dataset.datasetId }, datasetDigest: dataset.digest,
          datasetOptions: { cacheWalking: false, reviewedOverlays: false } };
        const probeImport = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(preload)});
        worker = ${JSON.stringify(mode)} === 'thread'
          ? new Worker(new URL(${JSON.stringify(url('app/tasks/worker.mjs'))}), { workerData: data, execArgv: ['--import', probeImport] })
          : new ProcessWorker(data, { probeImport });
        const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['100'] },
          { id: 'player2', name: 'Player 2', unlocked: ['132'] }]);
        const checked = await new Promise((resolve, reject) => {
          worker.on('error', reject);
          worker.on('exit', code => reject(new Error('Unexpected worker exit: ' + code)));
          worker.on('message', async message => {
            try {
              if (message.type === 'uninitialized-handle') {
                console.error('Terminating at real native pre-init boundary: ' + site);
                await worker.terminate();
                reject(new Error('Worker constructed a native zlib handle'));
              } else if (message.type === 'ready') {
                assert.equal(message.datasetDigest, dataset.digest);
                if (site === 'dataset') resolve('checked');
                else worker.postMessage({ id: 1, type: 'predict', state, memberId: 'player1', chunkId: '116', predictionProgress: true });
              } else if (message.id === 1) {
                assert.equal(message.error, undefined, JSON.stringify(message.error));
                const values = [message.unlockReuse, message.partnerUnlockReuse].filter(Boolean);
                if (message.type === 'prediction-prepared') assert.equal(values.length, 1);
                else assert.equal(values.length, 2);
                // The scheduler's existing admission fallback must produce the
                // exact old unfinished gzip bytes and CRC for both projections.
                const cache = createUnlockResultCache({ limit: 4, byteLimit: 1024 * 1024 });
                assert.ok(cache.admitMany(values));
                for (const value of values) {
                  if (message.type !== 'prediction-prepared') assert.equal(value.gzipJSONPrefixes, undefined);
                  const retained = cache.get(value.taskInputKey, value.memberId, 1);
                  for (const key of ['playJSON', 'duoJSON', 'duoSidebarJSON']) {
                    const prefix = Buffer.from(value[key]).subarray(0, -1);
                    assert.deepEqual(retained.gzipJSONPrefixes[key], gzipSync(prefix, { level: 1, finishFlush: constants.Z_SYNC_FLUSH }));
                    assert.deepEqual(retained.gzipJSONPrefixMetadata[key], { crc32: crc32(prefix), rawLength: prefix.length });
                    assert.deepEqual(retained[key], Buffer.from(value[key]));
                  }
                }
                if (message.type !== 'prediction-prepared') resolve('checked');
              }
            } catch (error) { reject(error); }
          });
        });
        assert.equal(checked, 'checked');
        await worker.terminate();
        console.log('checked ' + ${JSON.stringify(mode)} + ' ' + site);
      } finally {
        await worker?.terminate();
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
    `;
    const env = { ...process.env, RS3_DATASET: 'open-starter' };
    for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256']) delete env[key];
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8', env, windowsHide: true,
    });
    assert.equal(child.status, 0, `status=${child.status}, signal=${child.signal}\n${child.stderr}\n${child.stdout}`);
    assert.match(child.stdout, new RegExp(`checked ${mode} ${site}`));
  });
}
