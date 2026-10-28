import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { assertReleased, encode, exclusive, inventory, json, sha } from '../scripts/linux/files.mjs';
import { assertSameRelease, readRelease } from '../scripts/linux/runtime.mjs';
import { backupStopped, checkStoppedCompatibility, restoreStopped, verifyBackup, writeBackupStatus } from '../scripts/linux/recovery.mjs';
import { deployStopped, deployPrechecked, backupOnline, healthRecovery } from '../scripts/linux/operator.mjs';
import { readBackupStatus } from '../app/storage/backup-status.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { compatibilityReports, syntheticAdditions, syntheticCore } from './helpers/release-compatibility.mjs';

// Set before importing any state/server code. All writes stay in this worktree.
process.env.RS3_DATASET = 'open-starter';
const { createGroupState, exportBackup } = await import('../app/core/state.mjs');
const { resolveDataset } = await import('../app/datasets.mjs');
const { bindDatasetStorage } = await import('../app/dataset-binding.mjs');
const { openAccountStore } = await import('../app/storage/accounts.mjs');
const { openInviteStore } = await import('../app/storage/invites.mjs');
const { openPluginKeys } = await import('../app/plugin-keys.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, '.local', 'linux-operator-tests');
const noWait = async () => {};
const healthy = async () => ({ ready: true, savesReady: true });

async function fixture(t) {
  await mkdir(testRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(testRoot, 'run-'));
  t.after(async () => {
    const relative = path.relative(testRoot, scratch);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(scratch, { recursive: true, force: true });
  });
  const settings = { dataDir: path.join(scratch, 'save'), backupDir: path.join(scratch, 'backups'),
    scratchRoot: path.join(scratch, 'scratch'), controlDir: path.join(scratch, 'control'), current: path.join(scratch, 'current.json'), minFreeBytes: 0, keep: 2 };
  await mkdir(settings.dataDir); await mkdir(settings.controlDir);
  const state = createGroupState([{ id: 'explorer1', name: 'Explorer 1' }, { id: 'explorer2', name: 'Explorer 2' }]);
  await writeFile(path.join(settings.dataDir, 'state.json'), encode(exportBackup(state)));
  await bindDatasetStorage(settings.dataDir, await resolveDataset({ datasetId: 'open-starter' }));
  const release = async (name, { refusesRevision, additions } = {}) => {
    const core = path.join(scratch, name);
    await mkdir(path.join(core, 'app', 'core'), { recursive: true });
    const serverUrl = pathToFileURL(path.join(root, 'app/server.mjs')).href;
    let source = `export { createServer, startServer } from ${JSON.stringify(serverUrl)};\n`;
    if (refusesRevision !== undefined) source = `import { createServer as open, startServer } from ${JSON.stringify(serverUrl)};
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export { startServer };
export async function createServer(options) {
  const save = JSON.parse(await readFile(path.join(options.dataDir, 'state.json'), 'utf8'));
  if (save.state.revision >= ${refusesRevision}) throw new Error('Synthetic incompatible final revision.');
  return open(options);
}\n`;
    await writeFile(path.join(core, 'app', 'server.mjs'), source);
    // The semantic child report loads the selected core's identity and dataset seams.
    for (const name of ['tasks/identity.mjs', 'dataset-bootstrap.mjs', 'dataset-pipeline.mjs']) {
      const target = path.join(core, 'app', name); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `export * from ${JSON.stringify(pathToFileURL(path.join(root, 'app', name)).href)};\n`);
    }
    if (additions !== undefined) await syntheticCore(core, { additions });
    await writeFile(path.join(core, 'app', 'core', 'state.mjs'), `export { importBackup } from ${JSON.stringify(pathToFileURL(path.join(root, 'app/core/state.mjs')).href)};\n`);
    const configFile = path.join(scratch, name + '-config.json');
    const bytes = encode({ coreRoot: core, dataDir: settings.dataDir, datasetId: 'open-starter', runtimeOptions: {} });
    await writeFile(configFile, bytes);
    const pointer = path.join(scratch, name + '-pointer.json');
    await writeFile(pointer, encode({ config: { path: configFile, sha256: sha(bytes) } }));
    return readRelease(pointer, settings.dataDir);
  };
  const current = await release('old'), candidate = await release('candidate');
  await writeFile(settings.current, current.pointerBytes);
  const masterToken = randomBytes(32).toString('base64url');
  await writeFile(path.join(settings.dataDir, 'access-token'), masterToken + '\n');
  const accounts = await openAccountStore({ dataDir: settings.dataDir });
  await accounts.ensureIdentity('discord', 'synthetic-account-subject'); await accounts.close();
  const invites = await openInviteStore({ dataDir: settings.dataDir, masterToken, masterLabel: 'Synthetic operator' });
  await invites.create({ label: 'Synthetic player', memberId: 'explorer1' }); await invites.close();
  const plugins = await openPluginKeys({ dataDir: settings.dataDir });
  await plugins.create('explorer1', 'Synthetic plugin'); await plugins.close();
  await writeFile(path.join(settings.dataDir, 'overlays.json'), encode({ schemaVersion: 1, links: [] }));
  await mkdir(path.join(settings.dataDir, 'signin-sidecars'));
  await writeFile(path.join(settings.dataDir, 'signin-sidecars', 'opaque.bin'), Buffer.from([0, 255, 2, 128]));
  await mkdir(path.join(settings.dataDir, 'empty-sidecar-directory'));
  const events = [];
  let active = true;
  const controller = { state: async () => ({ active, stopped: !active, activeForMs: 600000 }),
    stop: async () => { events.push('stop'); active = false; }, start: async () => { assert(!active); events.push('start'); active = true; } };
  return { settings, current, candidate, release, controller, events, scratch };
}

