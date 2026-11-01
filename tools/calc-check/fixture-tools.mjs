import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import path from 'node:path';
import { testRunPolicy } from '../../scripts/test-selection.mjs';
import { hash } from './compare.mjs';

export async function captureTests(root, files, directory) {
  const policies = new Map();
  for (const file of files) {
    const env = testRunPolicy(file).env ?? {}, key = JSON.stringify(env);
    if (!policies.has(key)) policies.set(key, { env, files: [] });
    policies.get(key).files.push(file);
  }
  // Module flags take URLs: Windows would read a C: path as a URL scheme.
  const totals = { tests: 0, passed: 0, failed: 0, skipped: 0 };
  for (const group of policies.values()) {
    const env = { ...process.env, ...group.env, CALC_CHECK_CAPTURE_DIR: directory };
    delete env.NODE_TEST_CONTEXT;
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter', new URL('./capture-reporter.mjs', import.meta.url).href, '--import', new URL('./capture-fixtures.mjs', import.meta.url).href, ...group.files.map(f => path.join(root, 'tests', f))], { cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; child.stdout.on('data', bytes => { output += bytes; });
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error('fixture-capture-failed');
    for (const row of output.trim().split('\n').filter(Boolean).map(JSON.parse)) if (row.total) for (const key of Object.keys(totals)) totals[key] += row.counts[key] ?? 0;
  }
  return totals;
}
export function fixturePreparers() {
  const workers = new Map(); let next = 0;
  return {
    async prepare(capture) {
      if (!capture.datasetSelection) throw new Error('fixture-capture-failed');
      const key = hash(JSON.stringify(capture.datasetSelection));
      let entry = workers.get(key);
      if (!entry) {
        const worker = new Worker(new URL('./prepare-fixtures.mjs', import.meta.url), { execArgv: [], workerData: { datasetSelection: capture.datasetSelection }, stdout: true, stderr: true });
        worker.stdout.resume(); worker.stderr.resume();
        entry = { worker, pending: new Map() }; workers.set(key, entry);
        worker.on('message', message => {
          const pending = entry.pending.get(message.id); entry.pending.delete(message.id);
          if (message.error) pending.reject(new TypeError('invalid')); else pending.resolve(message.input);
        });
        worker.on('error', () => { for (const p of entry.pending.values()) p.reject(new Error('failed')); entry.pending.clear(); });
      }
      const id = ++next;
      return new Promise((resolve, reject) => { entry.pending.set(id, { resolve, reject }); entry.worker.postMessage({ id, ...capture }); });
    },
    async close() { await Promise.all([...workers.values()].map(entry => entry.worker.terminate())); },
  };
}
