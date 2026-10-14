import { categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture, pictureAvailable } from './art-status.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';
const manifestPath = '/assets/map/icons.2026-10-12.v1.json';
const normalize = name => typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
const safeUrl = url => typeof url === 'string'
  && /^\/assets\/map\/icons-(?:skills\.2026-10-08|items\.2026-10-(?:0[89]|12))\.v1\/[A-Za-z0-9_-]+\.png$/.test(url);

/** Independent loaders are useful in isolated tests; the browser uses one instance. */
export function createIconHelper(fetcher = (...args) => globalThis.fetch(...args)) {
  let pending;
  const indexes = { skills: new Map(), items: new Map() };
  function loadIcons() {
    return pending ??= (async () => {
      try {
        const response = await fetcher(manifestPath, { credentials: 'same-origin', cache: 'force-cache' });
        if (!response.ok) return false;
        const manifest = await response.json();
        if (manifest?.schemaVersion !== 1 || manifest.version !== '2026-10-12.v1') return false;
        const next = { skills: new Map(), items: new Map() };
        for (const kind of ['skills', 'items']) {
          if (!manifest[kind] || typeof manifest[kind] !== 'object' || Array.isArray(manifest[kind])) return false;
          for (const [name, entry] of Object.entries(manifest[kind])) {
            if (!normalize(name) || !safeUrl(entry?.url) || !entry.url.includes(`/icons-${kind}.`)
              || !Array.isArray(entry.aliases) || entry.aliases.some(alias => !normalize(alias))) return false;
            for (const label of [name, ...entry.aliases]) {
              const key = normalize(label), previous = next[kind].get(key);
              next[kind].set(key, next[kind].has(key) && previous !== entry.url ? null : entry.url);
            }
          }
        }
        indexes.skills = next.skills; indexes.items = next.items;
        return true;
      } catch { return false; }
    })();
  }
  function lookup(kind, name) {
    if (!pending) void loadIcons();
    return indexes[kind].get(normalize(name)) ?? null;
  }
  return { loadIcons, skillIcon: name => lookup('skills', name), itemIcon: name => lookup('items', name) };
}

// Call await loadIcons() before rendering a list. The synchronous lookups also
// start that same lazy load, returning null while it is pending or unavailable.
const browserIcons = createIconHelper();
const hasIconCatalogue = selectedDataset.capabilities?.independent !== true;
export const loadIcons = () => hasIconCatalogue ? browserIcons.loadIcons() : Promise.resolve(false);
export const skillIcon = name => resolvePicture(hasIconCatalogue ? browserIcons.skillIcon(name) : null)
  || (getArtStatus() && !pictureAvailable(`/assets/SVG/rs3/${normalize(name)}-rs3.svg`) ? categoryPlaceholder(name) : null);
export const itemIcon = name => resolvePicture(hasIconCatalogue ? browserIcons.itemIcon(name) : null, getArtStatus() && normalize(name) ? placeholderPicture('item') : null);
