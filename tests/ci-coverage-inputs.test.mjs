import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildCoverageInputs, prepareCoverageInputs, githubEnvironment } from '../scripts/ci/coverage-inputs.mjs';
import { placePacks } from '../.github/packs/fetch-packs.mjs';
import { pageFilename } from '../scripts/fetch-open-f2p-wiki.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, { cacheInputs = false } = {}) {
  const parent = path.resolve('.local/gh-coverage/input-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), tree = path.join(root, 'packs');
  const put = (filename, bytes) => { mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, bytes); };
  put(path.join(checkout, 'tests/browser-screen-harness.mjs'), 'export const harness = true;');
  const selection = { schemaVersion: 1 };
  function pack(kind, id, files, roots) {
    const version = kind === 'cacheInputs' ? '2026-10-21-v1' : kind === 'rulesText' ? '1.0.0' : '1.0.0-public.1', base = path.join(tree, id, version);
    const records = Object.entries(files).map(([name, bytes]) => {
      put(path.join(base, name), bytes);
      return { path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) };
    });
    const manifest = JSON.stringify({ schemaVersion: 1, id, version, files: records, ...(roots ? { roots } : {}) });
    put(path.join(base, 'pack.json'), manifest);
    selection[kind] = { id, version, sha256: sha(manifest) };
  }
  pack('data', 'duo-data', { 'local-game/catalogue.json': '{}',
    'local-game/skill-guides-2026-10-08-v1/skill-guides.v1.json': '{}' });
  pack('rulesText', 'duo-rules-text', { 'rules.md': 'public rules' });
  pack('art', 'duo-art', { 'map-assets/icons-skills.2026-10-08.v1/manifest.json': '{}',
    'map-assets/icons-skills.2026-10-08.v1/attack.png': 'synthetic icon' }, { iconAssets: 'map-assets' });
  if (cacheInputs) pack('cacheInputs', 'cache-inputs', {
    'local-game/skill-guides-2026-10-08-v1/skill-guides.v1.json': '{}',
    'local-game/skill-guides-2026-10-08-v1/skill-guides-manifest.v1.json': '{}',
    'local-game/walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz': 'synthetic compressed masks',
    'local-game/walkability-masks.cache-audit-2026-10-07-v4/manifest.v1.json': '{}',
    'local-game/walkability-masks.cache-audit-2026-10-07-v4/membership.v1.json': '{}',
    'local-game/objects-2026-10-08-v3/objects.manifest.v1.json': '{}',
    'local-game/objects-2026-10-08-v3/objects.definitions.v1.json.gz': 'synthetic definitions',
    'local-game/objects-2026-10-08-v3/objects.layouts.v1.json.gz': 'synthetic layouts',
    'local-game/objects-2026-10-08-v3/objects.placements.v1.json.gz': 'synthetic placements',
    'local-game/objects-2026-10-08-v3/objects.retained-comparison.v1.json.gz': 'synthetic comparison',
  });
  const saveSelection = () => put(path.join(tree, 'selection.json'), JSON.stringify(selection));
  saveSelection(); placePacks({ checkout, tree });
  return { root, checkout, tree, selection, saveSelection, put };
}

function pinCacheInputs(f) {
  f.put(path.join(f.checkout, '.github/packs/pack-pin.json'), JSON.stringify({
    schema: 'rs3-ci-pack-pin-v1', tag: 'fixture-cache-inputs',
    selection: { cacheInputs: f.selection.cacheInputs },
    assets: [{ name: 'fixture-cache-inputs.tar.gz', bytes: 1, sha256: 'a'.repeat(64) }],
  }));
}

test('coverage inputs use selected public versions, placed game/map roots and the selected art component', t => {
  const f = fixture(t), { env, missing } = buildCoverageInputs(f);
  assert.deepEqual(missing, ['public cacheInputs pack is absent']);
  assert.equal(env.RS3_GAME_DATA_DIR, path.join(f.checkout, '.local/game-data'));
  assert.equal(env.RS3_MAP_ASSETS_DIR, path.join(f.checkout, '.local/map-assets'));
  assert.equal(env.RS3_PUBLIC_BROWSER_SCREEN_HARNESS, undefined);
  assert.equal(env.RS3_PUBLIC_SCRUB_PACKS_DIR, f.tree);
  assert.equal(env.RS3_PUBLIC_SCRUB_DATA_VERSION, f.selection.data.version);
  assert.equal(env.RS3_PUBLIC_SCRUB_RULES_VERSION, f.selection.rulesText.version);
  assert.equal(env.RS3_PUBLIC_SCRUB_ART_VERSION, f.selection.art.version);
  assert.equal(env.SKILL_ICON_ASSET_ROOT, path.join(f.tree, 'duo-art', f.selection.art.version, 'map-assets/icons-skills.2026-10-08.v1'));
  assert.equal(env.RS3_SKILL_GUIDES_EXPORT, path.join(f.tree, 'duo-data', f.selection.data.version, 'local-game/skill-guides-2026-10-08-v1'));
});

