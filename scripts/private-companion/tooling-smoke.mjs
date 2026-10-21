// Executable capability observations. These bounded inputs never authorize a
// candidate release, replace payload lanes, or open the selected live save.
import path from 'node:path';
import { freemem } from 'node:os';
import { mkdir, cp, readFile, writeFile, lstat, realpath, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashTree, digestValue, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { readPracticeLive, practiceLiveIdentity, practiceToolingDigest } from './release-practice.mjs';
import { runOwnedCommand } from './owned-child-processes.mjs';
import { createLivePayloadContext, reopenLivePayloadContext, livePayloadToolingPath } from './live-payload-rules.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const inside = (root, file) => { const r = path.relative(path.resolve(root), path.resolve(file)); return !r || !path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep); };
export const toolingSmokeScope = 'bounded-executable-tooling-on-owned-immutable-payload-copy';
export const toolingSmokeChecks = Object.freeze(['live-payload-drift-with-branch-tooling', 'preflight-and-exact-core-scanner', 'companion-addon-profile-build', 'scratch-install-verification', 'native-adaptive-and-isolated-retry', 'scratch-gallery-plain-and-framed']);

// A fixed owned worker transports the existing library-only capability across
// a process boundary. Ordinary candidate CLIs gain no grandfathering option.
export const livePayloadSmokeWorkerSource = `import {readFile} from 'node:fs/promises';
import {checkLivePayloadDrift} from './check-private-drift.mjs';
import {releasePreflight} from './release-preflight.mjs';
import {reopenLivePayloadContext} from './live-payload-rules.mjs';
import {practiceInventoryCapability} from './practice-inventory.mjs';
const e=JSON.parse(await readFile(process.argv[2],'utf8'));
const livePayload=await reopenLivePayloadContext(e.proof);
let result;
if(e.action==='drift')result=await checkLivePayloadDrift({...e.options,proof:e.proof});
else if(e.action==='preflight'){
 const practiceInventory=await practiceInventoryCapability({...e.toolingInputs,livePayload:e.proof});
 result=await releasePreflight(e.options,{livePayload,practiceInventory,progress:message=>console.error(message)});
}else throw Error('Unknown bounded smoke action.');
process.stdout.write(JSON.stringify(result)+'\\n');
if(result.passed!==true)process.exitCode=1;
`;

export function assertScratchGalleryPorts(gallery) {
  for(const mode of ['plain','framed']) {
    const row=gallery?.[mode], ports=[row?.applicationPort,row?.cdpPort];
    if(!ports.every(port=>Number.isInteger(port)&&port>=8900&&port<=8999)||ports[0]===ports[1]) throw Error('Gallery listener proof differs from bounded scratch ports.');
  }
  return gallery;
}

// The deadline lives inside the admitted Node process. Killing the outer
// PowerShell on a timeout could strand its browser descendants and reservation.
// Admission wait itself is allowed to wait for the cooperating lane holder.
export const gallerySupervisorSource = `import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
const {stopChild}=await import(pathToFileURL(c.stopModule));
const children=new Set(), originals={spawn:cp.spawn,fork:cp.fork};
for(const method of Object.keys(originals))cp[method]=function(...args){const child=originals[method].apply(this,args);children.add(child);return child;};
syncBuiltinESMExports();
let ending=false;
async function finish(deadlineExceeded){
 if(ending)return;ending=true;clearTimeout(timer);
 const stopped=await Promise.allSettled([...children].map(child=>stopChild(child)));
 const cleanupVerified=stopped.every(row=>row.status==='fulfilled');
 const passed=!deadlineExceeded&&cleanupVerified&&!(process.exitCode);
 await writeFile(c.cleanup,JSON.stringify({passed,cleanupVerified,deadlineExceeded,ownedChildren:children.size})+'\\n',{flag:'wx',mode:0o600});
 process.exit(passed?0:1);
}
const timer=setTimeout(()=>void finish(true),c.timeoutMs);
process.argv=[process.execPath,c.gallery,...c.args];
try{await import(pathToFileURL(c.gallery));}catch{process.exitCode=1;}
await finish(false);
`;

async function ordinary(file, absent = false) {
  if (!path.isAbsolute(file ?? '')) throw Error('Tooling smoke requires absolute paths.');
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1 || current !== path.resolve(file) && !s.isDirectory()
        || path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('Tooling smoke refuses linked or noncanonical inputs.');
    } catch (e) { if (!absent || e.code !== 'ENOENT') throw e; }
    if (current === path.dirname(current)) break;
  }
}
async function absent(file) { try { await lstat(file); throw Error('Tooling smoke output must be absent.'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function copy(source, target) {
  const before = await hashTree(source);
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  if ((await hashTree(target)).digest !== before.digest || (await hashTree(source)).digest !== before.digest) throw Error('Tooling smoke immutable copy differs.');
  return before.digest;
}
async function pin(file) { await ordinary(file); return { path: file, sha256: sha(await readFile(file)) }; }

/** Keep live app, data and ordinary tests byte-exact. The generic rules own
 * the only allowed branch substitutions, and reopen verifies their lineage. */
export async function prepareToolingSmokeSource({ kit, repo, liveSource, liveCore, liveRevision, source, liveIdentity = null }) {
  for (const file of [kit, repo, liveSource, liveCore, source]) await ordinary(file, file === source);
  for (const root of [kit, liveSource, liveCore]) if (inside(root, source) || inside(source, root)) throw Error('Tooling smoke source overlaps immutable inputs.');
  if (inside(source, repo) || inside(path.join(repo, '.git'), source)) throw Error('Tooling smoke source overlaps repository metadata.');
  await absent(source);
  const branch = path.join(kit, 'checks/private-source'), baseline = await hashTree(liveSource), tooling = await hashTree(branch);
  await copy(liveSource, source);
  for (const row of baseline.files) if (livePayloadToolingPath(row.path)) await rm(path.join(source, row.path));
  for (const row of tooling.files) if (livePayloadToolingPath(row.path)) {
    const target = path.join(source, row.path);
    if (!inside(source, target)) throw Error('Tooling smoke source substitution escaped scratch.');
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(branch, row.path), target, { force: false, errorOnExist: true });
  }
  const toolingInputs = { schema: 'rs3-practice-inputs-v1', kit, coreRepo: repo, kitSha256: (await pin(path.join(kit, 'kit.json'))).sha256 };
  const proof = await createLivePayloadContext({ liveSource, liveCore, liveRevision, source, toolingInputs, liveIdentity });
  await reopenLivePayloadContext(proof, { source, core: liveCore, revision: liveRevision });
  return { source, proof, toolingInputs };
}
async function assertHeavyOwner() {
  const { RS3_HEAVY_LOCK_PATH: root, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!path.isAbsolute(root ?? '') || !token || !/^\d+$/.test(pid ?? '')) throw Error('Tooling smoke requires the shared heavy admission wrapper.');
  const owner = await json(path.join(root, 'owner.json'));
  if (owner.token !== token || String(owner.pid) !== pid) throw Error('Tooling smoke heavy admission differs.');
  process.kill(Number(pid), 0);
}

export function assertToolingSmokeResult(result, inputDigest) {
  if (result?.schema !== 'rs3-tooling-smoke-v1' || result.passed !== true || result.cleanupVerified !== true || result.scope !== toolingSmokeScope
    || !hex(result.inputDigest) || inputDigest !== undefined && result.inputDigest !== inputDigest
    || !Array.isArray(result.checks) || result.checks.length !== toolingSmokeChecks.length
    || result.checks.some((row, i) => row.name !== toolingSmokeChecks[i] || row.passed !== true || !hex(row.evidenceDigest))) throw Error('Tooling smoke proof is incomplete.');
  return result;
}

/** Real native FileTest subprocesses, with one intentionally failing first
 * attempt. No fake runFile, memory sampler or synthetic native summaries. */
export async function runNativeRunnerSmoke({ output, runner, retry }) {
  for (const file of [output, runner, retry]) await ordinary(file, file === output);
  await absent(output); await mkdir(output, { recursive: true });
  const pass = path.join(output, 'pass.test.mjs'), flaky = path.join(output, 'retry.test.mjs');
  await writeFile(pass, "import test from 'node:test';import assert from 'node:assert/strict';test('bounded pass',()=>assert.equal(2+2,4));\n", { flag: 'wx' });
  await writeFile(flaky, "import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,writeFileSync} from 'node:fs';const marker=new URL('./attempt',import.meta.url);test('one observed recovery',()=>{const seen=existsSync(marker);if(!seen)writeFileSync(marker,'attempt',{flag:'wx'});assert.equal(seen,true);});\n", { flag: 'wx' });
  const { runAdaptive, GiB } = await import(pathToFileURL(runner)), { retryFailedFilesOnce } = await import(pathToFileURL(retry));
  const admission = [];
  const selection = async files => {
    const began = performance.now(), observation = { files, samples: 0, minimumFreeBytes: null, firstAdmissionAfterMs: null };
    admission.push(observation);
    const result = await runAdaptive({ files, cwd: output, env: sanitizeExecutionEnvironment(), minConcurrency: 1, maxConcurrency: 1,
      signal: AbortSignal.timeout(120000), onSchedule: async sample => {
        observation.samples++;
        observation.minimumFreeBytes = Math.min(observation.minimumFreeBytes ?? sample.freeBytes, sample.freeBytes);
        // The native scheduler retains its real 4 GiB floor and 1 GiB worker
        // reserve. Record the observed wait rather than forging free memory.
        if (observation.firstAdmissionAfterMs === null && sample.freeBytes >= 5 * GiB) observation.firstAdmissionAfterMs = performance.now() - began;
      } });
    if (result.aborted && result.files.length < files.length) throw Error('Native tooling smoke resource admission did not complete within 120 seconds.');
    return result;
  };
  try {
    const initial = await selection([pass, flaky]);
    if (initial.passed !== false || initial.files.length !== 2 || initial.maxActive !== 1 || initial.files.filter(f => f.passed).length !== 1) throw Error('Native smoke did not observe its expected failure.');
    const retried = [];
    const result = await retryFailedFilesOnce({ result: initial, enabled: true, runIsolated: async (files, options) => {
      if (files.length !== 1 || files[0] !== flaky || options.minConcurrency !== 1 || options.maxConcurrency !== 1) throw Error('Native smoke retry selection differs.');
      retried.push(...files); return selection(files);
    } });
    if (result.passed !== true || result.exitCode !== 0 || result.aborted || result.files.length !== 2 || result.files.some(f => !f.passed)
      || retried.length !== 1 || result.flakyFiles?.length !== 1 || result.flakyFiles[0] !== flaky || result.files.find(f => f.file === flaky).attempts?.length !== 2) throw Error('Native retry smoke did not recover exactly once.');
    return { passed: true, fixture: 'two-tiny-node-test-files-one-intentional-first-attempt-failure', admission, initial, result, retried };
  } finally {
    // runAdaptive drains native controllers before returning, including abort.
    if (path.dirname(output) === output || !(await lstat(output)).isDirectory() || (await lstat(output)).isSymbolicLink()) throw Error('Native smoke cleanup containment differs.');
    await rm(output, { recursive: true });
    await absent(output);
  }
}

/** Production calls use actual executable children. exec is an in-process test
 * seam only; there is no CLI flag to substitute observations or skip a phase. */
export async function runToolingSmoke({ kit, repo, current, output, evidenceDir, toolingDigest }, dependencies = {}) {
  for (const file of [kit, repo, current, output, evidenceDir]) await ordinary(file, file === output || file === evidenceDir);
  if (!hex(toolingDigest)) throw Error('Tooling smoke requires an exact tooling digest.');
  const live = await readPracticeLive(current), liveBefore = await practiceLiveIdentity(live);
  const protectedRoots = [kit, path.resolve(live.release, '../..'), live.config.coreRoot, live.config.packsDir, path.dirname(live.config.addons.path),
    live.config.dataDir, path.resolve(live.config.dataDir) + '.dataset.json', live.configFile, current, live.config.publicOriginFile].filter(Boolean);
  for (const target of [output, evidenceDir]) for (const root of protectedRoots) if (inside(root, target) || inside(target, root)) throw Error('Tooling smoke output overlaps protected inputs.');
  // A repo's ignored local audit directory is an allowed scratch destination.
  // Never let a scratch root contain or replace the repository itself.
  if ([output, evidenceDir].some(target => inside(target, repo) || inside(path.join(repo, '.git'), target))) throw Error('Tooling smoke output overlaps repository metadata.');
  if (inside(output, evidenceDir) || inside(evidenceDir, output)) throw Error('Tooling smoke scratch and evidence must be separate.');
  await absent(output); await assertHeavyOwner();
  if (await practiceToolingDigest(kit) !== toolingDigest) throw Error('Tooling smoke tooling identity differs.');
  await mkdir(output, { recursive: true }); await mkdir(evidenceDir, { recursive: true });
  const scratch = path.join(output, 'scratch-kit'); await mkdir(scratch);
  for (const name of ['tools', 'operator', 'release-gate/corpus']) await copy(path.join(kit, name), path.join(scratch, name));
  const core = path.join(scratch, 'core'), packs = path.join(scratch, 'packs');
  await copy(live.config.coreRoot, core); await copy(live.config.packsDir, packs);
  const baselineSource = path.join(output, 'baseline-private-source');
  await copy(path.join(path.resolve(live.release, '../..'), 'checks/private-source'), baselineSource);
  const retained = await json(path.join(live.release, 'companion.json')), originalFiles = (await hashTree(baselineSource)).files.map(row => ({ path: row.path, sha256: row.sha256 })).sort((a,b) => a.path.localeCompare(b.path));
  if (!Array.isArray(retained.privateFiles) || digestValue([...retained.privateFiles].sort((a,b) => a.path.localeCompare(b.path))) !== digestValue(originalFiles)) throw Error('Tooling smoke retained live private source differs from its pinned receipt.');
  const source = path.join(scratch, 'checks/private-source'), selection = await json(path.join(packs, 'selection.json'));
  const liveInputs = await prepareToolingSmokeSource({ kit, repo, liveSource: baselineSource, liveCore: core, liveRevision: live.manifest.revision, source, liveIdentity: liveBefore });
  const kitManifest = await json(path.join(kit, 'kit.json')), wrapperPins = {};
  for (const lane of ['heavy', 'light']) {
    const selected = kitManifest.locks?.[lane], file = selected?.path ?? path.join(scratch, 'operator', 'with-' + lane + '.ps1');
    if (!path.isAbsolute(file) || selected && (!hex(selected.sha256) || (await pin(file)).sha256 !== selected.sha256)) throw Error('Tooling smoke selected ' + lane + ' wrapper pin differs.');
    wrapperPins[lane] = await pin(file);
  }
  const receiptFile = path.join(scratch, 'companion.json'), profile = path.join(scratch, 'profile.json'), addons = path.join(scratch, 'addons');
  await copy(path.dirname(live.config.addons.path), path.join(scratch, 'baseline-addons'));
  await cp(live.config.profile.path, path.join(scratch, 'baseline-profile.json'), { force: false, errorOnExist: true });
  await copy(path.join(live.release, 'text'), path.join(scratch, 'text'));
  const textOverrides = await Promise.all(['changelog.json', 'roadmap.json'].map(async name => ({ path: 'app/data/' + name,
    source: path.join(scratch, 'text', name), sha256: sha(await readFile(path.join(scratch, 'text', name))) })));
  const privateFiles = (await hashTree(source)).files.map(f => ({ path: f.path, sha256: f.sha256 }));
  // No live config/data/origin/credential path is propagated to a child.
  await save(path.join(scratch, 'release.json'), { schemaVersion: 2, releaseId: 'practice-candidate', practice: true, revision: live.manifest.revision });
  await save(receiptFile, { schemaVersion: 1, coreRoot: core, packsDir: packs, packs: selection, privateFiles, textOverrides, practiceLivePayload: liveInputs.proof });
  await save(path.join(output, 'live-payload-inputs.json'), liveInputs);
  const temp = path.join(output, 'temp'); await mkdir(temp);
  const env = sanitizeExecutionEnvironment(process.env, { overrides: { TEMP: temp, TMP: temp, TMPDIR: temp, RS3_WORKER_IDLE_MS: '20000' } });
  const exec = dependencies.exec ?? runOwnedCommand, checks = [], commandCleanup = [];
  const requireMemory = () => {
    const freeBytes = freemem();
    if (!Number.isFinite(freeBytes) || freeBytes <= 4 * 1024 ** 3) throw Error('Tooling smoke memory checkpoint refused: strictly more than 4 GiB free is required before each real child; no certificate earned.');
    return freeBytes;
  };
  const command = async (name, executable, args, cwd = scratch, executionEnv = env, timeout = 20 * 60000) => {
    const freeMemoryBeforeBytes = requireMemory();
    let result, failure;
    try { result = await exec(executable, args, { cwd, env: executionEnv, windowsHide: true, timeout, maxBuffer: 64 * 1024 ** 2, compilerTemp: temp }); }
    catch (error) { result = error; failure = error; }
    await writeFile(path.join(output, name + '.log'), String(result?.stdout ?? '') + String(result?.stderr ?? ''), { flag: 'wx', mode: 0o600 });
    if (failure) throw Error('Actual tooling smoke child failed: ' + name + '; inspect retained scratch log.');
    if (result.cleanupVerified !== true || result.forcedDescendants !== 0) throw Error('Actual tooling smoke child cleanup is unproved: ' + name);
    commandCleanup.push({ name, cleanupVerified: true, forcedDescendants: 0, freeMemoryBeforeBytes });
    return result;
  };
  const record = async (name, evidence) => {
    const file = path.join(output, name + '.json'); await save(file, evidence);
    checks.push({ name, passed: true, evidenceDigest: sha(await readFile(file)) });
  };
  // A clean exact checkout lets the real preflight validate both committed
  // blobs and input stability. Git objects are copied by fetch, never linked.
  requireMemory();
  const git = execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim().split(/\r?\n/)[0];
  if (!path.isAbsolute(git)) throw Error('Tooling smoke Git executable must resolve absolutely.');
  const gitCore = path.join(output, 'core-reference'); await copy(live.config.coreRoot, gitCore);
  await command('git-init', git, ['init', gitCore]);
  await command('git-autocrlf', git, ['-C', gitCore, 'config', 'core.autocrlf', 'false']);
  await command('git-fetch', git, ['-C', gitCore, 'fetch', '--no-tags', repo, live.manifest.revision]);
  if (kitManifest.coreRevision && kitManifest.coreRevision !== live.manifest.revision) await command('git-fetch-tooling-reference', git, ['-C', gitCore, 'fetch', '--no-tags', repo, kitManifest.coreRevision]);
  await command('git-checkout', git, ['-C', gitCore, 'checkout', '--force', '--detach', live.manifest.revision]);
  const worker = path.join(scratch, 'tools', 'tooling-smoke-worker.mjs'); await writeFile(worker, livePayloadSmokeWorkerSource, { flag: 'wx' });
  const driftInput = path.join(output, 'drift-input.json');
  await save(driftInput, { action: 'drift', proof: liveInputs.proof, options: { core: live.manifest.revision, coreRepo: gitCore, privateRoot: source } });
  const driftChild = await command('private-drift', live.config.nodePath, [worker, driftInput]);
  let drift; try { drift = JSON.parse(driftChild.stdout); } catch { throw Error('Actual live-payload checker returned no structured proof.'); }
  if (drift.passed !== true) throw Error('Actual live-payload drift check refused.');
  await record(toolingSmokeChecks[0], drift);
  const preflightFile = path.join(output, 'preflight.json');
  const preflightInput = path.join(output, 'preflight-input.json');
  await save(preflightInput, { action: 'preflight', proof: liveInputs.proof, toolingInputs: liveInputs.toolingInputs,
    options: { core: gitCore, ref: live.manifest.revision, base: live.manifest.revision, source, packs, corpus: path.join(scratch, 'release-gate/corpus'),
      heavyLock: wrapperPins.heavy.path, lightLock: wrapperPins.light.path, output: preflightFile } });
  await command('preflight', live.config.nodePath, [worker, preflightInput]);
  const preflight = await json(preflightFile), history = preflight.checks?.find(c => c.id === 'history');
  if (!preflight.passed || history?.status !== 'pass' || history.trees?.length !== 1 || history.trees[0].revision !== live.manifest.revision || history.trees[0].status !== 'clean') throw Error('Actual preflight or exact-core scanner proof differs.');
  await record(toolingSmokeChecks[1], preflight);
  for (const lane of ['addon', 'profile']) await command('build-' + lane, live.config.nodePath, [path.join(scratch, 'tools/companion-check.mjs'), '--core', core,
    '--lane', lane, '--receipt', receiptFile, '--output', lane === 'addon' ? addons : profile]);
  const builtAddons = await hashTree(addons), oldAddons = await hashTree(path.join(scratch, 'baseline-addons'));
  if (builtAddons.digest !== oldAddons.digest || sha(await readFile(profile)) !== sha(await readFile(path.join(scratch, 'baseline-profile.json')))) throw Error('Tooling-only builders changed the immutable live payload.');
  await record(toolingSmokeChecks[2], { passed: true, addonTreeDigest: builtAddons.digest, profileSha256: sha(await readFile(profile)), comparedWithUnchangedLiveBytes: true });
  // The first receipt lacks builder pins intentionally; replace only this owned
  // scratch file, after both actual generation paths have completed.
  await writeFile(receiptFile, JSON.stringify({ schemaVersion: 1, coreRoot: core, packsDir: packs, packs: selection, privateFiles, textOverrides, practiceLivePayload: liveInputs.proof,
    addons: await pin(path.join(addons, 'addon.json')), profile: await pin(profile) }, null, 2) + '\n', { mode: 0o600 });
  const install = await command('verify-install', live.config.nodePath, [path.join(scratch, 'tools/verify-install.mjs'), '--core', core, '--companion', scratch, '--receipt', receiptFile]);
  let installed; try { installed = JSON.parse(install.stdout); } catch { throw Error('Install verification returned no structured proof.'); }
  if (installed.passed !== true) throw Error('Actual scratch installation verification refused.');
  await record(toolingSmokeChecks[3], installed);
  const native = await runNativeRunnerSmoke({ output: path.join(output, 'native-fixtures'), runner: path.join(source, 'scripts/adaptive-test-runner.mjs'), retry: path.join(scratch, 'tools/retry-failed-files.mjs') });
  await record(toolingSmokeChecks[4], native);
  const ps = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
  const lightWrapperPin = wrapperPins.light, lightWrapper = lightWrapperPin.path;
  if ((await pin(lightWrapper)).sha256 !== lightWrapperPin.sha256) throw Error('Tooling smoke selected light wrapper changed.');
  // Admission owns machine-level paths derived from the machine TEMP. Keep
  // that value for its wrapper; the gallery itself owns all application state
  // beneath scratch-kit/.local and removes it in its finally block.
  const admissionEnv = sanitizeExecutionEnvironment(process.env, { overrides: { RS3_WORKER_IDLE_MS: '20000' } });
  const galleryWorker = path.join(output, 'gallery-worker.mjs'), galleryEnvelope = path.join(output, 'gallery-envelope.json'), galleryCleanup = path.join(output, 'gallery-cleanup.json');
  await writeFile(galleryWorker, gallerySupervisorSource, { flag: 'wx' });
  await save(galleryEnvelope, { gallery: path.join(scratch, 'tools/gallery-check.mjs'), stopModule: path.join(source, 'scripts/perf/cdp.mjs'), cleanup: galleryCleanup, timeoutMs: 5 * 60000,
    args: ['--core', core, '--checker', path.join(scratch, 'tools/gallery-browser-check.mjs'), '--receipt', receiptFile] });
  const galleryResult = await command('gallery', ps, ['-NoProfile', '-File', lightWrapper, live.config.nodePath,
    galleryWorker, galleryEnvelope], scratch, admissionEnv, 0);
  const gallery = String(galleryResult.stdout).trim().split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(v => v?.passed === true && v.plain && v.framed);
  const cleanup = await json(galleryCleanup);
  if (!gallery || !['plain', 'framed'].every(mode => gallery[mode].total > 0 && gallery[mode].ready === gallery[mode].total)
    || cleanup.passed !== true || cleanup.cleanupVerified !== true || cleanup.deadlineExceeded !== false) throw Error('Actual gallery proof or owned-process cleanup is incomplete.');
  assertScratchGalleryPorts(gallery);
  const local = path.join(scratch, '.local');
  if ((await readdir(local)).some(n => /^(?:gallery-|check-)/.test(n))) throw Error('Tooling child scratch cleanup is incomplete.');
  await record(toolingSmokeChecks[5], { ...gallery, cleanup, lightWrapper: lightWrapperPin });
  await save(path.join(output, 'owned-command-cleanup.json'), commandCleanup);
  await reopenLivePayloadContext(liveInputs.proof, { source, core, revision: live.manifest.revision });
  if ((await practiceLiveIdentity(live)).digest !== liveBefore.digest || await practiceToolingDigest(kit) !== toolingDigest) throw Error('Tooling smoke inputs changed during execution.');
  const result = assertToolingSmokeResult({ schema: 'rs3-tooling-smoke-v1', passed: true, cleanupVerified: true, inputDigest: toolingDigest, checks,
    scope: toolingSmokeScope, fixtureBoundary: 'Real tools; scratch application/save and intentionally tiny native test fixtures; no full product lanes, release assembly or operator promotion.',
    livePayloadDigest: liveBefore.livePayloadDigest, revision: live.manifest.revision, livePayloadProofDigest: liveInputs.proof.digest,
    candidateBoundary: 'Ordinary candidate drift, preflight and gates remain strict and separate; this matrix proves only the exact live payload with declared tooling substitutions.', commandCleanupDigest: digestValue(commandCleanup) }, toolingDigest);
  await save(path.join(output, 'tooling-smoke.json'), result);
  return result;
}