test('full-store rehearsal: backup, wipe, restore and verify every byte, binding and portable export', { timeout: 55000 }, async t => {
  const f = await fixture(t), { settings, current } = f;
  const before = await inventory(settings.dataDir), binding = await readFile(settings.dataDir + '.dataset.json');
  const backup = await backupStopped({ ...settings, release: current });
  await verifyBackup(backup.target);
  const portable = await json(path.join(backup.target, 'portable.json'));
  assert.equal(portable.format, 'rs3-chunk-picker'); assert.equal(portable.state.members.length, 2);
  for (const name of ['access-token', 'invites.json', 'accounts.json', 'plugin-keys.json', 'overlays.json']) {
    assert(before.some(row => row.path === name), 'Synthetic fixture should include ' + name);
  }
  await rm(settings.dataDir, { recursive: true }); await rm(settings.dataDir + '.dataset.json');
  await mkdir(settings.dataDir);
  await restoreStopped({ ...settings, backup: backup.target, release: current });
  assert.deepEqual(await inventory(settings.dataDir), before);
  assert.deepEqual(await readFile(settings.dataDir + '.dataset.json'), binding);
  await assert.rejects(restoreStopped({ ...settings, backup: backup.target, release: current }), /existing binding/);
  await writeFile(path.join(backup.target, 'store', 'plugin-keys.json'), '{}');
  await assert.rejects(verifyBackup(backup.target), /manifest/);
});

test('backups enforce count, free-space reserve, ownership release and existing UI status', async t => {
  const { settings, current } = await fixture(t);
  const fastProbe = async (release, dir, output) => { const document = await json(path.join(dir, 'state.json')); await writeFile(output, encode(document)); return document; };
  for (let index = 0; index < 3; index++) await backupStopped({ ...settings, release: current, probe: fastProbe });
  assert.equal((await readdir(settings.backupDir)).filter(name => name.startsWith('recovery-')).length, 2);
  await assert.rejects(backupStopped({ ...settings, release: current, minFreeBytes: Number.MAX_SAFE_INTEGER }), /free space/);
  await writeFile(path.join(settings.dataDir, 'store.lock'), 'synthetic busy writer');
  await assert.rejects(backupStopped({ ...settings, release: current }), /ownership/);
  await rm(path.join(settings.dataDir, 'store.lock'));
  await writeFile(path.join(path.dirname(settings.dataDir), 'backup-destination'), 'managed\n');
  await writeBackupStatus(settings.dataDir, { result: 'success', byteSize: 123, at: '2026-10-27T04:00:00.000Z' });
  let status = await readBackupStatus(settings.dataDir, { now: Date.parse('2026-10-27T05:00:00Z') });
  assert.equal(status.warning, null); assert.equal(status.byteSize, 123);
  await writeBackupStatus(settings.dataDir, { result: 'failed', at: '2026-10-28T04:00:00.000Z' });
  status = await readBackupStatus(settings.dataDir); assert.equal(status.warning, 'failed'); assert.equal(status.lastSuccessAt, '2026-10-27T04:00:00.000Z');
});

test('final stopped-save gate runs all four real decoder probes even with unchanged data and code', { timeout: 55000 }, async t => {
  const { settings, current, candidate, controller } = await fixture(t);
  await controller.stop();
  const before = await inventory(settings.dataDir);
  const proof = await checkStoppedCompatibility({ ...settings, current, candidate, assertStopped: async () => assert((await controller.state()).stopped) });
  assert.equal(proof.passed, true); assert.equal(proof.steps, 4);
  assert.deepEqual(await inventory(settings.dataDir), before);
});

