const CELL = 128;
const TIERS = Object.freeze({ easy: 1, medium: 2, hard: 4, elite: 8, master: 16, all: 31 });
const CASING = '#10131a';
export const ACTIVITY_CACHE_PADDING = 160;
export const ACTIVITY_ZOOM_REFRESH_MS = 90;
const defaultCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
};

function corners(context, x, y, size, inset) {
  const left = x + inset, top = y + inset, right = x + size - inset, bottom = y + size - inset;
  const arm = Math.min(14, (size - inset * 2) * .28);
  context.moveTo(left, top + arm); context.lineTo(left, top); context.lineTo(left + arm, top);
  context.moveTo(right - arm, top); context.lineTo(right, top); context.lineTo(right, top + arm);
  context.moveTo(right, bottom - arm); context.lineTo(right, bottom); context.lineTo(right - arm, bottom);
  context.moveTo(left + arm, bottom); context.lineTo(left, bottom); context.lineTo(left, bottom - arm);
}

/** Optional surface activities; compile records once, paint only inset outlines. */
export class MapActivityLayerRenderer {
  constructor({ canvasFactory = defaultCanvas, onInvalidate = () => {}, now = () => globalThis.performance?.now() ?? Date.now(),
    setTimeout: setTimer = globalThis.setTimeout, clearTimeout: clearTimer = globalThis.clearTimeout } = {}) {
    this.entries = [];
    this.visibleCounts = { clues: 0, slayer: 0 };
    this.canvasFactory = canvasFactory; this.onInvalidate = onInvalidate; this.now = now;
    this.setTimer = (callback, delay) => setTimer(callback, delay);
    this.clearTimer = id => clearTimer(id);
    this.modelVersion = 0; this.cache = null; this.zoomTimer = null; this.zoomDue = false; this.disposed = false;
  }

  /** cells is the map's Map<baseChunkId, {x, y}> in 128-unit grid coordinates. */
  setModel(model, cells) {
    this.releaseCache(); this.modelVersion++;
    this.entries = [];
    this.visibleCounts = { clues: 0, slayer: 0 };
    for (const [id, cell] of cells ?? []) {
      if (!Number.isFinite(cell?.x) || !Number.isFinite(cell?.y)) continue;
      let tiers = 0;
      for (const record of model?.clues?.get(id) ?? []) tiers |= TIERS[record.tier] ?? 0;
      const slayer = (model?.slayer?.get(id)?.length ?? 0) > 0;
      if (tiers || slayer) this.entries.push({ x: cell.x * CELL, y: cell.y * CELL, tiers, slayer });
    }
  }

  cancelZoomRefresh() {
    if (this.zoomTimer !== null) this.clearTimer(this.zoomTimer);
    this.zoomTimer = null; this.zoomDue = false;
  }

  releaseCache() {
    this.cancelZoomRefresh();
    if (this.cache) this.cache.canvas.width = this.cache.canvas.height = 0;
    this.cache = null;
  }

