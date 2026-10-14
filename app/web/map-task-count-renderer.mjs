const CELL = 128;
const MIN_FONT = 11;
const GAP = 3;
const SEARCH_RINGS = 18;
const MAX_BADGES = 4096;
const FONT = 'Calibri, "Segoe UI", sans-serif';
const BITMAP_PADDING = 128;
const METRICS_LIMIT = 512;
const LAYOUT_ZOOM_STEP = Math.log(1.25);
const GLYPH_ATLAS_SIZE = 512;
const defaultCanvas = () => typeof document === 'undefined' ? null : document.createElement('canvas');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

// A bounded index also handles unusually large obstacle rectangles without
// filling thousands of buckets. All dimensions are CSS pixels at current zoom.
export class RectangleIndex {
  constructor() { this.buckets = new Map(); this.large = []; }
  add(rect) {
    const left = Math.floor(rect.x / 32), top = Math.floor(rect.y / 32);
    const right = Math.floor((rect.x + rect.width) / 32), bottom = Math.floor((rect.y + rect.height) / 32);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)
      || (right - left + 1) * (bottom - top + 1) > 256) { this.large.push(rect); return; }
    for (let column = 0; column <= right - left; column++) {
      const x = left + column;
      let rows = this.buckets.get(x);
      if (!rows) { rows = new Map(); this.buckets.set(x, rows); }
      for (let row = 0; row <= bottom - top; row++) {
        const y = top + row;
        let values = rows.get(y);
        if (!values) { values = []; rows.set(y, values); }
        values.push(rect);
      }
    }
  }
  blocked(rect) {
    // Inline the query padding: candidates do not allocate padded copies or
    // bucket-key arrays during the bounded callout search.
    const x = rect.x - GAP / 2, y = rect.y - GAP / 2;
    const farX = rect.x + rect.width + GAP / 2, farY = rect.y + rect.height + GAP / 2;
    for (const other of this.large) if (x < other.x + other.width && farX > other.x
      && y < other.y + other.height && farY > other.y) return true;
    const left = Math.floor(x / 32), top = Math.floor(y / 32);
    const right = Math.floor(farX / 32), bottom = Math.floor(farY / 32);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)
      || (right - left + 1) * (bottom - top + 1) > 256) return true;
    for (let column = 0; column <= right - left; column++) {
      const rows = this.buckets.get(left + column);
      if (!rows) continue;
      for (let row = 0; row <= bottom - top; row++) {
        const values = rows.get(top + row);
        if (!values) continue;
        for (const other of values) if (x < other.x + other.width && farX > other.x
          && y < other.y + other.height && farY > other.y) return true;
      }
    }
    return false;
  }
}

const padded = rect => ({ x: rect.x - GAP / 2, y: rect.y - GAP / 2,
  width: rect.width + GAP, height: rect.height + GAP });
const localNumber = value => Math.round(value * 1e5) / 1e5;
const validRect = rect => Number.isFinite(rect?.x) && Number.isFinite(rect?.y)
  && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;
const layoutZoom = zoom => Math.min(zoom, Math.exp(Math.log(.055)
  + Math.floor(Math.log(zoom / .055) / LAYOUT_ZOOM_STEP + 1e-10) * LAYOUT_ZOOM_STEP));
const projectPlacement = (entry, ratio) => ({ ...entry,
  x: (entry.x + entry.width / 2) * ratio - entry.width / 2,
  y: (entry.y + entry.height / 2) * ratio - entry.height / 2,
  source: { x: entry.source.x * ratio, y: entry.source.y * ratio },
});

