// Verify all members of a copied store and evenly sampled retained revisions.
// Output contains only counts, hashes, sizes and durations. No gameplay is saved.
// Run with the matching dataset/pack/defaults environment, then:
// node scripts/perf/roll-pool-equivalence.mjs --store /scratch/store --out /tmp/equivalence.json
import { cp, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createServer } from '../../app/server.mjs';
import { createRuleRegistry, evaluateRollPool, rollPoolInputKey } from '../../app/core/rules.mjs';
import { preparedDefinitionStages } from '../../app/dataset-pipeline.mjs';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { createTaskReuseFingerprint } from '../../app/tasks/unlock-reuse.mjs';

const { values } = parseArgs({ options: { store: { type: 'string' }, out: { type: 'string' }, samples: { type: 'string', default: '50' } } });
if (!values.store || !values.out) throw new Error('Use --store and --out outside the checkout.');
const count = Number(values.samples);
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid sample count.');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const root = await mkdtemp(path.join(tmpdir(), 'roll-pool-equivalence-')), dataDir = path.join(root, 'game');
let app, scheduler;
try {
  await cp(path.resolve(values.store), dataDir, { recursive: true });
  await copyFile(path.resolve(values.store) + '.dataset.json', dataDir + '.dataset.json').catch(error => { if (error.code !== 'ENOENT') throw error; });
  app = await createServer({ dataDir, port: 0, predictionPrewarm: false, retention: false });
  const current = app.store.getState(), world = app.world, dataset = app.dataset;
  await app.close();
  const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a, b) => a.revision - b.revision);
  if (backups.length < count) throw new Error('Not enough retained revisions.');
  scheduler = await createTaskScheduler({ workerData: { definitions: world.definitions, world: { chunks: world.chunks, areas: world.areas, surface: world.surface },
    datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions: { reviewedOverlays: true },
    preparedDatasetStages: preparedDefinitionStages(world.definitions) } });
  const registry = createRuleRegistry(), fingerprint = createTaskReuseFingerprint(), beforeHash = createHash('sha256'), afterHash = createHash('sha256');
  const report = { snapshotCount: 0, poolCount: 0, differenceCount: 0, canonicalBytes: 0, inlineMs: [], workerMs: [] };
  const started = performance.now();
  async function compare(state) {
    // Sampling is intentionally nonmonotonic: a pool result cannot depend on
    // a preceding request's revision or the task worker's retained snapshots.
    for (const member of state.members) {
      let start = performance.now();
      const before = canonical(evaluateRollPool(world, state, member.id, registry));
      report.inlineMs.push(performance.now() - start);
      const input = rollPoolInputKey(state, fingerprint(state));
      start = performance.now();
      const result = await scheduler.evaluate(state, member.id, 'roll-pool', undefined,
        JSON.stringify(['roll-pool', member.id, input]), input);
      const after = canonical(result.result.pool);
      report.workerMs.push(performance.now() - start);
      report.poolCount++; report.canonicalBytes += Buffer.byteLength(before);
      if (before !== after) report.differenceCount++;
      beforeHash.update(before).update('\n'); afterHash.update(after).update('\n');
    }
    report.snapshotCount++;
    if (report.snapshotCount % 10 === 0) console.log(JSON.stringify({ snapshotCount: report.snapshotCount, poolCount: report.poolCount, differenceCount: report.differenceCount }));
  }
  await compare(current);
  for (let i = 0; i < count; i++) {
    const row = backups[Math.floor(i * (backups.length - 1) / Math.max(1, count - 1))];
    await compare((await app.store.readBackup(row.id)).state);
  }
  Object.assign(report, { beforeHash: beforeHash.digest('hex'), afterHash: afterHash.digest('hex'),
    durationMs: performance.now() - started, mainPeakRSSBytes: process.resourceUsage().maxRSS * 1024 });
  await writeFile(values.out, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ snapshotCount: report.snapshotCount, poolCount: report.poolCount, differenceCount: report.differenceCount,
    beforeHash: report.beforeHash, afterHash: report.afterHash, durationMs: report.durationMs }));
  if (report.differenceCount) process.exitCode = 1;
} catch { console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1; }
finally { await scheduler?.close(); await app?.close(); await rm(root, { recursive: true, force: true }); }
