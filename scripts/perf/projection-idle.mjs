// Explicit diagnostic preload: let the ordinary trial return, retain only its
// calculator, and sample residency without opening a store or forcing worker GC.
import { registerHooks } from 'node:module';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
const entry = path.basename(process.argv[1] ?? '');
if (['preview-engine.mjs', 'hotspots-engine.mjs'].includes(entry)) {
  const output = process.env.RS3_IDLE_REPORT, minutes = Number(process.env.RS3_IDLE_MINUTES ?? 180);
  if (!output?.startsWith('/tmp/') || !Number.isFinite(minutes) || minutes < 60) throw Error('IdleOptionsError');
  const symbol = Symbol.for('rs3.projectionIdleReport');
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!['/scripts/perf/preview-engine.mjs', '/scripts/perf/hotspots-engine.mjs'].some(s => url.endsWith(s))) return result;
    const source = String(result.source), anchor = '    console.log(JSON.stringify(report));';
    const expected = url.endsWith('/preview-engine.mjs') ? 1 : 3;
    if (source.split(anchor).length !== expected + 1) throw Error('IdleAnchorError');
    return { ...result, source: source.replaceAll(anchor, '    globalThis[Symbol.for(\'rs3.projectionIdleReport\')] = report;\n' + anchor) };
  } });
  const terminate = ProcessWorker.prototype.terminate;
  let retained = false;
  ProcessWorker.prototype.terminate = function (...args) {
    const workload = globalThis[symbol];
    if (!workload || retained) return terminate.apply(this, args);
    retained = true; delete globalThis[symbol];
    const worker = this;
    const report = { format: 'projection-idle-v1', node: process.version, mode: Number(process.env.RS3_FINAL_PROJECTION), minutes,
      datasetHash: workload.datasetHash, sourceHash: workload.sourceHash, stateHash: workload.stateHash,
      workloadHash: createHash('sha256').update(JSON.stringify(workload)).digest('hex'), samples: [], complete: false };
    setImmediate(async () => {
      try {
        // Only the measurement caller is collected, after its workload frame has
        // returned. The resident calculator and its relay keep ordinary GC policy.
        globalThis.gc?.(); await new Promise(r => setImmediate(r)); globalThis.gc?.();
        const started = performance.now(), interval = 300000, end = started + minutes * 60000;
        let next = started;
        const memory = pid => {
          const text = readFileSync('/proc/' + pid + '/status', 'utf8');
          return Object.fromEntries(['VmRSS', 'VmHWM'].map(k => [k, Number(new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(text)?.[1]) * 1024]));
        };
        while (true) {
          const now = performance.now();
          if (now >= next || now >= end) {
            report.samples.push({ elapsedMs: now - started, worker: memory(worker.pid), parent: memory(process.pid) });
            report.complete = now >= end;
            await writeFile(output + '.tmp', JSON.stringify(report, null, 2) + '\n'); await rename(output + '.tmp', output);
            console.error(JSON.stringify({ idleMode: report.mode, idleSamples: report.samples.length, elapsedMs: now - started }));
            if (report.complete) break;
            next = Math.min(next + interval, end);
          }
          await new Promise(r => setTimeout(r, Math.min(60000, Math.max(1, Math.min(next, end) - performance.now()))));
        }
      } catch (error) { report.error = error.name; await writeFile(output, JSON.stringify(report)); process.exitCode = 1; }
      finally { await terminate.call(worker); }
    });
    return Promise.resolve(0);
  };
}
