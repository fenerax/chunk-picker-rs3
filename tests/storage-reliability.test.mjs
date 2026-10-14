import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { importBackup } from '../app/core/state.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const storageUrl = new URL('../app/storage/store.mjs', import.meta.url).href;
// Child boot includes Windows process inspection and can be delayed by the full
// suite. Recovery assertions begin only after an explicit ownership handshake.
const CHILD_STARTUP_MS = 60_000;
const deadOwner = { pid: 2147483647, startedAt: '2000-01-01T00:00:00.000Z', host: hostname(), nonce: 'dead', createdAt: '2000-01-01T00:00:00.000Z' };
async function directory(t) {
  const base = path.join(root, '.local', 'test-storage');
  await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'reliability-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
const setRule = value => ({ type: 'set-rule', ruleId: 'access.shared', value });
async function trackedStore(t, options) {
  const store = await openStore(options);
  t.after(() => store.close());
  return store;
}

test('lock records process identity and rejects live, foreign and uncertain recovery owners', async t => {
  const dataDir = await directory(t);
  const first = await trackedStore(t, { dataDir });
  const owner = JSON.parse(await readFile(path.join(dataDir, 'store.lock'), 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, hostname());
  assert.ok(Number.isFinite(Date.parse(owner.startedAt)));
  await first.close();
  for (const candidate of [owner, { ...deadOwner, host: 'another-host' }, { ...owner, startedAt: 'invalid' }]) {
    await writeFile(path.join(dataDir, 'store.lock.recovery'), JSON.stringify(candidate));
    await assert.rejects(() => openStore({ dataDir }), /recovery owner cannot be verified/);
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'store.lock.recovery'), 'utf8')), candidate);
  }
  await unlink(path.join(dataDir, 'store.lock.recovery'));
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify({ ...owner, startedAt: '2000-01-01T00:00:00.000Z' }));
  if (owner.startVerified) {
    const reusedPid = await trackedStore(t, { dataDir });
    await reusedPid.close();
  } else {
    await assert.rejects(() => openStore({ dataDir }), /owner cannot be verified/);
    await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify({ ...owner, pid: deadOwner.pid }));
    const deadUnverifiedOwner = await trackedStore(t, { dataDir });
    await deadUnverifiedOwner.close();
  }
});

for (const removedLock of [false, true]) {
  test(`interrupted recovery restarts safely ${removedLock ? 'after' : 'before'} removal of the stale lock`, async t => {
    const dataDir = await directory(t);
    await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify(deadOwner));
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { openStore } from ${JSON.stringify(storageUrl)};
      await openStore({ dataDir: ${JSON.stringify(dataDir)}, beforeLockRecovery: async () => {
        setInterval(() => {}, 1000);
        process.stdout.write('recovery-owned\\n');
        await new Promise(() => {});
      } });
    `], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
    let output = '';
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Recovery child did not start: ${output}`)), CHILD_STARTUP_MS);
      child.stdout.on('data', bytes => { output += bytes; if (output.includes('recovery-owned')) { clearTimeout(timeout); resolve(); } });
      child.stderr.on('data', bytes => { output += bytes; });
      exited.then(() => { clearTimeout(timeout); if (!output.includes('recovery-owned')) reject(new Error(output)); });
    });
    await ready;
    const marker = JSON.parse(await readFile(path.join(dataDir, 'store.lock.recovery'), 'utf8'));
    assert.equal(marker.pid, child.pid);
    assert.equal(marker.host, hostname());
    assert.ok(Number.isFinite(Date.parse(marker.startedAt)));
    if (removedLock) await unlink(path.join(dataDir, 'store.lock'));
    child.kill();
    await exited;
    const recovered = await trackedStore(t, { dataDir });
    await recovered.command(setRule(false), 0);
    await recovered.close();
    assert.ok(!(await readdir(dataDir)).includes('store.lock.recovery'));
    assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).revision, 1);
  });
}

