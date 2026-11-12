// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { openStore } from '../app/storage/store.mjs';
import { createOwnedStorage } from '../app/storage/owned-storage.mjs';
import { fixture, options, now, world as fixtureWorld, taskCatalogue } from './helpers/owned-format2-fixture.mjs';
import { rebaseOptions } from './helpers/owned-rebase-fixture.mjs';
const world = { ...fixtureWorld, surface: new Set(fixtureWorld.chunks.keys()) };
const note = { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic boundary save' };
const seams = ['catalogue-shared-admitted', 'catalogue-shared-releasing', 'catalogue-exclusive-admitted', 'catalogue-exclusive-releasing', 'catalogue-base-selected'];
test('crash and interruption at catalogue admission/selection boundaries preserve exact save bytes', { timeout: 120000 }, async t => {
  for (const failure of ['exit', 'throw']) for (const seam of seams) await t.test(`${failure}: ${seam}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rs3-catalogue-boundary-'));
    const catalogueRoot = path.join(root, 'catalogue'), dataDir = path.join(root, 'group');
    const open = dir => openStore({ dataDir: dir, initialState: fixture().state, ownedFormat2: options(catalogueRoot), now, world, taskCatalogue, retention: false, completionCodec: false });
    let handle;
    try {
      handle = await open(dataDir); await handle.close();
      const oldBytes = await readFile(path.join(dataDir, 'state.json'));
      handle = await open(path.join(root, 'control')); await handle.command(note, 0); await handle.close();
      const newBytes = await readFile(path.join(root, 'control/state.json'));
      if (seam === 'catalogue-base-selected') await createOwnedStorage(rebaseOptions(catalogueRoot).newer, dataDir).ensurePublished();
      const bases = await readdir(catalogueRoot), baseBytes = await Promise.all(bases.map(file => readFile(path.join(catalogueRoot, file))));
      const child = fork(fileURLToPath(new URL('./helpers/owned-catalogue-crash.mjs', import.meta.url)), [dataDir, catalogueRoot, seam, failure], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
      let diagnostic = ''; child.stderr.on('data', bytes => { diagnostic += bytes; });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      assert.equal(code, failure === 'exit' ? 71 : 72, diagnostic);
      const expected = seam.endsWith('-releasing') ? newBytes : oldBytes;
      assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), expected);
      assert.deepEqual(await Promise.all(bases.map(file => readFile(path.join(catalogueRoot, file)))), baseBytes);
      handle = await open(dataDir);
      assert.equal(handle.getInfo().revision, seam.endsWith('-releasing') ? 1 : 0);
      await handle.command({ ...note, note: 'Synthetic after recovery' }, handle.getInfo().revision); await handle.close();
    } finally { await handle?.close(); await rm(root, { recursive: true, force: true }); }
  });
});
