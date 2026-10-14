// Picture availability affects presentation only. These values never enter saves,
// access calculations or command payloads.
const skills = new Set('agility archaeology attack constitution construction cooking crafting defence divination dungeoneering farming firemaking fishing fletching herblore hunter invention magic mining necromancy prayer ranged runecrafting slayer smithing strength summoning thieving woodcutting'.split(' '));
const types = new Set(['quest', 'achievements', 'minigame', 'clue', 'music']);
const groups = new Set(['general', 'transport', 'skilling', 'combat-slayer', 'quests-achievements', 'minigames', 'other']);
const failedRoutes = new Set();
const statusListeners = new Set(), fallbackDocuments = new WeakSet();
let status = null, routes = null, pending;
const safeLabel = value => typeof value === 'string' && /^[a-zA-Z0-9._+-]{1,80}$/.test(value) ? value : 'unknown';

export function setArtStatus(value) {
  status = value && typeof value === 'object' ? {
    placeholderPictures: value.placeholderPictures === true,
    pack: value.pack ? { kind: safeLabel(value.pack.kind), version: value.pack.version == null ? null : safeLabel(value.pack.version), health: safeLabel(value.pack.health) } : null,
  } : null;
  routes = Array.isArray(value?.availableRoutes) ? new Set(value.availableRoutes.filter(route => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//'))) : null;
  failedRoutes.clear();
  for (const listener of statusListeners) listener(status);
  return status;
}
export function getArtStatus() { return status; }
export function observeArtStatus(listener) {
  statusListeners.add(listener); listener(status);
  return () => statusListeners.delete(listener);
}
export async function loadArtStatus(fetcher = globalThis.fetch) {
  return pending ??= (async () => {
    try {
      const response = await fetcher('/api/art-status', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) return setArtStatus(await response.json());
    } catch { /* Older/offline servers keep their existing picture resolution. */ }
    return status;
  })();
}
export function placeholderPicture(name) {
  return name === 'item' || /^skill-/.test(name) && skills.has(name.slice(6))
    || /^task-/.test(name) && types.has(name.slice(5)) || /^pin-/.test(name) && groups.has(name.slice(4))
    ? `/placeholder-art/${name}.svg` : null;
}
export function categoryPlaceholder(category) {
  const key = String(category ?? '').toLowerCase();
  if (skills.has(key)) return placeholderPicture(`skill-${key}`);
  const type = ({ achievement: 'achievements', diary: 'achievements', activity: 'minigame', nonskill: 'minigame', extra: 'minigame', combat: 'attack' })[key] ?? key;
  return type === 'attack' ? placeholderPicture('skill-attack') : placeholderPicture(`task-${type}`);
}
// The status route inventory covers legacy resources/world/special task copies.
// Large tile/sprite collections use their own manifests and failure caches.
export function pictureAvailable(route) {
  if (!route || failedRoutes.has(route)) return false;
  if (!routes || route.startsWith('/placeholder-art/')) return true;
  const inventoried = route.startsWith('/assets/') && !route.startsWith('/assets/map/') || route.startsWith('/task-item-artwork.');
  return !inventoried || routes.has(route);
}
export function resolvePicture(route, fallback = null) {
  return pictureAvailable(route) ? route : fallback;
}
export function recordPictureFailure(route) {
  if (!route || failedRoutes.has(route)) return;
  failedRoutes.add(route);
  if (status && (!status.placeholderPictures || status.pack?.health === 'ready' || status.pack?.health === 'healthy')) {
    status = { ...status, placeholderPictures: true, pack: status.pack ? { ...status.pack, health: 'damaged' } : null };
    for (const listener of statusListeners) listener(status);
  }
}
export function missingPicture(route) {
  const skill = /^\/assets\/SVG\/rs3\/([a-z]+)-rs3\.svg$/.exec(route);
  if (skill) return categoryPlaceholder(skill[1]);
  if (/\/icons-skills\./.test(route)) {
    const name = /\/([a-z]+)\.png$/.exec(route)?.[1];
    return categoryPlaceholder(name);
  }
  if (/\/(?:equipment_icons|icons-items\.[^/]+)\//.test(route) || route.startsWith('/task-item-artwork.')) return placeholderPicture('item');
  if (/\/icons\//.test(route) || /\/pin-sprites[^/]*\//.test(route)) return placeholderPicture('pin-other');
  return null;
}
export function installPictureFallbacks(document) {
  if (!document || fallbackDocuments.has(document)) return;
  fallbackDocuments.add(document);
  document?.addEventListener?.('error', event => {
    const image = event.target;
    if (image?.tagName !== 'IMG') return;
    const route = image.getAttribute?.('src');
    if (!route?.startsWith('/') || route.startsWith('/placeholder-art/')) return;
    recordPictureFailure(route);
    const fallback = image.dataset?.artFallback && placeholderPicture(image.dataset.artFallback.replace(/^\/placeholder-art\//, '').replace(/\.svg$/, '')) || missingPicture(route);
    if (fallback) image.src = fallback;
    else if (image.classList?.contains('bis-slot-icon')) {
      const label = document.createElement('span'); label.className = 'bis-slot-placeholder'; label.textContent = image.dataset.slot ?? 'Slot'; image.replaceWith(label);
    } else image.hidden = true;
  }, true);
}
export function artStatusText(value = status) {
  if (!value) return 'Picture status unavailable';
  const picture = value.placeholderPictures ? 'Using placeholder pictures' : 'Pictures installed';
  if (!value.pack?.version) return `${picture} · ${value.pack?.health === 'invalid' ? 'Art pack unavailable · invalid' : 'No art pack selected'}`;
  return value.pack ? `${picture} · ${safeLabel(value.pack.kind)} ${safeLabel(value.pack.version)} · ${safeLabel(value.pack.health)}` : picture;
}
