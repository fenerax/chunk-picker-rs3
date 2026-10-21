import { RectangleIndex } from './map-task-count-renderer.mjs';
import { taskCountAnnotationCells, taskCountObstacles } from './map-task-count-obstacles.mjs';
import { themePalettes } from './map-tools.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';
import { supportsDatasetFeature } from './dataset-features.mjs';

export const PLACE_LABEL_DATA = '/data/place-labels.2026-10-13.v1.json';
const FONT = 'Calibri, "Segoe UI", sans-serif';
const SIZES = { region: 17, town: 14, place: 12 };
export const LABEL_INKS = Object.freeze({
  dark: Object.freeze({ region: '#ffc65c', town: '#ffffff', place: '#e9dcb8' }),
  light: Object.freeze({ region: '#7a4a00', town: '#1f1a12', place: '#4a4032' }),
});
const GAP = 8;
const VERTICAL_OFFSETS = [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20, -24, 24];
const LEVEL_ORDER = { region: 3, town: 2, place: 1 };
const priorityOrder = (a, b) => (LEVEL_ORDER[b.level] ?? 0) - (LEVEL_ORDER[a.level] ?? 0)
  || (b.priority ?? 0) - (a.priority ?? 0) || String(a.id).localeCompare(String(b.id));
// The hover tooltip is deliberately absent: names stay put and simply sit under it.
// Refitting around it made names jump about as the pointer moved.
const PANEL_SELECTOR = '.toolbar-group,.floating-panel,.recent-panel,.map-summary,.map-display-panel,'
  + '.quest-map-status,.chunk-colour-picker,.sticker-popover,.map-menu,.roll-presentation,.map-toast';
const annotationPadding = rect => ({ x: rect.x - 1.5, y: rect.y - 1.5, width: rect.width + 3, height: rect.height + 3 });
const ZOOM_STEP = Math.log(1.25);
export const placeLabelZoom = zoom => .055 * Math.exp(Math.floor(Math.log(zoom / .055) / ZOOM_STEP + 1e-10) * ZOOM_STEP);
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const padded = rect => ({ x: rect.x - GAP / 2, y: rect.y - GAP / 2,
  width: rect.width + GAP, height: rect.height + GAP });
const defaultCanvas = () => typeof document === 'undefined' ? null : document.createElement('canvas');
// The cache also labels some quest starts ("Start of Carnillean Rising"); those are not places.
const QUEST_MARKER = /^Start of /i;

/** Cache text sizes supply the hierarchy; small details never fill an overview. */
export function selectPlaceLabels(labels, zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return [];
  return labels.filter(label => Number.isFinite(label.x) && Number.isFinite(label.y)
    && typeof label.name === 'string' && label.name.trim() && !QUEST_MARKER.test(label.name) && SIZES[label.level]
    && (zoom < .16 ? label.level === 'region' : zoom < .65 ? label.level !== 'place' : label.level !== 'region'))
    .sort(priorityOrder);
}

/**
 * Some names are alternatives switched by one game variable (Barbarian Village at 0;
 * Gunnarsgrunn plus "(Barbarian Village)" at 1). Personal variables are never read,
 * so keep the default and drop variants that need a non-default value of a variable
 * whose default also has a name.
 */
export function defaultPlaceLabels(labels) {
  const toggles = label => (label.conditions ?? []).filter(condition => /^toggle_/.test(condition.kind)
    && Number.isFinite(condition.varbit) && condition.varbit !== 65535);
  const withDefault = new Set(labels.flatMap(label => toggles(label)
    .filter(condition => condition.lower <= 0 && condition.upper >= 0).map(condition => condition.varbit)));
  return labels.filter(label => !toggles(label).some(condition => withDefault.has(condition.varbit)
    && !(condition.lower <= 0 && condition.upper >= 0)));
}

/** Positions are the cache's surface-map tile projections, converted like map pins. */
export function placeLabelPoint(label, zoom) {
  return { x: (label.x - 1856) * 2 * zoom, y: (4608 - label.y) * 2 * zoom };
}

