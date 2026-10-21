// Rehearse the PC release layout with public CI packs and generated saves only.
// node scripts/ci/release-rehearsal.mjs --packs-dir ABS --summary ABS
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { treeEntries, verifyExport } from '../release/pc/quick-build.mjs';
import { sanitizeExecutionEnvironment, digestValue } from '../private-companion/release-identity.mjs';
import { safeArtFile, packRelative, PACK_VERSION } from '../../app/packs.mjs';
import { readPin } from '../../.github/packs/fetch-packs.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const runtime = fileURLToPath(new URL('./release-rehearsal-runtime.mjs', import.meta.url));
const kinds = { data: 'duo-data', rulesText: 'duo-rules-text', art: 'duo-art' };
const syntheticOrigin = 'https://synthetic-rehearsal.invalid';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const encode = value => JSON.stringify(value, null, 2) + '\n';
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : 'tar';
const git = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args],
  { env: sanitizeExecutionEnvironment(), windowsHide: true, maxBuffer: 64 * 1024 ** 2 });
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

export async function exportHead({ repo, core }) {
  const commit = git(repo, 'rev-parse', '--verify', 'HEAD^{commit}').toString().trim();
  const entries = treeEntries(repo, commit), archive = core + '.tar';
  await mkdir(core); // Refuse reuse of an earlier export.
  try {
    git(repo, 'archive', '--format=tar', '-o', archive, commit);
    execFileSync(tar, ['-xf', archive, '-C', core], { windowsHide: true, stdio: 'pipe' });
  } finally { await rm(archive, { force: true }); }
  await verifyExport(core, entries);
  return { commit, entries };
}

async function verifyPack(root, choice) {
  await safeArtFile(root);
  const regularFiles = new Map();
  // CI cache and destination are immutable during assembly. Walk their trees
  // once instead of rechecking every ancestor for each of 15,000+ payloads.
  // The independent install gate still uses its original safeArtFile checks.
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name, file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Pack tree contains a link.');
      if (entry.isDirectory()) await walk(file, relative + '/');
      else if (entry.isFile()) regularFiles.set(relative, file);
      else throw Error('Pack tree contains a nonregular file.');
    }
  }
  await walk(root);
  if (!regularFiles.has('pack.json')) throw Error('Pack manifest missing.');
  const bytes = await readFile(regularFiles.get('pack.json'));
  if (sha(bytes) !== choice.sha256) throw Error('Pack manifest differs.');
  const manifest = JSON.parse(bytes);
  if (manifest.id !== choice.id || manifest.version !== choice.version || !Array.isArray(manifest.files)) throw Error('Pack manifest invalid.');
  let files = 0;
  for (const record of manifest.files) {
    packRelative(record.path);
    const file = regularFiles.get(record.path);
    if (!file) throw Error('Pack payload missing.');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) throw Error('Pack payload size differs.');
    const hash = createHash('sha256');
    if (info.size <= 8 * 1024 ** 2) hash.update(await readFile(file));
    else for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== record.sha256) throw Error('Pack payload differs.');
    files++;
  }
  return files;
}

// Copies the installed selection layout, never the checkout's placed pack files.
export async function copyPacks({ source, destination, expectedSelection }) {
  const selectionBytes = await readFile(await safeArtFile(source, 'selection.json'));
  const selection = JSON.parse(selectionBytes);
  if (selection.schemaVersion !== 1 || digestValue(selection) !== digestValue({ schemaVersion: 1, ...expectedSelection })) throw Error('CI pack selection differs from its pin.');
  for (const [kind, id] of Object.entries(kinds)) {
    const choice = selection[kind];
    if (choice?.id !== id || !PACK_VERSION.test(choice.version ?? '') || !/^[a-f0-9]{64}$/.test(choice.sha256 ?? '')) throw Error('All three CI packs are required.');
    await verifyPack(path.join(source, id, choice.version), choice);
  }
  await mkdir(destination);
  let files = 0;
  for (const [kind, id] of Object.entries(kinds)) {
    const choice = selection[kind], target = path.join(destination, id, choice.version);
    await cp(path.join(source, id, choice.version), target, { recursive: true, force: false, errorOnExist: true });
    files += await verifyPack(target, choice);
  }
  await writeFile(path.join(destination, 'selection.json'), selectionBytes, { flag: 'wx' });
  return { selection, files };
}

