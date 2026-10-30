import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { openRegistry } from '../app/storage/registry.mjs';
import { snapshotPath } from '../app/storage/snapshot.mjs';
import { captureServiceCheckpoint, pickerPath, verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { restoreServiceStopped, releaseServiceQuarantine } from '../scripts/linux/service-recovery.mjs';
import { repairServiceOwnership } from '../scripts/linux/service-operator.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { atomic, copyTree, encode, exists, inventory, json, sha } from '../scripts/linux/files.mjs';

const inspectionRoot = await mkdtemp(path.join(tmpdir(), 'service-inspected-'));
after(() => rm(inspectionRoot, { recursive: true, force: true }));
const inspected = new Map();
const covered = new Set();
const record = (labels, label) => { labels.push(label); covered.add(label); };
const stopped = async () => {};
const digest = async dir => sha(encode(await inventory(dir)));
const bindingDigest = async dir => await exists(dir + '.dataset.json') ? sha(await readFile(dir + '.dataset.json')) : null;
const fault = new Error('Injected process death');
const probe = async (_release, dir) => json(path.join(dir, 'state.json'));
const progressFile = settings => path.join(settings.controlDir, 'service-restore', 'progress.json');
const releaseFile = (settings, id) => path.join(settings.controlDir, 'release-' + id, 'progress.json');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'service-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsAt = (base, ledger = path.join(base, 'ledger')) => ({ dataDir: path.join(base, 'legacy'),
    controlDir: path.join(base, 'control'), backupDir: path.join(base, 'backups'), scratchRoot: path.join(base, 'scratch'), minFreeBytes: 0,
    multiPicker: { registryDir: path.join(base, 'registry'), pickerRoot: path.join(base, 'pickers'), tombstoneDir: ledger } });
  const settings = settingsAt(path.join(root, 'source'));
  await mkdir(settings.dataDir, { recursive: true });
  t.after(() => rm(settings.dataDir + '.snapshots', { recursive: true, force: true }));
  const registry = await openRegistry({ ...settings.multiPicker, legacyDir: settings.dataDir });
  const legacy = await registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [], droppedMemberships: 0 });
  const incompatible = (await registry.firstLogin('discord', 'synthetic-one')).picker;
  const tombstoned = (await registry.firstLogin('discord', 'synthetic-two')).picker;
  const pickers = [legacy, incompatible, tombstoned];
  for (const picker of pickers) {
    const dir = pickerPath(settings, picker);
    await writeFile(path.join(dir, 'state.json'), encode({ format: 'rs3-chunk-picker', state: { members: picker.memberIds.map(id => ({ id })) } }));
    await writeFile(dir + '.dataset.json', encode({ datasetId: 'synthetic' }));
  }
  const document = await registry.withRecoveryCheckpoint(value => value);
  const immutable = path.join(root, 'immutable'); await mkdir(immutable);
  await writeFile(path.join(immutable, 'release.txt'), 'synthetic immutable release');
  const configFile = path.join(root, 'config.json'), pointerFile = path.join(root, 'current.json');
  const config = { dataDir: settings.dataDir, coreRoot: immutable };
  await writeFile(configFile, encode(config));
  await writeFile(pointerFile, encode({ config: { path: configFile, sha256: sha(encode(config)) } }));
  const release = await readRelease(pointerFile, settings.dataDir);
  const id = randomUUID(); await captureServiceCheckpoint({ settings, registry, id, minFreeBytes: 0 });
  const backup = snapshotPath(settings.dataDir, id), backupDigest = await digest(backup);
  await registry.close();
  // A completed external tombstone after capture. Each trial gets its own ledger.
  const ledger = await json(path.join(settings.multiPicker.tombstoneDir, 'ledger.json'));
  ledger.pickers.push({ pickerId: tombstoned.id, lifecycle: 'deleted', deletingAt: '2026-01-01T00:00:00.000Z',
    deletedAt: '2026-01-01T00:00:00.000Z', purgeProgress: 'complete' });
  const target = async () => {
    const base = await mkdtemp(path.join(root, 'target-')), next = settingsAt(base);
    await mkdir(next.multiPicker.tombstoneDir);
    await writeFile(path.join(next.multiPicker.tombstoneDir, 'ledger.json'), encode(ledger));
    return next;
  };
  const restore = settings => ({ settings, backup, release, assertStopped: stopped,
    probe: async (...args) => { if (args[1].includes(incompatible.id)) throw new Error('Synthetic incompatibility'); return probe(...args); } });
  const prepareRelease = async settings => { await restoreServiceStopped(restore(settings)); };
  const releaseOptions = settings => ({ settings, id: incompatible.id, release, assertStopped: stopped, probe });
  return { root, settings, registry, document, pickers, legacy, incompatible, tombstoned, backup, backupDigest,
    target, restore, prepareRelease, releaseOptions, release };
}

