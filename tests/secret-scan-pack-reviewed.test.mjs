import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadPackReviewed, reviewedPackCategories } from '../scripts/secret-scan/pack-reviewed.mjs';
import { scanEntries, loadReviewed } from '../scripts/secret-scan/scan.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const name = 'duo-data/generated/reference.json';
const payload = Buffer.from(JSON.stringify({ version: [3, 4, 5, 6].join('.') }) + '\n');
const row = extra => ({ path: name, category: 'network-identifier', sha256: sha(payload), reason: 'Synthetic public reference review.', ...extra });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-reviewed-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'reviewed.json');
  return async entries => { await writeFile(file, JSON.stringify({ schemaVersion: 1, entries })); return loadPackReviewed(file); };
}

test('exceptions match exact pack path, category and payload digest', async t => {
  const load = await fixture(t), reviewed = await load([row()]);
  const before = scanEntries([{ path: name, bytes: payload }], { corpus: null });
  assert.ok(before.findings.some(finding => finding.category === 'network-identifier'));
  assert.equal(before.findings.filter(finding => !reviewedPackCategories(name, sha(payload), reviewed).has(finding.category)).length, 0);
  assert.deepEqual([...reviewedPackCategories(name, sha(payload), reviewed)], ['network-identifier']);
  assert.equal(reviewedPackCategories('duo-art/generated/reference.json', sha(payload), reviewed).size, 0);
  assert.equal(reviewedPackCategories(name + '#gzip-transport', sha(payload), reviewed).size, 0);
  assert.equal(reviewedPackCategories(name, sha(Buffer.concat([payload, Buffer.from(' ')])), reviewed).size, 0);
  const transport = await load([row({ path: name + '#gzip-transport' })]);
  assert.equal(reviewedPackCategories(name, sha(payload), transport).size, 0);
  assert.equal(reviewedPackCategories(name + '#gzip-transport', sha(payload), transport).size, 1);
});

test('an exact reviewed payload does not exempt a changed payload containing a token', async t => {
  const load = await fixture(t), reviewed = await load([row({ category: 'token' })]);
  const changed = Buffer.from(JSON.stringify({ note: 'ghp_' + 'a'.repeat(24) }));
  const exceptions = reviewedPackCategories(name, sha(changed), reviewed);
  const result = scanEntries([{ path: name, bytes: changed }], { corpus: null, reviewed: loadReviewed() });
  assert.ok(result.findings.some(finding => finding.category === 'token' && !exceptions.has(finding.category)));
});

test('private fingerprint exceptions require the exact reviewed corpus digest', async t => {
  const load = await fixture(t), corpusSha256 = sha('synthetic corpus receipt');
  const reviewed = await load([row({ category: 'private-fingerprint', corpusSha256 })]);
  assert.equal(reviewedPackCategories(name, sha(payload), reviewed).size, 0);
  assert.equal(reviewedPackCategories(name, sha(payload), reviewed, sha('changed synthetic corpus')).size, 0);
  assert.equal(reviewedPackCategories(name, sha(payload), reviewed, corpusSha256).has('private-fingerprint'), true);
});

test('malformed and broad exception rows fail closed', async t => {
  const load = await fixture(t);
  for (const change of [
    { path: '*' }, { path: 'duo-data/*' }, { path: 'duo-data/../reference.json' }, { path: '/duo-data/reference.json' },
    { path: 'duo-data/a\\reference.json' }, { path: 'duo-data/a%2freference.json' },
    { path: 'duo-data/CON.json' }, { path: 'duo-data/reference.json#other' },
    { category: '*' }, { sha256: 'a'.repeat(63) }, { reason: ' ' }, { hosts: ['example.invalid'] },
    { category: 'private-fingerprint' }, { category: 'private-fingerprint', corpusSha256: 'bad' },
    { corpusSha256: sha('unexpected corpus') }, { jsonPaths: [] }, { jsonPaths: ['$.*'] },
    { jsonPaths: ['/bad~2pointer'] }, { jsonPaths: ['/same', '/same'] },
  ]) await assert.rejects(load([row(change)]), /Invalid reviewed pack exceptions/);
  await assert.rejects(load([row(), row()]), /Invalid reviewed pack exceptions/);
  const valid = await load([row({ jsonPaths: ['/values/a~1b', '/values/a~0b'] })]);
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid[0].jsonPaths));
});