/** Pure bounded placement. A crowded name is omitted rather than moved off its place. */
export function layoutPlaceLabels(labels, { zoom, selectionZoom = zoom, obstacles = [], ordered = false,
  resolveCollisions = true, measure = (text, size) => text.length * size * .55 } = {}) {
  const index = resolveCollisions ? new RectangleIndex() : null, placements = [];
  for (const obstacle of obstacles) index?.add(padded(obstacle));
  for (const label of ordered ? labels : selectPlaceLabels(labels, selectionZoom)) {
    const fontSize = SIZES[label.level], lines = label.name.split(/\n/), point = placeLabelPoint(label, zoom);
    const width = Math.ceil(Math.max(...lines.map(text => measure(text, fontSize))) + 6);
    const height = lines.length * (fontSize + 2) + 4;
    const rect = { ...label, x: point.x - width / 2, y: point.y - height / 2, width, height, fontSize, lines };
    if (index?.blocked(rect)) continue;
    placements.push(rect); index?.add(padded(rect));
  }
  return placements;
}

/** Keep names near their anchor, choosing empty terrain before owned interiors. */
export function fitPlaceLabels(entries, obstacleIndex, badgeIndex = new RectangleIndex(), { unlockedIndex = null, bounds = null } = {}) {
  const names = new RectangleIndex(), placements = [];
  for (const entry of [...entries].sort(priorityOrder)) {
    const offsets = VERTICAL_OFFSETS.map(dy => [0, dy]);
    const limit = entry.level === 'region' ? 80 : entry.level === 'town' ? 48 : 24;
    for (const distance of [12, 24, 40, 48, 64, 80].filter(value => value <= limit)) {
      offsets.push([-distance, 0], [distance, 0], [0, -distance], [0, distance],
        [-distance, -distance], [distance, -distance], [-distance, distance], [distance, distance]);
    }
    const scales = entry.fontSize > 12 ? [1, Math.max(12 / entry.fontSize, .85)] : [1];
    let accepted, ownedFallback;
    for (const scale of scales) {
      const width = Math.ceil(entry.width * scale), height = Math.ceil(entry.height * scale);
      for (const [dx, dy] of offsets) {
        const rect = { x: entry.x + (entry.width - width) / 2 + dx,
          y: entry.y + (entry.height - height) / 2 + dy, width, height };
        if (bounds && (rect.x < bounds.x || rect.y < bounds.y || rect.x + width > bounds.x + bounds.width
          || rect.y + height > bounds.y + bounds.height)) continue;
        if (obstacleIndex.blocked(rect) || badgeIndex.blocked(rect) || names.blocked(rect)) continue;
        const candidate = { ...entry, ...rect, fontSize: entry.fontSize * scale, scale };
        if (unlockedIndex?.blocked(rect)) { ownedFallback ??= candidate; continue; }
        accepted = candidate; break;
      }
      if (accepted) break;
    }
    accepted ??= ownedFallback;
    if (accepted) { placements.push(accepted); names.add(padded(accepted)); }
  }
  return placements;
}

/** Reserve painted edges, leaving the interior available as a last resort. */
export function placeLabelChunkObstacles(map, bounds = null) {
  const hard = [], unlocked = [], size = 128 * map.zoom;
  const edge = (x, y, width, height, type, stroke) => hard.push({ x: x - stroke / 2,
    y: y - stroke / 2, width: width + stroke, height: height + stroke, type });
  const border = (map.model.preferences.highvis ? 2 : Math.max(2, Math.min(3.5, size * .028))) + 2;
  for (const [id, state] of map.cellStates) {
    const point = map.cells.get(id);
    if (!point) continue;
    const x = point.x * size, y = point.y * size;
    if (bounds && !intersects({ x: x - 4, y: y - 4, width: size + 8, height: size + 8 }, bounds)) continue;
    if (state.owners?.length) {
      unlocked.push({ x, y, width: size, height: size });
      const open = (dx, dy) => !map.unlocked?.has(map.cellId?.(point.x + dx, point.y + dy));
      if (open(0, -1)) edge(x, y, size, 0, 'unlocked border', border);
      if (open(0, 1)) edge(x, y + size, size, 0, 'unlocked border', border);
      if (open(-1, 0)) edge(x, y, 0, size, 'unlocked border', border);
      if (open(1, 0)) edge(x + size, y, 0, size, 'unlocked border', border);
    }
    const count = state.colourPaint?.segments.length ?? 0, width = size / count;
    if (size < 80 || width < 12 || !count) continue;
    const inset = Math.min(4, width * .15, size * .1);
    for (let index = 0; index < count; index++) {
      const left = x + index * width + inset, top = y + inset;
      const w = width - inset * 2, h = size - inset * 2;
      edge(left, top, w, 0, 'chunk colour accent', 3);
      edge(left, top + h, w, 0, 'chunk colour accent', 3);
      edge(left, top, 0, h, 'chunk colour accent', 3);
      edge(left + w, top, 0, h, 'chunk colour accent', 3);
    }
  }
  return { hard, unlocked };
}