/** Nearby badge rows share a crop; empty map pixels never enter a screen blit. */
function bitmapRegions(entries) {
  const bands = new Map();
  for (const entry of entries) {
    const band = Math.floor(entry.y / 64);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(entry);
  }
  const regions = [];
  for (const rows of bands.values()) {
    rows.sort((a, b) => a.x - b.x);
    let group = null;
    for (const entry of rows) {
      if (!group || entry.x > group.right + 128) {
        group = { x: entry.x - 1, y: entry.y - 1, right: entry.x + entry.width + 1,
          bottom: entry.y + entry.height + 1, entries: [] };
        regions.push(group);
      }
      group.entries.push(entry);
      group.y = Math.min(group.y, entry.y - 1);
      group.right = Math.max(group.right, entry.x + entry.width + 1);
      group.bottom = Math.max(group.bottom, entry.y + entry.height + 1);
    }
  }
  for (const region of regions) {
    region.x = Math.floor(region.x); region.y = Math.floor(region.y);
    region.width = Math.ceil(region.right) - region.x; region.height = Math.ceil(region.bottom) - region.y;
  }
  regions.sort((a, b) => b.height - a.height || b.width - a.width);
  const target = Math.ceil(Math.max(1, ...regions.map(region => region.width),
    Math.sqrt(regions.reduce((area, region) => area + region.width * region.height, 0))));
  let left = 0, top = 0, rowHeight = 0, width = 1;
  for (const region of regions) {
    if (left && left + region.width > target) { top += rowHeight + 2; left = 0; rowHeight = 0; }
    region.atlasX = left; region.atlasY = top;
    left += region.width + 2; rowHeight = Math.max(rowHeight, region.height); width = Math.max(width, left - 2);
  }
  return { regions, width, height: Math.max(1, top + rowHeight) };
}

const SEARCH_OFFSETS = [];
{
  for (let ring = 0; ring <= SEARCH_RINGS; ring++) {
    for (let row = -ring; row <= ring; row++) {
      const edge = Math.abs(row) === ring;
      const columns = edge ? Array.from({ length: ring * 2 + 1 }, (_, i) => i - ring) : [-ring, ring];
      for (const column of columns) SEARCH_OFFSETS.push(Object.freeze({ column, row }));
    }
  }
}
Object.freeze(SEARCH_OFFSETS);

/**
 * Paint cached positive counts, already limited to unlocked chunks by the caller.
 * cells is Map<chunkId, {x: column, y: row}>; obstacles are screen-coordinate
 * {x,y,width,height} rectangles covering existing labels, markers and owner tabs.
 * Replace counts/cells when their contents change, or advance sceneKey. Layout
 * is stored in zoomed world coordinates, so ordinary panning only translates it.
 * An immutable worldObstacles array avoids converting/signing screen obstacles
 * each frame; its rectangles use zoomed world pixels with no pan offset.
 * A sceneKey stable across zoom permits tiered layout reuse, while current
 * actual-zoom obstacles still validate every projected badge rectangle.
 */
export class MapTaskCountRenderer {
  constructor({ canvasFactory = defaultCanvas } = {}) {
    this.canvasFactory = canvasFactory;
    this.cache = this.bitmap = this.referenceLayout = this.glyphCache = null;
    this.textMetrics = new Map();
    this.orderedCandidates = null;
    this.lastDrawnZoom = null;
    this.layoutBuilds = this.bitmapBuilds = this.glyphBuilds = this.unplaced = 0;
  }

  clear() {
    if (this.bitmap?.canvas) this.bitmap.canvas.width = this.bitmap.canvas.height = 0;
    if (this.glyphCache?.canvas) this.glyphCache.canvas.width = this.glyphCache.canvas.height = 0;
    this.cache = this.bitmap = this.referenceLayout = this.orderedCandidates = this.glyphCache = null;
    this.lastDrawnZoom = null; this.textMetrics.clear(); this.unplaced = 0;
  }

