// Standalone synthetic host. Nothing here is installed in the product server.
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import { parse } from './config.mjs';

// Must precede every product import, including dataset-runtime.
const root = await mkdtemp(path.join(tmpdir(), 'picker-beta-synthetic-'));
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p'; process.env.RS3_TASK_WORKER_MODE = 'process';
for (const key of ['PACKS', 'GAME_DATA', 'MAP_ASSETS']) process.env[`RS3_${key}_DIR`] = path.join(root, 'absent');
const c = parse(), key = process.env.BETA_CONTROL_KEY ?? randomBytes(32).toString('hex');
delete process.env.BETA_CONTROL_KEY;
if (c.serve && !c['key-file']) throw new Error('--serve requires --key-file (new synthetic control credential).');
if (c['key-file']) {
  await mkdir(path.dirname(path.resolve(c['key-file'])), { recursive: true });
  await writeFile(path.resolve(c['key-file']), key + '\n', { mode: 0o600, flag: 'wx' });
}
const { generate, audit } = await import('./fixture.mjs');
let fixture;
try { fixture = await generate(c, root, value => process.send ? process.send({ type: 'progress', value }) : console.log(value)); }
catch (error) { await rm(root, { recursive: true }); throw error; }
const sourceSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8', windowsHide: true }).trim();
const sourceHash = createHash('sha256');
const files = new Set(execFileSync('git', ['ls-files', 'app', 'scripts/perf/capacity'], { encoding: 'utf8', windowsHide: true }).trim().split('\n'));
files.add('scripts/perf/beta-load-trial.mjs');
for (const file of await readdir(new URL('./', import.meta.url))) if (file.endsWith('.mjs')) files.add(`scripts/perf/beta/${file}`);
for (const file of [...files].sort()) { sourceHash.update(file); sourceHash.update(await readFile(file)); }
const sourceTreeSHA256 = sourceHash.digest('hex');
await writeFile(path.join(root, 'host-config.json'), JSON.stringify(c), { mode: 0o600, flag: 'wx' });
let worker, port = 0, generation = 0, stopped = false, sequence = 0, runtimeSettings, processId;
const pending = new Map();
function rpc(type) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Synthetic service ${type} timed out.`)); }, 600000);
    pending.set(id, { resolve, reject, timer });
    if (!worker?.connected) { clearTimeout(timer); pending.delete(id); reject(new Error('Synthetic service is restarting.')); }
    else worker.send({ id, type });
  });
}
async function start() {
  worker = fork(new URL('./service.mjs', import.meta.url), [root, String(port)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  worker.stdout.on('data', () => {}); worker.stderr.on('data', data => process.stderr.write(data));
  worker.on('message', message => {
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.value);
  });
  worker.once('exit', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Synthetic service exited.')); } pending.clear(); });
  const ready = await new Promise((resolve, reject) => {
    worker.on('message', message => { if (message.type === 'ready') resolve(message); });
    worker.once('error', reject); worker.once('exit', code => reject(new Error(`Synthetic service startup failed (${code}).`)));
  });
  port = ready.port; processId = ready.processId; runtimeSettings = ready.runtimeSettings; generation++;
}
async function stopService() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = new Promise(resolve => worker.once('exit', resolve));
  await rpc('stop'); await exited;
}
await start();
const hardware = { platform: process.platform, node: process.version, cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, physicalRAMBytes: totalmem() };
let busy = false;
const control = http.createServer(async (request, response) => {
  const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? ''), expected = Buffer.from(key);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { request.resume(); return send(403, { error: 'Synthetic trial credential required.' }); }
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw new Error('Control body too large.'); chunks.push(chunk); }
    const body = bytes ? JSON.parse(Buffer.concat(chunks)) : {};
    if (request.url === '/identity') return send(200, { kind: 'isolated-synthetic-beta-v1', sourceSHA, sourceTreeSHA256, dirty, config: c, fixture, port, hardware, generation, runtimeSettings });
    if (request.url === '/sample') {
      return send(200, { ...await rpc('sample'), generation });
    }
    if (busy) return send(409, { error: 'Another control operation is running.' }); busy = true;
    try {
      if (request.url === '/restart') { const previous = processId; await stopService(); await start(); return send(200, { port, generation, processChanged: previous !== processId, runtimeSettings }); }
      if (request.url === '/backup') {
        return send(200, await rpc('backup'));
      }
      if (request.url === '/audit') {
        await stopService(); stopped = true;
        return send(200, await audit(root, fixture, body.writes ?? [], body.tombstones ?? [], body.journals ?? [], body.pickerTombstones ?? [], body.historyAcks ?? {}));
      }
      if (request.url === '/stop') { if (!stopped) await stopService(); stopped = true; await cleanup(); send(200, { stopped: true }); control.close(); return; }
      return send(404, { error: 'Unknown synthetic control operation.' });
    } finally { busy = false; }
  } catch (error) { send(500, { error: error.message }); }
});
await new Promise((resolve, reject) => { control.once('error', reject); control.listen(Number(c.port ?? 0), c.host ?? '127.0.0.1', resolve); });
const ready = { type: 'ready', controlPort: control.address().port, port };
if (process.send) process.send(ready); else console.log(`Synthetic control listening on port ${ready.controlPort}; product port ${port}.`);
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('picker-beta-synthetic-')) throw new Error('Unsafe synthetic cleanup path.');
  await rm(root, { recursive: true });
}
async function close() { control.closeAllConnections(); control.close(); if (!stopped) await stopService(); await cleanup(); }
process.once('disconnect', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
