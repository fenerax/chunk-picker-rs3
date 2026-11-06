// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { assertStopped } from '../scripts/linux/operator.mjs';
import { inventory } from '../scripts/linux/files.mjs';

async function fixture(t, mode) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-start-ownership-'));
  const dataDir = path.join(root, 'store'), controlDir = path.join(root, 'control');
  await mkdir(controlDir);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/plugin-suppression-owner-child.mjs', import.meta.url)), dataDir, mode ?? 'store'],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  const exited = once(child, 'exit'); let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; };
  t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Synthetic owner failed to start: ${stderr}`)), 60_000);
    child.once('message', message => { clearTimeout(timer); assert.equal(message.ready, true); resolve(); });
    exited.then(() => { clearTimeout(timer); reject(new Error(`Synthetic owner exited early: ${stderr}`)); }, reject);
  });
  return { dataDir, controlDir, stop };
}

for (const marker of ['lock', 'recovery', 'both']) for (const kind of [undefined, 'items', 'achievements']) {
  test(`start recovers a killed ${marker} owner${kind ? ` and reconciles ${kind}` : ''}`, async t => {
    const f = await fixture(t); await f.stop();
    const lock = path.join(f.dataDir, 'store.lock'), owner = await readFile(lock);
    if (marker !== 'lock') await writeFile(lock + '.recovery', owner);
    if (marker === 'recovery') await rm(lock);
    if (kind) {
      const file = path.join(f.dataDir, 'state.json'), document = JSON.parse(await readFile(file));
      document.state.provenance = { pluginAutoHandled: { owner: { items: kind === 'items' ? ['custom:synthetic'] : [], achievements: kind === 'achievements' ? [1] : [] } } };
      await writeFile(file, JSON.stringify(document));
    }
    await checkStart(f);
    for (const file of [lock, lock + '.recovery']) await assert.rejects(readFile(file), { code: 'ENOENT' });
    if (kind) assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, `plugin-${kind}.json`))).players.owner.handled,
      kind === 'items' ? ['custom:synthetic'] : [1]);
    const store = await openStore({ dataDir: f.dataDir, retention: false });
    try { if (kind) assert.equal(store.isPluginHandled('owner', kind, kind === 'items' ? 'custom:synthetic' : 1), true); }
    finally { await store.close(); }
  });
}

for (const mode of ['store', 'file-only']) test(`the start gate refuses a live ${mode} owner without changing its files`, async t => {
  const f = await fixture(t, mode), before = await inventory(f.dataDir);
  await assert.rejects(checkStart(f), { code: 'PLUGIN_RECONCILIATION_FAILED' });
  assert.deepEqual(await inventory(f.dataDir), before);
});

for (const marker of ['store.lock', 'store.lock.recovery']) for (const record of ['{}', '{"pid":1,"host":"synthetic-foreign-owner"}']) {
  test(`the start gate preserves unverifiable ${marker} ownership (${record})`, async t => {
    const f = await fixture(t); await f.stop();
    await rm(path.join(f.dataDir, 'store.lock'));
    await writeFile(path.join(f.dataDir, marker), record);
    const before = await inventory(f.dataDir);
    await assert.rejects(checkStart(f), { code: 'PLUGIN_RECONCILIATION_FAILED' });
    assert.deepEqual(await inventory(f.dataDir), before);
    await assert.rejects(openStore({ dataDir: f.dataDir, retention: false }), /owner|lock/i);
    assert.deepEqual(await inventory(f.dataDir), before, 'The gate makes the same ownership decision as the runtime');
  });
}

test('automatic operator stopped checks recover the same killed owner before start', async t => {
  const f = await fixture(t); await f.stop();
  await assertStopped({ state: async () => ({ stopped: true }) }, f.dataDir);
  await checkStart(f);
  const store = await openStore({ dataDir: f.dataDir, retention: false }); await store.close();
});

test('a clean gate does not publish owner files', async t => {
  const f = await fixture(t); await f.stop();
  const store = await openStore({ dataDir: f.dataDir, retention: false }); await store.close();
  t.mock.method(fs.promises, 'link', async () => { throw new Error('Clean boots must not publish lock owners.'); });
  syncBuiltinESMExports();
  try { await checkStart(f); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
