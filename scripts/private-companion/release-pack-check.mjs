// Read-only source storage; packed startup is exercised only on disposable copies.
import path from 'node:path';
import os from 'node:os';
import { realpathSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashTree, sanitizeExecutionEnvironment, digestValue } from './release-identity.mjs';
const refusalMessage = error => String(error?.message ?? error).replace(/https?:\/\/[^\s]+/gi, '[address redacted]').replace(/(?:Bearer\s+|(?:token|secret|password)[=:]\s*)[^\s]+/gi, '[credential redacted]');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
// The helper is also copied flat into PC kits. Tests bind this fixed list to
// the receiver's code-owned durable journal files without a checkout import.
const itemFiles = ['plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json'];
export const bindingBytes = descriptor => encode({ schemaVersion: 1, datasetId: descriptor.datasetId,
  datasetContractVersion: descriptor.datasetContractVersion, digest: descriptor.digest, requiresPack: true });
async function regular(file) {
  let current = path.resolve(file);
  while (true) { if ((await lstat(current)).isSymbolicLink()) throw new Error('Pack check link refused.'); const parent = path.dirname(current); if (current === parent) break; current = parent; }
  const s = await lstat(file); if (!s.isFile() || s.nlink !== 1) throw new Error('Pack check regular file required.');
  return file;
}
export async function configDescriptor(file) {
  const bytes = await readFile(await regular(file)), config = JSON.parse(bytes);
  for (const pin of [config.profile, config.selection, ...Object.values(config.packs)]) {
    if (sha(await readFile(await regular(pin.path))) !== pin.sha256) throw new Error('Pack check pin changed.');
  }
  const manifest = await json(config.packs.data.path), profile = await json(config.profile.path);
  const result = { datasetId: manifest.requires.datasetId, datasetContractVersion: manifest.requires.datasetContractVersion, digest: manifest.datasetDigest };
  if (profile.datasetId !== result.datasetId || profile.datasetDigest !== result.digest || profile.ruleContractHash !== manifest.ruleContractHash) throw new Error('Pack profile mismatch.');
  return { config, pin: { path: file, sha256: sha(bytes) }, descriptor: result };
}
function assertDescriptor(actual, declared) {
  if (!declared || Object.keys(declared).sort().join() !== 'bindingSha256,datasetContractVersion,datasetId,digest'
    || typeof declared.datasetId !== 'string' || !Number.isSafeInteger(declared.datasetContractVersion)
    || !/^[a-f0-9]{64}$/.test(declared.digest) || !/^[a-f0-9]{64}$/.test(declared.bindingSha256)
    || Object.keys(actual).some(key => actual[key] !== declared[key])) throw new Error('Explicit pack descriptor differs.');
}
export async function snapshot(dataDir, target) {
  const before = await saveIdentity(dataDir);
  await mkdir(target);
  await cp(path.join(dataDir, 'state.json'), path.join(target, 'state.json'), { errorOnExist: true, force: false });
  for (const name of ['static', 'history']) {
    try { await cp(path.join(dataDir, name), path.join(target, name), { recursive: true, errorOnExist: true, force: false }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  for (const name of itemFiles) {
    try { await cp(await regular(path.join(dataDir, name)), path.join(target, name), { errorOnExist: true, force: false }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (digestValue(await saveIdentity(target)) !== digestValue(before) || digestValue(await saveIdentity(dataDir)) !== digestValue(before)) throw new Error('Save changed during snapshot.');
  return before;
}
export async function saveIdentity(dataDir) {
  const files = [{ path: 'state.json', sha256: sha(await readFile(await regular(path.join(dataDir, 'state.json')))) }];
  for (const name of itemFiles) {
    try { files.push({ path: name, sha256: sha(await readFile(await regular(path.join(dataDir, name)))) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['static', 'history']) {
    try { await lstat(path.join(dataDir,name)); const tree = await hashTree(path.join(dataDir, name)); files.push(...tree.files.map(row => ({ path: name + '/' + row.path, sha256: row.sha256 }))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return files;
}
// Exit bounds the operation. Drain late stderr for at most 100ms: descendants
// can inherit a pipe, so EOF cannot be a prerequisite for completion. Preserve
// unjoined scratch even when the acknowledged probe itself exited successfully.
export function inspectChildTree(child, { exitedAt } = {}) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(child.pid) || child.pid <= 0) return { descendantsAtFailure: [] };
  // Query only this parent's chain, never dump unrelated command lines or env.
  // This diagnostic has its own hard bound and cannot turn refusal into a hang.
  const script = `$ErrorActionPreference='Stop';$todo=[Collections.Generic.Queue[int]]::new();$todo.Enqueue(${child.pid});$seen=[Collections.Generic.HashSet[int]]::new();$rows=[Collections.Generic.List[object]]::new();while($todo.Count -and $rows.Count -lt 128){$parentId=$todo.Dequeue();foreach($p in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$parentId) -OperationTimeoutSec 2)){if($seen.Add([int]$p.ProcessId)){$rows.Add(@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;name=$p.Name;createdAtTicks=[string]$p.CreationDate.ToUniversalTime().Ticks});$todo.Enqueue([int]$p.ProcessId)}}};ConvertTo-Json -Compress -InputObject @($rows.ToArray())`;
  const pwsh = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7/pwsh.exe');
  const result = spawnSync(existsSync(pwsh) ? pwsh : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, encoding: 'utf8', timeout: 3000, maxBuffer: 8192 });
  if (!result.error && result.status === 0) {
    try {
      const rows = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
      // A reused root PID cannot have new direct children belonging to the
      // original process. Drop their chains before using the snapshot to kill.
      const owned = new Set([child.pid]);
      const descendantsAtFailure = rows.filter(row => {
        if (!owned.has(row.parentPid) || row.parentPid === child.pid && exitedAt !== undefined
          && Number((BigInt(row.createdAtTicks) - 621355968000000000n) / 10000n) > exitedAt) return false;
        owned.add(row.pid); return true;
      });
      return { descendantsAtFailure };
    } catch { /* preserve the diagnostic refusal below */ }
  }
  return { descendantsAtFailure: null, queryExitCode: result.status, querySignal: result.signal,
    queryError: result.error?.message ?? 'Descendant query refused.', queryStderrTail: result.stderr?.slice(-2048) };
}
export function stopChildTree(child, diagnostics) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return { directKillAccepted: child.kill() };
  if (process.platform === 'win32') {
    // Keep a separately identified descendant list: the root can disappear
    // during diagnosis, making taskkill /T unable to find its surviving tree.
    const exited = child.exitCode !== null || child.signalCode !== null;
    const result = exited ? {} : spawnSync(path.join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:/Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
    let descendants;
    const rows = diagnostics?.descendantsAtFailure?.filter(row => Number.isSafeInteger(row.pid) && row.pid > 0 && /^\d+$/.test(row.createdAtTicks));
    if (rows?.length) {
      // Hold each process handle while checking its creation time and killing
      // it. A recycled PID must never address another session's process.
      // CIM timestamps have microsecond precision; StartTime also has 100ns.
      const script = `$ErrorActionPreference='Stop';$rows=ConvertFrom-Json '${JSON.stringify(rows.map(({ pid, createdAtTicks }) => ({ pid, createdAtTicks })))}';$results=@(foreach($row in @($rows)[($rows.Count-1)..0]){$p=$null;try{$p=Get-Process -Id $row.pid -ErrorAction Stop;$null=$p.Handle;if([Math]::Abs($p.StartTime.ToUniversalTime().Ticks-[long]$row.createdAtTicks) -ge 10){@{pid=$row.pid;result='identity differs'}}else{$p.Kill();@{pid=$row.pid;result='kill requested'}}}catch{@{pid=$row.pid;result=$_.Exception.Message}}finally{if($p){$p.Dispose()}}});ConvertTo-Json -Compress -InputObject $results`;
      const pwsh = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7/pwsh.exe');
      const stopped = spawnSync(existsSync(pwsh) ? pwsh : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, encoding: 'utf8', timeout: 3000, maxBuffer: 8192 });
      descendants = { exitCode: stopped.status, error: stopped.error?.message, stdout: stopped.stdout?.slice(-4096), stderrTail: stopped.stderr?.slice(-2048) };
    }
    const directKillAccepted = exited ? false : child.kill('SIGKILL');
    return { method: 'taskkill /T /F', requested: !exited, exitCode: result.status, signal: result.signal, descendants,
      error: result.error?.message, stderrTail: result.stderr?.slice(-2048), directKillAccepted };
  }
  try { process.kill(-child.pid, 'SIGKILL'); return { method: 'process group', killed: true }; }
  catch (error) { return { method: 'process group', error: error.message, directKillAccepted: child.kill('SIGKILL') }; }
}
export function joinChild(child, { timeoutMs = 180000, setTimer = setTimeout, clearTimer = clearTimeout,
  setDrainTimer = setTimeout, clearDrainTimer = clearTimeout,
  label = 'Packed save check', signal: abortSignal, diagnose = inspectChildTree, context = () => ({}) } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, original, drainTimer;
    const outcome = { pid: child.pid, startedAt: Date.now(), exitCode: null, signal: null, exited: false, closed: false, timedOut: false, aborted: false, stdout: '', stderrTail: '' };
    const abort = () => refuse(false);
    child.stdout?.on('data', bytes => { outcome.stdout = (outcome.stdout + bytes.toString()).slice(-8192); });
    child.stderr?.on('data', bytes => { outcome.stderrTail = (outcome.stderrTail + bytes.toString()).slice(-8192); });
    child.on('error', error => { original = error; });
    const clear = () => {
      clearTimer(timer);
      if (drainTimer !== undefined) clearDrainTimer(drainTimer);
      abortSignal?.removeEventListener('abort', abort);
    };
    const shutdownErrors = [];
    const attempt = action => { try { return action(); } catch (error) { shutdownErrors.push(error); } };
    const shutdown = () => {
      outcome.diagnostics = attempt(() => diagnose(child, outcome));
      outcome.context = attempt(context);
      outcome.treeShutdown = attempt(() => stopChildTree(child, outcome.diagnostics));
      for (const stream of new Set([...(child.stdio ?? []), child.stdin, child.stdout, child.stderr])) {
        if (typeof stream?.destroy === 'function') attempt(() => stream.destroy());
      }
      if (child.connected) attempt(() => child.disconnect());
      attempt(() => child.channel?.unref());
      attempt(() => child.unref?.());
    };
    child.once('exit', (code, signal) => {
      Object.assign(outcome, { exitCode: code, signal, exited: true, exitedAt: Date.now() });
      if (settled) return;
      drainTimer = setDrainTimer(() => {
        if (settled) return;
        settled = true;
        clear();
        outcome.drainExpired = true;
        outcome.retainScratch = true;
        shutdown();
        resolve({ ...outcome, original, shutdownErrors });
      }, 100);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clear();
      Object.assign(outcome, { exitCode: code, signal, closed: true, closedAt: Date.now() });
      resolve({ ...outcome, original });
    });
    const refuse = timedOut => {
      if (settled) return;
      settled = true; // kill/destroy may synchronously cause close; timeout wins
      outcome.timedOut = timedOut;
      outcome.aborted = !timedOut;
      clear();
      shutdown();
      const describe = error => error ? { name: error.name, code: error.code, message: error.message } : null;
      const error = new Error(label + (timedOut ? ' timed out: ' : ' cancelled: ') + refusalMessage(JSON.stringify({ ...outcome,
        original: describe(original), shutdownErrors: shutdownErrors.map(describe) })), { cause: original ?? abortSignal?.reason ?? shutdownErrors[0] });
      error.code = timedOut ? 'CHILD_CLOSE_TIMEOUT' : 'CHILD_ABORTED';
      error.retainScratch = true;
      reject(error);
    };
    const timer = setTimer(() => refuse(true), timeoutMs);
    abortSignal?.addEventListener('abort', abort, { once: true });
    if (abortSignal?.aborted) abort();
  });
}
export async function runProbe(config, dataDir, output, { spawnImpl = spawn, readReport = json, setTimer, clearTimer,
  setDrainTimer, clearDrainTimer, signal, onUnjoined = () => {} } = {}) {
  signal?.throwIfAborted();
  const env = sanitizeExecutionEnvironment(process.env, { overrides: { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir,
    RS3_PACK_SELECTION: config.selection.path, RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256,
    RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256, RS3_TASK_WORKER_MODE: 'process' } });
  const child = spawnImpl(config.nodePath, ['--max-old-space-size=2048', fileURLToPath(import.meta.url), 'probe', config.coreRoot, dataDir, output], { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let protocolError;
  const phases = ['spawned'];
  const phaseTimes = [{ phase: 'spawned', at: Date.now() }];
  const joined = joinChild(child, { setTimer, clearTimer, setDrainTimer, clearDrainTimer, signal,
    context: () => ({ phases, phaseTimes, protocolError: protocolError?.message }) });
  child.on('message', message => {
    const expected = ['ready', 'probe', 'closed'][phases.length - 1];
    if (message?.type !== expected) {
      protocolError = new Error('Packed probe protocol differs.'); return;
    }
    phases.push(message.type);
    phaseTimes.push({ phase: message.type, at: Date.now() });
    if (message.type === 'ready') child.send({ type: 'probe' }, error => {
      if (error) {
        protocolError = error;
        try { child.kill(); } catch { /* the independent watchdog still settles */ }
      }
    });
  });
  const outcome = await joined;
  if (!outcome.closed) onUnjoined(outcome);
  const original = outcome.original ?? protocolError;
  if (original || outcome.exitCode !== 0 || outcome.signal !== null || phases.join() !== 'spawned,ready,probe,closed') {
    const error = new Error('Packed save check refused: ' + refusalMessage(JSON.stringify({ ...outcome, phases,
      original: original ? { name: original.name, code: original.code, message: original.message } : null })), { cause: original });
    if (!outcome.closed) error.retainScratch = true;
    throw error;
  }
  return readReport(output);
}
export function datasetAuthoredIdentities(definitions) {
  const datasetAuthored = {}, datasetAuthoredKeys = {};
  for (const [category, rows] of Object.entries(definitions.challenges ?? {})) for (const [label, row] of Object.entries(rows)) {
    const key = 'rs3:' + encodeURIComponent(category.normalize('NFC')) + ':' + encodeURIComponent(label.normalize('NFC'));
    datasetAuthoredKeys[key] = key;
    if (typeof row?.PickerId === 'string') {
      datasetAuthored[row.PickerId] = row.PickerId; datasetAuthored[key] = row.PickerId;
      datasetAuthoredKeys[row.PickerId] = row.PickerId;
    }
  }
  return { datasetAuthored, datasetAuthoredKeys };
}
export function assertStableIdentities(a, b, additions) {
  if (digestValue(a.authored) !== digestValue(b.authored)) throw new Error('Stable task identities changed.');
  if (additions === undefined) {
    if (digestValue(a.saved) !== digestValue(b.saved)) throw new Error('Stable task identities changed.');
    return;
  }
  if (!Array.isArray(additions)) throw new Error('Saved identity additions must be an exact list.');
  const expected = Object.assign(Object.create(null), a.saved), keys = new Set(), oldAuthored = new Set(a.authored.ids ?? []);
  for (const row of additions) {
    if (!row || Object.keys(row).sort().join() !== 'key,target' || typeof row.key !== 'string' || typeof row.target !== 'string'
      || keys.has(row.key) || oldAuthored.has(row.target) || Object.hasOwn(a.authored.aliases ?? {}, row.key)
      || !Object.hasOwn(b.datasetAuthored ?? {}, row.key) || b.datasetAuthored[row.key] !== row.target
      || b.datasetAuthored[row.target] !== row.target || Object.hasOwn(a.datasetAuthored ?? {}, row.key)
      || Object.hasOwn(a.datasetAuthored ?? {}, row.target)
      || Object.hasOwn(a.datasetAuthoredKeys ?? {}, row.key) || Object.hasOwn(a.datasetAuthoredKeys ?? {}, row.target)) throw new Error('Saved identity addition is not newly authored.');
    const resolution = { status: 'resolved', id: row.target, candidates: [row.target] };
    // Rollback retains references that the old pack does not author. Accept only
    // the exact declared resolution; the whole-map digest still guards other keys.
    if (Object.hasOwn(a.saved, row.key) && digestValue(a.saved[row.key]) !== digestValue(resolution)) throw new Error('Saved identity addition is not newly authored.');
    keys.add(row.key);
    expected[row.key] = resolution;
  }
  if (digestValue(expected) !== digestValue(b.saved)) throw new Error('Stable task identities changed outside declared additions.');
}
function assertDailyProgress(a, b) {
  // No series yet: the opening may start one.
  if (a.progressSnapshotMeta === null) return;
  const before = a.progressSnapshotRows, after = b.progressSnapshotRows, last = before.length - 1;
  const kept = a.progressSnapshotMeta === b.progressSnapshotMeta
    && before.every(([day, digest], i) => after[i]?.[0] === day && (i === last || after[i][1] === digest));
  const added = after.slice(before.length).every(([day], i, rows) => day > (i ? rows[i - 1][0] : before.at(-1)?.[0] ?? -Infinity));
  if (!kept || !added) throw new Error('Saved daily progress history changed during compatibility check.');
}
export function assertPreserved(a, b) {
  if (a.itemEvidenceFiles !== undefined && (!Array.isArray(b.itemEvidenceFiles) || digestValue(a.itemEvidenceFiles) !== digestValue(b.itemEvidenceFiles))) throw new Error('Durable plugin item sidecars changed during compatibility check.');
  // Old receivers without a recovery adapter still get exact sidecar identity
  // and portable-provenance checks. New receivers also compare validated unions.
  if (a.itemEvidenceDigest !== undefined && b.itemEvidenceDigest !== undefined && a.itemEvidenceDigest !== b.itemEvidenceDigest) throw new Error('Recovered plugin item evidence changed during compatibility check.');
  const present = new Set(b.taskIds);
  // Startup may append a catalogue-refresh event and its migration audit archive.
  // Retained history is hydrated by backup() before hashing: representation changes
  // in historyArchive cannot conceal a dropped event.
  for (const key of ['historyEvents', 'migrationArchives', 'migrationConversions', 'migrationConflicts']) {
    if (a[key].some((hash, i) => b[key][i] !== hash)) {
      const fields = key === 'historyEvents' ? a[key].flatMap((hash, i) => hash === b[key][i] ? [] : [{ index: i, oldType: a.historyTypes[i], newType: b.historyTypes[i], changedFields: [...new Set([...Object.keys(a.historyFieldDigests?.[i] ?? {}), ...Object.keys(b.historyFieldDigests?.[i] ?? {})])].filter(field => a.historyFieldDigests?.[i]?.[field] !== b.historyFieldDigests?.[i]?.[field]) }]).slice(0, 10) : [];
      throw new Error('Saved history or migration archive was dropped or changed: ' + key + '; counts=' + a[key].length + ',' + b[key].length + '; changes=' + JSON.stringify(fields));
    }
  }
  if (b.historyTypes.slice(a.historyEvents.length).some(type => type !== 'catalogue-refresh')) throw new Error('Unexpected history appended during startup.');
  // Daily progress counts are derived, not progress: an opening may recount the
  // latest day (a release can count it differently) or start a new one. Every
  // earlier day and every authoritative field must stay identical.
  const daily = a.progressSnapshotRows !== undefined && b.progressSnapshotRows !== undefined;
  if (daily) assertDailyProgress(a, b);
  const fields = report => daily ? Object.fromEntries(Object.entries(report.progressFields).filter(([key]) => key !== 'progressSnapshots')) : report.progressFields;
  const [before, after] = [fields(a), fields(b)];
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]);
  if ((daily ? changed.length : a.progressDigest !== b.progressDigest) || a.taskIds.some(id => !present.has(id))) {
    throw new Error('Saved progress or tasks changed during compatibility check: fields=' + changed.join(',') + '; missingTasks=' + a.taskIds.filter(id => !present.has(id)).length);
  }
}
export async function checkPackTransition({ fromConfig, toConfig, transition, output, probeImpl = runProbe, signal }) {
  signal?.throwIfAborted();
  const plan = typeof transition === 'string' ? await json(transition) : transition;
  const from = await configDescriptor(fromConfig), to = await configDescriptor(toConfig);
  const reverse = from.pin.sha256 === plan.newConfig?.sha256 && to.pin.sha256 === plan.oldConfig?.sha256;
  const old = reverse ? to : from, next = reverse ? from : to;
  if (![1, 2].includes(plan.schemaVersion) || (plan.savedIdentityAdditions !== undefined && plan.schemaVersion !== 2) || digestValue(old.pin) !== digestValue(plan.oldConfig) || digestValue(next.pin) !== digestValue(plan.newConfig)) throw new Error('Transition config pins differ.');
  assertDescriptor(old.descriptor, plan.old); assertDescriptor(next.descriptor, plan.new);
  if (old.config.dataDir !== next.config.dataDir || sha(bindingBytes(plan.new)) !== plan.new.bindingSha256
    || Buffer.from(plan.newBindingBase64 ?? '', 'base64').compare(bindingBytes(plan.new))) throw new Error('Transition binding or storage differs.');
  // Old binding bytes may have legacy formatting; preserve them exactly for rollback.
  const oldBytes = Buffer.from(plan.oldBindingBase64 ?? '', 'base64');
  if (sha(oldBytes) !== plan.old.bindingSha256) throw new Error('Old binding bytes differ.');
  const oldBinding = JSON.parse(oldBytes);
  for (const key of ['datasetId', 'datasetContractVersion', 'digest']) if (oldBinding[key] !== plan.old[key]) throw new Error('Old binding descriptor differs.');
  if (oldBinding.schemaVersion !== 1 || oldBinding.requiresPack !== true || Object.keys(oldBinding).some(key => !['schemaVersion','datasetId','datasetContractVersion','digest','requiresPack'].includes(key))) throw new Error('Packed old binding required.');
  const actual = sha(await readFile(await regular(from.config.dataDir + '.dataset.json')));
  // Recovery can find either end of the pair, but never an unrecognized binding.
  if (![plan.old.bindingSha256, plan.new.bindingSha256].includes(actual)) throw new Error('Current binding differs.');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-pack-compat-'));
  const before = await saveIdentity(from.config.dataDir);
  const reports = [];
  let retainScratch = false;
  const probeOptions = { signal, onUnjoined: () => { retainScratch = true; } };
  try {
    // Rollback needs the retained target to open the latest save. It must not
    // depend on successfully starting code that the operator is replacing.
    const selections = reverse ? [['old', old, plan.old]] : [['old', old, plan.old], ['new', next, plan.new]];
    for (const [name, entry, descriptor] of selections) {
      const copy = path.join(scratch, name);
      // Migrate the checked old-startup result, so ordinary catalogue-refresh
      // events have one authoritative timestamp and remain a true history prefix.
      await snapshot(name === 'new' ? path.join(scratch, 'old') : from.config.dataDir, copy);
      await writeFile(copy + '.dataset.json', bindingBytes(descriptor), { flag: 'wx' });
      reports.push(await probeImpl(entry.config, copy, path.join(scratch, name + '.json'), probeOptions));
    }
    if (!reverse) {
      assertStableIdentities(...reports, plan.savedIdentityAdditions);
      assertPreserved(...reports);
      // Opening the new save can migrate it. Prove that old code/packs also open that result.
      const rollbackCopy = path.join(scratch, 'rollback'); await snapshot(path.join(scratch,'new'), rollbackCopy);
      await writeFile(rollbackCopy+'.dataset.json',bindingBytes(plan.old),{flag:'wx'});
      const rollbackReport = await probeImpl(old.config,rollbackCopy,path.join(scratch,'rollback.json'), probeOptions);
      assertStableIdentities(reports[1],rollbackReport);
      assertPreserved(reports[1],rollbackReport);
      if (reports[1].registryDigest !== rollbackReport.registryDigest) throw new Error('Rollback dropped saved registry data.');
      const forwardCopy = path.join(scratch, 'forward'); await snapshot(rollbackCopy, forwardCopy);
      await writeFile(forwardCopy+'.dataset.json',bindingBytes(plan.new),{flag:'wx'});
      const forwardReport = await probeImpl(next.config,forwardCopy,path.join(scratch,'forward.json'), probeOptions);
      assertStableIdentities(reports[1],forwardReport);
      assertPreserved(reports[1],forwardReport);
      if (reports[1].registryDigest !== forwardReport.registryDigest) throw new Error('Forward reopening changed saved registry data.');
      reports.push(rollbackReport, forwardReport);
    }
    if (digestValue(await saveIdentity(from.config.dataDir)) !== digestValue(before)) throw new Error('Save changed during compatibility check.');
    const result = { schemaVersion: 2, passed: true, forwardAfterRollback: !reverse, progressPreserved: true, tasksServed: reports.every(r => r.tasksServed), declaredAdditions: plan.savedIdentityAdditions?.length ?? 0, probes: reports.map(r => ({ progressDigest: r.progressDigest, savedCount: Object.keys(r.saved).length, historyCount: r.historyEvents.length, migrationArchiveCount: r.migrationArchives.length, registryDigest: r.registryDigest, taskCount: r.taskIds.length, tasksServed: r.tasksServed })), bothDirections: !reverse, rollbackTargetOpened: reverse, saveDigest: digestValue(before),
      old: plan.old, new: plan.new, identitiesDigest: digestValue(reports[0]), checkedAt: new Date().toISOString() };
    signal?.throwIfAborted();
    if (retainScratch) result.retainedScratchDirectory = scratch;
    if (output) await writeFile(output, encode(result), { flag: 'wx' });
    return result;
  } catch (error) {
    if (retainScratch || error.retainScratch) {
      retainScratch = true;
      error.retainScratch = true;
      error.retainedScratchDirectory = scratch;
      error.message += '; scratch retained at ' + scratch;
    }
    if (output) await writeFile(output + '.failure.json', encode({ passed: false, cause: refusalMessage(error),
      retainedScratchDirectory: retainScratch ? scratch : undefined,
      probes: reports.map(r => ({ savedCount: Object.keys(r.saved).length, taskCount: r.taskIds.length, historyCount: r.historyEvents.length, progressDigest: r.progressDigest, migration: r.migrationSummary })) }), { flag: 'wx' });
    throw error;
  } finally { if (!retainScratch) await rm(scratch, { recursive: true, force: true }); }
}
export async function probe(core, dataDir, output, { retention, ready = async () => {}, notify = () => {} } = {}) {
  const { authoredIdentityRegistry, resolveIdentity } = await import(pathToFileURL(path.join(core, 'app/tasks/identity.mjs')));
  const { loadDatasetInputs } = await import(pathToFileURL(path.join(core, 'app/dataset-bootstrap.mjs')));
  const { prepareTaskDefinitions } = await import(pathToFileURL(path.join(core, 'app/dataset-pipeline.mjs')));
  const { createServer } = await import(pathToFileURL(path.join(core, 'app/server.mjs')));
  const app = await createServer({ dataDir, host: '127.0.0.1', port: 0, loopbackPort: undefined, predictionPrewarm: false, retention, taskWorkerOptions: { warmStoreDirectory: false },
    runeMetrics: { fetchImpl: async () => { throw new Error('Offline compatibility check'); } },
    originalSync: { fetchImpl: async () => { throw new Error('Offline compatibility check'); } } });
  try {
    await app.listen();
    await ready();
    const state = app.store.getState();
    const invite = new URL(app.inviteUrl);
    const response = await fetch(invite.origin + '/api/tasks?view=play-v1&memberId=' + encodeURIComponent(state.members[0].id), { headers: { Authorization: 'Bearer ' + invite.pathname.slice('/join/'.length) }, signal: AbortSignal.timeout(120000) });
    if (!response.ok || !Array.isArray((await response.json()).tasks)) throw new Error('Packed task serving refused.');
    const inputs = await loadDatasetInputs(app.dataset, { loadTaskMap: false });
    const definitions = prepareTaskDefinitions(JSON.parse(inputs.definitionBytes), app.dataset);
    // Count all authored keys while keeping explicit PickerId proof separate.
    const { datasetAuthored, datasetAuthoredKeys } = datasetAuthoredIdentities(definitions);
    const progress = Object.fromEntries(Object.entries(state).filter(([key]) => !['identityRegistry', 'tasks', 'legacy', 'revision', 'history', 'provenance'].includes(key)));
    progress.provenance = Object.fromEntries(Object.entries(state.provenance ?? {}).filter(([key]) => !['taskIdentityMigration', 'historyArchive', 'pluginItemEvidenceReconciled'].includes(key)));
    // Include retained history in the real storage decoder's compatibility check.
    const backup = await app.store.backup();
    const itemEvidenceFiles = (await saveIdentity(dataDir)).filter(row => itemFiles.includes(row.path));
    const adapter = path.join(core, 'app/plugin-items.mjs');
    let items;
    try { await regular(adapter); items = await import(pathToFileURL(path.join(core, 'app/plugin-items.mjs'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const owners = new Set(state.members.map(member => member.id));
    const itemEvidenceDigest = typeof items?.exportPluginItemEvidence === 'function'
      ? digestValue(await items.exportPluginItemEvidence(dataDir, id => owners.has(id) ? id : undefined, backup.state?.provenance?.pluginItemEvidence)) : undefined;
    const completeHistory = backup.state?.history ?? state.history ?? [];
    const migration = state.provenance?.taskIdentityMigration ?? {};
    if (migration.lostRecords !== undefined && migration.lostRecords !== 0) throw new Error('Migration reports lost saved records.');
    const migrationSummary = { lostRecords: migration.lostRecords ?? 0, conflicts: (migration.conflicts ?? []).length,
      conflictReasons: Object.fromEntries([...new Set((migration.conflicts ?? []).map(row => row.reason))].map(reason => [reason, migration.conflicts.filter(row => row.reason === reason).length])),
      archiveHistoryCounts: (migration.archives ?? []).map(row => row.history?.length ?? 0) };
    const preserved = { migrationSummary, historyFieldDigests: completeHistory.map(event => Object.fromEntries(Object.entries(event).map(([key, value]) => [key, digestValue(value)]))), historyEvents: completeHistory.map(digestValue), historyTypes: completeHistory.map(event => event.type),
      migrationArchives: (migration.archives ?? []).map(digestValue), migrationConversions: (migration.conversions ?? []).map(digestValue), migrationConflicts: (migration.conflicts ?? []).map(digestValue) };
    Object.assign(preserved, { itemEvidenceFiles, itemEvidenceDigest });
    const saved = {};
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:rs3:|t_)/.test(key)) saved[key] = resolveIdentity(key, state.identityRegistry);
        if (typeof child === 'string' && /^(?:rs3:|t_)/.test(child)) saved[child] = resolveIdentity(child, state.identityRegistry);
        else visit(child);
      }
    };
    visit(state);
    const registry = authoredIdentityRegistry();
    const authored = { ids: Object.keys(registry.entries).sort(), aliases: registry.aliases };
    await writeFile(output, encode({ authored, saved, datasetAuthored, datasetAuthoredKeys, ...preserved, progressFields: Object.fromEntries(Object.entries(progress).map(([key, value]) => [key, digestValue(value)])), registryDigest: digestValue(state.identityRegistry ?? {}), progressDigest: digestValue(progress), progressSnapshotRows: (state.progressSnapshots?.days ?? []).map(row => [row[0], digestValue(row)]), progressSnapshotMeta: state.progressSnapshots ? digestValue(Object.fromEntries(Object.entries(state.progressSnapshots).filter(([key]) => key !== 'days'))) : null, taskIds: state.tasks.map(t => t.id).sort(), tasksServed: true }), { flag: 'wx' });
    notify('probe');
  } finally { await app.close(); notify('closed'); }
}
// Self-contained: this module is also copied flat into PC kits.
// Eval imports are never CLI entrypoints, even when eval has positional args.
function isCliEntry() {
  if (process.execArgv.some(arg => /^(?:-[a-zA-Z]*[ep]|--(?:eval|print)(?:=|$))/.test(arg))) return false;
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; } // Import callers may pass a non-path argument.
}
if (isCliEntry()) {
  try {
    if (process.argv[2] === 'probe') {
      const notify = type => process.send?.({ type });
      const ready = process.send ? () => new Promise((resolve, reject) => {
        process.once('message', message => message?.type === 'probe' ? resolve() : reject(new Error('Packed probe command refused.')));
        notify('ready');
      }) : undefined;
      try { await probe(...process.argv.slice(3, 6), { ready, notify }); }
      finally { if (process.connected) process.disconnect(); }
    }
    else if (process.argv[2] === 'check') await checkPackTransition({ fromConfig: process.argv[3], toConfig: process.argv[4], transition: process.argv[5], output: process.argv[6] });
    else throw new Error('Pack check command refused.');
  } catch (error) { console.error('Pack compatibility refused; storage unchanged. Cause: ' + refusalMessage(error) + (error.code ? '; code=' + error.code : '')); process.exitCode = 1; }
}