// Follow the actual instruction, retaining uncertain bytes for inspection.
async function followMove(error) {
  assert.equal(error.code, 'OPERATOR_ACTION_REQUIRED');
  const match = error.message.match(/(?:^|\. )Move (.+) aside after checking .+; then rerun\.$/);
  assert(match, error.message);
  const destination = path.join(inspectionRoot, randomUUID());
  await rename(match[1], destination); inspected.set(match[1], destination);
}
async function retry(run, onRefusal = followMove) {
  try { return await run(); }
  catch (error) { await onRefusal(error); return run(); }
}
async function intact(f) {
  await verifyServiceBackup(f.backup);
  assert.equal(await digest(f.backup), f.backupDigest, 'backup bytes stay intact');
  for (const picker of f.pickers) {
    const captured = path.join(f.backup, 'pickers', picker.id);
    assert.equal(await digest(pickerPath(f.settings, picker)), await digest(captured), 'source payload stays intact');
    assert.equal(await bindingDigest(pickerPath(f.settings, picker)), await bindingDigest(captured));
  }
}
async function finalState(f, settings, released = false, compatible = false) {
  await intact(f);
  const rows = [];
  for (const picker of f.pickers) {
    const target = pickerPath(settings, picker), quarantined = path.join(settings.controlDir, 'quarantine', picker.id);
    const captured = await digest(path.join(f.backup, 'pickers', picker.id));
    const stages = [path.join(settings.controlDir, 'service-restore', picker.id, 'store'),
      path.join(settings.controlDir, 'release-' + picker.id, 'store')];
    for (const name of await readdir(path.dirname(target))) if (name.startsWith('.' + path.basename(target) + '.restore-')) stages.push(path.join(path.dirname(target), name, 'store'));
    const locations = [];
    for (const dir of [target, ...stages, quarantined]) if (await exists(dir) && await digest(dir) === captured) locations.push(dir);
    assert.equal(locations.length, picker.id === f.tombstoned.id ? 0 : 1, 'one final payload location; tombstones retained only in backup');
    if (picker.id === f.tombstoned.id) { assert(!await exists(target)); continue; }
    const expected = picker.id === f.incompatible.id && !released && !compatible ? quarantined : target;
    assert.deepEqual(locations, [expected]);
    assert.equal(await bindingDigest(expected), await bindingDigest(path.join(f.backup, 'pickers', picker.id)));
    rows.push({ id: picker.id, digest: await digest(expected), binding: await bindingDigest(expected), quarantined: expected === quarantined });
  }
  const quarantine = path.join(settings.controlDir, 'quarantine');
  const progress = await json(progressFile(settings));
  return { registry: sha(await readFile(path.join(settings.multiPicker.registryDir, 'registry.json'))), rows,
    quarantine: await exists(quarantine) ? await inventory(quarantine) : [],
    phase: progress.phase, pickers: progress.pickers.map(({ id, status, digest }) => ({ id, status, digest })),
    release: released ? (await json(releaseFile(settings, f.incompatible.id))).status : null };
}

async function sweep(t, f, prepare, run, state) {
  const baseline = await f.target(); await prepare(baseline);
  const labels = []; await run(baseline, async label => record(labels, label));
  const expected = await state(baseline);
  // The final iteration faults after the last mutation by returning normally,
  // then retries the completed operation too.
  for (let k = 1; k <= labels.length + 1; k++) {
    const settings = await f.target(); await prepare(settings);
    let calls = 0;
    const work = run(settings, async label => {
      assert.equal(label, labels[calls], 'stable mutation order');
      if (++calls === k) throw fault;
    });
    if (k <= labels.length) await assert.rejects(work, error => error === fault, `fault ${k}: ${labels[k - 1]}`);
    else await work;
    await intact(f);
    await retry(() => run(settings));
    assert.deepEqual(await state(settings), expected, `rerun after fault ${k}: ${labels[k - 1] ?? 'return'}`);
    await rm(path.dirname(settings.dataDir), { recursive: true, force: true });
  }
  t.diagnostic(`${labels.length} mutation calls, ${new Set(labels).size} labels; every fault and completed retry checked`);
  return labels;
}