test('legacy ownerless marker needs a dead local lock and a settled grace period', async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify(deadOwner));
  const marker = path.join(dataDir, 'store.lock.recovery');
  await writeFile(marker, '');
  await assert.rejects(() => openStore({ dataDir }), /cannot be verified/);
  const old = new Date(Date.now() - 60_000);
  await utimes(marker, old, old);
  const recovered = await trackedStore(t, { dataDir });
  await recovered.close();
});

test('recovery contenders never gain concurrent ownership', async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify(deadOwner));
  await writeFile(path.join(dataDir, 'store.lock.recovery'), JSON.stringify(deadOwner));
  const contenders = await Promise.allSettled(Array.from({ length: 8 }, () => openStore({ dataDir })));
  const winners = contenders.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'store.lock'), 'utf8')).pid, process.pid);
  await winners[0].value.close();
});

test('a different process cannot enter recovery while the OS-owned mutex is held', async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify(deadOwner));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { openStore } from ${JSON.stringify(storageUrl)};
    await openStore({ dataDir: ${JSON.stringify(dataDir)}, beforeLockRecovery: async () => {
      setInterval(() => {}, 1000);
      process.stdout.write('mutex-owned\\n');
      await new Promise(() => {});
    } });
  `], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Mutex child timed out.')), CHILD_STARTUP_MS);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    exited.then(() => { clearTimeout(timeout); reject(new Error('Mutex child exited early.')); });
  });
  const marker = await readFile(path.join(dataDir, 'store.lock.recovery'), 'utf8');
  await assert.rejects(() => openStore({ dataDir }), /already holds or is recovering/);
  assert.equal(await readFile(path.join(dataDir, 'store.lock.recovery'), 'utf8'), marker);
  child.kill();
  await exited;
  const recovered = await trackedStore(t, { dataDir });
  await recovered.close();
});

test('an estimated process start never authorizes recovery of a live PID', async t => {
  const dataDir = await directory(t);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.PATH = path.join(root, '.local', 'unavailable-executables');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { openStore } from ${JSON.stringify(storageUrl)};
    import { readFile } from 'node:fs/promises';
    const store = await openStore({ dataDir: ${JSON.stringify(dataDir)} });
    const owner = await readFile(${JSON.stringify(path.join(dataDir, 'store.lock'))}, 'utf8');
    await store.close();
    process.stdout.write(owner + '\\n');
    setInterval(() => {}, 1000);
  `], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  const owner = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Fallback owner child timed out.')), CHILD_STARTUP_MS);
    child.stdout.on('data', bytes => { output += bytes; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.trim())); } });
    exited.then(() => { clearTimeout(timeout); reject(new Error('Fallback owner child exited early.')); });
  });
  assert.equal(owner.startVerified, false);
  assert.ok(Number.isFinite(Date.parse(owner.startedAt)));
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify(owner));
  await assert.rejects(() => openStore({ dataDir }), /owner cannot be verified/);
  child.kill();
  await exited;
  const recovered = await trackedStore(t, { dataDir });
  await recovered.close();
});

test('archived history exports portable backups and supports undo beyond the live tail after restart', async t => {
  const dataDir = await directory(t);
  const store = await trackedStore(t, { dataDir, retention: { historyEntries: 5, backupDays: 90 } });
  const initial = store.getState().rules;
  for (let revision = 0; revision < 25; revision++) await store.command(setRule(Boolean(revision % 2)), revision);
  assert.ok(store.getState().history.length <= 10);
  assert.ok(store.getInfo().retention.historyArchives > 0);
  const portable = await store.backup();
  assert.equal(portable.state.history.length, 25);
  assert.equal(portable.state.provenance?.historyArchive, undefined);
  assert.deepEqual(importBackup(JSON.stringify(portable)), portable.state);
  const retained = await store.listBackups();
  const old = await store.readBackup(retained.find(item => item.revision === 24).id);
  assert.equal(old.state.history.length, 24);
  assert.equal(old.state.provenance?.historyArchive, undefined);
  await store.close();
  const reopened = await trackedStore(t, { dataDir, retention: { historyEntries: 5, backupDays: 90 } });
  for (let count = 0; count < 25; count++) await reopened.command({ type: 'undo' }, reopened.getState().revision);
  assert.deepEqual(reopened.getState().rules, initial);
  await assert.rejects(() => reopened.command({ type: 'undo' }, reopened.getState().revision), /No reversible command/);
  await reopened.close();
});

