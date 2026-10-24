// Child of case-entry.mjs; IPC FD3 is separate from the wrapper's raw FD3 pipe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensure, PROTOCOL, PIN, IMAGE, fileSha, sha, sourceTree, verifyTree, verifySourceLock, applyUnifiedPatch,
  nativeEnvironment, nativeArguments, parseNativeEvidence, procIdentity, ancestors, waitDrained } from './focus-core.mjs';
import { failureDiagnostic, browserVersionDiagnostic } from './focus-diagnostics.mjs';
import { pinnedBrowserIdentity } from './focus-browser-identity.mjs';
import { nativeExecutionDiagnostic } from './focus-native-evidence.mjs';
const started = performance.now(), deadline = started + 180000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
let active, stopRequested = false, escalation, phase = 'admission', result = { passed: false, status: 'failed', cleanupPassed: false };
let operation = 'controller-contract';
const admission = { metrics: {} };
const at = value => { operation = value; };
function diagnose(error) {
  // Capture the first failure before teardown; later checks cannot erase its operation.
  if (!result.focusOperation) {
    const failure = failureDiagnostic(error, operation, admission), metrics = { ...result.metrics, ...failure.metrics };
    Object.assign(result, failure, { metrics });
  }
}
const emit = stage => new Promise((resolve, reject) => {
  if (!process.connected) return reject(new Error('controller-ipc-disconnected'));
  process.send({ schema: 'r125-focus-stage-v1', stage }, error => error ? reject(error) : resolve());
});
function signalOwned(signal) {
  if (!active || active.exited || !active.identity) return;
  try {
    const current = procIdentity(fs.readFileSync(`/proc/${active.child.pid}/stat`, 'utf8'));
    ensure(current.start === active.identity.start && current.pgrp === current.pid && current.ppid === process.pid, 'child-ownership-changed');
    process.kill(-current.pid, signal);
  } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') active.failure ??= error; }
}
function requestStop() {
  stopRequested = true; signalOwned('SIGTERM');
  escalation ??= setTimeout(() => signalOwned('SIGKILL'), 2000);
}
process.on('message', message => { if (message?.type === 'stop') requestStop(); });
process.once('disconnect', requestStop); process.once('SIGTERM', requestStop); process.once('SIGINT', requestStop);
async function finishActive() {
  if (!active) return true;
  const pending = active, until = performance.now() + 4500, killAt = performance.now() + 2000;
  signalOwned('SIGTERM'); let killed = false;
  while (active === pending) {
    if (!killed && performance.now() >= killAt) { killed = true; signalOwned('SIGKILL'); }
    if (performance.now() >= until) {
      pending.child.stdout.destroy(); pending.child.stderr.destroy();
      if (pending.child.connected) try { pending.child.disconnect(); } catch {}
      pending.child.unref(); return false;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return true;
}
async function execute(executable, args, { cwd, env, milliseconds, log } = {}) {
  ensure(!stopRequested && performance.now() < deadline, 'controller-stopping');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const state = active = { child, exited: false, identity: null, failure: null }; let chunks = [], bytes = 0, timer, closeTimer, logFd;
    if (log) logFd = fs.openSync(log, 'wx', 0o600);
    const stop = reason => {
      state.failure ??= new Error(reason); signalOwned('SIGTERM');
      clearTimeout(timer); timer = setTimeout(() => signalOwned('SIGKILL'), 2000);
      closeTimer ??= setTimeout(() => { signalOwned('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); reject(state.failure); }, 4100);
    };
    child.once('spawn', () => {
      try { const identity = procIdentity(fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
        ensure(identity.pid === child.pid && identity.ppid === process.pid && identity.pgrp === child.pid, 'spawn-identity'); state.identity = identity;
      } catch (error) { stop(error.code ?? 'spawn-identity'); }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      bytes += data.length;
      if (bytes > 1048576) { stop('native-output-cap'); return; }
      chunks.push(data); if (logFd !== undefined) fs.writeSync(logFd, data);
    });
    child.on('message', () => stop('unexpected-native-ipc'));
    child.once('error', error => { state.failure ??= error; });
    child.once('exit', () => { state.exited = true; });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(closeTimer); if (logFd !== undefined) fs.closeSync(logFd);
      if (active === state) active = undefined;
      const raw = Buffer.concat(chunks).toString('utf8'); chunks = [];
      if (state.failure || stopRequested) reject(state.failure ?? new Error('controller-stopped'));
      else resolve({ code, signal, raw, bytes });
    });
    timer = setTimeout(() => stop('owned-child-deadline'), milliseconds);
  });
}
function readonlyMount(target) {
  const rows = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => line.split(' '));
  return rows.some(fields => fields[4] === target && fields[5].split(',').includes('ro'));
}
let sourceExpected, sourceLockHash;
try {
  ensure(typeof process.send === 'function' && process.channel?.fd === 3, 'controller-ipc-fd');
  at('packet-directory');
  ensure((HERE === '/harness' || HERE.startsWith('/harness/')) && fs.realpathSync(HERE) === HERE, 'packet-directory-outside-harness');
  at('runtime-identity');
  ensure(process.version === 'v24.19.0' && process.arch === 'x64' && process.getuid() !== 0, 'runtime-identity');
  at('runner-pins');
  const pins = JSON.parse(fs.readFileSync('/runner/pins.json', 'utf8'));
  ensure(pins.envelope === PROTOCOL && pins.sourceCommit === PIN && pins.node === process.version
    && pins.playwright === '1.62.1' && pins.chromiumRevision === '1234' && pins.chromium === '151.0.7922.34', 'runner-pins');
  ensure(pins.image === IMAGE && pins.platform === 'linux/amd64', 'immutable-image-admission');
  at('readonly-mounts');
  for (const name of ['/source', '/harness', '/deps', '/runtime/node', '/runner']) ensure(readonlyMount(name), 'readonly-mount');
  at('container-envelope');
  const memory = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), quota = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/).map(Number);
  ensure(memory === '6442450944' && fs.readFileSync('/sys/fs/cgroup/memory.swap.max', 'utf8').trim() === '0'
    && quota[0] === quota[1] * 2 && fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim() === '512', 'hard-container-envelope');
  at('offline-container');
  ensure(fs.readFileSync('/proc/self/cgroup', 'utf8').trim() === '0::/' && JSON.stringify(fs.readdirSync('/sys/class/net').sort()) === '["lo"]', 'private-offline-container');
  at('controller-ancestors');
  const ownAncestors = ancestors(); ensure(ownAncestors[1]?.pid === process.ppid, 'controller-parent');
  at('bundle-manifest');
  ensure(fileSha(path.join(HERE, 'bundle-manifest.json')) === 'f1d3cefe9cf0eaec850f3fd41e4ef6432555f153deaf80e478e7fb88d432b198', 'original-bundle-manifest');
  at('bundle-schema');
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'bundle-manifest.json'), 'utf8'));
  ensure(manifest.protocol === PROTOCOL && manifest.publicPin === PIN, 'packet-protocol'); sourceExpected = manifest.publicSourceTreeDigest;
  at('packet-payload');
  for (const [name, row] of Object.entries(manifest.payload)) ensure(fileSha(path.join(HERE, name)) === row.sha256, 'packet-payload-hash');
  at('portable-manifest');
  const portable = JSON.parse(fs.readFileSync(path.join(HERE, 'portable-manifest.json'), 'utf8'));
  at('portable-runtime');
  for (const [name, record] of Object.entries(portable.runtimeFiles)) ensure(fileSha(path.join(HERE, name)) === record.sha256, 'portable-runtime-hash');
  admission.focusPortableRuntimeAdmitted = true; at('source-tree');
  const before = sourceTree('/source'); admission.metrics.focusSourceFileCount = before.files; verifyTree(before, sourceExpected);
  admission.focusSourceTreeAdmitted = true; at('source-lock');
  const lockBytes = fs.readFileSync('/scratch/source-lock.json'); sourceLockHash = sha(lockBytes); const sourceLock = JSON.parse(lockBytes);
  if (Array.isArray(sourceLock.files)) admission.metrics.focusSourceLockFileCount = sourceLock.files.length;
  verifySourceLock(sourceLock, before); admission.focusSourceLockAdmitted = true;
  at('playwright-package');
  ensure(JSON.parse(fs.readFileSync('/deps/node_modules/playwright/package.json', 'utf8')).version === '1.62.1', 'playwright-package');
  const browser = '/ms-playwright/chromium-1234/chrome-linux64/chrome';
  at('browser-package');
  const browsers = JSON.parse(fs.readFileSync('/deps/node_modules/playwright-core/browsers.json', 'utf8')).browsers;
  ensure(browsers.some(value => value.name === 'chromium' && value.revision === '1234' && value.browserVersion === '151.0.7922.34'), 'browser-package');
  at('browser-version-execute');
  const version = await execute(browser, ['--version'], { env: { ...process.env }, milliseconds: 5000 });
  Object.assign(admission, browserVersionDiagnostic(version.raw, version.code, version.signal)); at('browser-version-admit');
  ensure(pinnedBrowserIdentity({ image: pins.image, executable: browser, playwright: pins.playwright,
    revision: pins.chromiumRevision, version: pins.chromium }, version), 'chromium-executable');
  at('scratch-copy');
  const workspace = fs.mkdtempSync('/scratch/r125-'), candidate = path.join(workspace, 'source');
  fs.cpSync('/source', candidate, { recursive: true, errorOnExist: true, force: false, filter: name => !path.relative('/source', name).split(path.sep).includes('.git') });
  at('candidate-inputs');
  const inputs = new Map();
  for (const name of Object.keys(manifest.candidateApplicationFiles)) if (fs.existsSync(path.join(candidate, name))) inputs.set(name, fs.readFileSync(path.join(candidate, name)));
  at('production-patch');
  const outputs = applyUnifiedPatch(fs.readFileSync(path.join(HERE, 'candidate/production.patch'), 'utf8'), inputs, manifest.candidateApplicationFiles);
  admission.metrics.focusPatchedFileCount = outputs.size;
  ensure(outputs.size === 4, 'four-production-files-only');
  at('production-write');
  for (const [name, bytes] of outputs) { const target = path.join(candidate, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
  at('production-hashes');
  for (const [name, expected] of Object.entries(manifest.candidateApplicationFiles)) ensure(fileSha(path.join(candidate, name)) === expected, 'candidate-production-hash');
  at('r109-install');
  for (const name of manifest.r109InstalledFiles) { const target = path.join(candidate, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(HERE, name), target); }
  const diagnosticFiles = portable.nativeDiagnosticFiles;
  ensure(JSON.stringify(Object.keys(diagnosticFiles ?? {}).sort()) === JSON.stringify([
    'tests/task-focus-native-v4.fixture.mjs', 'tests/task-focus-native-v4.test.mjs', 'tests/task-focus-native.diagnostic.mjs'].sort()), 'packet-payload-hash');
  for (const [name, row] of Object.entries(diagnosticFiles)) {
    ensure(fileSha(path.join(HERE, name)) === row.sha256, 'packet-payload-hash');
    fs.copyFileSync(path.join(HERE, name), path.join(candidate, name));
  }
  at('native-environment');
  const env = nativeEnvironment(process.env, workspace); admission.focusNativeEnvironmentAdmitted = true; await emit('overlay-ready');
  at('native-budget');
  const remaining = Math.min(180000, deadline - performance.now() - 5000);
  ensure(remaining >= 164000, 'insufficient-native-and-drain-reserve');
  phase = 'native'; await emit('episode-start');
  at('native-execution');
  const natural = await execute('/runtime/node', nativeArguments(), { cwd: candidate, env, milliseconds: remaining, log: path.join(workspace, 'native-private.log') });
  at('native-evidence');
  // Preserve the unsuccessful child's closed observations before the strict exit gate.
  const nativeDiagnostic = nativeExecutionDiagnostic(natural.raw, natural.code, natural.signal);
  Object.assign(result, nativeDiagnostic);
  const parsed = parseNativeEvidence(natural.raw, natural.code, natural.signal);
  result = { ...result, ...parsed, metrics: { ...nativeDiagnostic.metrics, ...parsed.metrics } };
  phase = 'drain'; await emit('episode-end'); await emit('cleanup-start');
  at('native-drain'); await waitDrained(ownAncestors, 2000);
  result.cleanupPassed = true; result.code = 'r125-focus-correct';
} catch (error) {
  diagnose(error);
  result.passed = false; result.status = 'failed'; result.cleanupPassed = false; result.code = `r125-${phase}-failed`;
  if (process.connected) try { await emit('error'); } catch {}
} finally {
  if (active) { await finishActive(); result.passed = false; result.status = 'failed'; result.cleanupPassed = false; result.code = 'r125-drain-failed'; }
  clearTimeout(escalation);
  try { if (sourceExpected) { at('source-recheck'); verifyTree(sourceTree('/source'), sourceExpected); result.originalSourceUnchanged = true; }
    if (sourceLockHash) { at('source-lock-recheck'); ensure(fileSha('/scratch/source-lock.json') === sourceLockHash, 'source-lock-changed'); }
  } catch (error) { diagnose(error); result.passed = false; result.status = 'failed'; result.originalSourceUnchanged = false; result.code = 'r125-source-changed'; }
  try {
    if (result.cleanupPassed) await emit('cleanup-end');
    if (process.connected) await new Promise((resolve, reject) => process.send({ schema: 'r125-focus-result-v1', result }, error => error ? reject(error) : resolve()));
  } catch { result.passed = false; }
  clearTimeout(escalation); process.exitCode = result.passed ? 0 : 1;
  if (process.connected) process.disconnect();
}
