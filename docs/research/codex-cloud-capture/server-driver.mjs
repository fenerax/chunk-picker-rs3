// Test-only process controller. No application import occurs when imported as a module.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, mkdir, readdir, realpath, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {installObservedSource,createCloseCollector} from './close-observation.mjs';

export const SOURCE_COMMIT = '6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const FIXTURE_SHA256 = '380ffb698ea594ccb1d375321708a4369f50da82fdc796fd91a4a8c8038b8022';
export const PROTOCOL = 'r116-server-driver-v1';
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CRITICAL_FILES = Object.freeze({
  'app/server.mjs': '5edc544473fe98ba1bdf42deaf8cceccbea9db5fa9f42d51daa111f3eb9ceb25',
  'app/storage/store.mjs': 'bcdd2a3fa7d07403ad76ac34f44e0754ef31ee8f6f204fd29ea0e0231d4b0f06',
  'app/datasets.mjs': '6e251ab2609ff201eb7b1442fee9554fe04ecc7b52a957963016631c8500db8e',
  'app/dataset-runtime.mjs': 'cceb3f3a3bcd2d14f8ac412188929c47c44c155320230818f3227e01d0231000',
  'app/core/state.mjs': '52252d48d0b15b524bffe629f14e876131a0ad55bf0e61f6c42560c5dc2d2c69',
  'app/private-addon.mjs': '7e657c627d4d00237ccd084fb6026ea75236d04ef858d101b1bfc0ae3116ad88',
});
const REQUIRED_PHASES = ['before', 'before-all', 'after-frames'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestBytes = bytes => ({ sha256: sha256(bytes), bytes: bytes.byteLength });
const fail = code => { throw Object.assign(new Error(code), { driverCode: code }); };
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

// Raw exception messages can contain saved values, tokens, paths or URLs. Retain
// their class and safe code, never their message, stack, state, cause or headers.
export function safeError(error) {
  const allowedName = /^(?:Error|TypeError|RangeError|SyntaxError|AbortError)$/;
  return {
    name: allowedName.test(error?.name ?? '') ? error.name : 'Error',
    code: typeof error?.driverCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.driverCode)
      ? error.driverCode : typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : null,
    message: 'Server driver operation failed; details withheld to protect saved values and credentials.',
  };
}

export function sameSnapshot(left, right) {
  return Boolean(left && right && !left.errors.length && !right.errors.length
    && left.revision === right.revision && left.calculationRevision === right.calculationRevision
    && left.fullStateRevision === right.fullStateRevision
    && left.calculation?.sha256 === right.calculation?.sha256 && left.calculation?.bytes === right.calculation?.bytes
    && left.fullState?.sha256 === right.fullState?.sha256 && left.fullState?.bytes === right.fullState?.bytes);
}