  draw(context, { counts, cells, offset, zoom, width, height, scale = 1, obstacles = [], worldObstacles, sceneKey, dpr = 1 } = {}) {
    if (!(counts instanceof Map) || !(cells instanceof Map) || !counts.size
      || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(CELL * zoom) || !Number.isFinite(offset?.x) || !Number.isFinite(offset?.y)
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
    scale = Number.isFinite(scale) ? clamp(scale, .6, 2) : 1;
    dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const useWorld = Array.isArray(worldObstacles);
    const localObstacles = useWorld ? null : obstacles.filter(validRect)
      .map(rect => ({ x: localNumber(rect.x - offset.x), y: localNumber(rect.y - offset.y),
        width: localNumber(rect.width), height: localNumber(rect.height) }));
    const obstacleKey = useWorld ? worldObstacles : localObstacles.map(rect => `${rect.x},${rect.y},${rect.width},${rect.height}`).join(';');
    const cache = this.cache;
    if (!cache || cache.counts !== counts || cache.cells !== cells || cache.zoom !== zoom || cache.scale !== scale
      || cache.sceneKey !== sceneKey || cache.obstacleKey !== obstacleKey) {
      context.save();
      try {
        const geometry = useWorld ? worldObstacles.filter(validRect) : localObstacles;
        const obstacleIndex = new RectangleIndex();
        for (const rect of geometry) obstacleIndex.add(padded(rect));
        const referenceZoom = layoutZoom(zoom), ratio = zoom / referenceZoom;
        const layoutScene = sceneKey ?? obstacleKey;
        let reference = this.referenceLayout;
        const compatible = reference && reference.counts === counts && reference.cells === cells
          && reference.zoom === referenceZoom && reference.scale === scale && reference.sceneKey === layoutScene
          && reference.unplaced === 0;
        let placements = compatible ? reference.placements.map(entry => projectPlacement(entry, ratio)) : null;
        // Scaling centres apart while keeping glyph dimensions fixed preserves
        // badge/badge clearance. Existing labels may change size differently,
        // so their actual rectangles must still pass a fresh collision check.
        if (!placements || placements.some(entry => obstacleIndex.blocked(entry))) {
          const projectedObstacles = ratio === 1 ? geometry : geometry.map(rect => ({
            x: rect.x / ratio, y: rect.y / ratio, width: rect.width / ratio, height: rect.height / ratio,
          }));
          reference = this.referenceLayout = { counts, cells, zoom: referenceZoom, scale, sceneKey: layoutScene,
            placements: this.layout(context, counts, cells, referenceZoom, scale, projectedObstacles, layoutScene), unplaced: this.unplaced };
          placements = reference.placements.map(entry => projectPlacement(entry, ratio));
        } else this.unplaced = reference.unplaced;
        this.cache = { counts, cells, zoom, scale, sceneKey, obstacleKey,
          obstacleIndex, placements };
      } finally { context.restore(); }
    }
    const translated = this.cache.placements.map(entry => ({ ...entry, x: entry.x + offset.x, y: entry.y + offset.y,
      source: { x: entry.source.x + offset.x, y: entry.source.y + offset.y } }));
    const visible = this.fitViewport(translated, this.cache.obstacleIndex, width, height, CELL * zoom, offset);
    const movingZoom = this.lastDrawnZoom !== null && this.lastDrawnZoom !== zoom;
    this.lastDrawnZoom = zoom;
    if (!visible.length) return visible;
    context.save();
    try {
      context.globalAlpha = 1;
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(210,227,235,.55)';
      context.beginPath();
      for (const entry of visible) if (entry.callout) {
        context.moveTo(entry.source.x, entry.source.y);
        context.lineTo(clamp(entry.source.x, entry.x, entry.x + entry.width),
          clamp(entry.source.y, entry.y, entry.y + entry.height));
      }
      context.stroke();
      const rasterAvailable = typeof context.drawImage === 'function' && typeof context.clip === 'function';
      if (movingZoom && rasterAvailable && this.bitmap?.canvas) {
        // Zoom frames stamp only fitted, visible glyphs. Once actual zoom stops,
        // the normal grouped bitmap rebuilds once and serves subsequent pans.
        this.paintGlyphs(context, visible, this.badgeGlyphs(this.bitmap.canvas, dpr), dpr);
      } else if (rasterAvailable
        && this.drawBitmap(context, translated, { offset, width, height, dpr, padding: Math.max(BITMAP_PADDING, CELL * zoom) })) {
        const uncached = [];
        for (const entry of visible) if (entry.repaired) {
          const glyph = this.bitmap.glyphSources.get(entry.id);
          if (!glyph) { uncached.push(entry); continue; }
          const ratio = this.bitmap.dpr;
          context.drawImage(this.bitmap.canvas, glyph.x * ratio, glyph.y * ratio,
            glyph.width * ratio, glyph.height * ratio, Math.round((entry.x - 1) * ratio) / ratio,
            Math.round((entry.y - 1) * ratio) / ratio, glyph.width, glyph.height);
        }
        // An unusually distant callout can lie beyond the padded cache while
        // its source is on screen. Only that missing edge glyph uses fallback.
        if (uncached.length) this.paintBadges(context, uncached);
      } else this.paintBadges(context, visible);
    } finally { context.restore(); }
    return visible;
  }

  paintGlyphs(context, entries, glyphs, dpr) {
    const fallback = [];
    for (const entry of entries) {
      const sprite = glyphs?.sprites.get(`${entry.text}:${entry.width}:${entry.height}`);
      if (!sprite || !glyphs.canvas) { fallback.push(entry); continue; }
      context.drawImage(glyphs.canvas, sprite.x * dpr, sprite.y * dpr,
        sprite.width * dpr, sprite.height * dpr, Math.round((entry.x - 1) * dpr) / dpr,
        Math.round((entry.y - 1) * dpr) / dpr, sprite.width, sprite.height);
    }
    if (fallback.length) this.paintBadges(context, fallback);
  }

  paintBadges(context, entries) {
    context.globalAlpha = 1; context.lineWidth = 1;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (const entry of entries) {
      context.fillStyle = '#071017'; context.strokeStyle = 'rgba(210,227,235,.65)';
      context.beginPath();
      if (typeof context.roundRect === 'function') context.roundRect(entry.x, entry.y, entry.width, entry.height, 3);
      else context.rect(entry.x, entry.y, entry.width, entry.height);
      context.fill(); context.stroke();
      context.font = `bold ${entry.fontSize}px ${FONT}`;
      context.fillStyle = '#fff';
      // No maxWidth: digits never get silently compressed at overview zoom.
      context.fillText(entry.text, entry.x + entry.width / 2, entry.y + entry.height / 2 + entry.fontSize * .035);
    }
  }

  /** One current-font atlas bounds both raster memory and repeated text work. */
  badgeGlyphs(target, dpr) {
    const entries = this.cache.placements, fontSize = entries[0]?.fontSize, counts = this.cache.counts;
    let glyphs = this.glyphCache;
    if (glyphs && glyphs.counts === counts && glyphs.fontSize === fontSize && glyphs.dpr === dpr) return glyphs;
    const canvas = glyphs?.canvas ?? this.canvasFactory(Math.ceil(GLYPH_ATLAS_SIZE * dpr), Math.ceil(GLYPH_ATLAS_SIZE * dpr));
    const context = canvas && canvas !== target ? canvas.getContext?.('2d') : null;
    if (!context) return this.glyphCache = { counts, fontSize, dpr, canvas: null, sprites: new Map() };
    const size = Math.ceil(GLYPH_ATLAS_SIZE * dpr);
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, GLYPH_ATLAS_SIZE, GLYPH_ATLAS_SIZE);
    const unique = new Map();
    for (const entry of entries) unique.set(`${entry.text}:${entry.width}:${entry.height}`, entry);
    const sprites = new Map(), paint = [];
    let x = 0, y = 0, rowHeight = 0;
    for (const [key, entry] of [...unique].sort((a, b) => b[1].width - a[1].width)) {
      const width = Math.ceil((entry.width + 2) * dpr), height = Math.ceil((entry.height + 2) * dpr);
      if (width > size || height > size) continue;
      if (x + width > size) { x = 0; y += rowHeight + 1; rowHeight = 0; }
      if (y + height > size) continue;
      sprites.set(key, { x: x / dpr, y: y / dpr, width: width / dpr, height: height / dpr });
      paint.push({ ...entry, x: x / dpr + 1, y: y / dpr + 1 });
      x += width + 1; rowHeight = Math.max(rowHeight, height);
    }
    this.paintBadges(context, paint);
    this.glyphBuilds++;
    return this.glyphCache = { counts, fontSize, dpr, canvas, sprites };
  }

