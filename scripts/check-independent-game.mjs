import { cp, mkdir, mkdtemp, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixedDenied = ['.git', 'node_modules', '.local', 'resources', 'reference', 'archive', 'archives',
  'local-map', 'local-game', 'docs/research', 'tests', 'app/web/gallery-fixture-data.json',
  'app/web/task-item-artwork.2026-10-09.v1', 'app/legacy-dataset-metadata.mjs', 'app/legacy-game-defaults.mjs', 'app/cli.mjs'];
const deniedPrefixes = ['app/web/gallery'];
const slash = value => value.replaceAll('\\', '/');
const args = process.argv.slice(2);
const datasetArgument = args.indexOf('--dataset');
const datasetId = datasetArgument < 0 ? 'open-starter' : args[datasetArgument + 1];
if (!['open-starter', 'open-f2p'].includes(datasetId)) throw new TypeError('Choose open-starter or open-f2p.');
const selfTestOnly = args.includes('--guard-self-test');
const reportArgument = args.indexOf('--report');
const reportFile = path.resolve(reportArgument < 0 ? path.join(root, '.local', 'independent-game', datasetId === 'open-starter' ? 'latest.json' : `${datasetId}-latest.json`) : args[reportArgument + 1]);

async function heavyLock() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Run through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy lock receipt mismatch.');
  process.kill(Number(pid), 0);
}
async function freePort() {
  for (let port = 8950; port <= 8959; port++) {
    const socket = net.createServer();
    if (await new Promise(resolve => { socket.once('error', () => resolve(false)); socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true))); })) return port;
  }
  throw new Error('No free independent-check port in assigned range.');
}
function run(candidate, script, environment = {}) {
  return new Promise((resolve, reject) => {
    const guard = pathToFileURL(path.join(candidate, 'scripts', 'lib', 'independent-guard.mjs')).href;
    const child = spawn(process.execPath, ['--import', guard, script], { cwd: candidate, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '',
        RS3_DATASET: datasetId, RS3_TASK_WORKER_MODE: 'process', RS3_LOOPBACK_PORT: '',
        RS3_INDEPENDENT_ROOT: candidate, ...environment } });
    let stdout = '', diagnostic = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { diagnostic += bytes; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Independent child exceeded bounded runtime.')); }, 240000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer);
      try { resolve({ code, result: stdout.trim() ? JSON.parse(stdout) : null, diagnosticBytes: Buffer.byteLength(diagnostic) }); }
      catch { reject(new Error(`Independent child returned invalid report (${code}); diagnostic output withheld.`)); }
    });
  });
}
async function guards(candidate) {
  const probe = path.join(candidate, '.scratch', 'negative-probe.mjs');
  await writeFile(probe, `import { readFile, open } from 'node:fs/promises';
import { readFileSync, createReadStream } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fork, spawnSync, execFile, execSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import net from 'node:net';
import tls from 'node:tls';
const target = new URL('../reference/forbidden.json', import.meta.url);
const cases = [];
for (const [name, check] of [['sync-read', () => readFileSync(target)], ['promise-read', () => readFile(target)],
 ['open', () => open(target)], ['stream-read', () => createReadStream(target)], ['import', () => import(target.href)],
 ['outside-read', () => readFile(process.env.RS3_INDEPENDENT_OUTSIDE)], ['network', () => fetch('https://example.invalid/')],
 ['raw-socket', () => net.connect(443, 'example.invalid')], ['tls-socket', () => tls.connect(443, 'example.invalid')],
 ['shell-execution', () => execSync('unapproved-shell-probe')], ['non-node-executable', () => execFile('unapproved-executable-probe')]]) {
  try { await check(); throw new Error('Probe was permitted'); } catch (error) { if (error.code !== 'INDEPENDENT_FORBIDDEN') throw error; cases.push(name); }
}
const worker = new Worker(new URL('./worker-probe.mjs', import.meta.url), { execArgv: [], env: {} });
const [message] = await once(worker, 'message'); if (message !== 'denied') throw new Error('Worker guard absent');
await worker.terminate(); cases.push('thread-propagation');
const child = fork(new URL('./worker-probe.mjs', import.meta.url), [], { execArgv: [], env: {}, stdio: ['ignore','ignore','ignore','ipc'] });
const [childMessage] = await once(child, 'message'); if (childMessage !== 'denied') throw new Error('Process guard absent');
await once(child, 'exit'); cases.push('process-propagation');
const spawned = spawnSync(process.execPath, [fileURLToPath(new URL('./subprocess-probe.mjs', import.meta.url))], { env: {}, encoding: 'utf8' });
if (spawned.status !== 0 || spawned.stdout.trim() !== 'denied') throw new Error('Subprocess guard absent'); cases.push('subprocess-propagation');
if (process.platform === 'win32') {
  const metadata = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-Process -Id " + process.pid + " -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')"], { timeout: 3000, windowsHide: true });
  if (!Number.isFinite(Date.parse(metadata.stdout.trim()))) throw new Error('Metadata probe contract failed');
  cases.push('readonly-process-metadata-permitted');
}
process.stdout.write(JSON.stringify({ passed: true, cases }));\n`);
  await writeFile(path.join(candidate, '.scratch', 'worker-probe.mjs'), `import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
try { readFileSync(new URL('../reference/forbidden.json', import.meta.url)); throw new Error('Guard absent'); }
catch(error) { if(error.code !== 'INDEPENDENT_FORBIDDEN') throw error; if(parentPort) parentPort.postMessage('denied'); else process.send('denied', () => process.disconnect()); }\n`);
  await writeFile(path.join(candidate, '.scratch', 'subprocess-probe.mjs'), `import { readFileSync } from 'node:fs';
try { readFileSync(new URL('../reference/forbidden.json', import.meta.url)); throw new Error('Guard absent'); }
catch(error) { if(error.code !== 'INDEPENDENT_FORBIDDEN') throw error; process.stdout.write('denied'); }\n`);
  const result = await run(candidate, probe, { RS3_INDEPENDENT_OUTSIDE: path.join(root, 'package.json'), RS3_INDEPENDENT_ORIGIN: 'http://127.0.0.1:8950' });
  if (result.code !== 0 || !result.result?.passed) throw new Error(`Guard negative probes failed; diagnostic bytes ${result.diagnosticBytes}.`);
  const audit = (await readFile(path.join(candidate, '.scratch', 'audit.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  if (audit.filter(row => row.kind === 'denied').length !== 14) throw new Error('Guard negative probe denial evidence mismatch.');
  await writeFile(path.join(candidate, '.scratch', 'audit.ndjson'), '');
  return result.result;
}
export async function createIndependentCandidate(candidate) {
  candidate = path.resolve(candidate);
  if (!candidate.startsWith(path.resolve(root, '.local') + path.sep)) throw new Error('Candidate must be under this worktree local directory.');
    // Read path declarations only. Never import/evaluate the legacy catalogue or read its values.
    const declarations = await readFile(path.join(root, 'app', 'dataset-inputs.mjs'), 'utf8');
    const inputBlock = declarations.match(/export const DATASET_INPUTS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1];
    if (!inputBlock) throw new Error('Dataset path inventory was not found.');
    const declaredPaths = [...inputBlock.matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]);
    const galleryPaths = (await readdir(path.join(root, 'app', 'web'))).filter(name => name.startsWith('gallery'))
      .map(name => `app/web/${name}`);
    const deniedPaths = [...new Set([...fixedDenied, ...declaredPaths, ...galleryPaths])].sort();
    const removedPaths = new Set(deniedPaths);
    const forbidden = relative => deniedPaths.some(name => relative === name || relative.startsWith(name + '/'))
      || deniedPrefixes.some(prefix => relative.startsWith(prefix))
      || /^app\/data\/.*\.json(?:\.gz)?$/.test(relative);
    await mkdir(candidate);
    await cp(path.join(root, 'app'), path.join(candidate, 'app'), { recursive: true, dereference: false, filter: async source => {
      const relative = slash(path.relative(root, source));
      if (forbidden(relative)) { removedPaths.add(relative); return false; }
      if ((await lstat(source)).isSymbolicLink()) throw new Error('Runtime tree has a symbolic link.');
      return true;
    } });
    await cp(path.join(root, 'package.json'), path.join(candidate, 'package.json'));
    await mkdir(path.join(candidate, 'scripts', 'lib'), { recursive: true });
    for (const name of ['independent-guard.mjs', 'independent-profile.mjs', 'provenance-hash.mjs']) await cp(path.join(root, 'scripts', 'lib', name), path.join(candidate, 'scripts', 'lib', name));
    for (const name of ['.git', 'node_modules', '.local']) {
      try { await lstat(path.join(candidate, name)); throw new Error('Forbidden initial directory exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    async function inspect(directory, relative = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (forbidden(name) || entry.isSymbolicLink()) throw new Error('Forbidden path survived physical copy.');
        if (entry.isDirectory()) await inspect(path.join(directory, entry.name), name);
      }
    }
    await inspect(candidate);
    await mkdir(path.join(candidate, '.scratch'));
    await writeFile(path.join(candidate, '.scratch', 'policy.json'), JSON.stringify({ deniedPaths, deniedPrefixes }));
    await writeFile(path.join(candidate, '.scratch', 'audit.ndjson'), '');
    return { removedPaths: [...removedPaths].sort(), initiallyAbsent: ['.git', 'node_modules', '.local'] };
}
export async function cleanupIndependentCandidate(candidate) {
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(path.resolve(root, '.local') + path.sep) || path.basename(resolved) !== 'candidate') throw new Error('Candidate cleanup containment failed.');
  await rm(resolved, { recursive: true, force: true });
}
export { run as runIndependentCandidate, freePort as independentFreePort };

let phase = 'initialization';
async function main() {
  if (!selfTestOnly) await heavyLock();
  const outputBase = path.join(root, '.local', 'independent-game');
  await mkdir(outputBase, { recursive: true });
  const scratch = await mkdtemp(path.join(outputBase, 'run-'));
  const candidate = path.join(scratch, 'candidate');
  let report = { passed: false, purpose: 'Private disposable execution copy; no publication, export, allowlist, or leak-gate claim.', dataset: datasetId };
  try {
    phase = 'physical-copy';
    Object.assign(report, await createIndependentCandidate(candidate));
    phase = 'guard-negative-probes'; report.guardNegativeProbes = await guards(candidate);
    if (!selfTestOnly) {
      phase = 'shared-server-http-workflow';
      const port = await freePort();
      const result = await run(candidate, path.join(candidate, 'scripts', 'lib', 'independent-profile.mjs'), {
        RS3_INDEPENDENT_PORT: String(port), RS3_INDEPENDENT_ORIGIN: `http://127.0.0.1:${port}`,
        RS3_PACKS_DIR: path.join(candidate, '.scratch', 'packs'), RS3_PACK_SELECTION: path.join(candidate, '.scratch', 'packs', 'absent.json'),
        RS3_MAP_ASSETS_DIR: path.join(candidate, '.scratch', 'no-art'), RS3_GAME_DATA_DIR: path.join(candidate, '.scratch', 'no-game-data'),
      });
      report.profile = result.result; report.childExitCode = result.code; report.diagnosticBytes = result.diagnosticBytes;
      const audit = (await readFile(path.join(candidate, '.scratch', 'audit.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      report.guard = { installed: audit.filter(row => row.kind === 'guard-installed'), denied: audit.filter(row => row.kind === 'denied'),
        moduleFailures: audit.filter(row => row.kind === 'module-resolution-failed'),
        systemMetadataProbes: audit.filter(row => row.kind === 'system-metadata-probe'),
        workerStarts: audit.filter(row => row.kind === 'worker-created'), workerMessageTypes: [...new Set(audit.filter(row => row.kind === 'worker-message').map(row => row.type))].sort() };
      report.passed = result.code === 0 && result.result?.passed === true && report.guard.denied.length === 0;
    } else report.passed = true;
  } catch (error) { report.failureStage = phase; report.failure = error.message; }
  finally {
    const resolved = path.resolve(scratch), parent = path.resolve(outputBase);
    if (!resolved.startsWith(parent + path.sep) || path.dirname(resolved) !== parent) throw new Error('Scratch cleanup containment failed.');
    await rm(resolved, { recursive: true, force: true }); report.disposableCopyDeleted = true;
  }
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
