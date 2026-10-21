// One-command private release preparation, exact gates and managed handover.
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, writeFile, lstat, readdir, rm, cp, open, unlink, chmod } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { hashTree, captureInputIdentity, captureExecutionIdentity, sanitizeExecutionEnvironment, deriveLaneKey, readSuccessReceipt, writeSuccessReceipt, digestValue } from './release-identity.mjs';
import { validateReleaseTextInput, applyTextEntries, copyPreviousTextSource, verifyTextDelta, runTextEndpointCheck } from './release-text.mjs';
import { scanPublicCandidate } from './public-core-gate.mjs';
import { configDescriptor, checkPackTransition, bindingBytes } from './release-pack-check.mjs';
import { stageLegacyRollback } from './release-legacy-rollback.mjs';
import { releasePreflight } from './release-preflight.mjs';
import { assertIdle, observeIdle } from './release-idle.mjs';
import { gatePolicyDigest, gateContract, laneEnvironment, stableExecution, lookupEvidence, publishEvidence, localEvidence, verifyLocalEvidence, hashFile, defaultEvidenceDirectory } from './release-evidence.mjs';
import { runFileLane, verifyFileLane, previousFailures, planLane } from './file-test-lane.mjs';
import { planLaneEvidence, lookupLaneEvidence } from './lane-test-evidence.mjs';
import { readFilePass } from './file-test-evidence.mjs';
import { orderedEarly, pipelineTests } from './release-early.mjs';
import { writeFrozenSeal, readFrozenSeal, frozenHash, phaseSummary } from './frozen-release.mjs';
const refusalCause = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error).replace(/https?:\/\/[^\s]+/gi, '[address redacted]').replace(/(?:Bearer\s+|(?:token|secret|password)[=:]\s*)[^\s]+/gi, '[credential redacted]'), ...(error?.code ? { code: error.code } : {}) });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const exists = async file => { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const here = fileURLToPath(import.meta.url);
const defaultKit = path.resolve(path.dirname(here), '..');
const policy = { version: 'release-v2.1', public: 'independent-full', private: 'complete-overlay-full', gallery: 'plain-and-framed', text: 'exact-prose-contract-v1' };
const ps = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
async function lockScript(kit,lane) {
  const pin = (await json(path.join(kit,'kit.json'))).locks?.[lane];
  if (!pin) return path.join(kit,'operator/with-'+lane+'.ps1'); // Synthetic/old kit compatibility.
  if (!path.isAbsolute(pin.path ?? '') || sha(await readFile(await regular(pin.path))) !== pin.sha256) throw new Error('Shared wrapper changed.');
  return pin.path;
}
async function exportCore(git, revision, output) {
  // Object bytes bypass archive attributes (export-ignore/export-subst) and working trees.
  const rows = git('ls-tree', '-rz', revision).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match || /[\\:\r\n\u0000-\u001f]/.test(match[3]) || match[3].split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || part.toLowerCase() === '.git')) throw new Error('Export path refused.');
    return { mode: match[1], oid: match[2], name: match[3] };
  });
  if (new Set(rows.map(row => row.name.toLowerCase())).size !== rows.length) throw new Error('Case-colliding export refused.');
  const batch = git('cat-file', '--batch', { input: rows.map(row => row.oid + '\n').join('') });
  let offset = 0;
  for (const row of rows) {
    const end = batch.indexOf(10, offset), header = /^([a-f0-9]{40}) blob (\d+)$/.exec(batch.subarray(offset, end).toString());
    if (!header || header[1] !== row.oid) throw new Error('Export object refused.');
    const length = Number(header[2]); offset = end + 1;
    const bytes = batch.subarray(offset, offset + length); offset += length + 1;
    if (bytes.length !== length || createHash('sha1').update(`blob ${length}\0`).update(bytes).digest('hex') !== row.oid) throw new Error('Export object bytes changed.');
    const target = path.join(output, row.name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
    if (process.platform !== 'win32') await chmod(target, row.mode === '100755' ? 0o755 : 0o644);
  }
  const actual = await hashTree(output); if (actual.files.length !== rows.length) throw new Error('Export inventory changed.');
}
function inside(root, file) { const r = path.relative(root, file); return !!r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); }
async function regular(file) { const s = await lstat(file); if (s.isSymbolicLink() || !s.isFile() || s.nlink !== 1) throw new Error('Regular file required.'); return file; }
async function safeRemove(root, target) { if (!inside(root, target) || (await lstat(target)).isSymbolicLink()) throw new Error('Cleanup containment refused.'); await rm(target, { recursive: true, force: true }); }
async function run(command, args, { cwd, env = sanitizeExecutionEnvironment(), log, timeout = 0 } = {}) {
  const output = await open(log, 'a', 0o600);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, windowsHide: true, detached:process.platform!=='win32', stdio: ['ignore', output.fd, output.fd] });
      let timedOut=false,killing=Promise.resolve();
      if (timeout) timer = setTimeout(() => {
        timedOut=true;
        if(process.platform==='win32')killing=new Promise((done,failed)=>{
          // Only this call's owned tree is terminated. Wait for tree cleanup
          // before callers remove scratch or consider publishing any proof.
          const killer=spawn(path.join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.once('error',failed);killer.once('close',code=>code===0?done():failed(Error('Owned tree cleanup unverified.')));
        });
        else {try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')killing=Promise.reject(error);}}
        killing.catch(()=>{});
      }, timeout);
      child.once('error', () => reject(new Error('Release child failed.')));
      child.once('close', async code => {try{await killing;if(timedOut)throw Error('Release stage timed out after owned tree cleanup.');if(code!==0)throw Error('Release child exited with code ' + (Number.isInteger(code) ? code : 'unknown') + '.');resolve(0);}catch(error){reject(error);}});
    });
  } finally { clearTimeout(timer); await output.close(); }
}
async function timed(timings, name, action) {
  const start = Date.now(), tick = performance.now(), startedAt = new Date(start).toISOString(); console.log(`Release stage: ${name}`);
  const record = passed => timings.push({ stage: name, startedAt, completedAt:new Date().toISOString(), seconds:(performance.now()-tick)/1000, passed });
  try { const result = await action(); record(true); return result; }
  catch (e) { record(false); throw e; }
}
async function lease(kit, action) {
  const local = path.join(kit, '.local'); await mkdir(local, { recursive: true });
  const name = path.join(local, 'release.lock'), owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  let handle;
  try { handle = await open(name, 'wx', 0o600); await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
  catch { throw new Error('Another release owns the queue; retained locks require inspection.'); }
  try { return await action(); }
  finally { await handle.close(); const current = await json(name); if (current.pid !== owner.pid || current.token !== owner.token) throw new Error('Release lease changed.'); await unlink(name); }
}
async function pointerConfig(pointer) {
  const p = await json(pointer); if (p.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(p.releaseId) || !path.isAbsolute(p.config?.path ?? '') || !/^[a-f0-9]{64}$/.test(p.config?.sha256)) throw new Error('Pointer invalid.');
  const bytes = await readFile(await regular(p.config.path)); if (sha(bytes) !== p.config.sha256) throw new Error('Pointer config changed.');
  return { pointer: p, path: p.config.path, bytes, config: JSON.parse(bytes) };
}
async function verifyPrevious(manifest, current) {
  const bytes = await readFile(await regular(manifest.previousConfig.path)); if (sha(bytes) !== manifest.previousConfig.sha256) throw new Error('Previous config changed.');
  if (current) { const selected = await pointerConfig(current); if (selected.path !== manifest.previousConfig.path || sha(selected.bytes) !== manifest.previousConfig.sha256) throw new Error('Running release pointer advanced. Prepare again.'); }
}
export async function candidateIdentity(kit, release, includePlan = true, historical = null) {
  const config = await json(path.join(release, 'config.json'));
  const receipt = await json(path.join(release, 'companion.json'));
  const identity = await captureInputIdentity({ components: [
    { name: 'core', root: path.join(release, 'core') }, { name: 'privateSource', root: path.join(kit, 'checks/private-source') },
    { name: 'tools', root: path.join(kit, 'tools') }, { name: 'operator', root: path.join(kit, 'operator') },
    { name: 'packs', root: path.join(kit, 'packs') },
    ...(receipt.packsDir ? [{name:'releasePacks',root:receipt.packsDir}] : []),
    ...(await exists(path.join(release,'pack-transition.json')) ? [{name:'packTransition',file:path.join(release,'pack-transition.json')}] : []), { name: 'addon', root: path.join(release, 'addons') },
    { name: 'text', root: path.join(release, 'text') }, { name: 'profile', file: path.join(release, 'profile.json') },
    { name: 'receipt', file: path.join(release, 'companion.json') }, { name: 'config', file: path.join(release, 'config.json') },
    { name: 'pointer', file: path.join(release, 'pointer.json') }, { name: 'request', file: path.join(release, 'request.json') },
    { name: 'nodeExecutable', file: config.nodePath },
    { name: 'runtimeOrigin', file: config.publicOriginFile }, { name: 'runtimePacks', root: config.packsDir },
    ...(!historical ? [{ name: 'heavyWrapper',file:await lockScript(kit,'heavy') }, { name: 'lightWrapper',file:await lockScript(kit,'light') }] : []),
    { name: 'kit', file: path.join(kit, 'kit.json') }, { name: 'corpus', root: path.join(kit, 'release-gate/corpus') },
    ...(includePlan ? [{ name: 'plan', file: path.join(release, 'release-plan.json') }] : []),
  ], metadata: { policy } });
  if (!historical) return identity;
  // Retained wrapper records describe the execution that earned these receipts.
  // Never open today's shared wrapper when validating a retained release.
  const pins = (await json(path.join(kit, 'kit.json'))).locks;
  for (const [name, lane] of [['heavyWrapper', 'heavy'], ['lightWrapper', 'light']]) {
    const records = historical.components.filter(c => c.name === name);
    const record = records[0], file = record?.files?.[0];
    if (records.length !== 1 || record.kind !== 'file' || record.files.length !== 1 || file.path !== '.' || !/^[a-f0-9]{64}$/.test(file.sha256) || record.digest !== digestValue(file) || (pins && file.sha256 !== pins[lane]?.sha256)) throw new Error('Retained wrapper record changed.');
    identity.components.push(record);
  }
  identity.components.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const {digest, ...body} = identity;
  return {...body, digest: digestValue(body)};
}
async function assertCandidate(kit, release, manifest, verifyRollback = true, retained = false) {
  if (!inside(path.join(kit, 'releases'), release) || manifest.schemaVersion !== 2 || manifest.releaseId !== path.basename(release)) throw new Error('Release root refused.');
  const plan = await json(path.join(release, 'release-plan.json'));
  for (const key of Object.keys(plan)) if (digestValue(plan[key]) !== digestValue(manifest[key])) throw new Error('Release plan changed.');
  const identity = await candidateIdentity(kit, release, true, retained ? manifest.identity : null);
  if (identity.digest !== manifest.identity.digest) throw new Error('Frozen release inputs changed.');
  if (manifest.packUpgrade && verifyRollback) {
    if (!manifest.previousRelease) throw new Error('Retained pack rollback root missing.');
    const previous = await json(path.join(manifest.previousRelease,'release.json'));
    const previousKit = path.resolve(manifest.previousRelease,'../..');
    await assertCandidate(previousKit,manifest.previousRelease,previous,false,true);
    await assertGateEvidence(previousKit,manifest.previousRelease,previous,true);
    if (!await exists(path.join(manifest.previousRelease,'release-gate/accepted.json')) && previous.lane !== 'adopted') throw new Error('Pack upgrade requires accepted rollback evidence.');
  }
  return identity;
}
/** Read-only inputs: no candidate, lease, gate or admission wrapper. */
export async function checkRequest(options) {
  let scratch;
  try {
    if (![options.kit, options.input, options.current].every(value => typeof value === 'string' && path.isAbsolute(value))) throw Error();
    const kitStat = await lstat(options.kit);
    if (!kitStat.isDirectory() || kitStat.isSymbolicLink()) throw Error();
    let request;
    try { request = await json(await regular(options.input)); }
    catch { const error = Error('Request JSON refused (rule: request-json).'); error.releaseTextRule = 'request-json'; throw error; }
    const text = validateReleaseTextInput({ changelog: request?.changelog, roadmap: request?.roadmap });
    const previous = await pointerConfig(options.current);
    scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-check-request-'));
    await copyPreviousTextSource(scratch, previous.config);
    const result = await applyTextEntries(scratch, text);
    const after = await pointerConfig(options.current);
    if (after.path !== previous.path || sha(after.bytes) !== sha(previous.bytes)) throw Error();
    return { schema: 'rs3-release-request-check-v1', passed: true, readOnly: true, ...result };
  } catch (error) {
    if (error.releaseTextRule) throw error;
    const refusal = Error('Release request check refused (rule: request-source).');
    refusal.releaseTextRule = 'request-source'; throw refusal;
  } finally {
    if (scratch) await safeRemove(path.dirname(scratch), scratch);
  }
}
export async function prepare(options) {
  const kit = path.resolve(options.kit ?? defaultKit), repo = options.repo, ref = options.ref;
  if (!path.isAbsolute(repo ?? '') || !ref || !path.isAbsolute(options.input ?? '')) throw new Error('Prepare requires repo, ref and JSON input.');
  const request = await json(options.input), releaseId = options.id ?? request.releaseId;
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(releaseId ?? '')) throw new Error('Release ID refused.');
  const text = validateReleaseTextInput({ changelog: request.changelog, roadmap: request.roadmap });
  return lease(kit, async () => {
    const git = (...args) => { const extra = typeof args.at(-1) === 'object' ? args.pop() : {}; return execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { windowsHide: true, maxBuffer: 64 * 1024 ** 2, ...extra }); };
    if (ref.startsWith('-')) throw new Error('Core ref refused.');
    const revision = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
    const prepareTimings=[];
    try{await timed(prepareTimings,'private-drift',async()=>await (await import('./check-private-drift.mjs')).assertPrivateDriftForStaging({source:path.join(kit,'checks/private-source'),coreRepo:repo,coreRef:revision}));}
    catch(error){await writeFile(path.join(kit,'.local/prepare-preflight-failure.json'),JSON.stringify({releaseId,revision,failed:true,cause:refusalCause(error),timings:prepareTimings,...phaseSummary(prepareTimings)},null,2)+'\n');throw error;}
    const previous = options.current ? await pointerConfig(options.current) : { path: options['previous-config'], bytes: await readFile(await regular(options['previous-config'])) };
    const previousRelease = options['previous-release'] ?? (await exists(path.join(path.dirname(previous.path),'release.json')) ? path.dirname(previous.path) : null);
    const previousConfig = JSON.parse(previous.bytes), base = options.base ?? (previousRelease ? (await json(path.join(previousRelease, 'release.json'))).revision : undefined);
    if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('An exact accepted base commit is required.');
    const {assertPracticeAcceptance}=await import('./release-practice.mjs');
    await assertPracticeAcceptance({kit,current:options.current,evidenceDir:evidenceDirectory(kit,options),previousConfig:{path:previous.path,sha256:sha(previous.bytes)}});
    git('merge-base', '--is-ancestor', base, revision);
    if(options.expectedGatePolicySha256 && options.expectedGatePolicySha256 !== gatePolicyDigest) throw Error('Gate policy differs from paired input.');
    const preflight = await releasePreflight({objectOnly:true,core:repo,ref:revision,base,source:path.join(kit,'checks/private-source'),packs:path.join(kit,'packs'),kit});
    if(!preflight.passed) { console.log(JSON.stringify(preflight)); throw Error('Release preflight failed.'); }
    await checkActivity(options);
    const modes = git('ls-tree', '-r', revision).toString().trim().split('\n');
    if (modes.some(row => !/^100(?:644|755) blob [a-f0-9]+\t/.test(row))) throw new Error('Non-regular core export refused.');
    const release = path.join(kit, 'releases', releaseId); await mkdir(release); await mkdir(path.join(release, '.local')); await mkdir(path.join(release, 'release-gate')); await mkdir(path.join(release, 'core')); await mkdir(path.join(release, 'text'));
    const timings = prepareTimings;
    try {
      await save(path.join(release, 'request.json'), request);
      await save(path.join(release,'preflight.json'),preflight);
      await timed(timings, 'export-core', () => exportCore(git, revision, path.join(release, 'core')));
      const textRoot = path.join(release, '.local/text-source');
      await copyPreviousTextSource(textRoot, previousConfig);
      await applyTextEntries(textRoot, text);
      const textOverrides = [];
      for (const name of ['changelog.json', 'roadmap.json']) { const file = path.join(release, 'text', name); await cp(path.join(textRoot, 'app/data', name), file); textOverrides.push({ path: 'app/data/' + name, source: file, sha256: sha(await readFile(file)) }); }
      await safeRemove(path.join(release, '.local'), textRoot);
      const sourceInventory = await hashTree(path.join(kit, 'checks/private-source'));
      const packsDir = path.join(release,'packs');
      const packIdentity = await hashTree(path.join(kit,'packs'));
      await cp(path.join(kit,'packs'),packsDir,{recursive:true,errorOnExist:true,force:false});
      if ((await hashTree(packsDir)).digest !== packIdentity.digest || (await hashTree(path.join(kit,'packs'))).digest !== packIdentity.digest) throw new Error('Release pack copy changed.');
      const selection = await json(path.join(kit, 'packs/selection.json'));
      if(['data','rulesText','art'].some(k=>/^(?:0\.0\.0-dev\.|.*-dev\.)/.test(selection[k]?.version??'')))throw Error('Development packs cannot authorize production preparation.');
      const receipt = { schemaVersion: 1, coreRoot: path.join(release, 'core'), packsDir, privateFiles: sourceInventory.files.map(file => ({ path: file.path, sha256: file.sha256 })), packs: selection, textOverrides };
      const receiptFile = path.join(release, 'companion.json'); await save(receiptFile, receipt);
      for (const lane of ['addon', 'profile']) {
        const output = path.join(release, lane === 'addon' ? 'addons' : 'profile.json');
        await timed(timings, 'build-' + lane, () => run(previousConfig.nodePath, [path.join(kit, 'tools/companion-check.mjs'), '--core', receipt.coreRoot, '--receipt', receiptFile, '--lane', lane, '--output', output], { cwd: kit, log: path.join(release, '.local/prepare.log') }));
      }
      receipt.profile = { path: path.join(release, 'profile.json'), sha256: sha(await readFile(path.join(release, 'profile.json'))) };
      receipt.addons = { path: path.join(release, 'addons/addon.json'), sha256: sha(await readFile(path.join(release, 'addons/addon.json'))) };
      await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
      const packChanged = ['data','rulesText','art'].some(kind => previousConfig.packs[kind].sha256 !== selection[kind].sha256);
      if (packChanged && (!request.packTransition || !previousRelease)) throw new Error('Pack upgrades require explicit transition descriptors and a retained previous release.');
      const config = { ...previousConfig, coreRoot: receipt.coreRoot, profile: receipt.profile, addons: receipt.addons, packsDir,
        selection:{path:path.join(packsDir,'selection.json'),sha256:sha(await readFile(path.join(packsDir,'selection.json')))},
        packs:Object.fromEntries(['data','rulesText','art'].map(kind=>[kind,{path:path.join(packsDir,selection[kind].id,selection[kind].version,'pack.json'),sha256:selection[kind].sha256}])) };
      const configFile = path.join(release, 'config.json'); await save(configFile, config);
      await save(path.join(release, 'pointer.json'), { schemaVersion: 2, releaseId, config: { path: configFile, sha256: sha(await readFile(configFile)) } });
      if (packChanged) {
        const old = await configDescriptor(previous.path), next = await configDescriptor(configFile);
        const oldBinding = await readFile(await regular(previousConfig.dataDir+'.dataset.json'));
        const transition = {...request.packTransition,schemaVersion:request.packTransition.schemaVersion??1,oldConfig:old.pin,newConfig:next.pin,oldBindingBase64:oldBinding.toString('base64'),newBindingBase64:bindingBytes(request.packTransition.new).toString('base64')};
        transition.compatibility = await checkPackTransition({fromConfig:previous.path,toConfig:configFile,transition});
        await save(path.join(release,'pack-transition.json'),transition);
      } else if (request.packTransition) throw new Error('Transition declared without changed pack inputs.');
      const identity = await candidateIdentity(kit, release, false);
      const manifest = { schemaVersion: 2, releaseId, revision, base, repo, pairedInput:{core:revision,privateCommit:(await json(path.join(kit,'kit.json'))).privateCommit??null,privateExportHash:(await json(path.join(kit,'kit.json'))).privateExportHash??null,packs:selection,profile:receipt.profile.sha256,gatePolicy:gatePolicyDigest}, createdAt: new Date().toISOString(), previousConfig: { path: previous.path, sha256: sha(previous.bytes) }, previousRelease, packUpgrade:packChanged, identity, lane: 'full', timings };
      if(options['legacy-rollback']) manifest.rollbackRelease = await timed(timings,'snapshot-accepted-rollback',() => stageLegacyRollback({kit,repo,revision:base,previousConfigPath:previous.path,privateFiles:receipt.privateFiles,packs:selection,exportCore,captureIdentity:candidateIdentity}));
      if (manifest.previousRelease) {
        const previousManifest = await json(path.join(manifest.previousRelease, 'release.json'));
        await assertCandidate(path.resolve(manifest.previousRelease,'../..'), manifest.previousRelease, previousManifest,true,true);
        if (sha(await readFile(path.join(manifest.previousRelease, 'config.json'))) !== manifest.previousConfig.sha256 || path.resolve(manifest.previousConfig.path) !== path.join(manifest.previousRelease, 'config.json')) throw new Error('Previous release does not identify running config.');
        const digest = (value, name) => value.components.find(c => c.name === name).digest;
        try {
          if(manifest.packUpgrade) throw new Error('Changed packs require fresh full and packed-runtime gates.');
          if(!['full','text'].includes(previousManifest.lane)||!await exists(path.join(manifest.previousRelease,'release-gate/accepted.json')))throw new Error('Text baseline has no accepted gates.');
          await assertGateEvidence(path.resolve(manifest.previousRelease,'../..'),manifest.previousRelease,previousManifest,true);
          manifest.textProof = await verifyTextDelta({ previousAddon: path.join(manifest.previousRelease, 'addons/addon.json'), candidateAddon: receipt.addons.path,
            previousProfile: (await json(path.join(manifest.previousRelease, 'companion.json'))).profile.sha256, candidateProfile: receipt.profile.sha256,
            previousCoreDigest: digest(previousManifest.identity, 'core'), candidateCoreDigest: digest(identity, 'core'),
            previousInfrastructureDigest: digestValue(previousManifest.identity.components.filter(c => ['privateSource', 'tools', 'operator', 'kit', 'corpus', 'nodeExecutable'].includes(c.name))), candidateInfrastructureDigest: digestValue(identity.components.filter(c => ['privateSource', 'tools', 'operator', 'kit', 'corpus', 'nodeExecutable'].includes(c.name))),
            previousPacksDigest: digest(previousManifest.identity, 'packs'), candidatePacksDigest: digest(identity, 'packs') });
          manifest.lane = 'text';
        } catch { manifest.lane = 'full'; }
      }
      await save(path.join(release, 'release-plan.json'), Object.fromEntries(['schemaVersion', 'releaseId', 'revision', 'base', 'repo', 'pairedInput', 'previousConfig', 'previousRelease', 'lane','packUpgrade'].map(key => [key, manifest[key]]).concat(manifest.textProof ? [['textProof', manifest.textProof]] : [],manifest.rollbackRelease ? [['rollbackRelease',manifest.rollbackRelease]] : [])));
      manifest.identity = await candidateIdentity(kit, release);
      await save(path.join(release, 'release.json'), manifest);
      await save(path.join(release, 'initial-current-pointer.json'), { schemaVersion: 2, releaseId: 'legacy-rel1', config: manifest.previousConfig });
      await timed(timings,'seal-prepared-payload',()=>sealPreparedPayload(kit,release,manifest));
      await writeFile(path.join(release,'.local/prepare-timings.json'),JSON.stringify({timings,...phaseSummary(timings)},null,2)+'\n');
      console.log('Release timing: '+JSON.stringify(phaseSummary(timings)));
      console.log(JSON.stringify({ prepared: true, releaseId, revision, lane: manifest.lane, timings })); return release;
    } catch (error) { await writeFile(path.join(release, '.local/prepare-failure.json'), JSON.stringify({ failed: true, cause: refusalCause(error), timings }, null, 2) + '\n'); throw error; }
  });
}
async function heavyOwner() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Heavy owner required.'); const owner = await json(path.join(directory, 'owner.json'));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy ownership changed.'); process.kill(Number(pid), 0);
}
async function lightOwner() {
  const directory=process.env.RS3_LIGHT_LOCK_PATH??'C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/locks/light.lock';
  const match=/^light pid=(\d+) \S+$/.exec((await readFile(path.join(directory,'owner'),'utf8')).replace(/^\uFEFF/,'').trim());
  if(!match||Number(match[1])!==process.ppid)throw new Error('Light owner required.');process.kill(Number(match[1]),0);
}
async function laneEvidence(kit, release, manifest, lane, inputIdentity, command, args, env, timings, assemblyDigest, cwd = path.join(release,'.local/assembly')) {
  const executionIdentity = await captureExecutionIdentity({ lane, command, args, cwd, env, policy, nodeExecutable: command });
  const key = deriveLaneKey({ inputIdentity, executionIdentity }), filename = path.join(lane==='public-full' ? path.join(kit,'release-gate/receipts') : path.join(release, 'release-gate'), lane + '-' + key + '.json');
  const expected = { key, inputDigest: inputIdentity.digest, executionDigest: executionIdentity.digest, ...(assemblyDigest ? { assemblyDigest } : {}) };
  const prior = await readSuccessReceipt(filename, expected);
  if (prior) { timings.push({ stage: lane, seconds: 0, reused: true, passed: true }); return { filename, record: prior, reused: true }; }
  const startedAt = new Date().toISOString();
  await timed(timings, lane, () => run(command, args, { cwd, env, log: path.join(release, '.local', lane + '.log') }));
  return { filename, record: { ...expected, exitCode: 0, cleanupVerified: true, startedAt } };
}
async function observeIdleIfRequested(options,action){return options['idle-state']?observeIdle(options['idle-state'],action):action();}
async function checkActivity(options={}) {
  if(options['idle-state'])await assertIdle(options['idle-state']);
}
export async function intake(kit,release,manifest) {
  let context;
  if (manifest.practice === true) {
    const receipt = await json(path.join(release, 'companion.json'));
    if (receipt.practiceInventory !== undefined) {
      if (manifest.releaseId !== 'practice-candidate') throw Error('Practice inventory release differs.');
      const { practiceInventoryCapability } = await import('./practice-inventory.mjs');
      context = { practiceInventory: await practiceInventoryCapability(receipt.practiceInventory.proof) };
    }
  }
  const result=await releasePreflight({objectOnly:true,core:manifest.repo,ref:manifest.revision,base:manifest.base,source:path.join(kit,'checks/private-source'),packs:path.join(release,'packs'),profile:path.join(release,'profile.json'),kit}, context);
  if (context && JSON.stringify(result.toleratedRegistrations) !== JSON.stringify((await json(path.join(release, 'companion.json'))).practiceInventory.tolerated)) throw Error('Practice inventory changed between preflight and gates.');
  await writeFile(path.join(release,'.local/preflight-latest.json'),JSON.stringify(result,null,2)+'\n');
  if(!result.passed){console.log(JSON.stringify(result));throw Error('Release preflight failed.');}
}
const component=(manifest,name)=>{const value=manifest.identity.components.find(c=>c.name===name);if(!value)throw Error('Missing input component.');return value.digest;};
export async function stableSpecs(kit,release,manifest,retained=null,options={}) {
  const config=await json(path.join(release,'config.json')),kitManifest=await json(path.join(kit,'kit.json'));
  const node=config.nodePath, env=await laneEnvironment(release,node,{RS3_TEST_CONCURRENCY:String(kitManifest.concurrency??6),RS3_TEST_RETRY_ONCE_IN_ISOLATION:options['retry-once-in-isolation']===true?'1':'0'});
  const common={coreSHA:manifest.revision,coreTree:component(manifest,'core')};
  const producer={orchestrator:await hashFile(path.join(kit,'tools/release-v2.mjs')),evidence:await hashFile(path.join(kit,'tools/release-evidence.mjs')),identity:await hashFile(path.join(kit,'tools/release-identity.mjs'))};
  const records=retained?Object.fromEntries([retained.history,retained.install,retained.gallery,retained.startup,retained.suites?.private,retained.suites?.public,retained.offlinePublic,retained.textEvidence].filter(r=>r?.contract).map(r=>[r.contract.lane,r.contract])):null;
  const spec=async(lane,inputs,wrapper,command=node,args=['scripts/test.mjs','full'],overrides={})=>{
    let wrapperHash;
    if(retained&&['public-full','private-full','gallery','copied-startup','text-contract'].includes(lane)){
      const part=manifest.identity.components.find(c=>c.name===(['gallery','copied-startup','text-contract'].includes(lane)?'lightWrapper':'heavyWrapper'));
      wrapperHash=part?.files?.[0]?.sha256;if(!wrapperHash)throw Error('Retained wrapper identity missing.');
    }else wrapperHash=await hashFile(wrapper);
    const execution=records?.[lane]?.execution??await stableExecution({lane,command,node,args,env:{...env,...overrides},kit,release});
    return gateContract(lane,{...inputs,producer,wrapper:wrapperHash},execution);
  };
  const heavy=retained?'retained-heavy':await lockScript(kit,'heavy'),light=retained?'retained-light':await lockScript(kit,'light');
  const runtime={...common,packs:component(manifest,'packs'),releasePacks:component(manifest,'releasePacks'),profile:component(manifest,'profile'),addon:component(manifest,'addon')};
  const scanner=(await hashTree(path.join(kit,'checks/private-source/scripts/public-export'))).digest;
  const result={node,env};
  result.history=await spec('public-scan',{...common,base:manifest.base,scanner,corpus:component(manifest,'corpus')},path.join(kit,'tools/public-core-gate.mjs'),node,['public-history',manifest.base,manifest.revision]);
  result.public=await spec('public-full',common,heavy,node,['scripts/test.mjs','full'],{RS3_DATASET:'open-f2p'});
  result.private=await spec('private-full',{...runtime,privateExport:component(manifest,'privateSource'),text:component(manifest,'text'),assemblyRecipe:await hashFile(path.join(kit,'tools/companion-check.mjs'))},heavy,node,['scripts/test.mjs','full'],{RS3_GAME_DATA_DIR:path.join(release,'.local/assembly/.local/game-data'),RS3_MAP_ASSETS_DIR:path.join(release,'.local/assembly/.local/map-assets'),RS3_PUBLIC_BROWSER_SCREEN_HARNESS:path.join(release,'core/tests/browser-screen-harness.mjs')});
  result.install=await spec('verify-data',runtime,path.join(kit,'tools/verify-install.mjs'),node,['verify-install','packed']);
  result.gallery=await spec('gallery',{...runtime,runner:await hashFile(path.join(kit,'tools/gallery-check.mjs')),fixture:await hashFile(path.join(kit,'checks/private-source/tests/fixtures/original-sync/capture.json')),cdp:await hashFile(path.join(kit,'checks/private-source/scripts/perf/cdp.mjs')),checker:await hashFile(path.join(kit,'tools/gallery-browser-check.mjs')),browser:retained?.gallery?.contract?.inputs?.browser??await hashFile(kitManifest.browser?.path??'C:/Program Files/Google/Chrome/Application/chrome.exe')},light,ps,['gallery','plain-and-framed']);
  result.startup=await spec('copied-startup',{...runtime,runner:await hashFile(path.join(kit,'tools/release-early.mjs'))},light,node,['startup','copied-synthetic-save']);
  if(manifest.lane==='text')result.text=await spec('text-contract',{...runtime,privateExport:component(manifest,'privateSource'),textProof:manifest.textProof,candidateInput:manifest.identity.digest},light,node,['text-tests-and-endpoint']);
  return result;
}
export function evidenceDirectory(kit,options={}){
  // Production kits are private/releases/<kit>. Scratch kits retain an isolated
  // sibling store; neither fixture nor practice defaults can write production.
  return path.resolve(options['evidence-dir']??defaultEvidenceDirectory(kit));
}
/** Receipt-only consumer: no admission, assembly, candidate/store writes or
 * lifecycle calls. Uses exactly the fullWorker execution and lane contract. */