/** All store reads and the subscriber capture are synchronous. No app wrappers. */
export function createWitnessJournal(store, { clock = () => performance.now(), onCommit = () => {} } = {}) {
  const journal = [], captureErrors = [], witnesses = new Map();
  let sequence = 0, active, closed = false, finalSnapshot;
  function capture(phase) {
    const result = { sequence: ++sequence, phase, at: clock(), errors: [] };
    const retain = (stage, error) => {
      const retained = { sequence: result.sequence, stage, error: safeError(error) };
      result.errors.push(retained); captureErrors.push(retained);
    };
    try { result.revision = store.getInfo().revision; }
    catch (error) { retain('getInfo', error); }
    let calculation;
    try {
      calculation = store.getCalculationSnapshot();
      result.calculationRevision = calculation.revision;
      const raw = calculation.stateJSON;
      // This hashes the exact bytes returned by the real store, without parsing,
      // reserializing, dropping a field, or replacing them with taskInputKey.
      const bytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw);
      result.calculation = digestBytes(bytes);
    } catch (error) { retain('getCalculationSnapshot.stateJSON', error); }
    try {
      const state = store.getState();
      result.fullStateRevision = state.revision;
      result.fullState = digestBytes(Buffer.from(JSON.stringify(state)));
    } catch (error) { retain('getState', error); }
    try {
      const inputKey = calculation?.inputKey, taskInputKey = calculation?.taskInputKey;
      if (!HASH.test(inputKey ?? '') || !HASH.test(taskInputKey ?? '')) fail('INVALID_SUPPLEMENTARY_KEYS');
      result.supplementary = { inputKey, taskInputKey, equalityAuthority: false };
    } catch (error) { retain('supplementary-keys', error); }
    if (![result.revision, result.calculationRevision, result.fullStateRevision].every(value => Number.isSafeInteger(value) && value >= 0)
      || result.revision !== result.calculationRevision || result.revision !== result.fullStateRevision)
      retain('revision-consistency', Object.assign(new Error(), { driverCode: 'SNAPSHOT_REVISION_MISMATCH' }));
    return result;
  }
  const unsubscribe = store.subscribe(event => {
    // Increment and retain the event before attempting any fallible capture.
    const entry = { index: journal.length, at: clock(), revision: Number.isSafeInteger(event?.revision) ? event.revision : null,
      ownershipChanged: event?.ownershipChanged === true, noteEdit: event?.noteEdit === true };
    journal.push(entry);
    try { entry.snapshot = capture('commit'); }
    catch (error) {
      const retained = { sequence: ++sequence, stage: 'subscriber-capture', error: safeError(error) };
      captureErrors.push(retained); entry.captureError = retained;
    }
    // Notification is supplementary. A disconnected parent cannot erase a row.
    try { onCommit(entry); } catch (error) {
      const retained = { sequence: ++sequence, stage: 'subscriber-notification', error: safeError(error) };
      captureErrors.push(retained); entry.notificationError = retained;
    }
  });
  const tokenKey = token => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(token)) fail('INVALID_WITNESS_TOKEN');
    return sha256(token);
  };
  function evaluate(witness, finalized = closed) {
    const reasons = [];
    if (!witness.finished) reasons.push('finish-not-received');
    if (journal.length) reasons.push('commit-observed-after-subscription');
    if (captureErrors.length) reasons.push('capture-error-retained');
    for (const phase of REQUIRED_PHASES) if (!witness.snapshots[phase]) reasons.push(`missing-${phase}`);
    const samples = [witness.begin, ...REQUIRED_PHASES.map(phase => witness.snapshots[phase]), witness.finish].filter(Boolean);
    if (samples.some(sample => !sameSnapshot(witness.begin, sample))) reasons.push('snapshot-changed');
    if (finalized && !sameSnapshot(witness.begin, finalSnapshot)) reasons.push('closed-snapshot-changed');
    return { tokenSha256: witness.tokenSha256, valid: reasons.length === 0, provisional: !finalized,
      reasons, journalAtBegin: witness.journalAtBegin, journalAtFinish: witness.journalAtFinish ?? null,
      finalJournalLength: journal.length, begin: witness.begin, snapshots: witness.snapshots, finish: witness.finish ?? null };
  }
  return {
    capture,
    snapshot(phase) {
      if (!REQUIRED_PHASES.includes(phase)) fail('INVALID_SNAPSHOT_PHASE');
      if (!active) fail('NO_ACTIVE_WITNESS');
      if (active.snapshots[phase]) fail('DUPLICATE_SNAPSHOT_PHASE');
      const expected = REQUIRED_PHASES[Object.keys(active.snapshots).length];
      if (phase !== expected) fail('SNAPSHOT_PHASE_ORDER');
      const sample = capture(phase); active.snapshots[phase] = sample; return sample;
    },
    begin(token) {
      if (active || closed) fail('WITNESS_ALREADY_ACTIVE_OR_CLOSED');
      const tokenSha256 = tokenKey(token);
      if (witnesses.has(tokenSha256)) fail('WITNESS_TOKEN_REUSED');
      active = { tokenSha256, journalAtBegin: journal.length, begin: capture('begin'), snapshots: {} };
      witnesses.set(tokenSha256, active); return { tokenSha256, snapshot: active.begin };
    },
    finish(token) {
      if (!active || active.tokenSha256 !== tokenKey(token)) fail('WITNESS_TOKEN_MISMATCH');
      active.finish = capture('finish'); active.finished = true; active.journalAtFinish = journal.length;
      const result = evaluate(active); active = undefined; return result;
    },
    journalReceipt(token) {
      const witness = witnesses.get(tokenKey(token));
      if (!witness) fail('UNKNOWN_WITNESS_TOKEN');
      return { installedBeforeBegin: true, beginSequence: witness.journalAtBegin,
        endSequence: journal.length, witnessEndSequence: witness.journalAtFinish ?? null,
        events: [...journal], captureErrors: [...captureErrors],
        subscriptionScope: 'app-ready through resolved app.close' };
    },
    // Call only after normal app.close() resolves. The store API remains readable
    // after close; its queue/maintenance and sidecars have drained by this point.
    finalize() {
      finalSnapshot = capture('after-close'); closed = true; unsubscribe();
      return { finalSnapshot, journal, captureErrors, witnesses: [...witnesses.values()].map(witness => evaluate(witness, true)),
        commitInFlight: { observable: false, reason: 'Store queue is private; no wrapper or beforeCommit override was installed.',
          drainedByNormalClose: true }, subscriptionScope: 'app-ready through resolved app.close' };
    },
    status: () => ({ journalLength: journal.length, captureErrors: [...captureErrors], active: Boolean(active), closed }),
  };
}