test('Linux semantic gate serves a synthetic four-task addition through current, candidate, rollback and re-forward', async t => {
  const f = await fixture(t);
  const current = await f.release('synthetic-old', { additions: false });
  const candidate = await f.release('synthetic-new', { additions: true });
  const before = await inventory(f.settings.dataDir), binding = await readFile(f.settings.dataDir + '.dataset.json');
  let ownershipChecks = 0;
  const proof = await checkStoppedCompatibility({ ...f.settings, current, candidate, savedIdentityAdditions: syntheticAdditions,
    assertStopped: async () => { ownershipChecks++; } });
  assert.equal(proof.steps, 4); assert.equal(ownershipChecks, 2);
  assert.deepEqual(proof.savedIdentityAdditions, syntheticAdditions);
  assert.deepEqual(await inventory(f.settings.dataDir), before);
  assert.deepEqual(await readFile(f.settings.dataDir + '.dataset.json'), binding);
});

for (const fault of ['dropped history', 'changed progress', 'lost records', 'unserved tasks', 'registry', 'undeclared additions']) {
  test(`Linux semantic gate refuses ${fault} and leaves the source untouched`, async t => {
    const f = await fixture(t), { before, after } = compatibilityReports();
    const original = await inventory(f.settings.dataDir);
    let index = 0;
    const probe = async () => {
      const report = structuredClone(index ? after : before);
      if (index === 1) {
        if (fault === 'dropped history') report.historyEvents.shift();
        if (fault === 'changed progress') report.progressDigest = 'changed';
        if (fault === 'lost records') report.migrationSummary.lostRecords = 1;
        if (fault === 'unserved tasks') report.tasksServed = false;
      }
      if (index === 2 && fault === 'registry') report.registryDigest = 'changed';
      index++; return report;
    };
    await assert.rejects(checkStoppedCompatibility({ ...f.settings, current: f.current, candidate: f.candidate,
      assertStopped: async () => {}, probe, ...(fault === 'undeclared additions' ? { savedIdentityAdditions: [] } : {}) }),
      /history|progress|lost saved records|serve tasks|registry|reviewed list/);
    assert.deepEqual(await inventory(f.settings.dataDir), original);
  });
}

test('a candidate that accepted an earlier save refuses the final stopped revision and restarts old code untouched', { timeout: 55000 }, async t => {
  const { settings, current, release, controller, events } = await fixture(t);
  const candidate = await release('late-incompatible', { refusesRevision: 17 });
  await controller.stop();
  await checkStoppedCompatibility({ ...settings, current, candidate, assertStopped: async () => {} });
  const file = path.join(settings.dataDir, 'state.json'), document = await json(file);
  document.state.revision = 17; await writeFile(file, encode(document));
  const before = await inventory(settings.dataDir), binding = await readFile(settings.dataDir + '.dataset.json');
  await assert.rejects(deployStopped({ settings, current, candidate, controller, request: healthy, wait: noWait }), /probe refused/);
  assert.deepEqual(events.slice(-3), ['stop', 'stop', 'start']);
  assert.deepEqual(await inventory(settings.dataDir), before);
  assert.deepEqual(await readFile(settings.current), current.pointerBytes);
  assert.deepEqual(await readFile(settings.dataDir + '.dataset.json'), binding);
});

test('worker recovery precedes writer recovery and a failed stop can never start another writer', async t => {
  const { settings, current, controller, events } = await fixture(t);
  let recovered = false;
  const request = async (_release, route) => {
    events.push(route);
    if (route === '/api/worker-restart') recovered = true;
    return { ready: recovered, savesReady: true };
  };
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { recovered: 'workers' });
  assert(!events.includes('stop')); assert(!events.includes('start'));
  events.length = 0;
  controller.stop = async () => { events.push('stop'); throw new Error('Synthetic drain timeout'); };
  await assert.rejects(healthRecovery({ settings, release: current, controller, request: async (_r, route) => {
    events.push(route); return { ready: false };
  }, wait: noWait }), /drain timeout/);
  assert(events.indexOf('/api/worker-restart') < events.indexOf('stop'));
  assert(!events.includes('start'));
});

