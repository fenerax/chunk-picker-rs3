// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { inventory } from '../scripts/linux/files.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-optional-start-'));
  const dataDir = path.join(root, 'store'), controlDir = path.join(root, 'control');
  await mkdir(dataDir); await mkdir(controlDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { dataDir, controlDir };
}

for (const carrier of ['atomic', 'capsule', 'archive', 'items', 'achievements', 'missing-checkpoint']) {
  test(`startup leaves unusable optional ${carrier} evidence to the selected runtime`, async t => {
    const f = await fixture(t);
    const provenance = carrier === 'atomic' ? { pluginAutoHandled: 'invalid' }
      : carrier === 'capsule' ? { optionalSidecarEvidence: { schemaVersion: 99 } }
        : { restore: { incomingProvenance: { pluginAutoHandled: 'invalid' } } };
    if (carrier !== 'missing-checkpoint') await writeFile(path.join(f.dataDir, 'state.json'), JSON.stringify({ state: { provenance } }));
    await writeFile(path.join(f.dataDir, `plugin-${carrier === 'achievements' ? 'achievements' : 'items'}.json`), '{}');
    await writeFile(path.join(f.controlDir, 'plugin-reconciliation-refused.json'), '{}');
    const before = await inventory(f.dataDir), original = fs.promises.readFile;
    t.mock.method(fs.promises, 'readFile', async (file, ...args) => {
      assert.ok(!String(file).startsWith(f.dataDir), 'ExecStartPre must not parse or hash picker/plugin data');
      return original(file, ...args);
    });
    syncBuiltinESMExports();
    try { await checkStart(f); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.deepEqual(await inventory(f.dataDir), before);
  });
}

test('removing plugin vetoes preserves transaction and service access checks', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.controlDir, 'tools-transaction.json'), '{}');
  await assert.rejects(checkStart(f), /Tools transaction/);
  await rm(path.join(f.controlDir, 'tools-transaction.json'));
  await assert.rejects(checkStart(f, { access: async () => { throw new Error('Synthetic service access refusal'); } }), /service access/);
});