export async function inspectFullLaneReuse({kit,release,directory=evidenceDirectory(kit),lanes=['public-full','private-full'],node,retryOnceInIsolation=false}){
  node??=await json(path.join(release,'config.json')).then(config=>config.nodePath).catch(error=>{if(error.code!=='ENOENT')throw error;return process.execPath;});
  const kitManifest=await json(path.join(kit,'kit.json'));
  const env=await laneEnvironment(release,node,{RS3_TEST_CONCURRENCY:String(kitManifest.concurrency??6),RS3_TEST_RETRY_ONCE_IN_ISOLATION:retryOnceInIsolation?'1':'0'});
  const results={};
  for(const lane of lanes){
    const overrides=lane==='public-full'?{RS3_DATASET:'open-f2p'}:{RS3_GAME_DATA_DIR:path.join(release,'.local/assembly/.local/game-data'),RS3_MAP_ASSETS_DIR:path.join(release,'.local/assembly/.local/map-assets'),RS3_PUBLIC_BROWSER_SCREEN_HARNESS:path.join(release,'core/tests/browser-screen-harness.mjs')};
    const execution=await stableExecution({lane,command:node,node,args:['scripts/test.mjs','full'],env:{...env,...overrides},kit,release});
    let contract=await planLaneEvidence({kit,release,lane,execution});
    let {item,reason}=await lookupLaneEvidence(directory,contract),plans;
    if(item?.record.status==='passed')plans=item.record.files.map(file=>file.plan);
    else{
      plans=await planLane({kit,release,lane,execution});
      contract=await planLaneEvidence({kit,release,lane,execution,plans});
      ({item,reason}=await lookupLaneEvidence(directory,contract));
    }
    const reused=item?.record.files.filter(file=>file.passed).map(file=>({file:file.file,sourceRunId:file.runId}))??[];
    for(const plan of plans)if(!reused.some(file=>file.file===plan.file)){
      const pass=await readFilePass(path.join(directory,'files'),plan);
      if(pass)reused.push({file:plan.file,sourceRunId:pass.record.runId});
    }
    results[lane]={accepted:item?.record.status==='passed',key:contract.key,fresh:plans.length-reused.length,reused:reused.length,sourceRunIds:[...new Set(reused.map(file=>file.sourceRunId))],files:plans.map(plan=>reused.find(file=>file.file===plan.file)?{...reused.find(file=>file.file===plan.file),disposition:'reused'}:{file:plan.file,disposition:'fresh',reason:reason??'previous-file-failure'})};
  }
  return {readOnly:true,evidenceDirectory:directory,lanes:results};
}
async function useGate({kit,release,options,contract,timings,action}) {
  const directory=evidenceDirectory(kit,options);
  let item=await lookupEvidence(directory,contract);
  if(item){timings.push({stage:contract.lane,seconds:0,reused:true,passed:true});return localEvidence(item,path.join(release,'release-gate'));}
  await checkActivity(options);
  const startedAt=new Date().toISOString();
  const scratchRoots=['lane-home','lane-temp','compile-cache'].map(name=>path.join(release,'.local',name));
  // Real children get empty, owned config/temp roots. Receipt lookup and retained
  // identity checks perform no scratch writes. A crash leaves a refused root.
  for(const root of scratchRoots)if(await exists(root))throw Error('Retained execution scratch requires inspection.');
  let observation;
  try{
    for(const root of scratchRoots)await mkdir(root);
    // Windows known-folder lookup must succeed before Chrome enables scratch CDP.
    // Keep both folders inside the owned isolated home; no native home is adopted.
    if(process.platform==='win32')for(const name of ['Local','Roaming'])await mkdir(path.join(scratchRoots[0],'AppData',name),{recursive:true});
    observation=options['idle-state']?await observeIdle(options['idle-state'],()=>timed(timings,contract.lane,action)):await timed(timings,contract.lane,action);
  }finally{for(const root of scratchRoots)if(await exists(root))await safeRemove(path.join(release,'.local'),root);}
  await checkActivity(options);
  const manifest=await json(path.join(release,'release.json'));await assertCandidate(kit,release,manifest);
  const postSpecs=await stableSpecs(kit,release,manifest,null,options);
  const post=Object.values(postSpecs).find(value=>value?.lane===contract.lane);
  if(!post||digestValue(post)!==digestValue(contract))throw Error('Gate execution inputs changed during verification.');
  item=await publishEvidence(directory,contract,{startedAt,assemblyDigest:observation?.assemblyDigest});
  return localEvidence(item,path.join(release,'release-gate'));
}
function hostedIdentity(record){return {source:record.source,policy:record.policy,publicInventory:record.publicInventory,requiredJobs:record.requiredJobs};}
function hostedArgs(options){
  const ref=options['public-ci-ref'],run=options['public-ci-run-id'],attempt=options['public-ci-attempt'];
  if(!ref){if(run||attempt)throw Error('Hosted ref required.');return [];}
  if(!/^refs\/heads\/(?:main|checked-candidate\/[a-z0-9][a-z0-9._-]{0,79})$/.test(ref)||[run,attempt].some(v=>v!==undefined&&!/^[1-9][0-9]*$/.test(String(v))))throw Error('Hosted selection refused.');
  return ['--ref',ref,...(run?['--run-id',String(run)]:[]),...(attempt?['--attempt',String(attempt)]:[])];
}
async function hostedPublicEvidence(kit,release,manifest,options){
  const args=hostedArgs(options);if(!args.length)throw Error('Hosted selection missing.');
  const node=(await json(path.join(release,'config.json'))).nodePath;
  let observation;
  try{observation=JSON.parse(execFileSync(node,[path.join(kit,'tools/verify-github-evidence.mjs'),'--sha',manifest.revision,...args],{cwd:kit,env:sanitizeExecutionEnvironment(),windowsHide:true,timeout:120000,maxBuffer:4*1024**2,stdio:['ignore','pipe','pipe']}).toString());}catch{throw Error('Fresh hosted public evidence unavailable.');}
  const tree=execFileSync('git',['--no-optional-locks','-C',manifest.repo,'rev-parse','--verify',manifest.revision+'^{tree}'],{windowsHide:true,encoding:'utf8'}).trim();
  if(observation.schema!=='rs3-hosted-public-v1'||observation.verified!==true||observation.source?.headSha!==manifest.revision||observation.source?.treeSha!==tree||observation.source?.event!=='push'||observation.source?.branch!==options['public-ci-ref']||observation.provenance?.fresh!==true)throw Error('Hosted verifier contract refused.');
  return {kind:'github-hosted-public',record:observation};
}
/** Phase B (--neutral-ci): the neutral private files a fresh, verified Actions run
 * stands in for. The PC computes the key and file list from the release's own inputs.
 * Running: fresh/ranHere pick the remote files under the ledger witness rule.
 * Verifying: remote must still be eligible and every ledger module it relies on must
 * sit in the closure of a file that ran on the PC in this release (ranHere). */
