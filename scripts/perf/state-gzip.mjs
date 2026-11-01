// Node >=24.20. Synthetic authenticated HTTP comparison, sequential AB/BA runs:
// node scripts/perf/state-gzip.mjs --baseline /tmp/start --pairs 5 --samples 6 --out /tmp/state-gzip.json
// Credential-free projection comparison on an already copied save (no server or store):
// node scripts/perf/state-gzip.mjs --project /tmp/perfwalk/game --out /tmp/projection.json
// Only counts, hashes, sizes and durations leave projection mode. It is not an
// authenticated full-route size or a production cache-miss frequency estimate.
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';
import { createGunzip, gunzipSync } from 'node:zlib';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('Node 24.20+ required.');
const here = fileURLToPath(import.meta.url), root = path.resolve(import.meta.dirname, '../..');
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'pairs', 'samples', 'out', 'child', 'label', 'project'].map(key => [key, { type: 'string' }])) });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
};

async function child(checkout) {
  const load = relative => import(pathToFileURL(path.join(checkout, relative)));
  const { createServer } = await load('app/server.mjs');
  const { createGroupState } = await load('app/core/state.mjs');
  const { emptyMetadataDataset } = await load('tests/helpers/server-dataset.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'state-gzip-http-'));
  const timers = new Map(); let timerId = 0, idleTime = 0;
  const idleClock = { now: () => idleTime, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.terminate = async () => {};
    worker.postMessage = message => { if (message.id) queueMicrotask(() => worker.emit('message', { id: message.id, result: { tasks: [], metrics: {} }, evaluationMs: 1 })); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const definitions = { challenges: {}, chunks: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(12340 + i), {}])),
    walkableChunks: Array.from({ length: 16 }, (_, i) => String(12340 + i)), walkableChunksF2P: Array.from({ length: 16 }, (_, i) => String(12340 + i)) };
  const app = await createServer({ dataset: await emptyMetadataDataset(), dataDir: directory, definitions, taskMap: {}, port: 0,
    now: () => Date.parse('2026-10-01T00:00:00Z'), predictionPrewarm: false,
    initialState: createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]),
    taskWorkerOptions: { workerFactory, idleClock, idleMs: 100 }, shutdownDeadlineMs: 500 });
  await app.listen();
  const original = app.store.getStateSnapshot;
  let parts, captures = 0, serializationMs = 0;
  // Four cold-serialized immutable fields, reused across revisions; real pools
  // and store metadata still come from the actual route's store snapshot.
  const sources = ['ascii '.repeat(Math.ceil(13 * 1024 * 1024 / 6)), 'unicode 🦊 Île '.repeat(850000), 'pools '.repeat(2300000), 'retained '.repeat(1600000)];
  app.store.getStateSnapshot = async options => {
    const saved = await original(options);
    if (options?.view) return saved;
    captures++;
    if (!parts) { const started = performance.now(); parts = sources.flatMap((value, index) => [`,"synthetic${index}":`, JSON.stringify(value)]); serializationMs += performance.now() - started; }
    const stateJSONParts = [...saved.stateJSONParts.slice(0, -1), ...parts, '}'];
    return { revision: saved.revision, pools: saved.pools, stateJSONParts, get stateJSON() { return stateJSONParts.join(''); } };
  };
  const lag = monitorEventLoopDelay({ resolution: 1 }); lag.enable();
  globalThis.gc();
  process.send({ type: 'ready', port: app.address().port, token: app.store.getAccessToken(), baselineMemory: process.memoryUsage() });
  process.on('message', async message => {
    try {
      if (message.command === 'stats') process.send({ id: message.id, captures, serializationMs, cpu: process.cpuUsage(), memory: process.memoryUsage(), loopMaxMs: lag.max / 1e6 });
      if (message.command === 'reset') { lag.reset(); process.send({ id: message.id }); }
      if (message.command === 'evict') {
        idleTime += 1000;
        for (const fn of [...timers.values()]) fn();
        timers.clear(); parts = undefined;
        for (let i = 0; i < 4; i++) { await turn(); globalThis.gc(); }
        process.send({ id: message.id, memory: process.memoryUsage() });
      }
      if (message.command === 'close') { await app.close(); await rm(directory, { recursive: true, force: true }); process.send({ id: message.id }); process.disconnect(); }
    } catch { process.send({ id: message.id, errorCount: 1 }); }
  });
}