  /** Safe pans blit one padded bitmap; brief zooms reproject it before refresh. */
  draw(context, view, preferences = {}) {
    const counts = this.visibleCounts = { clues: 0, slayer: 0 };
    const tiers = TIERS[preferences.clueTier] ?? 0, slayer = preferences.showSlayer === true;
    if (this.disposed || (!tiers && !slayer) || !this.entries.length) { this.releaseCache(); return counts; }
    const { width, height, zoom, offset, dpr = 1 } = view;
    if (!(width > 0 && height > 0 && zoom > 0 && dpr > 0)
      || ![width, height, zoom, dpr, offset?.x, offset?.y].every(Number.isFinite)) return counts;
    const size = CELL * zoom;
    for (const entry of this.entries) {
      const x = entry.x * zoom + offset.x, y = entry.y * zoom + offset.y;
      if (x >= width || y >= height || x + size <= 0 || y + size <= 0) continue;
      if (entry.tiers & tiers) counts.clues++;
      if (slayer && entry.slayer) counts.slayer++;
    }
    if (!counts.clues && !counts.slayer) return counts;
    const cache = this.cache, ratio = cache ? zoom / cache.zoom : 1, pad = ACTIVITY_CACHE_PADDING;
    const density = Math.min(dpr, 1.5), theme = preferences.theme ?? 'dark';
    const compatible = cache && cache.modelVersion === this.modelVersion && cache.tiers === tiers && cache.slayer === slayer
      && cache.theme === theme && cache.width === width && cache.height === height && cache.dpr === dpr;
    const left = cache ? offset.x - ratio * (cache.offset.x + pad) : 0;
    const top = cache ? offset.y - ratio * (cache.offset.y + pad) : 0;
    const covered = cache && left <= 0 && top <= 0 && left + cache.paddedWidth * ratio >= width && top + cache.paddedHeight * ratio >= height;
    const projected = compatible && cache.zoom !== zoom && ratio >= .7 && ratio <= 1.4;
    const reusable = compatible && covered && !this.zoomDue && (cache.zoom === zoom || projected);
    if (!reusable) {
      this.releaseCache();
      const paddedWidth = width + pad * 2, paddedHeight = height + pad * 2;
      const canvas = this.canvasFactory(Math.ceil(paddedWidth * density), Math.ceil(paddedHeight * density));
      const ctx = canvas?.getContext('2d');
      if (!ctx) {
        if (canvas) canvas.width = canvas.height = 0;
        this.paint(context, view, preferences); return counts;
      }
      // Factory canvases are sized explicitly; a reused backing store cannot grow silently.
      canvas.width = Math.ceil(paddedWidth * density); canvas.height = Math.ceil(paddedHeight * density);
      ctx.setTransform(density, 0, 0, density, 0, 0); ctx.clearRect(0, 0, paddedWidth, paddedHeight);
      this.paint(ctx, { width: paddedWidth, height: paddedHeight, dpr: density, zoom,
        offset: { x: offset.x + pad, y: offset.y + pad } }, preferences, true);
      this.cache = { canvas, offset: { ...offset }, zoom, width, height, dpr, paddedWidth, paddedHeight,
        tiers, slayer, theme, modelVersion: this.modelVersion, builtAt: this.now(), lastDrawZoom: zoom };
    } else if (projected && (this.zoomTimer === null || cache.lastDrawZoom !== zoom)) {
      // Wheel motion keeps reprojecting; only a pause restores fixed CSS widths.
      this.cancelZoomRefresh(); cache.lastDrawZoom = zoom;
      this.zoomTimer = this.setTimer(() => {
        this.zoomTimer = null;
        if (this.disposed || this.cache !== cache) return;
        this.zoomDue = true; this.onInvalidate();
      }, ACTIVITY_ZOOM_REFRESH_MS);
    } else if (cache.zoom === zoom) { this.cancelZoomRefresh(); cache.lastDrawZoom = zoom; }
    const layer = this.cache, scale = zoom / layer.zoom;
    context.save();
    try {
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalAlpha = 1;
      context.drawImage(layer.canvas, offset.x - scale * (layer.offset.x + pad), offset.y - scale * (layer.offset.y + pad),
        layer.paddedWidth * scale, layer.paddedHeight * scale);
    } finally { context.restore(); }
    return counts;
  }

