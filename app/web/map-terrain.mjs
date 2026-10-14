import { SURFACE_GRID, surfaceCoordinates } from '../data/surface-grid.mjs';

const CELL = 128;
const WIDTH = SURFACE_GRID.columns * CELL, HEIGHT = SURFACE_GRID.rows * CELL;
const PAGE_CELLS = 4, PAGE = CELL * PAGE_CELLS, NATIVE_DENSITY = 2;
const MIN_REGION_X = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride);
const MAX_REGION_Y = SURFACE_GRID.startId % SURFACE_GRID.stride;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const TERRAIN_LEVELS = Object.freeze([0.0625, 0.125, 0.25, 0.5]);
export const TERRAIN_OVERVIEW_MAX_ZOOM = 0.75;

/** Prefer one composed overview through intermediate scale, then native detail. */
export function terrainLevelForZoom(zoom, dpr = 1) {
  if (zoom > TERRAIN_OVERVIEW_MAX_ZOOM) return null;
  return TERRAIN_LEVELS.find(level => level >= Math.min(0.5, zoom * dpr)) ?? 0.5;
}

const defaultCanvas = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height; return canvas;
};
const defaultRequestFrame = callback => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  callback(); return null;
};
const defaultCancelFrame = id => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
};

/** Reject near-empty source placeholders, preserving normal dark roofs/walls. */
export function isBlankTerrainPixels(pixels) {
  if (!pixels?.length) return false;
  let black = 0, opaqueBlack = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] <= 3 && pixels[i + 1] <= 3 && pixels[i + 2] <= 3) {
      black++; if (pixels[i + 3] >= 250) opaqueBlack++;
    }
  }
  return black / (pixels.length / 4) >= 0.97 && opaqueBlack / (pixels.length / 4) >= 0.6;
}

/** Precomposed colour/gray mip chain plus bounded native tiles. A complete
 * current layout uses shared ocean; older partial manifests retain their image.
 */
