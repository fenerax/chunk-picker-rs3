// Bounded compatibility with the currently selected immutable release. This
// never runs old full test lanes, imports a live app, or opens a live save.
import path from 'node:path';
import net from 'node:net';
import { readFile, writeFile, mkdir, cp, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { digestValue, hashTree, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { readPracticeLive, practiceLiveIdentity, practiceToolingDigest, payloadIdentity } from './release-practice.mjs';
import { livePayloadProof } from './live-payload-rules.mjs';
import { runOwnedCommand } from './owned-child-processes.mjs';

const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const inside = (root, target) => { const r = path.relative(path.resolve(root), path.resolve(target)); return !r || r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
const exists = async file => { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const phases = ['exact-live-payload', 'retained-release-proof', 'private-drift', 'scratch-lifecycle'];
export const liveBaseScope = 'operator-primitives-stop-swap-start-rollback';
export const lifecycleStages = Object.freeze(['baseline-start', 'forward-stop', 'forward-pointer', 'candidate-start', 'rollback-stop', 'rollback-pointer', 'baseline-restart', 'cleanup-stop']);

async function ordinary(target, absent = false) {
  if (!path.isAbsolute(target ?? '')) throw Error('Compatibility paths must be absolute.');
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1 || current !== path.resolve(target) && !stat.isDirectory()
          || path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('Compatibility refuses linked or noncanonical paths.');
    } catch (e) { if (!absent || e.code !== 'ENOENT') throw e; }
    if (current === path.dirname(current)) break;
  }
}
async function pin(file) { await ordinary(file); return { path: file, sha256: sha(await readFile(file)) }; }
async function copyTree(source, target) {
  const before = await hashTree(source); await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  if ((await hashTree(target)).digest !== before.digest || (await hashTree(source)).digest !== before.digest) throw Error('Compatibility copy changed.');
  return before.digest;
}
async function command(executable, args, cwd) {
  try {
    const options = { cwd, env: sanitizeExecutionEnvironment(), windowsHide: true, timeout: 8 * 60000, maxBuffer: 128 * 1024 ** 2 };
    if (process.platform === 'win32' && /(?:^|[\\/])(?:powershell|pwsh)\.exe$/i.test(executable)) {
      const compilerTemp = path.join(cwd, 'owned-command-temp'); await mkdir(compilerTemp, { recursive: true });
      return await runOwnedCommand(executable, args, { ...options, compilerTemp });
    }
    return await execute(executable, args, options);
  }
  catch { throw Error('Bounded compatibility child refused; inspect scratch evidence.'); }
}

export function assertScratchPorts({ host = '127.0.0.1', port = 8960, loopbackPort = 8961 } = {}) {
  // Current operator primitives support exactly 127.0.0.1 for local startup.
  if (host !== '127.0.0.1' || ![port, loopbackPort].every(p => Number.isInteger(p) && p >= 8900 && p <= 8999) || port === loopbackPort) throw Error('Compatibility requires distinct owned scratch ports 8900–8999.');
  return { host, port, loopbackPort };
}
async function requireFreePort(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(Error('Scratch listener is occupied; no process action was taken.')));
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}

export async function claimLiveBaseAttempt(pending, inputs) {
  await ordinary(pending, true); await mkdir(path.dirname(pending), { recursive: true });
  const attempt = { schema: 'rs3-live-base-attempt-v1', ...inputs, ownerPid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  try { await save(pending, attempt); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A bounded compatibility attempt is active, failed or interrupted; explicit dead-owner recovery is required.'); throw error; }
  return pin(pending);
}
async function assertAttemptOwner(claim) {
  if (!claim || (await pin(claim.path)).sha256 !== claim.sha256) throw Error('Bounded compatibility attempt ownership changed.');
}
/** Recovery is explicit and never replaces a live/uncertain owner. A separate
 * exclusive recovery file serializes recoverers; normal claims use wx only. */
export async function recoverDeadLiveBaseAttempt(pending) {
  if (!path.isAbsolute(pending ?? '') || !path.basename(pending).endsWith('.pending.json')) throw Error('Explicit compatibility pending path required.');
  await ordinary(pending); const recovery = pending + '.recovery';
  await save(recovery, { ownerPid: process.pid, token: randomUUID() });
  try {
    const previous = await pin(pending), attempt = await json(pending);
    if (attempt.schema !== 'rs3-live-base-attempt-v1' || !Number.isInteger(attempt.ownerPid) || attempt.ownerPid < 1 || typeof attempt.token !== 'string') throw Error('Attempt owner cannot be established.');
    try { process.kill(attempt.ownerPid, 0); throw Error('Attempt owner is still alive; recovery refused.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await assertAttemptOwner(previous);
    // Recover ownership for a retry without restoring an older success. This
    // barrier survives recovery and is cleared only by a successful new claim.
    const blocked = pending.replace(/\.pending\.json$/, '.blocked.json');
    if (!await exists(blocked)) await save(blocked, { schema: 'rs3-live-base-blocked-v1', previousAttemptSha256: previous.sha256, recoveredAt: new Date().toISOString() });
    else await ordinary(blocked);
    const retained = pending + '.recovered-' + randomUUID(); await rename(pending, retained);
    return { recovered: true, retained };
  } finally { await unlink(recovery); }
}

/** The native proof must contain observed starts, stops and atomic replacements.
 * A helper dry run or a successful process exit alone cannot satisfy it. */
export function assertLifecycleProof(proof) {
  if (proof?.schema !== 'rs3-bounded-lifecycle-v1' || proof.scope !== liveBaseScope || proof.passed !== true || proof.cleanupVerified !== true
      || digestValue(proof.stages) !== digestValue(lifecycleStages) || !Array.isArray(proof.starts) || proof.starts.length !== 3
      || proof.starts.some(row => !['baseline', 'candidate'].includes(row.slot) || !Number.isInteger(row.pid) || row.pid < 1 || typeof row.processStartedAt !== 'string' || !Number.isFinite(Date.parse(row.processStartedAt)) || row.authenticatedReady !== true)
      || proof.starts.map(row => row.slot).join(',') !== 'baseline,candidate,baseline' || !hex(proof.pointerBefore) || proof.pointerBefore !== proof.pointerAfter
      || !hex(proof.candidatePointer) || proof.candidatePointer === proof.pointerBefore || proof.syntheticStateUnchanged !== true) throw Error('Observed scratch lifecycle proof is incomplete.');
  return proof;
}

export async function runLifecycleWithCleanup(run, cleanup) {
  try { return await run(); } finally { await cleanup(); }
}

/** Fixture seam: enforce stable input identity and all four bounded phases. */
export async function runLiveBaseCheck({ toolingDigest, identity, steps }) {
  if (!hex(toolingDigest) || typeof identity !== 'function' || phases.some(name => typeof steps?.[name] !== 'function')) throw Error('Compatibility adapters are incomplete.');
  const before = await identity(), startedAt = new Date().toISOString(), checks = [];
  if (!hex(before?.digest) || !hex(before.livePayloadDigest) || !/^[a-f0-9]{40}$/.test(before.revision)) throw Error('Compatibility live identity is invalid.');
  let failure, lifecycle;
  try {
    for (const name of phases) {
      const began = performance.now(), result = await steps[name]();
      if (result?.passed !== true) throw Error('Compatibility phase refused: ' + name);
      if (name === 'scratch-lifecycle') lifecycle = assertLifecycleProof(result);
      checks.push({ name, passed: true, milliseconds: performance.now() - began,
        ...(result.evidence ? { evidence: result.evidence } : {}) });
    }
  } catch (e) { failure = e; }
  if ((await identity()).digest !== before.digest) throw Error('Live pair changed during bounded compatibility; receipt refused.');
  if (failure) throw failure;
  const body = { schema: 'rs3-live-base-compatibility-v1', passed: true, scope: liveBaseScope, toolingDigest,
    livePairDigest: before.digest, livePayloadDigest: before.livePayloadDigest, ...(before.liveConfigSha256 ? { liveConfigSha256: before.liveConfigSha256 } : {}), revision: before.revision, checks, lifecycle,
    ...(lifecycle.runtimeOptionsDigest ? { runtimeOptionsDigest: lifecycle.runtimeOptionsDigest } : {}),
    startedAt, completedAt: new Date().toISOString() };
  return { ...body, digest: digestValue(body) };
}

async function exactCore(live, repo, exec) {
  const result = await exec('git', ['--no-optional-locks', '-C', repo, 'ls-tree', '-rz', live.manifest.revision], repo);
  const rows = String(result.stdout).split('\0').filter(Boolean).map(row => {
    const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(row);
    if (!m || m[3].startsWith('/') || /[\\:\u0000-\u001f]/.test(m[3]) || m[3].split('/').some(p => !p || p === '.' || p === '..')) throw Error('Compatibility Git inventory refused.');
    return { name: m[3], oid: m[2] };
  });
  const tree = await hashTree(live.config.coreRoot);
  if (tree.files.length !== rows.length || new Set(rows.map(r => r.name.toLowerCase())).size !== rows.length) throw Error('Live core inventory differs from exact Git revision.');
  for (const row of rows) {
    const bytes = await readFile(path.join(live.config.coreRoot, row.name));
    if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== row.oid) throw Error('Live core bytes differ from exact Git revision.');
  }
  const oldKit = path.resolve(live.release, '../..'), receipt = await json(path.join(live.release, 'companion.json'));
  const source = await hashTree(path.join(oldKit, 'checks/private-source'));
  const actual = source.files.map(r => ({ path: r.path, sha256: r.sha256 })).sort((a,b) => a.path.localeCompare(b.path));
  if (!Array.isArray(receipt.privateFiles) || digestValue([...receipt.privateFiles].sort((a,b) => a.path.localeCompare(b.path))) !== digestValue(actual)) throw Error('Retained private source inventory differs.');
  const sealed = live.manifest.identity, { digest, ...body } = sealed ?? {};
  if (!hex(digest) || digest !== digestValue(body) || !Array.isArray(sealed.components)) throw Error('Retained release identity is invalid.');
  const tools = await hashTree(path.join(oldKit, 'tools'));
  for (const [name, expected] of [['core', tree.digest], ['privateSource', source.digest], ['tools', tools.digest]]) {
    const records = sealed.components.filter(record => record.name === name);
    if (records.length !== 1 || records[0].kind !== 'tree' || records[0].digest !== expected) throw Error('Retained verifier or payload differs from its sealed provenance.');
  }
  return { passed: true, evidence: { coreDigest: tree.digest, sourceDigest: source.digest, retainedToolingDigest: tools.digest, retainedInputDigest: digest } };
}

// Generated only under an absent scratch root, with no live runtime paths.
const seedWorker = `import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const output=process.stdout.write.bind(process.stdout);console.log=console.warn=console.info=console.error=()=>{};
try {
 const c=JSON.parse(await readFile(process.argv[2],'utf8'));
 Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_PACKS_DIR:c.packsDir,RS3_PACK_SELECTION:c.selection.path,RS3_DATASET_PROFILE:c.profile.path,RS3_DATASET_PROFILE_SHA256:c.profile.sha256,RS3_PRIVATE_ADDON:c.addons.path,RS3_PRIVATE_ADDON_SHA256:c.addons.sha256,RS3_GAME_DATA_DIR:path.join(path.dirname(c.dataDir),'game-data'),RS3_MAP_ASSETS_DIR:path.join(path.dirname(c.dataDir),'map-assets'),RS3_WORKER_IDLE_MS:'20000',RS3_TASK_WORKER_MODE:'thread'});
 const {resolveDataset}=await import(pathToFileURL(path.join(c.coreRoot,'app/datasets.mjs')));
 const dataset=await resolveDataset({datasetId:'duo-legacy',packsDir:c.packsDir,selectionPath:c.selection.path,profilePath:c.profile.path,profileSha256:c.profile.sha256});
 const {bindDatasetStorage}=await import(pathToFileURL(path.join(c.coreRoot,'app/dataset-binding.mjs')));await bindDatasetStorage(c.dataDir,dataset);
 const {createServer}=await import(pathToFileURL(path.join(c.coreRoot,'app/server.mjs')));
 const app=await createServer({dataDir:c.dataDir,host:c.host,port:c.port,predictionPrewarm:false,shutdownDeadlineMs:1000,privateAddonOptions:{addonPath:c.addons.path,addonSha256:c.addons.sha256},definitions:{chunks:{12341:{},12342:{}},challenges:{},walkableChunks:['12341','12342'],walkableChunksF2P:['12341','12342']},taskMap:{}});
 await app.close();output(JSON.stringify({passed:true})+'\\n');
} catch {output(JSON.stringify({passed:false})+'\\n');process.exitCode=1;}
`;

// Gate acceptance is deliberately outside this harness. These are the exact
// operator primitives used by the managed helper, operating only scratch paths.
const nativeHarness = String.raw`param([Parameter(Mandatory=$true)][string]$Envelope)
$ErrorActionPreference='Stop'
if ([IO.Path]::GetFullPath($Envelope) -ine (Join-Path $PSScriptRoot 'scratch-envelope.json')) {throw 'Scratch envelope path differs.'}
$e=Get-Content -LiteralPath $Envelope -Raw | ConvertFrom-Json
foreach ($item in @(@('kit','scratch-kit'),@('current','scratch-current.json'),@('proof','lifecycle-proof.json'),@('baseline','scratch-kit/releases/baseline/pointer.json'),@('candidate','scratch-kit/releases/candidate/pointer.json'))) {
 if ([IO.Path]::GetFullPath($e.($item[0])) -ine [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $item[1]))) {throw 'Scratch envelope escaped its root.'}
}
. (Join-Path $e.kit 'operator/Operator-Common.ps1')
. (Join-Path $e.kit 'operator/ReleaseV2-Common.ps1')
foreach ($slot in 'baseline','candidate') {
 $slotRoot=Join-Path $e.kit ('releases/'+$slot)
 $pointer=Read-OperatorJson $e.$slot
 if ([IO.Path]::GetFullPath($pointer.config.path) -ine [IO.Path]::GetFullPath((Join-Path $slotRoot 'config.json'))) {throw 'Scratch pointer configuration escaped its slot.'}
 $raw=Read-OperatorJson (Join-Path $slotRoot 'config.json')
 foreach ($item in @(@('coreRoot',(Join-Path $slotRoot 'core')),@('dataDir',(Join-Path $PSScriptRoot 'runtime/data')),@('packsDir',(Join-Path $e.kit 'packs')),@('publicOriginFile',(Join-Path $PSScriptRoot 'runtime/public-origin')))) {
  if ([IO.Path]::GetFullPath($raw.($item[0])) -ine [IO.Path]::GetFullPath($item[1])) {throw 'Scratch runtime path differs.'}
 }
 if ($raw.host -cne '127.0.0.1' -or $raw.port -lt 8900 -or $raw.port -gt 8999 -or $raw.loopbackPort -lt 8900 -or $raw.loopbackPort -gt 8999) {throw 'Scratch listeners differ.'}
}
$selected=Read-OperatorJson $e.current
$allowed=@([IO.Path]::GetFullPath((Join-Path $e.kit 'releases/baseline/config.json')),[IO.Path]::GetFullPath((Join-Path $e.kit 'releases/candidate/config.json')))
if ([IO.Path]::GetFullPath($selected.config.path) -notin $allowed) {throw 'Scratch current pointer differs.'}
$baseline=Read-ReleaseV2Pointer $e.baseline
$candidate=Read-ReleaseV2Pointer $e.candidate
$current=Read-ReleaseV2Pointer $e.current
Assert-ReleaseV2Transition $candidate.context $baseline.context
Assert-OperatorRollbackPair $candidate.context $baseline.context
$state=Join-Path $baseline.context.config.dataDir 'state.json'
# The seed uses toy definitions, so the first live start reconciles it. Pin the
# save once live has stopped: candidate and rollback must leave it unchanged.
$stateBefore=$null
$stages=[Collections.Generic.List[string]]::new()
$starts=[Collections.Generic.List[object]]::new()
$active=$null
$changed=$false
function Start-Observed($reference,[string]$slot) {
 if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB -lt 4) {throw 'Scratch startup requires 4 GiB free physical memory.'}
 $script:active=$reference
 $null=Start-OperatorCore $reference.context 90
 Assert-ReleaseV2AuthenticatedReady $reference.context 30
 $record=Read-OperatorJson $reference.context.runtimeFile
 $null=Get-OperatorOwnedProcess $reference.context $record
 if (-not (Test-OperatorListeners $reference.context $record)) {throw 'Scratch listeners were not owned.'}
 if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB -lt 4) {throw 'Scratch runtime reduced free physical memory below 4 GiB.'}
 $script:starts.Add([pscustomobject]@{slot=$slot;pid=$record.pid;processStartedAt=$record.processStartedAt;authenticatedReady=$true})
}
try {
 Start-Observed $baseline 'baseline';$stages.Add('baseline-start')
 $null=Stop-OperatorCore $baseline.context 30;$active=$null;$stages.Add('forward-stop')
 $stateBefore=Get-ReleaseV2Hash $state
 Set-ReleaseV2Pointer $current $candidate ([ref]$changed);$stages.Add('forward-pointer')
 if ((Get-ReleaseV2Hash $e.current) -cne $candidate.sha256) {throw 'Forward pointer mismatch.'}
 Start-Observed $candidate 'candidate';$stages.Add('candidate-start')
 $null=Stop-OperatorCore $candidate.context 30;$active=$null;$stages.Add('rollback-stop')
 $forward=Read-ReleaseV2Pointer $e.current
 Set-ReleaseV2Pointer $forward $baseline ([ref]$changed);$stages.Add('rollback-pointer')
 Start-Observed $baseline 'baseline';$stages.Add('baseline-restart')
 $null=Stop-OperatorCore $baseline.context 30;$active=$null;$stages.Add('cleanup-stop')
 Assert-OperatorStoreReleased $baseline.context
 if (Test-Path -LiteralPath $baseline.context.runtimeFile) {throw 'Scratch ownership record remains.'}
 [ordered]@{schema='rs3-bounded-lifecycle-v1';scope='operator-primitives-stop-swap-start-rollback';passed=$true;cleanupVerified=$true;stages=@($stages.ToArray());starts=@($starts.ToArray());pointerBefore=$current.sha256;pointerAfter=(Get-ReleaseV2Hash $e.current);candidatePointer=$candidate.sha256;syntheticStateUnchanged=($stateBefore -ceq (Get-ReleaseV2Hash $state))} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $e.proof -Encoding UTF8
} finally {
 if ($null -ne $active) {$null=Stop-OperatorCore $active.context 30}
}
`;

// Reconciliation uses the two retained independent references. A failed atomic
// current-pointer operation must not prevent stopping its recorded scratch app.
const reconcileHarness = nativeHarness.slice(0, nativeHarness.indexOf('$selected=Read-OperatorJson')) + String.raw`
$baseline=Read-ReleaseV2Pointer $e.baseline
$candidate=Read-ReleaseV2Pointer $e.candidate
Assert-ReleaseV2Transition $candidate.context $baseline.context
foreach ($reference in @($baseline,$candidate)) {
 if (Test-Path -LiteralPath $reference.context.runtimeFile) {
  $record=Read-OperatorJson $reference.context.runtimeFile
  if ($record.configHash -ceq $reference.context.configHash) {$null=Stop-OperatorCore $reference.context 30}
 }
}
if (Test-Path -LiteralPath $baseline.context.runtimeFile) {throw 'Scratch ownership did not reconcile; no unrelated process action was taken.'}
Assert-OperatorStoreReleased $baseline.context
[ordered]@{schema='rs3-bounded-cleanup-v1';passed=$true;cleanupVerified=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'reconciled-cleanup.json') -Encoding UTF8
`;

export const boundedLifecycleScripts = () => ({ runtime: nativeHarness, reconcile: reconcileHarness });

async function scratchLifecycle({ live, kit, output, ports, exec }) {
  const scratchKit = path.join(output, 'scratch-kit'); await mkdir(scratchKit);
  // Only immutable inputs are copied; runtime storage is independently seeded.
  for (const name of ['operator', 'tools']) await copyTree(path.join(kit, name), path.join(scratchKit, name));
  const packs = path.join(scratchKit, 'packs'); await copyTree(live.config.packsDir, packs);
  const selection = await json(path.join(packs, 'selection.json'));
  const runtime = path.join(output, 'runtime'), dataDir = path.join(runtime, 'data'); await mkdir(dataDir, { recursive: true });
  const publicOriginFile = path.join(runtime, 'public-origin');
  // The server refuses non-HTTPS public origins at startup. The scratch origin
  // only shapes generated links; the lifecycle itself talks plain loopback HTTP.
  await writeFile(publicOriginFile, `https://${ports.host}:${ports.port}`, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(dataDir, 'access-token'), randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  const references = {};
  for (const slot of ['baseline', 'candidate']) {
    const root = path.join(scratchKit, 'releases', slot); await mkdir(root, { recursive: true });
    await copyTree(live.config.coreRoot, path.join(root, 'core'));
    await copyTree(path.dirname(live.config.addons.path), path.join(root, 'addons'));
    await cp(live.config.profile.path, path.join(root, 'profile.json'), { errorOnExist: true, force: false });
    const addons = await pin(path.join(root, 'addons', path.basename(live.config.addons.path))), profile = await pin(path.join(root, 'profile.json'));
    if (addons.sha256 !== live.config.addons.sha256 || profile.sha256 !== live.config.profile.sha256) throw Error('Copied live runtime pins differ.');
    const config = { schemaVersion: 1, coreRoot: path.join(root, 'core'), dataDir, nodePath: live.config.nodePath, ...ports, publicOriginFile,
      packsDir: packs, selection: await pin(path.join(packs, 'selection.json')), packs: Object.fromEntries(await Promise.all(['data', 'rulesText', 'art'].map(async kind => [kind, await pin(path.join(packs, selection[kind].id, selection[kind].version, 'pack.json'))]))),
      addons, profile, runtimeOptions: { ...live.config.runtimeOptions } };
    const configFile = path.join(root, 'config.json'); await save(configFile, config);
    references[slot] = path.join(root, 'pointer.json'); await save(references[slot], { schemaVersion: 2, releaseId: 'bounded-' + slot, config: await pin(configFile) });
    const receipt = { schemaVersion: 1, coreRoot: config.coreRoot, packsDir: packs, packs: selection, addons, profile };
    const receiptFile = path.join(root, 'companion.json'); await save(receiptFile, receipt);
    await exec(live.config.nodePath, [path.join(scratchKit, 'tools/verify-install.mjs'), '--core', config.coreRoot, '--companion', scratchKit, '--receipt', receiptFile], scratchKit);
  }
  const current = path.join(output, 'scratch-current.json'); await cp(references.baseline, current, { errorOnExist: true, force: false });
  const seed = path.join(output, 'seed-worker.mjs'); await writeFile(seed, seedWorker, { flag: 'wx' });
  await exec(live.config.nodePath, [seed, path.join(path.dirname(references.baseline), 'config.json')], output);
  const proof = path.join(output, 'lifecycle-proof.json'), envelope = path.join(output, 'scratch-envelope.json'), harness = path.join(output, 'bounded-lifecycle.ps1');
  await save(envelope, { kit: scratchKit, ...references, current, proof }); await writeFile(harness, nativeHarness, { flag: 'wx' });
  const reconcile = path.join(output, 'reconcile-lifecycle.ps1'); await writeFile(reconcile, reconcileHarness, { flag: 'wx' });
  await Promise.all([requireFreePort(ports.host, ports.port), requireFreePort('127.0.0.1', ports.loopbackPort)]);
  const ps = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
  let reconciliationJobCleanupVerified = false;
  const observed = await runLifecycleWithCleanup(async () => {
    const result = await exec(ps, ['-NoProfile', '-File', harness, '-Envelope', envelope], output);
    if (exec === command && result.cleanupVerified !== true) throw Error('Native lifecycle job cleanup was not verified.');
    return { ...assertLifecycleProof(await json(proof)), ownedJobCleanupVerified: result.cleanupVerified === true };
  }, async () => {
    // A killed/timed-out PowerShell can leave its detached child alive. This
    // second foreground helper reconciles only its exact owned scratch record.
    const result = await exec(ps, ['-NoProfile', '-File', reconcile, '-Envelope', envelope], output);
    if (exec === command && result.cleanupVerified !== true) throw Error('Native reconciliation job cleanup was not verified.');
    reconciliationJobCleanupVerified = result.cleanupVerified === true;
    const cleaned = await json(path.join(output, 'reconciled-cleanup.json'));
    if (cleaned.passed !== true || cleaned.cleanupVerified !== true) throw Error('Scratch lifecycle cleanup could not be verified.');
  });
  return { ...observed, runtimeOptionsDigest: digestValue(live.config.runtimeOptions), reconciliationJobCleanupVerified, reconciliation: await pin(path.join(output, 'reconciled-cleanup.json')) };
}

/** Protect live storage and exact sidecars while allowing owned audit siblings. */
export function assertCompatibilityOutputPaths({ kit, output, evidenceDir, live }) {
  const runtimeParent = path.dirname(live.config.dataDir);
  const protectedRoots = [kit, path.resolve(live.release, '../..'), live.config.dataDir, live.config.packsDir, live.config.coreRoot, path.dirname(live.config.addons.path)];
  const protectedFiles = [live.current, live.configFile, live.config.publicOriginFile, live.config.dataDir + '.dataset.json',
    ...['server-runtime.json', 'helper.lock', 'watchdog-tick.lock', 'picker-paused', 'release-pack-transition.json', 'public-origin', 'server.log', 'server-error.log'].map(name => path.join(runtimeParent, name))];
  for (const target of [output, evidenceDir]) for (const root of protectedRoots) if (inside(root, target) || inside(target, root)) throw Error('Compatibility output overlaps protected inputs.');
  for (const target of [output, evidenceDir]) for (const file of protectedFiles) if (file && (inside(target, file) || inside(file, target))) throw Error('Compatibility output overlaps protected runtime sidecars.');
  if (inside(output, evidenceDir) || inside(evidenceDir, output)) throw Error('Compatibility evidence and scratch must be separate.');
}

/** Production callers supply options only. Dependency injection is an in-process
 * fixture seam, never a command-line bypass of retained evidence or lifecycle. */
export async function checkLiveBaseCompatibility(options, dependencies = {}) {
  for (const name of ['kit', 'current', 'repo', 'evidenceDir', 'output']) if (!path.isAbsolute(options[name] ?? '')) throw Error('Bounded compatibility requires absolute inputs.');
  const kit = path.resolve(options.kit), output = path.resolve(options.output), evidenceDir = path.resolve(options.evidenceDir), live = await readPracticeLive(options.current);
  assertCompatibilityOutputPaths({ kit, output, evidenceDir, live });
  await ordinary(output, true); await ordinary(evidenceDir, true);
  if (await exists(output)) throw Error('Compatibility scratch must be absent.');
  const ports = assertScratchPorts(options), exec = dependencies.exec ?? command;
  const toolingDigest = await (dependencies.toolingDigest ?? practiceToolingDigest)(kit);
  if (!hex(toolingDigest)) throw Error('Compatibility tooling identity refused.');
  if (options.toolingDigest && options.toolingDigest !== toolingDigest) throw Error('Compatibility tooling certificate differs.');
  await mkdir(output, { recursive: true });
  const identity = () => (dependencies.identity ?? practiceLiveIdentity)(live);
  const before = await identity();
  if (!hex(before.livePayloadDigest)) throw Error('Compatibility payload identity refused.');
  const directory = path.join(evidenceDir, 'live-base'); await ordinary(directory, true); await mkdir(directory, { recursive: true });
  const key = toolingDigest + '-' + before.livePayloadDigest;
  const pending = path.join(directory, key + '.pending.json');
  // Exclusive ownership prevents overlapping attempts from clearing each
  // other's barriers. Failure retains the claim until explicit dead recovery.
  const attempt = await claimLiveBaseAttempt(pending, { toolingDigest, livePayloadDigest: before.livePayloadDigest });
  const steps = {
    'exact-live-payload': dependencies.exactPayload ?? (() => exactCore(live, options.repo, exec)),
    'retained-release-proof': dependencies.retainedProof ?? (async () => {
      const oldKit = path.resolve(live.release, '../..');
      const value = await exec(live.config.nodePath, [path.join(oldKit, 'tools/release-v2.mjs'), 'assert-identity', '--kit', oldKit, '--release', live.release, '--rollback'], oldKit);
      let proof; try { proof = JSON.parse(value.stdout); } catch { throw Error('Retained live proof returned no structured result.'); }
      if (proof.exactIdentity !== true || proof.gatesPassed !== true) throw Error('Retained live proof refused.');
      return { passed: true, evidence: { verifier: await pin(path.join(oldKit, 'tools/release-v2.mjs')),
        gates: await pin(path.join(live.release, 'release-gate/gates.json')), acceptance: await pin(path.join(live.release, 'release-gate/accepted.json')) } };
    }),
    'private-drift': dependencies.drift ?? (async () => {
      const module = await import(pathToFileURL(path.join(kit, 'tools/check-private-drift.mjs')));
      const proof = options.livePayloadContext === undefined ? undefined : livePayloadProof(options.livePayloadContext);
      const inputs = { core: live.manifest.revision, coreRepo: options.repo, privateRoot: proof?.source.root ?? path.join(path.resolve(live.release, '../..'), 'checks/private-source') };
      const report = proof ? await module.checkLivePayloadDrift({ ...inputs, proof }) : await module.checkPrivateDrift(inputs);
      const file = path.join(output, 'drift.json'); await save(file, report);
      return { ...report, evidence: { proof: await pin(file), livePayloadIdentity: proof?.digest ?? null, tolerated: report.tolerated ?? [] } };
    }),
    'scratch-lifecycle': dependencies.lifecycle ?? (() => scratchLifecycle({ live, kit, output, ports, exec })),
  };
  const checked = await runLiveBaseCheck({ toolingDigest, identity, steps });
  const { digest: checkedDigest, ...checkedBody } = checked;
  const reportBody = { ...checkedBody, outputRoot: output };
  const report = { ...reportBody, digest: digestValue(reportBody) };
  if (report.livePairDigest !== before.digest) throw Error('Live pair changed before bounded check began; receipt refused.');
  if (await (dependencies.toolingDigest ?? practiceToolingDigest)(kit) !== toolingDigest) throw Error('Compatibility tooling changed; receipt refused.');
  // The live pair identity intentionally excludes old test/tool trees. Recheck
  // these retained provenance inputs too before accepting the observed proof.
  if (!dependencies.exactPayload) await exactCore(live, options.repo, exec);
  await assertAttemptOwner(attempt);
  await save(path.join(output, 'compatibility-report.json'), report);
  const acceptance = path.join(directory, key + '.json');
  if (await exists(acceptance)) { await ordinary(acceptance); await rename(acceptance, acceptance + '.previous-' + randomUUID()); }
  await save(acceptance, { ...report, proof: await pin(path.join(output, 'compatibility-report.json')) });
  await assertAttemptOwner(attempt);
  const blocked = path.join(directory, key + '.blocked.json');
  if (await exists(blocked)) { await ordinary(blocked); await unlink(blocked); }
  await unlink(pending);
  return { ...report, output, acceptance };
}

export async function assertLiveBaseCompatibility({ kit, current, previousConfig, evidenceDir, toolingDigest: expectedTooling, now = Date.now() }) {
  if (![kit, evidenceDir].every(p => path.isAbsolute(p ?? '')) || current !== undefined && !path.isAbsolute(current ?? '') || !Number.isFinite(now)) throw Error('Compatibility acceptance inputs refused.');
  const toolingDigest = await practiceToolingDigest(kit);
  if (expectedTooling && expectedTooling !== toolingDigest) throw Error('Compatibility tooling certificate differs.');
  let live, identity;
  if (current !== undefined) {
    live = await readPracticeLive(current); identity = await practiceLiveIdentity(live);
  } else {
    if (!previousConfig || !hex(previousConfig.sha256) || (await pin(previousConfig.path)).sha256 !== previousConfig.sha256) throw Error('Compatibility previous configuration pin refused.');
    const configFile = previousConfig.path, config = await json(configFile), release = path.dirname(configFile), manifest = await json(path.join(release, 'release.json'));
    if (!/^[a-f0-9]{40}$/.test(manifest.revision ?? '') || path.resolve(config.coreRoot) !== path.join(release, 'core')) throw Error('Compatibility requires an immutable previous release.');
    live = { configFile, config, release, manifest };
    const payload = await payloadIdentity(live);
    identity = { livePayloadDigest: payload.digest, liveConfigSha256: payload.liveConfigSha256, revision: payload.revision };
  }
  const base = path.join(evidenceDir, 'live-base', toolingDigest + '-' + identity.livePayloadDigest);
  if (await exists(base + '.pending.json') || await exists(base + '.blocked.json')) throw Error('Latest bounded compatibility attempt is incomplete or failed.');
  const file = base + '.json'; await ordinary(file);
  if ((await lstat(file)).size > 256 * 1024) throw Error('Compatibility receipt is oversized.');
  const { proof, ...report } = await json(file), { digest, ...body } = report;
  if (report.schema !== 'rs3-live-base-compatibility-v1' || report.scope !== liveBaseScope || report.passed !== true || digest !== digestValue(body)
      || report.toolingDigest !== toolingDigest || current !== undefined && report.livePairDigest !== identity.digest || !hex(report.livePairDigest)
      || report.liveConfigSha256 !== identity.liveConfigSha256 || report.livePayloadDigest !== identity.livePayloadDigest || report.revision !== identity.revision
      || !Array.isArray(report.checks) || report.checks.length !== phases.length || report.checks.some((row, index) => row.name !== phases[index] || row.passed !== true || !Number.isFinite(row.milliseconds) || row.milliseconds < 0)
      || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt)) || Date.parse(report.completedAt) < Date.parse(report.startedAt)
      || Date.parse(report.completedAt) > now + 60000) throw Error('Bounded compatibility receipt is corrupt or differs.');
  if (!path.isAbsolute(report.outputRoot ?? '')) throw Error('Retained bounded output root is invalid.');
  assertCompatibilityOutputPaths({ kit, output: report.outputRoot, evidenceDir, live });
  if (proof?.path !== path.join(report.outputRoot, 'compatibility-report.json')) throw Error('Retained bounded proof path differs.');
  assertLifecycleProof(report.lifecycle);
  if (report.lifecycle.ownedJobCleanupVerified !== true || report.lifecycle.reconciliationJobCleanupVerified !== true) throw Error('Owned native job cleanup was not verified.');
  if (report.runtimeOptionsDigest !== digestValue(live.config.runtimeOptions) || report.lifecycle.runtimeOptionsDigest !== report.runtimeOptionsDigest) throw Error('Bounded runtime options coverage differs.');
  const reconciliation = report.lifecycle.reconciliation;
  if (!reconciliation || reconciliation.path !== path.join(report.outputRoot, 'reconciled-cleanup.json') || !hex(reconciliation.sha256) || (await pin(reconciliation.path)).sha256 !== reconciliation.sha256) throw Error('Owned scratch reconciliation proof changed.');
  const cleanup = await json(reconciliation.path);
  if (cleanup.schema !== 'rs3-bounded-cleanup-v1' || cleanup.passed !== true || cleanup.cleanupVerified !== true) throw Error('Owned scratch reconciliation was not verified.');
  const oldKit = path.resolve(live.release, '../..'), exact = report.checks.find(row => row.name === 'exact-live-payload').evidence;
  if (!exact || !hex(exact.sourceDigest) || !hex(exact.retainedToolingDigest) || exact.retainedInputDigest !== live.manifest.identity?.digest) throw Error('Retained compatibility provenance is incomplete.');
  for (const [name, root, expected] of [['privateSource', path.join(oldKit, 'checks/private-source'), exact.sourceDigest], ['tools', path.join(oldKit, 'tools'), exact.retainedToolingDigest]]) {
    if ((await hashTree(root)).digest !== expected || live.manifest.identity.components.filter(row => row.name === name && row.digest === expected).length !== 1) throw Error('Retained compatibility provenance changed.');
  }
  const retained = report.checks.find(row => row.name === 'retained-release-proof').evidence;
  const expectedRetained = { verifier: path.join(oldKit, 'tools/release-v2.mjs'), gates: path.join(live.release, 'release-gate/gates.json'), acceptance: path.join(live.release, 'release-gate/accepted.json') };
  for (const name of ['verifier', 'gates', 'acceptance']) if (!retained?.[name] || retained[name].path !== expectedRetained[name] || !hex(retained[name].sha256) || (await pin(retained[name].path)).sha256 !== retained[name].sha256) throw Error('Retained live proof evidence changed.');
  const drift = report.checks.find(row => row.name === 'private-drift').evidence;
  if (!drift?.proof || drift.proof.path !== path.join(report.outputRoot, 'drift.json') || !hex(drift.proof.sha256) || (await pin(drift.proof.path)).sha256 !== drift.proof.sha256) throw Error('Bounded drift evidence changed.');
  const driftReport = await json(drift.proof.path);
  if (driftReport.passed !== true || digestValue(driftReport.tolerated ?? []) !== digestValue(drift.tolerated)) throw Error('Bounded drift tolerances changed.');
  if (!proof || !hex(proof.sha256) || (await pin(proof.path)).sha256 !== proof.sha256 || digestValue(await json(proof.path)) !== digestValue(report)) throw Error('Retained bounded proof changed.');
  if (current !== undefined ? (await practiceLiveIdentity(live)).digest !== identity.digest : (await payloadIdentity(live)).digest !== identity.livePayloadDigest) throw Error('Live pair changed while accepting compatibility.');
  if (await exists(base + '.pending.json') || await exists(base + '.blocked.json')) throw Error('Latest bounded compatibility attempt is incomplete or failed.');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Bounded compatibility is a library: checkLiveBaseCompatibility({kit,current,repo,evidenceDir,output,port,loopbackPort}).');
  else { console.error('Use the bounded compatibility library through the release tooling.'); process.exitCode = 1; }
}