test('an idle sleeping worker is healthy; a stuck or failed one still recovers', async t => {
  const { settings, current, controller, events } = await fixture(t);
  const sleeping = { status: 'sleeping', ready: false, stuck: false, restartRequired: false };
  let health = { ready: false, status: 'ready', savesReady: true, worker: sleeping };
  // A restarted writer comes back ready; until then the synthetic health holds.
  const request = async (_release, route) => { events.push(route); return events.includes('start') ? { ready: true, savesReady: true } : health; };
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { healthy: true });
  assert.deepEqual(events, ['/api/health']);
  health = { ...health, savesReady: false };
  events.length = 0;
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { recovered: 'writer' });
  assert(events.includes('/api/worker-restart') && events.includes('stop'));
  for (const worker of [{ ...sleeping, stuck: true }, { ...sleeping, restartRequired: true }]) {
    health = { ready: false, savesReady: true, worker };
    events.length = 0;
    assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { recovered: 'writer' });
    assert(events.includes('/api/worker-restart'));
  }
});

test('writer recovery waits for released store; inactive services and startup grace stay untouched', async t => {
  const { settings, current, controller, events } = await fixture(t);
  let started = false;
  const start = controller.start;
  controller.start = async () => { await start(); started = true; };
  const request = async () => ({ ready: started, savesReady: true });
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { recovered: 'writer' });
  assert.deepEqual(events, ['stop', 'start']);
  await controller.stop(); events.length = 0;
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { skipped: true });
  assert.deepEqual(events, []);
  controller.state = async () => ({ active: true, activeForMs: 1000 });
  assert.deepEqual(await healthRecovery({ settings, release: current, controller, request, wait: noWait }), { skipped: true });
  await writeFile(path.join(settings.dataDir, 'store.lock.recovery'), '{}');
  await assert.rejects(assertReleased(settings.dataDir), /ownership/);
});

test('candidate readiness failure rechecks the latest save before rollback; failures keep it stopped', async t => {
  const { settings, current, candidate, controller, events } = await fixture(t);
  let checks = 0;
  const check = async ({ assertStopped }) => { await assertStopped(); checks++; if (checks === 2) throw new Error('Synthetic reverse incompatibility'); };
  await assert.rejects(deployStopped({ settings, current, candidate, controller, check,
    request: async () => ({ ready: false }), wait: noWait }), /reverse incompatibility/);
  assert.equal(checks, 2); assert.deepEqual(events, ['stop', 'start', 'stop']);
  assert.equal((await controller.state()).stopped, true);
  assert.deepEqual(await readFile(settings.current), candidate.pointerBytes);
  assert.equal((await json(path.join(settings.controlDir, 'activation.json'))).phase, 'prepared');
});

test('activation selects the candidate; a readiness failure can return to old code without replacing newer gameplay', async t => {
  const { settings, current, candidate, controller, events } = await fixture(t);
  const check = async ({ assertStopped }) => { await assertStopped(); return { passed: true }; };
  assert.deepEqual(await deployStopped({ settings, current, candidate, controller, check, request: healthy, wait: noWait }), { activated: true });
  assert.deepEqual(await readFile(settings.current), candidate.pointerBytes);
  assert.deepEqual(events, ['stop', 'start']);
  await writeFile(settings.current, current.pointerBytes); events.length = 0;
  const stateFile = path.join(settings.dataDir, 'state.json');
  const start = controller.start;
  controller.start = async () => {
    await start();
    if (events.filter(event => event === 'start').length === 1) {
      const document = await json(stateFile); document.state.revision = 23; await writeFile(stateFile, encode(document));
    }
  };
  const request = async release => ({ ready: release === current, savesReady: true });
  await assert.rejects(deployStopped({ settings, current, candidate, controller, check, request, wait: noWait }), /readiness/);
  assert.deepEqual(events, ['stop', 'start', 'stop', 'start']);
  assert.equal((await json(stateFile)).state.revision, 23);
  assert.deepEqual(await readFile(settings.current), current.pointerBytes);
});

test('exclusion blocks concurrent mutations and skips a health tick; changed release pins are refused', async t => {
  const { settings, current } = await fixture(t);
  const lock = path.join(settings.controlDir, 'operation.lock');
  await exclusive(lock, async () => {
    assert.deepEqual(await exclusive(lock, () => assert.fail(), { skipBusy: true }), { skipped: true });
    await assert.rejects(exclusive(lock, () => assert.fail()), { code: 'EEXIST' });
  });
  await writeFile(path.join(current.config.coreRoot, 'app', 'server.mjs'), 'export {};');
  await assert.rejects(assertSameRelease(current), /Release changed/);
});

