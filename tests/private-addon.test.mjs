import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validatePrivateAddon, privateAddonSelection, loadPrivateAddon, datasetWithPrivateAddon, privateGalleryFiles } from '../app/private-addon.mjs';
import { loadOriginalSyncPanel } from '../app/web/original-sync-loader.mjs';
import { applyDatasetFeatureControls } from '../app/web/dataset-features.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const disabled = { digest: 'invented-gameplay-digest', capabilities: { features: { originalSync: false, gallery: false, projectUpdates: false, training: true } },
  workerSelection: () => ({ digest: 'invented-gameplay-digest' }) };
const serverSource = 'export function createIntegration(core) { return { createOriginalSyncClient: () => core.marker, previewOriginalSync() {}, originalSyncCommand() {} }; }';
async function installation(t, { sync = false, gallery = false, updates = true, interiors = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'private-addon-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const features = {}, contents = new Map();
  if (sync) {
    features.originalSync = { server: 'server/original-sync.mjs', browser: 'app/web/original-sync.mjs' };
    contents.set(features.originalSync.server, serverSource);
    contents.set(features.originalSync.browser, 'export function createOriginalSync() {}');
  }
  if (gallery) {
    features.gallery = true;
    for (const filename of privateGalleryFiles) contents.set(`app/web/${filename}`, filename.endsWith('.json') ? '{"fixtures":[]}' : `/* Invented ${filename} */`);
  }
  if (updates) {
    features.projectUpdates = true;
    contents.set('app/data/changelog.json', '{"entries":[{"title":"Invented update"}]}');
    contents.set('app/data/roadmap.json', '{"items":[]}');
  }
  if (interiors) {
    features.bankingInteriors = true;
    contents.set('app/data/banking-interiors.json', '{"schemaVersion":1,"candidates":[]}');
  }
  for (const [filename, bytes] of contents) { await mkdir(path.dirname(path.join(directory, filename)), { recursive: true }); await writeFile(path.join(directory, filename), bytes); }
  const descriptor = { schemaVersion: 1, features, files: [...contents].map(([filename, bytes]) => ({ path: filename, sha256: sha(bytes) })) };
  const bytes = JSON.stringify(descriptor), options = { addonPath: path.join(directory, 'addon.json'), addonSha256: sha(bytes) };
  await writeFile(options.addonPath, bytes);
  return { directory, descriptor, contents, options, addon: await loadPrivateAddon(options) };
}

test('private add-ons require an explicit absolute path and complete hash pin', async () => {
  assert.equal(privateAddonSelection({}, {}), null);
  assert.equal(await loadPrivateAddon({ addonPath: '', addonSha256: '' }), null);
  for (const env of [{ RS3_PRIVATE_ADDON: 'relative.json' }, { RS3_PRIVATE_ADDON_SHA256: 'a'.repeat(64) },
    { RS3_PRIVATE_ADDON: path.resolve('addon.json'), RS3_PRIVATE_ADDON_SHA256: 'bad' }]) {
    assert.throws(() => privateAddonSelection({}, env), { code: 'PRIVATE_ADDON_INVALID' });
  }
  assert.equal(datasetWithPrivateAddon(disabled, null), disabled);
});

test('manifest rejects unpinned paths, route extensions and incomplete feature files', async t => {
  const { descriptor } = await installation(t, { sync: true, gallery: true });
  assert.ok(Object.isFrozen(validatePrivateAddon(structuredClone(descriptor)).features.originalSync));
  for (const change of [
    value => { value.routes = ['/extra']; },
    value => { value.files[0].path = '../escape.mjs'; },
    value => { value.files[0].sha256 = 'bad'; },
    value => { value.files.push(value.files[0]); },
    value => { value.files.pop(); },
    value => { value.features.originalSync.server = 'server/other.mjs'; },
    value => { value.features.projectUpdates = false; },
    value => { value.features.extra = true; },
  ]) { const value = structuredClone(descriptor); change(value); assert.throws(() => validatePrivateAddon(value), { code: 'PRIVATE_ADDON_INVALID' }); }
});

test('pinned code uses a verified snapshot factory and keeps gameplay identity unchanged', async t => {
  const { addon } = await installation(t, { sync: true });
  const marker = {}, integration = await addon.loadServerIntegration({ marker });
  assert.equal(integration.createOriginalSyncClient(), marker);
  const effective = datasetWithPrivateAddon(disabled, addon);
  assert.equal(effective.digest, disabled.digest);
  assert.equal(effective.workerSelection, disabled.workerSelection);
  assert.deepEqual(effective.capabilities.features, { gallery: false, training: true });
  assert.equal(disabled.capabilities.features.originalSync, false);
  const complete = datasetWithPrivateAddon({ digest: disabled.digest,
    capabilities: { other: true, features: { originalSync: false, gallery: false, projectUpdates: false } } },
  { features: { originalSync: true, gallery: true, projectUpdates: true } });
  assert.deepEqual(complete.capabilities, { other: true }, 'full private installation retains the established legacy capability shape');
  assert.throws(() => datasetWithPrivateAddon({ ...disabled, capabilities: { independent: true } }, addon), { code: 'PRIVATE_ADDON_INVALID' });
  const createOriginalSync = () => {};
  assert.equal(await loadOriginalSyncPanel(effective, async () => ({ createOriginalSync })), createOriginalSync);
  const node = { hidden: true, disabled: true };
  applyDatasetFeatureControls(effective, () => node);
  assert.deepEqual(node, { hidden: true, disabled: true }, 'session-hidden controls stay hidden');
});

test('changed or missing private files and manifests fail before reuse', async t => {
  const { addon, options, directory } = await installation(t, { sync: true });
  assert.deepEqual(await addon.json('app/data/roadmap.json'), { items: [] });
  await assert.rejects(addon.read('unlisted.json'), { code: 'PRIVATE_ADDON_INVALID' });
  const entry = path.join(directory, 'server/original-sync.mjs');
  await writeFile(entry, 'globalThis.privateAddonExecuted = true;');
  await assert.rejects(addon.loadServerIntegration({}), { code: 'PRIVATE_ADDON_INVALID' });
  assert.equal(globalThis.privateAddonExecuted, undefined);
  await assert.rejects(addon.verify(), { code: 'PRIVATE_ADDON_INVALID' });
  await assert.rejects(loadPrivateAddon(options), { code: 'PRIVATE_ADDON_INVALID' });
  await writeFile(entry, serverSource);
  await rm(path.join(directory, 'app/data/roadmap.json'));
  await assert.rejects(addon.json('app/data/roadmap.json'), { code: 'PRIVATE_ADDON_INVALID' });
  await writeFile(options.addonPath, '{}');
  await assert.rejects(addon.read('app/data/changelog.json'), { code: 'PRIVATE_ADDON_INVALID' });
});

test('calculator interior evidence is optional, pinned and separate from gameplay identity', async t => {
  const { addon, descriptor, directory } = await installation(t, { updates: false, interiors: true });
  assert.deepEqual(await addon.json('app/data/banking-interiors.json'), { schemaVersion: 1, candidates: [] });
  assert.equal(datasetWithPrivateAddon(disabled, addon).digest, disabled.digest);
  for (const change of [value => { value.features.bankingInteriors = false; }, value => { value.files = []; }]) {
    const value = structuredClone(descriptor); change(value);
    assert.throws(() => validatePrivateAddon(value), { code: 'PRIVATE_ADDON_INVALID' });
  }
  await writeFile(path.join(directory, 'app/data/banking-interiors.json'), '{"schemaVersion":1,"candidates":[{}]}');
  await assert.rejects(addon.json('app/data/banking-interiors.json'), { code: 'PRIVATE_ADDON_INVALID' });
});

test('private add-on refuses a symlink even when its bytes match', async t => {
  const { options, directory, contents } = await installation(t);
  const original = path.join(directory, 'app/data/roadmap.json'), target = path.join(directory, 'target.json');
  await writeFile(target, contents.get('app/data/roadmap.json')); await rm(original);
  try { await symlink(target, original); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host does not permit test symlinks.'); return; } throw error; }
  await assert.rejects(loadPrivateAddon(options), { code: 'PRIVATE_ADDON_INVALID' });
});

test('private gallery keeps admin, method and conditional-byte checks with no server', async t => {
  // This read-only provider selects invented data before the route module loads.
  process.env.RS3_DATASET = 'open-starter';
  const { serveGallery } = await import('../app/gallery-route.mjs');
  const { addon, directory } = await installation(t, { gallery: true });
  const dataset = datasetWithPrivateAddon(disabled, addon);
  const response = () => ({ status: undefined, fields: {}, writeHead(status, fields) { this.status = status; Object.assign(this.fields, fields); }, end(bytes) { this.bytes = bytes; } });
  const call = async (method, identity, headers = {}) => {
    const result = response();
    await serveGallery({ method, headers, url: '/gallery-catalogue.mjs' }, result,
      { route: '/gallery-catalogue.mjs', identity, dataset, privateAddon: addon });
    return result;
  };
  for (const identity of [undefined, { readOnly: true }, { admin: false }]) assert.equal((await call('GET', identity)).status, 404);
  assert.equal((await call('POST', { admin: true })).status, 404);
  const get = await call('GET', { admin: true });
  assert.equal(get.status, 200); assert.match(get.fields['Cache-Control'], /^private,/);
  assert.match(get.bytes.toString(), /Invented gallery-catalogue/);
  assert.equal((await call('HEAD', { admin: true })).bytes, undefined);
  assert.equal((await call('GET', { admin: true }, { 'if-none-match': get.fields.ETag })).status, 304);
  await writeFile(path.join(directory, 'app/web/gallery-catalogue.mjs'), 'changed');
  await assert.rejects(call('HEAD', { admin: true }, { 'if-none-match': get.fields.ETag }), { code: 'PRIVATE_ADDON_INVALID' });
  const result = response();
  await serveGallery({ method: 'POST', headers: { referer: 'http://example.invalid/gallery/preview' } }, result,
    { route: '/api/command', identity: { admin: true }, dataset, privateAddon: addon });
  assert.equal(result.status, 404); assert.equal(result.bytes, 'Not saved: gallery');
});
