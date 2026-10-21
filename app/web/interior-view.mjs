// Display-only interior maps (caves, cellars, dungeons) for the chunk panel.
// The catalogue never grants access; it only shows what an area looks like.
import { resolvePicture, recordPictureFailure } from './art-status.mjs';

/** Places this chunk is or leads into that could have an interior map. */
export function interiorCandidates(id, record, world) {
  const ids = [];
  const base = key => String(key).replace(/^(\d+)-\d+$/, '$1');
  const add = key => { const value = base(key); if (!ids.includes(value)) ids.push(value); };
  // Retained Name identifies an interior even when its numeric alias overlaps
  // the surface grid. Nickname identifies ordinary surface records.
  const interior = key => {
    const value = base(key), raw = world.resourceContents?.get(value) ?? (value === base(id) ? record : null);
    return world.areas.has(value) || (typeof raw?.Name === 'string' && !!raw.Name.trim())
      || (world.chunks.has(value) && !world.surface.has(value));
  };
  if (interior(id)) add(id);
  // Connections may sit on the chunk, its sections or its walkable components.
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    for (const name of Object.keys(node.Connect ?? {})) if (interior(name)) add(name);
    for (const child of [...Object.values(node.Sections ?? {}), ...Object.values(node.CacheComponents ?? {})]) visit(child);
  };
  visit(record);
  const connections = Array.isArray(world.mapConnections) ? world.mapConnections : world.mapConnections?.connections ?? [];
  const matchesOrigin = point => [point?.chunkId, point?.sectionId, point?.locationId, point?.areaId]
    .some(value => value != null && base(value) === base(id));
  for (const edge of connections) {
    const endpoints = [edge.from, edge.to];
    if (!endpoints.some(matchesOrigin)) continue;
    for (const point of endpoints) if (point?.offSurface === true && typeof point.interiorMap?.areaId === 'string'
      && point.interiorMap.areaId.trim()) add(point.interiorMap.areaId);
  }
  return ids;
}

/** Display name for a place id (areas first, then chunks). */
export function placeName(world, id, fallback = id) {
  return String((world.areas.get(id) ?? world.chunks.get(id))?.name ?? fallback);
}

// One small request per place (the full catalogue is several megabytes); cached for the session.
const areaCache = new Map();
function loadArea(api, id) {
  if (!areaCache.has(id)) areaCache.set(id, api(`/api/interior-maps?area=${encodeURIComponent(id)}`)
    .then(value => value.area ?? null)
    .catch(error => { if (error.status === 404 || /404|Unknown picker interior/.test(error.message)) return null; areaCache.delete(id); throw error; }));
  return areaCache.get(id);
}

function layerTiles(area, layer) {
  const map = (area.maps ?? []).find(item => item?.mapId === layer.mapId && item?.plane === layer.plane);
  if (!map) return null;
  const b = layer.bounds ?? map.bounds;
  const [x0, x1, y0, y1] = [Math.floor(b.minX / 64), Math.floor((b.maxX - 1) / 64), Math.floor(b.minY / 64), Math.floor((b.maxY - 1) / 64)];
  const tiles = map.tiles.filter(tile => resolvePicture(tile.url) && tile.x >= x0 && tile.x <= x1 && tile.y >= y0 && tile.y <= y1);
  return tiles.length ? { tiles, bounds: b } : null;
}

// Crop to the place's own bounds and scale it to fill the panel, so small places
// like Puro-Puro aren't a speck in a corner of a whole 64-square tile.
function mapView(el, { tiles, bounds: b }, width, maxHeight = 420) {
  const spanX = Math.max(1, b.maxX - b.minX), spanY = Math.max(1, b.maxY - b.minY);
  const scale = Math.min(width / spanX, maxHeight / spanY, 6); // pixels per game square; tiles are drawn at 4
  const frame = el('div', undefined, 'interior-map');
  if (frame.style) { frame.style.width = `${Math.round(spanX * scale)}px`; frame.style.height = `${Math.round(spanY * scale)}px`; }
  const size = Math.round(64 * scale);
  let missingNotice;
  for (const tile of tiles) {
    const img = el('img'); img.src = tile.url; img.alt = ''; img.width = img.height = size; img.loading = 'lazy';
    img.onerror = () => {
      recordPictureFailure(tile.url); img.hidden = true;
      if (!missingNotice) { missingNotice = el('p', 'No picture for this place', 'status-detail'); frame.append(missingNotice); }
    };
    // North-up: higher map rows sit higher on screen.
    if (img.style) { img.style.left = `${Math.round((tile.x * 64 - b.minX) * scale)}px`; img.style.top = `${Math.round((b.maxY - (tile.y + 1) * 64) * scale)}px`; }
    frame.append(img);
  }
  return frame;
}

/** The panel body for the Underground tab. */
export function interiorPanel({ el, button, api, world }, ids, width = 330) {
  const box = el('div', undefined, 'interior-panel'), choices = el('div', undefined, 'interior-choices'), body = el('div', undefined, 'interior-body');
  body.append(el('p', 'Loading interior maps…', 'status-detail'));
  box.append(choices, body);
  Promise.all(ids.map(id => loadArea(api, String(id)))).then(found => {
    if (!box.isConnected && box.isConnected !== undefined) return;
    const areas = found.filter(area => area?.status === 'mapped');
    if (!areas.length) { body.replaceChildren(el('p', 'No picture for this place', 'status-detail')); return; }
    // Several records can share a name (floors or parts of one dungeon): one choice per name, showing every distinct map.
    const groups = new Map();
    for (const area of areas) {
      const name = placeName(world, area.areaId, area.name);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(area);
    }
    const show = name => {
      for (const node of choices.children) node.setAttribute?.('aria-pressed', String(node.dataset?.name === name));
      const seen = new Set(), views = [];
      for (const area of groups.get(name)) for (const layer of area.layers) {
        const view = layerTiles(area, layer), key = view && `${layer.mapId}:${layer.plane}:${JSON.stringify(view.bounds)}`;
        if (view && !seen.has(key)) { seen.add(key); views.push(view); }
      }
      body.replaceChildren(el('h4', name, 'content-heading'));
      if (!views.length) { body.append(el('p', 'No picture for this place', 'status-detail')); return; }
      for (const view of views) body.append(mapView(el, view, width));
      body.append(el('p', 'Map only: it does not change what counts as reachable.', 'plan-footnote'));
    };
    if (groups.size > 1) for (const name of groups.keys()) { const node = button(name, () => show(name), 'interior-choice'); if (node.dataset) node.dataset.name = name; choices.append(node); }
    show(groups.keys().next().value);
  }).catch(error => body.replaceChildren(el('p', error.message || String(error), 'error')));
  return box;
}