test('startup gate refuses abandoned maintenance and consumes a permit tied to the live operator and exact pointer', async t => {
  const { settings } = await fixture(t);
  await checkStart(settings);
  await writeFile(path.join(settings.controlDir, 'maintenance.json'), '{}');
  await assert.rejects(checkStart(settings), { code: 'ENOENT' });
  const lock = encode({ pid: 12345 });
  await writeFile(path.join(settings.controlDir, 'operation.lock'), lock);
  const file = path.join(settings.controlDir, 'start-permit.json');
  const permit = { expiresAt: 20000, lockSha256: sha(lock), pointerSha256: sha(await readFile(settings.current)), processIdentity: 'synthetic-boot:start' };
  await writeFile(file, encode(permit));
  await assert.rejects(checkStart(settings, { now: 10000, identity: async () => 'different-process' }), /blocked/);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await writeFile(file, encode(permit));
  await checkStart(settings, { now: 10000, identity: async () => 'synthetic-boot:start' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await writeFile(file, encode({ ...permit, expiresAt: 9999 }));
  await assert.rejects(checkStart(settings, { now: 10000, identity: async () => 'synthetic-boot:start' }), /blocked/);
});

// Fast operator decision tests use the complete synthetic fixture and real byte
// inventories, while the decoder itself is covered by the serial probes above.
for (const changed of [false, true]) test(`online deploy: changed=${changed} selects the stopped re-probe correctly`, async t => {
  const f = await fixture(t); let checks = 0;
  const { copyTree } = await import('../scripts/linux/files.mjs');
  const capture = async () => {
    const dir = path.join(f.scratch, 'captured');
    await copyTree(f.settings.dataDir, dir);
    await writeFile(dir + '.dataset.json', await readFile(f.settings.dataDir + '.dataset.json'));
    return { dataDir: dir, cleanup: async () => {} };
  };
  const stop = f.controller.stop;
  f.controller.stop = async () => {
    await stop();
    if (changed) await writeFile(path.join(f.settings.dataDir, 'new-sidecar.json'), '{}');
  };
  const check = async ({ assertStopped, savedIdentityAdditions }) => {
    await assertStopped(); assert.deepEqual(savedIdentityAdditions, syntheticAdditions); checks++;
  };
  await deployPrechecked({ ...f, savedIdentityAdditions: syntheticAdditions, check, capture, request: healthy, wait: noWait });
  assert.equal(checks, changed ? 2 : 1);
  assert.deepEqual(f.events, ['stop', 'start']);
});

test('online preparation failure leaves the writer untouched', async t => {
  const f = await fixture(t);
  await assert.rejects(deployPrechecked({ ...f, capture: async () => { throw new Error('snapshot failed'); } }), /snapshot failed/);
  assert.deepEqual(f.events, []);
  assert.equal((await f.controller.state()).active, true);
});

test('online backup preserves recovery directory and status contracts without stopping the service', async t => {
  const f = await fixture(t);
  const { copyTree } = await import('../scripts/linux/files.mjs');
  const capture = async () => {
    const dir = path.join(f.scratch, 'captured');
    await copyTree(f.settings.dataDir, dir);
    await writeFile(dir + '.dataset.json', await readFile(f.settings.dataDir + '.dataset.json'));
    return { dataDir: dir, cleanup: async () => {} };
  };
  const probe = async (_release, dir, output) => { const document = await json(path.join(dir, 'state.json')); await writeFile(output, encode(document)); return document; };
  const result = await backupOnline({ settings: f.settings, release: f.current, capture, probe });
  assert.equal((await verifyBackup(result.target)).format, 'picker-recovery-v1');
  await writeFile(path.join(path.dirname(f.settings.dataDir), 'backup-destination'), 'managed\n');
  await writeBackupStatus(f.settings.dataDir, { result: 'success', byteSize: result.byteSize });
  assert.equal((await readBackupStatus(f.settings.dataDir)).warning, null);
  assert.deepEqual(f.events, []);
});


test('an exited candidate is stopped before automatic restarts consume the rollback start budget', async t => {
  const f = await fixture(t); let failed = false, starts = 0, waits = 0;
  const state = f.controller.state, start = f.controller.start, stop = f.controller.stop;
  f.controller.state = async () => failed ? { active: false, stopped: false } : state();
  f.controller.start = async () => { await start(); starts++; };
  f.controller.stop = async () => { failed = false; await stop(); };
  await assert.rejects(deployStopped({ ...f, check: async () => {},
    request: async release => { if (release === f.candidate) { failed = true; return { ready: false }; } return { ready: true, savesReady: true }; },
    wait: async () => { waits++; },
  }), /exited before/);
  assert.equal(waits, 0); assert.equal(starts, 2);
  assert.deepEqual(f.events, ['stop', 'start', 'stop', 'start']);
  assert.deepEqual(await readFile(f.settings.current), f.current.pointerBytes);
});
