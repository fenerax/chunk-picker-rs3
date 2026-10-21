import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { buildDevPack } from '../scripts/private-companion/build-dev-pack.mjs';
import { exportSource } from '../scripts/private-companion/export-repo-source.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dev-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'), packs = path.join(root, 'accepted');
  await mkdir(path.join(repo, 'app'), { recursive: true }); await mkdir(path.join(repo, 'tools'));
  await writeFile(path.join(repo, 'app/main.mjs'), 'export const main = 1;\n');
  await writeFile(path.join(repo, 'tools/manage.mjs'), 'export {};\n');
  git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'fixture');
  const selection = { schemaVersion: 1 };
  for (const [kind, id, file] of [['data', 'duo-data', 'local-game/items.json'], ['rulesText', 'duo-rules-text', 'rules.json'], ['art', 'duo-art', 'resources/tile.txt']]) {
    const directory = path.join(packs, id, '1.0.0'), bytes = Buffer.from(`${id}\n`);
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await writeFile(path.join(directory, file), bytes);
    const manifest = Buffer.from(JSON.stringify({ id, version: '1.0.0', files: [{ path: file, sha256: sha(bytes), bytes: bytes.length }] }));
    await writeFile(path.join(directory, 'pack.json'), manifest);
    selection[kind] = { id, version: '1.0.0', sha256: sha(manifest) };
  }
  await writeFile(path.join(packs, 'selection.json'), JSON.stringify(selection));
  return { root, repo, packs, commit: git(repo, 'rev-parse', 'HEAD') };
}

test('development packs build from one exact commit of this repository', async t => {
  const { root, repo, packs, commit } = await fixture(t);
  // An uncommitted edit must not reach the build: the export reads Git objects only.
  await writeFile(path.join(repo, 'app/main.mjs'), 'export const main = 2;\n');
  let exported = null, main = null;
  const exportAndList = async options => {
    const result = await exportSource(options);
    exported = (await readdir(options.out, { recursive: true })).map(name => name.replaceAll('\\', '/')).sort();
    main = await readFile(path.join(options.out, 'app/main.mjs'), 'utf8');
    return result;
  };
  const outputRoot = path.join(root, 'out', 'dev');
  // The fixture repository has no builders, so the run stops after export, pack copies and materialization.
  await assert.rejects(buildDevPack({ repo, commit, acceptedPacksDir: packs, outputRoot }, { exportSource: exportAndList }), /Isolated development builders failed/);
  // Repository management paths such as tools/ stay out of the build source.
  assert.deepEqual(exported, ['app', 'app/main.mjs']);
  assert.equal(main, 'export const main = 1;\n');
  await assert.rejects(lstat(outputRoot), { code: 'ENOENT' });
  assert.deepEqual((await readdir(path.dirname(outputRoot))).filter(name => name.startsWith('.build-dev-')), []);
});

test('development packs refuse the old two-repository options and inexact commits', async t => {
  const { root, repo, packs, commit } = await fixture(t);
  const outputRoot = path.join(root, 'out', 'dev');
  await assert.rejects(buildDevPack({ coreRepo: repo, coreCommit: commit, privateRepo: repo, privateCommit: commit, acceptedPacksDir: packs, outputRoot }), /Explicit absolute repo required/);
  await assert.rejects(buildDevPack({ repo, commit: commit.slice(0, 12), acceptedPacksDir: packs, outputRoot }), /Full exact commit SHA required/);
  await assert.rejects(buildDevPack({ repo, commit, acceptedPacksDir: packs, outputRoot: path.join(root, 'packs', 'dev') }), /outside operational roots/);
});
