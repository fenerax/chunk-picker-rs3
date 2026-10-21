import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildCoverageInputs, prepareCoverageInputs, githubEnvironment } from '../scripts/ci/coverage-inputs.mjs';
import { placePacks } from '../.github/packs/fetch-packs.mjs';
import { pageFilename } from '../scripts/fetch-open-f2p-wiki.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const parent = path.resolve('.local/gh-coverage/input-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), tree = path.join(root, 'packs');
  const put = (filename, bytes) => { mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, bytes); };
  put(path.join(checkout, 'tests/browser-screen-harness.mjs'), 'export const harness = true;');
  const selection = { schemaVersion: 1 };
  function pack(kind, id, files, roots) {
    const version = kind === 'rulesText' ? '1.0.0' : '1.0.0-public.1', base = path.join(tree, id, version);
    const records = Object.entries(files).map(([name, bytes]) => {
      put(path.join(base, name), bytes);
      return { path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) };
    });
    const manifest = JSON.stringify({ files: records, ...(roots ? { roots } : {}) });
    put(path.join(base, 'pack.json'), manifest);
    selection[kind] = { id, version, sha256: sha(manifest) };
  }
  pack('data', 'duo-data', { 'local-game/catalogue.json': '{}',
    'local-game/skill-guides-2026-10-08-v1/skill-guides.v1.json': '{}' });
  pack('rulesText', 'duo-rules-text', { 'rules.md': 'public rules' });
  pack('art', 'duo-art', { 'map-assets/icons-skills.2026-10-08.v1/manifest.json': '{}',
    'map-assets/icons-skills.2026-10-08.v1/attack.png': 'synthetic icon' }, { iconAssets: 'map-assets' });
  const saveSelection = () => put(path.join(tree, 'selection.json'), JSON.stringify(selection));
  saveSelection(); placePacks({ checkout, tree });
  return { root, checkout, tree, selection, saveSelection, put };
}

test('coverage inputs use selected public versions, placed game/map roots and the selected art component', t => {
  const f = fixture(t), { env, missing } = buildCoverageInputs(f);
  assert.deepEqual(missing, ['pinned resource masks need an authentic public bundle and a configurable builder source root']);
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
  const f = fixture(t), output = path.join(f.root, 'github-env');
  const result = spawnSync(process.execPath, ['scripts/ci/coverage-inputs.mjs', f.checkout, f.tree], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ENV: output }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), githubEnvironment(buildCoverageInputs(f).env));
  assert.ok(result.stdout.includes('SKILL_ICON_ASSET_ROOT'));
  assert.equal(result.stdout.includes(f.root), false);
  assert.throws(() => githubEnvironment({ NAME: 'safe\nUNEXPECTED=value' }), /Invalid GitHub/);
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
