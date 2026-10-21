import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stageLegacyRollback } from '../scripts/private-companion/release-legacy-rollback.mjs';
import { captureInputIdentity, hashTree } from '../scripts/private-companion/release-identity.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'legacy-rollback-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const kit = path.join(root, 'kit'), repo = path.join(root, 'accepted-core'), addonRoot = path.join(root, 'accepted-addons');
  for (const directory of [path.join(repo, 'app'), path.join(addonRoot, 'app/data'), path.join(addonRoot, 'server'), path.join(kit, 'checks/private-source'), path.join(kit, 'packs')]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(repo, 'app/server.mjs'), '// Synthetic accepted source. Never executed.\n');
  await writeFile(path.join(repo, '.gitignore'), '.local/\n');
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repo, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet'); git('add', '.'); git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Synthetic accepted source');
  const revision = git('rev-parse', 'HEAD').toString().trim();
  await mkdir(path.join(repo, '.local')); await writeFile(path.join(repo, '.local/state.json'), '{"synthetic":true}');
  const payloads = new Map([['server/integration.mjs', Buffer.from('// accepted integration\n')], ['app/data/changelog.json', Buffer.from('[{"text":"Accepted changelog"}]\n')], ['app/data/roadmap.json', Buffer.from('[{"text":"Accepted roadmap"}]\n')]]);
  for (const [name, bytes] of payloads) await writeFile(path.join(addonRoot, name), bytes);
  const addonFile = path.join(addonRoot, 'addon.json');
  await writeFile(addonFile, JSON.stringify({ schemaVersion: 1, files: [...payloads].map(([name, bytes]) => ({ path: name, sha256: sha(bytes) })), features: { projectUpdates: true } }));
  const profileFile = path.join(root, 'accepted-profile.json'); await writeFile(profileFile, '{"syntheticProfile":true}\n');
  const privateBytes = Buffer.from('synthetic private source\n'); await writeFile(path.join(kit, 'checks/private-source/input.txt'), privateBytes);
  const privateFiles = [{ path: 'input.txt', sha256: sha(privateBytes) }];
  const packs = { schemaVersion: 1 }, configPacks = {};
  for (const kind of ['data', 'rulesText', 'art']) {
    const file = path.join(kit, 'packs', kind + '.json'), bytes = Buffer.from(JSON.stringify({ kind })); await writeFile(file, bytes);
    packs[kind] = { id: kind, version: '1.0.0', sha256: sha(bytes) }; configPacks[kind] = { path: file, sha256: sha(bytes) };
  }
  const selectionBytes = Buffer.from(JSON.stringify(packs)); await writeFile(path.join(kit, 'packs/selection.json'), selectionBytes);
  const previousConfigPath = path.join(root, 'running-config.json');
  const config = { schemaVersion: 1, coreRoot: repo, nodePath: process.execPath, dataDir: path.join(root, 'synthetic-unused-store'),
    host: '127.0.0.1', port: 0, loopbackPort: null, publicOriginFile: path.join(root, 'synthetic-unused-origin'), packsDir: path.join(kit, 'packs'),
    selection: { path: path.join(kit, 'packs/selection.json'), sha256: sha(selectionBytes) }, packs: configPacks,
    profile: { path: profileFile, sha256: sha(await readFile(profileFile)) }, addons: { path: addonFile, sha256: sha(await readFile(addonFile)) },
    runtimeOptions: { taskWorkerMode: 'process', workerIdleMs: null, backupDays: null, historyEntries: null } };
  await writeFile(previousConfigPath, JSON.stringify(config));
  const exportCore = async (sourceGit, commit, output) => {
    for (const name of sourceGit('ls-tree', '-r', '--name-only', '-z', commit).toString().split('\0').filter(Boolean)) {
      const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, sourceGit('show', `${commit}:${name}`), { flag: 'wx' });
    }
  };
  const captureIdentity = async (_kit, release) => captureInputIdentity({ components: [
    ...['core', 'addons', 'text'].map(name => ({ name, root: path.join(release, name) })),
    ...['profile', 'companion', 'config', 'pointer', 'request', 'release-plan'].map(name => ({ name, file: path.join(release, name + '.json') })),
  ] });
  return { root, kit, repo, revision, previousConfigPath, privateFiles, packs, exportCore, captureIdentity, git, config, addonRoot, payloads };
}

