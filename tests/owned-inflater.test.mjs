// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile, fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { inflateOwnedFormat1 } from '../scripts/linux/inflate-owned-format-1.mjs';
import { inventory, encode, sha, exists } from '../scripts/linux/files.mjs';
import { openStore } from '../app/storage/store.mjs';
import { acquireProcessGuard } from '../app/storage/process-guard.mjs';
import { stageOwnedRebase, reconcileOwnedRebase } from '../app/storage/owned-rebase.mjs';
import { importBackup } from '../app/core/state.mjs';
import { fixture, commands } from './helpers/owned-format2-fixture.mjs';
import { rebaseOptions } from './helpers/owned-rebase-fixture.mjs';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { inflaterFixture, packAndArchive, settingsForStore } from './helpers/owned-inflater-fixture.mjs';

const hash = value => sha(JSON.stringify(value));
test('owned format-1 inflater acceptance', async t => {
  const frozen = await frozenRuntime(t);
  const run = f => inflateOwnedFormat1({ ...f, frozen });
  const live = f => f.stores[0].dataDir;
  const unchanged = async (f, before) => assert.deepEqual(await inventory(live(f)), before);
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
    const child = fork(fileURLToPath(new URL('./helpers/owned-inflater-crash.mjs', import.meta.url)), [config, seam, frozen.checkout], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
    const [code] = await once(child, 'exit'); assert.equal(code, 72, stderr);
    if (!['install-renamed', 'file-installed', 'store-installed', 'complete', 'maintenance-cleared'].includes(seam)) await unchanged(f, before);
    if (seam !== 'maintenance-cleared') assert(await exists(path.join(f.settings.controlDir, 'maintenance.json')));
    const result = await run(f); assert.equal(result.phase, 'complete');
    for (const store of f.stores) assert.deepEqual(await readFile(path.join(store.dataDir, 'state.json')), await readFile(path.join(f.flatDir, 'state.json')));
    assert.equal(await exists(path.join(f.settings.controlDir, 'maintenance.json')), false);
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