test('capture sweep: every durable step, absent scope and pinned inputs', async t => {
  const f = await fixture(t), pack = path.join(f.root, 'pack'); await mkdir(pack);
  const payload = 'synthetic payload'; await writeFile(path.join(pack, 'payload'), payload);
  const packBytes = encode({ files: [{ path: 'payload', bytes: Buffer.byteLength(payload), sha256: sha(payload) }] });
  await writeFile(path.join(pack, 'pack.json'), packBytes);
  const profile = path.join(f.root, 'profile.json'); await writeFile(profile, '{}');
  const inputs = { data: { path: path.join(pack, 'pack.json'), sha256: sha(packBytes) }, profile: { path: profile, sha256: sha('{}') } };
  const id = randomUUID(), output = snapshotPath(f.settings.dataDir, id);
  const run = step => {
    let reads = 0;
    return captureServiceCheckpoint({ settings: f.settings, id, minFreeBytes: 0, inputs, step,
      registry: { withRecoveryCheckpoint: work => work(++reads === 1 ? structuredClone(f.document)
        : { ...f.document, pickers: f.document.pickers.filter(p => p.id !== f.tombstoned.id) }) } });
  };
  const labels = []; await run(async label => record(labels, label));
  const expected = await verifyServiceBackup(output);
  for (let k = 1; k <= labels.length + 1; k++) {
    await rm(output, { recursive: true, force: true });
    let calls = 0;
    if (k <= labels.length) await assert.rejects(run(async label => {
      assert.equal(label, labels[calls]); if (++calls === k) throw fault;
    }), error => error === fault);
    else await run();
    await intact(f);
    await retry(() => run());
    assert.deepEqual(await verifyServiceBackup(output), expected);
    assert.equal((await json(path.join(output, 'complete.json'))).id, id);
    if (inspected.has(output)) { await rm(inspected.get(output), { recursive: true, force: true }); inspected.delete(output); }
  }
  t.diagnostic(`${labels.length} mutation calls, ${new Set(labels).size} labels`);
});

test('capture failure cleanup sweep: interrupted error handling also refuses incomplete evidence', async t => {
  const f = await fixture(t), id = randomUUID(), output = snapshotPath(f.settings.dataDir, id);
  const ordinaryError = new Error('Synthetic capture failure');
  const run = (step, fail = true) => captureServiceCheckpoint({ settings: f.settings, id, minFreeBytes: 0, step,
    registry: { withRecoveryCheckpoint: work => work(structuredClone(f.document)) },
    onPhase: async phase => { if (fail && phase === 'picker-copied') throw ordinaryError; } });
  const labels = []; await assert.rejects(run(async label => record(labels, label)), error => error === ordinaryError);
  for (let k = 1; k <= labels.length; k++) {
    let calls = 0;
    await assert.rejects(run(async label => {
      assert.equal(label, labels[calls]); if (++calls === k) throw fault;
    }), error => error === fault);
    await intact(f);
    await retry(() => run(undefined, false));
    assert.deepEqual(await verifyServiceBackup(output), await verifyServiceBackup(f.backup));
    await rm(output, { recursive: true });
    if (inspected.has(output)) { await rm(inspected.get(output), { recursive: true, force: true }); inspected.delete(output); }
  }
  t.diagnostic(`${labels.length} mutation calls including failure cleanup`);
});

test('restore sweep: compatible, quarantined and tombstoned scopes', async t => {
  const f = await fixture(t);
  await sweep(t, f, async () => {}, (settings, step) => restoreServiceStopped({ ...f.restore(settings), step }), settings => finalState(f, settings));
});

test('restore archive sweep: completed journal with recovered empty disks', async t => {
  const f = await fixture(t);
  const run = (settings, step) => restoreServiceStopped({ ...f.restore(settings), probe, step });
  await sweep(t, f, async settings => {
    await run(settings);
    for (const dir of [settings.dataDir, settings.multiPicker.registryDir, settings.multiPicker.pickerRoot]) await rm(dir, { recursive: true });
    await rm(settings.dataDir + '.dataset.json');
  }, run, settings => finalState(f, settings, false, true));
});

