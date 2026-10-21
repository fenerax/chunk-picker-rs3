import path from 'node:path';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeArtFile } from './packs.mjs';

const digest = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const fail = () => { throw Object.assign(new Error('Invalid installed private add-on. Restart with the pinned installation.'), { code: 'PRIVATE_ADDON_INVALID' }); };
const serverEntry = 'server/original-sync.mjs';
const browserEntry = 'app/web/original-sync.mjs';
export const privateGalleryFiles = Object.freeze(['gallery.html', 'gallery.mjs', 'gallery.css', 'gallery-catalogue.mjs',
  'gallery-preview.mjs', 'gallery-capture.mjs', 'gallery-fixtures.mjs', 'gallery-fixture-data.json',
  'gallery-safety.mjs', 'gallery-usage.mjs', 'gallery-usage-fixture.mjs']);

/** Executable operator code is separate from data-only profiles and packs. */
export function validatePrivateAddon(value) {
  if (!plain(value) || value.schemaVersion !== 1 || !plain(value.features) || !Array.isArray(value.files)
    || Object.keys(value).some(key => !['schemaVersion', 'features', 'files'].includes(key))
    || Object.keys(value.features).some(key => !['originalSync', 'gallery', 'projectUpdates', 'bankingInteriors'].includes(key))) fail();
  const required = new Set();
  const { originalSync, gallery, projectUpdates, bankingInteriors } = value.features;
  if (originalSync !== undefined) {
    if (!plain(originalSync) || Object.keys(originalSync).length !== 2
      || originalSync.server !== serverEntry || originalSync.browser !== browserEntry) fail();
    required.add(serverEntry); required.add(browserEntry);
  }
  if (gallery !== undefined) {
    if (gallery !== true) fail();
    for (const filename of privateGalleryFiles) required.add(`app/web/${filename}`);
  }
  if (projectUpdates !== undefined) {
    if (projectUpdates !== true) fail();
    required.add('app/data/changelog.json'); required.add('app/data/roadmap.json');
  }
  // Optional calculator evidence never supplies access edges or dataset inputs.
  if (bankingInteriors !== undefined) {
    if (bankingInteriors !== true) fail();
    required.add('app/data/banking-interiors.json');
  }
  if (!required.size || value.files.length !== required.size) fail();
  const seen = new Set();
  for (const file of value.files) {
    if (!plain(file) || Object.keys(file).length !== 2 || !required.has(file.path) || seen.has(file.path) || !digest.test(file.sha256 ?? '')) fail();
    seen.add(file.path); Object.freeze(file);
  }
  if (originalSync) Object.freeze(originalSync);
  Object.freeze(value.files); Object.freeze(value.features);
  return Object.freeze(value);
}

export function privateAddonSelection(options = {}, environment = process.env) {
  const addonPath = options.addonPath ?? environment.RS3_PRIVATE_ADDON;
  const addonSha256 = options.addonSha256 ?? environment.RS3_PRIVATE_ADDON_SHA256;
  if (!addonPath && !addonSha256) return null;
  if (typeof addonPath !== 'string' || !path.isAbsolute(addonPath) || !digest.test(addonSha256 ?? '')) fail();
  return Object.freeze({ addonPath: path.resolve(addonPath), addonSha256 });
}

async function readPinned(root, relative, expected, limit = 4 * 1024 ** 2) {
  const filename = await safeArtFile(root, relative);
  const handle = await open(filename, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) fail();
    const bytes = await handle.readFile();
    if (bytes.length !== before.size || sha(bytes) !== expected) fail();
    await safeArtFile(root, relative);
    if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await lstat(filename))) fail();
    return bytes;
  } finally { await handle.close(); }
}

/** No discovery, fallback, browser-selected path or ordinary pack code execution. */
export async function loadPrivateAddon(options = {}) {
  const selection = privateAddonSelection(options);
  if (!selection) return null;
  try {
    const root = path.dirname(selection.addonPath), manifest = path.basename(selection.addonPath);
    const checkManifest = () => readPinned(root, manifest, selection.addonSha256, 1024 ** 2);
    const descriptor = validatePrivateAddon(JSON.parse((await checkManifest()).toString('utf8')));
    const records = new Map(descriptor.files.map(file => [file.path, file.sha256]));
    const read = async filename => {
      try {
        if (!records.has(filename)) fail();
        await checkManifest();
        return await readPinned(root, filename, records.get(filename));
      } catch { fail(); }
    };
    let total = 0;
    for (const file of descriptor.files) { total += (await read(file.path)).length; if (total > 32 * 1024 ** 2) fail(); }
    return Object.freeze({
      ...selection, features: descriptor.features,
      read,
      async json(filename) { try { return JSON.parse((await read(filename)).toString('utf8')); } catch { fail(); } },
      async verify() { for (const file of descriptor.files) await read(file.path); },
      async loadServerIntegration(core) {
        try {
          if (!descriptor.features.originalSync) return null;
          // Execute the verified snapshot, never a second filesystem import.
          // The private builder supplies a self-contained factory whose shared
          // dependencies are the selected public core namespaces below.
          const bytes = await read(serverEntry);
          const module = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
          if (typeof module.createIntegration !== 'function') fail();
          const integration = await module.createIntegration(core);
          if (!integration || ['createOriginalSyncClient', 'previewOriginalSync', 'originalSyncCommand'].some(key => typeof integration[key] !== 'function')) fail();
          return integration;
        } catch { fail(); }
      },
    });
  } catch { fail(); }
}

/** Presentation/integration flags do not change gameplay identity or workers. */
export function datasetWithPrivateAddon(dataset, addon) {
  if (!addon) return dataset;
  if (dataset.capabilities?.independent && addon.features.originalSync) fail();
  const features = { ...dataset.capabilities?.features };
  // Absence means enabled in the established contract. Remove only the
  // installed-profile restrictions supplied by this explicit installation.
  for (const feature of ['originalSync', 'gallery', 'projectUpdates']) if (addon.features[feature]) delete features[feature];
  const { features: previous, ...capabilities } = dataset.capabilities ?? {};
  if (Object.keys(features).length) capabilities.features = Object.freeze(features);
  return Object.freeze({ ...dataset, capabilities: Object.freeze(capabilities) });
}