async function neutralSplit(kit,release,manifest,inventory,{at,fresh=[],ranHere=[],remote}={}){
  const {planNeutral,verifyNeutralEvidence}=await import('./neutral-evidence.mjs');
  const {selectRemote,unwitnessed}=await import('./neutral-lane.mjs');
  const base=files=>files.map(file=>path.basename(file));
  const companion=await json(path.join(release,'companion.json'));
  const plan=await planNeutral({core:path.join(release,'core'),privateSource:path.join(kit,'checks/private-source'),packsRoot:companion.packsDir,inventory:base(inventory)});
  if(!plan.files.length)return null;
  const receipt=await verifyNeutralEvidence({privateSha:manifest.pairedInput?.privateCommit,coreSha:manifest.revision,key:plan.key,files:plan.files,packs:plan.packs},Number.isFinite(at)?{now:at}:{});
  if(remote){
    if(base(remote).some(file=>!plan.files.includes(file)))throw Object.assign(Error('Neutral file no longer eligible.'),{code:'not-eligible'});
    const lapsed=unwitnessed({remote:base(remote),verdicts:plan.verdicts,pc:base(ranHere)});
    if(lapsed.length)throw Object.assign(Error('Ledger module without a PC witness: '+lapsed.join(', ')),{code:'no-pc-witness'});
    return {files:remote,receipt};
  }
  const pick=selectRemote({eligible:plan.files,verdicts:plan.verdicts,fresh:base(fresh),ranHere:base(ranHere)});
  if(pick.lapsed.length)console.error(JSON.stringify({warning:'Ledger entries without a PC witness do not apply this release; their dependents run here.',lapsed:pick.lapsed,back:pick.back}));
  return pick.files.length?{files:pick.files.map(file=>'tests/'+file),receipt}:null;
}
export async function executeFileSelection({kit,release,lane,files,specs,options={},expectedInventory}) {
  await heavyOwner();
  const assembly=path.join(release,lane==='public-full'?'.local/public-assembly':'.local/assembly');
  // lane-trace holds per-file traces; runAdaptive folds and removes each one.
  const roots=['lane-home','lane-temp','compile-cache','lane-trace'].map(name=>path.join(release,'.local',name));
  for(const root of [assembly,...roots])if(await exists(root))throw Error('Retained execution scratch requires inspection.');
  const controller=new AbortController();let timer,result;
  const abort=()=>controller.abort();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,abort);
  if(options['early-budget-ms'])timer=setTimeout(abort,Number(options['early-budget-ms']));
  try{
    for(const root of roots)await mkdir(root);
    for(const name of ['Local','Roaming'])await mkdir(path.join(roots[0],'AppData',name),{recursive:true});
    if(lane==='public-full'){
      await cp(path.join(release,'core'),assembly,{recursive:true,errorOnExist:true,force:false});
      if((await hashTree(assembly)).digest!==(await hashTree(path.join(release,'core'))).digest)throw Error('Public assembly changed.');
    }else await run(specs.node,[path.join(kit,'tools/companion-check.mjs'),'--core',path.join(release,'core'),'--receipt',path.join(release,'companion.json'),'--lane','prepare','--output',assembly],{cwd:kit,env:specs.env,log:path.join(release,'.local/assembly.log'),timeout:Number(options['early-budget-ms']??0)});
    const {discoverTests}=await import(pathToFileURL(path.join(assembly,'scripts/test-selection.mjs')));
    const inventory=await discoverTests(path.join(assembly,'tests'),'full');
    if(expectedInventory&&digestValue(inventory.map(file=>'tests/'+file).sort())!==digestValue([...expectedInventory].sort()))throw Error('Full assembly inventory differs from its input plan.');
    if(files.some(file=>!inventory.includes(path.basename(file))))throw Error('Selected file absent from classified full inventory.');
    const {runAdaptive}=await import(pathToFileURL(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs')));
    const ownerEnv=Object.fromEntries(['RS3_HEAVY_LOCK_PATH','RS3_HEAVY_LOCK_TOKEN','RS3_HEAVY_LOCK_PID'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    const env={...specs.env,...ownerEnv,...(lane==='private-full'?{RS3_GAME_DATA_DIR:path.join(assembly,'.local/game-data'),RS3_MAP_ASSETS_DIR:path.join(assembly,'.local/map-assets'),RS3_PUBLIC_BROWSER_SCREEN_HARNESS:path.join(release,'core/tests/browser-screen-harness.mjs')}:{RS3_DATASET:'open-f2p'})};
    const cap=Math.min(6,Number(specs.env.RS3_TEST_CONCURRENCY));
    await checkActivity(options);
    result=await observeIdleIfRequested(options,()=>runAdaptive({files,cwd:assembly,env,signal:controller.signal,minConcurrency:Math.min(2,cap),maxConcurrency:cap,traceRoot:roots[3],onFile:async result=>writeFile(path.join(release,'.local/'+lane+'.log'),JSON.stringify({file:result.file,passed:result.passed,processWallMs:result.processWallMs,fileWallMs:result.fileWallMs,bodyMs:result.bodyMs})+'\n',{flag:'a'})}));
  }finally{
    clearTimeout(timer);for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,abort);
    for(const root of [assembly,...roots])if(await exists(root))await safeRemove(path.join(release,'.local'),root);
  }
  if(options['retry-once-in-isolation']===true){
    const {retryFailedFilesOnce}=await import('./retry-failed-files.mjs');
    result=await retryFailedFilesOnce({result,enabled:true,runIsolated:files=>executeFileSelection({kit,release,lane,files,specs:{...specs,env:{...specs.env,RS3_TEST_CONCURRENCY:'1'}},options:{...options,'retry-once-in-isolation':false},expectedInventory}),onFlaky:async file=>{
      const notice={warning:'FLAKY: initial failure passed once in isolation',file:file.file,lane};
      console.error(JSON.stringify(notice));
      await writeFile(path.join(release,'.local/flaky-files.jsonl'),JSON.stringify(notice)+'\n',{flag:'a'});
    }});
  }
  return result;
}
export async function fullWorker(kit,release,options={}) {
  const manifest=await json(path.join(release,'release.json'));await assertCandidate(kit,release,manifest);await checkActivity(options);
  const specs=await stableSpecs(kit,release,manifest,null,options),timings=[],evidence={},directory=evidenceDirectory(kit,options),phase=options['early-phase'];
  let earned={};
  if(await exists(path.join(release,'.local/early-file-evidence.json'))){const prior=await json(path.join(release,'.local/early-file-evidence.json'));if(prior.runId===options['round-id'])earned=prior.lanes;}
  let priorFailures={};
  if(phase==='previous'){
    const snapshot=await json(path.join(release,'.local/previous-round-failures.json'));
    if(snapshot.roundId!==options['round-id'])throw Error('Previous-round snapshot changed.');priorFailures=snapshot.lanes;
  }
  const earlyErrors=[];
  for(const [name,lane] of [['public','public-full'],['private','private-full']]){
    if(options['private-only']&&name==='public')continue;
    if(!phase&&name==='public'&&await exists(path.join(release,'.local/hosted-public.json'))){evidence.public=await json(path.join(release,'.local/hosted-public.json'));continue;}
    const only=phase==='pipeline'?(name==='private'?pipelineTests.map(f=>'tests/'+f):[]):phase==='previous'?(priorFailures[lane]??[]).filter(f=>name!=='private'||!pipelineTests.includes(path.basename(f))):undefined;
    if(only&&!only.length)continue;
    try{
      // A refused import never fails the release: every private file then runs here.
      const neutral=name==='private'&&!phase&&options['neutral-ci']?async (plans,due)=>{try{return await neutralSplit(kit,release,manifest,plans.map(plan=>plan.file),due);}catch(error){console.error(JSON.stringify({warning:'Neutral CI evidence refused; every private file runs here.',reason:error.code??error.message}));return null;}}:null;
      evidence[name]=await runFileLane({kit,release,manifest,lane,execution:specs[name].execution,contract:specs[name],directory,timings,only,neutral,phase:phase??'full',lookupOnly:!!options['lookup-only'],force:phase==='previous',runId:options['round-id'],earned:earned[name]??[],execute:(files,{inventory})=>{if(options['lookup-only'])throw Object.assign(Error('Fresh file execution requires admission.'),{needsAdmission:true});return executeFileSelection({kit,release,lane,files,specs,options,expectedInventory:inventory});}});
      if(phase)earned[name]=[...(earned[name]??[]),...evidence[name].files];
    }catch(error){if(phase)earlyErrors.push(error);else{await writeFile(path.join(release,'.local/full-timings.json'),JSON.stringify(timings,null,2)+'\n');throw error;}}
  }
  await assertCandidate(kit,release,manifest);
  await writeFile(path.join(release,'.local/full-timings.json'),JSON.stringify(timings,null,2)+'\n');
  if(phase)await writeFile(path.join(release,'.local/early-file-evidence.json'),JSON.stringify({runId:options['round-id'],lanes:earned})+'\n');
  else await writeFile(path.join(release,'.local/full-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  if(earlyErrors.length)throw Object.assign(Error(earlyErrors.map(e=>e.message).join('; ')),{needsAdmission:earlyErrors.every(e=>e.needsAdmission)});
}
async function runtimeExecution(kit, release) {
  return captureExecutionIdentity({ lane: 'gate-platform', command: (await json(path.join(release, 'config.json'))).nodePath, args: ['release-v2-policy'], cwd: kit, env: sanitizeExecutionEnvironment(), policy });
}
async function matchesRecordedReceipt(filename, expected) {
  const actual = await readSuccessReceipt(filename, expected);
  // Older gates record the successful observations supplied before publication;
  // newer gates retain the entire final receipt. Validate every recorded field.
  return !!actual && Object.entries(expected).every(([key,value]) => digestValue(actual[key]) === digestValue(value));
}
async function assertGateEvidence(kit, release, manifest, retained = false) {
  if(manifest.lane==='adopted') {
    const marker=await json(path.join(release,'release-gate/adopted.json'));
    if(marker.kind!=='accepted-running-migration'||marker.inputDigest!==manifest.identity.digest||digestValue(marker.migration)!==digestValue(manifest.migration)) throw new Error('Adopted rollback evidence changed.');
    return marker;
  }
  const retainedGates=await json(path.join(release,'release-gate/gates.json'));
  if(retained&&(!retainedGates.relloop||retainedGates.gatePolicy!==gatePolicyDigest)){
    // Old accepted releases keep their original validator and policy. Requiring
    // today's additional receipts would make a valid rollback root unusable.
    const accepted=await json(path.join(release,'release-gate/accepted.json'));
    const frozen=path.join(kit,'tools/release-v2.mjs');
    const expected=manifest.identity.components.find(c=>c.name==='tools')?.files.find(f=>f.path==='release-v2.mjs')?.sha256;
    if(accepted.inputDigest!==manifest.identity.digest||!expected||await hashFile(frozen)!==expected||expected===await hashFile(here)||(await hashTree(path.join(kit,'tools'))).digest!==manifest.identity.components.find(c=>c.name==='tools')?.digest)throw Error('Retained validator identity refused.');
    const node=(await json(path.join(release,'config.json'))).nodePath;
    try{execFileSync(node,[frozen,'assert-identity','--kit',kit,'--release',release,'--rollback'],{env:sanitizeExecutionEnvironment(),windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe'],maxBuffer:65536});}catch{throw Error('Retained frozen gate validator refused.');}
    return retainedGates;
  }
  const gates = await json(path.join(release, 'release-gate/gates.json'));
  if(gates.relnext===true)return assertStableGates(kit,release,manifest,gates,retained);
  if (gates.passed !== true || gates.inputDigest !== manifest.identity.digest || gates.lane !== manifest.lane || !/^[a-f0-9]{64}$/.test(gates.executionDigest) || !retained && gates.executionDigest !== (await runtimeExecution(kit, release)).digest) throw new Error('Gate evidence changed.');
  if (retained) {
    const accepted = await json(path.join(release, 'release-gate/accepted.json'));
    if (accepted.inputDigest !== manifest.identity.digest) throw new Error('Retained acceptance identity changed.');
  }
  if (manifest.lane === 'full') for (const lane of ['public', 'private']) {
    const item = gates.suites?.[lane]; if (!item || !(inside(path.join(release, 'release-gate'), item.filename)||lane==='public'&&inside(path.join(kit,'release-gate/receipts'),item.filename)) || !await matchesRecordedReceipt(item.filename, item.record)) throw new Error('Exact suite evidence missing.');
  }
  const gallery = gates.gallery;
  if (!gallery || !inside(path.join(release, 'release-gate'), gallery.filename) || !await matchesRecordedReceipt(gallery.filename, gallery.record)) throw new Error('Gallery evidence missing.');
  if(manifest.lane==='text') {
    const proof=await json(path.join(release,'release-gate/text-gate.json'));
    if(proof.inputDigest!==manifest.identity.digest||proof.passed!==true||proof.cleanupVerified!==true||proof.endpointSha256!==sha(await readFile(path.join(release,'release-gate/text-endpoint.json')))||proof.testsSha256!==sha(await readFile(path.join(release,'.local/narrow-tests.log'))))throw new Error('Text evidence missing or changed.');
  }
  return gates;
}
async function textGates(kit, release, manifest, timings) {
  if (!manifest.previousRelease || !manifest.textProof) throw new Error('Text proof absent.');
  const previous = await json(path.join(manifest.previousRelease, 'release.json'));
  await assertCandidate(kit, manifest.previousRelease, previous,true,true);
  if (!await exists(path.join(manifest.previousRelease, 'release-gate/accepted.json'))) throw new Error('Text lane requires an accepted running release.');
  const oldGates = await assertGateEvidence(kit, manifest.previousRelease, previous,true);
  if (oldGates.inputDigest !== previous.identity.digest || oldGates.passed !== true) throw new Error('Previous gates do not match.');
  const assembly = path.join(release, '.local/assembly'), node = (await json(path.join(release, 'config.json'))).nodePath;
  if (await exists(assembly)) throw new Error('Retained assembly requires inspection.');
  try {
    await timed(timings, 'assemble-text', () => run(node, [path.join(kit, 'tools/companion-check.mjs'), '--core', path.join(release, 'core'), '--receipt', path.join(release, 'companion.json'), '--lane', 'prepare-text', '--output', assembly], { cwd: kit, log: path.join(release, '.local/text.log') }));
    await timed(timings, 'text-checks', async () => run(ps, ['-NoProfile', '-File', await lockScript(kit,'light'), node,path.join(kit,'tools/release-v2.mjs'),'text-tests-worker','--kit',kit,'--release',release], { cwd: kit, log: path.join(release, '.local/text.log') }));
    await timed(timings, 'text-endpoint', async () => run(ps, ['-NoProfile', '-File', await lockScript(kit,'light'), node, path.join(kit, 'tools/release-v2.mjs'), 'text-endpoint-worker', '--kit', kit, '--release', release], { cwd: kit, log: path.join(release, '.local/text-endpoint.log') }));
  } finally { if (await exists(assembly)) await safeRemove(path.join(release, '.local'), assembly); }
  await writeFile(path.join(release,'release-gate/text-gate.json'),JSON.stringify({inputDigest:manifest.identity.digest,passed:true,cleanupVerified:true,endpointSha256:sha(await readFile(path.join(release,'release-gate/text-endpoint.json'))),testsSha256:sha(await readFile(path.join(release,'.local/narrow-tests.log')))} )+'\n');
}
async function assertStableGates(kit,release,manifest,gates,retained=false){
  if(!retained&&await exists(path.join(release,'release-gate/gates-pending.json')))throw Error('The latest gate round is incomplete or failed.');
  if(gates.passed!==true||gates.inputDigest!==manifest.identity.digest||gates.lane!==manifest.lane||gates.gatePolicy!==gatePolicyDigest)throw Error('Gate evidence changed.');
  const specs=await stableSpecs(kit,release,manifest,retained?gates:null,{'retry-once-in-isolation':(await import('./retry-policy.mjs')).resolveRetryPolicy({retryOnceInIsolation:gates.flakeRetryEnabled})});
  for(const [name,contract] of [['history',specs.history],['install',specs.install],['gallery',specs.gallery],['startup',specs.startup],...(manifest.lane==='full'?[['private',specs.private]]:[])]){
    const item=gates[name]??gates.suites?.[name];if(!item||!inside(path.join(release,'release-gate'),item.filename))throw Error('Gate evidence containment refused.');
    await verifyLocalEvidence(item,contract,{retained});
  }
  if(gates.early?.passed!==true)throw Error('Early checks required.');
  if(manifest.lane==='full'){
    const item=gates.suites?.public;
    if(item?.kind==='github-hosted-public'&&retained&&gates.offlinePublic){await verifyLocalEvidence(gates.offlinePublic,specs.public,{retained:true});await verifyFileLane({kit,release,lane:'public-full',execution:specs.public.execution,item:gates.offlinePublic,retained:true});}
    else if(item?.kind==='github-hosted-public'){
      // Retained hosted authority also needs a fresh read. An offline rollback
      // target must have local public-full evidence prepared before acceptance.
      const source=item.record?.source;
      const fresh=await hostedPublicEvidence(kit,release,manifest,{'public-ci-ref':source?.branch,'public-ci-run-id':source?.runId,'public-ci-attempt':source?.attempt});
      if(digestValue(hostedIdentity(fresh.record))!==digestValue(hostedIdentity(item.record)))throw Error('Hosted identity changed.');
    }else{if(!inside(path.join(release,'release-gate'),item?.filename??''))throw Error('Public evidence containment refused.');await verifyLocalEvidence(item,specs.public,{retained});await verifyFileLane({kit,release,lane:'public-full',execution:specs.public.execution,item,retained});}
    // A split lane re-reads its Actions run now; a retained root measures run age at acceptance.
    await verifyFileLane({kit,release,lane:'private-full',execution:specs.private.execution,item:gates.suites.private,retained,verifyNeutral:(neutral,{inventory,ranHere})=>neutralSplit(kit,release,manifest,inventory,{at:retained?Date.parse(neutral.receipt?.verifiedAt):undefined,remote:neutral.files,ranHere})});
  }else{
    if(!gates.textEvidence)throw Error('Text receipt missing.');await verifyLocalEvidence(gates.textEvidence,specs.text,{retained});
    const proof=await json(path.join(release,'release-gate/text-gate.json'));
    if(proof.inputDigest!==manifest.identity.digest||proof.passed!==true||proof.cleanupVerified!==true||proof.endpointSha256!==sha(await readFile(path.join(release,'release-gate/text-endpoint.json')))||proof.testsSha256!==sha(await readFile(path.join(release,'.local/narrow-tests.log'))))throw Error('Text evidence missing.');
  }
  if(retained&&(await json(path.join(release,'release-gate/accepted.json'))).inputDigest!==manifest.identity.digest)throw Error('Retained acceptance changed.');
  return gates;
}
export async function releaseCandidate(options) {
  const kit=path.resolve(options.kit??defaultKit),release=path.resolve(options.release??'');
  let attemptTimings=[];
  // Pass this module's own functions: practice re-importing the running entry module never settles under top-level await.
  if(options.practice){const {practiceRelease}=await import('./release-practice.mjs');return practiceRelease(options,{candidateIdentity,gates:releaseCandidate});}
  if(!options['gates-only']){
    // Activation consumes a checked freeze; it never starts a fresh gate lane.
    return promoteCandidate(options);
  }
  return lease(kit,async()=>{
    const manifest=await json(path.join(release,'release.json')),timings=[],roundId=randomUUID(),gateStarted=Date.now();
    attemptTimings=timings;
    if(!['full','text'].includes(manifest.lane))throw Error('Adopted roots are rollback targets only.');
    await assertCandidate(kit,release,manifest);await verifyPrevious(manifest,options.current);
    await writeFile(path.join(release,'release-gate/gates-pending.json'),JSON.stringify({startedAt:new Date().toISOString(),inputDigest:manifest.identity.digest,roundId})+'\n');
    await writeFile(path.join(release,'release-gate/latest-attempt.json'),JSON.stringify({passed:false,pending:true,inputDigest:manifest.identity.digest,roundId,startedAt:new Date().toISOString()})+'\n');
    await intake(kit,release,manifest);
    if(options.expectedGatePolicySha256&&options.expectedGatePolicySha256!==gatePolicyDigest)throw Error('Gate policy differs.');
    const specs=await stableSpecs(kit,release,manifest,null,options),node=specs.node;
    await writeFile(path.join(release,'.local/previous-round-failures.json'),JSON.stringify({roundId,lanes:await previousFailures(evidenceDirectory(kit,options),manifest)})+'\n');
    hostedArgs(options);
    let gallery,startup,early;
    const earlyWorker=async(phase,budget)=>{
      const args=['--kit',kit,'--release',release,'--evidence-dir',evidenceDirectory(kit,options),'--early-phase',phase,'--round-id',roundId,'--early-budget-ms',String(Math.max(1,budget)),(await import('./retry-policy.mjs')).resolveRetryPolicy({retryOnceInIsolation:specs.env.RS3_TEST_RETRY_ONCE_IN_ISOLATION==='1'})?'--retry-once-in-isolation':'--no-retry-once-in-isolation',...(options['idle-state']?['--idle-state',options['idle-state']]:[])];
      let failure;
      try{await fullWorker(kit,release,{...options,'early-phase':phase,'round-id':roundId,'early-budget-ms':String(Math.max(1,budget)),'lookup-only':true});}
      catch(error){if(!error.needsAdmission)failure=error;else try{await run(ps,['-NoProfile','-File',await lockScript(kit,'heavy'),node,path.join(kit,'tools/release-v2.mjs'),'gates-worker',...args],{cwd:kit,log:path.join(release,'.local/early-'+phase+'.log')});}catch(error){failure=error;}}
      const observed=await exists(path.join(release,'.local/full-timings.json'))?await json(path.join(release,'.local/full-timings.json')):[];
      timings.push(...observed);
      if(failure){const files=observed.flatMap(row=>row.failures??[]);throw Error('Early '+phase+' failed: '+(files.length?files.join(', '):failure.message));}
    };
    try{
      early=await orderedEarly({
        gallery:async budget=>{const args=['-NoProfile','-File',await lockScript(kit,'light'),node,path.join(kit,'tools/gallery-check.mjs'),'--core',path.join(release,'core'),'--receipt',path.join(release,'companion.json'),'--checker',path.join(kit,'tools/gallery-browser-check.mjs')];gallery=await useGate({kit,release,options,contract:specs.gallery,timings,action:()=>run(ps,args,{cwd:kit,env:specs.env,log:path.join(release,'.local/gallery.log'),timeout:budget})});},
        startup:async budget=>{const wrapper=await lockScript(kit,'light');startup=await useGate({kit,release,options,contract:specs.startup,timings,action:()=>run(ps,['-NoProfile','-File',wrapper,node,path.join(kit,'tools/release-early.mjs'),'startup','--core',path.join(release,'core'),'--receipt',path.join(release,'companion.json'),'--scratch',path.join(release,'.local/copied-startup')],{cwd:kit,env:specs.env,log:path.join(release,'.local/startup.log'),timeout:budget})});},
        pipeline:budget=>earlyWorker('pipeline',budget),previous:budget=>earlyWorker('previous',budget)
      });
    }catch(error){await writeFile(path.join(release,'release-gate/early.json'),JSON.stringify(error.earlyResult??{passed:false})+'\n');throw error;}
    await writeFile(path.join(release,'release-gate/early.json'),JSON.stringify(early)+'\n');
    const history=await useGate({kit,release,options,contract:specs.history,timings,action:()=>scanPublicCandidate({repo:manifest.repo,revision:manifest.revision,base:manifest.base,output:path.join(release,'release-gate/public-history-scan.json'),kitRoot:kit})});
    const install=await useGate({kit,release,options,contract:specs.install,timings,action:()=>run(node,[path.join(kit,'tools/verify-install.mjs'),'--core',path.join(release,'core'),'--companion',kit,'--receipt',path.join(release,'companion.json')],{cwd:kit,env:specs.env,log:path.join(release,'.local/verify-data.log')})});
    let textEvidence=null;
    if(manifest.lane==='text')textEvidence=await useGate({kit,release,options:{...options,'evidence-dir':path.join(release,'release-gate/text-receipts')},contract:specs.text,timings,action:()=>textGates(kit,release,manifest,timings)});
    else{
      let hosted=null;
      if(hostedArgs(options).length){
        try{hosted=await hostedPublicEvidence(kit,release,manifest,options);}
        catch(error){if(!options['public-ci-local-fallback'])throw error;timings.push({stage:'public-ci',fallback:'explicit-local-public-full',reason:'hosted-unavailable-or-refused'});}
      }
      const hostedFile=path.join(release,'.local/hosted-public.json');
      if(await exists(hostedFile))await unlink(hostedFile);
      if(hosted)await writeFile(hostedFile,JSON.stringify(hosted)+'\n');
      const directory=evidenceDirectory(kit,options);
      {
        await checkActivity(options);
        const workerArgs=['--kit',kit,'--release',release,'--evidence-dir',directory,'--round-id',roundId,(await import('./retry-policy.mjs')).resolveRetryPolicy({retryOnceInIsolation:specs.env.RS3_TEST_RETRY_ONCE_IN_ISOLATION==='1'})?'--retry-once-in-isolation':'--no-retry-once-in-isolation',...(options['idle-state']?['--idle-state',options['idle-state']]:[]),...(options['neutral-ci']?['--neutral-ci']:[])];
        try{await fullWorker(kit,release,{...options,'round-id':roundId,'lookup-only':true});}
        catch(error){if(!error.needsAdmission)throw error;const heavy=await lockScript(kit,'heavy');await timed(timings,'heavy-hold',()=>observeIdleIfRequested(options,()=>run(ps,['-NoProfile','-File',heavy,node,path.join(kit,'tools/release-v2.mjs'),'gates-worker',...workerArgs],{cwd:kit,log:path.join(release,'.local/heavy-worker.log')})));}
        timings.push(...await json(path.join(release,'.local/full-timings.json')));
      }
    }
    await assertCandidate(kit,release,manifest);await verifyPrevious(manifest,options.current);await checkActivity(options);
    const completedSuites=manifest.lane==='full'?await json(path.join(release,'.local/full-evidence.json')):null;
    const offlinePublic=completedSuites?.public?.fileSchema==='rs3-test-file-pass-v1'?completedSuites.public:null;
    const gateClock={...phaseSummary(timings),startedAt:new Date(gateStarted).toISOString(),completedAt:new Date().toISOString(),totalSeconds:(Date.now()-gateStarted)/1000};
    const gates={schemaVersion:2,relnext:true,relloop:true,flakeRetryEnabled:options['retry-once-in-isolation']===true,offlinePublic,textEvidence,passed:true,inputDigest:manifest.identity.digest,lane:manifest.lane,gatePolicy:gatePolicyDigest,suites:completedSuites,history,install,gallery,startup,early,completedAt:new Date().toISOString(),timings};
    gates.phaseClock=gateClock;
    await writeFile(path.join(release,'release-gate/gates.json'),JSON.stringify(gates,null,2)+'\n');
    await writeFile(path.join(release,'release-gate/latest-attempt.json'),JSON.stringify({passed:true,pending:false,inputDigest:gates.inputDigest,roundId,completedAt:gates.completedAt,flakeRetryEnabled:gates.flakeRetryEnabled,timings},null,2)+'\n');
    const {writeReleaseLaneReport}=await import('./release-lane-status.mjs');
    await writeReleaseLaneReport(release,gates);
    await writeFile(path.join(release,'.local/timings.json'),JSON.stringify(timings,null,2)+'\n');
    await unlink(path.join(release,'release-gate/gates-pending.json'));
    console.log(JSON.stringify({gatesPassed:true,stoppedBeforeLifecycle:true,timings,...gateClock}));
  }).catch(async error=>{
    // A failed latest round must not leave the human report displaying an old
    // success. Keep the previous sealed gate bytes and its pending barrier.
    try{
      const pending=await json(path.join(release,'release-gate/gates-pending.json'));
      const latest=await json(path.join(release,'.local/full-timings.json')).catch(()=>[]);
      const rows=[...attemptTimings];
      for(const row of latest)if(row.runId===pending.roundId&&!rows.some(prior=>prior.runId===row.runId&&prior.stage===row.stage))rows.push(row);
      const failed={passed:false,pending:true,inputDigest:pending.inputDigest,flakeRetryEnabled:options['retry-once-in-isolation']===true,timings:rows,reason:refusalCause(error),updatedAt:new Date().toISOString()};
      await writeFile(path.join(release,'release-gate/latest-attempt.json'),JSON.stringify(failed,null,2)+'\n');
      const {writeReleaseLaneReport}=await import('./release-lane-status.mjs');await writeReleaseLaneReport(release,failed);
    }catch{}
    throw error;
  });
}
// Match candidateIdentity's explicit roots. Mutable storage is intentionally
// absent; its ownership, binding and compatibility are checked at activation.
async function frozenInputs(kit,release,manifest,{retained=false}={}) {
  const config=await json(path.join(release,'config.json')), receipt=await json(path.join(release,'companion.json'));
  const trees=[path.join(release,'core'),path.join(kit,'checks/private-source'),path.join(kit,'tools'),path.join(kit,'operator'),path.join(kit,'packs'),path.join(release,'addons'),path.join(release,'text'),config.packsDir,path.join(kit,'release-gate/corpus')];
  if(receipt.packsDir)trees.push(receipt.packsDir);
  const files=['profile.json','companion.json','config.json','pointer.json','request.json','release-plan.json','release.json'].map(name=>path.join(release,name));
  files.push(config.nodePath,config.publicOriginFile,path.join(kit,'kit.json'));
  if(!retained)for(const lane of ['heavy','light'])files.push(await lockScript(kit,lane));
  if(await exists(path.join(release,'pack-transition.json')))files.push(path.join(release,'pack-transition.json'));
  const roots={core:path.join(release,'core'),privateSource:path.join(kit,'checks/private-source'),tools:path.join(kit,'tools'),operator:path.join(kit,'operator'),packs:path.join(kit,'packs'),releasePacks:receipt.packsDir,packTransition:path.join(release,'pack-transition.json'),addon:path.join(release,'addons'),text:path.join(release,'text'),profile:path.join(release,'profile.json'),receipt:path.join(release,'companion.json'),config:path.join(release,'config.json'),pointer:path.join(release,'pointer.json'),request:path.join(release,'request.json'),nodeExecutable:config.nodePath,runtimeOrigin:config.publicOriginFile,runtimePacks:config.packsDir,kit:path.join(kit,'kit.json'),corpus:path.join(kit,'release-gate/corpus'),plan:path.join(release,'release-plan.json')};
  if(!retained)for(const lane of ['heavy','light'])roots[lane+'Wrapper']=await lockScript(kit,lane);
  const expectedFiles=manifest.identity.components.flatMap(component=>{
    const root=roots[component.name];if(!root){if(retained&&['heavyWrapper','lightWrapper'].includes(component.name))return [];throw Error('Unknown frozen identity component.');}
    return component.files.map(file=>({path:component.kind==='file'?root:path.join(root,file.path),sha256:file.sha256}));
  });
  const expectedDirectories=manifest.identity.components.filter(c=>c.kind==='tree').flatMap(component=>{
    const root=roots[component.name],members=[...component.files,...component.directories].map(row=>row.path);
    return ['',...component.directories.map(row=>row.path)].map(relative=>({path:path.join(root,relative),entries:members.filter(name=>path.posix.dirname(name)===(relative||'.')).map(name=>path.posix.basename(name)).sort()}));
  });
  return {trees,files,expectedFiles,expectedDirectories};
}
async function sealPreparedPayload(kit,release,manifest) {
  return writeFrozenSeal({filename:path.join(release,'prepared-bundle.json'),kit,release,identityDigest:manifest.identity.digest,...await frozenInputs(kit,release,manifest),previousConfig:manifest.previousConfig,prepared:true,expiresAt:new Date(Date.now()+7*86400000).toISOString()});
}
async function evidenceFiles(root) {
  const files=[];
  async function walk(directory){for(const name of await readdir(directory)){const file=path.join(directory,name),st=await lstat(file);if(st.isSymbolicLink())throw Error('Frozen evidence link refused.');if(st.isDirectory())await walk(file);else if(st.isFile()&&name!=='accepted.json')files.push(file);else if(!st.isFile())throw Error('Frozen evidence kind refused.');}}
  await walk(path.join(root,'release-gate'));
  // Text evidence also authenticates these retained diagnostics.
  for(const name of ['narrow-tests.log'])if(await exists(path.join(root,'.local',name)))files.push(path.join(root,'.local',name));
  return files;
}
/** Final preparation boundary, after gates-only. No lifecycle side effects.
 * Forward and reverse dry runs, full identity and evidence validation happen
 * here once. Promote refuses if this command has not completed. */
export async function freezeCandidate(options) {
  const kit=path.resolve(options.kit??defaultKit),release=path.resolve(options.release??'');
  return lease(kit,async()=>{
    const timings=[],manifestBytes=await readFile(await regular(path.join(release,'release.json'))),manifest=JSON.parse(manifestBytes);
    if(!options.current)throw Error('Freeze requires the exact current pointer.');
    const rollbackRoot=manifest.previousRelease??manifest.rollbackRelease;
    if(!rollbackRoot)throw Error('Freeze requires a retained rollback release.');
    const rollbackKit=path.resolve(rollbackRoot,'../..'),previousBytes=await readFile(await regular(path.join(rollbackRoot,'release.json'))),previous=JSON.parse(previousBytes);
    if(path.resolve(manifest.previousConfig.path)!==path.join(rollbackRoot,'config.json'))throw Error('Frozen activation requires the currently selected retained configuration. Complete legacy migration separately before freezing.');
    // Capture evidence before validating it, then require those same bytes at
    // sealing. A concurrent edit cannot become newly trusted freeze content.
    const rollbackAuthority=path.join(rollbackRoot,'release-gate',previous.lane==='adopted'?'adopted.json':'accepted.json');
    const evidence=[...await evidenceFiles(release),...await evidenceFiles(rollbackRoot),rollbackAuthority];
    const checkedFiles=[];
    for(const file of evidence)checkedFiles.push({path:file,sha256:await frozenHash(file)});
    checkedFiles.push({path:path.join(release,'release.json'),sha256:sha(manifestBytes)},{path:path.join(rollbackRoot,'release.json'),sha256:sha(previousBytes)});
    await timed(timings,'validate-candidate-and-evidence',async()=>{await assertCandidate(kit,release,manifest);await verifyPrevious(manifest,options.current);await assertGateEvidence(kit,release,manifest);});
    const checkedGates=await json(path.join(release,'release-gate/gates.json'));
    if(checkedGates.suites?.public?.kind==='github-hosted-public'&&!checkedGates.offlinePublic)throw Error('Freeze requires a local public rollback reserve. Prepare it before activation.');
    const browser=(await json(path.join(kit,'kit.json'))).browser?.path??'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const executables=[ps,browser];
    if(checkedGates.gallery?.contract?.inputs?.browser){checkedFiles.push({path:browser,sha256:checkedGates.gallery.contract.inputs.browser});}
    const commandPin=checkedGates.gallery?.contract?.execution?.binaries?.components?.find(row=>row.name==='command')?.files?.[0]?.sha256;
    if(commandPin)checkedFiles.push({path:ps,sha256:commandPin});
    await timed(timings,'validate-rollback-and-evidence',async()=>{await assertCandidate(rollbackKit,rollbackRoot,previous,true,true);await assertGateEvidence(rollbackKit,rollbackRoot,previous,true);if(!await exists(path.join(rollbackRoot,'release-gate/accepted.json'))&&previous.lane!=='adopted')throw Error('Freeze requires accepted rollback.');});
    const log=path.join(release,'.local/freeze-dry-run.log');
    const dry=async(root,current,rollback)=>run(ps,['-NoProfile','-File',path.join(kit,'operator/Managed-ReleaseV2.ps1'),'-CurrentRelease',current,'-CandidatePointer',path.join(root,'pointer.json'),'-CompanionRoot',kit,'-Receipt',path.join(root,'companion.json'),'-ReleaseRoot',root,'-DryRun',...(rollback?['-Rollback']:[])],{cwd:kit,log});
    await timed(timings,'forward-dry-run',()=>dry(release,options.current,false));
    await timed(timings,'rollback-dry-run',()=>dry(rollbackRoot,path.join(release,'pointer.json'),true));
    const current=await readFile(await regular(options.current)), candidate=await frozenInputs(kit,release,manifest), retained=await frozenInputs(rollbackKit,rollbackRoot,previous,{retained:true});
    candidate.files.push(...evidence,...retained.files,...executables,path.join(release,'prepared-bundle.json'));
    const gates=await json(path.join(release,'release-gate/gates.json')),ages=[];
    const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(key==='completedAt'&&typeof item==='string'&&Number.isFinite(Date.parse(item)))ages.push(Date.parse(item));else visit(item);}};visit(gates);
    const expiresAt=new Date(Math.min(Date.now(),...ages)+7*86400000).toISOString();
    await writeFile(path.join(release,'.local/freeze-checks.json'),JSON.stringify({passed:true,timings,...phaseSummary(timings)},null,2)+'\n');
    candidate.files.push(path.join(release,'.local/freeze-checks.json'));
    const rollback={release:rollbackRoot,identityDigest:previous.identity.digest,pointer:{path:path.join(rollbackRoot,'pointer.json'),sha256:await frozenHash(path.join(rollbackRoot,'pointer.json'))},config:{path:path.join(rollbackRoot,'config.json'),sha256:await frozenHash(path.join(rollbackRoot,'config.json'))}};
    const bindings={currentPointerSha256:sha(current),candidatePointerSha256:await frozenHash(path.join(release,'pointer.json')),receiptSha256:await frozenHash(path.join(release,'companion.json'))};
    const frozen=await timed(timings,'seal-checked-bundle',()=>writeFrozenSeal({filename:path.join(release,'frozen-bundle.json'),kit,release,identityDigest:manifest.identity.digest,trees:[...candidate.trees,...retained.trees],files:candidate.files,executables,expectedFiles:[...candidate.expectedFiles,...retained.expectedFiles,...checkedFiles],expectedDirectories:[...candidate.expectedDirectories,...retained.expectedDirectories],previousConfig:manifest.previousConfig,rollback,bindings,forbiddenPaths:[path.join(release,'release-gate/gates-pending.json')],expiresAt}));
    await verifyPrevious(manifest,options.current);
    if(await frozenHash(options.current)!==bindings.currentPointerSha256)throw Error('Current pointer changed while freezing.');
    await writeFile(path.join(release,'.local/freeze-timings.json'),JSON.stringify({timings,...phaseSummary(timings)},null,2)+'\n');
    console.log('Release timing: '+JSON.stringify(phaseSummary(timings)));
    return frozen;
  });
}
export async function promoteCandidate(options){
  const kit=path.resolve(options.kit??defaultKit),release=path.resolve(options.release??'');
  return lease(kit,async()=>{
    const timings=[],manifest=await json(path.join(release,'release.json'));
    let activationPassed=false;
    try{
    if(!options.current)throw Error('Managed promotion requires current pointer.');
    const frozen=await timed(timings,'activation-admission',()=>readFrozenSeal({filename:path.join(release,'frozen-bundle.json'),kit,release,current:options.current,identityDigest:manifest.identity.digest}));
    await verifyPrevious(manifest,options.current);await checkActivity(options);
    // No cancellation after this boundary. The existing single-writer journal,
    // latest-save verification, CAS, readiness and rollback own the transaction.
    await timed(timings,'managed-activation',()=>run(ps,['-NoProfile','-File',path.join(kit,'operator/Managed-ReleaseV2.ps1'),'-CurrentRelease',options.current,'-CandidatePointer',path.join(release,'pointer.json'),'-CompanionRoot',kit,'-Receipt',path.join(release,'companion.json'),'-ReleaseRoot',release,'-FrozenSeal',frozen.filename,'-FrozenSealSha256',frozen.sha256],{cwd:kit,log:path.join(release,'.local/handover.log')}));
    const managed=await json(path.join(release,'.local/activation-phases.json'));
    if(managed.refused||managed.frozen!==true||managed.phase!=='ready'||!managed.timings?.phases?.some(row=>row.phase==='rollback-readiness'))throw Error('Managed activation readiness receipt missing. Inspect runtime before retrying.');
    await writeFile(path.join(release,'release-gate/accepted.json'),JSON.stringify({accepted:true,inputDigest:manifest.identity.digest,completedAt:new Date().toISOString(),frozenSealSha256:frozen.sha256,timings,managed,...phaseSummary(timings)})+'\n');
    // Cross-kit release roots are retained; today's rollback endpoints stay put.
    console.log(JSON.stringify({released:true,authenticatedReadiness:true,timings,...phaseSummary(timings)}));
    activationPassed=true;
    }finally{try{await writeFile(path.join(release,'.local/activation-attempt.json'),JSON.stringify({passed:activationPassed,timings,...phaseSummary(timings)},null,2)+'\n');}catch{}}
  });
}
export async function prune(kit, current) {
  const active = await pointerConfig(current), roots = [], retainedRoots = [];
  for (const name of await readdir(path.join(kit, 'releases'))) {
    const root = path.join(kit, 'releases', name), marker = path.join(root, 'release-gate/accepted.json');
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Prune link refused.');
    retainedRoots.push(root);
    if (await exists(marker)) roots.push({ root, accepted: await json(marker) });
    else if(await exists(path.join(root,'release-gate/adopted.json'))) roots.push({root,accepted:{completedAt:(await json(path.join(root,'release-gate/adopted.json'))).createdAt}});
  }
  roots.sort((a, b) => b.accepted.completedAt.localeCompare(a.accepted.completedAt));
  const keep = new Set([path.dirname(active.path)]);
  // Pack-transition evidence is durable, including after rollback. Never prune
  // either endpoint merely because a later code/text release was accepted.
  for (const root of retainedRoots) if (await exists(path.join(root,'pack-transition.json'))) {
    const transition=await json(path.join(root,'pack-transition.json'));
    if (![transition.oldConfig?.path,transition.newConfig?.path].every(value=>typeof value==='string'&&path.isAbsolute(value))) throw new Error('Retained transition endpoints invalid.');
    keep.add(root); keep.add(path.dirname(transition.oldConfig.path)); keep.add(path.dirname(transition.newConfig.path));
  }
  // Keep the direct rollback target even when accepted dates were unusual.
  const activeManifest = await json(path.join(path.dirname(active.path), 'release.json')); if (activeManifest.previousRelease ?? activeManifest.rollbackRelease) keep.add(activeManifest.previousRelease ?? activeManifest.rollbackRelease);
  for(const row of roots) {if(keep.size>=3)break;keep.add(row.root);}
  const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const protectedRoots = new Set([...keep].map(canonical));
  for (const row of roots) if (!protectedRoots.has(canonical(row.root))) await safeRemove(path.join(kit, 'releases'), row.root);
}
export async function parseArgs(args) {
  const result = {};
  const flags = new Set(['gates-only', 'rollback','legacy-rollback','public-ci-local-fallback','practice','private-only','retry-once-in-isolation','no-retry-once-in-isolation','neutral-ci']); const values = new Set(['kit', 'release', 'repo', 'ref', 'input', 'id', 'previous-config', 'previous-release', 'base', 'current','evidence-dir','idle-state','public-ci-ref','public-ci-run-id','public-ci-attempt','output','early-phase','round-id','early-budget-ms']);
  for (let i = 0; i < args.length; i++) { const key = args[i].slice(2); if (!args[i].startsWith('--') || Object.hasOwn(result, key)) throw new Error('Arguments refused.'); if (flags.has(key)) result[key] = true; else if (values.has(key) && args[i + 1]) result[key] = args[++i]; else throw new Error('Arguments refused.'); }
  const { resolveRetryPolicy } = await import('./retry-policy.mjs');
  const manifest = result.kit ? await json(path.join(result.kit, 'kit.json')) : {};
  result['retry-once-in-isolation'] = resolveRetryPolicy(result, manifest);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    const command = process.argv[2];
    if(command==='--help'||command==='help'){console.log('Usage: release-v2.mjs prepare|release|freeze|promote|run|rollback|recover|assert-identity --kit PATH [--release PATH] [--gates-only] [--evidence-dir PATH] [--idle-state PATH] [--public-ci-ref REF] [--public-ci-local-fallback]\nGo-live is three steps, in this order:\n  1. release --kit KIT --release RELEASE --current POINTER --gates-only\n  2. freeze --kit KIT --release RELEASE --current POINTER\n  3. release (same as promote) --kit KIT --release RELEASE --current POINTER   approved activation; refuses until step 2 has sealed frozen-bundle.json\nrun = prepare plus all three steps.\nRequest inspection: check-request --kit KIT --input REQUEST --current POINTER\nPractice: release --practice --kit TOOLING_KIT --current POINTER --repo CORE_REPO --output ABSENT_SCRATCH');process.exit(0);}
    const options = await parseArgs(process.argv.slice(3));
    if (command === 'check-request') console.log(JSON.stringify(await checkRequest(options)));
    else if (command === 'prepare') await prepare(options);
    else if (command === 'release') await releaseCandidate(options);
    else if(command==='promote')await promoteCandidate(options);
    else if(command==='freeze')await freezeCandidate(options);
    else if(command==='recover') {
      const kit=path.resolve(options.kit??defaultKit),selected=await pointerConfig(options.current);
      const journal=await json(path.join(path.dirname(selected.config.dataDir),'release-pack-transition.json'));
      const root=path.dirname(journal.candidatePointer);
      await lease(kit,async()=>{
        await run(ps,['-NoProfile','-File',path.join(kit,'operator/Managed-ReleaseV2.ps1'),'-CurrentRelease',options.current,'-CandidatePointer',journal.candidatePointer,'-CompanionRoot',kit,'-Receipt',path.join(root,'companion.json'),'-ReleaseRoot',root,'-Recover',...(journal.rollback?['-Rollback']:[])],{cwd:kit,log:path.join(root,'.local/recovery.log')});
        if (!journal.rollback) { const manifest=await json(path.join(root,'release.json')); await writeFile(path.join(root,'release-gate/accepted.json'),JSON.stringify({accepted:true,inputDigest:manifest.identity.digest,completedAt:new Date().toISOString(),recovered:true})+'\n'); }
        console.log(JSON.stringify({recovered:true,authenticatedReadiness:true}));
      });
    }
    else if(command==='rollback') {
      const kit=path.resolve(options.kit??defaultKit),root=path.resolve(options.release),manifest=await json(path.join(root,'release.json'));
      await lease(kit,async()=>{
        await assertCandidate(path.resolve(root,'../..'),root,manifest,true,true);await assertGateEvidence(path.resolve(root,'../..'),root,manifest,true);await pointerConfig(options.current);
        if(!await exists(path.join(root,'release-gate/accepted.json')) && manifest.lane!=='adopted')throw new Error('Rollback requires accepted target.');
        await run(ps,['-NoProfile','-File',path.join(kit,'operator/Managed-ReleaseV2.ps1'),'-CurrentRelease',options.current,'-CandidatePointer',path.join(root,'pointer.json'),'-CompanionRoot',kit,'-Receipt',path.join(root,'companion.json'),'-ReleaseRoot',root,'-Rollback'],{cwd:kit,log:path.join(root,'.local/rollback.log')});
        console.log(JSON.stringify({rolledBack:true,authenticatedReadiness:true}));
      });
    }
    else if (command === 'gates-worker') await fullWorker(path.resolve(options.kit), path.resolve(options.release),options);
    else if(command==='lookup-lanes'){
      console.log(JSON.stringify(await inspectFullLaneReuse({kit:path.resolve(options.kit??defaultKit),release:path.resolve(options.release),directory:evidenceDirectory(path.resolve(options.kit??defaultKit),options),...(options['private-only']?{lanes:['private-full']}:{}),retryOnceInIsolation:options['retry-once-in-isolation']===true}),null,2));
    }
    else if(command==='plan-files'){
      const kit=path.resolve(options.kit??defaultKit),release=path.resolve(options.release),manifest=await json(path.join(release,'release.json'));
      await assertCandidate(kit,release,manifest);const specs=await stableSpecs(kit,release,manifest),lanes={};
      for(const [name,lane] of [['public','public-full'],['private','private-full']]){
        const plans=await planLane({kit,release,lane,execution:specs[name].execution});lanes[name]={files:plans.length,alwaysRun:plans.filter(p=>p.alwaysRun).length,plans:plans.map(p=>({file:p.file,key:p.contract.key,alwaysRun:p.alwaysRun,reasons:p.reasons}))};
      }
      console.log(JSON.stringify({readOnly:true,lanes}));
    }
    else if (command === 'text-endpoint-worker') {
      await lightOwner();
      const kit = path.resolve(options.kit), release = path.resolve(options.release);
      const proof = await runTextEndpointCheck({core:path.join(release,'core'),companion:kit,receipt:path.join(release,'companion.json')});
      await writeFile(path.join(release,'release-gate/text-endpoint.json'),JSON.stringify(proof)+'\n'); console.log(JSON.stringify({passed:true,cleanupVerified:true}));
    }
    else if(command==='text-tests-worker') {
      await lightOwner();const kit=path.resolve(options.kit),release=path.resolve(options.release),assembly=path.join(release,'.local/assembly');
      await run((await json(path.join(release,'config.json'))).nodePath,['--test','--test-timeout=120000','tests/updates.test.mjs','tests/private-addon.test.mjs','tests/private-addon-build.test.mjs'],{cwd:assembly,env:sanitizeExecutionEnvironment(process.env,{overrides:{RS3_DATASET:'open-f2p',RS3_GAME_DATA_DIR:path.join(assembly,'.local/game-data'),RS3_MAP_ASSETS_DIR:path.join(assembly,'.local/map-assets')}}),log:path.join(release,'.local/narrow-tests.log')});
      console.log(JSON.stringify({narrowChecksPassed:true}));
    }
    else if (command === 'assert-identity') {
      const kit = path.resolve(options.kit ?? defaultKit), root = path.resolve(options.release), manifest = await json(path.join(root, 'release.json'));
      await assertCandidate(options.rollback ? path.resolve(root,'../..') : kit, root, manifest,true,!!options.rollback);
      if (options.rollback) { if (!await exists(path.join(root, 'release-gate/accepted.json')) && manifest.lane!=='adopted') throw new Error('Rollback requires retained accepted release.'); if (options.current) await pointerConfig(options.current); }
      else await verifyPrevious(manifest, options.current);
      await assertGateEvidence(options.rollback ? path.resolve(root,'../..') : kit, root, manifest,!!options.rollback);
      console.log(JSON.stringify({ exactIdentity: true, gatesPassed: true }));
    }
    else if (command === 'run') { const candidate = await prepare(options); const selected={...options,release:candidate};await releaseCandidate({...selected,'gates-only':true});await freezeCandidate(selected);await promoteCandidate(selected); }
    else throw new Error('Command refused.');
  } catch (error) { console.error(JSON.stringify({ refused: true, cause: refusalCause(error) })); console.error('Release v2 refused. Inspect private stage logs; the prior writer is unchanged unless managed handover began.'); process.exitCode = 1; }
}
