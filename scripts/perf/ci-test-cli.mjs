// Measure the unchanged npm entrypoint, including all owned child processes.
import { spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';
import { sampleMemoryTree } from './profile-stack/memory.mjs';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('Node 24.20 or newer is required.');
const [suite, root, prefix] = process.argv.slice(2);
if (!['quick', 'full'].includes(suite) || !root || !prefix) throw new Error('Usage: node scripts/perf/ci-test-cli.mjs <quick|full> <checkout> <report prefix>');
const log = await open(prefix + '.log', 'w');
const started = performance.now();
const child = spawn('npm', suite === 'quick' ? ['run', 'test:quick'] : ['test'], { cwd: root,
  stdio: ['ignore', log.fd, log.fd], detached: true });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
let peak = 0, samples = 0, completeSamples = 0, pending;
const sample = () => {
  if (pending) return;
  pending = sampleMemoryTree(child.pid).then(value => {
    peak = Math.max(peak, value.rssBytes); samples++; if (value.complete) completeSamples++;
  }).finally(() => { pending = undefined; });
};
sample(); const timer = setInterval(sample, 250); timer.unref();
const [exitCode, signal] = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => resolve([code, signal]));
});
const wallMs = performance.now() - started;
clearInterval(timer); await pending; await log.close();
const result = { node: process.version, suite, exitCode, signal, wallMs, sampledPeakRssBytes: peak, samples, completeSamples };
await writeFile(prefix + '.json', JSON.stringify(result) + '\n');
console.log(JSON.stringify(result));
process.exitCode = exitCode ?? 1;