export function parseArguments(argv) {
  const options = {};
  const valued = new Set(['source', 'repo', 'scratch', 'store', 'deps', 'fixture', 'source-commit', 'source-lock', 'source-manifest-sha256']);
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index].replace(/^--/, '');
    if (argv[index] === '--initial') { if (options.initial) fail('DUPLICATE_ARGUMENT'); options.initial = true; continue; }
    if (!argv[index].startsWith('--') || !valued.has(name) || Object.hasOwn(options, name)) fail('INVALID_ARGUMENT');
    const value = argv[++index]; if (!value || value.startsWith('--')) fail('MISSING_ARGUMENT_VALUE');
    options[name] = value;
  }
  if (options.source && options.repo) fail('DUPLICATE_SOURCE_ARGUMENT');
  return options;
}

async function readOwner(storeDirectory) {
  try {
    const bytes = await readFile(path.join(storeDirectory, 'store.lock'));
    const owner = JSON.parse(bytes);
    // The nonce, hostname, token and timestamp never leave the child.
    return { present: true, sameProcess: owner.pid === process.pid, startVerified: owner.startVerified === true,
      ownerRecordSha256: sha256(bytes) };
  } catch (error) { if (error.code === 'ENOENT') return { present: false, sameProcess: false }; throw error; }
}