test('quarantine metadata refusals name the exact repair, and following it completes the rerun', async t => {
  const f = await fixture(t), settings = await f.target(), options = f.restore(settings);
  await restoreServiceStopped(options);
  const record = path.join(settings.controlDir, 'quarantine', f.incompatible.id + '.json');
  const original = pickerPath(settings, f.incompatible), marker = path.join(original, 'operator-quarantine.json');
  const follow = async (pattern, repair) => {
    const error = await restoreServiceStopped(options).then(() => null, error => error);
    assert.equal(error?.code, 'OPERATOR_ACTION_REQUIRED', error?.message);
    const match = error.message.match(pattern); assert(match, error.message);
    await repair(match);
    await restoreServiceStopped(options);
  };
  // A changed record: the instruction names the record and its exact content.
  await writeFile(record, encode({ id: f.incompatible.id, kind: f.incompatible.kind, reason: 'changed' }));
  await follow(/^Move (.+) aside for inspection and write it containing exactly (\{.*\}); then rerun\.$/, async ([, file, content]) => {
    assert.equal(file, record);
    await rename(file, path.join(inspectionRoot, randomUUID())); await writeFile(file, content);
  });
  // A stray entry beside the placeholder: move everything else aside, keep only the marker.
  await writeFile(path.join(original, 'state.json'), 'synthetic stray bytes');
  await follow(/^Move every entry in (.+) aside for inspection, leaving only (.+) containing exactly (\{.*\}); then rerun\.$/, async ([, dir, file, content]) => {
    assert.equal(dir, original); assert.equal(file, marker);
    for (const name of await readdir(dir)) await rename(path.join(dir, name), path.join(inspectionRoot, randomUUID()));
    await writeFile(file, content);
  });
  assert.deepEqual(await readdir(original), ['operator-quarantine.json']);
});

test('release sweep: shared installer and cleanup after record removal', async t => {
  const f = await fixture(t);
  await sweep(t, f, f.prepareRelease, (settings, step) => releaseServiceQuarantine({ ...f.releaseOptions(settings), step }), settings => finalState(f, settings, true));
});

test('ownership sweep: repeat each interrupted chown with the same UID/GID', async t => {
  const f = await fixture(t), owners = new WeakMap();
  const changeFor = settings => async (file, uid, gid) => {
    if (!owners.has(settings)) owners.set(settings, new Map());
    owners.get(settings).set(path.relative(path.dirname(settings.dataDir), file), [uid, gid]);
  };
  await sweep(t, f, f.prepareRelease, (settings, step) => repairServiceOwnership({ settings, uid: 1001, gid: 1001, step, change: changeFor(settings) }),
    async settings => {
      const paths = [];
      for (const root of [settings.dataDir, settings.multiPicker.registryDir, settings.multiPicker.pickerRoot]) {
        paths.push(root, ...(await inventory(root)).map(row => path.join(root, row.path)));
      }
      paths.push(settings.dataDir + '.dataset.json', path.join(settings.multiPicker.tombstoneDir, 'ledger.json'));
      const expected = paths.map(file => [path.relative(path.dirname(settings.dataDir), file), [1001, 1001]]).sort();
      assert.deepEqual([...owners.get(settings)].sort(), expected);
      return { state: await finalState(f, settings), owners: expected };
    });
});

test('ownership native chown to another UID/GID', async t => {
  if (!process.getuid || process.getuid() !== 0) { t.skip('chown to another UID/GID requires root'); return; }
  const f = await fixture(t), settings = await f.target(); await f.prepareRelease(settings);
  await repairServiceOwnership({ settings, uid: 1001, gid: 1001 });
  for (const file of [settings.dataDir, settings.dataDir + '.dataset.json', path.join(settings.multiPicker.tombstoneDir, 'ledger.json')]) {
    const { uid, gid } = await lstat(file); assert.deepEqual([uid, gid], [1001, 1001]);
  }
  await finalState(f, settings);
});

test('ambiguous evidence: missing legacy install source is refused, then manually repopulated', async t => {
  const f = await fixture(t), settings = await f.target();
  await assert.rejects(restoreServiceStopped({ ...f.restore(settings), step: async label => { if (label === 'install.ready') throw fault; } }), error => error === fault);
  const journal = await json(progressFile(settings)), row = journal.pickers.find(p => p.id === f.legacy.id);
  // Model the older intent supported by the removed upgrade branch: installing,
  // no destination-ready receipt, and its source already renamed to the target.
  const source = path.join(settings.controlDir, 'service-restore', f.legacy.id, 'store');
  await rename(source, settings.dataDir); row.installing = true;
  await atomic(progressFile(settings), encode(journal));
  await assert.rejects(restoreServiceStopped(f.restore(settings)), asyncError => {
    assert.equal(asyncError.code, 'OPERATOR_ACTION_REQUIRED'); assert(asyncError.message.includes(`Repopulate ${source}`)); return true;
  });
  await rename(settings.dataDir, source); // Follow the named repopulation from the retained exact bytes.
  await restoreServiceStopped(f.restore(settings)); await finalState(f, settings);
});

