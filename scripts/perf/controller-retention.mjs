// Synthetic result-cache probe. The worker reply is a hand-authored scale
// fixture produced by calculation-retention.mjs --wire-fixture, never a save.
// Run matching main/candidate app directories with the SAME fixture bytes.
// Usage: node --expose-gc scripts/perf/controller-retention.mjs <app-dir> <wire.json> <report.json>
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { setImmediate as turn } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createGroupState } from '../../app/core/state.mjs';
import { projectPlayResult } from '../../app/play-view.mjs';
if (!process.argv[4] || typeof globalThis.gc !== 'function') throw Error('Explicit app, synthetic wire fixture, report and --expose-gc required.');
const { createTaskScheduler } = await import(pathToFileURL(path.resolve(process.argv[2], 'tasks/scheduler.mjs')).href);
const fixture = await readFile(process.argv[3]);
const play = Buffer.from(JSON.stringify(projectPlayResult(JSON.parse(fixture))));
const shared = bytes => { const buffer = new SharedArrayBuffer(bytes.length); Buffer.from(buffer).set(bytes); return buffer; };
const scheduler = await createTaskScheduler({ eligibilityProofSeeding: false, workerFactory() {
  const worker = new EventEmitter();
  worker.postMessage = message => {
    if (message.type !== 'evaluate') return;
    queueMicrotask(() => worker.emit('message', { id: message.id, resultJSON: shared(fixture), playJSON: shared(play),
      evaluationMs: 1, timingMs: { totalMs: 1 }, cancelled: false }));
  };
  worker.terminate = async () => worker.emit('exit', 0);
  queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'] }));
  return worker;
} });
async function memory() { await turn(); globalThis.gc(); await turn(); globalThis.gc(); await turn(); return process.memoryUsage(); }
async function consume(index, access = 'object') {
  const state = createGroupState([{ id: 'one', name: 'Synthetic ' + index, unlocked: ['12850'] }]);
  const started = performance.now();
  const response = await scheduler.evaluate(state, 'one', 'evaluate', undefined, 'group-' + index, 'group-' + index);
  if (access === 'object') {
    const parsed = response.result; // The acceptance consumer exercises this getter.
    if (!Array.isArray(parsed.tasks)) throw Error('Synthetic result must contain tasks.');
  } else if (!response.resultJSON?.length || !response.playJSON?.length) throw Error('Forwarding requires result bytes.');
  return performance.now() - started;
}
try {
  const initial = await memory(), cold = [], checkpoints = [];
  for (let index = 0; index < 8; index++) {
    cold.push(await consume(index));
    if (index === 0 || index === 7) checkpoints.push({ groups: index + 1, memory: await memory(), cache: scheduler.getDiagnostics().cache });
  }
  const warm = [await consume(7, 'bytes')], materialize = [await consume(7)];
  const report = { mechanism: 'synthetic-worker-replies-real-scheduler', groups: 8, fixtureBytes: fixture.length, playBytes: play.length,
    initial, cold, checkpoints, warm, materialize, final: await memory(), cache: scheduler.getDiagnostics().cache, node: process.version };
  await writeFile(process.argv[4], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ heapGrowthMiB: (report.final.heapUsed - initial.heapUsed) / 1024 ** 2,
    arrayBufferGrowthMiB: (report.final.arrayBuffers - initial.arrayBuffers) / 1024 ** 2,
    forwardMs: warm[0], materializeMs: materialize[0], coldP95Ms: Math.max(...cold), cache: report.cache }));
} finally { await scheduler.close(); }
