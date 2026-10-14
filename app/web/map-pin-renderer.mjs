import { pinMatchesSearch, normalizePinSearch } from './map-pins.mjs';
import { CACHE_PIN_SPRITE_DIRECTORY } from '../data/map-pins.mjs';
import { indexPinDetails } from './map-info.mjs';
import { resolvePicture, recordPictureFailure } from './art-status.mjs';

const CELL = 128;
const cacheSpritePath = new RegExp(`^/assets/map/${CACHE_PIN_SPRITE_DIRECTORY.replaceAll('.', '\\.')}\\/\\d+-0\\.png$`);
export const PIN_MIN_ZOOM = 0.5;
export const PIN_CACHE_PADDING = 160;
export const PIN_AGGREGATION_ZOOM = 1.5;
export const PIN_AGGREGATION_LIMIT = 256;
export const PIN_ZOOM_REFRESH_MS = 50;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const defaultCanvas = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height; return canvas;
};

/** Independent pin layer; filtering and highlighting never call the terrain renderer. */
export class MapPinRenderer {
  constructor(manifest, dataset, { changed = () => {}, imageFactory = () => new Image(), canvasFactory = defaultCanvas,
    now = () => performance.now(), setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
    this.categories = new Map((manifest.categories ?? []).map(category => [category.id, category]));
    this.pins = new Map();
    this.buckets = new Map();
    this.images = new Map();
    this.changed = changed;
    this.imageFactory = imageFactory;
    this.canvasFactory = canvasFactory;
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.zoomRefreshTimer = null; this.zoomRefreshDue = false;
    this.revision = 0;
    this.cache = null;
    this.filters = { categoryIds: [...this.categories.keys()], hiddenPinIds: [], search: '' };
    this.focused = null;
    this.disposed = false;
    this.details = indexPinDetails(dataset?.pinDetails);
    for (const pin of dataset?.pins ?? []) {
      if (typeof pin.id !== 'string' || !Number.isFinite(pin.worldX) || !Number.isFinite(pin.worldY)
        || pin.worldX < 0 || pin.worldX >= 6016 || pin.worldY < 0 || pin.worldY >= 6400
        || (pin.plane !== undefined && pin.plane !== 0) || (pin.mapId !== undefined && pin.mapId !== 28)) continue;
      this.pins.set(pin.id, pin);
      const bucket = `${Math.floor(pin.worldX / CELL)},${Math.floor(pin.worldY / CELL)}`;
      if (!this.buckets.has(bucket)) this.buckets.set(bucket, []);
      this.buckets.get(bucket).push(pin);
    }
    this.setFilters(this.filters);
  }

  setFilters(filters) {
    this.filters = { ...this.filters, ...filters };
    this.enabled = new Set(this.filters.categoryIds);
    this.hidden = new Set(this.filters.hiddenPinIds);
    this.query = normalizePinSearch(this.filters.search);
    this.revision++;
    this.visible = [];
    this.cancelZoomRefresh();
  }

  setDetails(catalogue) {
    this.details = indexPinDetails(catalogue);
  }

  detailFor(pinOrId) {
    return this.details.get(typeof pinOrId === 'string' ? pinOrId : pinOrId?.id) ?? null;
  }

  /** CSS pixels relative to the map stage; respects current draw/filter/aggregation. */
  detailAt(point) {
    return this.detailFor(this.at(point));
  }

  hitAt(point) {
    const pin = this.at(point);
    return pin ? { pin, detail: this.detailFor(pin) } : null;
  }

  cancelZoomRefresh() {
    if (this.zoomRefreshTimer !== null) this.clearTimer(this.zoomRefreshTimer);
    this.zoomRefreshTimer = null; this.zoomRefreshDue = false;
  }

  matches(pin) {
    return pinMatchesSearch(pin, this.query, this.categories);
  }

  icon(categoryId, pin) {
    const category = this.categories.get(categoryId);
    const path = pin?.icon ?? category?.icon;
    if (!/^\/assets\/map\/icons\/[a-z0-9_-]+\.png$/.test(path ?? '') && !cacheSpritePath.test(path ?? '')) return null;
    if (!resolvePicture(path)) return null; // Existing authored dot remains the pin's marker.
    const key = path?.startsWith(`/assets/map/${CACHE_PIN_SPRITE_DIRECTORY}/`) ? path : categoryId;
    if (!this.images.has(key)) {
      const image = this.imageFactory(), entry = { image, ready: false };
      image.decoding = 'async';
      this.images.set(key, entry);
      const ready = () => { if (this.disposed) return; entry.ready = true; this.revision++; this.cancelZoomRefresh(); this.changed(); };
      image.onload = () => { if (typeof image.decode === 'function') image.decode().then(ready, () => {}); else ready(); };
      image.onerror = () => { recordPictureFailure(path); image.onload = image.onerror = null; };
      image.src = path;
    }
    const entry = this.images.get(key);
    return entry.ready ? entry.image : null;
  }

  draw(context, { offset, zoom, unlocked = new Set(), width, height, dpr = globalThis.window?.devicePixelRatio || 1, textLabels = true }) {
    this.visible = [];
    if (this.disposed) return;
    // Overview suppresses the dense legend; search/focus can still locate a pin.
    if (zoom < PIN_MIN_ZOOM && !this.query && !this.focused) { this.cancelZoomRefresh(); return; }
    const unlockedKey = [...unlocked].sort().join('\0');
    const cache = this.cache, ratio = cache ? zoom / cache.zoom : 1;
    const left = offset.x - ratio * ((cache?.offset.x ?? offset.x) + PIN_CACHE_PADDING);
    const top = offset.y - ratio * ((cache?.offset.y ?? offset.y) + PIN_CACHE_PADDING);
    const compatible = cache && cache.width === width && cache.height === height && cache.dpr === dpr
      && cache.revision === this.revision && cache.focused === this.focused && cache.unlockedKey === unlockedKey
      && cache.textLabels === textLabels;
    const covered = left <= -32 && top <= -32
      && left + (width + PIN_CACHE_PADDING * 2) * ratio >= width + 32
      && top + (height + PIN_CACHE_PADDING * 2) * ratio >= height + 32;
    // Brief wheel/pinch bursts reproject one bitmap. The deadline refreshes
    // screen-sized icons and aggregation even if no further input arrives.
    const projected = compatible && cache.zoom !== zoom && ratio >= 0.85 && ratio <= 1.18
      && this.now() - cache.builtAt < PIN_ZOOM_REFRESH_MS;
    const reusable = compatible && covered && !this.zoomRefreshDue && (cache.zoom === zoom || projected);
    if (reusable && projected) {
      if (this.zoomRefreshTimer === null) this.zoomRefreshTimer = this.setTimer(() => {
        this.zoomRefreshTimer = null;
        if (this.disposed) return;
        this.zoomRefreshDue = true; this.changed();
      }, Math.max(0, PIN_ZOOM_REFRESH_MS - (this.now() - cache.builtAt)));
    } else this.cancelZoomRefresh();
    if (!reusable) {
      const paddedWidth = width + PIN_CACHE_PADDING * 2, paddedHeight = height + PIN_CACHE_PADDING * 2;
      const canvas = cache?.canvas ?? this.canvasFactory(Math.ceil(paddedWidth * dpr), Math.ceil(paddedHeight * dpr));
      if (!canvas) {
        this.visible = this.paint(context, { offset, zoom, unlocked, width, height, textLabels });
        return;
      }
      if (canvas.width !== Math.ceil(paddedWidth * dpr)) canvas.width = Math.ceil(paddedWidth * dpr);
      if (canvas.height !== Math.ceil(paddedHeight * dpr)) canvas.height = Math.ceil(paddedHeight * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, paddedWidth, paddedHeight);
      const visible = this.paint(ctx, { offset: { x: offset.x + PIN_CACHE_PADDING, y: offset.y + PIN_CACHE_PADDING },
        zoom, unlocked, width: paddedWidth, height: paddedHeight, textLabels });
      this.cache = { canvas, offset: { ...offset }, zoom, width, height, dpr, unlockedKey,
        revision: this.revision, focused: this.focused, textLabels, visible, builtAt: this.now() };
    }
    const layer = this.cache, scale = zoom / layer.zoom;
    const drawLeft = offset.x - scale * (layer.offset.x + PIN_CACHE_PADDING), drawTop = offset.y - scale * (layer.offset.y + PIN_CACHE_PADDING);
    context.globalAlpha = 1;
    context.drawImage(layer.canvas, drawLeft, drawTop, layer.canvas.width / dpr * scale, layer.canvas.height / dpr * scale);
    this.visible = layer.visible.map(entry => ({ ...entry, x: entry.x * scale + drawLeft, y: entry.y * scale + drawTop, radius: entry.radius * scale }))
      .filter(entry => entry.x >= -entry.radius && entry.y >= -entry.radius && entry.x <= width + entry.radius && entry.y <= height + entry.radius);
  }

  paint(context, { offset, zoom, unlocked, width, height, textLabels = true }) {
    const size = clamp(16 + Math.log2(Math.max(zoom, 0.22) / 0.5) * 3, 12, 27);
    const minX = clamp(Math.floor((-offset.x - size) / (CELL * zoom)), 0, 46), maxX = clamp(Math.floor((width - offset.x + size) / (CELL * zoom)), 0, 46);
    const minY = clamp(Math.floor((-offset.y - size) / (CELL * zoom)), 0, 49), maxY = clamp(Math.floor((height - offset.y + size) / (CELL * zoom)), 0, 49);
    let candidates = [];
    for (let row = minY; row <= maxY; row++) for (let column = minX; column <= maxX; column++) {
      for (const pin of this.buckets.get(`${column},${row}`) ?? []) {
        if (!this.enabled.has(pin.categoryId) || this.hidden.has(pin.id)) continue;
        if (pin.textOnly && !textLabels && pin.id !== this.focused && (!this.query || !this.matches(pin))) continue;
        if (zoom < PIN_MIN_ZOOM && pin.id !== this.focused && (!this.query || !this.matches(pin))) continue;
        const x = offset.x + pin.worldX * zoom, y = offset.y + pin.worldY * zoom;
        if (x < -size || y < -size || x > width + size || y > height + size) continue;
        const matched = this.matches(pin), focused = pin.id === this.focused;
        candidates.push({ pin, x, y, matched, focused, radius: Math.max(8, size / 2) });
      }
    }
    // Intermediate zoom uses one representative per grid cell, capped at 256.
    // Focus and search matches win crowded cells; full detail returns at 1.5.
    // The grid is anchored to the map, not the screen, and ties break by pin ID,
    // so panning never swaps which icon represents a cell.
    if (zoom < PIN_AGGREGATION_ZOOM && candidates.length > PIN_AGGREGATION_LIMIT) {
      const grid = new Map(), spacing = Math.max(32, Math.ceil(Math.sqrt(width * height / PIN_AGGREGATION_LIMIT)));
      const priority = entry => entry.focused ? 2 : this.query && entry.matched ? 1 : entry.pin.textOnly ? -1 : 0;
      const wins = (entry, held) => priority(entry) - priority(held) || (entry.pin.id < held.pin.id ? 1 : -1);
      for (const entry of candidates) {
        const key = `${Math.floor(entry.pin.worldX * zoom / spacing)},${Math.floor(entry.pin.worldY * zoom / spacing)}`;
        if (!grid.has(key) || wins(entry, grid.get(key)) > 0) grid.set(key, entry);
      }
      candidates = [...grid.values()].sort((a, b) => priority(b) - priority(a)
        || Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2)).slice(0, PIN_AGGREGATION_LIMIT);
    }
    // Focused symbols paint last and remain the hit target at overlaps.
    candidates.sort((a, b) => Number(a.focused) - Number(b.focused));
    for (const { pin, x, y, matched, focused } of candidates) {
        context.globalAlpha = focused || (this.query && matched) ? 1 : this.query ? 0.2 : unlocked.has(pin.chunkId) ? 1 : 0.72;
        if (focused || (this.query && matched)) {
          context.beginPath(); context.arc(x, y, size * 0.7, 0, Math.PI * 2);
          context.strokeStyle = focused ? '#fff' : '#ffe55c'; context.lineWidth = 2.5; context.stroke();
        }
        if (pin.textOnly && !textLabels) continue;
        const image = pin.textOnly ? null : this.icon(pin.categoryId, pin);
        if (pin.textOnly && typeof context.fillText === 'function') {
          const color = pin.elementDefinition?.color_1 ?? [221, 232, 237];
          context.font = `${Math.round(size * 0.65)}px sans-serif`;
          context.textAlign = 'center'; context.textBaseline = 'middle';
          context.fillStyle = `rgb(${color.join(',')})`;
          context.fillText(pin.label, x, y);
        } else if (image && pin.iconFrame) {
          const frame = pin.iconFrame, scale = size / frame.fullheight;
          context.drawImage(image, x + (frame.x - frame.fullwidth / 2) * scale,
            y + (frame.y - frame.fullheight / 2) * scale, frame.width * scale, frame.height * scale);
        } else if (image) {
          const ratio = image.naturalWidth / image.naturalHeight;
          const h = size, w = size * ratio;
          context.drawImage(image, x - w / 2, y - h / 2, w, h);
        } else {
          context.beginPath(); context.arc(x, y, Math.max(3, size * 0.22), 0, Math.PI * 2);
          context.fillStyle = '#dde8ed'; context.fill();
          context.strokeStyle = '#071017'; context.lineWidth = 1.5; context.stroke();
        }
    }
    context.globalAlpha = 1;
    return candidates;
  }

  at(point) {
    if (!point) return null;
    for (let i = (this.visible?.length ?? 0) - 1; i >= 0; i--) {
      const entry = this.visible[i];
      if (Math.hypot(point.x - entry.x, point.y - entry.y) <= entry.radius) return entry.pin;
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    this.cancelZoomRefresh();
    for (const { image } of this.images.values()) image.onload = image.onerror = null;
    this.images.clear();
    if (this.cache) this.cache.canvas.width = this.cache.canvas.height = 0;
    this.cache = null; this.visible = [];
  }
}