export async function runDriver(argv = process.argv.slice(2)) {
  if (!process.send) fail('IPC_REQUIRED');
  if (process.version !== 'v24.19.0') fail('PINNED_NODE_VERSION_REQUIRED');
  // Clear these before every dynamic application import. FD 3 is process IPC.
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') || key === 'PERF_STAGE_FD') delete process.env[key];
  delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
  const args = parseArguments(argv);
  if (!args.scratch || !(args.source ?? args.repo) || !args.fixture) fail('REQUIRED_PATH_ARGUMENT_MISSING');
  const source = await realpath(args.source ?? args.repo);
  const scratch = await realpath(args.scratch);
  if (source === scratch || inside(source, scratch) || inside(scratch, source)) fail('SOURCE_SCRATCH_NOT_DISJOINT');
  process.chdir(scratch);
  const sourceCommit = args['source-commit'] ?? SOURCE_COMMIT;
  if (!COMMIT.test(sourceCommit)) fail('INVALID_SOURCE_COMMIT');
  let manifestSha256 = args['source-manifest-sha256'];
  if (manifestSha256 !== undefined && !HASH.test(manifestSha256)) fail('INVALID_SOURCE_MANIFEST_DIGEST');
  let criticalFiles = CRITICAL_FILES, sourceLockSha256 = null;
  if (args['source-lock']) {
    const lockBytes = await readFile(args['source-lock']), lock = JSON.parse(lockBytes);
    sourceLockSha256 = sha256(lockBytes);
    if (lock.schemaVersion !== 1 || lock.sourceCommit !== sourceCommit || !HASH.test(lock.manifestSha256 ?? '')
      || (manifestSha256 && lock.manifestSha256 !== manifestSha256) || !lock.criticalFiles || Array.isArray(lock.criticalFiles)) fail('INVALID_SOURCE_LOCK');
    for (const required of Object.keys(CRITICAL_FILES)) if (!HASH.test(lock.criticalFiles[required] ?? '')) fail('SOURCE_LOCK_ANCHOR_MISSING');
    criticalFiles = lock.criticalFiles; manifestSha256 ??= lock.manifestSha256;
  } else if (sourceCommit !== SOURCE_COMMIT) fail('DECLARED_SOURCE_LOCK_REQUIRED_FOR_OTHER_COMMIT');
  const actualCriticalFiles = {};
  for (const [relative, expected] of Object.entries(criticalFiles)) {
    if (!HASH.test(expected) || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '..' || part === '.')) fail('INVALID_SOURCE_LOCK_PATH');
    const filename = await realpath(path.join(source, relative));
    if (!inside(source, filename)) fail('SOURCE_PATH_ESCAPED');
    const actual = sha256(await readFile(filename));
    if (actual !== expected) fail('SOURCE_ANCHOR_MISMATCH');
    actualCriticalFiles[relative] = actual;
  }
  const fixtureBytes = await readFile(args.fixture);
  if (sha256(fixtureBytes) !== FIXTURE_SHA256) fail('FIXTURE_DIGEST_MISMATCH');
  const fixture = JSON.parse(fixtureBytes);
  if (fixture.sourceCommit !== SOURCE_COMMIT || fixture.dataset !== 'duo-legacy') fail('FIXTURE_IDENTITY_MISMATCH');
  const storeCandidate = path.resolve(args.store ?? path.join(scratch, 'store'));
  if (!inside(scratch, storeCandidate)) fail('STORE_OUTSIDE_OWNED_SCRATCH');
  await mkdir(storeCandidate, { recursive: true });
  const storeDirectory = await realpath(storeCandidate);
  if (!inside(scratch, storeDirectory)) fail('STORE_REALPATH_OUTSIDE_OWNED_SCRATCH');
  const storeEntries = await readdir(storeDirectory);
  if (args.initial ? storeEntries.length !== 0 : !storeEntries.includes('state.json')) fail(args.initial ? 'INITIAL_STORE_NOT_EMPTY' : 'MEASURED_EXISTING_STORE_REQUIRED');
  if (storeEntries.includes('store.lock') || storeEntries.includes('store.lock.recovery')) fail('STORE_NOT_FULLY_CLOSED');
  if (!args.initial && (!storeEntries.includes('access-token') || !(await lstat(path.join(storeDirectory, 'access-token'))).isFile())) fail('COPIED_ACCESS_TOKEN_REQUIRED');
  const initialDiskState = args.initial ? null : digestBytes(await readFile(path.join(storeDirectory, 'state.json')));
  const assetRoots = {};
  for (const name of ['packs', 'game-data', 'map', 'terrain', 'icons', 'world-images']) {
    const candidate = path.join(scratch, 'assets', name); await mkdir(candidate, { recursive: true });
    const directory = await realpath(candidate);
    if (!inside(scratch, directory) || (await lstat(candidate)).isSymbolicLink()) fail('ASSET_ROOT_OUTSIDE_OWNED_SCRATCH');
    if ((await readdir(directory)).length) fail('PUBLIC_ASSET_ROOT_NOT_EMPTY');
    assetRoots[name] = directory;
  }
  Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: assetRoots.packs,
    RS3_GAME_DATA_DIR: assetRoots['game-data'], RS3_MAP_ASSETS_DIR: assetRoots.map,
    RS3_TERRAIN_ASSETS_DIR: assetRoots.terrain, RS3_ICON_ASSETS_DIR: assetRoots.icons,
    RS3_WORLD_IMAGES_ROOT: assetRoots['world-images'] });
  const send = message => new Promise((resolve, reject) => {
    if (!process.connected) return reject(Object.assign(new Error(), { driverCode: 'IPC_DISCONNECTED' }));
    process.send({ protocol: PROTOCOL, ...message }, error => error ? reject(error) : resolve());
  });
  const checkpoint = phase => send({ type: 'checkpoint', phase, at: performance.now() });
  // This packet is diagnostic-only. Verify original source above; load an
  // explicitly identified scratch derivative with two observed close bodies.
  if (!args['source-lock']) fail('CLOSE_OBSERVATION_SOURCE_LOCK_REQUIRED');
  const observed=await installObservedSource({source,scratch,sourceLock:JSON.parse(await readFile(args['source-lock'],'utf8'))});
  const collector=createCloseCollector();let observationStart;
  globalThis.__r116ObserveClose=event=>{
    observationStart??=performance.now();
    const safe=collector.record({...event,elapsedMs:Math.max(0,Math.floor(performance.now()-observationStart))});
    if(safe)void send({type:'close-observation',event:safe}).catch(()=>{});
  };
  const load = relative => import(pathToFileURL(path.join(observed.source, 'app', relative)).href);
  const sourceIdentity = { sourceCommit, manifestSha256: manifestSha256 ?? null, sourceLockSha256,
    criticalFiles: actualCriticalFiles, criticalVerification: 'child-read-and-sha256',
    completeManifestVerification: 'original-readonly-source-plus-verified-observed-scratch-copy',
    closeObservation:observed.identity };
  let early, app, witness, closePending, starting, readyOwner, closing = false, stopReceiptSent = false;
  // Fixed progress vocabulary only; a disconnected parent cannot prevent cleanup.
  const closeProgress = phase => { void send({ type: 'close-progress', phase }).catch(() => {}); };
  const stop = () => closePending ??= (async () => {
    closing = true;
    closeProgress('ownership-before');
    const ownershipBeforeClose = app ? await readOwner(storeDirectory) : null;
    const ownershipStable = Boolean(app && ownershipBeforeClose.sameProcess
      && ownershipBeforeClose.ownerRecordSha256 === readyOwner?.ownerRecordSha256);
    // Early.close owns cancellation if app has not become ready; normal app.close
    // is used when ready and waits for the normal store and sidecar lifecycle.
    closeProgress('application-close');
    if (app) await app.close(); else if (early) await early.close();
    closeProgress('startup-drain');
    await starting?.catch(() => {});
    closeProgress('witness-finalize');
    const frozen = witness?.finalize() ?? null;
    closeProgress('ownership-after');
    const ownershipAfterClose = await readOwner(storeDirectory);
    if (ownershipAfterClose.present) fail('STORE_OWNER_LOCK_REMAINS_AFTER_CLOSE');
    closeProgress('closed-state-read');
    const stateFile = digestBytes(await readFile(path.join(storeDirectory, 'state.json')));
    closeProgress('complete');
    return { closeCompleted: true, ownershipStable, ownershipBeforeClose, ownershipAfterClose, ...frozen,
      closedStore: { path: storeDirectory, stateFile } };
  })();
  let commands = Promise.resolve();
  const execute = async message => {
    const command = message?.command ?? message?.type;
    const id = message?.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !['snapshot', 'begin', 'finish', 'stop'].includes(command)) fail('INVALID_IPC_COMMAND');
    try {
      if (command === 'stop') {
        const receipt = await stop();
        await send({ type: 'stopped', id, command, ok: true, result: receipt });
        stopReceiptSent = true; process.exitCode = 0; process.disconnect(); return;
      }
      if (!app || !witness || closing) fail('APP_NOT_READY_OR_CLOSING');
      let result;
      if (command === 'snapshot') result = { snapshot: witness.snapshot(message.phase) };
      else {
        const owner = await readOwner(storeDirectory);
        const ownership = { ...owner, sameOwnerAsReady: owner.ownerRecordSha256 === readyOwner?.ownerRecordSha256 };
        if (command === 'begin') result = { ...witness.begin(message.token), ownership };
        else result = { witness: witness.finish(message.token), journal: witness.journalReceipt(message.token), ownership };
      }
      await send({ type: 'reply', id, command, ok: true, result, status: witness.status() });
    } catch (error) { await send({ type: 'reply', id, command, ok: false, error: safeError(error) }); }
  };
  process.on('message', message => { commands = commands.then(() => execute(message)).catch(error => {
    void send({ type: 'command-failed', error: safeError(error) }).catch(() => {});
  }); });
  process.on('disconnect', () => { void stop().then(() => {
    if (!process.exitCode) process.exitCode = stopReceiptSent ? 0 : 1;
  }, () => { process.exitCode = 1; }); });
  process.on('SIGTERM', () => { process.exitCode = 143; void stop().then(() => { if (process.connected) process.disconnect(); },
    () => { process.exitCode = 1; if (process.connected) process.disconnect(); }); });
  starting = (async () => {
    await checkpoint('before-application-import');
    const { startServer } = await load('server.mjs');
    let initialState;
    if (args.initial) {
      const { createGroupState } = await load('core/state.mjs');
      initialState = createGroupState(fixture.members.map(member => ({ ...member, completedTasks: [] })));
      initialState.rules = structuredClone(fixture.rules); initialState.tasks = structuredClone(fixture.tasks);
      for (const member of initialState.members) member.completedTasks = structuredClone(fixture.members.find(row => row.id === member.id).completedTasks);
    }
    if (closing) fail('STARTUP_CANCELLED');
    const options = { host: '127.0.0.1', port: 0, dataDir: storeDirectory,
      packsDir: assetRoots.packs, gameDataDir: assetRoots['game-data'], mapAssetsDir: assetRoots.map,
      terrainAssetsDir: assetRoots.terrain, iconAssetsDir: assetRoots.icons, worldImagesRoot: assetRoots['world-images'],
      publicOrigin: undefined, loopbackPort: undefined, privateAddonOptions: {}, ...(args.initial ? { initialState } : {}) };
    await checkpoint('before-start-server');
    early = await startServer(options);
    const address = early.address();
    if (!address || typeof address !== 'object' || address.address !== '127.0.0.1') fail('NON_LOOPBACK_LISTENER');
    const origin = `http://127.0.0.1:${address.port}`;
    await send({ type: 'early', origin, directOrigin: origin, at: performance.now(), pid: process.pid });
    app = await early.ready;
    if (closing) { await app.close(); return; }
    witness = createWitnessJournal(app.store, { onCommit: entry => {
      void send({ type: 'commit', entry }).catch(() => {});
    } });
    const owner = await readOwner(storeDirectory);
    readyOwner = owner;
    if (!owner.present || !owner.sameProcess) fail('STORE_OWNER_LOCK_NOT_THIS_PROCESS');
    const dataset = app.dataset.status();
    if (app.dataset.datasetId !== 'duo-legacy' || !HASH.test(dataset.digest ?? '')
      || !dataset.digest.startsWith(fixture.expectedDatasetDigestPrefix)) fail('PUBLIC_DATASET_IDENTITY_MISMATCH');
    const worker = typeof app.dataset.workerSelection === 'function' ? app.dataset.workerSelection() : null;
    const workerSelection = worker ? { digest: worker.digest, profileSha256: worker.profileSha256 ?? null,
      selectionSha256: sha256(JSON.stringify(worker.selection)), definitionOverlaysSha256: sha256(JSON.stringify(worker.definitionOverlays ?? [])),
      hasProfile: typeof worker.profilePath === 'string', hasLegacyMetadataSnapshots: Boolean(worker.legacyMetadataSnapshots),
      pathAndEnvironmentValuesOmitted: true } : { accessible: false };
    if (worker && worker.digest !== dataset.digest) fail('WORKER_SELECTION_DATASET_MISMATCH');
    const readySnapshot = witness.capture('ready');
    const boundOptions = { host: options.host, port: options.port, dataDir: options.dataDir,
      assetRoots, initialStateSupplied: Boolean(args.initial), initialImportSupplied: false,
      shippedPublicRoots: { webRoot: path.join(observed.source, 'app', 'web'), resourcesRoot: path.join(observed.source, 'resources'),
        taskArtworkRoot: path.join(observed.source, 'app', 'web', 'task-item-artwork.2026-10-09.v1'), mode: 'application-default-verified-scratch-copy-diagnostic-only' },
      predictionPrewarm: 'application-default', startupWarmup: 'normal-startServer',
      workerFactory: 'application-default', beforeCommit: 'application-default', privateAddon: 'none',
      operatorEnvironment: { inheritedRS3Cleared: true, perfStageFdCleared: true, nodeOptionsCleared: true } };
    await send({ type: 'ready', origin, directOrigin: origin, at: performance.now(), identity: sourceIdentity, sourceIdentity,
      fixture: { id: fixture.id, sha256: FIXTURE_SHA256, bytes: fixtureBytes.length }, dataset, workerSelection,
      boundOptions, owner, initialDiskState, snapshot: readySnapshot,
      commitInFlight: { observable: false, drainedAtStop: true },
      startupTimingMs: app.getStartupTimingMs(), observed: { worldChunks: app.world.chunks.size } });
    // This is the only credentials-bearing message. It is private process IPC,
    // intentionally separate from every JSONL-safe event. Parent must not log it.
    await send({ type: 'private-invite', sensitive: true, inviteUrl: app.inviteUrl, joinUrl: app.inviteUrl });
    await checkpoint('application-ready');
  })();
  try { await starting; }
  catch (error) {
    await send({ type: 'startup-failed', error: safeError(error) }).catch(() => {});
    try { await stop(); } catch { /* The explicit failure and exit status remain. */ }
    process.exitCode = 1; if (process.connected) process.disconnect();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Never print an exception or invite on stdout/stderr, including preflight.
  runDriver().catch(error => {
    if (process.send && process.connected) process.send({ protocol: PROTOCOL, type: 'driver-failed', error: safeError(error) }, () => {
      process.exitCode = 1; if (process.connected) process.disconnect();
    });
    else process.exitCode = 1;
  });
}