test('selected cache inputs configure direct guides and resource roots while retaining placed duo game data', t => {
  const f = fixture(t, { cacheInputs: true }), { env, missing } = buildCoverageInputs(f);
  const root = path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version, 'local-game');
  assert.deepEqual(missing, []);
  assert.equal(env.RS3_RESOURCE_GAME_DATA_DIR, root);
  assert.equal(env.RS3_SKILL_GUIDES_EXPORT, path.join(root, 'skill-guides-2026-10-08-v1'));
  assert.equal(env.RS3_GAME_DATA_DIR, path.join(f.checkout, '.local/game-data'));
});

test('a checkout cache-input pin requires the matching verified selected pack', t => {
  const f = fixture(t, { cacheInputs: true }); pinCacheInputs(f);
  const { env, missing } = buildCoverageInputs(f);
  assert.deepEqual(missing, []);
  assert.equal(env.RS3_RESOURCE_GAME_DATA_DIR, path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version, 'local-game'));
});

test('pinned cache inputs fail when the entire selection or its cache choice is absent', async t => {
  await t.test('absent selection', t => {
    const f = fixture(t, { cacheInputs: true }); pinCacheInputs(f);
    rmSync(path.join(f.tree, 'selection.json'));
    assert.throws(() => buildCoverageInputs(f), /pinned cacheInputs selection is absent/);
  });
  await t.test('omitted cache choice', t => {
    const f = fixture(t, { cacheInputs: true }); pinCacheInputs(f);
    delete f.selection.cacheInputs; f.saveSelection();
    assert.throws(() => buildCoverageInputs(f), /selection differs from checkout pin/);
  });
});

test('pinned cache inputs reject changed identity, version and digest before loading another pack', async t => {
  for (const [field, value] of [['id', 'unexpected'], ['version', 'unexpected'], ['sha256', '0'.repeat(64)]]) {
    await t.test(field, t => {
      const f = fixture(t, { cacheInputs: true }); pinCacheInputs(f);
      f.selection.cacheInputs[field] = value; f.saveSelection();
      assert.throws(() => buildCoverageInputs(f), /selection differs from checkout pin/);
    });
  }
});

test('an empty checkout pin preserves optional selection absence', t => {
  const f = fixture(t);
  f.put(path.join(f.checkout, '.github/packs/pack-pin.json'), JSON.stringify({
    schema: 'rs3-ci-pack-pin-v1', tag: null, selection: null, assets: [],
  }));
  rmSync(path.join(f.tree, 'selection.json'));
  const { env, missing } = buildCoverageInputs(f);
  assert.deepEqual(env, {});
  assert.ok(missing.some(reason => reason.includes('selection is absent')));
});

test('cache inputs work independently of the duo data, rules and art packs', t => {
  const f = fixture(t, { cacheInputs: true });
  delete f.selection.data; delete f.selection.rulesText; delete f.selection.art; f.saveSelection();
  const { env, missing } = buildCoverageInputs(f);
  const root = path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version, 'local-game');
  assert.equal(env.RS3_RESOURCE_GAME_DATA_DIR, root);
  assert.equal(env.RS3_SKILL_GUIDES_EXPORT, path.join(root, 'skill-guides-2026-10-08-v1'));
  assert.equal(env.RS3_GAME_DATA_DIR, undefined);
  assert.deepEqual(missing, ['public data pack is absent', 'public rulesText pack is absent', 'public art pack is absent']);
});

