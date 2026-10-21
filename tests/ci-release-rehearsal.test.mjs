import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { exportHead, copyPacks, writeReleaseMetadata, releaseEnvironment } from '../scripts/ci/release-rehearsal.mjs';
import { verifyExport } from '../scripts/release/pc/quick-build.mjs';
import { sanitizeExecutionEnvironment } from '../scripts/private-companion/release-identity.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const kinds = { data: 'duo-data', rulesText: 'duo-rules-text', art: 'duo-art' };

async function scratch(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-rehearsal-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('rs3-rehearsal-test-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}

async function packs(t) {
  const root = await scratch(t), source = path.join(root, 'source'), destination = path.join(root, 'copied');
  const selection = { schemaVersion: 1 }, manifests = {};
  for (const [kind, id] of Object.entries(kinds)) {
    const version = '1.2.3-ci.1', directory = path.join(source, id, version);
    const payload = Buffer.from([0, 255, 13, 10, ...Buffer.from(kind)]);
    await mkdir(path.join(directory, 'nested'), { recursive: true });
    await writeFile(path.join(directory, 'nested/payload.bin'), payload);
    manifests[kind] = { id, version, files: [{ path: 'nested/payload.bin', bytes: payload.length, sha256: sha(payload) }] };
    const bytes = encode(manifests[kind]);
    await writeFile(path.join(directory, 'pack.json'), bytes);
    selection[kind] = { id, version, sha256: sha(bytes) };
  }
  const saveSelection = () => writeFile(path.join(source, 'selection.json'), encode(selection));
  await saveSelection();
  const expectedSelection = structuredClone(selection);
  delete expectedSelection.schemaVersion;
  const manifestPath = kind => path.join(source, selection[kind].id, selection[kind].version, 'pack.json');
  const repin = async kind => {
    const bytes = encode(manifests[kind]);
    await writeFile(manifestPath(kind), bytes);
    selection[kind].sha256 = sha(bytes);
    expectedSelection[kind].sha256 = sha(bytes);
    await saveSelection();
  };
  return { root, source, destination, selection, expectedSelection, manifests, manifestPath, saveSelection, repin };
}

test('HEAD export ignores dirty tracked and untracked checkout files and verifies exact bytes', async t => {
  const root = await scratch(t), repo = path.join(root, 'repo'), core = path.join(root, 'core');
  await mkdir(path.join(repo, 'app'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false',
    '-c', 'user.name=fenerax', '-c', 'user.email=fenerax@users.noreply.github.com', ...args], {
    windowsHide: true, stdio: 'pipe', env: sanitizeExecutionEnvironment(process.env, { overrides: {
      GIT_AUTHOR_NAME: 'fenerax', GIT_AUTHOR_EMAIL: 'fenerax@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'fenerax', GIT_COMMITTER_EMAIL: 'fenerax@users.noreply.github.com',
    } }),
  });
  await writeFile(path.join(repo, 'README.md'), 'synthetic\n');
  await writeFile(path.join(repo, 'app/fixture.mjs'), 'export {};\r\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic rehearsal fixture');
  const head = git('rev-parse', 'HEAD').toString().trim();
  await writeFile(path.join(repo, 'README.md'), 'dirty checkout\n');
  await writeFile(path.join(repo, 'untracked.txt'), 'untracked fixture\n');
  const exported = await exportHead({ repo, core });
  assert.equal(exported.commit, head);
  assert.deepEqual(exported.entries.map(entry => entry.path).sort(), ['README.md', 'app/fixture.mjs']);
  assert.equal(await readFile(path.join(core, 'README.md'), 'utf8'), 'synthetic\n');
  assert.equal(await readFile(path.join(core, 'app/fixture.mjs'), 'utf8'), 'export {};\r\n');
  await assert.rejects(readFile(path.join(core, 'untracked.txt')), { code: 'ENOENT' });
  await verifyExport(core, exported.entries);
  await writeFile(path.join(core, 'README.md'), 'synthetic\r\n');
  await assert.rejects(verifyExport(core, exported.entries), /differs from its commit/);
  await writeFile(path.join(core, 'README.md'), 'synthetic\n');
  await writeFile(path.join(core, 'untracked.txt'), 'unexpected export file\n');
  await assert.rejects(verifyExport(core, exported.entries), /differs from its commit/);
  await rm(path.join(core, 'untracked.txt'));
  await rm(path.join(core, 'README.md'));
  await assert.rejects(verifyExport(core, exported.entries), /missing files/);
  await assert.rejects(exportHead({ repo, core }), { code: 'EEXIST' });
  await assert.rejects(readFile(core + '.tar'), { code: 'ENOENT' });
});

test('pack copy preserves the installed selection layout, manifest hashes and payload bytes', async t => {
  const fixture = await packs(t);
  const { source, destination, expectedSelection, selection } = fixture;
  // Selection whitespace is part of the copied input, even though pin comparison is semantic.
  await writeFile(path.join(source, 'selection.json'), JSON.stringify(selection) + '\r\n');
  const result = await copyPacks({ source, destination, expectedSelection });
  assert.deepEqual(result, { selection, files: 3 });
  assert.deepEqual((await readdir(destination)).sort(), ['duo-art', 'duo-data', 'duo-rules-text', 'selection.json']);
  assert.deepEqual(await readFile(path.join(destination, 'selection.json')), await readFile(path.join(source, 'selection.json')));
  for (const kind of Object.keys(kinds)) {
    const choice = selection[kind], relative = path.join(choice.id, choice.version);
    assert.deepEqual((await readdir(path.join(destination, choice.id))), [choice.version]);
    const bytes = await readFile(path.join(destination, relative, 'pack.json'));
    assert.equal(sha(bytes), choice.sha256);
    assert.deepEqual(bytes, await readFile(path.join(source, relative, 'pack.json')));
    assert.deepEqual(await readFile(path.join(destination, relative, 'nested/payload.bin')),
      await readFile(path.join(source, relative, 'nested/payload.bin')));
  }
  await assert.rejects(copyPacks({ source, destination, expectedSelection }), { code: 'EEXIST' });
});

const refusedPacks = [
  ['absent selection', async f => { await rm(path.join(f.source, 'selection.json')); }],
  ...Object.keys(kinds).map(kind => [`missing ${kind} kind`, async f => {
    delete f.selection[kind]; delete f.expectedSelection[kind]; await f.saveSelection();
  }]),
  ['mismatched pin', async f => { f.expectedSelection.data.sha256 = '0'.repeat(64); }],
  ['wrong kind id', async f => { f.selection.data.id = f.expectedSelection.data.id = 'other-data'; await f.saveSelection(); }],
  ['escaping version', async f => { f.selection.data.version = f.expectedSelection.data.version = '../outside'; await f.saveSelection(); }],
  ['tampered manifest bytes', async f => { await writeFile(f.manifestPath('data'), encode(f.manifests.data) + ' '); }],
  ['manifest identity mismatch', async f => { f.manifests.data.id = 'other-data'; await f.repin('data'); }],
  ['tampered payload with same size', async f => {
    const file = path.join(path.dirname(f.manifestPath('data')), 'nested/payload.bin');
    const bytes = await readFile(file); bytes[0] ^= 1; await writeFile(file, bytes);
  }],
  ['truncated payload', async f => { await writeFile(path.join(path.dirname(f.manifestPath('data')), 'nested/payload.bin'), ''); }],
  ['missing payload', async f => { await rm(path.join(path.dirname(f.manifestPath('data')), 'nested/payload.bin')); }],
  ['unlisted directory link', async f => {
    const target = path.join(f.root, 'synthetic-link-target');
    await mkdir(target);
    await symlink(target, path.join(path.dirname(f.manifestPath('data')), 'unlisted-link'), 'junction');
  }],
  ...['../outside.bin', '/outside.bin', 'nested\\outside.bin', 'C:/outside.bin'].map(escape => [
    `escaping manifest path ${escape}`, async f => {
      f.manifests.data.files[0].path = escape; await f.repin('data');
    },
  ]),
];

for (const [name, corrupt] of refusedPacks) test(`pack copy refuses ${name} before creating output`, async t => {
  const fixture = await packs(t);
  await corrupt(fixture);
  await assert.rejects(copyPacks(fixture));
  await assert.rejects(readdir(fixture.destination), { code: 'ENOENT' });
});

test('release metadata pins the isolated live config, pointer and companion receipt', async t => {
  const fixture = await packs(t), releaseDir = path.join(fixture.root, 'release');
  await mkdir(releaseDir);
  await copyPacks({ ...fixture, destination: path.join(releaseDir, 'packs') });
  await mkdir(path.join(releaseDir, 'addons'));
  await writeFile(path.join(releaseDir, 'profile.json'), encode({ schemaVersion: 1, synthetic: true }));
  await writeFile(path.join(releaseDir, 'addons/addon.json'), encode({ schemaVersion: 1, synthetic: true }));
  const [port, loopbackPort] = [8901, 8902];
  const config = await writeReleaseMetadata({ releaseDir, selection: fixture.selection, port, loopbackPort });
  assert.deepEqual(await json(path.join(releaseDir, 'config.json')), config);
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.coreRoot, path.join(releaseDir, 'core'));
  assert.equal(config.packsDir, path.join(releaseDir, 'packs'));
  assert.equal(config.dataDir, path.join(releaseDir, 'runtime/data'));
  assert.equal(config.publicOriginFile, path.join(releaseDir, 'runtime/public-origin'));
  assert.equal(config.nodePath, process.execPath);
  assert.equal(config.host, '127.0.0.1');
  assert.deepEqual([config.port, config.loopbackPort], [8901, 8902]);
  assert.deepEqual(config.runtimeOptions, { taskWorkerMode: 'process', workerIdleMs: 20000, backupDays: 7, historyEntries: 500 });
  assert.equal(await readFile(config.publicOriginFile, 'utf8'), 'https://synthetic-rehearsal.invalid\n');
  const pointer = await json(path.join(releaseDir, 'pointer.json'));
  assert.equal(pointer.schemaVersion, 2);
  assert.equal(pointer.releaseId, 'ci-rehearsal');
  assert.equal(pointer.config.path, path.join(releaseDir, 'config.json'));
  assert.equal(config.selection.path, path.join(releaseDir, 'packs/selection.json'));
  assert.equal(config.profile.path, path.join(releaseDir, 'profile.json'));
  assert.equal(config.addons.path, path.join(releaseDir, 'addons/addon.json'));
  for (const kind of Object.keys(kinds)) {
    const choice = fixture.selection[kind];
    assert.equal(config.packs[kind].path, path.join(releaseDir, 'packs', choice.id, choice.version, 'pack.json'));
    assert.equal(config.packs[kind].sha256, choice.sha256);
  }
  for (const pin of [pointer.config, config.selection, config.profile, config.addons, ...Object.values(config.packs)]) {
    const relative = path.relative(releaseDir, pin.path);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(pin.sha256, sha(await readFile(pin.path)));
  }
  assert.deepEqual(await json(path.join(releaseDir, 'companion.json')), {
    schemaVersion: 1, coreRoot: config.coreRoot, packsDir: config.packsDir,
    packs: fixture.selection, profile: config.profile, addons: config.addons,
  });
});

for (const [port, loopbackPort] of [[8899, 8901], [8901, 9000], [8901, 8901], ['8901', 8902],
  [8901, 8902.5], [NaN, 8902], [8901, undefined]]) {
  test(`release metadata refuses invalid scratch ports ${String(port)}/${String(loopbackPort)}`, async t => {
    const root = await scratch(t), releaseDir = path.join(root, 'release');
    await mkdir(releaseDir);
    await assert.rejects(writeReleaseMetadata({ releaseDir, selection: {}, port, loopbackPort }), /Two distinct scratch ports required/);
    assert.deepEqual(await readdir(releaseDir), []);
  });
}

test('release environment removes inherited application settings and retains isolated overrides', () => {
  const injected = {
    RS3_DATASET: 'inherited-dataset', RS3_PACKS_DIR: 'inherited-packs', RS3_PACK_SELECTION: 'inherited-selection',
    RS3_GAME_DEFAULTS_FILE: 'inherited-defaults', RS3_DATA_DIR: 'inherited-save', RS3_UNKNOWN_SETTING: 'inherited-setting',
    RS3_DATASET_PROFILE: 'inherited-profile', RS3_PRIVATE_ADDON: 'inherited-addon',
    RS3_GAME_DATA_DIR: 'inherited-game', RS3_MAP_ASSETS_DIR: 'inherited-map',
    NODE_OPTIONS: '--require=synthetic-inherited-module',
  };
  const previous = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
  const root = path.resolve(os.tmpdir(), 'synthetic-rehearsal-environment');
  const [port, loopbackPort] = [8903, 8904];
  const config = {
    packsDir: path.join(root, 'packs'), selection: { path: path.join(root, 'packs/selection.json') },
    profile: { path: path.join(root, 'profile.json'), sha256: 'a'.repeat(64) },
    addons: { path: path.join(root, 'addons/addon.json'), sha256: 'b'.repeat(64) },
    dataDir: path.join(root, 'runtime/data'), port, loopbackPort,
    runtimeOptions: { taskWorkerMode: 'process', workerIdleMs: 20000 },
  };
  try {
    Object.assign(process.env, injected);
    const env = releaseEnvironment(config);
    const overrides = {
      RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir, RS3_PACK_SELECTION: config.selection.path,
      RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256,
      RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256,
      RS3_TASK_WORKER_MODE: 'process', RS3_WORKER_IDLE_MS: '20000',
      RS3_GAME_DATA_DIR: path.join(root, 'runtime/game-data'), RS3_MAP_ASSETS_DIR: path.join(root, 'runtime/map-assets'),
      RS3_PUBLIC_ORIGIN: 'https://synthetic-rehearsal.invalid', RS3_LOOPBACK_PORT: '8904',
    };
    assert.deepEqual(Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase().startsWith('RS3_'))), overrides);
    assert.equal(env.NODE_OPTIONS, undefined);
    for (const [key, value] of Object.entries(injected)) assert.equal(process.env[key], value);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

for (const valid of [true, false]) {
  test(valid ? 'runtime seed binds its packed dataset and closes the synthetic app'
    : 'runtime seed closes the synthetic app when dataset binding refuses its descriptor', async t => {
    const root = await scratch(t), coreRoot = path.join(root, 'core'), dataDir = path.join(root, 'runtime/data');
    await mkdir(path.join(coreRoot, 'app'), { recursive: true });
    const descriptor = {
      datasetId: 'synthetic-ci-dataset', datasetContractVersion: 1,
      digest: valid ? 'c'.repeat(64) : 'invalid-digest', packed: true,
    };
    // The server double never opens a listener. Use the real binding module so
    // omitting the runtime's explicit bind cannot accidentally satisfy this test.
    await writeFile(path.join(coreRoot, 'app/server.mjs'), `
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function createServer(options) {
  await mkdir(options.dataDir, { recursive: true });
  await writeFile(path.join(options.dataDir, 'state.json'), JSON.stringify({ synthetic: true }));
  await writeFile(path.join(options.dataDir, 'seed-options.json'), JSON.stringify({
    definitions: options.definitions, taskMap: options.taskMap,
    predictionPrewarm: options.predictionPrewarm,
  }));
  return { dataset: ${JSON.stringify(descriptor)},
    close: () => writeFile(path.join(options.dataDir, 'closed'), 'closed\\n') };
}
`);
    await writeFile(path.join(coreRoot, 'app/dataset-binding.mjs'),
      `export { bindDatasetStorage } from ${JSON.stringify(new URL('../app/dataset-binding.mjs', import.meta.url).href)};\n`);
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, encode({ coreRoot, dataDir }));
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('../scripts/ci/release-rehearsal-runtime.mjs', import.meta.url)), 'seed', configPath,
    ], { cwd: root, env: sanitizeExecutionEnvironment(), windowsHide: true, timeout: 15000, stdio: 'ignore' });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, valid ? 0 : 1);
    assert.equal(await readFile(path.join(dataDir, 'closed'), 'utf8'), 'closed\n');
    assert.deepEqual(await json(path.join(dataDir, 'state.json')), { synthetic: true });
    const options = await json(path.join(dataDir, 'seed-options.json'));
    assert.deepEqual(options.definitions, {
      chunks: { 12341: {}, 12342: {} }, challenges: {},
      walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
    });
    assert.deepEqual(options.taskMap, {});
    assert.equal(options.predictionPrewarm, false);
    if (valid) {
      assert.deepEqual(await json(dataDir + '.dataset.json'), {
        schemaVersion: 1, datasetId: descriptor.datasetId,
        datasetContractVersion: descriptor.datasetContractVersion, digest: descriptor.digest, requiresPack: true,
      });
    } else {
      await assert.rejects(readFile(dataDir + '.dataset.json'), { code: 'ENOENT' });
    }
  });
}
