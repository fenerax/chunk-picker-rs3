// Private, one-step initial handover. Importing this module performs no IO.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, lstat, open, rename, unlink, cp } from 'node:fs/promises';
import { runChild } from './cutover-child.mjs';

const execute = promisify(execFile);
const operator = path.dirname(fileURLToPath(import.meta.url));
export const forwardSteps = ['preflight', 'pause', 'stop-old', 'snapshot', 'bind', 'start-new', 'verify', 'register-tasks', 'unpause'];
export const rollbackSteps = ['pause', 'stop-new', 'verify-previous', 'restore-tasks', 'start-old', 'unpause'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function check(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
export const inside = (root, child) => {
  const relative = path.relative(root, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
export async function ordinary(filename, directory = false) {
  check(typeof filename === 'string' && path.isAbsolute(filename) && !/[\r\n"\x00]/.test(filename), 'ABSOLUTE_PATH');
  let cursor = path.resolve(filename);
  while (true) {
    const stat = await lstat(cursor);
    check(!stat.isSymbolicLink(), 'LINK_REFUSED');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const stat = await lstat(filename);
  check(directory ? stat.isDirectory() : stat.isFile(), 'PATH_TYPE');
  return filename;
}
export async function json(filename) { await ordinary(filename); check((await lstat(filename)).size<=32*1024**2,'JSON_LIMIT'); return JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); }
export async function pinned(pin) {
  check(pin && Object.keys(pin).sort().join(',') === 'path,sha256' && /^[a-f0-9]{64}$/.test(pin.sha256), 'PIN_REQUIRED');
  await ordinary(pin.path); check(digest(await readFile(pin.path)) === pin.sha256, 'PIN_CHANGED'); return pin.path;
}
async function exists(filename) { try { await lstat(filename); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function atomic(filename, value) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } finally { try { await unlink(temporary); } catch(e) { if(e.code!=='ENOENT')throw e; } }
}
async function git(root, ...args) {
  return (await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 ** 2 })).stdout.trim();
}
export function assertOrder(state, step, rollback = false, retry = false) {
  const steps = rollback ? rollbackSteps : forwardSteps;
  check(steps.includes(step), 'UNKNOWN_STEP');
  check(!state.rolledBack, 'RUN_ALREADY_ROLLED_BACK');
  if (!rollback) check(!state.rollbackStarted, 'ROLLBACK_IN_PROGRESS');
  else check(state.forward?.length, 'NO_CUTOVER_TO_ROLL_BACK');
  const receipts = rollback ? state.rollback : state.forward;
  const completed = receipts.filter(row => row.status === 'complete');
  check(step === steps[completed.length], 'STEP_ORDER');
  const last = receipts.at(-1);
  if (last && last.status !== 'complete') check(retry && last.step === step, 'EXPLICIT_RETRY_REQUIRED');
}
export function assertIdle(envelope, minutes, now = Date.now()) {
  check(Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 1440, 'IDLE_WINDOW');
  const state = envelope.state ?? envelope;
  check(Number.isSafeInteger(state.revision) && Array.isArray(state.history), 'SAVE_METADATA_REQUIRED');
  // All history metadata is inspected, not just array order. Never log commands,
  // timestamps, members, revisions or state values. Unknown metadata fails closed.
  const times = state.history.map(event => Date.parse(event.at));
  check(times.every(Number.isFinite), 'INVALID_COMMAND_METADATA');
  check(times.length || state.revision === 0, 'MISSING_COMMAND_METADATA');
  check(!times.some(time => time > now || now - time < minutes * 60000), 'RECENT_COMMAND');
}
export async function inventory(directory, relative = '') {
  await ordinary(path.join(directory, relative), true);
  const result = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name), filename = path.join(directory, name);
    check(!entry.isSymbolicLink(), 'SNAPSHOT_LINK');
    if (entry.isDirectory()) { result.push({ path: name.replaceAll('\\','/'), directory: true }); result.push(...await inventory(directory, name)); }
    else { await ordinary(filename); const bytes = await readFile(filename); result.push({ path: name.replaceAll('\\','/'), bytes: bytes.length, sha256: digest(bytes) }); }
  }
  return result;
}
const sidecars = ['public-origin', 'server-runtime.json', 'server.log', 'server-error.log', 'backup-destination', 'backup-status.json', 'backup.log', 'watchdog.log', 'picker-paused'];
async function noRepoAncestor(directory) {
  let cursor = directory;
  while (true) {
    check(!await exists(path.join(cursor, '.git')), 'SNAPSHOT_INSIDE_REPOSITORY');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
export async function readPlan(filename, {rollback=false}={}) {
  const p = await json(filename);
  const fields = ['schemaVersion','mode','candidateConfig','previousConfig','companionRoot','oldHelpers','bindingCli','taskPlan','snapshotRoot','receiptDir','idleMinutes','gates','inspection','hostedAcceptance'];
  check(Object.keys(p).sort().join(',') === fields.sort().join(',') && p.schemaVersion === 1 && ['live','rehearsal'].includes(p.mode), 'PLAN_SCHEMA');
  for (const pin of [p.candidateConfig,p.previousConfig,p.taskPlan,...Object.values(p.oldHelpers),...(rollback?[]:[p.bindingCli,p.gates,p.inspection])]) await pinned(pin);
  check(Object.keys(p.oldHelpers).sort().join(',') === 'process,start,stop', 'OLD_HELPERS');
  const candidate = await json(p.candidateConfig.path), previous = await json(p.previousConfig.path);
  await ordinary(candidate.publicOriginFile);
  const originBytes=await readFile(candidate.publicOriginFile),originText=originBytes.toString('utf8').trim();
  const origin=new URL(originText);
  check(origin.protocol==='https:' && origin.origin===originText,'HTTPS_ORIGIN_REQUIRED');
  await ordinary(p.companionRoot, true);
  check(inside(path.join(p.companionRoot,'.local'), p.receiptDir) && p.receiptDir !== path.join(p.companionRoot,'.local'), 'RECEIPT_LOCATION');
  check(path.isAbsolute(p.snapshotRoot), 'SNAPSHOT_LOCATION');
  // Local-only credential storage. No repo, synced folder or removable/network root.
  const localBase = path.join(process.env.LOCALAPPDATA ?? '', 'RS3ChunkPicker', 'Snapshots');
  check(path.isAbsolute(localBase) && inside(localBase,p.snapshotRoot), 'SNAPSHOT_LOCAL_ONLY');
  await noRepoAncestor(p.snapshotRoot);
  for (const key of ['dataDir','host','port','loopbackPort','publicOriginFile','packsDir']) check(candidate[key] === previous[key], 'TRANSITION_CHANGED');
  check(['taskWorkerMode','workerIdleMs','backupDays','historyEntries'].every(key=>candidate.runtimeOptions?.[key]===previous.runtimeOptions?.[key]),'TRANSITION_RUNTIME_CHANGED');
  if(!rollback&&!await exists(candidate.dataDir+'.dataset.json'))check(previous.runtimeOptions?.backupDays===null&&previous.runtimeOptions?.historyEntries===null,'ORIGINAL_RETENTION_UNSUPPORTED');
  check(candidate.coreRoot !== previous.coreRoot && candidate.selection.path === previous.selection.path && candidate.selection.sha256 === previous.selection.sha256, 'TRANSITION_CHANGED');
  for (const kind of ['data','rulesText','art']) check(JSON.stringify(candidate.packs[kind]) === JSON.stringify(previous.packs[kind]), 'PACK_TRANSITION_CHANGED');
  for (const c of rollback ? [previous] : [candidate,previous]) {
    for (const pin of [c.selection,...Object.values(c.packs),c.profile,c.addons].filter(Boolean)) await pinned(pin);
    await ordinary(c.nodePath); await ordinary(c.coreRoot,true); await ordinary(c.dataDir,true);
  }
  check(candidate.profile && candidate.addons, 'PRIVATE_INPUTS_REQUIRED');
  check(p.oldHelpers.stop.path === path.join(previous.coreRoot,'scripts','Stop-Picker.ps1') && p.oldHelpers.start.path === path.join(previous.coreRoot,'scripts','Start-Picker.ps1') && p.oldHelpers.process.path === path.join(previous.coreRoot,'scripts','Picker-Process.ps1'), 'MATCHING_OLD_HELPERS');
  const taskPlan = await json(p.taskPlan.path);
  check(taskPlan.config.path === p.candidateConfig.path && taskPlan.config.sha256 === p.candidateConfig.sha256, 'TASK_CONFIG_CHANGED');
  check(p.mode === 'rehearsal' ? !!taskPlan.mockDirectory && candidate.host === '127.0.0.1' && candidate.port >= 8900 && candidate.port <= 8999 && (candidate.loopbackPort===null || candidate.loopbackPort>=8900 && candidate.loopbackPort<=8999) : !taskPlan.mockDirectory, 'REHEARSAL_ISOLATION');
  if (p.mode === 'rehearsal') check(!inside('C:/Users/User/Projects/chunk-picker-rs3',candidate.dataDir), 'LIVE_DATA_REFUSED');
  else check(typeof p.hostedAcceptance === 'string' && path.isAbsolute(p.hostedAcceptance), 'HOSTED_ACCEPTANCE_PATH');
  check(Number.isSafeInteger(p.idleMinutes) && p.idleMinutes >= 1 && p.idleMinutes <= 1440, 'IDLE_WINDOW');
  return { p, candidate, previous, filename,originSha256:digest(originBytes) };
}
async function assertGates(context) {
  const {p,candidate} = context, gate = await json(p.gates.path), inspection = await json(p.inspection.path);
  check(gate.schemaVersion === 1 && gate.mode === p.mode && /^[a-f0-9]{40}$/.test(gate.coreRevision), 'RELEASE_GATES');
  check(await git(candidate.coreRoot,'rev-parse','HEAD') === gate.coreRevision && !await git(candidate.coreRoot,'status','--porcelain','--untracked-files=no'), 'CORE_REVISION_CHANGED');
  await git(candidate.coreRoot,'ls-files','--error-unmatch','--','app/server.mjs','app/private-addon.mjs','scripts/test.mjs');
  check(gate.companionSha256 === digest(await readFile(path.join(p.companionRoot,'companion.json'))) && gate.candidateSha256 === p.candidateConfig.sha256 && gate.previousSha256 === p.previousConfig.sha256, 'GATE_IDENTITY_CHANGED');
  for (const name of ['publicFull','privateFull','galleryPlain','galleryFramed']) {
    check(gate.checks?.[name]?.passed === true && gate.checks[name].coreRevision === gate.coreRevision, 'REQUIRED_GATE_MISSING');
    await pinned(gate.checks[name].log);
  }
  // These checks require human inspection of the deployed process environment and
  // Funnel. A synthetic rehearsal receipt is explicitly barred from live mode.
  check(inspection.schemaVersion === 1 && inspection.mode === p.mode && inspection.previousSha256 === p.previousConfig.sha256 &&
    ['launcher','runtimeOwnership','environment','startupAndWatchdog','backupSchedule','funnelProxy','cookieOrigin','retention','artOverrides','previousStorageCompatibility'].every(key => inspection.verified?.[key] === true), 'DEPLOYMENT_INSPECTION_REQUIRED');
  const receipt = await json(path.join(p.companionRoot,'companion.json'));
  check(path.resolve(receipt.coreRoot) === path.resolve(candidate.coreRoot) && receipt.profile.sha256 === candidate.profile.sha256 && receipt.addons.sha256 === candidate.addons.sha256, 'COMPANION_IDENTITY_CHANGED');
  for (const kind of ['data','rulesText','art']) check(receipt.packs[kind].sha256 === candidate.packs[kind].sha256, 'COMPANION_PACK_CHANGED');
}
export async function assertHosted(context) {
  if (context.p.mode === 'rehearsal') return;
  const accepted = await json(context.p.hostedAcceptance);
  const hash = digest(await readFile(context.p.hostedAcceptance));
  check(!context.state.hostedAcceptanceSha256 || context.state.hostedAcceptanceSha256 === hash, 'HOSTED_ACCEPTANCE_CHANGED');
  const at = Date.parse(accepted.checkedAt);
  check(accepted.schemaVersion === 1 && accepted.candidateSha256 === context.p.candidateConfig.sha256 && accepted.existingPlayer2HostedSession === true && at <= Date.now() && at >= context.state.forward.find(row => row.step === 'start-new' && row.status === 'complete')?.endedAt, 'EXISTING_HOSTED_ACCEPTANCE_REQUIRED');
  context.state.hostedAcceptanceSha256 = hash;
}
export class SystemBackend {
  constructor(context) { this.context = context; }
  async ps(script, ...args) {
    // Raw child output stays in memory and is discarded. It can contain old runtime
    // links or save metadata; neither errors nor receipts include it.
    try { return (await runChild('pwsh.exe', ['-NoProfile','-NonInteractive','-File',path.join(operator,script),...args], { timeout:650000 })).stdout; }
    catch(error) {
      const reason=/^M7_REFUSAL_([A-Z_]+)\r?$/m.exec(error.stdout??'');
      check(false,reason?'OPERATOR_'+reason[1]:'OPERATOR_HELPER_REFUSED');
    }
  }
  async process(operation, ...args) { return this.ps('Cutover-Process.ps1','-Plan',this.context.filename,'-Operation',operation,...args); }
  async withWriterLock(operation) {
    const child=spawn('pwsh.exe',['-NoProfile','-NonInteractive','-File',path.join(operator,'Cutover-Process.ps1'),'-Plan',this.context.filename,'-Operation','hold-lock'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let timer;
    const exited=new Promise(resolve=>{child.once('exit',code=>resolve(code));child.once('error',()=>resolve(1));});
    child.stdin.on('error',()=>{});
    try {
      await new Promise((resolve,reject)=>{
        const refused=()=>reject(Object.assign(new Error('OPERATOR_LOCK_REFUSED'),{code:'OPERATOR_LOCK_REFUSED'}));
        timer=setTimeout(refused,15000);child.once('error',refused);child.once('exit',refused);
        let output='';child.stdout.on('data',bytes=>{output+=bytes.toString();if(output.trim()==='operator-lock-held')resolve();else if(output.length>128)refused();});
      });
      clearTimeout(timer);
      return await operation();
    } finally {
      clearTimeout(timer);child.stdin.end('release\n');
      const releaseTimer=setTimeout(()=>{if(child.exitCode===null)child.kill();},15000);
      const code=await exited;clearTimeout(releaseTimer);
      check(code===0,'OPERATOR_LOCK_INTERRUPTED');
    }
  }
  async tasks(restore = false, dry = false) { return this.ps(restore ? 'Restore-CoreTasks.ps1' : 'Register-CoreTasks.ps1','-Plan',this.context.p.taskPlan.path,...(dry ? ['-DryRun'] : [])); }
  async install() {
    const {p,candidate} = this.context;
    await this.node(path.join(p.companionRoot,'tools','verify-install.mjs'), ['--core',candidate.coreRoot,'--companion',p.companionRoot]);
    // The unchanged live selection can live outside the companion. Verify its
    // manifest-listed payloads too, not merely the three manifest hashes.
    for (const pin of Object.values(candidate.packs)) {
      const manifest = await json(pin.path);
      for (const record of manifest.files) {
        check(typeof record.path === 'string' && !record.path.includes('\\') && !record.path.split('/').some(p => !p || p === '.' || p === '..') && !path.isAbsolute(record.path), 'PACK_PATH');
        const file = path.join(path.dirname(pin.path),record.path); await ordinary(file);
        const bytes = await readFile(file); check(bytes.length === record.bytes && digest(bytes) === record.sha256, 'PACK_PAYLOAD_CHANGED');
      }
    }
  }
  async node(script,args,env={}) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^RS3_|^NODE_OPTIONS$|^NODE_PATH$/.test(key)));
    try { await runChild(this.context.candidate.nodePath,[script,...args],{timeout:300000,env:{...clean,...env}}); }
    catch { check(false,'DATA_VERIFICATION_REFUSED'); }
  }
  async bind() {
    const {p,candidate:c} = this.context;
    await this.node(p.bindingCli.path,['--data-dir',c.dataDir,'--packs-dir',c.packsDir,'--selection',c.selection.path],{RS3_DATASET:'duo-legacy',RS3_DATASET_PROFILE:c.profile.path,RS3_DATASET_PROFILE_SHA256:c.profile.sha256});
    await this.compatibility(c);
  }
  async compatibility(c = this.context.previous) {
    // Imports are given explicit paths/options. No storage is opened or recovered.
    const {resolveDataset} = await import(pathToFileURL(path.join(c.coreRoot,'app/datasets.mjs')));
    const {verifyDatasetBinding} = await import(pathToFileURL(path.join(c.coreRoot,'app/dataset-binding.mjs')));
    const dataset = await resolveDataset({datasetId:'duo-legacy',packsDir:c.packsDir,selectionPath:c.selection.path,profilePath:c.profile?.path,profileSha256:c.profile?.sha256});
    check((await verifyDatasetBinding(c.dataDir,dataset)).bound,'BINDING_REQUIRED');
  }
  async acceptance() {
    const {verifyAcceptance} = await import('./cutover-acceptance.mjs');
    return verifyAcceptance(this.context, () => this.process('new-owned'));
  }
}
async function snapshot(context, backend) {
  const {p,candidate:c} = context;
  await backend.process('stopped');
  await mkdir(p.snapshotRoot,{recursive:true}); await ordinary(p.snapshotRoot,true); await noRepoAncestor(p.snapshotRoot);
  await backend.process('secure','-Folder',p.snapshotRoot);
  const target = path.join(p.snapshotRoot,'operational');
  check(!await exists(target),'SNAPSHOT_ALREADY_EXISTS'); await mkdir(target);
  const sources = [['data',c.dataDir],['pre-stop-runtime.json',path.join(p.receiptDir,'pre-stop-runtime.json')],['candidate-config.json',p.candidateConfig.path],['previous-config.json',p.previousConfig.path],['task-plan.json',p.taskPlan.path],['inspection.json',p.inspection.path],['gates.json',p.gates.path]];
  for (const [name,pin] of Object.entries(p.oldHelpers)) sources.push(['old-helpers/'+name+'.ps1',pin.path]);
  const tasks = await json(p.taskPlan.path);
  sources.push(['watchdog.xml',tasks.watchdog.xml.path],['backup.xml',tasks.backup.xml.path]);
  for (const name of sidecars) if (await exists(path.join(path.dirname(c.dataDir),name))) sources.push(['sidecars/'+name,path.join(path.dirname(c.dataDir),name)]);
  if (await exists(c.dataDir+'.dataset.json')) sources.push(['dataset-binding.json',c.dataDir+'.dataset.json']);
  for (const [name,source] of sources) {
    const destination = path.join(target,name); await mkdir(path.dirname(destination),{recursive:true});
    if ((await lstat(source)).isDirectory()) {
      const before = await inventory(source); await cp(source,destination,{recursive:true,errorOnExist:true,force:false});
      check(JSON.stringify(before) === JSON.stringify(await inventory(source)) && JSON.stringify(before) === JSON.stringify(await inventory(destination)),'SNAPSHOT_DIGEST_MISMATCH');
    } else { await ordinary(source); const before = digest(await readFile(source)); await cp(source,destination,{errorOnExist:true,force:false}); check(before === digest(await readFile(source)) && before === digest(await readFile(destination)),'SNAPSHOT_DIGEST_MISMATCH'); }
  }
  await backend.process('stopped');
  for (const [name,source] of sources) {
    const destination = path.join(target,name);
    check((await lstat(source)).isDirectory()
      ? JSON.stringify(await inventory(source)) === JSON.stringify(await inventory(destination))
      : digest(await readFile(source)) === digest(await readFile(destination)), 'SNAPSHOT_SOURCE_MOVED');
  }
  const files = await inventory(target);
  await writeFile(path.join(p.snapshotRoot,'inventory.json'),JSON.stringify(files,null,2)+'\n',{flag:'wx',mode:0o600});
  await backend.process('verify-security','-Folder',p.snapshotRoot);
  // Read-back is the recovery-access check. Every protected snapshot file is opened
  // and hashed again; no credential, origin or content is sent to the console.
  check(JSON.stringify(files) === JSON.stringify(await inventory(target)),'SNAPSHOT_READBACK');
  return { inventorySha256:digest(JSON.stringify(files)), files:files.filter(row => !row.directory).length, recoveryAccess:true,accessControlled:true };
}
async function verifySnapshot(context,backend) {
  const saved = await json(path.join(context.p.snapshotRoot,'inventory.json'));
  const receipt = context.state.forward.find(row => row.step === 'snapshot' && row.status === 'complete');
  check(receipt && receipt.summary.inventorySha256 === digest(JSON.stringify(saved)) && JSON.stringify(saved) === JSON.stringify(await inventory(path.join(context.p.snapshotRoot,'operational'))),'SECURED_SNAPSHOT_REQUIRED');
  await backend.process('verify-security','-Folder',context.p.snapshotRoot);
}
async function runAction(context, backend, step, rollback) {
  const {p,candidate:c,state} = context;
  if (rollback) {
    switch (step) {
      case 'pause': await backend.process('pause'); break;
      case 'stop-new': if (await exists(c.dataDir+'.dataset.json')) await backend.compatibility(); await backend.process('stop-new'); break;
      case 'verify-previous':
        // Before stop-old, the original writer is still authoritative. Otherwise
        // rollback must prove previous-code compatibility without restoring saves.
        if (state.forward.some(row => ['bind','start-new'].includes(row.step))) await backend.compatibility();
        break;
      case 'restore-tasks': await backend.tasks(true); break;
      case 'start-old': await backend.process('start-old'); break;
      case 'unpause': await backend.process('old-owned'); await backend.tasks(true); if (!state.initiallyPaused) await backend.process('unpause'); break;
    }
    return { checked:true, saveRestored:false };
  }
  switch (step) {
    case 'preflight':
      await assertGates(context); await backend.process('preflight');
      assertIdle(await json(path.join(c.dataDir,'state.json')),p.idleMinutes);
      await backend.tasks(false,true); await backend.install();
      if(await exists(c.dataDir+'.dataset.json'))await backend.compatibility(c);
      const runtimeCopy = path.join(p.receiptDir,'pre-stop-runtime.json');
      if (!await exists(runtimeCopy)) await cp(path.join(path.dirname(c.dataDir),'server-runtime.json'),runtimeCopy,{force:false,errorOnExist:true});
      return { gates:true, locks:true, ownership:true, idle:true, schedulerReadOnly:true };
    case 'pause': await backend.process('pause'); break;
    case 'stop-old':
      // A command may arrive between preflight and pause. Check metadata again
      // immediately before stopping and refuse downtime if activity resumed.
      assertIdle(await json(path.join(c.dataDir,'state.json')),p.idleMinutes);
      if (await exists(path.join(path.dirname(c.dataDir),'server-runtime.json'))) await cp(path.join(path.dirname(c.dataDir),'server-runtime.json'),path.join(p.receiptDir,'pre-stop-runtime.json'),{force:true});
      await backend.process('stop-old'); break;
    case 'snapshot': return backend.withWriterLock(()=>snapshot(context,backend));
    case 'bind':
      await backend.withWriterLock(async()=>{await backend.process('stopped'); await verifySnapshot(context,backend); await backend.install(); await backend.bind();}); break;
    case 'start-new': await verifySnapshot(context,backend); await backend.compatibility(c); await backend.process('start-new'); break;
    case 'verify': await backend.process('new-owned'); return backend.acceptance();
    case 'register-tasks': await assertHosted(context); await backend.process('new-owned'); await backend.tasks(); break;
    case 'unpause': await assertHosted(context); await backend.process('new-owned'); await backend.tasks(); await backend.process('unpause'); break;
  }
  return { checked:true };
}
export async function runStep({ plan, step, rollback=false, dryRun=false, retry=false, backendFactory=context => new SystemBackend(context) }) {
  const context = await readPlan(plan,{rollback}), {p} = context;
  const stateFile = path.join(p.receiptDir,'state.json');
  const planHash = digest(await readFile(plan));
  const kitHash = digest(JSON.stringify((await inventory(operator)).filter(row => /\.(?:ps1|mjs)$/.test(row.path))));
  const initial = () => ({schemaVersion:1,planHash,kitHash,originSha256:context.originSha256,initiallyPaused:false,forward:[],rollback:[],rollbackStarted:false,rolledBack:false});
  let state = await exists(stateFile) ? await json(stateFile) : initial();
  check(state.planHash === planHash && state.kitHash === kitHash && state.originSha256===context.originSha256,'RUN_INPUTS_CHANGED');
  assertOrder(state,step,rollback,retry);
  context.state = state;
  const backend = backendFactory(context);
  // All dry runs are read only, including no helper/tick lock creation, no token
  // reads, no server contact and no receipt directory creation.
  if (dryRun) {
    if (!rollback) await assertGates(context); const taskSummary = await backend.tasks(rollback,true);
    return { dryRun:true,direction:rollback?'rollback':'cutover',step,next:step,tasks:JSON.parse(taskSummary),origin:'[redacted]' };
  }
  await mkdir(p.receiptDir,{recursive:true}); await ordinary(p.receiptDir,true);
  await backend.process('secure','-Folder',p.receiptDir);
  const lockFile = path.join(p.receiptDir,'operation.lock');
  let lock;
  try { lock = await open(lockFile,'wx',0o600); } catch { check(false,'CUTOVER_BUSY_OR_INTERRUPTED'); }
  try {
    // Repeat the read under the operation lock to close two simultaneous callers.
    state = await exists(stateFile) ? await json(stateFile) : initial();
    check(state.planHash === planHash && state.kitHash === kitHash && state.originSha256===context.originSha256,'RUN_INPUTS_CHANGED');
    assertOrder(state,step,rollback,retry); context.state = state;
    if (!rollback) await assertGates(context);
    if (!state.forward.length) state.initiallyPaused = await exists(path.join(path.dirname(context.candidate.dataDir),'picker-paused'));
    if (rollback) state.rollbackStarted = true;
    const receipts = rollback ? state.rollback : state.forward;
    const receipt = {step,status:'running',startedAt:Date.now()}; receipts.push(receipt);
    await atomic(stateFile,state);
    try {
      receipt.summary = await runAction(context,backend,step,rollback);
      receipt.status = 'complete';
      if (rollback && step === 'unpause') state.rolledBack = true;
    } catch (error) { receipt.status = 'failed'; receipt.code = /^[A-Z_]+$/.test(error.code??'') ? error.code : 'STEP_REFUSED'; throw error; }
    finally { receipt.endedAt = Date.now(); receipt.elapsedMs = receipt.endedAt-receipt.startedAt; await atomic(stateFile,state); }
    return {direction:rollback?'rollback':'cutover',...receipt};
  } finally { await lock.close(); await unlink(lockFile); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i=2;i<process.argv.length;i++) {
      const arg = process.argv[i];
      if (['--rollback','--dry-run','--retry'].includes(arg)) options[{'--rollback':'rollback','--dry-run':'dryRun','--retry':'retry'}[arg]] = true;
      else { check(['--plan','--step'].includes(arg) && process.argv[i+1], 'ARGUMENTS'); options[arg.slice(2)] = process.argv[++i]; }
    }
    console.log(JSON.stringify(await runStep(options)));
  } catch (e) { console.error(`Cutover refused (${ /^[A-Z_]+$/.test(e.code??'') ? e.code : 'CHECK_FAILED' }). Keep the pause and inspect the private run state; no automatic save restore.`); process.exitCode=1; }
}