  drawBitmap(context, translated, { offset, width, height, dpr, padding }) {
    dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    let bitmap = this.bitmap;
    const compatible = bitmap && bitmap.layout === this.cache && bitmap.width === width && bitmap.height === height && bitmap.dpr === dpr;
    const cachedPadding = bitmap?.padding ?? padding;
    const left = offset.x - (bitmap?.offset.x ?? offset.x) - cachedPadding;
    const top = offset.y - (bitmap?.offset.y ?? offset.y) - cachedPadding;
    const covered = left <= 0 && top <= 0
      && left + width + cachedPadding * 2 >= width && top + height + cachedPadding * 2 >= height;
    if (!compatible || !covered) {
      const paddedBounds = { x: -padding, y: -padding,
        width: width + padding * 2, height: height + padding * 2 };
      const packed = bitmapRegions(translated.filter(entry => intersects(entry, paddedBounds)));
      for (const region of packed.regions) {
        region.atlasX = Math.round(region.atlasX * dpr) / dpr;
        region.atlasY = Math.round(region.atlasY * dpr) / dpr;
        region.width = Math.ceil(region.width * dpr) / dpr;
        region.height = Math.ceil(region.height * dpr) / dpr;
      }
      packed.width = Math.max(1, ...packed.regions.map(region => region.atlasX + region.width));
      packed.height = Math.max(1, ...packed.regions.map(region => region.atlasY + region.height));
      const canvas = bitmap?.canvas ?? this.canvasFactory(Math.ceil(packed.width * dpr), Math.ceil(packed.height * dpr));
      const bitmapContext = canvas?.getContext?.('2d');
      if (!bitmapContext) return false;
      // Keep one backing store while nearby zooms change crop geometry. Only
      // occupied crops are cleared/read; unused capacity never reaches a blit.
      if (canvas.width < Math.ceil(packed.width * dpr)) canvas.width = Math.ceil(packed.width * dpr);
      if (canvas.height < Math.ceil(packed.height * dpr)) canvas.height = Math.ceil(packed.height * dpr);
      bitmapContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      bitmapContext.clearRect(0, 0, packed.width, packed.height);
      const glyphs = typeof bitmapContext.drawImage === 'function' ? this.badgeGlyphs(canvas, dpr) : null;
      const glyphSources = new Map();
      for (const region of packed.regions) {
        for (const entry of region.entries) glyphSources.set(entry.id, {
          x: entry.x - region.x + region.atlasX - 1, y: entry.y - region.y + region.atlasY - 1,
          width: entry.width + 2, height: entry.height + 2,
        });
        const fallback = [];
        for (const entry of region.entries) {
          const x = entry.x - region.x + region.atlasX, y = entry.y - region.y + region.atlasY;
          const sprite = glyphs?.sprites.get(`${entry.text}:${entry.width}:${entry.height}`);
          if (!sprite) { fallback.push({ ...entry, x, y }); continue; }
          const left = Math.round((x - 1) * dpr) / dpr, top = Math.round((y - 1) * dpr) / dpr;
          bitmapContext.drawImage(glyphs.canvas, sprite.x * dpr, sprite.y * dpr,
            sprite.width * dpr, sprite.height * dpr, left, top, sprite.width, sprite.height);
          glyphSources.set(entry.id, { x: left, y: top, width: sprite.width, height: sprite.height });
        }
        if (fallback.length) this.paintBadges(bitmapContext, fallback);
        delete region.entries;
      }
      bitmap = this.bitmap = { canvas, regions: packed.regions, glyphSources, layout: this.cache, width, height, dpr, padding, offset: { ...offset } };
      this.bitmapBuilds++;
    }
    // A cached glyph crossing the viewport boundary would show partial digits.
    // Mask those originals; fitViewport moves on-screen sources and only their
    // replacement badges use cached glyph crops. The badge rectangles are
    // disjoint, so even-odd holes cannot toggle another badge back into view.
    const partial = translated.filter(entry => intersects(entry, { x: 0, y: 0, width, height })
      && (entry.x < 1 || entry.y < 1 || entry.x + entry.width > width - 1 || entry.y + entry.height > height - 1));
    context.save();
    try {
      if (partial.length) {
        context.beginPath(); context.rect(0, 0, width, height);
        for (const entry of partial) context.rect(entry.x - GAP / 2, entry.y - GAP / 2, entry.width + GAP, entry.height + GAP);
        context.clip('evenodd');
      }
      const dx = offset.x - bitmap.offset.x, dy = offset.y - bitmap.offset.y;
      for (const region of bitmap.regions) {
        const x = region.x + dx, y = region.y + dy;
        if (!intersects({ x, y, width: region.width, height: region.height }, { x: 0, y: 0, width, height })) continue;
        context.drawImage(bitmap.canvas, region.atlasX * dpr, region.atlasY * dpr,
          region.width * dpr, region.height * dpr, Math.round(x * dpr) / dpr,
          Math.round(y * dpr) / dpr, region.width, region.height);
      }
    } finally { context.restore(); }
    return true;
  }