test('ambiguous evidence: quarantining cannot accept missing or changed destination bytes', async t => {
  const f = await fixture(t), settings = await f.target(), id = f.incompatible.id;
  await assert.rejects(restoreServiceStopped({ ...f.restore(settings), step: async label => { if (label === 'quarantine.rename-binding') throw fault; } }), error => error === fault);
  const payload = path.join(settings.controlDir, 'quarantine', id), retained = payload + '.retained';
  await rename(payload, retained);
  for (const changed of [false, true]) {
    if (changed) { await mkdir(payload); await writeFile(path.join(payload, 'state.json'), '{}'); }
    await assert.rejects(restoreServiceStopped(f.restore(settings)), error => {
      assert.equal(error.code, 'OPERATOR_ACTION_REQUIRED'); assert(error.message.includes(`Restore ${payload}`)); return true;
    });
    await intact(f);
    if (changed) await rename(payload, payload + '.inspected');
  }
  await rename(retained, payload);
  await restoreServiceStopped(f.restore(settings)); await finalState(f, settings);
});

test('ambiguous evidence: release cleanup verifies installed bytes even with a record or released journal', async t => {
  const f = await fixture(t);
  for (const before of ['release.remove-quarantine', null]) {
    const settings = await f.target(); await f.prepareRelease(settings);
    if (before) await assert.rejects(releaseServiceQuarantine({ ...f.releaseOptions(settings), step: async label => { if (label === before) throw fault; } }), error => error === fault);
    else await releaseServiceQuarantine(f.releaseOptions(settings));
    const target = pickerPath(settings, f.incompatible), original = await readFile(path.join(target, 'state.json'));
    await writeFile(path.join(target, 'state.json'), '{}');
    const quarantine = path.join(settings.controlDir, 'quarantine');
    const beforeDigest = await digest(quarantine);
    await assert.rejects(releaseServiceQuarantine(f.releaseOptions(settings)), error => {
      assert.equal(error.code, 'OPERATOR_ACTION_REQUIRED'); assert(error.message.includes(`Restore ${target}`)); return true;
    });
    assert.equal(await digest(quarantine), beforeDigest, 'refusal never deletes quarantine');
    await writeFile(path.join(target, 'state.json'), original);
    await releaseServiceQuarantine(f.releaseOptions(settings)); await finalState(f, settings, true);
  }
});

test('ambiguous evidence: unrelated registry digest is refused and preserved for inspection', async t => {
  const f = await fixture(t), settings = await f.target();
  await assert.rejects(restoreServiceStopped({ ...f.restore(settings), step: async label => { if (label === 'restore.registry-publish') throw fault; } }), error => error === fault);
  const file = path.join(settings.multiPicker.registryDir, 'registry.json'); await writeFile(file, '{}');
  await retry(() => restoreServiceStopped(f.restore(settings)));
  assert.equal(await readFile(inspected.get(file), 'utf8'), '{}');
  await finalState(f, settings);
});

test('ambiguous evidence: partial sibling copy must match the retained migration source', async t => {
  const f = await fixture(t), settings = await f.target();
  let copies = 0;
  await assert.rejects(restoreServiceStopped({ ...f.restore(settings), step: async label => {
    if (label === 'install.copy-store' && ++copies === 2) throw fault;
  } }), error => error === fault);
  const row = (await json(progressFile(settings))).pickers.find(p => p.id === f.legacy.id);
  const partial = path.join(row.installStage, 'store');
  await writeFile(path.join(partial, 'unexpected.json'), '{}');
  await retry(() => restoreServiceStopped(f.restore(settings)));
  assert.equal(await readFile(path.join(inspected.get(partial), 'unexpected.json'), 'utf8'), '{}');
  await finalState(f, settings);
});