export async function writeReleaseMetadata({ releaseDir, selection, port, loopbackPort }) {
  if (![port, loopbackPort].every(p => Number.isInteger(p) && p >= 8900 && p <= 8999) || port === loopbackPort) throw Error('Two distinct scratch ports required.');
  const pin = async file => ({ path: file, sha256: sha(await readFile(file)) });
  const packsDir = path.join(releaseDir, 'packs'), local = path.join(releaseDir, 'runtime');
  await mkdir(local);
  const config = { schemaVersion: 1, coreRoot: path.join(releaseDir, 'core'), dataDir: path.join(local, 'data'),
    nodePath: process.execPath, host: '127.0.0.1', port, loopbackPort, publicOriginFile: path.join(local, 'public-origin'), packsDir,
    selection: await pin(path.join(packsDir, 'selection.json')),
    packs: Object.fromEntries(await Promise.all(Object.keys(kinds).map(async kind => [kind,
      await pin(path.join(packsDir, selection[kind].id, selection[kind].version, 'pack.json'))]))),
    profile: await pin(path.join(releaseDir, 'profile.json')), addons: await pin(path.join(releaseDir, 'addons/addon.json')),
    runtimeOptions: { taskWorkerMode: 'process', workerIdleMs: 20000, backupDays: 7, historyEntries: 500 } };
  await writeFile(config.publicOriginFile, syntheticOrigin + '\n', { flag: 'wx' });
  const configPath = path.join(releaseDir, 'config.json');
  await writeFile(configPath, encode(config), { flag: 'wx' });
  await writeFile(path.join(releaseDir, 'pointer.json'), encode({ schemaVersion: 2, releaseId: 'ci-rehearsal', config: await pin(configPath) }), { flag: 'wx' });
  // verify-install consumes this older receipt shape, also used by copied-startup.
  await writeFile(path.join(releaseDir, 'companion.json'), encode({ schemaVersion: 1, coreRoot: config.coreRoot,
    packsDir, packs: selection, profile: config.profile, addons: config.addons }), { flag: 'wx' });
  return config;
}

export function releaseEnvironment(config) {
  return sanitizeExecutionEnvironment(process.env, { overrides: {
    RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir, RS3_PACK_SELECTION: config.selection.path,
    RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256,
    RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256,
    RS3_TASK_WORKER_MODE: config.runtimeOptions.taskWorkerMode, RS3_WORKER_IDLE_MS: String(config.runtimeOptions.workerIdleMs),
    RS3_GAME_DATA_DIR: path.join(path.dirname(config.dataDir), 'game-data'),
    RS3_MAP_ASSETS_DIR: path.join(path.dirname(config.dataDir), 'map-assets'),
    RS3_PUBLIC_ORIGIN: syntheticOrigin, RS3_LOOPBACK_PORT: String(config.loopbackPort),
  } });
}

