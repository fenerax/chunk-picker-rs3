// Harness-only preload. No application imports; installed releases need no hooks.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { getHeapStatistics } from 'node:v8';
import { isMainThread, parentPort, threadId } from 'node:worker_threads';
import path from 'node:path';

export function usage() {
  let proc = { vmRSS: 0, vmHWM: 0 };
  try {
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    for (const [key, field] of [['vmRSS', 'VmRSS'], ['vmHWM', 'VmHWM']]) proc[key] = Number(new RegExp(`^${field}:\\s+(\\d+)`, 'm').exec(status)?.[1] ?? 0) * 1024;
  } catch { /* Non-Linux measurements explicitly use zero for unavailable /proc. */ }
  return { atMs: Date.now(), pid: process.pid, thread: threadId, memory: process.memoryUsage(),
    heap: getHeapStatistics(), cpu: process.cpuUsage(), threadCpu: process.threadCpuUsage(),
    resource: process.resourceUsage(), proc };
}

if (process.env.RS3_FOOTPRINT_SAMPLES) {
  const directory = process.env.RS3_FOOTPRINT_SAMPLES;
  const file = path.join(directory, `${process.pid}-${threadId}.jsonl`);
  const append = fs.appendFileSync;
  const record = phase => {
    const row = { phase, ...usage() };
    append(file, JSON.stringify(row) + '\n', { mode: 0o600 });
    return row;
  };
  globalThis[Symbol.for('rs3.footprint.sample')] = record;
  // Existing startupPhase writes synchronously. Intercept only our private log,
  // preserving the write and all application behavior, even on old releases.
  fs.appendFileSync = function(target, bytes, ...options) {
    if (target === process.env.RS3_STARTUP_TIMING_LOG) {
      const phase = JSON.parse(String(bytes)).phase;
      if (phase === 'create:store') record(3);
    }
    return append.call(this, target, bytes, ...options);
  };
  syncBuiltinESMExports();
  record(0);
  const timer = setInterval(() => record(0), 100);
  timer.unref();
  if (isMainThread && process.send) {
    const send = process.send;
    process.send = function(...args) { record(0); return send.apply(this, args); };
  }
  if (!isMainThread && parentPort) {
    const post = parentPort.postMessage;
    parentPort.postMessage = function(...args) {
      // Synchronous evaluation blocks timers: also sample at every result send,
      // before a later GC can discard its temporary allocations.
      record(0);
      return post.apply(this, args);
    };
  }
}
