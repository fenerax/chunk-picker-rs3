#!/usr/bin/env node
// Synthetic cache-capacity tradeoff; accepts only a public module root, no save.
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, out, repetitions = '5'] = process.argv.slice(2);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required');
const runs = Number(repetitions);
if (!root || !out || !Number.isInteger(runs) || runs < 1) throw Error('Usage: eligibility-worker-retention.mjs PUBLIC_ROOT OUTPUT_JSON [RUNS]');
const url = pathToFileURL(path.resolve(root, 'app/tasks/eligibility-cache.mjs')).href;
const samples = [];
for (let run = 0; run < runs; run++) for (const byteLimit of [8 * 1024 * 1024, 512 * 1024]) {
  const worker = `
    import { parentPort } from 'node:worker_threads';
    import { createEligibilityCache } from ${JSON.stringify(url)};
    const cache = createEligibilityCache({ limit: 64, byteLimit: ${byteLimit} });
    const state = n => ({ schemaVersion: 1, revision: n, rules: {}, tasks: [], history: [],
      members: [{ id: 'fixture', name: 'Fixture', unlocked: [String(n)], completedTasks: [], taskStatus: {} }] });
    const at = performance.now();
    let computations = 0, hits = 0;
    const call = n => cache.evaluate(state(n), 'fixture', undefined, () => {
      computations++; return { tasks: [{ id: 'synthetic', record: { payload: String(n).padStart(6, '0').repeat(20000) } }], metrics: {} };
    });
    for (let n = 0; n < 32; n++) { call(n); await new Promise(setImmediate); }
    const retained = { entries: cache.size, bytes: cache.bytes };
    const coldMs = performance.now() - at, warmAt = performance.now();
    for (let n = 0; n < 32; n++) { hits += Number(call(n).metrics.eligibilityCacheHit); await new Promise(setImmediate); }
    parentPort.postMessage({ byteLimit: ${byteLimit}, coldMs, warmMs: performance.now() - warmAt,
      retained, computations, hits, rssBytes: process.memoryUsage.rss(), peakRssBytes: process.resourceUsage().maxRSS * 1024 });
    parentPort.close();
  `;
  const source = `
    import { Worker } from 'node:worker_threads';
    import { once } from 'node:events';
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(${JSON.stringify(worker)})));
    const [sample] = await once(worker, 'message');
    await once(worker, 'exit');
    console.log(JSON.stringify(sample));
  `;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^RS3_/i.test(key)));
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { env, encoding: 'utf8', timeout: 30000 });
  if (child.status !== 0) throw Error(`Synthetic sample failed: ${child.status} ${child.signal} ${child.stderr}`);
  samples.push({ run, ...JSON.parse(child.stdout) });
}
const stats = values => { const a = values.toSorted((a, b) => a - b), i = Math.floor(a.length / 2);
  return { median: a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2, min: a[0], max: a.at(-1) }; };
const summary = [...new Set(samples.map(s => s.byteLimit))].map(byteLimit => {
  const rows = samples.filter(s => s.byteLimit === byteLimit);
  return { byteLimit, ...Object.fromEntries(['coldMs', 'warmMs', 'hits', 'computations', 'rssBytes', 'peakRssBytes'].map(key => [key, stats(rows.map(s => s[key]))])),
    retainedBytes: stats(rows.map(s => s.retained.bytes)), retainedEntries: stats(rows.map(s => s.retained.entries)) };
});
await writeFile(out, JSON.stringify({ node: process.version, synthetic: true, root: path.resolve(root), runs, samples, summary }, null, 2) + '\n');
console.log(JSON.stringify(summary));
