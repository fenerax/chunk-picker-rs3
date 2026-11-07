// Read-only source storage; packed startup is exercised only on disposable copies.
import path from 'node:path';
import os from 'node:os';
import { realpathSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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
export async function runProbe(config, dataDir, output, {
  spawnImpl = spawn, setTimer = setTimeout, clearTimer = clearTimeout, readReport = json, signal,
} = {}) {
  const env = sanitizeExecutionEnvironment(process.env, { overrides: { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir,
    RS3_PACK_SELECTION: config.selection.path, RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256,
    RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256, RS3_TASK_WORKER_MODE: 'process' } });
  const childResult = { stage: 'probe:' + path.basename(output, '.json'), pid: null,
    exitObserved: false, closeObserved: false, exitCode: null, signal: null, stderrTail: '', termination: null };
  await new Promise((resolve, reject) => {
    let child, primary, done = false, stopping = false, watchdog, drain, cleanup, detail = '';
    const cleanupFailures = [];
    const attempt = fn => { try { return fn(); } catch (error) { cleanupFailures.push(error); } };
    const finish = () => {
      if (done) return;
      done = true;
      childResult.stderrTail = refusalMessage(detail.trim());
      for (const timer of [watchdog, drain, cleanup]) attempt(() => clearTimer(timer));
      attempt(() => signal?.removeEventListener('abort', onAbort));
      for (const pipe of [child?.stdout, child?.stderr]) {
        // Pipe EOF is not an ownership acknowledgement: a descendant can inherit it.
        attempt(() => pipe?.off('data', onData));
        attempt(() => pipe?.destroy());
      }
      if (child) {
        attempt(() => child.off('exit', onExit));
        attempt(() => child.off('close', onClose));
        // Keep the error listener to absorb a late asynchronous spawn/kill error.
        attempt(() => child.unref());
      }
      if (cleanupFailures.length) {
        primary ??= new Error('Packed save check cleanup failed.');
        primary.cleanupFailure = new AggregateError(cleanupFailures, 'Probe cleanup failed.');
      }
      if (primary) reject(Object.assign(primary, { childResult })); else resolve();
    };
    const stop = cause => {
      if (done || stopping) return;
      primary = cause; stopping = true;
      attempt(() => clearTimer(watchdog)); attempt(() => clearTimer(drain));
      if (!child || childResult.exitObserved || childResult.closeObserved || !child.pid) return finish();
      childResult.termination = { strategy: 'child-handle', joined: false, killAccepted: false };
      // Never address a numeric PID or traverse a process tree on the shared PC.
      // Arm the budget before kill(), which can synchronously emit exit in a seam.
      cleanup = setTimer(() => {
        cleanupFailures.push(new Error('Direct probe exit was not acknowledged; retain its scratch store.'));
        finish();
      }, 15000);
      attempt(() => { childResult.termination.killAccepted = child.kill('SIGKILL'); });
    };
    const onData = bytes => { detail = (detail + bytes.toString()).slice(-4096); };
    const onError = error => {
      if (done) return;
      if (stopping || childResult.exitObserved || childResult.closeObserved) cleanupFailures.push(error);
      else stop(error);
    };
    const onAbort = () => {
      const cause = signal.reason instanceof Error ? signal.reason : new Error('Packed save check aborted.', { cause: signal.reason });
      // Exit is the probe's outcome. Cancellation during diagnostic drain cannot
      // replace either its refusal or its success.
      if (childResult.exitObserved || childResult.closeObserved) {
        (childResult.secondaryNotes ??= []).push(cause);
        return;
      }
      stop(cause);
    };
    const recordExit = (code, reason) => {
      if (childResult.exitObserved || childResult.closeObserved) return;
      childResult.exitCode = code; childResult.signal = reason ?? null;
      if (!stopping && (code !== 0 || reason)) primary = new Error('Packed save check refused: ' + refusalMessage(detail.trim()));
    };
    const onExit = (code, reason) => {
      recordExit(code, reason); childResult.exitObserved = true;
      if (stopping) { childResult.termination && (childResult.termination.joined = true); return finish(); }
      attempt(() => clearTimer(watchdog));
      // Retain late stderr without making inherited pipe closure a prerequisite.
      drain = setTimer(finish, 25);
    };
    const onClose = (code, reason) => {
      recordExit(code, reason); childResult.closeObserved = true;
      if (stopping) { childResult.termination && (childResult.termination.joined = true); }
      finish();
    };
    if (signal?.aborted) return onAbort();
    try {
      child = spawnImpl(config.nodePath, ['--max-old-space-size=2048', fileURLToPath(import.meta.url), 'probe', config.coreRoot, dataDir, output], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      childResult.pid = child.pid ?? null;
      child.stderr?.on('data', onData);
      child.on('error', onError); child.once('exit', onExit); child.once('close', onClose);
      watchdog = setTimer(() => stop(new Error('Packed save check timed out.')), 180000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    } catch (error) { stop(error); }
  });
  try { return await readReport(output); }
  catch (error) { throw Object.assign(error, { childResult }); }
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
export async function cleanupProbeScratch(scratch, primary, remove = rm) {
  try {
    if (primary?.childResult?.termination?.joined === false) throw new Error('Unjoined probe scratch retained: ' + scratch);
    await remove(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    if (!primary) throw error;
    primary.cleanupFailure = new AggregateError([primary.cleanupFailure, error].filter(Boolean), 'Scratch cleanup failed.');
  }
}
export async function checkPackTransition({ fromConfig, toConfig, transition, output }) {
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
  const reports = []; let primary;
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
      reports.push(await runProbe(entry.config, copy, path.join(scratch, name + '.json')));
    }
    if (!reverse) {
      assertStableIdentities(...reports, plan.savedIdentityAdditions);
      assertPreserved(...reports);
      // Opening the new save can migrate it. Prove that old code/packs also open that result.
      const rollbackCopy = path.join(scratch, 'rollback'); await snapshot(path.join(scratch,'new'), rollbackCopy);
      await writeFile(rollbackCopy+'.dataset.json',bindingBytes(plan.old),{flag:'wx'});
      const rollbackReport = await runProbe(old.config,rollbackCopy,path.join(scratch,'rollback.json'));
      assertStableIdentities(reports[1],rollbackReport);
      assertPreserved(reports[1],rollbackReport);
      if (reports[1].registryDigest !== rollbackReport.registryDigest) throw new Error('Rollback dropped saved registry data.');
      const forwardCopy = path.join(scratch, 'forward'); await snapshot(rollbackCopy, forwardCopy);
      await writeFile(forwardCopy+'.dataset.json',bindingBytes(plan.new),{flag:'wx'});
      const forwardReport = await runProbe(next.config,forwardCopy,path.join(scratch,'forward.json'));
      assertStableIdentities(reports[1],forwardReport);
      assertPreserved(reports[1],forwardReport);
      if (reports[1].registryDigest !== forwardReport.registryDigest) throw new Error('Forward reopening changed saved registry data.');
      reports.push(rollbackReport, forwardReport);
    }
    if (digestValue(await saveIdentity(from.config.dataDir)) !== digestValue(before)) throw new Error('Save changed during compatibility check.');
    const result = { schemaVersion: 2, passed: true, forwardAfterRollback: !reverse, progressPreserved: true, tasksServed: reports.every(r => r.tasksServed), declaredAdditions: plan.savedIdentityAdditions?.length ?? 0, probes: reports.map(r => ({ progressDigest: r.progressDigest, savedCount: Object.keys(r.saved).length, historyCount: r.historyEvents.length, migrationArchiveCount: r.migrationArchives.length, registryDigest: r.registryDigest, taskCount: r.taskIds.length, tasksServed: r.tasksServed })), bothDirections: !reverse, rollbackTargetOpened: reverse, saveDigest: digestValue(before),
      old: plan.old, new: plan.new, identitiesDigest: digestValue(reports[0]), checkedAt: new Date().toISOString() };
    if (output) await writeFile(output, encode(result), { flag: 'wx' });
    return result;
  } catch (error) {
    primary = error;
    try {
      if (output) await writeFile(output + '.failure.json', encode({ passed: false, cause: refusalMessage(error), childResult: error.childResult,
        probes: reports.map(r => ({ savedCount: Object.keys(r.saved).length, taskCount: r.taskIds.length, historyCount: r.historyEvents.length, progressDigest: r.progressDigest, migration: r.migrationSummary })) }), { flag: 'wx' });
    } catch (failure) { error.failureReportFailure = failure; }
    throw error;
  } finally { await cleanupProbeScratch(scratch, primary); }
}
export async function probe(core, dataDir, output, { retention } = {}) {
  const { authoredIdentityRegistry, resolveIdentity } = await import(pathToFileURL(path.join(core, 'app/tasks/identity.mjs')));
  const { loadDatasetInputs } = await import(pathToFileURL(path.join(core, 'app/dataset-bootstrap.mjs')));
  const { prepareTaskDefinitions } = await import(pathToFileURL(path.join(core, 'app/dataset-pipeline.mjs')));
  const port = 0;
  const { createServer } = await import(pathToFileURL(path.join(core, 'app/server.mjs')));
  const app = await createServer({ dataDir, host: '127.0.0.1', port, loopbackPort: undefined, predictionPrewarm: false, retention, taskWorkerOptions: { warmStoreDirectory: false },
    runeMetrics: { fetchImpl: async () => { throw new Error('Offline compatibility check'); } },
    originalSync: { fetchImpl: async () => { throw new Error('Offline compatibility check'); } } });
  try {
    await app.listen();
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
  } finally { await app.close(); }
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
    if (process.argv[2] === 'probe') await probe(...process.argv.slice(3));
    else if (process.argv[2] === 'check') await checkPackTransition({ fromConfig: process.argv[3], toConfig: process.argv[4], transition: process.argv[5], output: process.argv[6] });
    else throw new Error('Pack check command refused.');
  } catch (error) { console.error('Pack compatibility refused; storage unchanged. Cause: ' + refusalMessage(error)); process.exitCode = 1; }
}