  // Only clipped badges need a fresh bounded search. The world layout remains
  // cached, while a source near the viewport edge retains complete digits.
  fitViewport(entries, obstacleIndex, width, height, size, offset) {
    const bounds = { x: 0, y: 0, width, height }, visible = [], clipped = [];
    for (const entry of entries) {
      if (entry.x >= 1 && entry.y >= 1 && entry.x + entry.width <= width - 1 && entry.y + entry.height <= height - 1) {
        visible.push(entry);
      } else if (intersects({ x: entry.source.x - size / 2, y: entry.source.y - size / 2, width: size, height: size }, bounds)) {
        clipped.push(entry);
      }
    }
    if (!clipped.length) return visible;
    const index = new RectangleIndex();
    for (const entry of visible) index.add(padded(entry));
    for (const entry of clipped) {
      if (entry.width > width - 2 || entry.height > height - 2) continue;
      const originX = clamp(entry.x, 1, width - entry.width - 1);
      const originY = clamp(entry.y, 1, height - entry.height - 1);
      for (const { column, row } of SEARCH_OFFSETS) {
        const candidate = { ...entry, x: originX + column * (entry.width + GAP),
          y: originY + row * (entry.height + GAP), callout: true, repaired: true };
        if (candidate.x < 1 || candidate.y < 1 || candidate.x + candidate.width > width - 1
          || candidate.y + candidate.height > height - 1 || index.blocked(candidate)) continue;
        if (obstacleIndex.blocked({ ...candidate, x: candidate.x - offset.x, y: candidate.y - offset.y })) continue;
        visible.push(candidate); index.add(padded(candidate)); break;
      }
    }
    return visible;
  }

