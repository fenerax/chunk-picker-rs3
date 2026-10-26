// Seven alternating AB/BA pairs, fresh server/process calculators per run.
// Linux /proc sampling includes the server and all owned calculator processes.
// node scripts/perf/request-path-paired.mjs --before ROOT --after ROOT --companion DIR --output FILE [--pairs 7] [--mode http|object|json]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const mode = option('mode') ?? 'http', pairs = Number(option('pairs') ?? 7);
assert.ok(['http', 'object', 'json'].includes(mode));
assert.ok(Number.isSafeInteger(pairs) && pairs >= 7);
assert.ok(process.version.startsWith('v24.'));
const output = path.resolve(option('output')), companion = path.resolve(option('companion'));
await mkdir(path.dirname(output), { recursive: true });
const script = fileURLToPath(new URL(mode === 'http' ? './request-path-http.mjs' : './request-path.mjs', import.meta.url));
const probe = fileURLToPath(new URL('./request-path-probe.mjs', import.meta.url));
const now = () => performance.timeOrigin + performance.now();
const roots = { before: path.resolve(option('before')), after: path.resolve(option('after')) };
async function memory(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    return [{ pid, rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
      highWater: Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 }];
  } catch { return []; }
}
async function run(pair, variant) {
  const filename = `${output}.${pair}.${variant}.json`, samples = [];
  const child = spawn(process.execPath, ['--expose-internals', '--expose-gc', '--max-old-space-size=3072', '--import', probe, script,
    '--root', roots[variant], '--companion', companion, '--output', filename,
    ...(mode === 'http' ? [] : ['--requests', '1', '--transport', mode])], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', sampling = false; const pids = new Set([child.pid]);
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const sample = async () => {
    if (sampling) return; sampling = true;
    try {
      // Some cloud kernels omit /proc/PID/task/PID/children. Spawn events
      // identify every owned process without scanning unrelated processes.
      const logText = await readFile(filename + '.jsonl', 'utf8').catch(() => '');
      for (const line of logText.split('\n').slice(0, -1)) {
        const event = JSON.parse(line); if (event.stage === 'childSpawned') pids.add(event.childPid);
      }
      const processes = (await Promise.all([...pids].map(memory))).flat(); samples.push({ at: now(), rss: processes.reduce((sum, row) => sum + row.rss, 0), processes }); }
    finally { sampling = false; }
  };
  const timer = setInterval(sample, 50); timer.unref();
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearInterval(timer); }
  await writeFile(filename + '.log', log);
  assert.equal(code, 0, log.slice(-4000));
  const result = JSON.parse(await readFile(filename, 'utf8'));
  const start = result.events.find(row => row.stage === (mode === 'http' ? 'actionStart' : 'requestStart')).at;
  const end = result.events.find(row => row.stage === (mode === 'http' ? 'actionEnd' : 'requestEnd')).at;
  const endPreview = mode === 'http' ? result.events.find(row => row.stage === 'previewEnd').at : end;
  const events = result.events.filter(row => row.at >= start && row.at <= endPreview);
  const stage = name => events.filter(row => row.stage === name);
  const dispatch = stage('schedulerDispatch').find(row => row.type === 'predict');
  const host = stage('hostReceived').find(row => row.kind === 'post' && (!dispatch || row.id === dispatch.id));
  const hostDispatch = stage('hostDispatch').find(row => row.pid === host.pid && row.id === host.id);
  const received = stage('workerReceived').find(row => row.pid === host.pid && row.id === host.id);
  const encode = stage('encodeProcessMessage').filter(row => row.at < host.at).at(-1);
  const ipc = stage('ipcSerialize').filter(row => row.at < host.at).at(-1);
  const nativeDecode = stage('ipcDeserialize').find(row => row.pid === host.pid && row.kind === 'post' && row.id === host.id);
  const nativeEncode = stage('ipcNativeSerialize').find(row => row.kind === 'post' && row.id === host.id);
  const decode = stage('decodeReceivedProcessMessage').find(row => row.pid === host.pid && row.at > host.at);
  const forward = stage('threadSerialize').find(row => row.pid === host.pid && row.at > hostDispatch.at);
  const actionSamples = samples.filter(row => row.at >= start && row.at <= end);
  const maxRSS = list => Math.max(0, ...list.map(row => row.rss)) / 1048576;
  assert.ok(maxRSS(actionSamples) > 0 && pids.size >= 2, 'Process-tree RSS sampling was unavailable');
  const metrics = { receiveMs: received.at - start,
    stateCloneMs: stage('stateClone').reduce((sum, row) => sum + row.ms, 0), schedulerQueueMs: dispatch?.queueMs ?? 0,
    graphEncodeMs: encode.ms, ipcSerializeMs: nativeEncode.ms, ipcSendMs: ipc.ms,
    ipcDeserializeMs: nativeDecode.ms, ipcDeliveryQueueMs: nativeDecode.at - nativeDecode.ms - ipc.at,
    ipcCallbackMs: host.at - nativeDecode.at, transferBytes: nativeEncode.bytes,
    hostRestoreMs: decode.ms, threadSerializeMs: forward.ms, threadDeserializeQueueMs: received.at - forward.at,
    previewMs: result.action?.previewMs ?? result.requests[0].roundTripMs,
    actionMs: result.action?.totalMs ?? result.requests[0].roundTripMs,
    actionPeakRSSMiB: maxRSS(actionSamples), wholePeakRSSMiB: maxRSS(samples) };
  const observation = { pair, variant, metrics, stateJSONBytes: result.stateJSONBytes, stateV8Bytes: result.stateV8Bytes,
    signatures: result.action ? { prediction: result.action.prediction.sha256, tasks: result.action.result.sha256 } : result.signatures,
    samples: samples.length, processHighWaterMiB: Object.fromEntries([...new Set(samples.flatMap(row => row.processes.map(p => p.pid)))].map(pid =>
      [pid, Math.max(...samples.flatMap(row => row.processes.filter(p => p.pid === pid).map(p => p.highWater))) / 1048576])) };
  console.log(JSON.stringify(observation));
  return observation;
}
const report = { format: 'request-path-paired-v1', node: process.version, availableCPUs: availableParallelism(), heapMiB: 3072, rssSamplingMs: 50, mode, pairs, roots, companion, observations: [], complete: false };
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), percentile = q => sorted[Math.floor((sorted.length - 1) * q)];
  return { median: percentile(0.5), min: sorted[0], max: sorted.at(-1), p25: percentile(0.25), p75: percentile(0.75) };
};
for (let pair = 0; pair < pairs; pair++) {
  const observations = [];
  for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
    const observation = await run(pair, variant); report.observations.push(observation); observations.push(observation);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual(observations[0].signatures, observations[1].signatures, `Complete normalized responses differ in pair ${pair}`);
}
report.summary = Object.fromEntries(Object.keys(report.observations[0].metrics).map(metric => {
  const before = report.observations.filter(row => row.variant === 'before'), after = report.observations.filter(row => row.variant === 'after');
  const deltas = before.map(row => after.find(candidate => candidate.pair === row.pair).metrics[metric] - row.metrics[metric]);
  return [metric, { before: stats(before.map(row => row.metrics[metric])), after: stats(after.map(row => row.metrics[metric])), pairedDelta: stats(deltas) }];
}));
report.complete = true;
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