test('legacy rollback adopts exact accepted code/pins into an independent root without inventing gate receipts', async t => {
  const f = await fixture(t), beforeConfig = await readFile(f.previousConfigPath), beforeAddon = await hashTree(f.addonRoot);
  const beforeCore = await hashTree(f.repo, { excludePaths: ['.git'] });
  const root = await stageLegacyRollback(f), manifest = await json(path.join(root, 'release.json'));
  assert.equal(path.basename(root), 'legacy-rel1-' + f.revision.slice(0, 7));
  assert.equal(manifest.lane, 'adopted'); assert.equal(manifest.previousRelease, null);
  assert.deepEqual(manifest.migration, { runningConfig: { path: f.previousConfigPath, sha256: sha(beforeConfig) }, coreRevision: f.revision });
  assert.equal(manifest.identity.digest, (await f.captureIdentity(f.kit, root)).digest);
  const marker = await json(path.join(root, 'release-gate/adopted.json'));
  assert.equal(marker.inputDigest, manifest.identity.digest); assert.deepEqual(marker.migration, manifest.migration);
  assert.deepEqual(await readdir(path.join(root, 'release-gate')), ['adopted.json']);
  const plan = await json(path.join(root, 'release-plan.json'));
  for (const key of Object.keys(plan)) assert.deepEqual(manifest[key], plan[key]);
  const config = await json(path.join(root, 'config.json'));
  assert.deepEqual({ ...config, coreRoot: f.config.coreRoot, profile: f.config.profile, addons: f.config.addons }, f.config);
  assert.notEqual(config.coreRoot, f.config.coreRoot);
  assert.deepEqual(await readFile(path.join(root, 'core/app/server.mjs')), f.git('show', `${f.revision}:app/server.mjs`));
  assert.deepEqual(await readFile(config.profile.path), await readFile(f.config.profile.path));
  assert.deepEqual(await readFile(config.addons.path), await readFile(f.config.addons.path));
  for (const [name, bytes] of f.payloads) assert.deepEqual(await readFile(path.join(root, 'addons', name)), bytes);
  const receipt = await json(path.join(root, 'companion.json'));
  assert.deepEqual(receipt.privateFiles, f.privateFiles); assert.deepEqual(receipt.packs, f.packs);
  for (const override of receipt.textOverrides) assert.equal(override.sha256, sha(await readFile(override.source)));
  const pointer = await json(path.join(root, 'pointer.json'));
  assert.equal(pointer.config.sha256, sha(await readFile(pointer.config.path)));
  assert.deepEqual(await readFile(f.previousConfigPath), beforeConfig);
  assert.equal((await hashTree(f.addonRoot)).digest, beforeAddon.digest);
  assert.equal((await hashTree(f.repo, { excludePaths: ['.git'] })).digest, beforeCore.digest);
  await assert.rejects(stageLegacyRollback(f), /exist/i);
});

test('legacy adoption refuses dirty/advanced/untracked source and changed or extra addon/profile inputs', async t => {
  for (const mode of ['dirty', 'staged', 'advanced', 'untracked', 'ignored-source', 'addon-extra', 'addon-tamper', 'profile-tamper', 'pack-change', 'private-source-change']) {
    const f = await fixture(t);
    if (mode === 'dirty' || mode === 'staged' || mode === 'advanced') {
      await writeFile(path.join(f.repo, 'app/server.mjs'), '// changed\n');
      if (mode !== 'dirty') f.git('add', '.');
      if (mode === 'advanced') f.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Advanced source');
    }
    if (mode === 'untracked') await writeFile(path.join(f.repo, 'app/untracked.mjs'), '// unsafe untracked source\n');
    if (mode === 'ignored-source') { await writeFile(path.join(f.repo, '.git/info/exclude'), 'ignored.mjs\n'); await writeFile(path.join(f.repo, 'ignored.mjs'), '// unsafe ignored source\n'); }
    if (mode === 'addon-extra') await writeFile(path.join(f.addonRoot, 'server/extra.mjs'), '// extra\n');
    if (mode === 'addon-tamper') await writeFile(path.join(f.addonRoot, 'server/integration.mjs'), '// tampered\n');
    if (mode === 'profile-tamper') await writeFile(f.config.profile.path, '{}');
    if (mode === 'pack-change') f.packs.data.sha256 = 'f'.repeat(64);
    if (mode === 'private-source-change') await writeFile(path.join(f.kit, 'checks/private-source/input.txt'), 'changed private source');
    await assert.rejects(stageLegacyRollback(f));
    await assert.rejects(lstat(path.join(f.kit, 'releases', 'legacy-rel1-' + f.revision.slice(0, 7))), { code: 'ENOENT' });
  }
});

test('legacy adoption rejects linked payload trees and rechecks inputs after export before adoption marker', async t => {
  const linked = await fixture(t), outside = path.join(linked.root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(linked.addonRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageLegacyRollback(linked), /link/i);
  const f = await fixture(t), exporter = f.exportCore;
  f.exportCore = async (...args) => { await exporter(...args); await writeFile(f.config.profile.path, 'changed during export'); };
  await assert.rejects(stageLegacyRollback(f), /chang/i);
  const root = path.join(f.kit, 'releases', 'legacy-rel1-' + f.revision.slice(0, 7));
  await assert.rejects(lstat(path.join(root, 'release-gate/adopted.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(root, 'release.json')), { code: 'ENOENT' });
});
