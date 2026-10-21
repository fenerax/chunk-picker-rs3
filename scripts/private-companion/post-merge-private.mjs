// Detached private test follow-up. This module never prepares/promotes a release.
import path from 'node:path';
import { freemem } from 'node:os';
import { readFile, writeFile, mkdir, cp, rm, lstat, open, unlink, readdir, chmod, rename } from 'node:fs/promises';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { hashTree, digestValue, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { atomicJSON, stableExecution, laneEnvironment, gateContract, hashFile, verifyLocalEvidence, gatePolicy } from './release-evidence.mjs';
import { runFileLane, verifyFileLane } from './file-test-lane.mjs';
import { toolDigest, operatorDigest, copyTools, copyOperators, buildText, textPins, pairProgress } from './postmerge-pair.mjs';
import { resolveRetryPolicy } from './retry-policy.mjs';
import { retryFailedFilesOnce } from './retry-failed-files.mjs';

const self = fileURLToPath(import.meta.url);
export const DEFAULT_CONFIG = 'C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/private-lane.json';
const hex = value => /^[a-f0-9]{40}$/.test(value ?? '');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = async file => {
  await noLinks(file);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1) throw Error('Regular private-lane JSON required.');
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
};
const inside = (root, file) => { const relative = path.relative(root, file); return !!relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const ps = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
export const redactPrivateLog = value => String(value).replace(/(?:https?|wss?):\/\/[^\s]+/gi, '[address redacted]')
  .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/gi, host => /\.(?:mjs|js|json|ps1|html|css|md)$/i.test(host) ? host : '[hostname redacted]')
  .replace(/\/join\/[^\s"'<>]+/g, '/join/<token>').replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer <token>')
  .replace(/([#?&](?:key|(?:access|invite|master|overlay)[_-]?token|token)=)[^\s"'<>\]&]+/gi, '$1<token>')
  .replace(/(?<![a-z0-9_-])[a-z0-9_-]{43}(?![a-z0-9_-])/gi, '<token>');
async function noLinks(target, missing = false) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('Linked private-lane path refused.'); }
    catch (error) { if (!missing || error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) return;
  }
}
// Progress callbacks can overlap. Serialize each destination and retry Windows
// sharing violations without exposing a partial JSON file or leaking temps.
export function createWorkerStatusWriter({ renameFile = rename, wait = delay, platform = process.platform, attempts = 8 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) throw Error('Status rename attempt limit refused.');
  const pending = new Map();
  return async (file, value) => {
    const payload = JSON.stringify(value, null, 2) + '\n';
    const target = path.resolve(file), key = platform === 'win32' ? target.toLowerCase() : target;
    const operation = (pending.get(key) ?? Promise.resolve()).then(async () => {
      await noLinks(target, true); await mkdir(path.dirname(target), { recursive: true });
      const temporary = target + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 });
        for (let attempt = 0; ; attempt++) {
          try { await renameFile(temporary, target); break; }
          catch (error) {
            if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt + 1 >= attempts) throw error;
            await wait(Math.min(200, 25 * 2 ** attempt));
          }
        }
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    const settled = operation.then(() => {}, () => {});
    pending.set(key, settled);
    settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
    return operation;
  };
}
export const writeWorkerStatus = createWorkerStatusWriter();

export function createWorkerProgressReporter({ writeStatus = writeWorkerStatus, warn = console.error } = {}) {
  const telemetry = { degraded: false, failures: 0, lastError: null };
  let tail = Promise.resolve();
  return { telemetry, async write(file, value) {
    const snapshot = JSON.parse(JSON.stringify(value));
    const operation = tail.then(async () => {
      try { await writeStatus(file, { ...snapshot, statusTelemetry: { ...telemetry } }); }
      catch (error) {
        telemetry.degraded = true; telemetry.failures++;
        telemetry.lastError = error.code ?? 'STATUS_WRITE_FAILED';
        if (telemetry.failures === 1) warn(`Private checker progress reporting degraded (${telemetry.lastError}); actual file execution continues.`);
      }
    });
    tail = operation.catch(() => {});
    return operation;
  } };
}
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function removeOwned(root, target) {
  if (!inside(root, target)) throw Error('Private-lane cleanup containment refused.');
  await noLinks(target); await rm(target, { recursive: true, force: true });
}
export async function privateConfig(input = DEFAULT_CONFIG) {
  const value = typeof input === 'string' ? (await noLinks(input), await json(input)) : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Private-lane config required.');
  let accepted = {};
  if (value.acceptedCurrent) {
    if (!path.isAbsolute(value.acceptedCurrent)) throw Error('Absolute acceptedCurrent required.');
    const pointer = await json(value.acceptedCurrent);
    if (pointer.schemaVersion !== 2 || !path.isAbsolute(pointer.config?.path ?? '')) throw Error('Accepted checker pointer refused.');
    await noLinks(pointer.config.path);
    const configHash = await hashFile(pointer.config.path);
    if (configHash !== pointer.config.sha256) throw Error('Accepted checker config pin changed.');
    const selected = await json(pointer.config.path);
    accepted = { acceptedKit: path.resolve(path.dirname(pointer.config.path), '../..'), packsDir: selected.packsDir,
      acceptedCurrentPin: { pointer: await hashFile(value.acceptedCurrent), config: configHash } };
  }
  const logsRoot = value.logsRoot ?? path.resolve(path.dirname(DEFAULT_CONFIG), 'logs/private-lane');
  const config = { ...accepted, ...value, acceptedCurrentPin: accepted.acceptedCurrentPin ?? null, logsRoot, workRoot: value.workRoot ?? path.join(logsRoot, 'work'),
    evidenceDir: value.evidenceDir ?? 'C:/Users/User/Projects/chunk-picker-rs3-private/.local/gate-evidence',
    nodePath: value.nodePath ?? process.execPath, toolsSource: value.toolsSource ?? path.join(value.privateSource ?? '', 'scripts/private-companion'),
    lanes: value.lanes ?? ['public-full', 'private-full'], concurrency: value.concurrency ?? 6,browserPath:value.browserPath??'C:/Program Files/Google/Chrome/Application/chrome.exe' };
  config.retryOnceInIsolation = resolveRetryPolicy(value);
  for (const key of ['coreRepo', 'privateSource', 'packsDir', 'heavyLock', 'nodePath', 'browserPath','toolsSource', 'logsRoot', 'workRoot', 'evidenceDir']) {
    if (!path.isAbsolute(config[key] ?? '')) throw Error(`Absolute private-lane ${key} required.`);
    config[key] = path.resolve(config[key]);
    await noLinks(config[key], true);
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 6) throw Error('Private concurrency cap must be 1-6.');
  if (!Array.isArray(config.lanes) || !config.lanes.length || new Set(config.lanes).size !== config.lanes.length || config.lanes.some(lane => !['public-full', 'private-full'].includes(lane))) throw Error('Postmerge lanes refused.');
  for (const key of ['acceptedKit', 'request', 'current', 'textFromReceipt']) if (config[key] !== undefined) { if (!path.isAbsolute(config[key])) throw Error('Absolute postmerge '+key+' required.'); await noLinks(config[key], true); }
  if (!!config.request !== !!config.current) throw Error('Postmerge request and current pointer must be supplied together.');
  for (const output of [config.logsRoot, config.workRoot, config.evidenceDir]) {
    // Core is read from immutable Git objects, so its ignored .local job area
    // is a valid output home. Never put outputs in tracked source directories.
    if (output === config.coreRepo || inside(output, config.coreRepo)
      || inside(config.coreRepo, output) && path.relative(config.coreRepo, output).split(path.sep)[0] !== '.local') throw Error('Private-lane core output placement refused.');
    for (const source of [config.privateSource, config.packsDir, config.toolsSource]) {
      if (output === source || inside(output, source) || inside(source, output)) throw Error('Private-lane outputs must be separate from inputs.');
    }
  }
  return config;
}

const gitAt = repo => (...args) => {
  const extra = typeof args.at(-1) === 'object' ? args.pop() : {};
  return execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { windowsHide: true, maxBuffer: 128 * 1024 ** 2, ...extra });
};
export function validateMergedSHA(sha, config, git = gitAt(config.coreRepo)) {
  if (!hex(sha)) throw Error('Exact lowercase 40-hex merged SHA required.');
  if (String(git('rev-parse', '--verify', sha + '^{commit}')).trim() !== sha) throw Error('Merged commit identity differs.');
  const main = String(git('rev-parse', '--verify', 'refs/heads/main^{commit}')).trim();
  if (!hex(main)) throw Error('Exact local main commit unavailable.');
  git('merge-base', '--is-ancestor', sha, main);
  const tree = String(git('rev-parse', '--verify', sha + '^{tree}')).trim();
  if (!hex(tree)) throw Error('Merged tree identity unavailable.');
  return { sha, tree };
}

// OS creation identity is mandatory. Never treat process.kill(pid,0) as proof
// that a recycled PID still belongs to this queue entry.
export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw Error('Invalid private-lane PID.');
  if (process.platform === 'win32') {
    const command = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; if($p){[Console]::Write($p.CreationDate.ToUniversalTime().Ticks.ToString())}`;
    const { stdout } = await promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
    const created = stdout.trim();
    if (!created) return null;
    if (!/^\d+$/.test(created)) throw Error('Process creation identity unavailable.');
    return { pid, created };
  }
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const created = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    if (!/^\d+$/.test(created) || !boot) throw Error('Process creation identity unavailable.');
    return { pid, created: `${boot}:${created}` };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function executionFor(config, kit, release, lane = 'private-full') {
  const overrides = lane === 'public-full' ? { RS3_DATASET: 'open-f2p' } : {
    RS3_GAME_DATA_DIR: path.join(release, '.local/assembly/.local/game-data'),
    RS3_MAP_ASSETS_DIR: path.join(release, '.local/assembly/.local/map-assets'),
    RS3_PUBLIC_BROWSER_SCREEN_HARNESS: path.join(release, 'core/tests/browser-screen-harness.mjs') };
  const env = await laneEnvironment(release, config.nodePath, {
    RS3_TEST_CONCURRENCY: String(config.concurrency), RS3_TEST_RETRY_ONCE_IN_ISOLATION: resolveRetryPolicy(config) ? '1' : '0', ...overrides });
  return { env, execution: await stableExecution({ lane, command: config.nodePath, node: config.nodePath,
    args: ['scripts/test.mjs', 'full'], env, kit, release }) };
}
export async function capturePins(config, source) {
  const acceptedCurrent = config.acceptedCurrent ? (await privateConfig(config)).acceptedCurrentPin : null;
  const symbolic = path.join(config.workRoot, source.sha, 'identity-only', 'kit');
  const executions = {};
  for (const lane of config.lanes) executions[lane] = (await executionFor(config, symbolic, path.join(symbolic, 'releases', source.sha), lane)).execution.digest;
  return { schema: 'rs3-postmerge-inputs-v2', coreSHA: source.sha, coreTree: source.tree,
    privateSource: (await hashTree(config.privateSource)).digest, packs: (await hashTree(config.packsDir)).digest,
    tools: await toolDigest(config), operator: await operatorDigest(config), heavyWrapper: await hashFile(config.heavyLock),
    executable: await hashFile(config.nodePath), browser: await hashFile(config.browserPath), executions,
    concurrency: config.concurrency, lanes: config.lanes, acceptedCurrent, text: await textPins(config) };
}
async function readComplete(job, pins, config) {
  try {
    const complete = await json(path.join(job, 'complete.json'));
    const { digest, ...body } = complete;
    const completed = Date.parse(complete.completedAt);
    if (complete.schema !== 'rs3-postmerge-complete-v2' || digest !== digestValue(body) || complete.pinsDigest !== digestValue(pins)
      || complete.sha !== pins.coreSHA || !inside(config.workRoot, complete.kit) || !inside(complete.kit, complete.release)
      || !Number.isFinite(completed) || completed > Date.now() || Date.now() - completed > gatePolicy.receiptMaxAgeMs) return null;
    await noLinks(complete.kit);
    if ((await hashTree(path.join(complete.kit, 'checks/private-source'))).digest !== pins.privateSource
      || (await hashTree(path.join(complete.kit, 'packs'))).digest !== pins.packs
      || (await hashTree(path.join(complete.release, 'core'))).digest !== complete.coreDigest) return null;
    for (const lane of config.lanes) {
      const item = complete.items[lane], { execution } = await executionFor(config, complete.kit, complete.release, lane);
      if (execution.digest !== pins.executions[lane]) return null;
      await verifyLocalEvidence(item, item.contract);
      await verifyFileLane({ kit: complete.kit, release: complete.release, lane, execution, item });
    }
    return complete;
  } catch { return null; }
}

async function spawnDetached(config, job, token, snapshot) {
  const stdout = await open(path.join(job, `${token}.stdout.log`), 'a', 0o600);
  const stderr = await open(path.join(job, `${token}.stderr.log`), 'a', 0o600);
  try {
    const child = spawn(config.nodePath, [self, '--dispatch', path.basename(job), '--config', snapshot, '--token', token], {
      cwd: job, env: sanitizeExecutionEnvironment(), detached: true, windowsHide: true, stdio: ['ignore', stdout.fd, stderr.fd],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return { pid: child.pid };
  } finally { await stdout.close(); await stderr.close(); }
}

// Only this exclusive guard may recover a stale primary claim. In particular,
// reread the primary AFTER obtaining the guard: an earlier stale token could
// already have been replaced by another reclaimer's newly live queue owner.
// A stranded recovery guard requires inspection; it is never auto-reclaimed.
async function recoverDeadQueueClaim(claim, identity) {
  const guard = claim + '.reclaimer', token = randomUUID();
  await noLinks(guard, true);
  let handle;
  try { handle = await open(guard, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid }));
    const previous = await json(claim).catch(error => { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; });
    if (!Number.isInteger(previous?.owner?.pid) || previous.owner.pid < 1
      || typeof previous.owner.created !== 'string' || !previous.owner.created
      || typeof previous.token !== 'string' || !previous.token) return false;
    const current = await identity(previous.owner.pid);
    if (current && digestValue(current) === digestValue(previous.owner)) return false;
    const latest = await json(claim).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (latest?.token !== previous.token || digestValue(latest.owner) !== digestValue(previous.owner)) return false;
    await unlink(claim);
    return true;
  } finally {
    await handle.close();
    if ((await json(guard)).token !== token) throw Error('Private queue recovery guard changed.');
    await unlink(guard);
  }
}

/** One dispatcher drains the active pair, then only the newest requested pair.
 * No process is suspended or stopped when main advances. */
export async function queuePrivate(sha, input = DEFAULT_CONFIG, dependencies = {}) {
  const config = await privateConfig(input), source = validateMergedSHA(sha, config, dependencies.git);
  const pins = await (dependencies.capturePins ?? capturePins)(config, source), pinsDigest = digestValue(pins);
  const job = path.join(config.logsRoot, sha);
  const complete = await (dependencies.readComplete ?? readComplete)(job, pins, config);
  if (complete) return { status: 'complete', sha, receipt: path.join(job, 'complete.json') };
  await mkdir(job, { recursive: true }); await noLinks(job);
  const identity = dependencies.processIdentity ?? processIdentity;
  const claim = path.join(config.logsRoot, 'queue-claim.json'), owner = await identity(process.pid), token = randomUUID();
  if (!owner) throw Error('Queue owner creation identity unavailable.');
  let handle;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { handle = await open(claim, 'wx', 0o600); await handle.writeFile(JSON.stringify({ token, owner })); await handle.close(); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Wait for a competing notification to publish instead of acknowledging
      // an undurable "pending" request that would lose a newer merge.
      await recoverDeadQueueClaim(claim, identity);
      await delay(50);
    }
  }
  if (!handle) throw Error('Could not claim private queue.');
  try {
    const snapshot = path.join(job, `${token}.config.json`);
    await writeFile(snapshot, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Do not allow a delayed older merge notification to replace a newer main.
    const latestFile = path.join(config.logsRoot, 'latest.json');
    const prior = await json(latestFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (prior && prior.sha !== sha) {
      const git = dependencies.git ?? gitAt(config.coreRepo);
      try { git('merge-base', '--is-ancestor', prior.sha, sha); }
      catch { return { status: 'superseded', sha, newest: prior.sha }; }
    }
    const latest = { schema: 'rs3-postmerge-request-v1', sha, pins, pinsDigest, config: snapshot, requestedAt: new Date().toISOString() };
    await writeWorkerStatus(latestFile, latest);
    const dispatcherFile = path.join(config.logsRoot, 'dispatcher.json');
    const previous = await json(dispatcherFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (previous?.process) {
      const current = await identity(previous.process.pid);
      if (current && digestValue(current) === digestValue(previous.process) && ['queued','running','launching'].includes(previous.phase))
        return { status: previous.sha === sha && previous.pinsDigest === pinsDigest ? 'running' : 'queued', sha, running: previous.sha, pid: current.pid };
    }
    const state = { schema: 'rs3-postmerge-job-v2', ...latest, token, phase: 'launching', queuedAt: latest.requestedAt, process: owner };
    await writeWorkerStatus(path.join(job, 'state.json'), state);
    await writeWorkerStatus(dispatcherFile, state);
    let child;
    try { child = await (dependencies.spawnDetached ?? spawnDetached)(config, job, token, snapshot); }
    catch (error) { await writeWorkerStatus(dispatcherFile, { ...state, phase: 'failed', failedAt: new Date().toISOString() }); throw error; }
    const started = await identity(child.pid);
    if (!started) throw Error('Detached process creation identity unavailable; retained launch requires inspection.');
    const queued = { ...state, phase: 'queued', process: started };
    await writeWorkerStatus(path.join(job, 'state.json'), queued);
    await writeWorkerStatus(dispatcherFile, queued);
    return { status: 'queued', sha, pid: child.pid, stdout: path.join(job, `${token}.stdout.log`), stderr: path.join(job, `${token}.stderr.log`) };
  } finally {
    if ((await json(claim)).token !== token) throw Error('Private queue claim changed.');
    await unlink(claim);
  }
}

async function exportCore(config, sha, output) {
  const git = gitAt(config.coreRepo);
  const rows = git('ls-tree', '-rz', sha).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match || /[\\:\x00-\x1f]/.test(match[3]) || match[3].split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || part.toLowerCase() === '.git')) throw Error('Core object export path refused.');
    return { mode: match[1], oid: match[2], name: match[3] };
  });
  if (new Set(rows.map(row => row.name.toLowerCase())).size !== rows.length) throw Error('Case-colliding object export refused.');
  const bytes = git('cat-file', '--batch', { input: rows.map(row => row.oid + '\n').join('') });
  let offset = 0;
  for (const row of rows) {
    const end = bytes.indexOf(10, offset), header = /^([a-f0-9]{40}) blob (\d+)$/.exec(bytes.subarray(offset, end).toString());
    if (!header || header[1] !== row.oid) throw Error('Object export header changed.');
    const length = Number(header[2]); offset = end + 1;
    const payload = bytes.subarray(offset, offset + length); offset += length + 1;
    if (payload.length !== length || createHash('sha1').update(`blob ${length}\0`).update(payload).digest('hex') !== row.oid) throw Error('Object export bytes changed.');
    const target = path.join(output, row.name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, payload, { flag: 'wx' });
    if (process.platform !== 'win32') await chmod(target, row.mode === '100755' ? 0o755 : 0o644);
  }
  if ((await hashTree(output)).files.length !== rows.length) throw Error('Object export inventory changed.');
}
async function command(command, args, { cwd, env = sanitizeExecutionEnvironment() }) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [[child.stdout, console.log], [child.stderr, console.error]].map(async ([stream, output]) => {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) output(redactPrivateLog(line));
  });
  let code, failure;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); }); }
  catch (error) { failure = error; }
  const output = await Promise.allSettled(logs);
  if (failure) throw failure;
  if (output.some(result => result.status === 'rejected')) throw Error('Private-lane log stream failed.');
  if (code !== 0) throw Error(`Private-lane child exited ${code}.`);
}
async function heavyOwner() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !/^\d+$/.test(pid ?? '')) throw Error('Shared heavy owner required.');
  const owner = await json(path.join(directory, 'owner.json'));
  if (owner.token !== token || String(owner.pid) !== pid) throw Error('Shared heavy ownership differs.');
  if (!await processIdentity(Number(pid))) throw Error('Shared heavy owner is gone.');
}

/** Test-only kit: no release preparation, practice, lifecycle or promotion. */
export async function runPrivateMerge(input, sha, { token, requireOwner = heavyOwner, memory = freemem, executeLane } = {}) {
  const config = await privateConfig(input);
  if (!hex(sha) || !/^[a-f0-9-]{36}$/.test(token ?? '')) throw Error('Private worker identity required.');
  await requireOwner();
  const job = path.join(config.logsRoot, sha), stateFile = path.join(job, 'state.json');
  const queued = await json(stateFile);
  if (queued.token !== token || queued.sha !== sha) throw Error('Private queue entry changed.');
  const source = validateMergedSHA(sha, config), pins = await capturePins(config, source);
  if (digestValue(pins) !== queued.pinsDigest) throw Error('Queued private inputs changed before admission.');
  // The shared wrapper owns mutual exclusion. Its activity wait is bypassed;
  // this independent floor remains in force, as does adaptive per-file admission.
  while (true) {
    const free = Number(await memory());
    if (!Number.isFinite(free) || free < 0) throw Error('Invalid postmerge free-memory sample.');
    if (free >= 4 * 1024 ** 3) break;
    await writeWorkerStatus(stateFile, { ...queued, phase: 'waiting_memory', progress: pairProgress({ waitingFor: '4 GiB free physical memory' }) });
    await delay(1000); await requireOwner();
  }
  const root = path.join(config.workRoot, sha.slice(0, 10), token.slice(0, 8)), kit = path.join(root, 'k'), release = path.join(kit, 'releases', 'pair');
  if (await exists(root)) throw Error('Retained private workspace requires inspection.');
  await mkdir(path.join(release, '.local'), { recursive: true }); await noLinks(root);
  await mkdir(path.join(release, 'core'));
  await writeWorkerStatus(stateFile, { ...queued, phase: 'running', workspace: root });
  await exportCore(config, sha, path.join(release, 'core'));
  await cp(config.privateSource, path.join(kit, 'checks/private-source'), { recursive: true, force: false, errorOnExist: true });
  await copyTools(config, path.join(kit, 'tools'));
  await copyOperators(config, path.join(kit, 'operator'));
  await cp(config.packsDir, path.join(kit, 'packs'), { recursive: true, force: false, errorOnExist: true });
  if ((await hashTree(path.join(kit, 'checks/private-source'))).digest !== pins.privateSource || (await hashTree(path.join(kit, 'packs'))).digest !== pins.packs)
    throw Error('Private snapshot bytes changed.');
  const privateTree = await hashTree(path.join(kit, 'checks/private-source'));
  await atomicJSON(path.join(kit, 'kit.json'), { schemaVersion: 2, concurrency: config.concurrency, browser: { path: config.browserPath },
    retryOnceInIsolation: resolveRetryPolicy(config),
    locks: { heavy: { path: config.heavyLock, sha256: pins.heavyWrapper } } });
  const textOverrides = await buildText(config, release);
  if (await exists(path.join(release, '.local/text-source'))) await removeOwned(path.join(release, '.local'), path.join(release, '.local/text-source'));
  await atomicJSON(path.join(release, 'companion.json'), { schemaVersion: 1, coreRoot: path.join(release, 'core'),
    packsDir: path.join(kit, 'packs'), packs: await json(path.join(kit, 'packs/selection.json')),
    privateFiles: privateTree.files.map(file => ({ path: file.path, sha256: file.sha256 })), textOverrides });
  const manifest = { repo: config.coreRepo, base: sha, revision: sha }, items = {}, timings = [];
  const progressReporter = createWorkerProgressReporter();
  for (const lane of config.lanes) {
    const { env, execution } = await executionFor(config, kit, release, lane);
    if (execution.digest !== pins.executions[lane]) throw Error('Private execution pin changed.');
    const contract = gateContract(lane, { coreSHA: sha, coreTree: source.tree, privateSource: pins.privateSource,
      packs: pins.packs, producer: pins.tools, wrapper: pins.heavyWrapper }, execution);
    const assembly = path.join(release, lane === 'public-full' ? '.local/public-assembly' : '.local/assembly');
    // lane-trace holds per-file traces, which decide whether a pass can be reused.
    const scratch = ['lane-home', 'lane-temp', 'compile-cache', 'lane-trace'].map(name => path.join(release, '.local', name));
    const executeAttempt = async (files,{inventory:plannedInventory}, isolated = false) => {
      const attemptEnv = isolated ? { ...env, RS3_TEST_CONCURRENCY: '1', RS3_TEST_RETRY_ONCE_IN_ISOLATION: '0' } : env;
      if (executeLane) return executeLane({ files, lane, kit, release, execution, env: attemptEnv, isolated,
        minConcurrency: isolated ? 1 : Math.min(2, config.concurrency), maxConcurrency: isolated ? 1 : config.concurrency });
      let result, completed = 0;
      let laneStartedAt = performance.now(), preparationMs = null;
      const progress = async (extra = {}) => progressReporter.write(stateFile, { ...queued, phase: 'running', workspace: root,
        summaries: timings, progress: { ...pairProgress({ lane, completed, total: files.length, elapsedMs: performance.now() - laneStartedAt, ...extra }), preparationMs } });
      try {
        for (const directory of scratch) { if (await exists(directory)) throw Error('Retained private execution scratch refused.'); await mkdir(directory); }
        for (const name of ['Local', 'Roaming']) await mkdir(path.join(scratch[0], 'AppData', name), { recursive: true });
        await progress({waitingFor:'preparing isolated assembly'});
        if (lane === 'public-full') await cp(path.join(release, 'core'), assembly, { recursive: true, errorOnExist: true, force: false });
        else await command(config.nodePath, [path.join(kit, 'tools/companion-check.mjs'), '--core', path.join(release, 'core'), '--receipt', path.join(release, 'companion.json'), '--lane', 'prepare', '--output', assembly], { cwd: kit, env: attemptEnv });
        await progress({waitingFor:'verifying complete file inventory'});
        const { discoverTests } = await import(pathToFileURL(path.join(assembly, 'scripts/test-selection.mjs')));
        const inventory = (await discoverTests(path.join(assembly, 'tests'), 'full')).map(name => 'tests/' + name).sort();
        if (digestValue(inventory) !== digestValue([...plannedInventory].sort()) || files.some(file => !inventory.includes(file))) throw Error('Full discovery inventory differs from lane evidence.');
        const { runAdaptive } = await import(pathToFileURL(path.join(kit, 'checks/private-source/scripts/adaptive-test-runner.mjs')));
        const ownerEnv = Object.fromEntries(['RS3_HEAVY_LOCK_PATH', 'RS3_HEAVY_LOCK_TOKEN', 'RS3_HEAVY_LOCK_PID'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
        preparationMs = performance.now() - laneStartedAt;
        laneStartedAt = performance.now();
        result = await runAdaptive({ files, cwd: assembly, env: { ...attemptEnv, ...ownerEnv }, minConcurrency: isolated ? 1 : Math.min(2, config.concurrency), maxConcurrency: isolated ? 1 : config.concurrency,
          floorBytes: 4 * 1024 ** 3, traceRoot: scratch[3],
          onFile: async () => { completed++; await progress(); },
          onSchedule: async ({ active, pending, freeBytes }) => progress({ active, waitingFor: pending && !active && freeBytes < 5 * 1024 ** 3 ? 'memory admission (4 GiB floor plus worker reserve)' : null }),
          onEvent: ({ type, data }) => {
            if (type === 'test:fail') console.error(redactPrivateLog(`FAIL ${data.entryFile ?? data.file}: ${data.name}\n${data.details.error?.stack ?? data.details.error ?? ''}`));
            else if (type === 'test:stderr') console.error(redactPrivateLog(data.message));
          } });
      } finally {
        for (const target of [assembly, ...scratch]) if (await exists(target)) await removeOwned(path.join(release, '.local'), target);
      }
      if (digestValue(await capturePins(config, source)) !== queued.pinsDigest) throw Error('Private input pins changed during execution.');
      return result;
    };
    const execute = async (files, context) => retryFailedFilesOnce({
      result: await executeAttempt(files, context), enabled: resolveRetryPolicy(config),
      // executeAttempt tears down assembly/home/temp/cache before returning.
      // A retry therefore rebuilds all scratch and admits only this one file.
      runIsolated: selected => executeAttempt(selected, context, true),
      onFlaky: async file => {
        const notice = { warning: 'FLAKY: initial failure passed once in isolation', file: file.file, lane };
        console.error(JSON.stringify(notice));
        await writeFile(path.join(release, '.local/flaky-files.jsonl'), JSON.stringify(notice) + '\n', { flag: 'a' });
      },
    });
    try {
      items[lane] = await runFileLane({ kit, release, manifest, lane, execution, contract, directory: config.evidenceDir, timings, execute, runId: token });
      const current = await json(stateFile);
      await writeWorkerStatus(stateFile, { ...current, summaries: timings });
    } catch (error) {
      const current = await json(stateFile);
      await writeWorkerStatus(stateFile, { ...current, phase: 'failed', summaries: timings,
        failure: error.fileSummary ?? { stage: lane, reason: redactPrivateLog(error.message) } });
      throw error;
    }
  }
  await requireOwner();
  if (digestValue(await capturePins(config, source)) !== queued.pinsDigest) throw Error('Private input pins changed during execution.');
  const body = { schema: 'rs3-postmerge-complete-v2', sha, pinsDigest: queued.pinsDigest, kit, release, items,
    coreDigest: (await hashTree(path.join(release, 'core'))).digest, completedAt: new Date().toISOString(), requestReady: pins.text.available, summaries: timings, statusTelemetry: { ...progressReporter.telemetry } };
  await writeWorkerStatus(path.join(job, 'complete.json'), { ...body, digest: digestValue(body) });
  await writeWorkerStatus(stateFile, { ...queued, phase: 'complete', completedAt: body.completedAt, workspace: root, requestReady: body.requestReady, summaries: timings, statusTelemetry: body.statusTelemetry });
  return items;
}

export async function dispatch(config, sha, token, configPath, dependencies = {}) {
  const dispatcherFile = path.join(config.logsRoot, 'dispatcher.json');
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await json(dispatcherFile);
    if (state.token !== token) throw Error('Private queue entry changed before dispatch.');
    if (state.phase === 'queued' && state.process?.pid === process.pid) { ready = true; break; }
    await delay(100);
  }
  if (!ready) throw Error('Queue process creation identity was not persisted.');
  let activeConfig = config;
  for (;;) {
    const stateFile = path.join(config.logsRoot, sha, 'state.json'), queued = await json(stateFile);
    await writeWorkerStatus(dispatcherFile, { ...queued, phase: 'running' });
    let failed = false;
    try {
      await (dependencies.command ?? command)(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', activeConfig.heavyLock,
        activeConfig.nodePath, self, '--worker', sha, '--config', configPath, '--token', token], {
        cwd: config.logsRoot, env: { ...sanitizeExecutionEnvironment(), RS3_HEAVY_IGNORE_ACTIVITY: '1' } });
    } catch (error) {
      failed = true;
      const current = await json(stateFile);
      await writeWorkerStatus(stateFile, { ...current, phase: 'failed', failedAt: new Date().toISOString(), error: redactPrivateLog(error.message) });
    }
    // Serialize the final latest-read with enqueue, so a last-moment merge
    // cannot be stranded behind a dispatcher that just exited.
    const claim = path.join(config.logsRoot, 'queue-claim.json'), claimToken = randomUUID();
    let lock;
    for (let attempt = 0; !lock && attempt < 300; attempt++) {
      try { lock = await open(claim, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await recoverDeadQueueClaim(claim, dependencies.processIdentity ?? processIdentity);
        await delay(50);
      }
    }
    if (!lock) throw Error('Private queue claim remained busy after completion; retry the newest merge.');
    try {
      await lock.writeFile(JSON.stringify({ token: claimToken, owner: queued.process })); await lock.close();
      const latest = await json(path.join(config.logsRoot, 'latest.json'));
      if (latest.sha === sha && latest.pinsDigest === queued.pinsDigest) {
        await writeWorkerStatus(dispatcherFile, { ...queued, phase: failed ? 'failed' : 'complete', finishedAt: new Date().toISOString() });
        return;
      }
      sha = latest.sha; token = randomUUID(); configPath = latest.config;
      activeConfig = await privateConfig(configPath);
      const next = { schema: 'rs3-postmerge-job-v2', ...latest, token, phase: 'queued', process: queued.process };
      await writeWorkerStatus(path.join(config.logsRoot, sha, 'state.json'), next);
      await writeWorkerStatus(dispatcherFile, next);
    } finally {
      if ((await json(claim)).token !== claimToken) throw Error('Private queue claim changed.');
      await unlink(claim);
    }
  }
}
export async function pairStatus(sha, input = DEFAULT_CONFIG, dependencies = {}) {
  const config = await privateConfig(input), source = validateMergedSHA(sha, config, dependencies.git);
  const pins = await (dependencies.capturePins ?? capturePins)(config, source);
  const complete = await (dependencies.readComplete ?? readComplete)(path.join(config.logsRoot, sha), pins, config);
  const state = await json(path.join(config.logsRoot, sha, 'state.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const dispatcher = await json(path.join(config.logsRoot, 'dispatcher.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const latest = await json(path.join(config.logsRoot, 'latest.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const actual = dispatcher?.process ? await (dependencies.processIdentity ?? processIdentity)(dispatcher.process.pid) : null;
  const alive = actual && digestValue(actual) === digestValue(dispatcher.process);
  const runningState = alive && hex(dispatcher.sha) ? await json(path.join(config.logsRoot, dispatcher.sha, 'state.json')).catch(() => null) : null;
  const bothLanes = ['public-full', 'private-full'].every(lane => config.lanes.includes(lane));
  return { schema: 'rs3-next-pair-status-v1', sha, checked: !!complete, ready: !!complete && !!pins.text?.available && bothLanes,
    reason: !pins.text?.available ? 'next release request unavailable; private release readiness unknown' : !bothLanes ? 'partial lane selection' : complete ? 'exact pair checked' : 'missing, stale, changed or unfinished pair evidence',
    lanes: config.lanes, running: alive && ['queued', 'running', 'launching'].includes(dispatcher.phase) ? { sha: dispatcher.sha, pid: actual.pid,
      phase: runningState?.phase ?? dispatcher.phase, progress: runningState?.progress ?? pairProgress(), summaries: runningState?.summaries ?? [] } : null,
    queued: latest && alive && ['queued', 'running', 'launching'].includes(dispatcher.phase)
      && (latest.sha !== dispatcher.sha || latest.pinsDigest !== dispatcher.pinsDigest) ? { sha: latest.sha } : null,
    progress: state?.pinsDigest === digestValue(pins) ? state.progress ?? pairProgress() : pairProgress(),
    statusTelemetry: complete?.statusTelemetry ?? (state?.pinsDigest === digestValue(pins) ? state?.statusTelemetry ?? null : null),
    summaries: complete?.summaries ?? (state?.pinsDigest === digestValue(pins) ? state.summaries ?? [] : []),
    etaSeconds: runningState?.progress?.etaSeconds ?? null,
    etaBasis: runningState?.progress?.etaBasis ?? 'unknown; no comparable completed run estimate' };
}
export function parsePrivateArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const mode = ['--dispatch', '--worker', '--status'].includes(args[0]) ? args.shift() : 'queue';
  const sha = args.shift(), result = { mode, sha, config: DEFAULT_CONFIG };
  if (!hex(sha)) throw Error('Usage: post-merge-private.mjs <40-hex merged SHA> [--config <absolute JSON>]');
  const seen = new Set();
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--config', '--token', '--lane', '--request', '--current'].includes(key) || !value || seen.has(key) || key === '--token' && !['--dispatch', '--worker'].includes(mode)) throw Error('Private queue arguments refused.');
    seen.add(key); result[key.slice(2)] = value;
  }
  if (!path.isAbsolute(result.config) || !!result.request !== !!result.current || ['--dispatch', '--worker'].includes(mode) && !/^[a-f0-9-]{36}$/.test(result.token ?? '')) throw Error('Private queue arguments refused.');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const options = parsePrivateArguments(process.argv.slice(2));
  if (options.help) console.log(`Usage: node post-merge-private.mjs <40-hex merged SHA> [--config <absolute JSON>]\nDefault config: ${DEFAULT_CONFIG}\nChecks exact local-main ancestry and whole public/private lane receipts; queues the newest pair through the shared heavy wrapper. No idle wait or activation. --status SHA reports readiness. --lane private-full checks only that lane. --request JSON --current POINTER pins next release text. No scheduled task is installed.`);
  else {
    try {
      const config = await privateConfig({ ...await privateConfig(options.config), ...(options.lane ? { lanes: [options.lane] } : {}), ...(options.request ? { request: options.request, current: options.current } : {}) });
      if (options.mode === '--status') console.log(JSON.stringify(await pairStatus(options.sha, config), null, 2));
      else if (options.mode === 'queue') console.log(JSON.stringify(await queuePrivate(options.sha, config)));
      else if (options.mode === '--dispatch') await dispatch(config, options.sha, options.token, options.config);
      else await runPrivateMerge(config, options.sha, { token: options.token });
    } catch (error) {
      if (['--dispatch', '--worker'].includes(options.mode)) {
        try {
          const config = await privateConfig(options.config), stateFile = path.join(config.logsRoot, options.sha, 'state.json'), current = await json(stateFile);
          if (current.token === options.token) await writeWorkerStatus(stateFile, { ...current, phase: 'failed', failedAt: new Date().toISOString(), error: redactPrivateLog(error.message) });
        } catch {}
      }
      console.error(redactPrivateLog(error.stack ?? error)); process.exitCode = 1;
    }
  }
}
