// Optional per-request diagnostics. All outputs must be outside the checkout.
// Never use these instrumented runs as timing evidence.
import './engine-cache-latency-probe.mjs';
import './engine-cache-admission-probe.mjs';
import { registerHooks } from 'node:module';
import { parentPort, isMainThread } from 'node:worker_threads';
import { Session } from 'node:inspector';
import { appendFileSync, writeFileSync } from 'node:fs';
const planningOutput = process.env.RS3_PLANNING_MICRO_TRACE;
if (planningOutput && !planningOutput.startsWith('/tmp/')) throw new Error('ProfileLocationError');
if (planningOutput && !isMainThread) {
  const seen = new WeakSet();
  globalThis[Symbol.for('rs3.planningMicro')] = index => {
    if (seen.has(index)) return;
    seen.add(index);
    const arrayBytes = n => 3 + 2 * (n < 128 ? 1 : n < 16384 ? 2 : n < 2097152 ? 3 : n < 268435456 ? 4 : 5);
    const variants = {
      intrinsic() {
        let cost = 0;
        Map.prototype.forEach.call(index.byLocation, (rows, location) => {
          cost += 2 * location.length + 15;
          Map.prototype.forEach.call(rows, (row, id) => {
            cost += 2 * id.length + 39 + arrayBytes(row.evidence.length);
            for (let i = 0; i < row.evidence.length; i++) {
              const e = row.evidence[i]; cost += 2 * (e.location.length + e.reason.length) + 43;
            }
          });
        });
        return cost;
      },
      method() {
        let cost = 0;
        index.byLocation.forEach((rows, location) => {
          cost += 2 * location.length + 15;
          rows.forEach((row, id) => {
            cost += 2 * id.length + 39 + arrayBytes(row.evidence.length);
            for (let i = 0; i < row.evidence.length; i++) {
              const e = row.evidence[i]; cost += 2 * (e.location.length + e.reason.length) + 43;
            }
          });
        });
        return cost;
      },
      entries() {
        let cost = 0;
        for (const [location, rows] of index.byLocation) {
          cost += 2 * location.length + 15;
          for (const [id, row] of rows) {
            cost += 2 * id.length + 39 + arrayBytes(row.evidence.length);
            for (let i = 0; i < row.evidence.length; i++) {
              const e = row.evidence[i]; cost += 2 * (e.location.length + e.reason.length) + 43;
            }
          }
        }
        return cost;
      },
      values() {
        let cost = 0;
        for (const [location, rows] of index.byLocation) {
          cost += 2 * location.length + 15;
          for (const row of rows.values()) {
            cost += 2 * row.task.id.length + 39 + arrayBytes(row.evidence.length);
            for (let i = 0; i < row.evidence.length; i++) {
              const e = row.evidence[i]; cost += 2 * (e.location.length + e.reason.length) + 43;
            }
          }
        }
        return cost;
      },
    };
    const timings = {}, sums = {};
    for (let run = 0; run < 5; run++) for (const [name, fn] of Object.entries(variants)) {
      const began = performance.now(); sums[name] = fn();
      (timings[name] ??= []).push(performance.now() - began);
    }
    let rows = 0, evidence = 0;
    index.byLocation.forEach(map => { rows += map.size; map.forEach(row => { evidence += row.evidence.length; }); });
    appendFileSync(planningOutput, JSON.stringify({ rows, evidence, timings, sums }) + '\n');
  };
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/tasks/snapshot-cache.mjs')) return result;
    const source = String(result.source).replace('if (allowTrusted) {',
      "if (allowTrusted) { globalThis[Symbol.for('rs3.planningMicro')](index);");
    return { ...result, source };
  } });
}
const output = process.env.RS3_REQUEST_PROFILE;
if (output && !output.startsWith('/tmp/')) throw new Error('ProfileLocationError');
if (output && !isMainThread && parentPort) {
  let job, profiling = false, taskWorker = false;
  const session = new Session(); session.connect(); session.post('Profiler.enable');
  parentPort.on('message', message => {
    if (!taskWorker || ['cancel','supersede'].includes(message.type)) return;
    job = { id: message.id, type: message.type };
    if (!profiling) { session.post('Profiler.start'); profiling = true; }
  });
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/tasks/worker.mjs')) taskWorker = true;
    if (!url.endsWith('/tasks/eligibility-cache.mjs')) return result;
    const source = String(result.source).replace('Buffer.from(bytes)',
      "globalThis[Symbol.for('rs3.cacheLatencySpan')]('eligibility.bufferCopy', () => Buffer.from(bytes))");
    return { ...result, source };
  } });
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...rest) => {
    if (profiling && message.id !== undefined && !['progress','prediction-prepared'].includes(message.type)) {
      const current = job;
      session.post('Profiler.stop', (error, { profile } = {}) => {
        if (error) throw error;
        writeFileSync(`${output}-${current.id}.cpuprofile`, JSON.stringify(profile));
        appendFileSync(output + '.jsonl', JSON.stringify({ ...current, evaluationMs: message.evaluationMs, timingMs: message.timingMs }) + '\n');
      });
      profiling = false;
    }
    return post(message, ...rest);
  };
}
