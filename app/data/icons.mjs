import { datasetValue } from "../dataset-runtime.mjs";
export const ICON_VERSION = datasetValue("app/data/icons.mjs#ICON_VERSION");
export const ICON_MANIFEST_PATH = datasetValue("app/data/icons.mjs#ICON_MANIFEST_PATH");
export const ICON_CACHE_CONTROL = 'private, max-age=31536000, immutable';
// Existing artwork bundles stay immutable. The new catalogue adds a separately
// installed supplement rather than rewriting the prior provenance or PNGs.
export const ICON_BUNDLES = datasetValue("app/data/icons.mjs#ICON_BUNDLES");

export function normalizeIconName(name) {
  return typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

const safeFile = value => typeof value === 'string' && /^[A-Za-z0-9_-]+\.png$/.test(value);
const safeImage = value => value && safeFile(value.file) && /^[a-f0-9]{64}$/.test(value.sha256)
  && Number.isSafeInteger(value.bytes) && value.bytes > 0
  && Number.isSafeInteger(value.width) && value.width > 0
  && Number.isSafeInteger(value.height) && value.height > 0;

/** Build an allowlisted local catalogue. Neither names nor aliases become paths. */
export function createIconCatalogue(manifests) {
  const manifest = { schemaVersion: 1, version: ICON_VERSION, skills: {}, items: {} };
  const indexes = { skill: new Map(), item: new Map() }, files = new Map();
  const provenance = new Map();
  for (const bundle of manifests) {
    const kind = bundle?.kind;
    if (!ICON_BUNDLES.some(spec => spec.kind === kind && spec.version === bundle.version) || bundle.schemaVersion !== 1
      || bundle.assetDirectory !== `icons-${kind}.${bundle.version}` || !bundle.icons || Array.isArray(bundle.icons)
      || typeof bundle.icons !== 'object') throw new TypeError('Invalid icon manifest.');
    const prefix = `/assets/map/${bundle.assetDirectory}/`;
    provenance.set(`${prefix}manifest.json`, bundle);
    const index = indexes[kind === 'skills' ? 'skill' : 'item'];
    for (const [name, entry] of Object.entries(bundle.icons)) {
      if (!normalizeIconName(name) || !safeImage(entry) || !Array.isArray(entry.aliases)
        || entry.aliases.some(alias => !normalizeIconName(alias))) throw new TypeError(`Invalid icon: ${name}.`);
      const url = `${prefix}${entry.file}`;
      const value = { name, url, aliases: [...entry.aliases] };
      manifest[kind][name] = { url, aliases: value.aliases };
      for (const image of [entry, ...(entry.large ? [entry.large] : [])]) {
        if (!safeImage(image)) throw new TypeError(`Invalid large icon: ${name}.`);
        const imageUrl = `${prefix}${image.file}`;
        const previous = files.get(imageUrl);
        if (previous && (previous.sha256 !== image.sha256 || previous.bytes !== image.bytes)) throw new TypeError(`Conflicting icon file: ${image.file}.`);
        files.set(imageUrl, { relative: `${bundle.assetDirectory}/${image.file}`, sha256: image.sha256, bytes: image.bytes });
      }
      for (const label of [name, ...entry.aliases]) {
        const key = normalizeIconName(label), previous = index.get(key);
        // Colliding identities stay unmapped instead of selecting the first row.
        index.set(key, index.has(key) && previous?.url !== url ? null : value);
      }
    }
  }
  return { manifest, files, provenance,
    lookup(kind, name) { return indexes[kind]?.get(normalizeIconName(name)) ?? null; },
  };
}