/** Exact line/box clipping avoids reserving a diagonal leader's entire envelope. */
export function placeLabelLeaderIntersects(rect, badge) {
  if (!badge.callout || !badge.source) return false;
  const sx = badge.source.x, sy = badge.source.y;
  const ex = Math.max(badge.x, Math.min(badge.x + badge.width, sx));
  const ey = Math.max(badge.y, Math.min(badge.y + badge.height, sy));
  const left = rect.x - 2, right = rect.x + rect.width + 2;
  const top = rect.y - 2, bottom = rect.y + rect.height + 2;
  if (Math.max(sx, ex) < left || Math.min(sx, ex) > right
    || Math.max(sy, ey) < top || Math.min(sy, ey) > bottom) return false;
  const dx = ex - sx, dy = ey - sy;
  let near = 0, far = 1;
  if (Math.abs(dx) >= 1e-8) {
    const a = (left - sx) / dx, b = (right - sx) / dx;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  if (Math.abs(dy) >= 1e-8) {
    const a = (top - sy) / dy, b = (bottom - sy) / dy;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  }
  return near <= far;
}

class BadgeObstacleIndex extends RectangleIndex {
  constructor() { super(); this.leaders = []; }
  addBadge(badge) { this.add(annotationPadding(badge)); if (badge.callout) this.leaders.push(badge); }
  blocked(rect) { return super.blocked(rect) || this.leaders.some(badge => placeLabelLeaderIntersects(rect, badge)); }
}

/** Individual painted panels only; the dock's transparent gap remains usable. */
export function placeLabelPanelBoxes(stage) {
  const host = stage?.parentElement;
  if (!host?.querySelectorAll || !stage.getBoundingClientRect) return [];
  const origin = stage.getBoundingClientRect(), bounds = { x: 0, y: 0, width: origin.width, height: origin.height };
  const owner = stage.closest?.('.map-panel') ?? null;
  return [...host.querySelectorAll(PANEL_SELECTOR)].flatMap(panel => {
    if (panel.hidden || (panel.closest?.('.map-panel') ?? null) !== owner) return [];
    const box = panel.getBoundingClientRect();
    const rect = { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
    if (rect.width <= 0 || rect.height <= 0 || !intersects(rect, bounds)) return [];
    const clip = panel.closest?.('.map-dock-panels')?.getBoundingClientRect();
    const left = clip ? Math.max(0, clip.left - origin.left) : 0;
    const top = clip ? Math.max(0, clip.top - origin.top) : 0;
    const right = clip ? Math.min(bounds.width, clip.left - origin.left + clip.width) : bounds.width;
    const bottom = clip ? Math.min(bounds.height, clip.top - origin.top + clip.height) : bounds.height;
    const x = Math.max(left, rect.x), y = Math.max(top, rect.y);
    const width = Math.min(right, rect.x + rect.width) - x, height = Math.min(bottom, rect.y + rect.height) - y;
    return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
  });
}

/** Independent, display-only text. Artwork survives zooms; world layouts survive pans. */
export class MapPlaceLabels {
  constructor(map, geometry, { canvasFactory = defaultCanvas, load } = {}) {
    this.map = map; this.geometry = geometry; this.canvasFactory = canvasFactory;
    this.labels = []; this.layouts = new Map(); this.metrics = new Map();
    this.atlas = null; this.sprites = new Map(); this.lastPlacements = [];
    this.layoutBuilds = this.artworkBuilds = this.fitBuilds = 0; this.disposed = false;
    this.panelBoxes = []; this.panelsDirty = true;
    const host = map.stage?.parentElement;
    if (host?.querySelectorAll) {
      // DOM geometry is read only after a panel/layout event, never on each pan.
      const changed = () => {
        if (this.disposed) return;
        const panels = placeLabelPanelBoxes(map.stage), key = JSON.stringify(panels);
        // Hover can rewrite identical tooltip styles after every pin draw.
        // Only changed geometry schedules a frame, preventing an observer loop.
        if (key === this.panelKey) return;
        this.panelKey = key; this.panelBoxes = panels; this.panelsDirty = false; this.fitOffset = null;
        if (map.pinContext && map.invalidatePins) map.invalidatePins();
        else map.invalidate(false, true, false);
      };
      if (typeof ResizeObserver === 'function') {
        this.panelResize = new ResizeObserver(changed);
        this.observePanels = () => {
          this.panelResize.disconnect(); this.panelResize.observe(map.stage);
          for (const panel of host.querySelectorAll(PANEL_SELECTOR)) this.panelResize.observe(panel);
        };
        this.observePanels();
      }
      if (typeof MutationObserver === 'function') {
        this.panelMutation = new MutationObserver(records => {
          if (records.some(record => record.type === 'childList')) this.observePanels?.();
          changed();
        });
        this.panelMutation.observe(host, { subtree: true, childList: true, attributes: true,
          attributeFilter: ['hidden', 'open', 'class', 'style'] });
      }
      this.panelChanged = changed; this.panelHost = host;
      host.addEventListener('toggle', changed, true); host.addEventListener('scroll', changed, true);
    }
    const loader = load ?? (typeof document === 'undefined' || !supportsDatasetFeature(selectedDataset, 'mapMetadata') ? null : () => fetch(PLACE_LABEL_DATA).then(response => {
      if (!response.ok) throw new Error('Place names unavailable');
      return response.json();
    }));
    this.ready = loader ? Promise.resolve().then(loader).then(data => {
      if (this.disposed) return;
      this.labels = Array.isArray(data?.labels) ? defaultPlaceLabels(data.labels) : [];
      map.invalidate(false, true, false);
    }).catch(() => { /* Terrain and map controls remain usable without optional names. */ }) : Promise.resolve();
  }

  artwork(context, dpr) {
    const prefs = this.map.model.preferences, scheme = themePalettes[prefs.theme]?.scheme ?? 'dark';
    const style = `${scheme}:${!!prefs.highvis}`;
    if (this.artworkDpr === dpr && this.artworkStyle === style && this.artworkSource === this.labels) return;
    if (this.atlas) this.atlas.width = this.atlas.height = 0;
    this.sprites.clear(); this.metrics.clear(); this.layouts.clear();
    this.artworkDpr = dpr; this.artworkStyle = style; this.artworkSource = this.labels;
    // Colour by size: regions gold, towns plain, smaller places parchment, on a firm edge.
    this.inks = LABEL_INKS[scheme === 'light' ? 'light' : 'dark'];
    this.halo = scheme === 'light' ? '#fff9ec' : '#0a0907';
    this.haloWidth = prefs.highvis ? 3.5 : 3;
    const entries = [], measure = (text, size) => {
      const key = `${size}:${text}`;
      if (!this.metrics.has(key)) {
        context.font = `700 ${size}px ${FONT}`;
        this.metrics.set(key, context.measureText(text).width);
      }
      return this.metrics.get(key);
    };
    let x = 0, y = 0, rowHeight = 0;
    for (const label of this.labels) {
      const fontSize = SIZES[label.level];
      if (!fontSize) continue;
      const lines = label.name.split(/\n/), width = Math.ceil(Math.max(...lines.map(text => measure(text, fontSize))) + 6);
      const height = lines.length * (fontSize + 2) + 4;
      if (x + width > 1024) { x = 0; y += rowHeight; rowHeight = 0; }
      const glyph = { ...label, lines, fontSize, width, height,
        anchorX: (label.x - 1856) * 2, anchorY: (4608 - label.y) * 2 };
      entries.push({ ...glyph, x, y });
      this.sprites.set(label.id, { x, y, width, height, glyph });
      x += width; rowHeight = Math.max(rowHeight, height);
    }
    this.atlas = this.canvasFactory();
    const atlasContext = this.atlas?.getContext?.('2d');
    if (atlasContext) {
      this.atlas.width = Math.ceil(1024 * dpr); this.atlas.height = Math.ceil((y + rowHeight) * dpr);
      atlasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const entry of entries) this.paint(atlasContext, entry);
    }
    this.artworkBuilds++;
  }

  paint(context, entry) {
    context.font = `700 ${entry.fontSize}px ${FONT}`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.lineJoin = 'round'; context.lineWidth = this.haloWidth;
    context.strokeStyle = this.halo; context.fillStyle = this.inks[entry.level] ?? this.inks.town;
    entry.lines.forEach((text, line) => {
      const y = entry.y + 2 + (line + .5) * (entry.fontSize + 2);
      context.strokeText(text, entry.x + entry.width / 2, y);
      context.fillText(text, entry.x + entry.width / 2, y);
    });
  }

  draw(context) {
    const map = this.map;
    this.lastPlacements = [];
    if (this.disposed || !map.model || map.model.preferences.showPlaceNames === false || !this.labels.length) return;
    context.save();
    try {
      this.artwork(context, map.dpr ?? 1);
      if (this.panelsDirty) {
        const panels = placeLabelPanelBoxes(map.stage);
        const key = JSON.stringify(panels);
        if (key !== this.panelKey) { this.panelKey = key; this.panelBoxes = panels; this.fitOffset = null; }
        this.panelsDirty = false;
      }
      const scene = [map.cellStates, map.model.preferences, map.deathMarkers, map.deathMarkers.size,
        map.visibleTaskCounts, map.width, map.height, map.dpr, map.model.preferences.showTaskCounts,
        map.model.preferences.ids, map.model.preferences.highvis];
      if (!this.scene || scene.some((value, index) => value !== this.scene[index])) {
        this.scene = scene; this.layouts.clear(); this.annotationCells = taskCountAnnotationCells(map);
      }
      const detail = map.zoom < .16 ? 0 : map.zoom < .65 ? 1 : 2;
      if (this.selectionSource !== this.labels) {
        this.selectionSource = this.labels;
        this.selections = [.1, .35, 1].map(zoom => {
          const points = new Set();
          return selectPlaceLabels(this.labels, zoom).filter(label => {
            const key = `${label.x},${label.y}`;
            if (points.has(key)) return false;
            points.add(key); return true;
          });
        });
      }
      const tier = `${detail}:${placeLabelZoom(map.zoom)}`;
      let layout = this.layouts.get(tier);
      if (!layout) {
        const referenceZoom = placeLabelZoom(map.zoom);
        // Cache projected glyph rectangles per tier. Collision fitting below
        // indexes only nearby names at the actual zoom, including count badges.
        const placements = this.selections[detail].map(label => {
          const { glyph } = this.sprites.get(label.id);
          return { glyph, x: glyph.anchorX * referenceZoom - glyph.width / 2,
            y: glyph.anchorY * referenceZoom - glyph.height / 2, width: glyph.width, height: glyph.height };
        });
        if (this.layouts.size >= 8) this.layouts.delete(this.layouts.keys().next().value);
        layout = { zoom: referenceZoom, placements };
        this.layouts.set(tier, layout); this.layoutBuilds++;
      }
      const worldChanged = this.obstacleZoom !== map.zoom || this.obstacleScene !== this.scene;
      const movingZoom = this.lastZoom !== undefined && this.lastZoom !== map.zoom;
      this.lastZoom = map.zoom;
      const viewMoved = !this.fitOffset || Math.abs(map.offset.x - this.fitOffset.x) > 128
        || Math.abs(map.offset.y - this.fitOffset.y) > 128;
      if (worldChanged || viewMoved || this.fitMoving && !movingZoom) {
        const badgeCache = map.taskCountRenderer?.cache;
        if (worldChanged) {
          const cached = map.taskCountScene;
          const obstacles = cached?.key?.[0] === map.cellStates && cached.key[1] === map.model.preferences
            && cached.key[2] === map.zoom && cached.key[3] === map.deathMarkers && cached.key[4] === map.deathMarkers.size
            ? cached.obstacles : taskCountObstacles(map, this.geometry, this.annotationCells);
          // Reuse the count renderer's index without adding label-only geometry to it.
          const annotationIndex = badgeCache?.zoom === map.zoom && badgeCache.obstacleKey === obstacles
            ? badgeCache.obstacleIndex : new RectangleIndex();
          if (annotationIndex !== badgeCache?.obstacleIndex) for (const rect of obstacles) annotationIndex.add(annotationPadding(rect));
          this.obstacleIndex = { blocked: rect => annotationIndex.blocked(rect) || this.chunkIndex.blocked(rect) };
          this.obstacleZoom = map.zoom; this.obstacleScene = this.scene;
        }
        const ratio = map.zoom / layout.zoom;
        // Wheel frames fit only near the visible view. The first stable frame
        // restores the wider pan margin before any cached translation.
        const padding = movingZoom ? 48 : 192;
        const bounds = { x: -map.offset.x - padding, y: -map.offset.y - padding,
          width: map.width + padding * 2, height: map.height + padding * 2 }, nearby = [];
        for (const entry of layout.placements) {
          const x = (entry.x + entry.width / 2) * ratio - entry.width / 2;
          const y = (entry.y + entry.height / 2) * ratio - entry.height / 2;
          if (x - 80 >= bounds.x + bounds.width || y - 80 >= bounds.y + bounds.height
            || x + entry.width + 80 <= bounds.x || y + entry.height + 80 <= bounds.y) continue;
          nearby.push({ ...entry.glyph, x, y });
        }
        // Border and colour rectangles are needed only inside this cached pan
        // margin; distant coloured cells never allocate collision buckets.
        const chunks = placeLabelChunkObstacles(map, bounds);
        this.chunkIndex = new RectangleIndex(); this.unlockedIndex = new RectangleIndex();
        for (const rect of chunks.hard) this.chunkIndex.add(annotationPadding(rect));
        for (const rect of chunks.unlocked) this.unlockedIndex.add(rect);
        this.badgeIndex = new BadgeObstacleIndex();
        if (nearby.length && map.model.preferences.showTaskCounts !== false
          && badgeCache?.counts === (map.visibleTaskCounts ?? map.taskCounts)) {
          // Include every possible adjusted name, with extra collision padding.
          // Distant badges cannot affect this fit and need no bucket allocation.
          const left = Math.min(...nearby.map(entry => entry.x)) - 88;
          const top = Math.min(...nearby.map(entry => entry.y)) - 88;
          const right = Math.max(...nearby.map(entry => entry.x + entry.width)) + 88;
          const bottom = Math.max(...nearby.map(entry => entry.y + entry.height)) + 88;
          const envelope = { x: left, y: top, width: right - left, height: bottom - top };
          for (const rect of badgeCache.placements) if (intersects(envelope, rect) || placeLabelLeaderIntersects(envelope, rect)) this.badgeIndex.addBadge(rect);
        }
        // Current viewport repairs and floating panels join the cached fit.
        for (const rect of map.model.preferences.showTaskCounts === false ? [] : map.taskCountPlacements ?? []) {
          this.badgeIndex.addBadge({ ...rect, x: rect.x - map.offset.x, y: rect.y - map.offset.y,
            source: rect.source && { x: rect.source.x - map.offset.x, y: rect.source.y - map.offset.y } });
        }
        for (const rect of this.panelBoxes) this.badgeIndex.add(annotationPadding({ ...rect,
          x: rect.x - map.offset.x, y: rect.y - map.offset.y }));
        this.placements = fitPlaceLabels(nearby, this.obstacleIndex, this.badgeIndex, { unlockedIndex: this.unlockedIndex, bounds });
        this.fitOffset = { ...map.offset }; this.fitMoving = movingZoom; this.fitBuilds++;
      }
      const badges = map.model.preferences.showTaskCounts === false ? [] : map.taskCountPlacements ?? [];
      for (const entry of this.placements) {
        const { x, y } = entry;
        const screenX = x + map.offset.x, screenY = y + map.offset.y;
        if (screenX < 0 || screenY < 0 || screenX + entry.width > map.width || screenY + entry.height > map.height) continue;
        const rect = { ...entry, x: screenX, y: screenY }, clearance = padded(rect);
        if (badges.some(badge => intersects(clearance, badge) || placeLabelLeaderIntersects(clearance, badge))
          || this.panelBoxes.some(panel => intersects(clearance, panel))) continue;
        const sprite = this.sprites.get(entry.id);
        if (this.atlas && sprite && context.drawImage) {
          const dpr = this.artworkDpr;
          context.drawImage(this.atlas, sprite.x * dpr, sprite.y * dpr, sprite.width * dpr, sprite.height * dpr,
            Math.round(rect.x * dpr) / dpr, Math.round(rect.y * dpr) / dpr, rect.width, rect.height);
        } else this.paint(context, rect);
        this.lastPlacements.push(rect);
      }
    } finally { context.restore(); }
  }

  dispose() {
    this.disposed = true;
    this.panelResize?.disconnect(); this.panelMutation?.disconnect();
    this.panelHost?.removeEventListener('toggle', this.panelChanged, true);
    this.panelHost?.removeEventListener('scroll', this.panelChanged, true);
    if (this.atlas) this.atlas.width = this.atlas.height = 0;
    this.atlas = null; this.layouts.clear(); this.metrics.clear(); this.sprites.clear();
    this.labels = this.lastPlacements = []; this.map = this.geometry = this.scene = null;
    this.obstacleScene = this.obstacleIndex = this.annotationCells = this.obstacleZoom = this.placements = null;
    this.badgeIndex = this.fitOffset = null;
    this.lastZoom = this.fitMoving = null;
    this.selectionSource = this.selections = null;
    this.panelHost = this.panelChanged = this.panelResize = this.panelMutation = this.observePanels = null;
    this.panelBoxes = []; this.chunkIndex = this.unlockedIndex = this.artworkSource = null;
  }
}