const processes = new Set();
function launch(args, { env, cwd, timeout = 180000 } = {}) {
  const child = spawn(process.execPath, ['--max-old-space-size=1024', ...args], {
    cwd, env: env ?? sanitizeExecutionEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  processes.add(child);
  let output = '', overflow = false;
  child.stdout.on('data', bytes => { if (output.length + bytes.length > 1024 ** 2) overflow = true; else output += bytes.toString(); });
  child.stderr.resume(); // Candidate diagnostics can contain credentials; never relay them.
  const timer = setTimeout(() => { child.timedOut = true; void terminate(child); }, timeout);
  child.done = new Promise(resolve => {
    child.once('error', () => { child.launchFailed = true; });
    child.once('close', code => { clearTimeout(timer); processes.delete(child); resolve({ code, output, overflow }); });
  });
  return child;
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    try { execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    catch { if (child.exitCode === null && child.signalCode === null) child.kill(); }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

async function command(args, options) {
  const child = launch(args, options), result = await child.done;
  if (child.launchFailed || child.timedOut || result.code !== 0 || result.overflow) throw Error('Candidate command failed.');
  return result.output;
}

async function freePort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function scratchPorts() {
  const ports = [];
  for (let port = 8900; port <= 8999 && ports.length < 2; port++) if (await freePort(port)) ports.push(port);
  if (ports.length !== 2) throw Error('No scratch ports available.');
  return ports;
}

async function request(config, route, { authenticated = true, method = 'GET', port = config.port } = {}) {
  const origin = `http://127.0.0.1:${port}`, headers = {};
  if (authenticated) headers.Authorization = 'Bearer ' + (await readFile(path.join(config.dataDir, 'access-token'), 'utf8')).trim();
  if (method === 'POST') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json' });
  return fetch(origin + route, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(5000) });
}

async function readiness(config, child) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (child.launchFailed || child.exitCode !== null || child.signalCode !== null) throw Error('Release exited before readiness.');
    try {
      const response = await request(config, '/api/health');
      const health = await response.json();
      if (response.ok && health.ready === true) {
        const denied = await request(config, '/api/health', { authenticated: false });
        await denied.arrayBuffer();
        if (![401, 403].includes(denied.status)) throw Error('Readiness must require authentication.');
        const loopback = await request(config, '/api/health', { port: config.loopbackPort });
        const loopbackHealth = await loopback.json();
        if (!loopback.ok || loopbackHealth.ready !== true) throw Error('Loopback readiness refused.');
        return;
      }
    } catch { /* The early listener and worker can still be starting. */ }
    await pause();
  }
  throw Error('Authenticated release readiness timed out.');
}

async function cleanStop(config, child) {
  const response = await request(config, '/api/shutdown', { method: 'POST' });
  await response.arrayBuffer();
  if (response.status !== 202) throw Error('Graceful release stop refused.');
  let timer;
  try {
    const result = await Promise.race([child.done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Release did not stop.')), 20000); })]);
    if (result.code !== 0 || child.timedOut) throw Error('Release stop failed.');
  } finally { clearTimeout(timer); }
  for (const name of ['store.lock', 'store.lock.recovery']) {
    try { await lstat(path.join(config.dataDir, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('Release retained a storage lock.');
  }
  if (!await freePort(config.port) || !await freePort(config.loopbackPort)) throw Error('Release retained a listener.');
}

export async function rehearse({ repo = checkout, packsDir, summary }) {
  const started = performance.now();
  const result = { schema: 'rs3-release-rehearsal-v1', passed: false, synthetic: true, node: process.version,
    platform: process.platform, commit: null, steps: {}, seconds: {} };
  // GitHub's Windows temp dir is an 8.3 short path (RUNNER~1); the pack checks
  // require every path to equal its realpath, so canonicalize the root once.
  let work, tmpRoot, stage = 'setup';
  const step = async (name, action) => {
    stage = name; const began = performance.now();
    try { const value = await action(); result.steps[name] = { passed: true }; return value; }
    catch (error) { result.steps[name] = { passed: false }; throw error; }
    finally { result.seconds[name] = Math.round((performance.now() - began) / 10) / 100; }
  };
  try {
    if (process.version !== 'v24.20.0') throw Error('Release Node version required.');
    tmpRoot = await realpath(os.tmpdir());
    work = await mkdtemp(path.join(tmpRoot, 'rs3-ci-rehearsal-'));
    const releaseDir = path.join(work, 'release'), core = path.join(releaseDir, 'core');
    await mkdir(releaseDir);
    const exported = await step('export', () => exportHead({ repo, core }));
    result.commit = exported.commit;
    const copied = await step('packs', async () => {
      const pin = readPin(core);
      if (!pin) throw Error('Pinned CI packs required.');
      return copyPacks({ source: packsDir, destination: path.join(releaseDir, 'packs'), expectedSelection: pin.selection });
    });
    result.packFiles = copied.files;
    await step('profile-addon', () => command([runtime, 'build', releaseDir], { cwd: work }));
    const config = await step('config', async () => {
      const [port, loopbackPort] = await scratchPorts();
      return writeReleaseMetadata({ releaseDir, selection: copied.selection, port, loopbackPort });
    });
    const env = releaseEnvironment(config), receipt = path.join(releaseDir, 'companion.json'), configFile = path.join(releaseDir, 'config.json');
    const run = args => command(args, { env, cwd: work });
    await step('verify-data', async () => {
      const verified = JSON.parse(await run([path.join(core, 'scripts/private-companion/verify-install.mjs'), '--core', core, '--companion', releaseDir, '--receipt', receipt]));
      if (verified.passed !== true) throw Error('Pack installation refused.');
    });
    await step('copied-startup', async () => {
      const copiedStartup = JSON.parse(await run([path.join(core, 'scripts/private-companion/release-early.mjs'), 'startup', '--core', core, '--receipt', receipt, '--scratch', path.join(work, 'copied-startup')]));
      if (copiedStartup.passed !== true || copiedStartup.cleanupVerified !== true) throw Error('Copied synthetic startup refused.');
    });
    await step('synthetic-save', () => run([runtime, 'seed', configFile]));
    const probeData = path.join(work, 'probe-save'), probeOutput = path.join(work, 'probe.json');
    await step('startup-probe', async () => {
      await cp(config.dataDir, probeData, { recursive: true, force: false, errorOnExist: true });
      await cp(config.dataDir + '.dataset.json', probeData + '.dataset.json', { force: false, errorOnExist: true });
      await run([path.join(core, 'scripts/private-companion/release-pack-check.mjs'), 'probe', core, probeData, probeOutput]);
      const probe = await json(probeOutput);
      if (probe.tasksServed !== true || !Array.isArray(probe.taskIds) || probe.migrationSummary?.lostRecords !== 0) throw Error('Packed synthetic probe refused.');
      result.probe = { tasks: probe.taskIds.length, lostRecords: probe.migrationSummary.lostRecords };
    });
    const child = launch(['--expose-gc', path.join(core, 'app/server.mjs'), '--host', config.host, '--port', String(config.port),
      '--loopback-port', String(config.loopbackPort), '--data-dir', config.dataDir,
      '--backup-days', String(config.runtimeOptions.backupDays), '--history-entries', String(config.runtimeOptions.historyEntries)], { env, cwd: core });
    try {
      await step('start', () => readiness(config, child));
      await step('stop', () => cleanStop(config, child));
    } finally { await terminate(child); await child.done; }
    await step('verify-export', () => verifyExport(core, exported.entries));
    result.passed = true;
  } catch { result.failure = { step: stage, reason: 'Release rehearsal refused; candidate diagnostics withheld.' }; }
  finally {
    const began = performance.now();
    try {
      for (const child of [...processes]) { await terminate(child); await child.done; }
      if (work) {
        if (path.dirname(path.resolve(work)) !== tmpRoot ||!path.basename(work).startsWith('rs3-ci-rehearsal-')) throw Error('Scratch cleanup boundary differs.');
        await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
      result.steps.cleanup = { passed: true };
    } catch { result.passed = false; result.steps.cleanup = { passed: false }; result.failure = { step: 'cleanup', reason: 'Disposable rehearsal cleanup failed.' }; }
    result.seconds.cleanup = Math.round((performance.now() - began) / 10) / 100;
    result.seconds.total = Math.round((performance.now() - started) / 10) / 100;
  }
  if (summary) {
    await mkdir(path.dirname(path.resolve(summary)), { recursive: true });
    await writeFile(summary, encode(result));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { repo: { type: 'string', default: checkout }, 'packs-dir': { type: 'string' }, summary: { type: 'string' } } });
    if (!values['packs-dir'] || !values.summary) throw Error('Use --packs-dir and --summary.');
    const result = await rehearse({ repo: path.resolve(values.repo), packsDir: path.resolve(values['packs-dir']), summary: path.resolve(values.summary) });
    console.log(encode(result).trimEnd());
    process.exitCode = result.passed ? 0 : 1;
  } catch { console.error('Release rehearsal requires --packs-dir and --summary with writable disposable output.'); process.exitCode = 1; }
}