  layout(context, counts, cells, zoom, scale, obstacles, sceneKey) {
    this.layoutBuilds++;
    this.unplaced = 0;
    const index = new RectangleIndex();
    for (const rect of obstacles) index.add(padded(rect));
    const size = CELL * zoom, placements = [];
    const fontSize = Math.max(MIN_FONT, Math.min(15, Math.max(11, size * .09)) * scale);
    context.font = `bold ${fontSize}px ${FONT}`;
    let ordered = this.orderedCandidates;
    if (!ordered || ordered.counts !== counts || ordered.cells !== cells || ordered.sceneKey !== sceneKey) {
      const values = [];
      for (const [id, count] of counts) {
        const cell = cells.get(id);
        if (!Number.isSafeInteger(count) || count <= 0 || !Number.isFinite(cell?.x) || !Number.isFinite(cell?.y)) continue;
        values.push({ id, count, cell });
      }
      // Spatial order keeps neighboring callouts stable across equivalent count maps.
      values.sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x || String(a.id).localeCompare(String(b.id)));
      ordered = this.orderedCandidates = { counts, cells, sceneKey, values };
    }
    const candidates = ordered.values;
    for (const { id, count, cell } of candidates.slice(0, MAX_BADGES)) {
      const text = String(count), metricKey = `${fontSize}:${text}`;
      let measured = this.textMetrics.get(metricKey);
      if (measured === undefined) {
        measured = context.measureText?.(text)?.width;
        if (!Number.isFinite(measured)) measured = text.length * fontSize * .65;
        if (this.textMetrics.size >= METRICS_LIMIT) this.textMetrics.delete(this.textMetrics.keys().next().value);
        this.textMetrics.set(metricKey, measured);
      }
      const width = Math.ceil((Number.isFinite(measured) ? measured : text.length * fontSize * .65) + 8);
      const height = Math.ceil(fontSize + 6);
      const x = cell.x * size, y = cell.y * size;
      if (!Number.isFinite(x + size) || !Number.isFinite(y + size)) { this.unplaced++; continue; }
      const source = { x: x + size / 2, y: y + size / 2 };
      const inset = Math.min(5, size * .1);
      let rect = null, callout = false;
      if (width + inset * 2 <= size && height + inset * 2 <= size) {
        const inside = [
          { x: x + inset, y: y + inset },
          { x: x + inset, y: y + size - inset - height },
          { x: x + size - inset - width, y: y + inset },
          { x: x + size - inset - width, y: y + size - inset - height },
        ];
        rect = inside.map(point => ({ ...point, width, height })).find(candidate => !index.blocked(candidate)) ?? null;
      }
      if (!rect) {
        callout = true;
        // Search discrete expanding rings, never shrink the font or spin until
        // space appears. 1,369 attempts is a hard per-count upper bound.
        const stepX = width + GAP, stepY = height + GAP;
        const originX = source.x - width / 2, originY = y - height - GAP;
        const candidate = { x: 0, y: 0, width, height }, sourceRect = { x, y, width: size, height: size };
        for (const { column, row } of SEARCH_OFFSETS) {
          candidate.x = originX + column * stepX; candidate.y = originY + row * stepY;
          // A callout remains outside its source chunk even when a corner is free.
          if (intersects(candidate, sourceRect)) continue;
          if (index.blocked(candidate)) continue;
          rect = candidate; break;
        }
      }
      if (!rect) { this.unplaced++; continue; }
      const entry = { id, count, text, fontSize, source, callout, ...rect };
      placements.push(entry); index.add(padded(rect));
    }
    this.unplaced += Math.max(0, candidates.length - MAX_BADGES);
    return placements;
  }
}
