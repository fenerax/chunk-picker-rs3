// Phase B pack assets: deterministic archives of only the pack.json-listed bytes,
// which unpack (as the workflow's fetch-packs.mjs does) to the same pack identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { buildPackAssets, tarHeader } from '../scripts/private-companion/neutral-ci.mjs';
import { packIdentity } from '../scripts/private-companion/neutral-lane.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function packsFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'neutral-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packs = path.join(root, 'packs'), selection = { schemaVersion: 1 };
  const deep = 'images/' + 'd'.repeat(60) + '/' + 'f'.repeat(70) + '.png';
  for (const [kind, id, files] of [['data', 'p-data', { 'data.json': '{"a":1}\n' }], ['rulesText', 'p-rules', { 'rules.txt': 'rules\r\n' }],
    ['art', 'p-art', { 'a.png': Buffer.from([137, 80, 78, 71, 0, 1]), [deep]: Buffer.alloc(700, 7), 'empty.bin': Buffer.alloc(0) }]]) {
    const dir = path.join(packs, id, '1.0.0'), records = [];
    for (const [name, value] of Object.entries(files)) {
      const bytes = Buffer.from(value); await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), bytes); records.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
    }
    await writeFile(path.join(dir, 'stray.tmp'), 'not listed');
    const manifest = Buffer.from(JSON.stringify({ files: records }));
    await writeFile(path.join(dir, 'pack.json'), manifest);
    selection[kind] = { id, version: '1.0.0', sha256: sha(manifest) };
  }
  await writeFile(path.join(packs, 'selection.json'), JSON.stringify(selection));
  return { root, packs };
}

test('pack assets are byte-stable, carry only listed files and unpack to the same identity', async t => {
  const { root, packs } = await packsFixture(t);
  const first = await buildPackAssets({ packs, out: path.join(root, 'out1') });
  const second = await buildPackAssets({ packs, out: path.join(root, 'out2') });
  assert.deepEqual(first, second, 'same bytes, same archives');
  assert.deepEqual(first.assets.map(asset => asset.name), ['p-data-1.0.0.tar.gz', 'p-rules-1.0.0.tar.gz', 'p-art-1.0.0.tar.gz']);
  assert.equal(first.schema, 'rs3-neutral-pack-pin-v1');
  const tree = path.join(root, 'tree'); await mkdir(tree);
  for (const asset of first.assets) {
    const file = path.join(root, 'out1', asset.name);
    assert.equal(sha(await readFile(file)), asset.sha256);
    execFileSync('tar', ['-xzf', file, '-C', tree]);
  }
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify({ schemaVersion: 1, ...first.selection }));
  assert.deepEqual(await packIdentity(tree), await packIdentity(packs));
  await assert.rejects(readFile(path.join(tree, 'p-art/1.0.0/stray.tmp')), { code: 'ENOENT' });
});

test('a changed payload or an unsafe path is refused before archiving', async t => {
  const { root, packs } = await packsFixture(t);
  await writeFile(path.join(packs, 'p-data/1.0.0/data.json'), '{"a":2}\n');
  await assert.rejects(buildPackAssets({ packs, out: path.join(root, 'out') }), /Pack payload changed/);
  assert.throws(() => tarHeader('a/' + 'x'.repeat(101), 1), /too long/);
  assert.throws(() => tarHeader('a\\b', 1), /plain ASCII/);
  assert.equal(tarHeader('p/1/' + 'y'.repeat(99), 3).subarray(345, 348).toString(), 'p/1');
});
