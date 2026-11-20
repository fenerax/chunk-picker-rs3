// One disposable HTTP process. Restarting this child drops all application memory.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { processTree } from '../capacity/telemetry.mjs';
const root = process.argv[2];
if (!process.send || !root) throw new Error('Use the synthetic host.');
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p'; process.env.RS3_TASK_WORKER_MODE = 'process';
for (const key of ['PACKS', 'GAME_DATA', 'MAP_ASSETS']) process.env[`RS3_${key}_DIR`] = path.join(root, 'absent');
const c = JSON.parse(await readFile(path.join(root, 'host-config.json'), 'utf8'));
const fixture = JSON.parse(await readFile(path.join(root, 'fixture.json'), 'utf8'));
const { inputs, storage } = await import('./fixture.mjs');
const { createServer } = await import('../../../app/server.mjs');
const { createGroupState } = await import('../../../app/core/state.mjs');
const { requestContext } = await import('../../../app/security/request.mjs');
const data = inputs(c), grants = new Map(), tokens = new Map();
let app, port = Number(process.argv[3] ?? 0), upstream = 0, generation = 0, admissions = [], stopped = false;
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const upstreamCounts = {};
const fake = async (url, { signal } = {}) => {
  const parsed = new URL(url), name = parsed.searchParams.get('player') ?? decodeURIComponent(parsed.pathname.split('/').at(-1));
  if (!/^S\d+M\d+$/.test(name)) throw new Error('Only synthetic upstream names accepted.');
  const scenario = ['success', 'success', 'private', 'unknown', 'malformed', 'oversized', '429', 'timeout'][Math.floor(upstream++ / 2) % 8];
  upstreamCounts[scenario] = (upstreamCounts[scenario] ?? 0) + 1;
  if (scenario === 'timeout') return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Synthetic timeout')); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  if (scenario === 'private' || scenario === 'unknown' || scenario === '429') return new Response('', { status: { private: 403, unknown: 404, '429': 429 }[scenario], headers: { 'Retry-After': '1' } });
  if (scenario === 'malformed') return new Response('{');
  if (scenario === 'oversized') return new Response(' '.repeat(3 * 1024 * 1024));
  return Response.json(parsed.searchParams.has('player') ? { name, skills: [{ id: 1, name: 'Attack', level: 20, xp: 4470 }] } : { name, qp: 0, qp_max: 1, quests: {} });
};
const secretFile = path.join(root, 'oauth-secret'); await writeFile(secretFile, 'synthetic-secret');
process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secretFile;
const provider = { async fetch(url, options) {
  if (url.endsWith('/oauth2/token')) {
    const code = new URLSearchParams(options.body).get('code'), subject = grants.get(code);
    if (!subject) throw new Error('Unknown synthetic OAuth grant.');
    const token = randomBytes(16).toString('hex'); tokens.set(token, subject); return Response.json({ access_token: token });
  }
  if (url !== 'https://discord.com/api/users/@me') throw new Error('Unstubbed OAuth request.');
  return Response.json({ id: tokens.get(options.headers.Authorization.slice(7)) });
} };
async function start() {
  const paths = storage(root);
  app = await createServer({ dataDir: paths.legacyDir, host: c.host ?? '127.0.0.1', port,
    dataset: data.dataset, registry: data.rules, definitions: data.definitions, world: data.world, taskMap: {},
    initialState: createGroupState([{ id: 'one', name: 'Synthetic legacy 1' }, { id: 'two', name: 'Synthetic legacy 2' }], data.rules),
    packsDir: path.join(root, 'absent'), gameDataDir: path.join(root, 'absent'), mapAssetsDir: path.join(root, 'absent'),
    testEventTransform: ({ pickerId, bytes }) => bytes.replace(/^data: (\{[^\n]*\})/gm,
      (_, json) => `data: ${JSON.stringify({ ...JSON.parse(json), _trialOrigin: pickerId })}`),
    requestContextFor: (request, options) => request.headers.authorization === `Bearer ${app?.store.getAccessToken()}` ? requestContext(request, options) : requestContext({ headers: { ...request.headers, host: 'picker.example',
      'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' } },
    { host: '127.0.0.1', publicOrigin: 'https://picker.example', ingressRole: 'public' }),
    signIn: 'optional', signInProvider: provider, loopbackPort: undefined, publicOrigin: 'https://picker.example',
    runeMetrics: { fetchImpl: fake }, originalSync: { fetchImpl: async () => { throw new Error('Offline trial.'); } },
    progressSources: { hiscores: { snapshot: async () => ({ available: false }), close() {} } },
    multiPicker: { ...paths, ...c.limits, maxOpenContexts: c['max-open-contexts'], coldOpenAdmission: c.admission,
      onAdmission: event => { admissions.push({ ...event, generation }); } },
  });
  await app.listen(); port = app.address().port; generation++;
}
await start();
const operator = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'error', signal: AbortSignal.timeout(600000),
    headers: { Authorization: `Bearer ${app.store.getAccessToken()}`, ...(body ? { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(`Operator ${route}: ${response.status}: ${value.message}`); return value;
};
async function scopedCgroup() {
  if (process.platform !== 'linux') return {};
  const membership = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').map(line => line.split(':'))
    .find(([hierarchy, controllers]) => hierarchy === '0' && controllers === '')?.slice(2).join(':');
  if (membership === undefined) return { version: 'unavailable' };
  const base = path.resolve('/sys/fs/cgroup', '.' + membership);
  if (base !== '/sys/fs/cgroup' && !base.startsWith('/sys/fs/cgroup/')) throw new Error('Invalid cgroup membership.');
  const values = { version: 2, effectiveCpuCores: cpus().length, effectiveMemoryBytes: totalmem() };
  for (const name of ['cpu.max', 'memory.max', 'memory.current', 'memory.peak', 'memory.swap.current'])
    try { values[name] = (await readFile(path.join(base, name), 'utf8')).trim(); } catch { values[name] = null; }
  for (let directory = base; directory.startsWith('/sys/fs/cgroup'); directory = path.dirname(directory)) {
    try {
      const [quota, period] = (await readFile(path.join(directory, 'cpu.max'), 'utf8')).trim().split(' ').map(Number);
      if (Number.isFinite(quota) && period > 0) values.effectiveCpuCores = Math.min(values.effectiveCpuCores, quota / period);
    } catch {}
    try { const bytes = Number((await readFile(path.join(directory, 'memory.max'), 'utf8')).trim());
      if (Number.isFinite(bytes) && bytes > 0) values.effectiveMemoryBytes = Math.min(values.effectiveMemoryBytes, bytes); } catch {}
    if (directory === '/sys/fs/cgroup') break;
  }
  return values;
}
const observed = (await operator('/api/diagnostics')).residency;
if (observed?.maxOpenContexts !== c['max-open-contexts'] || observed.coldStartsGlobal !== c.limits.coldStartsGlobal ||
  Object.entries(observed.coldAdmission ?? {}).some(([key, value]) => value !== c.admission[key])) throw new Error('Runtime residency settings were not applied.');
process.send({ type: 'ready', port, processId: process.pid, runtimeSettings: { residency: observed, limits: c.limits, coldAdmission: c.admission, verified: true } });
let closing;
async function close() {
  return closing ??= (async () => { loop.disable(); await app.close(); })();
}
process.on('message', async ({ id, type }) => {
  try {
    let value;
    if (type === 'sample') {
      const tree = await processTree(process.pid); tree.cgroup = await scopedCgroup();
      value = { tree, httpCpu: process.cpuUsage(), httpRSS: process.memoryUsage().rss,
        eventLoopP99Ms: loop.percentile(99) / 1e6, admissions, upstreamCounts: { ...upstreamCounts } };
      admissions = []; loop.reset();
    } else if (type === 'backup') {
      const started = performance.now(), result = await operator('/api/operator/service-snapshot', { id: randomUUID() });
      const health = await operator('/api/health');
      value = { elapsedMs: performance.now() - started, heldMs: result.heldMs, pickerBarriers: result.pickerBarriers,
        maxRequestWaitMs: result.maxRequestWaitMs, checkpointTiming: health.checkpointTiming };
    } else if (type === 'stop') { await close(); value = { stopped: true }; }
    else throw new Error('Unknown synthetic service operation.');
    process.send({ id, value });
    if (type === 'stop') process.disconnect();
  } catch (error) { if (process.connected) process.send({ id, error: error.message }); }
});
process.once('disconnect', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