test('an interrupted archival commit ignores uncommitted history files and preserves durable undo', async t => {
  const dataDir = await directory(t);
  const store = await trackedStore(t, { dataDir, retention: { historyEntries: 2 }, beforeCommit: ({ state }) => {
    if (state.revision === 5) throw new Error('Interrupted archive commit');
  } });
  for (let revision = 0; revision < 4; revision++) await store.command(setRule(Boolean(revision % 2)), revision);
  await assert.rejects(() => store.command(setRule(false), 4), /Interrupted archive/);
  assert.equal(store.getState().revision, 4);
  assert.ok((await readdir(path.join(dataDir, 'history'))).length > 0);
  await store.close();
  const recovered = await trackedStore(t, { dataDir, retention: { historyEntries: 2 } });
  const portable = await recovered.backup();
  assert.deepEqual(portable.state.history.map(event => event.revision), [1, 2, 3, 4]);
  await recovered.command({ type: 'undo' }, 4);
  await recovered.close();
});

test('retention validates configuration before creating files and reports failed maintenance without failing a committed save', async t => {
  const dataDir = await directory(t);
  for (const retention of [{ historyEntries: 0 }, { backupDays: NaN }, { mystery: true }]) {
    await assert.rejects(() => openStore({ dataDir, retention }), /retention|Unknown retention/);
    assert.deepEqual(await readdir(dataDir), []);
  }
  const store = await trackedStore(t, { dataDir, retention: { backupDays: 1, historyEntries: 5 } });
  await mkdir(path.join(dataDir, 'backups', 'archives'));
  await writeFile(path.join(dataDir, 'backups', 'archives', 'archive-aaaaaaaaaaaaaaaa.json.gz'), 'broken');
  // The committed save remains successful even when maintenance is deferred.
  await store.command(setRule(false), 0);
  await store.command(setRule(true), 1);
  await store.close();
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).revision, 2);
  assert.match(store.getInfo().retention.failure, /header|gzip|incorrect/i);
});

test('scheduled retention follows command acknowledgement, backup browsing waits for it, and close drains it', async t => {
  const dataDir = await directory(t);
  let committed = false, maintenanceObserved = false;
  let date = '2026-01-01T00:00:00.000Z';
  const store = await trackedStore(t, { dataDir, retention: { backupDays: 1, historyEntries: 1000 },
    now: () => { if (committed) maintenanceObserved = true; return date; },
    beforeCommit: ({ state }) => {
      if (state.revision === 50) { committed = true; date = '2026-10-07T00:00:00.000Z'; }
    },
  });
  for (let revision = 0; revision < 50; revision++) await store.command(setRule(Boolean(revision % 2)), revision);
  // Maintenance first awaits its directory scan. The commit promise and its
  // notification finish before retention reads its clock or starts packing.
  assert.equal(maintenanceObserved, false);
  const browsing = store.listBackups();
  const closing = store.close();
  const snapshots = await browsing;
  assert.equal(maintenanceObserved, true);
  assert.equal(snapshots.length, 50);
  const original = snapshots.find(snapshot => snapshot.revision === 1);
  assert.equal((await store.readBackup(original.id)).state.revision, 1);
  await closing;
  assert.ok((await readdir(path.join(dataDir, 'backups', 'archives'))).length > 0);
  assert.ok(!(await readdir(dataDir)).includes('store.lock'));
  assert.equal(store.getInfo().retention.failure, undefined);
});