  /** Node/no-canvas fallback and cache composition share the same bounded paths. */
  paint(context, view, preferences = {}, allowSprites = false) {
    const tierMask = TIERS[preferences.clueTier] ?? 0;
    const showSlayer = preferences.showSlayer === true;
    const counts = { clues: 0, slayer: 0 };
    if ((!tierMask && !showSlayer) || !this.entries.length) return counts;
    const { width, height, zoom, offset, dpr = 1 } = view;
    if (!(width > 0 && height > 0 && zoom > 0 && dpr > 0)
      || ![width, height, zoom, dpr, offset?.x, offset?.y].every(Number.isFinite)) return counts;
    const size = CELL * zoom, visible = [];
    for (const entry of this.entries) {
      const clue = (entry.tiers & tierMask) !== 0, slayer = showSlayer && entry.slayer;
      if (!clue && !slayer) continue;
      const x = entry.x * zoom + offset.x, y = entry.y * zoom + offset.y;
      if (x >= width || y >= height || x + size <= 0 || y + size <= 0) continue;
      visible.push({ x, y, clue, slayer });
      if (clue) counts.clues++;
      if (slayer) counts.slayer++;
    }
    if (!visible.length) return counts;
    if (allowSprites && visible.length > 64 && this.paintSprites(context, visible, size, dpr, preferences)) return counts;
    context.save();
    try {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalAlpha = 1;
      context.lineJoin = 'round';
      context.lineDashOffset = 0;
      if (counts.clues) {
        context.lineCap = 'butt';
        context.setLineDash([]);
        context.beginPath();
        for (const cell of visible) if (cell.clue) corners(context, cell.x, cell.y, size, Math.min(5, size * .16));
        this.stroke(context, preferences.theme === 'light' ? '#15e5f0' : '#59f1ff');
      }
      if (counts.slayer) {
        context.lineCap = 'round';
        context.setLineDash([0, 5]);
        context.beginPath();
        for (const cell of visible) if (cell.slayer) {
          const inset = cell.clue ? Math.min(10, size * .34) : Math.min(5, size * .16);
          context.rect(cell.x + inset, cell.y + inset, size - inset * 2, size - inset * 2);
        }
        this.stroke(context, '#cb99ff');
      }
    } finally {
      context.restore();
    }
    return counts;
  }

  /** Dense bitmap composition rasterizes at most three tiny outline templates. */
  paintSprites(context, visible, size, dpr, preferences) {
    const sprites = new Map(), padding = 2;
    const pixels = Math.ceil((size + padding * 2) * dpr), side = pixels / dpr;
    try {
      for (const cell of visible) {
        const kind = Number(cell.clue) + Number(cell.slayer) * 2;
        if (sprites.has(kind)) continue;
        const canvas = this.canvasFactory(pixels, pixels);
        if (!canvas) return false;
        sprites.set(kind, canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        canvas.width = canvas.height = pixels;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, side, side); ctx.globalAlpha = 1;
        ctx.lineJoin = 'round'; ctx.lineDashOffset = 0;
        if (cell.clue) {
          ctx.lineCap = 'butt'; ctx.setLineDash([]); ctx.beginPath();
          corners(ctx, padding, padding, size, Math.min(5, size * .16));
          this.stroke(ctx, preferences.theme === 'light' ? '#15e5f0' : '#59f1ff');
        }
        if (cell.slayer) {
          const inset = cell.clue ? Math.min(10, size * .34) : Math.min(5, size * .16);
          ctx.lineCap = 'round'; ctx.setLineDash([0, 5]); ctx.beginPath();
          ctx.rect(padding + inset, padding + inset, size - inset * 2, size - inset * 2);
          this.stroke(ctx, '#cb99ff');
        }
      }
      context.save();
      try {
        context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalAlpha = 1;
        for (const cell of visible) {
          const kind = Number(cell.clue) + Number(cell.slayer) * 2;
          context.drawImage(sprites.get(kind), cell.x - padding, cell.y - padding, side, side);
        }
      } finally { context.restore(); }
      return true;
    } finally {
      // drawImage snapshots its source; composition retains only the viewport bitmap.
      for (const canvas of sprites.values()) canvas.width = canvas.height = 0;
    }
  }

  stroke(context, color) {
    context.strokeStyle = CASING; context.lineWidth = 3.5; context.stroke();
    context.strokeStyle = color; context.lineWidth = 1.5; context.stroke();
  }

  dispose() {
    this.disposed = true; this.releaseCache(); this.entries = [];
    this.visibleCounts = { clues: 0, slayer: 0 };
  }
}