export class MapTerrain {
  constructor(manifest, { changed = () => {}, imageFactory = () => new Image(), canvasFactory = defaultCanvas,
    cacheLimit = 256, concurrency = 6, fallbackImage = null, waitForFallback = false,
    requestFrame = defaultRequestFrame, cancelFrame = defaultCancelFrame } = {}) {
    this.changed = changed; this.imageFactory = imageFactory; this.canvasFactory = canvasFactory;
    this.cacheLimit = cacheLimit; this.concurrency = concurrency;
    this.waitForFallback = waitForFallback;
    this.tiles = new Map(); this.tileSources = new Map(); this.sourceIndexes = new Map();
    this.images = new Map(); this.lockedImages = new Map(); this.previews = new Map();
    this.failed = new Set(); this.pending = new Map(); this.queue = new Map(); this.nativeKeys = new Set();
    this.levels = new Map(); this.pages = new Map(); this.pageLimit = Math.max(1, Math.floor(cacheLimit / (PAGE_CELLS ** 2)));
    this.nativePages = new Set(); this.disposed = false;
    this.requestFrame = requestFrame; this.cancelFrame = cancelFrame;
    this.pageQueue = new Set(); this.updateFrame = null; this.pageWorkScheduled = false;
    this.visibleKeys = new Set(); this.unpublishedKeys = new Set(); this.committedKeys = new Set();
    this.chunkListeners = new Map();
    this.chunkImages = new Map();
    this.overviewPages = new Map(); this.overviewByTile = new Map();
    this.overviewQueue = new Map(); this.overviewPending = new Map(); this.overviewFailed = new Set();
    this.overviewWanted = new Set();
    this.pageVersions = new Map(); this.stagedPages = new Map();
    this.nativePageKeys = new Map();
    this.unreadyVisible = new Set(); this.unreadyNative = new Set();
    this.previewQueue = new Set(); this.stagedPreviews = new Map();
    const current = manifest?.cacheTerrain;
    const baseColour = current?.oceanColour ?? (/^#[0-9a-f]{6}$/i.test(current?.oceanColor ?? '')
      ? [1, 3, 5].map(index => parseInt(current.oceanColor.slice(index, index + 2), 16)) : null);
    this.modernBase = current?.mapId === 28 && current.plane === 0 && current.zoom === 2
      && current.iconFree === true && current.layoutComplete === true && current.transparentWater === true
      && /^terrain\.cache-[a-zA-Z0-9_-]+\/28\/2$/.test(current.directory ?? '')
      && baseColour?.length === 3
      && baseColour.every(c => Number.isInteger(c) && c >= 0 && c <= 255);
    if (this.modernBase) this.oceanColour = `rgb(${baseColour.join(',')})`;
    const addSource = (source, cache = false) => {
      if (source?.zoom !== 2 || source.mapId !== 28 || source.plane !== 0) return;
      if (cache && (source.iconFree !== true || !/^terrain\.cache-[a-zA-Z0-9_-]+\/28\/2$/.test(source.directory ?? ''))) return;
      for (const tile of source.tiles ?? []) {
        if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || ['missing', 'empty'].includes(tile.status)) continue;
        if (cache && tile.status !== 'rendered') continue;
        if (tile.x < MIN_REGION_X || tile.x >= MIN_REGION_X + SURFACE_GRID.columns
          || tile.y < MAX_REGION_Y - SURFACE_GRID.rows + 1 || tile.y > MAX_REGION_Y) continue;
        const directory = cache ? source.directory : 'terrain/28/2';
        if (tile.path !== `${directory}/0_${tile.x}_${tile.y}.png`) continue;
        const key = `${tile.x},${tile.y}`;
        if (!this.tileSources.has(key)) this.tileSources.set(key, []);
        this.tileSources.get(key).push(tile);
        if (!this.tiles.has(key)) this.tiles.set(key, tile);
      }
    };
    // The preferred community artwork wins. Cache renders fill omitted slots
    // and replace failed/near-empty community placeholders before the old map.
    addSource(manifest?.terrain);
    addSource(manifest?.cacheTerrain, true);
    const optimized = manifest?.optimizedTerrain;
    if (this.modernBase && optimized?.available !== false && optimized?.schemaVersion === 1
      && optimized.mapId === 28 && optimized.plane === 0 && optimized.tileSize === 256
      && /^terrain\.optimized-[a-zA-Z0-9_-]+-[a-f0-9]{12,}$/.test(optimized.directory ?? '')) {
      const validPath = path => typeof path === 'string' && path.startsWith(`${optimized.directory}/`)
        && /^terrain\.optimized-[\w-]+\/(?:[\w.-]+\/)*[\w.-]+\.webp$/.test(path)
        && !path.split('/').some(part => part === '.' || part === '..');
      for (const tile of optimized.tiles ?? []) {
        const key = `${tile.x},${tile.y}`;
        if (!this.tiles.has(key) || !validPath(tile.path) || tile.width !== 256 || tile.height !== 256) continue;
        const source = { ...tile, certified: true };
        this.tileSources.get(key).unshift(source); this.tiles.set(key, source);
      }
      for (const page of optimized.pages ?? []) {
        if (!Number.isInteger(page.x) || !Number.isInteger(page.y) || page.x < 0 || page.y < 0
          || page.left !== page.x * PAGE || page.top !== page.y * PAGE || page.width !== PAGE || page.height !== PAGE
          || page.pixelWidth !== 256 || page.pixelHeight !== 256 || !validPath(page.path) || !Array.isArray(page.regions)) continue;
        const key = `${page.x},${page.y}`, regions = page.regions.map(region => `${region.x},${region.y}`)
          .filter(region => this.tiles.has(region) && this.pageKey(region) === key);
        if (!regions.length) continue;
        this.overviewPages.set(key, { ...page, regions });
        for (const region of regions) this.overviewByTile.set(region, key);
      }
    }
    this.oceanKeys = new Set();
    const ocean = manifest?.oceanFallback, cache = manifest?.cacheTerrain;
    if (!this.modernBase && ocean?.version === 1 && ocean.mapId === 28 && ocean.plane === 0
      && ocean.method === 'uniform-legacy-water-without-cache-surface'
      && ocean.colour?.length === 3 && ocean.colour.every(c => Number.isInteger(c) && c >= 0 && c <= 255)
      && cache?.mapId === 28 && cache.plane === 0 && cache.iconFree === true) {
      const cacheRegions = new Set((cache.tiles ?? []).map(t => `${t.x},${t.y}`));
      const landRegions = new Set((ocean.legacyLandRegions ?? []).map(t => `${t.x},${t.y}`));
      this.oceanColour = `rgb(${ocean.colour.join(',')})`;
      for (const { x, y } of ocean.regions ?? []) if (Number.isInteger(x) && Number.isInteger(y)
        && x >= MIN_REGION_X && x < MIN_REGION_X + SURFACE_GRID.columns
        && y > MAX_REGION_Y - SURFACE_GRID.rows && y <= MAX_REGION_Y
        && !cacheRegions.has(`${x},${y}`) && !landRegions.has(`${x},${y}`)) this.oceanKeys.add(`${x},${y}`);
    }
    if (!this.tiles.size && !this.oceanKeys.size && !this.modernBase) return;
    for (const scale of TERRAIN_LEVELS) {
      const colour = canvasFactory(WIDTH * scale, HEIGHT * scale), gray = canvasFactory(WIDTH * scale, HEIGHT * scale);
      if (colour && gray) this.levels.set(scale, { colour, gray });
    }
    if (fallbackImage) this.setFallback(fallbackImage);
    else if (this.modernBase) { this.waitForFallback = false; this.composeBase(); }
  }

  get baseReady() { return !!this.fallbackImage || this.modernBase; }

  setFallback(image) {
    if (this.disposed || !image || image === this.fallbackImage) return;
    this.fallbackImage = image;
    this.waitForFallback = false;
    this.composeBase();
  }

  composeBase() {
    const largest = this.levels.get(0.5);
    if (largest) {
      const colour = largest.colour.getContext('2d'), gray = largest.gray.getContext('2d');
      colour.clearRect(0, 0, largest.colour.width, largest.colour.height);
      this.paintLegacyRegion(colour, 0, 0, WIDTH, HEIGHT, 0, 0, WIDTH * 0.5, HEIGHT * 0.5);
      gray.clearRect(0, 0, largest.gray.width, largest.gray.height); gray.filter = 'grayscale(0.6)';
      gray.drawImage(largest.colour, 0, 0); gray.filter = 'none';
      for (const [scale, level] of this.levels) if (scale !== 0.5) for (const mode of ['colour', 'gray']) {
        const canvas = level[mode], ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(largest[mode], 0, 0, WIDTH * scale, HEIGHT * scale);
      }
    }
    for (const key of this.committedKeys) this.updateLevels(key, this.previews.get(key));
    // A late original-image load changes every native page's transparent underlay.
    for (const page of this.pages.values()) this.releasePage(page);
    this.pages.clear();
    for (const page of this.stagedPages.values()) this.releasePage(page);
    this.stagedPages.clear();
    for (const page of this.stagedPreviews.values()) this.releasePage(page);
    this.stagedPreviews.clear(); this.previewQueue.clear();
    this.prepareView();
    this.changed();
    this.notifyChunkListeners();
  }

  setFallbackUnavailable() {
    if (this.disposed) return;
    this.waitForFallback = false;
    for (const key of this.visibleKeys) this.request(key, false);
    for (const key of this.chunkListeners.keys()) this.request(key, false);
    this.pump(); this.prepareView(); this.changed();
    this.notifyChunkListeners();
  }

  setView(bounds, zoom, dpr = 1) {
    const visible = [];
    const native = terrainLevelForZoom(zoom, dpr) === null;
    this.eachTile(bounds, (key, left, top) => {
      if (this.tiles.has(key)) visible.push({ key, page: native ? `${Math.floor(left / PAGE)},${Math.floor(top / PAGE)}` : null,
        distance: Math.hypot(left + CELL / 2 - (bounds.left + bounds.right) / 2,
        top + CELL / 2 - (bounds.top + bounds.bottom) / 2) });
    });
    // Enqueue the whole viewport before starting loads, at every zoom. Warm
    // overviews need no sort; cold loads and native page selection start centrally.
    if (native || visible.some(({ key }) => !this.previews.has(key) && !this.failed.has(key))) {
      visible.sort((a, b) => a.distance - b.distance);
    }
    this.visibleKeys = new Set(visible.map(({ key }) => key));
    this.unreadyVisible = new Set(visible.filter(({ key }) => !this.previews.has(key) && !this.failed.has(key)).map(({ key }) => key));
    this.nativePages = new Set();
    // High-density views spend more pixels per blit. Keep nearby detail within
    // eight pages there; the composed overview covers the remaining viewport.
    const viewPageLimit = dpr > 1 ? Math.min(8, this.pageLimit) : this.pageLimit;
    if (native) for (const tile of visible) {
      const page = tile.page;
      if (this.nativePages.size < viewPageLimit || this.nativePages.has(page)) this.nativePages.add(page);
    }
    const selected = native ? visible.filter(tile => this.nativePages.has(tile.page)).slice(0, this.cacheLimit) : [];
    this.nativeKeys = new Set(selected.map(tile => tile.key));
    this.nativePageKeys = new Map();
    for (const tile of selected) {
      if (!this.nativePageKeys.has(tile.page)) this.nativePageKeys.set(tile.page, new Set());
      this.nativePageKeys.get(tile.page).add(tile.key);
    }
    this.unreadyNative = new Set([...this.nativeKeys].filter(key => !this.images.has(key) && !this.failed.has(key)));
    for (const key of this.nativePages) if (this.pages.has(key)) {
      const page = this.pages.get(key); this.pages.delete(key); this.pages.set(key, page);
    }
    for (const key of this.pageQueue) if (!this.nativePages.has(key)) this.pageQueue.delete(key);
    for (const [key, page] of this.stagedPages) if (!this.nativePages.has(key) || !this.pageCurrent(key, page)) {
      this.releasePage(page); this.stagedPages.delete(key);
    }
    for (const key of this.nativePages) this.queuePage(key);
    // Protect the current viewport before newly loaded tiles evict old entries.
    for (const key of this.nativeKeys) if (this.images.has(key)) {
      const image = this.images.get(key); this.images.delete(key); this.images.set(key, image);
    }
    this.queue.clear();
    this.overviewQueue.clear();
    this.requestDistances = new Map(visible.map(({ key, distance }) => [key, distance]));
    this.overviewWanted = new Set(visible.filter(({ key }) => !this.nativeKeys.has(key) && !this.previews.has(key)
      && !this.overviewFailed.has(this.overviewByTile.get(key))).map(({ key }) => this.overviewByTile.get(key)).filter(Boolean));
    for (const [key, image] of this.pending) if (!this.chunkListeners.has(key)
      && (!this.visibleKeys.has(key) || (!this.nativeKeys.has(key)
        && (this.previews.has(key) || this.overviewWanted.has(this.overviewByTile.get(key)))))) this.cancelLoad(this.pending, key, image);
    for (const [key, image] of this.overviewPending) if (!this.overviewWanted.has(key)) this.cancelLoad(this.overviewPending, key, image);
    // The original is the first complete base. Do not compete with its decode
    // or expose individual tiles over an empty canvas while it is loading.
    if (!this.waitForFallback) {
      for (const { key } of visible) {
        const page = this.overviewByTile.get(key);
        if (!this.nativeKeys.has(key) && this.overviewWanted.has(page)) this.overviewQueue.set(page, this.overviewPages.get(page));
        else this.request(key, false);
      }
      this.overviewQueue = new Map([...this.overviewQueue].sort(([, a], [, b]) =>
        Math.hypot(a.left + PAGE / 2 - (bounds.left + bounds.right) / 2, a.top + PAGE / 2 - (bounds.top + bounds.bottom) / 2)
        - Math.hypot(b.left + PAGE / 2 - (bounds.left + bounds.right) / 2, b.top + PAGE / 2 - (bounds.top + bounds.bottom) / 2)));
      this.overviewDistances = new Map([...this.overviewQueue].map(([key, page]) => [key,
        Math.hypot(page.left + PAGE / 2 - (bounds.left + bounds.right) / 2, page.top + PAGE / 2 - (bounds.top + bounds.bottom) / 2)]));
      for (const key of this.chunkListeners.keys()) this.request(key, false);
      this.pump();
    }
    this.prepareView();
  }

  eachTile(bounds, visit) {
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    const minColumn = clamp(Math.floor(bounds.left / CELL), 0, SURFACE_GRID.columns - 1);
    const maxColumn = clamp(Math.ceil(bounds.right / CELL) - 1, 0, SURFACE_GRID.columns - 1);
    const minRow = clamp(Math.floor(bounds.top / CELL), 0, SURFACE_GRID.rows - 1);
    const maxRow = clamp(Math.ceil(bounds.bottom / CELL) - 1, 0, SURFACE_GRID.rows - 1);
    for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
      visit(`${MIN_REGION_X + column},${MAX_REGION_Y - row}`, column * CELL, row * CELL);
    }
  }

  request(key, pump = true) {
    if (this.disposed || !this.tiles.has(key) || this.failed.has(key) || this.pending.has(key)
      || this.images.has(key) || (!this.nativeKeys.has(key) && this.chunkImages.has(key))
      || (this.previews.has(key) && !this.nativeKeys.has(key) && !this.chunkListeners.has(key))) return;
    if (this.nativeKeys.has(key)) this.unreadyNative.add(key);
    this.queue.set(key, this.tiles.get(key)); if (pump) this.pump();
  }

  cancelLoad(pending, key, image) {
    image.onload = image.onerror = null; pending.delete(key);
    // Removing the source aborts the browser image request. A decode already
    // underway also checks its pending identity before publishing anything.
    if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
    else image.src = '';
  }

  loadOverview(key, page) {
    const image = this.imageFactory(); image.decoding = 'async'; this.overviewPending.set(key, image);
    const finish = ready => {
      if (this.disposed || this.overviewPending.get(key) !== image) return;
      image.onload = image.onerror = null; this.overviewPending.delete(key);
      if (ready && image.naturalWidth === page.pixelWidth && image.naturalHeight === page.pixelHeight) {
        for (const region of page.regions) {
          if (this.previews.has(region)) continue;
          const [x, y] = region.split(',').map(Number), canvas = this.canvasFactory(64, 64);
          if (!canvas) { ready = false; break; }
          canvas.getContext('2d').drawImage(image, ((x - MIN_REGION_X) * CELL - page.left) * 0.5,
            ((MAX_REGION_Y - y) * CELL - page.top) * 0.5, 64, 64, 0, 0, 64, 64);
          this.previews.set(region, canvas); this.unpublishedKeys.add(region);
          this.unreadyVisible.delete(region);
          this.pageVersions.set(key, (this.pageVersions.get(key) ?? 0) + 1);
        }
      } else ready = false;
      if (!ready) {
        this.overviewFailed.add(key); this.overviewWanted.delete(key);
        for (const region of page.regions) if (this.visibleKeys.has(region)) this.request(region, false);
        this.prioritizeTiles();
      }
      this.pump(); this.prepareView(); this.notifyChunkListeners();
    };
    image.onload = () => {
      if (typeof image.decode === 'function') image.decode().then(() => finish(true), () => finish(false));
      else finish(true);
    };
    image.onerror = () => finish(false); image.src = `/assets/map/${page.path}`;
  }

  prioritizeTiles() {
    this.queue = new Map([...this.queue].sort(([a], [b]) =>
      (this.requestDistances?.get(a) ?? Infinity) - (this.requestDistances?.get(b) ?? Infinity)));
  }

  pump() {
    while (!this.disposed && this.pending.size + this.overviewPending.size < this.concurrency
      && (this.overviewQueue.size || this.queue.size)) {
      if (this.overviewQueue.size && (!this.queue.size
        || (this.overviewDistances?.get(this.overviewQueue.keys().next().value) ?? Infinity)
          <= (this.requestDistances?.get(this.queue.keys().next().value) ?? Infinity))) {
        const [key, page] = this.overviewQueue.entries().next().value; this.overviewQueue.delete(key);
        if (!this.overviewPending.has(key) && page.regions.some(region => !this.previews.has(region))) this.loadOverview(key, page);
        continue;
      }
      const [key, tile] = this.queue.entries().next().value; this.queue.delete(key);
      const image = this.imageFactory(); image.decoding = 'async'; this.pending.set(key, image);
      const finish = ready => {
        if (this.disposed || this.pending.get(key) !== image) return;
        image.onload = image.onerror = null; this.pending.delete(key);
        if (this.disposed) return;
        if (ready && image.naturalWidth === 256 && image.naturalHeight === 256) {
          const certified = tile.certified || tile.path.startsWith('terrain.cache-');
          const preview = certified ? this.previews.get(key) ?? this.preview(image, true) : this.preview(image, false);
          if (!preview) ready = false;
          else {
            if (!this.previews.has(key)) { this.previews.set(key, preview); this.unpublishedKeys.add(key); }
            if (this.chunkListeners.has(key)) {
              this.chunkImages.delete(key); this.chunkImages.set(key, image);
              while (this.chunkImages.size > 8) this.chunkImages.delete(this.chunkImages.keys().next().value);
            }
            if (this.nativeKeys.has(key)) {
              this.images.delete(key); this.images.set(key, image); this.lockedImages.delete(key);
              while (this.images.size > this.cacheLimit) {
                const evicted = this.images.keys().next().value; this.images.delete(evicted); this.lockedImages.delete(evicted);
              }
            }
            const pageKey = this.pageKey(key);
            this.pageVersions.set(pageKey, (this.pageVersions.get(pageKey) ?? 0) + 1);
          }
        } else ready = false;
        if (!ready) {
          const next = (this.sourceIndexes.get(key) ?? 0) + 1;
          const replacement = this.tileSources.get(key)?.[next];
          if (replacement) {
            this.sourceIndexes.set(key, next); this.tiles.set(key, replacement);
            this.queue.set(key, replacement);
            this.prioritizeTiles();
            this.pump(); this.prepareView(); return;
          }
          this.failed.add(key);
          if (this.oceanKeys.has(key)) {
            // A rejected/failed community source in a proven ocean cell settles
            // as water in the same atomic publication as the remaining tiles.
            const water = this.canvasFactory(64, 64);
            if (water) {
              const ctx = water.getContext('2d'); ctx.fillStyle = this.oceanColour; ctx.fillRect(0, 0, 64, 64);
              this.previews.set(key, water); this.unpublishedKeys.add(key);
              const pageKey = this.pageKey(key);
              this.pageVersions.set(pageKey, (this.pageVersions.get(pageKey) ?? 0) + 1);
            }
          }
        }
        this.unreadyVisible.delete(key); this.unreadyNative.delete(key);
        this.pump(); this.prepareView();
        this.notifyChunkListeners(key);
      };
      image.onload = () => {
        if (typeof image.decode === 'function') image.decode().then(() => finish(true), () => finish(false));
        else finish(true);
      };
      image.onerror = () => finish(false); image.src = `/assets/map/${tile.path}`;
    }
  }

  preview(image, cache = false) {
    // Inspect native pixels, since downsampling blurs the thin coloured edges
    // of a black placeholder and can make it evade the conservative threshold.
    if (!cache) this.probeCanvas ??= this.canvasFactory(256, 256);
    if (!cache && this.probeCanvas) {
      const probe = this.probeCanvas.getContext('2d', { willReadFrequently: true });
      if (probe.getImageData) {
        probe.clearRect(0, 0, 256, 256); probe.drawImage(image, 0, 0, 256, 256);
        if (isBlankTerrainPixels(probe.getImageData(0, 0, 256, 256).data)) return null;
      }
    }
    const canvas = this.canvasFactory(64, 64);
    if (!canvas) return image;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 64, 64);
    return canvas;
  }

  updateLevels(key, image) {
    const [x, y] = key.split(',').map(Number);
    const left = (x - MIN_REGION_X) * CELL, top = (MAX_REGION_Y - y) * CELL;
    for (const [scale, level] of this.levels) {
      for (const [canvas, filter] of [[level.colour, 'none'], [level.gray, 'grayscale(0.6)']]) {
        const ctx = canvas.getContext('2d');
        ctx.filter = filter;
        // Each preview is painted once. The fallback was already composed by
        // setFallback; leave it underneath the tile's transparent pixels.
        ctx.drawImage(image, left * scale, top * scale, CELL * scale, CELL * scale); ctx.filter = 'none';
      }
    }
  }

  pageKey(key) {
    const [x, y] = key.split(',').map(Number);
    return `${Math.floor((x - MIN_REGION_X) / PAGE_CELLS)},${Math.floor((MAX_REGION_Y - y) / PAGE_CELLS)}`;
  }

  releasePage(page) { page.colour.width = page.colour.height = page.gray.width = page.gray.height = 0; }

  viewLoaded() {
    return !this.unreadyVisible.size && !this.unreadyNative.size;
  }

  pageCurrent(key, page) {
    if (!page || page.version !== (this.pageVersions.get(key) ?? 0)) return false;
    for (const tileKey of this.nativePageKeys.get(key) ?? []) if (!this.failed.has(tileKey)
      && !page.nativeKeys.has(tileKey)) return false;
    return true;
  }

  prepareView() {
    if (this.disposed) return;
    for (const key of this.nativePages) this.queuePage(key);
    if (!this.viewLoaded()) return;
    if (this.baseReady && this.levels.size) for (const tileKey of this.unpublishedKeys) {
      const key = this.pageKey(tileKey), staged = this.stagedPreviews.get(key);
      if (staged?.version === this.pageVersions.get(key)) continue;
      if (staged) { this.releasePage(staged); this.stagedPreviews.delete(key); }
      this.previewQueue.add(key);
    }
    if (this.pageQueue.size || this.previewQueue.size) this.schedulePageWork();
    else this.publishView();
  }

  publishView() {
    if (!this.viewLoaded()) return;
    if (!this.stagedPages.size && !this.stagedPreviews.size && !this.unpublishedKeys.size) return;
    if (this.pageQueue.size || this.previewQueue.size) return;
    if (this.baseReady && this.levels.size) for (const key of this.nativePages) {
      if (!this.pageCurrent(key, this.stagedPages.get(key) ?? this.pages.get(key))) return;
    }
    for (const [key, page] of this.stagedPreviews) {
      // Offscreen completions may invalidate a staged patch between callbacks.
      if (page.version !== this.pageVersions.get(key)) { this.prepareView(); return; }
    }
    let changed = false;
    for (const [key, page] of this.stagedPages) {
      if (this.pages.has(key)) this.releasePage(this.pages.get(key));
      this.pages.delete(key); this.pages.set(key, page); changed = true;
    }
    this.stagedPages.clear();
    while (this.pages.size > this.pageLimit) {
      const key = [...this.pages.keys()].find(key => !this.nativePages.has(key));
      if (key === undefined) break;
      this.releasePage(this.pages.get(key)); this.pages.delete(key);
    }
    // Keep the displayed mip chain unchanged during loading. Publish decoded
    // previews and completed native pages in the same notification/frame.
    for (const page of this.stagedPreviews.values()) {
      for (const [scale, level] of this.levels) for (const mode of ['colour', 'gray']) {
        const ctx = level[mode].getContext('2d');
        ctx.clearRect(page.left * scale, page.top * scale, PAGE * scale, PAGE * scale);
        ctx.drawImage(page[mode], page.left * scale, page.top * scale, PAGE * scale, PAGE * scale);
      }
      this.releasePage(page);
    }
    this.stagedPreviews.clear();
    for (const key of this.unpublishedKeys) { this.committedKeys.add(key); changed = true; }
    this.unpublishedKeys.clear();
    if (changed) this.changed();
  }

  queuePage(key) {
    if (this.disposed || !this.baseReady || !this.levels.size || !this.nativePages.has(key)
      || this.pageCurrent(key, this.stagedPages.get(key) ?? this.pages.get(key))) return;
    this.pageQueue.add(key);
  }

  schedulePageWork() {
    if (this.disposed || this.pageWorkScheduled || (!this.pageQueue.size && !this.previewQueue.size) || !this.viewLoaded()) return;
    this.pageWorkScheduled = true;
    this.updateFrame = this.requestFrame(() => {
      this.updateFrame = null; this.pageWorkScheduled = false;
      if (this.disposed) return;
      const key = this.pageQueue.values().next().value;
      this.pageQueue.delete(key);
      // One composed page per callback keeps cold pans and tier crossings from
      // building an entire viewport inside its terrain draw. Mips fill the gap.
      if (this.nativePages.has(key) && this.viewLoaded()) {
        const page = this.nativePage(key);
        if (page) {
          if (this.stagedPages.has(key)) this.releasePage(this.stagedPages.get(key));
          this.stagedPages.set(key, page);
        } else this.nativePages.delete(key);
      } else if (this.viewLoaded() && this.previewQueue.size) {
        const key = this.previewQueue.values().next().value; this.previewQueue.delete(key);
        const patch = this.previewPage(key);
        if (patch) this.stagedPreviews.set(key, patch);
      }
      this.publishView();
      this.schedulePageWork();
    });
  }

  previewPage(key) {
    const density = 0.5, pixels = PAGE * density;
    const colour = this.canvasFactory(pixels, pixels), gray = this.canvasFactory(pixels, pixels);
    if (!colour || !gray) return null;
    const [column, row] = key.split(',').map(Number), left = column * PAGE, top = row * PAGE;
    const ctx = colour.getContext('2d'), base = this.levels.get(density).colour;
    // A private small patch carries the committed original/terrain underlay.
    ctx.drawImage(base, left * density, top * density, pixels, pixels, 0, 0, pixels, pixels);
    for (const tileKey of this.unpublishedKeys) if (this.pageKey(tileKey) === key) {
      const [x, y] = tileKey.split(',').map(Number);
      ctx.drawImage(this.previews.get(tileKey), ((x - MIN_REGION_X) * CELL - left) * density,
        ((MAX_REGION_Y - y) * CELL - top) * density, CELL * density, CELL * density);
    }
    const grayContext = gray.getContext('2d'); grayContext.filter = 'grayscale(0.6)';
    grayContext.drawImage(colour, 0, 0); grayContext.filter = 'none';
    return { colour, gray, left, top, version: this.pageVersions.get(key) ?? 0 };
  }

  nativePage(key) {
    const colour = this.canvasFactory(PAGE * NATIVE_DENSITY, PAGE * NATIVE_DENSITY);
    const gray = this.canvasFactory(PAGE * NATIVE_DENSITY, PAGE * NATIVE_DENSITY);
    if (!colour || !gray) return null;
    const [column, row] = key.split(',').map(Number), left = column * PAGE, top = row * PAGE;
    const page = { colour, gray, left, top, version: this.pageVersions.get(key) ?? 0, nativeKeys: new Set() };
    const colourContext = colour.getContext('2d');
    this.paintLegacyRegion(colourContext, left, top, PAGE, PAGE, 0, 0, PAGE * NATIVE_DENSITY, PAGE * NATIVE_DENSITY);
    for (let row = 0; row < PAGE_CELLS; row++) for (let column = 0; column < PAGE_CELLS; column++) {
      const preview = this.previews.get(`${MIN_REGION_X + column + left / CELL},${MAX_REGION_Y - row - top / CELL}`);
      if (preview) colourContext.drawImage(preview, column * CELL * NATIVE_DENSITY, row * CELL * NATIVE_DENSITY,
        CELL * NATIVE_DENSITY, CELL * NATIVE_DENSITY);
    }
    const grayContext = gray.getContext('2d'); grayContext.filter = 'grayscale(0.6)';
    grayContext.drawImage(colour, 0, 0); grayContext.filter = 'none';
    for (const [tileKey, image] of this.images) if (this.pageKey(tileKey) === key) {
      this.paintNativeTile(tileKey, image, page); page.nativeKeys.add(tileKey);
    }
    return page;
  }

  paintNativeTile(key, image, page = null) {
    if (!this.baseReady || !this.nativePages.has(this.pageKey(key))) return;
    page ??= this.pages.get(this.pageKey(key));
    if (!page) { this.queuePage(this.pageKey(key)); return; }
    const [x, y] = key.split(',').map(Number);
    const left = (x - MIN_REGION_X) * CELL, top = (MAX_REGION_Y - y) * CELL;
    const dx = (left - page.left) * NATIVE_DENSITY, dy = (top - page.top) * NATIVE_DENSITY;
    const colour = page.colour.getContext('2d'), gray = page.gray.getContext('2d'), pixels = CELL * NATIVE_DENSITY;
    colour.clearRect(dx, dy, pixels, pixels);
    this.paintLegacyRegion(colour, left, top, CELL, CELL, dx, dy, pixels, pixels);
    colour.drawImage(image, dx, dy, pixels, pixels);
    gray.clearRect(dx, dy, pixels, pixels); gray.filter = 'grayscale(0.6)';
    gray.drawImage(page.colour, dx, dy, pixels, pixels, dx, dy, pixels, pixels); gray.filter = 'none';
  }

  paintLegacyRegion(ctx, left, top, width, height, dx, dy, dw, dh) {
    // Exact map-28 pastes are the display authority. The baked image predates
    // those transforms (notably Anachronia), so its missing/alpha pixels would
    // reintroduce shifted islands and a second water colour at every scale.
    if (this.modernBase) {
      ctx.fillStyle = this.oceanColour;
      ctx.fillRect(dx, dy, dw, dh);
      return;
    }
    if (!this.fallbackImage) return;
    const sx = (this.fallbackImage.naturalWidth || this.fallbackImage.width) / WIDTH;
    const sy = (this.fallbackImage.naturalHeight || this.fallbackImage.height) / HEIGHT;
    ctx.drawImage(this.fallbackImage, left * sx, top * sy, width * sx, height * sy, dx, dy, dw, dh);
    if (this.oceanKeys.size) this.eachTile({ left, top, right: left + width, bottom: top + height }, (key, tileLeft, tileTop) => {
      if (!this.oceanKeys.has(key) || (this.tileSources.has(key) && !this.failed.has(key))) return;
      const x = Math.max(left, tileLeft), y = Math.max(top, tileTop);
      const right = Math.min(left + width, tileLeft + CELL), bottom = Math.min(top + height, tileTop + CELL);
      if (right <= x || bottom <= y) return;
      ctx.fillStyle = this.oceanColour;
      ctx.fillRect(dx + (x - left) * dw / width, dy + (y - top) * dh / height,
        (right - x) * dw / width, (bottom - y) * dh / height);
    });
  }

  /** A panel crop shares source selection and decoding with the main map. */
  drawChunk(context, chunkId, size = 256) {
    const point = surfaceCoordinates(chunkId);
    if (!point || this.disposed) return false;
    const key = `${MIN_REGION_X + point.x},${MAX_REGION_Y - point.y}`;
    this.paintLegacyRegion(context, point.x * CELL, point.y * CELL, CELL, CELL, 0, 0, size, size);
    const image = this.chunkImages.get(key) ?? this.images.get(key) ?? this.previews.get(key);
    if (image) context.drawImage(image, 0, 0, size, size);
    return !!image || this.modernBase || !!this.fallbackImage;
  }

  subscribeChunk(chunkId, redraw) {
    const point = surfaceCoordinates(chunkId);
    if (!point || this.disposed || typeof redraw !== 'function') return () => {};
    const key = `${MIN_REGION_X + point.x},${MAX_REGION_Y - point.y}`;
    if (!this.chunkListeners.has(key)) this.chunkListeners.set(key, new Set());
    const listeners = this.chunkListeners.get(key); listeners.add(redraw);
    this.request(key);
    return () => { listeners.delete(redraw); if (!listeners.size) this.chunkListeners.delete(key); };
  }

  notifyChunkListeners(key) {
    for (const [id, listeners] of this.chunkListeners) if (key === undefined || id === key) {
      for (const redraw of listeners) redraw();
    }
  }

  /** Both overview and native modes preserve the legacy underlay through gaps. */
  draw(context, bounds, { offset, zoom, dpr = 1, fallback, desaturated = false }) {
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    const scale = terrainLevelForZoom(zoom, dpr), level = this.levels.get(scale ?? 0.5);
    if (level && this.baseReady) {
      const density = scale ?? 0.5;
      context.drawImage(desaturated ? level.gray : level.colour, bounds.left * density, bounds.top * density,
        (bounds.right - bounds.left) * density, (bounds.bottom - bounds.top) * density,
        offset.x + bounds.left * zoom, offset.y + bounds.top * zoom,
        (bounds.right - bounds.left) * zoom, (bounds.bottom - bounds.top) * zoom);
      if (scale !== null) return;
      // Four-by-four native tile pages keep even intermediate zooms bounded.
      for (const key of this.nativePages) {
        const page = this.pages.get(key);
        if (!page) { this.queuePage(key); continue; }
        const left = Math.max(bounds.left, page.left), top = Math.max(bounds.top, page.top);
        const right = Math.min(bounds.right, page.left + PAGE), bottom = Math.min(bounds.bottom, page.top + PAGE);
        if (right <= left || bottom <= top) continue;
        context.drawImage(desaturated ? page.gray : page.colour,
          (left - page.left) * NATIVE_DENSITY, (top - page.top) * NATIVE_DENSITY,
          (right - left) * NATIVE_DENSITY, (bottom - top) * NATIVE_DENSITY,
          offset.x + left * zoom, offset.y + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
      }
      return;
    } else {
      if (desaturated) context.filter = 'grayscale(0.6)';
      fallback(context, bounds.left, bounds.top, bounds.right, bounds.bottom); context.filter = 'none';
      if (this.waitForFallback) return;
    }
    this.eachTile(bounds, (key, tileLeft, tileTop) => {
      let image = this.committedKeys.has(key) ? this.images.get(key) ?? this.previews.get(key) : null;
      if (!image) return;
      if (desaturated) {
        if (!this.lockedImages.has(key)) {
          const pixels = image.naturalWidth || image.width, canvas = this.canvasFactory(pixels, pixels);
          if (canvas) { const ctx = canvas.getContext('2d'); ctx.filter = 'grayscale(0.6)';
            ctx.drawImage(image, 0, 0); this.lockedImages.set(key, canvas);
            while (this.lockedImages.size > this.cacheLimit) this.lockedImages.delete(this.lockedImages.keys().next().value); }
        }
        image = this.lockedImages.get(key) ?? image;
      }
      const left = Math.max(bounds.left, tileLeft), top = Math.max(bounds.top, tileTop);
      const right = Math.min(bounds.right, tileLeft + CELL), bottom = Math.min(bounds.bottom, tileTop + CELL);
      const density = (image.naturalWidth || image.width) / CELL;
      context.drawImage(image, (left - tileLeft) * density, (top - tileTop) * density,
        (right - left) * density, (bottom - top) * density,
        offset.x + left * zoom, offset.y + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
    });
  }

  dispose() {
    this.disposed = true;
    this.chunkListeners.clear();
    this.chunkImages.clear();
    if (this.updateFrame !== null) this.cancelFrame(this.updateFrame);
    this.updateFrame = null; this.pageWorkScheduled = false; this.pageQueue.clear();
    for (const [key, image] of this.pending) this.cancelLoad(this.pending, key, image);
    for (const [key, image] of this.overviewPending) this.cancelLoad(this.overviewPending, key, image);
    this.overviewQueue.clear(); this.overviewPages.clear(); this.overviewByTile.clear(); this.overviewWanted.clear();
    this.pending.clear(); this.queue.clear(); this.images.clear(); this.lockedImages.clear(); this.previews.clear();
    for (const level of this.levels.values()) for (const canvas of [level.colour, level.gray]) canvas.width = canvas.height = 0;
    this.levels.clear(); this.fallbackImage = null;
    for (const page of this.pages.values()) this.releasePage(page);
    this.pages.clear();
    for (const page of this.stagedPages.values()) this.releasePage(page);
    this.stagedPages.clear(); this.visibleKeys.clear(); this.unpublishedKeys.clear(); this.committedKeys.clear(); this.pageVersions.clear();
    for (const page of this.stagedPreviews.values()) this.releasePage(page);
    this.stagedPreviews.clear(); this.previewQueue.clear(); this.unreadyVisible.clear(); this.unreadyNative.clear();
    this.nativePageKeys.clear();
    if (this.probeCanvas) this.probeCanvas.width = this.probeCanvas.height = 0;
    this.probeCanvas = null;
  }
}
