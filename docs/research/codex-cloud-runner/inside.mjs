// Runs only inside the exact owned Docker container. No dependency or network setup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const pins = JSON.parse(fs.readFileSync('/runner/pins.json', 'utf8'));
// The host applies the same closed public projection again before printing.
// Reading a Python-owned data policy avoids two independently drifting allowlists.
const publicPolicy = JSON.parse(fs.readFileSync('/runner/result-policy.json', 'utf8'));
const argv = process.argv.slice(2), args = { arg: [] };
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].slice(2), value = argv[i + 1];
  if (key === 'arg') args.arg.push(value); else args[key] = value;
}
const profile = { cpus: args.control === 'cpu' ? .25 : 2, memory: args.control === 'memory' ? 128 * 1024 ** 2 : pins.memoryBytes };
const fd = fs.openSync('/scratch/envelope.jsonl', 'ax', 0o600), start = performance.now();
let samples = 0, rssUnknownSamples = 0, pssUnknownSamples = 0, peak = 0, child;
const write = (stage, facts = {}) => {
  fs.writeSync(fd, JSON.stringify({ schema: 'docker-inside-event-v1', stage, elapsedMs: performance.now() - start, ...facts }) + '\n');
  fs.fsyncSync(fd);
};
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const read = name => fs.readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim();
const numeric = name => { const s = read(name); ensure(/^\d+$/.test(s), 'cgroup-numeric-file-missing'); return Number(s); };
const kv = name => Object.fromEntries(read(name).split('\n').map(x => { const [k, v] = x.split(/\s+/); return [k, Number(v)]; }));
function cpus(value) {
  return value.split(',').flatMap(part => { const [a, b = a] = part.split('-').map(Number); ensure(a <= b && b < 65536, 'invalid-cpuset'); return Array.from({ length: b - a + 1 }, (_, i) => a + i); }).sort((a, b) => a - b);
}
const sameCpus = (a, b) => JSON.stringify(cpus(a)) === JSON.stringify(cpus(b));
function census() {
  let rssKiB = 0, pssKiB = 0, rssUnknown = 0, pssUnknown = 0, races = 0, processes = 0, tasks = 0, zombieLeaders = 0;
  for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      processes++;
      tasks += Number(status.match(/^Threads:\s+(\d+)/m)?.[1] ?? 0);
      zombieLeaders += /^State:\s+Z/m.test(status) ? 1 : 0;
      const rss = status.match(/^VmRSS:\s+(\d+) kB/m);
      if (rss) rssKiB += Number(rss[1]); else rssUnknown++;
      try {
        const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+) kB/m);
        if (rollup) pssKiB += Number(rollup[1]); else pssUnknown++;
      } catch { pssUnknown++; }
    } catch { races++; rssUnknown++; pssUnknown++; }
  }
  return { processes, tasks, zombieLeaders, sampledRssKiB: rssKiB, sampledPssKiB: pssKiB, rssUnknown, pssUnknown, races,
    scope: 'container-pid-namespace-process-leaders-sampled-nonatomic-rss-shared-pages-double-counted-pss-readable-only' };
}
function sample(stage = 'resource-sample') {
  const mem = numeric('memory.current'), memPeak = numeric('memory.peak'), proc = census();
  peak = Math.max(peak, memPeak); samples++;
  if (proc.rssUnknown) rssUnknownSamples++;
  if (proc.pssUnknown) pssUnknownSamples++;
  const facts = { memoryCurrent: mem, memoryPeak: memPeak, memorySwapCurrent: numeric('memory.swap.current'), memoryEvents: kv('memory.events'),
    cpuStat: kv('cpu.stat'), pidsCurrent: numeric('pids.current'), pidsEvents: kv('pids.events'), proc };
  ensure(mem <= profile.memory && memPeak <= profile.memory, 'memory-over-cap');
  ensure(facts.memorySwapCurrent === 0 && facts.pidsCurrent <= 512, 'swap-or-pids-outside-envelope');
  write(stage, facts);
  return facts;
}
async function exitOf(proc) {
  return new Promise((resolve, reject) => { proc.once('error', reject); proc.once('close', (code, signal) => resolve({ code, signal })); });
}
async function orphanFixture() {
  // Parent exits immediately, leaving a short-lived grandchild for PID1 to reap.
  const code = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},80)'],{stdio:'ignore'});console.log(c.pid);c.unref();process.exit(0)";
  const parent = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/runtime:/usr/bin:/bin' } });
  let output = '';
  parent.stdout.on('data', b => { if (output.length < 32) output += b.toString(); });
  const end = await exitOf(parent), pid = Number(output.trim());
  ensure(end.code === 0 && Number.isInteger(pid) && pid > 1, 'orphan-fixture-parent-failed');
  const deadline = performance.now() + 3000;
  while (fs.existsSync('/proc/' + pid) && performance.now() < deadline) await new Promise(r => setTimeout(r, 20));
  ensure(!fs.existsSync('/proc/' + pid), 'init-orphan-not-reaped');
  write('orphan-reaped', { pid, parentExitCode: end.code, absentAfterExit: true });
}
function sanitized(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (publicPolicy.scalarKeys.includes(key) && (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) < 1e15))) out[key] = item;
    if (publicPolicy.hashKeys.includes(key) && typeof item === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(item)) out[key] = item;
    if (publicPolicy.enums[key]?.includes(item)) out[key] = item;
    if (key === 'metrics' && item && typeof item === 'object') out.metrics = Object.fromEntries(Object.entries(item).filter(([k, v]) => publicPolicy.metricKeys.includes(k) && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e15));
    if (key === 'scope' && item && typeof item === 'object') out.scope = Object.fromEntries(Object.entries(item).filter(([k, v]) => publicPolicy.scope[k]?.includes(v)));
    if (key === 'openGates' && Array.isArray(item)) out.openGates = item.filter(x => publicPolicy.openGates.includes(x));
  }
  return out;
}
function boundedCaseResult(filename) {
  const handle = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(handle);
    ensure(info.isFile() && info.size <= 32768, 'case-result-not-small-regular-file');
    const bytes = Buffer.alloc(32769), count = fs.readSync(handle, bytes, 0, bytes.length, 0);
    ensure(count <= 32768, 'case-result-too-large');
    return JSON.parse(bytes.subarray(0, count).toString('utf8'));
  } finally { fs.closeSync(handle); }
}
function writeSourceLock() {
  // Same complete-byte manifest recipe as the independently reviewed R116 source verifier.
  // Source was already matched against the host's exact-commit public Git archive receipt.
  const files = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = relative ? relative + '/' + entry.name : entry.name, target = path.join(directory, entry.name);
      ensure(!entry.isSymbolicLink(), 'source-lock-symlink');
      if (entry.isDirectory()) visit(target, name);
      else {
        ensure(entry.isFile(), 'source-lock-special-file');
        const bytes = fs.readFileSync(target);
        files.push({ path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  visit('/source'); files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const names = ['app/server.mjs', 'app/storage/store.mjs', 'app/datasets.mjs', 'app/dataset-runtime.mjs', 'app/core/state.mjs', 'app/private-addon.mjs'];
  const criticalFiles = Object.fromEntries(names.map(name => { const item = files.find(x => x.path === name); ensure(Boolean(item), 'source-lock-anchor-missing'); return [name, item.sha256]; }));
  const manifestSha256 = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const lock = { schemaVersion: 1, sourceCommit: pins.sourceCommit, manifestSha256, criticalFiles, files, verification: 'host-verified-public-git-archive' };
  fs.writeFileSync('/scratch/source-lock.json', JSON.stringify(lock) + '\n', { mode: 0o600 });
  write('source-lock-created', { sourceCommit: pins.sourceCommit, manifestSha256, files: files.length });
}
async function main() {
  write('probe-start', { envelope: pins.envelope, node: process.version, pid: process.pid, control: args.control });
  ensure(process.version === pins.node && process.arch === 'x64', 'node-version-or-architecture-mismatch');
  ensure(process.getuid() === Number(args.uid) && process.getuid() !== 0, 'container-not-expected-nonroot');
  ensure(fs.readFileSync('/proc/self/cgroup', 'utf8').trim() === '0::/', 'private-cgroup-v2-required');
  const quota = read('cpu.max').split(/\s+/).map(Number), cpuset = read('cpuset.cpus.effective');
  const affinity = fs.readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s+(.+)$/m)?.[1];
  const initComm = fs.readFileSync('/proc/1/comm', 'utf8').trim();
  const facts = { cpuMax: read('cpu.max'), cpuset, affinity, memoryMax: read('memory.max'), memorySwapMax: read('memory.swap.max'), pidsMax: read('pids.max'), initComm };
  write('cgroup-admission', facts);
  ensure(Number.isFinite(quota[0]) && quota[0] / quota[1] === profile.cpus, 'cpu-quota-mismatch');
  ensure(sameCpus(cpuset, args.cpus) && sameCpus(affinity, args.cpus) && cpus(cpuset).length === 2, 'cpu-affinity-mismatch');
  ensure(numeric('memory.max') === profile.memory && numeric('memory.swap.max') === 0 && numeric('pids.max') === 512, 'cgroup-hard-limit-mismatch');
  ensure(['docker-init', 'tini', 'catatonit'].includes(initComm), 'init-process-missing');
  const net = fs.readdirSync('/sys/class/net').sort();
  ensure(JSON.stringify(net) === '["lo"]', 'non-loopback-interface-present');
  write('network-admission', { interfaces: ['lo'], appEgress: 'none', loopbackOnly: true });
  const before = sample('resource-before');
  ensure(before.memoryEvents.oom_kill === 0 && before.memoryEvents.oom === 0 && before.pidsEvents.max === 0, 'fresh-container-events-not-zero');
  await orphanFixture();
  let caseResult = {};
  if (args.control === 'cpu') {
    child = spawn(process.execPath, ['-e', 'const end=Date.now()+3000;while(Date.now()<end){}'], { stdio: 'ignore' });
    ensure((await exitOf(child)).code === 0, 'cpu-control-child-failed');
    const after = sample('cpu-control-after');
    ensure(after.cpuStat.nr_throttled > before.cpuStat.nr_throttled && after.cpuStat.throttled_usec > before.cpuStat.throttled_usec, 'tiny-cpu-cap-not-observed');
  } else if (args.control === 'memory') {
    // Remote disposable container ONLY: kernel limit must kill this child, never host memory.
    child = spawn(process.execPath, ['-e', 'const b=Buffer.allocUnsafe(256*1024*1024);b.fill(1);setTimeout(()=>console.log(b[0]),5000)'], { stdio: 'ignore' });
    const killed = await exitOf(child), after = sample('memory-control-after');
    write('memory-control-child-exit', { childExitCode: killed.code, childSignal: killed.signal, deltaOomKill: after.memoryEvents.oom_kill - before.memoryEvents.oom_kill });
    ensure(killed.signal === 'SIGKILL' && after.memoryEvents.oom_kill > before.memoryEvents.oom_kill, 'tiny-memory-cap-not-observed');
  } else if (args.control === 'positive') {
    child = spawn(process.execPath, ['-e', 'const b=Buffer.alloc(16*1024*1024,1);const end=Date.now()+200;while(Date.now()<end){};process.exit(b[0]===1?0:1)'], { stdio: 'ignore' });
    ensure((await exitOf(child)).code === 0, 'positive-control-child-failed');
  } else {
    writeSourceLock();
    const entry = path.resolve('/harness', args.entrypoint);
    ensure(entry.startsWith('/harness/') && fs.statSync(entry).isFile(), 'case-entrypoint-invalid');
    const env = { ...process.env, PERF_PLAYWRIGHT_MODULE: 'file:///deps/node_modules/playwright/index.mjs' };
    // Extra FD3 is the ONLY child log surface accepted; stdout/stderr are hashed, never retained or printed.
    child = spawn(process.execPath, [entry, ...args.arg], { cwd: '/scratch', env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    const output = { stdoutBytes: 0, stderrBytes: 0 }, hashes = { stdout: crypto.createHash('sha256'), stderr: crypto.createHash('sha256') };
    for (const name of ['stdout', 'stderr']) child[name].on('data', bytes => { output[name + 'Bytes'] += bytes.length; hashes[name].update(bytes); });
    let pending = '', stageBytes = 0, stageError = false;
    const allowed = new Set(publicPolicy.stages);
    child.stdio[3].on('data', bytes => {
      stageBytes += bytes.length;
      if (stageBytes > 1024 * 1024) { stageError = true; return; }
      pending += bytes.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        try { const event = JSON.parse(line); if (!allowed.has(event.stage)) throw new Error(); write('case-stage', { caseStage: event.stage }); }
        catch { stageError = true; }
      }
    });
    const timer = setInterval(() => { try { sample(); } catch (e) { write('sample-failed', { reasonCode: 'resource-sample-failed' }); process.exitCode = 1; child.kill('SIGTERM'); } }, 1000);
    const outcome = await exitOf(child); clearInterval(timer);
    write('case-exited', { ...outcome, ...output, stdoutSha256: hashes.stdout.digest('hex'), stderrSha256: hashes.stderr.digest('hex') });
    const resultPath = '/scratch/case-result.json';
    caseResult = sanitized(boundedCaseResult(resultPath));
    ensure(caseResult.passed === true || publicPolicy.enums.status.includes(caseResult.status), 'case-result-protocol-incomplete');
    ensure((outcome.code === 0 || outcome.code === 1 && caseResult.status === 'failed') && process.exitCode !== 1 && !stageError && !pending.trim(), 'case-exit-or-stage-protocol-failed');
    caseResult.caseExitCode = outcome.code;
  }
  const after = sample('resource-final');
  if (args.control !== 'memory') ensure(after.memoryEvents.oom === 0 && after.memoryEvents.oom_kill === 0, 'unexpected-oom');
  ensure(after.pidsEvents.max === 0, 'unexpected-pids-cap-hit');
  // Other descendants may still exist; exiting this wrapper terminates the whole owned container.
  // Host confirms wait + State.Running=false/Pid=0 + exact-ID removal, independently of this census.
  const result = { schema: 'docker-hard-2cpu-6g-result-v1', passed: true, control: args.control,
    intentionalNegative: ['cpu', 'memory'].includes(args.control), samples, cgroupMemoryPeak: peak,
    rssUnknownSamples, pssUnknownSamples, orphanReaped: true, caseResult };
  fs.writeFileSync('/scratch/envelope-result.json', JSON.stringify(result) + '\n', { mode: 0o600 });
  write('probe-finished', { passed: true });
}
const watchdog = setTimeout(() => { write('deadline', { reasonCode: 'container-wall-deadline' }); process.exit(124); }, Math.max(1000, (Number(args.seconds) - 18) * 1000));
main().catch(() => { write('probe-failed', { reasonCode: 'inside-probe-or-case-failed' }); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); fs.closeSync(fd); });