test('coverage accepts portable bracketed pack paths and rejects unsafe file records', t => {
  const f = fixture(t, { cacheInputs: true });
  const base = path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version);
  const manifestPath = path.join(base, 'pack.json'), manifest = JSON.parse(readFileSync(manifestPath));
  const update = files => {
    const bytes = JSON.stringify({ ...manifest, files });
    f.put(manifestPath, bytes); f.selection.cacheInputs.sha256 = sha(bytes); f.saveSelection();
  };
  const extra = { path: 'local-game/objects[reviewed]/extra.json', bytes: 2, sha256: sha('{}') };
  f.put(path.join(base, extra.path), '{}');
  update([...manifest.files, extra]);
  assert.ok(buildCoverageInputs(f).env.RS3_RESOURCE_GAME_DATA_DIR);
  for (const name of ['../escape.json', '/absolute.json', 'local-game/back\\\\slash.json', 'local-game/encoded%2f.json', 'local-game/CON.json', 'local-game/trailing.']) {
    update([...manifest.files, { ...extra, path: name }]);
    assert.throws(() => buildCoverageInputs(f), /file record is invalid/);
  }
  for (const record of [null, { ...extra, bytes: -1 }, { ...extra, bytes: 1.5 }, { ...extra, sha256: 'invalid' }, manifest.files[0]]) {
    update([...manifest.files, record]);
    assert.throws(() => buildCoverageInputs(f), /file record is invalid/);
  }
});

test('selected cache inputs reject omitted records, missing payloads, malformed manifests and changed hashes', t => {
  const f = fixture(t, { cacheInputs: true });
  const base = path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version);
  const manifestPath = path.join(base, 'pack.json'), original = readFileSync(manifestPath);
  const update = manifest => {
    const bytes = JSON.stringify(manifest);
    f.put(manifestPath, bytes); f.selection.cacheInputs.sha256 = sha(bytes); f.saveSelection();
  };
  const manifest = JSON.parse(original);
  for (let index = 0; index < manifest.files.length; index++) {
    update({ ...manifest, files: manifest.files.filter((_, candidate) => candidate !== index) });
    assert.throws(() => buildCoverageInputs(f), /missing a required file record/);
  }
  update(null);
  assert.throws(() => buildCoverageInputs(f), /cacheInputs manifest is invalid/);
  update({ ...manifest, schemaVersion: 2 });
  assert.throws(() => buildCoverageInputs(f), /cacheInputs manifest is invalid/);
  update({ ...manifest, id: 'unexpected' });
  assert.throws(() => buildCoverageInputs(f), /cacheInputs manifest is invalid/);
  update({ ...manifest, version: 'unexpected' });
  assert.throws(() => buildCoverageInputs(f), /cacheInputs manifest is invalid/);
  update(manifest); f.selection.cacheInputs.sha256 = '0'.repeat(64); f.saveSelection();
  assert.throws(() => buildCoverageInputs(f), /cacheInputs manifest hash mismatch/);
  update(manifest);
  const payload = path.join(base, manifest.files[0].path);
  f.put(payload, 'changed');
  assert.throws(() => buildCoverageInputs(f), /cacheInputs payload mismatch/);
  rmSync(payload);
  assert.throws(() => buildCoverageInputs(f), /ENOENT/);
  f.selection.cacheInputs = null; f.saveSelection();
  assert.throws(() => buildCoverageInputs(f), /selection is invalid/);
});

