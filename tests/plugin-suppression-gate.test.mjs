// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { inventory } from '../scripts/linux/files.mjs';

async function fixture(t, document) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-replay-gate-'));
  const dataDir = path.join(root, 'store'), controlDir = path.join(root, 'control');
  await mkdir(dataDir); await mkdir(controlDir);
  if (document !== undefined) await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(document));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { dataDir, controlDir };
}
const suppression = { owner: { items: ['custom:synthetic'], achievements: [1] } };
const evidence = { schemaVersion: 1, entries: { pluginReplaySuppression: { version: 1, players: suppression } } };
const native = { format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1, revision: 1, members: [{ id: 'owner' }] } };
for (const document of [undefined, {}, { revision: 7 }, { format: 'other-checkpoint', state: { revision: 7 } },
  { ...native, state: { ...native.state, members: [] } },
  { state: { provenance: { pluginAutoHandled: { owner: { items: [], achievements: [] } } } } }]) {
  test(`the start gate leaves a checkpoint without replay decisions to its runtime (${JSON.stringify(document)})`, async t => {
    const f = await fixture(t, document), before = await inventory(f.dataDir);
    await checkStart(f);
    assert.deepEqual(await inventory(f.dataDir), before);
  });
}
test('empty legacy handled sets do not require a checkpoint', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.dataDir, 'plugin-achievements.json'), JSON.stringify({ v: 1, players: { owner: { handled: [] } } }));
  await writeFile(path.join(f.dataDir, 'plugin-items.json'), JSON.stringify({ v: 1, players: { owner: {
    baselineAt: '2026-01-01T00:00:00.000Z', items: {}, handled: [], journal: null } } }));
  const before = await inventory(f.dataDir);
  await checkStart(f);
  assert.deepEqual(await inventory(f.dataDir), before);
});
for (const source of ['inline', 'envelope', 'nested-envelope', 'static', 'legacy-items', 'legacy-achievements']) {
  test(`real ${source} replay evidence refuses an unreconcilable checkpoint without changing bytes`, async t => {
    const document = source.startsWith('legacy') ? undefined : structuredClone(native);
    if (document) document.state.members = [];
    if (source === 'inline') document.state.provenance = { pluginAutoHandled: suppression };
    if (source === 'envelope') document.optionalSidecarEvidence = evidence;
    if (source === 'nested-envelope') document.state.provenance = { optionalSidecarEvidence: evidence };
    const f = await fixture(t, document);
    if (source === 'static') {
      const bytes = JSON.stringify({ pluginAutoHandled: suppression }), digest = createHash('sha256').update(bytes).digest('hex');
      const reference = { id: `static-${digest}.json.gz`, sha256: digest };
      await mkdir(path.join(f.dataDir, 'static'));
      await writeFile(path.join(f.dataDir, 'static', reference.id), gzipSync(bytes));
      document.storage = { schemaVersion: 1, fields: { provenance: reference } };
      await writeFile(path.join(f.dataDir, 'state.json'), JSON.stringify(document));
    }
    if (source.startsWith('legacy')) {
      const items = source === 'legacy-items';
      const record = items ? { baselineAt: '2026-01-01T00:00:00.000Z', items: {}, handled: ['custom:synthetic'], journal: null } : { handled: [1] };
      await writeFile(path.join(f.dataDir, `plugin-${items ? 'items' : 'achievements'}.json`), JSON.stringify({ v: 1, players: { owner: record } }));
    }
    const before = await inventory(f.dataDir);
    await assert.rejects(checkStart(f), { code: 'PLUGIN_RECONCILIATION_FAILED' });
    assert.deepEqual(await inventory(f.dataDir), before);
  });
}

test('nested registry replay evidence is bridged before a valid frozen start', async t => {
  const document = structuredClone(native);
  document.state.provenance = { optionalSidecarEvidence: evidence };
  const f = await fixture(t, document);
  await checkStart(f);
  // A frozen controller reads only these legacy carriers.
  const { readFile } = await import('node:fs/promises');
  for (const kind of ['items', 'achievements']) {
    const sidecar = JSON.parse(await readFile(path.join(f.dataDir, `plugin-${kind}.json`), 'utf8'));
    assert.deepEqual(sidecar.players.owner.handled, suppression.owner[kind]);
  }
});
