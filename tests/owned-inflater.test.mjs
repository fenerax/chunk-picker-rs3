// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile, fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, writeFile, rm, utimes } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { inflateOwnedFormat1 } from '../scripts/linux/inflate-owned-format-1.mjs';
import { inventory, encode, sha, exists, atomic } from '../scripts/linux/files.mjs';
import { openStore } from '../app/storage/store.mjs';
import { acquireProcessGuard } from '../app/storage/process-guard.mjs';
import { stageOwnedRebase, reconcileOwnedRebase } from '../app/storage/owned-rebase.mjs';
import { importBackup, validateState } from '../app/core/state.mjs';
import { ownedRecoveryStates } from '../scripts/linux/owned-recovery.mjs';
import { syncRecoveryTree, syncRecoveryDirectory } from '../scripts/linux/service-checkpoint.mjs';
import { fixture, commands } from './helpers/owned-format2-fixture.mjs';
import { rebaseOptions } from './helpers/owned-rebase-fixture.mjs';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { inflaterFixture, packAndArchive, settingsForStore } from './helpers/owned-inflater-fixture.mjs';
import { auditInflater, windowsFileUsers } from './helpers/owned-inflater-diagnostics.mjs';

const hash = value => sha(JSON.stringify(value));
test('owned format-1 inflater acceptance', async t => {
  const frozen = await frozenRuntime(t);
  const fileUsers = process.platform === 'win32' ? await windowsFileUsers() : undefined;
  if (fileUsers) t.after(() => fileUsers.close());
  const run = f => inflateOwnedFormat1({ ...f, frozen });
  const live = f => f.stores[0].dataDir;
  const unchanged = async (f, before) => assert.deepEqual(await inventory(live(f)), before);
  if (fileUsers) await t.test('scoped Windows probe identifies the exact non-delete-sharing file owner', async t => {
    const f = await inflaterFixture(t), file = path.join(f.root, 'synthetic-journal.json');
    await writeFile(file, '{}');
    await fileUsers.hold(file);
    try {
      const { files: [row] } = await fileUsers.inspect([file]);
      assert.equal(row.deleteAccessError, 32); // ERROR_SHARING_VIOLATION
      assert(row.users.some(user => user.pid === fileUsers.pid));
    } finally { await fileUsers.release(); }
    assert.equal((await fileUsers.inspect([file])).files[0].deleteAccessError, 0);
  });
  await t.test('valid but wrong decoded task and identity rows refuse the independent encoder round trip', async t => {
    for (const role of ['task', 'identity']) {
      const f = await inflaterFixture(t, { populated: true }), before = await inventory(live(f));
      async function* corruptDecoder(store, options) {
        for await (const row of ownedRecoveryStates(store, options)) {
          const target = role === 'task' ? row.state.tasks[0] : Object.values(row.state.identityRegistry.entries)[0];
          target.label = 'Synthetic valid but wrong decoder row';
          assert.doesNotThrow(() => validateState(row.state));
          yield row;
        }
      }
      await assert.rejects(run({ ...f, readStates: corruptDecoder }), /codec round-trip state\/storage bytes differ/);
      await unchanged(f, before);
    }
  });
  await t.test('retained-tree parent sync failure prevents verification publication', async t => {
    const f = await inflaterFixture(t), before = await inventory(live(f)); let treeSynced = false;
    await assert.rejects(run({ ...f,
      syncTree: async root => { await syncRecoveryTree(root); treeSynced = true; },
      syncDirectory: async root => {
        if (treeSynced && path.basename(root).startsWith('p_')) throw Error('Synthetic retained-parent sync refusal');
        await syncRecoveryDirectory(root);
      } }), /Synthetic retained-parent sync refusal/);
    const journal = JSON.parse(await readFile(path.join(f.settings.controlDir, 'inflate-owned-format-1/progress.json')));
    assert.deepEqual(journal.stores, []); assert.equal(journal.phase, 'staging'); await unchanged(f, before);
  });
  await t.test('every journal step follows its entry-parent sync, including both rename parents', async t => {
    const f = await inflaterFixture(t), events = [];
    await run({ ...f, syncTree: async root => { await syncRecoveryTree(root); events.push(['tree', root]); },
      syncDirectory: async root => { await syncRecoveryDirectory(root); events.push(['directory', root]); },
      crash: label => { events.push(['step', label]); } });
    const work = path.join(f.settings.controlDir, 'inflate-owned-format-1');
    const sourceIndex = events.findIndex(row => row[0] === 'tree' && path.basename(row[1]) === 'source');
    const stage = path.dirname(events[sourceIndex][1]);
    for (const label of ['source-staged', 'output-staged', 'frozen-verified', 'install-temporary']) {
      const index = events.findIndex(row => row[0] === 'step' && row[1] === label);
      assert.deepEqual(events[index - 1], ['directory', stage], label);
    }
    for (const label of ['journal-created', 'store-verified', 'all-verified', 'install-intent', 'file-installed', 'store-installed', 'complete']) {
      const index = events.findIndex(row => row[0] === 'step' && row[1] === label);
      assert.deepEqual(events[index - 1], ['directory', work], label);
    }
    const renamed = events.findIndex(row => row[0] === 'step' && row[1] === 'install-renamed');
    assert.deepEqual(events.slice(renamed + 1, renamed + 4), [['directory', live(f)], ['directory', stage], ['directory', work]]);
    assert(events.slice(0, sourceIndex).some(row => row[0] === 'directory' && row[1] === path.dirname(f.settings.controlDir)));
  });
  await t.test('space admission retains the 64 MiB reserve at the exact first-run and resume boundaries', async t => {
    const sum = rows => rows.reduce((total, row) => total + (row.bytes ?? 0), 0), reserve = 64 * 1024 * 1024;
    const withUnchangedFile = async () => {
      const f = await inflaterFixture(t);
      for (const dir of [live(f), f.flatDir]) await writeFile(path.join(dir, 'synthetic-evidence.bin'), Buffer.alloc(64 * 1024, 42));
      return f;
    };
    const low = await withUnchangedFile(), before = await inventory(live(low));
    const sourceBytes = sum(before), outputBytes = sum(await inventory(low.flatDir));
    const documentBytes = (await readFile(path.join(low.flatDir, 'state.json'))).length;
    const probeBytes = outputBytes + documentBytes, initialBytes = sourceBytes + outputBytes + probeBytes;
    await assert.rejects(run({ ...low, statfs: async () => ({ bavail: BigInt(initialBytes + reserve - 1), bsize: 1n }) }), /insufficient free space/);
    await unchanged(low, before);
    const exact = await withUnchangedFile();
    await run({ ...exact, statfs: async () => ({ bavail: BigInt(initialBytes + reserve), bsize: 1n }) });
    const resumed = await withUnchangedFile(), original = await inventory(live(resumed));
    await assert.rejects(run({ ...resumed, crash: label => { if (label === 'all-verified') throw Error('Synthetic verified stop'); } }), /Synthetic verified stop/);
    const journal = JSON.parse(await readFile(path.join(resumed.settings.controlDir, 'inflate-owned-format-1/progress.json')));
    const stage = path.join(resumed.settings.controlDir, 'inflate-owned-format-1', journal.stores[0].attempt);
    assert(!(await readdir(stage)).some(name => name.startsWith('probe-')));
    const rows = await inventory(path.join(stage, 'output')), stateBytes = (await readFile(path.join(stage, 'output/state.json'))).length;
    const resumeBytes = sum(rows) + stateBytes;
    await assert.rejects(run({ ...resumed, statfs: async () => ({ bavail: BigInt(resumeBytes + reserve - 1), bsize: 1n }) }), /insufficient free space/);
    await unchanged(resumed, original);
    await run({ ...resumed, statfs: async () => ({ bavail: BigInt(resumeBytes + reserve), bsize: 1n }) });
    assert(!(await readdir(stage)).some(name => name.startsWith('probe-')));
  });
  await t.test('an explicitly provisioned local frozen repository works and missing provisioning refuses clearly', async t => {
    const f = await inflaterFixture(t), repo = fileURLToPath(new URL('../', import.meta.url));
    await inflateOwnedFormat1({ ...f, frozenRepository: repo });
    const missing = await inflaterFixture(t), before = await inventory(live(missing));
    await assert.rejects(inflateOwnedFormat1({ ...missing, frozenRepository: '' }), /provision.*local Git repository/i);
    await assert.rejects(inflateOwnedFormat1({ ...missing, frozenRepository: path.join(missing.root, 'unprovisioned') }), /Provision a local Git repository/);
    await unchanged(missing, before);
  });
  await t.test('converted interrupted-retention duplicates prune: current string packs and frozen object packs', async t => {
    for (const api of [{ openStore }, frozen]) {
      const f = await inflaterFixture(t, { populated: true }), dataDir = live(f), backups = path.join(dataDir, 'backups');
      const names = (await readdir(backups)).filter(name => name.endsWith('.json.gz'));
      assert.equal(names.length, 8);
      const originals = new Map(), oldTime = new Date('2025-01-01T00:00:00.000Z');
      for (const name of names) { originals.set(name, await readFile(path.join(backups, name))); await utimes(path.join(backups, name), oldTime, oldTime); }
      const retention = { backupDays: 1, historyEntries: 1000 };
      const source = await openStore({ ...settingsForStore, dataDir, ownedFormat2: f.ownedFormat2, retention });
      try { await source.prepareSnapshot(); assert.equal(source.getInfo().retention.failure, undefined); } finally { await source.close(); }
      assert.equal((await readdir(backups)).filter(name => name.endsWith('.json.gz')).length, 2);
      // Recreate the durable duplicates left by a crash before standalone unlink.
      for (const [name, content] of originals) { await writeFile(path.join(backups, name), content); await utimes(path.join(backups, name), oldTime, oldTime); }
      if (api === frozen) {
        // Frozen retention predates string-valued packs (also written by native
        // current format 1). Its supported historic object form must prune too.
        const archives = path.join(backups, 'archives');
        for (const name of await readdir(archives)) {
          const file = path.join(archives, name), pack = JSON.parse(gunzipSync(await readFile(file)));
          for (const snapshot of pack.snapshots) snapshot.document = JSON.parse(snapshot.document);
          await writeFile(file, gzipSync(JSON.stringify(pack)));
        }
      }
      await run(f);
      const store = await api.openStore({ ...settingsForStore, dataDir, retention });
      try {
        await store.prepareSnapshot(); assert.equal(store.getInfo().retention.failure, undefined);
        assert.equal((await readdir(backups)).filter(name => name.endsWith('.json.gz')).length, 2);
      } finally { await store.close(); }
    }
  });
  await t.test('format-1 differential bytes, frozen current/standalone/packed loads, History/Undo and portable round trip', async t => {
    const f = await inflaterFixture(t, { populated: true, second: true });
    const portableStore = await openStore({ ...settingsForStore, dataDir: live(f), ownedFormat2: f.ownedFormat2 });
    const portable = await portableStore.backup();
    const exported = JSON.parse(Buffer.from((await portableStore.exportBackup()).bytes));
    assert.deepEqual(importBackup(exported), portable.state);
    const coreExport = frozen.core.exportBackup(importBackup(portable));
    assert.deepEqual(coreExport.state, portable.state);
    await portableStore.close();
    await packAndArchive(f.flatDir); for (const store of f.stores) await packAndArchive(store.dataDir);
    const legacy = await inventory(f.settings.dataDir), before = await inventory(live(f));
    const result = await run(f);
    assert.equal(result.phase, 'complete'); assert.equal(result.stores.length, 2);
    assert(result.stores.every(row => row.proofs.length > commands.length));
    const expectedBytes = await readFile(path.join(f.flatDir, 'state.json'));
    assert.deepEqual(await readFile(path.join(live(f), 'state.json')), expectedBytes);
    const raw = JSON.parse(expectedBytes); assert(raw.state.tasks); assert(raw.state.identityRegistry); assert.equal(raw.storage, undefined);
    const retained = async dir => (await Promise.all((await readdir(path.join(dir, 'backups'))).filter(name => name.endsWith('.gz')).map(async name => gunzipSync(await readFile(path.join(dir, 'backups', name))).toString()))).sort();
    assert.deepEqual(await retained(live(f)), await retained(f.flatDir));
    assert.deepEqual(await inventory(f.settings.dataDir), legacy);
    const journal = JSON.parse(await readFile(result.journal)), row = journal.stores[0];
    const preimage = path.join(path.dirname(result.journal), row.attempt, 'source');
    assert.deepEqual(await inventory(preimage), before);
    const restored = await openStore({ ...settingsForStore, dataDir: path.join(f.root, 'portable'), initialState: importBackup(portable) });
    try { assert.equal(hash((await restored.backup()).state), hash(portable.state)); } finally { await restored.close(); }
    const old = await frozen.openStore({ ...settingsForStore, dataDir: live(f) });
    const flat = await openStore({ ...settingsForStore, dataDir: f.flatDir });
    try {
      assert.equal(hash((await old.backup()).state), hash((await flat.backup()).state));
      assert.deepEqual(await old.command({ type: 'undo' }, old.getInfo().revision), await flat.command({ type: 'undo' }, flat.getInfo().revision));
    } finally { await old.close(); await flat.close(); }
  });
  await t.test('compatible private metadata and optional evidence are retained exactly', async t => {
    const f = await inflaterFixture(t), file = path.join(live(f), 'state.json');
    const store = await openStore({ ...settingsForStore, dataDir: live(f), ownedFormat2: f.ownedFormat2 });
    await store.command(commands[2], 0);
    const actor = { kind: 'master', label: 'Synthetic operator' }, session = await store.openActionSession(randomUUID(), { actor });
    await store.commandSerialized({ type: 'set-journal', memberId: 'member-1', note: 'Synthetic receipt' }, store.getInfo().revision,
      { actor, requestId: `v3.${session.scope}.${session.slot}.${session.generation}.1`, requestAck: 0 });
    await store.observePluginCurrency({ memberId: 'member-1', keyId: '00000000-0000-4000-8000-000000000001', seq: 1, sentAt: settingsForStore.now(), coins: 10 });
    await store.close();
    const saved = JSON.parse(await readFile(file));
    assert(saved.actionReceipts); assert(saved.coordination); assert(saved.pluginCurrency);
    saved.optionalSidecarEvidence = { synthetic: 'opaque-compatible-carrier' };
    await writeFile(file, JSON.stringify(saved) + '\n');
    await run(f);
    const output = JSON.parse(await readFile(file));
    for (const key of ['coordination', 'actionReceipts', 'pluginCurrency', 'optionalSidecarEvidence']) assert.deepEqual(output[key], saved[key]);
  });
  await t.test('slice-5 storage-only rebase inflates against its retained pin', async t => {
    const f = await inflaterFixture(t, { populated: true }), dataDir = live(f);
    const { source, target, newer } = rebaseOptions(f.ownedFormat2.catalogueRoot);
    await writeFile(dataDir + '.dataset.json', JSON.stringify({ schemaVersion: 1, datasetId: source.dataset.id, datasetContractVersion: source.dataset.contractVersion, digest: source.dataset.digest }));
    await stageOwnedRebase({ dataDir, ownedFormat2: source, target });
    await reconcileOwnedRebase({ dataDir, ownedFormat2: source, target });
    await run({ ...f, ownedFormat2: newer });
    const old = await frozen.openStore({ ...settingsForStore, dataDir, readOnly: true });
    try { assert.equal(hash((await old.backup()).state), hash(f.stores[0].state)); } finally { await old.close(); }
  });
  for (const damage of ['missing-base', 'corrupt-base', 'wrong-pin', 'missing-static', 'corrupt-static', 'missing-history', 'corrupt-history']) await t.test(`${damage} refuses without replacing source`, async t => {
    const f = await inflaterFixture(t, { populated: true }), dir = live(f), file = path.join(dir, 'state.json');
    if (damage.includes('base')) {
      const base = path.join(f.ownedFormat2.catalogueRoot, `catalogue-${fixture().pin.sha256}.json.gz`);
      if (damage.startsWith('missing')) await rm(base); else await writeFile(base, gzipSync(Buffer.from('corrupt synthetic base')));
    } else if (damage === 'wrong-pin') f.ownedFormat2.manifest = { schemaVersion: 1, bases: {} };
    else if (damage.includes('static')) {
      const document = JSON.parse(await readFile(file)), content = Buffer.from(JSON.stringify(document.state.legacy)), checksum = sha(content);
      await mkdir(path.join(dir, 'static'), { recursive: true });
      document.storage.fields = { legacy: { id: `static-${checksum}.json.gz`, sha256: checksum } }; delete document.state.legacy;
      await writeFile(file, JSON.stringify(document));
      if (damage.startsWith('corrupt')) await writeFile(path.join(dir, 'static', `static-${checksum}.json.gz`), gzipSync(Buffer.from('{}')));
    } else {
      await packAndArchive(dir);
      const history = path.join(dir, 'history', (await readdir(path.join(dir, 'history')))[0]);
      if (damage.startsWith('missing')) await rm(history); else await writeFile(history, 'corrupt synthetic history');
    }
    const before = await inventory(dir); await assert.rejects(run(f)); await unchanged(f, before);
  });
  await t.test('injected statfs space refusal and active service/held store/catalogue locks preserve source', async t => {
    for (const kind of ['space', 'service', 'store-file', 'store', 'catalogue']) {
      const f = await inflaterFixture(t), dir = live(f); let release;
      if (kind === 'store-file') await writeFile(path.join(dir, 'store.lock'), 'synthetic-held');
      if (kind === 'store' || kind === 'catalogue') release = await acquireProcessGuard(kind === 'store' ? dir : f.ownedFormat2.catalogueRoot);
      const before = await inventory(dir);
      try {
        await assert.rejects(run({ ...f, ...(kind === 'space' ? { statfs: async () => ({ bavail: 0n, bsize: 1n }) } : {}),
          ...(kind === 'service' ? { controller: { state: async () => ({ stopped: false }) } } : {}) }));
        await unchanged(f, before);
      } finally { await release?.(); }
    }
  });
  for (const seam of ['maintenance', 'journal-created', 'source-staged', 'output-staged', 'frozen-verified', 'store-verified', 'all-verified', 'install-intent', 'before-install', 'install-temporary', 'install-renamed', 'file-installed', 'store-installed', 'complete', 'maintenance-cleared']) await t.test(`process crash at ${seam}, then digest-keyed resume`, async t => {
    const f = await inflaterFixture(t, { populated: true, second: true }), before = await inventory(live(f));
    const config = path.join(f.root, 'config.json'); await writeFile(config, JSON.stringify({ settings: f.settings, ownedFormat2: f.ownedFormat2 }));
    const journal = path.join(f.settings.controlDir, 'inflate-owned-format-1/progress.json');
    const audit = auditInflater(journal, { inspectFailure: fileUsers?.inspect }); t.after(() => audit.restore());
    const child = fork(fileURLToPath(new URL('./helpers/owned-inflater-crash.mjs', import.meta.url)), [config, seam, frozen.checkout], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let stderr = '', evidence; child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
    child.on('message', message => { evidence = message; });
    const [code] = await once(child, 'close'); assert.equal(code, 72, stderr);
    assert.equal(evidence?.point, seam);
    assert.deepEqual(evidence.audit.children, [], 'The crash path must spawn no descendant processes.');
    assert.deepEqual(evidence.audit.workers, [], 'Frozen read-only proof must spawn no worker threads.');
    assert.deepEqual(evidence.audit.active, [], 'The crash child must have no open journal handles.');
    assert(evidence.audit.renames.every(row => row.active.length === 0));
    // No retry: one immediate replacement after close, then the ordinary resume.
    if (seam === 'maintenance-cleared') await atomic(journal, await readFile(journal));
    if (!['install-renamed', 'file-installed', 'store-installed', 'complete', 'maintenance-cleared'].includes(seam)) await unchanged(f, before);
    if (seam !== 'maintenance-cleared') assert(await exists(path.join(f.settings.controlDir, 'maintenance.json')));
    const result = await run(f); assert.equal(result.phase, 'complete');
    for (const store of f.stores) assert.deepEqual(await readFile(path.join(store.dataDir, 'state.json')), await readFile(path.join(f.flatDir, 'state.json')));
    assert.equal(await exists(path.join(f.settings.controlDir, 'maintenance.json')), false);
    const completed = audit.snapshot();
    assert.deepEqual(completed.active, []);
    assert.deepEqual(completed.children, [{ pid: child.pid, closed: true }]);
    assert.deepEqual(completed.workers, []);
    assert(completed.renames.every(row => row.active.length === 0 && row.succeeded));
  });
  await t.test('changed source/output digests refuse resume; a late store failure cannot install an earlier store', async t => {
    const f = await inflaterFixture(t, { second: true });
    const before = await inventory(live(f));
    const second = path.join(f.stores[1].dataDir, 'state.json'), document = JSON.parse(await readFile(second));
    document.storage.base.sha256 = '0'.repeat(64); await writeFile(second, JSON.stringify(document));
    await assert.rejects(run(f)); await unchanged(f, before);
    const progress = JSON.parse(await readFile(path.join(f.settings.controlDir, 'inflate-owned-format-1/progress.json')));
    const stage = path.join(f.settings.controlDir, 'inflate-owned-format-1', progress.stores[0].attempt, 'output/state.json');
    await writeFile(stage, '{}'); await assert.rejects(run(f), /digest differs/); await unchanged(f, before);
  });
  await t.test('format-1 and legacy runtime bytes/commands/errors match origin/main', async t => {
    const f = await inflaterFixture(t), reference = path.join(f.root, 'reference'); await mkdir(reference);
    const archive = path.join(f.root, 'reference.tar');
    await promisify(execFile)('git', ['archive', '--format=tar', '--output', archive, 'origin/main', 'app', 'scripts'], { windowsHide: true });
    execFileSync('tar', ['-xf', archive, '-C', reference], { windowsHide: true });
    const old = await import(pathToFileURL(path.join(reference, 'app/storage/store.mjs')));
    for (const kind of ['format-1', 'legacy-shared']) {
      const handles = [];
      try {
        for (const [index, api] of [old, { openStore }].entries()) handles.push(await api.openStore({ ...settingsForStore, dataDir: path.join(f.root, `${kind}-${index}`), initialState: fixture().state }));
        for (const command of [...commands, { type: 'undo' }, { type: 'synthetic-unknown' }]) {
          const outcomes = await Promise.all(handles.map(store => store.command(command, store.getInfo().revision).catch(error => ({ error: error.message }))));
          assert.deepEqual(outcomes[1], outcomes[0]);
          assert.deepEqual(await readFile(path.join(f.root, `${kind}-1/state.json`)), await readFile(path.join(f.root, `${kind}-0/state.json`)));
        }
      } finally { for (const store of handles) await store.close(); }
    }
  });
});