test('ambiguous evidence: changed quarantine payload is retained during release cleanup', async t => {
  const f = await fixture(t), settings = await f.target(); await f.prepareRelease(settings);
  await assert.rejects(releaseServiceQuarantine({ ...f.releaseOptions(settings), step: async label => {
    if (label === 'release.installed') throw fault;
  } }), error => error === fault);
  const retained = path.join(settings.controlDir, 'quarantine', f.incompatible.id);
  await writeFile(path.join(retained, 'unexpected.json'), '{}');
  await retry(() => releaseServiceQuarantine(f.releaseOptions(settings)));
  assert.equal(await readFile(path.join(inspected.get(retained), 'unexpected.json'), 'utf8'), '{}');
  await finalState(f, settings, true);
});

test('ambiguous evidence: released history with a quarantine record requires manual archival', async t => {
  const f = await fixture(t), settings = await f.target(); await f.prepareRelease(settings);
  await releaseServiceQuarantine(f.releaseOptions(settings));
  const target = pickerPath(settings, f.incompatible), retained = path.join(settings.controlDir, 'quarantine', f.incompatible.id);
  await rename(target, retained); await rename(target + '.dataset.json', retained + '.dataset.json');
  await mkdir(target); await writeFile(path.join(target, 'operator-quarantine.json'), encode({ id: f.incompatible.id }));
  await writeFile(retained + '.json', encode({ id: f.incompatible.id, kind: 'default', reason: 'incompatible' }));
  await retry(() => releaseServiceQuarantine(f.releaseOptions(settings)));
  assert(await exists(inspected.get(releaseFile(settings, f.incompatible.id))));
  await finalState(f, settings, true);
});

test('ambiguous evidence: duplicate quarantine rename endpoints require manual inspection', async t => {
  const f = await fixture(t), settings = await f.target();
  await assert.rejects(restoreServiceStopped({ ...f.restore(settings), step: async label => {
    if (label === 'quarantine.rename-binding') throw fault;
  } }), error => error === fault);
  const retained = path.join(settings.controlDir, 'quarantine', f.incompatible.id);
  const source = path.join(settings.controlDir, 'service-restore', f.incompatible.id, 'store');
  await copyTree(retained, source);
  await retry(() => restoreServiceStopped(f.restore(settings)));
  assert.equal(await digest(inspected.get(retained)), await digest(retained));
  await finalState(f, settings);
});

test('ambiguous evidence: a missing installed binding names its exact manual repair path', async t => {
  const f = await fixture(t), settings = await f.target(); await f.prepareRelease(settings);
  const binding = settings.dataDir + '.dataset.json', retained = path.join(f.root, 'retained-binding.json');
  await rename(binding, retained);
  await assert.rejects(restoreServiceStopped(f.restore(settings)), error => {
    assert.equal(error.code, 'OPERATOR_ACTION_REQUIRED');
    assert(error.message.includes(`Restore ${binding} from the verified backup`)); return true;
  });
  await rename(retained, binding);
  await restoreServiceStopped(f.restore(settings)); await finalState(f, settings);
});

test('ambiguous evidence: older quarantine journals need a named per-picker manual restart', async t => {
  const f = await fixture(t);
  for (const status of ['quarantining', 'quarantined']) {
    const settings = await f.target(); await f.prepareRelease(settings);
    const file = progressFile(settings), journal = await json(file);
    const row = journal.pickers.find(p => p.id === f.incompatible.id);
    row.status = status; delete row.digest; delete row.bindingSha256;
    await atomic(file, encode(journal));
    const retained = path.join(settings.controlDir, 'quarantine', f.incompatible.id);
    await assert.rejects(restoreServiceStopped(f.restore(settings)), error => {
      assert.equal(error.code, 'OPERATOR_ACTION_REQUIRED');
      assert.equal(error.message, `Move ${retained} and ${retained}.dataset.json aside for inspection; set picker ${f.incompatible.id} status to pending in ${file}; then rerun.`);
      return true;
    });
    await rename(retained, path.join(inspectionRoot, randomUUID()));
    await rename(retained + '.dataset.json', path.join(inspectionRoot, randomUUID()));
    row.status = 'pending'; await atomic(file, encode(journal));
    await restoreServiceStopped(f.restore(settings)); await finalState(f, settings);
  }
});

test('every crash-table label is exercised by a fault sweep', async () => {
  const contract = await readFile(new URL('../docs/multi-picker-contract.md', import.meta.url), 'utf8');
  const section = contract.slice(contract.indexOf('### MP8 crash points'));
  const labels = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  assert.deepEqual([...covered].sort(), [...new Set(labels)].sort());
});
