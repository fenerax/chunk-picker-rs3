import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, cp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coreOverlaySha256 } from '../scripts/private-companion/core-overlay-guard.mjs';

const source = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const scratch = path.resolve(process.env.RS3_DRIFT_TEST_ROOT ?? fileURLToPath(new URL('../.local/companion-tests/', import.meta.url)));
async function fixture(t) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'companion-'));
  t.after(async () => { assert.equal(path.dirname(root), scratch); await rm(root, { recursive: true, force: true }); });
  const core = path.join(root, 'core'), companion = path.join(root, 'companion'), privateRoot = path.join(companion, 'checks/private-source');
  for (const name of [path.join(core, 'tests'), path.join(privateRoot, 'tests'), path.join(companion, 'tools')]) await mkdir(name, { recursive: true });
  for (const name of ['companion-check.mjs', 'core-overlay-guard.mjs']) await cp(path.join(source, name), path.join(companion, 'tools', name));
  await writeFile(path.join(companion, 'companion.json'), '{}');
  const bytes = Buffer.from('// Synthetic identical test; no application import.\n');
  for (const directory of [core, privateRoot]) await writeFile(path.join(directory, 'tests/shared.test.mjs'), bytes);
  const manifest = path.join(privateRoot, 'tests/core-overlays.json');
  const output = path.join(companion, '.local/prepared');
  const run = () => spawnSync(process.execPath, [path.join(companion, 'tools/companion-check.mjs'), '--core', core, '--lane', 'prepare-text', '--output', output], { windowsHide: true, encoding: 'utf8' });
  return { core, privateRoot, manifest, output, run, bytes };
}

test('actual assembly refuses identical unreviewed overlays before write and accepts explicit review', async t => {
  const f = await fixture(t);
  const refused = f.run();
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /without review/);
  await assert.rejects(access(f.output), { code: 'ENOENT' });
  await writeFile(f.manifest, JSON.stringify({ schemaVersion: 1, files: { 'tests/shared.test.mjs': { coreSha256: coreOverlaySha256(f.bytes) } } }));
  const accepted = f.run(); assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(await readFile(path.join(f.output, 'tests/shared.test.mjs')), f.bytes);
});

test('actual assembly still refuses a stale review and cleans its failed prepared output', async t => {
  const f = await fixture(t);
  await writeFile(f.manifest, JSON.stringify({ schemaVersion: 1, files: { 'tests/shared.test.mjs': { coreSha256: '0'.repeat(64) } } }));
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /changed since its private replacement was reviewed/);
  await assert.rejects(access(f.output), { code: 'ENOENT' });
});

test('automatic core classification replaces a retained private selector without mirrored edits', async t => {
  const f = await fixture(t);
  await writeFile(f.manifest, JSON.stringify({ schemaVersion: 1, files: { 'tests/shared.test.mjs': { coreSha256: coreOverlaySha256(f.bytes) } } }));
  await mkdir(path.join(f.core, 'scripts'));
  await mkdir(path.join(f.privateRoot, 'scripts'));
  await writeFile(path.join(f.core, 'scripts/test-classification.mjs'), '// Synthetic automatic-classifier marker.\n');
  const selector = '// Shared automatic selector, retained in the assembly.\n';
  await writeFile(path.join(f.core, 'scripts/test-selection.mjs'), selector);
  await writeFile(path.join(f.privateRoot, 'scripts/test-selection.mjs'), 'throw new Error("obsolete mirrored registry");\n');
  await writeFile(path.join(f.privateRoot, 'tests/new.private.test.mjs'), '// Untagged private scenario.\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(f.output, 'scripts/test-selection.mjs'), 'utf8'), selector);
  assert.equal(await readFile(path.join(f.output, 'tests/new.private.test.mjs'), 'utf8'), '// Untagged private scenario.\n');
});