test('resource builder normalizes its selected root and rejects lexical and linked escapes', t => {
  const f = fixture(t), source = path.join(f.root, 'source'), outside = path.join(f.root, 'outside');
  mkdirSync(source); mkdirSync(outside);
  f.put(path.join(outside, 'walkability.v1.json.gz'), 'outside authorized root');
  symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import {resourceMaskDefaults, loadResourceMasks} from './scripts/build-resource-catalogue.mjs';
    const root = path.resolve(process.env.RS3_RESOURCE_GAME_DATA_DIR);
    assert.equal(resourceMaskDefaults.path, root.replaceAll('\\\\', '/') + '/walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz');
    assert.throws(() => loadResourceMasks({path:path.join(root, '../outside/walkability.v1.json.gz')}), /authorized/);
    assert.throws(() => loadResourceMasks({path:path.join(root, 'linked/walkability.v1.json.gz')}), /authorized/);
    assert.throws(() => loadResourceMasks({}), /ENOENT/);
  `], { encoding: 'utf8', env: { ...process.env, RS3_RESOURCE_GAME_DATA_DIR: path.join(source, 'unused', '..'), RS3_GAME_DATA_DIR: outside } });
  assert.equal(result.status, 0, result.stderr);
});

test('absent inputs report reasons without consulting inherited pack or game settings', t => {
  const f = fixture(t);
  const { env, missing } = buildCoverageInputs({ checkout: f.checkout, tree: path.join(f.root, 'absent') });
  assert.deepEqual(Object.keys(env), []);
  assert.ok(missing.some(reason => reason.includes('selection is absent')));
  delete f.selection.data; delete f.selection.art; f.saveSelection();
  const partial = buildCoverageInputs(f);
  assert.ok(partial.missing.includes('public data pack is absent'));
  assert.ok(partial.missing.includes('public art pack is absent'));
});

test('supplied malformed selections, changed manifests and changed payloads fail rather than skipping', t => {
  const f = fixture(t), original = structuredClone(f.selection);
  f.selection.data.version = '../escape'; f.saveSelection();
  assert.throws(() => buildCoverageInputs(f), /selection is invalid/);
  Object.assign(f.selection, structuredClone(original)); f.selection.data.sha256 = '0'.repeat(64); f.saveSelection();
  assert.throws(() => buildCoverageInputs(f), /manifest hash mismatch/);
  Object.assign(f.selection, structuredClone(original)); f.saveSelection();
  f.put(path.join(f.tree, 'duo-data', f.selection.data.version, 'local-game/catalogue.json'), 'changed');
  assert.throws(() => buildCoverageInputs(f), /payload mismatch/);
});

test('CLI appends GitHub environment entries without exposing input paths in its log', t => {
  const f = fixture(t, { cacheInputs: true }), output = path.join(f.root, 'github-env');
  const result = spawnSync(process.execPath, ['scripts/ci/coverage-inputs.mjs', f.checkout, f.tree], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ENV: output }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), githubEnvironment(buildCoverageInputs(f).env));
  assert.ok(result.stdout.includes('SKILL_ICON_ASSET_ROOT'));
  assert.ok(result.stdout.includes('RS3_RESOURCE_GAME_DATA_DIR'));
  assert.equal(result.stdout.includes(f.root), false);
  assert.throws(() => githubEnvironment({ NAME: 'safe\nUNEXPECTED=value' }), /Invalid GitHub/);
});

test('CLI fails closed for selected missing cache inputs with a generic safe error', t => {
  const f = fixture(t, { cacheInputs: true }), output = path.join(f.root, 'github-env');
  const name = path.join(f.tree, 'cache-inputs', f.selection.cacheInputs.version,
    'local-game/skill-guides-2026-10-08-v1/skill-guides.v1.json');
  rmSync(name);
  const result = spawnSync(process.execPath, ['scripts/ci/coverage-inputs.mjs', f.checkout, f.tree], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ENV: output }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'Coverage input setup failed: invalid or unreadable supplied inputs.');
});

test('Wiki setup requests exact public revisions in an isolated cache and verifies returned records', async t => {
  const f = fixture(t), pages = [{ requestedTitle: 'Oak', title: 'Oak', revision: 123 }];
  f.put(path.join(f.checkout, 'app/datasets/open-f2p/authored/batch.json'), JSON.stringify({ pages }));
  let called = 0;
  const fetchWiki = async (requests, { cacheDir }) => {
    called++;
    assert.deepEqual(requests, pages);
    assert.equal(cacheDir, path.join(f.checkout, '.local/gh-coverage/wiki-open-f2p'));
    f.put(path.join(cacheDir, pageFilename('Oak')), JSON.stringify({ requestedTitle: 'Oak', page: { title: 'Oak', revisions: [{ revid: 123 }] } }));
  };
  const { env } = await prepareCoverageInputs(f, { fetchWiki });
  assert.equal(called, 1);
  assert.equal(env.OPEN_F2P_WIKI_CACHE, path.join(f.checkout, '.local/gh-coverage/wiki-open-f2p'));
  await assert.rejects(prepareCoverageInputs(f, { fetchWiki: async () => {
    f.put(path.join(env.OPEN_F2P_WIKI_CACHE, pageFilename('Oak')), JSON.stringify({ requestedTitle: 'Oak', page: { revisions: [{ revid: 124 }] } }));
  } }), /revision mismatch/);
  pages[0].revision = null;
  f.put(path.join(f.checkout, 'app/datasets/open-f2p/authored/batch.json'), JSON.stringify({ pages }));
  await assert.rejects(prepareCoverageInputs(f, { fetchWiki }), /pins are invalid/);
});