async function httpRead(port, token, route, body) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, Origin: `http://127.0.0.1:${port}`, 'Accept-Encoding': 'gzip', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, response => {
      const firstByteMs = performance.now() - started, encodedHash = createHash('sha256'), decodedHash = createHash('sha256');
      let encodedBytes = 0, decodedBytes = 0, diagnosticJSON = '';
      response.on('data', chunk => { encodedBytes += chunk.length; encodedHash.update(chunk); });
      const decoded = response.headers['content-encoding'] === 'gzip' ? response.pipe(createGunzip()) : response;
      decoded.on('data', chunk => { decodedBytes += chunk.length; decodedHash.update(chunk); if (route === '/api/diagnostics') diagnosticJSON += chunk.toString(); });
      response.on('error', reject); decoded.on('error', reject);
      decoded.on('end', () => resolve({ status: response.statusCode, firstByteMs, decodedMs: performance.now() - started,
        encodedBytes, decodedBytes, encodedSha256: encodedHash.digest('hex'), decodedSha256: decodedHash.digest('hex'),
        etag: response.headers.etag, contentLength: Number(response.headers['content-length']),
        ...(diagnosticJSON ? { responseCache: JSON.parse(diagnosticJSON).responseCache } : {}) }));
    });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

async function trial(checkout, label, samples) {
  const env = { ...process.env, RS3_DATASET: 'open-f2p', RS3_FULL_STATE_GZIP_PARTS: label === 'after' ? '1' : '0' };
  for (const name of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete env[name];
  const server = fork(here, ['--child', checkout], { execArgv: ['--expose-gc'], env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let sequence = 0;
  const pending = new Map(), ready = Promise.withResolvers();
  server.on('message', message => { if (message.type === 'ready') ready.resolve(message); else { pending.get(message.id)?.resolve(message); pending.delete(message.id); } });
  server.on('exit', code => { if (code) { ready.reject(new Error('Synthetic server failed.')); for (const row of pending.values()) row.reject(new Error('Synthetic server failed.')); } });
  const rpc = command => { const row = Promise.withResolvers(), id = ++sequence; pending.set(id, row); server.send({ command, id }); return row.promise.then(value => { if (value.errorCount) throw new Error('Synthetic command failed.'); return value; }); };
  let peakRSS = 0;
  const sampleMemory = () => { try { peakRSS = Math.max(peakRSS, Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024); } catch {} };
  let timer;
  try {
    const config = await ready.promise; timer = setInterval(sampleMemory, 5);
    await rpc('reset'); const initial = await rpc('stats'), rows = [], foreground = [];
    let polling = false;
    const poll = setInterval(() => { if (!polling) { polling = true; httpRead(config.port, config.token, '/api/health').then(row => foreground.push(row.decodedMs)).finally(() => { polling = false; }); } }, 20);
    try {
      for (let index = 0; index < samples; index++) {
        await rpc('reset');
        const before = await rpc('stats');
        // Two concurrent callers on each revision, then a warm same-revision
        // read. Between rounds, a real durable command changes the revision.
        const cold = httpRead(config.port, config.token, '/api/state');
        const peer = httpRead(config.port, config.token, '/api/state');
        const [a, b] = await Promise.all([cold, peer]);
        const coldStats = await rpc('stats'); await rpc('reset');
        const warm = await httpRead(config.port, config.token, '/api/state');
        if ([a, b, warm].some(row => row.status !== 200)) throw new Error('Synthetic route refused.');
        const after = await rpc('stats');
        rows.push({ cold: a, peer: b, warm, coldLoopMaxMs: coldStats.loopMaxMs, warmLoopMaxMs: after.loopMaxMs, captures: after.captures - before.captures });
        const command = await httpRead(config.port, config.token, '/api/command?view=play-v1', { expectedRevision: index, command: { type: 'set-note', memberId: index % 2 ? 'two' : 'one', chunkId: '12341', note: `round ${index}` } });
        if (command.status !== 200) throw new Error('Synthetic commit refused.');
      }
    } finally { clearInterval(poll); }
    const stats = await rpc('stats'); sampleMemory(); clearInterval(timer);
    const evicted = await rpc('evict');
    const diagnostics = await httpRead(config.port, config.token, '/api/diagnostics');
    if (diagnostics.responseCache?.entries !== 0 || diagnostics.responseCache?.bytes !== 0) throw new Error('Eviction did not clear the response cache: ' + JSON.stringify(diagnostics.responseCache));
    return { label, rows, peakRSS, baselineMemory: config.baselineMemory, afterEvictionMemory: evicted.memory,
      cpuMs: (stats.cpu.user + stats.cpu.system - initial.cpu.user - initial.cpu.system) / 1000,
      loopMaxMs: Math.max(...rows.flatMap(row => [row.coldLoopMaxMs, row.warmLoopMaxMs])), serializationMs: stats.serializationMs, foreground, afterEvictionCache: diagnostics.responseCache, diagnosticsStatus: diagnostics.status };
  } finally { clearInterval(timer); if (server.connected) await rpc('close'); }
}

async function project(source) {
  // Pure hydration of copied gameplay. Opening a store would create credentials.
  const { projectBrowserState } = await import('../../app/web/browser-state.mjs');
  const { createRepresentation, createGzipRepresentation } = await import('../../app/http-response.mjs');
  const filenames = (await readdir(path.join(source, 'backups'))).filter(name => name.endsWith('.json.gz')).sort();
  const selected = [await readFile(path.join(source, 'state.json'))];
  for (let i = 0; i < Math.min(7, filenames.length); i++) selected.push(gunzipSync(await readFile(path.join(source, 'backups', filenames[Math.floor(i * (filenames.length - 1) / Math.max(1, Math.min(7, filenames.length) - 1))]))));
  const rows = [];
  for (const bytes of selected) {
    const started = performance.now(), document = JSON.parse(bytes), state = document.state ?? document;
    for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
      if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)) throw new Error('Invalid static reference.');
      const content = gunzipSync(await readFile(path.join(source, 'static', reference.id)));
      if (sha(content) !== reference.sha256) throw new Error('Static hash mismatch.');
      state[key] = JSON.parse(content);
    }
    const display = projectBrowserState(state), parts = ['{'];
    for (const [key, value] of Object.entries(display)) {
      const json = JSON.stringify(value); if (json === undefined) continue;
      if (parts.length > 1) parts.push(','); parts.push(JSON.stringify(key), ':', json);
    }
    parts.push('}');
    const plain = Buffer.from(parts.join('')), before = await createRepresentation(plain).encoded('gzip'), after = await (await createGzipRepresentation(parts)).encoded('gzip');
    rows.push({ sourceSha256: sha(bytes), projectionBytes: plain.length, gzipBytes: after.bytes.length,
      plainSha256: sha(plain), gzipSha256: sha(after.bytes), differenceCount: Number(!before.bytes.equals(after.bytes)) + Number(before.etag !== after.etag), durationMs: performance.now() - started });
  }
  return { node: process.version, snapshotCount: rows.length, rows, differenceCount: rows.reduce((sum, row) => sum + row.differenceCount, 0), peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
}

if (values.child) await child(values.child);
else if (values.project) {
  try {
    const result = await project(path.resolve(values.project)); await writeFile(values.out, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
  } catch { console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1; }
} else {
  const pairs = Number(values.pairs ?? 5), samples = Number(values.samples ?? 6);
  if (!values.baseline || !values.out || !Number.isSafeInteger(pairs) || pairs < 1 || !Number.isSafeInteger(samples) || samples < 1) throw new Error('Use --baseline PATH --out PATH [--pairs 5 --samples 6].');
  const runs = [];
  for (let pair = 0; pair < pairs; pair++) for (const label of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
    runs.push({ pair, ...await trial(label === 'before' ? path.resolve(values.baseline) : root, label, samples) });
    console.log(JSON.stringify({ runCount: runs.length }));
  }
  let differences = 0;
  for (let pair = 0; pair < pairs; pair++) {
    const before = runs.find(run => run.pair === pair && run.label === 'before'), after = runs.find(run => run.pair === pair && run.label === 'after');
    for (let index = 0; index < samples; index++) for (const kind of ['cold', 'peer', 'warm']) for (const key of ['encodedBytes', 'decodedBytes', 'encodedSha256', 'decodedSha256', 'etag', 'contentLength']) differences += Number(before.rows[index][kind][key] !== after.rows[index][kind][key]);
  }
  const summaries = Object.fromEntries(['before', 'after'].map(label => {
    const subset = runs.filter(run => run.label === label), rows = subset.flatMap(run => run.rows);
    return [label, { peakRSSMiB: summary(subset.map(run => run.peakRSS / 1048576)), loopMaxMs: summary(subset.map(run => run.loopMaxMs)),
      reusedFieldsColdLoopMaxMs: summary(subset.flatMap(run => run.rows.slice(1).map(row => row.coldLoopMaxMs))),
      warmLoopMaxMs: summary(rows.map(row => row.warmLoopMaxMs)),
      cpuMs: summary(subset.map(run => run.cpuMs)), serializationMs: summary(subset.map(run => run.serializationMs)),
      coldFirstByteMs: summary(rows.map(row => row.cold.firstByteMs)), coldDecodedMs: summary(rows.map(row => row.cold.decodedMs)),
      warmFirstByteMs: summary(rows.map(row => row.warm.firstByteMs)), warmDecodedMs: summary(rows.map(row => row.warm.decodedMs)),
      foregroundMs: summary(subset.flatMap(run => run.foreground)), captures: summary(rows.map(row => row.captures)),
      afterEvictionHeapMiB: summary(subset.map(run => run.afterEvictionMemory.heapUsed / 1048576)), afterEvictionRSSMiB: summary(subset.map(run => run.afterEvictionMemory.rss / 1048576)) }];
  }));
  const report = { node: process.version, pairs, samples, differences, summaries, runs };
  await writeFile(values.out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ differences, summaries }));
  if (differences) process.exitCode = 1;
}