for (const corruption of ['document', 'dependency', 'content']) {
  test(`retention preserves the standalone snapshot when an existing archive has a corrupt ${corruption}`, async t => {
    const dataDir = await directory(t);
    const initial = await trackedStore(t, { dataDir, retention: false, now: () => '2026-01-01T00:00:00.000Z' });
    for (let revision = 0; revision < 4; revision++) await initial.command(setRule(Boolean(revision % 2)), revision);
    const target = (await initial.listBackups()).find(snapshot => snapshot.revision === 1);
    await initial.close();
    const original = await readFile(path.join(dataDir, 'backups', target.id));
    const document = JSON.parse(gunzipSync(original).toString('utf8'));
    if (corruption === 'document') document.state.revision = -1;
    else if (corruption === 'dependency') document.state.provenance = { historyArchive: [{ id: 'history-0000000000000001-0000000000000001-aaaaaaaaaaaaaaaa.json.gz' }] };
    else document.state.rules['access.shared'] = true;
    const archivesDir = path.join(dataDir, 'backups', 'archives');
    await mkdir(archivesDir);
    await writeFile(path.join(archivesDir, 'archive-aaaaaaaaaaaaaaaa.json.gz'), gzipSync(JSON.stringify({
      format: 'rs3-chunk-picker-retained-archive', snapshots: [{ ...target, document }],
    })));
    const resumed = await trackedStore(t, { dataDir, retention: { backupDays: 1 }, now: () => '2026-10-07T00:00:00.000Z' });
    assert.ok(resumed.getInfo().retention.failure);
    assert.deepEqual(await readFile(path.join(dataDir, 'backups', target.id)), original);
    assert.equal((await resumed.readBackup(target.id)).state.revision, 1);
    await resumed.close();
  });
}

async function diskBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await diskBytes(file) : (await stat(file)).size;
  }
  return total;
}

test('long synthetic history keeps daily checkpoints, archives every older snapshot and measures growth', async t => {
  const dataDir = await directory(t);
  const baselineDir = await directory(t);
  let date = new Date('2026-01-01T00:00:00.000Z');
  const options = { now: () => date };
  const compact = await trackedStore(t, { dataDir, ...options, retention: { backupDays: 2, historyEntries: 10 } });
  const baseline = await trackedStore(t, { dataDir: baselineDir, ...options, retention: false });
  const count = 320;
  for (let revision = 0; revision < count; revision++) {
    date = new Date(Date.UTC(2026, 0, 1 + Math.floor(revision / 8), revision % 8));
    await compact.command(setRule(Boolean(revision % 2)), revision);
    await baseline.command(setRule(Boolean(revision % 2)), revision);
  }
  await compact.close();
  await baseline.close();
  const files = (await readdir(path.join(dataDir, 'backups'))).filter(name => name.endsWith('.gz'));
  assert.ok(files.length < 70, `Expected daily + recent checkpoints, got ${files.length}.`);
  assert.ok(compact.getState().history.length <= 20);
  assert.equal((await compact.backup()).state.history.length, count);
  const snapshots = await compact.listBackups();
  assert.equal(snapshots.length, count, 'Every prior snapshot remains recoverable from a standalone file or a durable pack.');
  for (const packId of await readdir(path.join(dataDir, 'backups', 'archives'))) {
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'backups', 'archives', packId)));
    const pack = JSON.parse(bytes.toString('utf8'));
    assert.ok(pack.snapshots.length <= 32, 'Archive batches have a bounded snapshot count.');
    assert.ok(bytes.length <= 8 * 1024 * 1024 || pack.snapshots.length === 1, 'Decoded archive batches are bounded, except a single oversized snapshot.');
  }
  for (const revision of [0, 1, 100, 200, 319]) {
    const snapshot = await compact.readBackup(snapshots.find(item => item.revision === revision).id);
    assert.equal(snapshot.state.revision, revision);
    assert.equal(snapshot.state.history.length, revision);
  }
  const retainedBytes = await diskBytes(dataDir);
  const baselineBytes = await diskBytes(baselineDir);
  assert.ok(retainedBytes < baselineBytes * 0.65, `Retention ${retainedBytes} bytes vs baseline ${baselineBytes} bytes.`);
  t.diagnostic(JSON.stringify({ commands: count, standaloneSnapshots: files.length, archivedSnapshots: count - files.length,
    activeHistory: compact.getState().history.length, retainedBytes, baselineBytes, reductionPercent: Math.round(100 * (1 - retainedBytes / baselineBytes)) }));
});
