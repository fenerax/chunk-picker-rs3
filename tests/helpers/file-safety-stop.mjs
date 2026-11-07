// The suite's only real-time test bound. This is a hang diagnostic, never a
// product latency assertion. A worker also stops a blocked synchronous test.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeSync } from 'node:fs';
import { after, beforeEach, afterEach } from 'node:test';

if (!isMainThread && workerData?.fileSafetyStop) {
  let active = [];
  parentPort.on('message', names => { active = names; });
  setTimeout(() => {
    writeSync(2, `\nFile safety stop: ${workerData.file}\nPID ${process.pid}; active tests: ${active.join(', ') || '(module evaluation or file cleanup)'}\nThe ten-minute outer safety stop expired. Inspect pending events, controlled clocks, child exits and cleanup acknowledgements.\n`);
    process.kill(process.pid, 'SIGTERM');
  }, 10 * 60_000);
} else if (isMainThread) {
  const guard = new Worker(new URL(import.meta.url), {
    workerData: { fileSafetyStop: true, file: process.argv[1] ?? '(unknown test file)' },
    // Do not inherit runner preloads or coverage into this diagnostic worker.
    execArgv: [],
  });
  guard.unref();
  const active = new Set();
  beforeEach(t => { active.add(t.name); guard.postMessage([...active]); });
  afterEach(t => { active.delete(t.name); guard.postMessage([...active]); });
  after(async () => { await guard.terminate(); });
}
