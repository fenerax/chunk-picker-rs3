import { drawAvailabilityCell, availabilityDescription } from './map-availability.mjs';
import { gameStorage } from './screen-save-status.mjs';
import { SURFACE_GRID, surfaceCoordinates } from '../data/surface-grid.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';
import { resolveMemberStickers, resolveStartingChunk } from '../core/map-markers.mjs';
import { resolveMemberChunkColours, resolveMemberChunkColourNames } from '../core/chunk-colours.mjs';
import { chunkColourStyles, chunkColourPaint, createChunkColourLayer, drawChunkColourLayer, createChunkColourOverview, drawChunkColourOverview, releaseChunkColourOverview, drawChunkColours } from './map-chunk-colours.mjs';
import { worldPartnerConnections } from '../data/world-connections.mjs';
import { stickerAsset, stickerGlyph, stickerFont, stickerLabel, loadStickerFont, themePalettes } from './map-tools.mjs';
import { MapTerrain } from './map-terrain.mjs';
import { resolvePicture, recordPictureFailure, getArtStatus } from './art-status.mjs';
import { MapPinRenderer } from './map-pin-renderer.mjs';
import { drawMapConnections, mapConnectionsForChunk, readTravelLines, writeTravelLines } from './map-info.mjs';
import { sectionBoundarySegments } from './chunk-sections.mjs';
import { MapSearchLayer } from './map-search-layer.mjs';
import { MapTaskCountRenderer } from './map-task-count-renderer.mjs';
import { taskCountAnnotationCells, taskCountObstacles } from './map-task-count-obstacles.mjs';
import { MapPlaceLabels } from './map-place-labels.mjs';
import { MapActivityLayerRenderer } from './map-activity-layer-renderer.mjs';
import { createChunkLongPress, PHONE_MEDIA_QUERY } from './chunk-long-press.mjs';
import { drawGamePluginPositions } from './game-plugin.mjs';

const CELL = 128;
const WORLD_WIDTH = SURFACE_GRID.columns * CELL;
const WORLD_HEIGHT = SURFACE_GRID.rows * CELL;
const MIN_ZOOM = 0.055;
const MAX_ZOOM = 4;
export const MAX_MAP_DPR = 1.5;
const OWNER_COLORS = ['#00cab8', '#ad95fc', '#ffb878', '#83baff'];
const configuredOwnerIndexes = new Map((selectedDataset.gameDefaults?.members ?? []).map((member, index) => [member.id, index]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const displayScale = value => Number.isFinite(value) ? clamp(value, .6, 2) : 1;
const displayScaleKeys = ['rollNumberScale', 'chunkIdScale', 'stickerScale', 'taskCountScale'];

function startingFlagSize(members, chunkId, size, scale = 1) {
  const count = members.filter(owner => owner.startingChunk === chunkId).length;
  if (!count) return 0;
  const pad = Math.min(4, size * .1), ownerBar = members.length > 1 ? 4 : 0;
  return Math.max(0, Math.min(Math.min(20, size * .2) * displayScale(scale),
    (size - pad * 2 - (count - 1) * 2) / count, size - pad * 2 - ownerBar));
}

/**
 * Chunk IDs and starting flags share the bottom of a chunk. The ID sits left of the flags
 * while it fits there at its chosen size; otherwise it takes the full width and the flags
 * move up above it, so neither shrinks to unreadable.
 */
export function chunkIdLayout(members, chunkId, size, flagScale = 1, idScale = 1) {
  const fontSize = Math.min(Math.min(13, Math.max(10, size * 0.1)) * displayScale(idScale), size - 8);
  const flags = members.filter(owner => owner.startingChunk === chunkId).length;
  const flagSize = startingFlagSize(members, chunkId, size, flagScale);
  if (!flags) return { fontSize, flagSize, idRight: size - 5, flagLift: 0 };
  const beside = size - 5 - flags * (flagSize + 2) - 1;
  // Calibri bold digits are about half an em wide.
  if (beside - 2 >= String(chunkId).length * fontSize * .52) return { fontSize, flagSize, idRight: beside, flagLift: 0 };
  const pad = Math.min(4, size * .1), ownerBar = members.length > 1 ? 4 : 0, flagLift = fontSize + 2;
  return { fontSize, flagSize: Math.max(0, Math.min(flagSize, size - pad * 2 - ownerBar - flagLift)), idRight: size - 5, flagLift };
}

/** Fit scaled text to its chunk while retaining the existing zoom-dependent font. */
function fitMapFont(context, text, requested, width, height) {
  let fontSize = Math.min(requested, height);
  context.font = `bold ${fontSize}px Calibri, "Segoe UI", sans-serif`;
  const measured = context.measureText?.(text).width ?? text.length * fontSize * .6;
  if (measured > width) fontSize *= width / measured;
  context.font = `bold ${fontSize}px Calibri, "Segoe UI", sans-serif`;
  return fontSize;
}

/** Bounded diagonal hatching distinguishes temporary ownership on either theme. */
export function drawSandboxMarker(context, x, y, size, locked = false) {
  context.save();
  context.fillStyle = locked ? 'rgba(217,164,65,.09)' : 'rgba(217,164,65,.23)';
  context.fillRect(x, y, size, size);
  context.strokeStyle = '#e9b955'; context.lineWidth = 1.5;
  context.beginPath();
  const gap = Math.max(8, size / 24);
  for (let offset = gap; offset < size * 2; offset += gap) {
    context.moveTo(x + Math.max(0, offset - size), y + Math.min(size, offset));
    context.lineTo(x + Math.min(size, offset), y + Math.max(0, offset - size));
  }
  context.stroke();
  if (locked) context.setLineDash([5, 4]);
  context.strokeRect(x + 1, y + 1, Math.max(0, size - 2), Math.max(0, size - 2));
  context.restore();
}

/** A bounded, owner-balanced cluster in chunk-local pixels; hover retains every sticker. */
export function layoutStickerCluster(members, chunkId, size, scale = 1, flagLift = 0) {
  if (!Number.isFinite(size) || size < 18) return { markers: [], overflow: null };
  scale = displayScale(scale);
  const lists = members.map(owner => ({ owner, stickers: owner.stickers[chunkId] ?? [] }));
  const ordered = [];
  for (let index = 0; lists.some(list => index < list.stickers.length); index++) {
    for (const { owner, stickers } of lists) if (stickers[index]) ordered.push({ owner, sticker: stickers[index] });
  }
  const showOwner = members.length > 1, pad = Math.min(4, size * .1);
  const startingHeight = size >= 30 && members.some(owner => owner.startingChunk === chunkId)
    ? startingFlagSize(members, chunkId, size, scale) + (showOwner ? 4 : 0) + 2 + flagLift : 0;
  let limit = Math.min(ordered.length, size >= 56 ? 4 : size >= 30 ? 2 : 1);
  const ownerBar = showOwner ? 4 : 0, gap = 2;
  const chipHeight = Math.min(Math.min(12, Math.max(7, size * .15)) * scale, size - pad * 2 - startingHeight);
  const markerSizeFor = count => Math.min(24 * scale, (size - pad * 2 - gap) / Math.min(2, count),
    (size - pad * 2 - startingHeight - (ordered.length > count ? chipHeight + gap : 0)
      - (Math.ceil(count / 2) - 1) * gap) / Math.ceil(count / 2) - ownerBar);
  while (limit && markerSizeFor(limit) < 8 * scale) limit--;
  const shown = ordered.slice(0, limit), remaining = ordered.length - shown.length;
  if (!ordered.length) return { markers: [], overflow: null };
  if (!shown.length) return { markers: [], overflow: { count: remaining, x: pad, y: pad, width: size - pad * 2,
    height: Math.min(9 * scale, size - pad * 2 - startingHeight) } };
  const columns = Math.min(2, shown.length), rows = Math.ceil(shown.length / columns);
  const markerSize = markerSizeFor(shown.length);
  const width = columns * markerSize + (columns - 1) * gap, left = size - pad - width;
  const markers = shown.map((entry, index) => ({ ...entry, x: left + (index % columns) * (markerSize + gap),
    y: pad + Math.floor(index / columns) * (markerSize + ownerBar + gap), size: markerSize }));
  return { markers, overflow: remaining ? { count: remaining, x: left,
    y: pad + rows * (markerSize + ownerBar) + (rows - 1) * gap + gap, width, height: chipHeight } : null };
}

/** Viewport-sized terrain, model state, independent pins, and pointer feedback. */
export class ChunkMap {
  constructor({ stage, baseCanvas, stateCanvas, pinCanvas, hoverCanvas, tooltip, onChunk, onContext, onChunkHold, canChunkHold, deferFallback = false }) {
    if (!stage || !baseCanvas || !stateCanvas || !hoverCanvas || !tooltip) {
      throw new TypeError('ChunkMap requires a stage, three canvases, and a tooltip.');
    }
    this.stage = stage;
    this.canvases = [baseCanvas, stateCanvas, hoverCanvas];
    this.contexts = this.canvases.map(canvas => canvas.getContext('2d'));
    this.pinContext = pinCanvas?.getContext('2d') ?? null;
    if (pinCanvas) this.canvases.push(pinCanvas);
    this.searchLayer = new MapSearchLayer(stage, pinCanvas ?? hoverCanvas);
    if (this.searchLayer.canvas) this.canvases.push(this.searchLayer.canvas);
    if (this.contexts.some(context => !context)) throw new Error('Canvas 2D rendering is unavailable.');
    this.hoverCanvas = hoverCanvas;
    this.tooltip = tooltip;
    this.onChunk = typeof onChunk === 'function' ? onChunk : () => {};
    this.onContext = typeof onContext === 'function' ? onContext : () => {};
    this.width = this.height = 1;
    this.zoom = 0.16;
    this.offset = { x: 0, y: 0 };
    this.cells = new Map();
    this.members = [];
    this.model = null;
    this.pointer = null;
    this.drag = null;
    this.touchPointers = new Map();
    this.pinch = null;
    this.isPhone = () => globalThis.matchMedia?.(PHONE_MEDIA_QUERY).matches === true;
    this.chunkHold = createChunkLongPress({ isPhone: this.isPhone,
      canHold: id => typeof onChunkHold === 'function' && typeof canChunkHold === 'function' && canChunkHold(id),
      onHold: (id, point) => onChunkHold(id, point) });
    this.hoverId = null;
    this.dirty = { base: true, state: true, pins: true, hover: true };
    this.frame = null;
    this.disposed = false;
    this.initialized = false;
    this.autoFit = false;
    this.overlay = null;
    try { this.travelLinesStorage = gameStorage(); } catch { this.travelLinesStorage = null; }
    this.travelLinesVisible = readTravelLines(this.travelLinesStorage);
    this.listeners = [];
    this.markerImages = new Map();
    this.deathMarkers = new Map();
    this.taskCounts = new Map();
    this.taskCountRenderer = new MapTaskCountRenderer();
    this.activityLayerRenderer = new MapActivityLayerRenderer({ onInvalidate: () => { this.dirty.state = true; this.schedule(); } });
    this.placeLabels = new MapPlaceLabels(this, { chunkIdLayout, layoutStickerCluster, startingFlagSize });
    this.chunkTerrainListeners = new Map();
    loadStickerFont().then(loaded => { if (loaded && !this.disposed) this.invalidate(false, true, false); });
    this.imageStatus = 'loading';
    this.stage.dataset.mapImage = this.imageStatus;
    this.image = new Image();
    this.image.decoding = 'async';
    const imageReady = () => {
      if (this.disposed) return;
      this.imageStatus = 'ready';
      this.stage.dataset.mapImage = this.imageStatus;
      this.terrain?.setFallback(this.image);
      for (const redraw of this.chunkTerrainListeners.keys()) redraw();
      this.invalidate(true, true, false);
    };
    this.image.onerror = () => {
      if (this.disposed) return;
      if (getArtStatus()) recordPictureFailure('/assets/world.png');
      this.imageStatus = 'error';
      this.stage.dataset.mapImage = this.imageStatus;
      this.terrain?.setFallbackUnavailable();
      for (const redraw of this.chunkTerrainListeners.keys()) redraw();
      hoverCanvas.setAttribute('aria-label', 'Interactive chunk map. World artwork failed to load; chunk outlines and controls remain available. Use Search for the accessible chunk list.');
      this.invalidate(true, true, false);
    };
    this.image.onload = () => {
      if (typeof this.image.decode === 'function') this.image.decode().then(imageReady, () => this.image.onerror?.());
      else imageReady();
    };
    this.bind(hoverCanvas, 'pointerdown', event => this.pointerDown(event));
    this.bind(hoverCanvas, 'contextmenu', event => {
      event.preventDefault();
      if (this.isPhone() && (this.touchPointers.size || event.pointerType === 'touch')) return;
      const id = this.chunkAt(this.localPoint(event));
      if (id) this.onContext(id, event.clientX, event.clientY, event.pointerType);
    });
    this.bind(hoverCanvas, 'pointermove', event => this.pointerMove(event));
    this.bind(hoverCanvas, 'pointerup', event => this.pointerUp(event));
    this.bind(hoverCanvas, 'pointercancel', event => this.cancelPointer(event));
    this.bind(hoverCanvas, 'lostpointercapture', event => this.cancelPointer(event));
    this.bind(hoverCanvas, 'pointerleave', () => {
      if (this.drag) return;
      this.pointer = null;
      this.setHover(null);
    });
    this.bind(hoverCanvas, 'wheel', event => {
      event.preventDefault();
      const point = this.localPoint(event);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      this.zoomAt(Math.exp(-clamp(delta, -500, 500) * 0.0015), point);
    }, { passive: false });
    this.bind(hoverCanvas, 'keydown', event => this.keyDown(event));
    this.bind(window, 'resize', () => this.resize());
    this.bind(window, 'blur', () => this.cancelTouchGesture());
    this.bind(window, 'pagehide', () => this.cancelTouchGesture());
    if (globalThis.document?.addEventListener) this.bind(document, 'visibilitychange', () => { if (document.hidden) this.cancelTouchGesture(); });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(stage);
    this.resize();
    if (!deferFallback) this.loadWorldPicture();
  }

  loadWorldPicture() {
    const route = resolvePicture('/assets/world.png');
    if (route) { this.imageStatus = 'loading'; this.image.src = route; }
    else {
      this.imageStatus = 'placeholder';
      this.terrain?.setFallbackUnavailable();
    }
    this.stage.dataset.mapImage = this.imageStatus;
  }

  bind(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  setMapAssets(manifest, dataset) {
    this.mapAssetManifest = manifest;
    this.terrain?.dispose();
    this.terrain = manifest ? new MapTerrain(manifest, { changed: () => this.invalidate(true, true, false),
      fallbackImage: this.imageStatus === 'ready' ? this.image : null, waitForFallback: this.imageStatus === 'loading' }) : null;
    if (this.terrain?.modernBase) {
      if (this.image && !this.image.src) {
        this.imageStatus = 'unused'; this.stage.dataset.mapImage = this.imageStatus;
      }
    } else if (this.image && !this.image.src) {
      this.loadWorldPicture();
    }
    this.setMapPins(manifest, dataset);
    this.stage.dataset.mapAssets = this.terrain?.tiles.size ? 'local' : 'legacy';
    for (const [redraw, record] of this.chunkTerrainListeners) {
      record.unsubscribe?.();
      record.unsubscribe = this.terrain?.subscribeChunk(record.chunkId, redraw);
      redraw();
    }
    this.invalidate(true, true, true);
  }

  /** Pins can arrive after terrain without disposing decoded viewport tiles. */
  setMapPins(manifest, dataset) {
    this.pins?.dispose();
    this.pins = manifest && this.pinContext ? new MapPinRenderer(manifest, dataset, { changed: () => this.invalidatePins() }) : null;
    if (this.mapInformation) this.pins?.setDetails(this.mapInformation.pinDetails);
    this.invalidatePins();
  }

  setPinFilters(filters) {
    this.pins?.setFilters(filters);
    this.invalidatePins();
  }

  setMapInformation(information) {
    this.mapInformation = information;
    this.pins?.setDetails(information?.pinDetails);
    this.dirty.hover = true;
    this.schedule();
  }

  pinAt(point = this.pointer) { return this.pins?.at(point) ?? null; }
  pinDetailAt(point = this.pointer) { return this.pins?.detailAt(point) ?? null; }
  pinHitAt(point = this.pointer) { return this.pins?.hitAt(point) ?? null; }

  /** Select a chunk, section or retained area without changing travel eligibility. */
  setConnectionChunk(id) {
    this.setSectionHighlight(null);
    this.connectionChunkId = id == null ? null : String(id);
    this.dirty.hover = true;
    this.schedule();
    return this.connectionsForChunk(id);
  }

  connectionsForChunk(id) { return mapConnectionsForChunk(this.mapInformation?.connections, id); }

  /** Display geometry only; no access or ownership state changes. */
  setSectionHighlight(chunkId, section = null) {
    this.sectionHighlight = section?.mask && surfaceCoordinates(chunkId)
      ? { chunkId, color: section.color ?? '#ffffff', segments: sectionBoundarySegments(section.mask) } : null;
    this.dirty.hover = true;
    this.schedule();
  }

  drawSectionHighlight(context) {
    const highlight = this.sectionHighlight, point = highlight && surfaceCoordinates(highlight.chunkId);
    if (!point || !highlight.segments.length) return;
    const tile = CELL * this.zoom / 64;
    const left = this.offset.x + point.x * CELL * this.zoom;
    const top = this.offset.y + point.y * CELL * this.zoom;
    context.save(); context.beginPath();
    for (const [[x1, y1], [x2, y2]] of highlight.segments) {
      context.moveTo(left + x1 * tile, top + (64 - y1) * tile);
      context.lineTo(left + x2 * tile, top + (64 - y2) * tile);
    }
    context.strokeStyle = '#15202bcc'; context.lineWidth = 3; context.stroke();
    context.strokeStyle = highlight.color; context.lineWidth = 1.5; context.stroke();
    context.restore();
  }

  drawChunkTerrain(context, chunkId, size = 256) {
    if (this.terrain) return this.terrain.drawChunk(context, chunkId, size);
    const point = surfaceCoordinates(chunkId);
    if (!point || this.imageStatus !== 'ready') return false;
    const sx = this.image.naturalWidth / WORLD_WIDTH, sy = this.image.naturalHeight / WORLD_HEIGHT;
    context.drawImage(this.image, point.x * CELL * sx, point.y * CELL * sy, CELL * sx, CELL * sy, 0, 0, size, size);
    return true;
  }

  subscribeChunkTerrain(chunkId, redraw) {
    const record = { chunkId, unsubscribe: this.terrain?.subscribeChunk(chunkId, redraw) };
    this.chunkTerrainListeners.set(redraw, record);
    return () => { this.chunkTerrainListeners.delete(redraw); record.unsubscribe?.(); };
  }

  setTravelLinesVisible(visible) {
    this.travelLinesVisible = visible !== false;
    writeTravelLines(this.travelLinesStorage, this.travelLinesVisible);
    this.dirty.hover = true;
    this.schedule();
  }

  drawConnectionLines(context, id = this.connectionChunkId, style) {
    if (this.travelLinesVisible === false) return [];
    const surface = this.model?.world?.surface;
    const isSurface = endpoint => endpoint?.mapId === 28 && endpoint.plane === 0 && !endpoint.areaId && (!surface || surface.has(String(endpoint.chunkId)));
    const scheme = themePalettes[this.model?.preferences?.theme]?.scheme ?? 'dark';
    return drawMapConnections(context, this.mapInformation?.connections, { chunkId: id, offset: this.offset, zoom: this.zoom, style: { isSurface, scheme, ...style } });
  }

  invalidatePins() {
    this.dirty.pins = true;
    this.schedule();
  }

  focusPin(id) {
    const pin = this.pins?.pins.get(id);
    if (!pin) return false;
    this.pins.focused = id;
    this.autoFit = false;
    this.zoom = Math.max(this.zoom, 0.65);
    this.offset = { x: this.width / 2 - pin.worldX * this.zoom, y: this.height / 2 - pin.worldY * this.zoom };
    this.invalidate(true, true, true);
    return true;
  }

  /** Optional map-wide overlay; 'membership' tints members-only land. */
  setOverlay(overlay) {
    const next = overlay === 'membership' ? overlay : null;
    if (next === this.overlay) return;
    this.overlay = next;
    if (this.hoverId && this.pointer) this.setHover(this.hoverId);
    this.invalidate(false, true, false);
  }

  /** Search highlights are temporary and never change the roll or ownership model. */
  setSearchMatches(ids, options) {
    if (!this.searchLayer?.setMatches(ids, this.cells, options)) return;
    if (!this.searchLayer.canvas) this.dirty.hover = true;
    this.schedule();
  }

  /** Browser display sizes repaint existing geometry without rebuilding the model. */
  setDisplayPreferences(preferences = {}) {
    if (!this.model || this.disposed) return;
    const previous = this.model.preferences;
    const changed = displayScaleKeys.filter(key => key in preferences
      && displayScale(previous[key]) !== displayScale(preferences[key]));
    if ('showTaskCounts' in preferences && (previous.showTaskCounts !== false) !== (preferences.showTaskCounts !== false)) changed.push('showTaskCounts');
    if ('showPlaceNames' in preferences && (previous.showPlaceNames !== false) !== (preferences.showPlaceNames !== false)) changed.push('showPlaceNames');
    if (!changed.length) return;
    this.model.preferences = { ...previous, ...Object.fromEntries(displayScaleKeys
      .filter(key => key in preferences).map(key => [key, displayScale(preferences[key])])),
      ...('showTaskCounts' in preferences ? { showTaskCounts: preferences.showTaskCounts !== false } : {}),
      ...('showPlaceNames' in preferences ? { showPlaceNames: preferences.showPlaceNames !== false } : {}) };
    if (changed.some(key => !['stickerScale', 'taskCountScale', 'showTaskCounts', 'showPlaceNames'].includes(key))
      || changed.includes('stickerScale') && (!this.pins || previous.ids)
      || changed.some(key => ['taskCountScale', 'showTaskCounts', 'showPlaceNames'].includes(key)) && !this.pinContext) this.dirty.state = true;
    if (changed.includes('stickerScale') && this.pins) this.dirty.pins = true;
    if (changed.some(key => ['taskCountScale', 'showTaskCounts', 'showPlaceNames'].includes(key)) && this.pinContext) this.dirty.pins = true;
    this.schedule();
  }

  setAvailability(model) {
    if (this.availability === model || this.disposed) return;
    this.availability = model;
    this.dirty.state = true; this.dirty.hover = true; this.schedule();
  }

  setTaskCounts(counts) {
    if (this.taskCounts === counts || this.disposed) return;
    this.taskCounts = counts;
    this.visibleTaskCounts = new Map([...counts].filter(([id]) => this.unlocked?.has(id)));
    if (this.pinContext) this.dirty.pins = true; else this.dirty.state = true;
    this.schedule();
  }

  setActivityLayers(model) {
    this.activityLayers = model;
    this.activityLayerRenderer?.setModel(model, this.cells);
    if (this.hoverId && this.pointer) this.setHover(this.hoverId);
    this.dirty.state = true;
    this.schedule();
  }

  setActivityLayerPreferences(preferences) {
    if (this.activityLayerPreferences?.clueTier === preferences.clueTier
      && this.activityLayerPreferences?.showSlayer === preferences.showSlayer) return;
    this.activityLayerPreferences = { ...preferences };
    if (this.hoverId && this.pointer) this.setHover(this.hoverId);
    this.dirty.state = true;
    this.schedule();
  }

  setModel({ world, state, memberId, groupView = false, pool = null, preferences = {}, sandbox = null }) {
    this.chunkHold?.cancel();
    if (!(world?.chunks instanceof Map) || !(world?.surface instanceof Set) || !Array.isArray(state?.members)) {
      throw new TypeError('ChunkMap model requires indexed world data and state.members.');
    }
    const member = state.members.find(item => item.id === memberId);
    if (!member) throw new TypeError(`Unknown map member: ${memberId}`);
    this.searchLayer?.setScope(world, memberId, state.revision);
    if (this.model && (this.model.world !== world || this.model.memberId !== memberId)) this.setSectionHighlight(null);
    if (this.model?.world !== world) {
      this.cells.clear();
      for (const id of world.surface) {
        const point = surfaceCoordinates(id);
        if (point && world.chunks.has(id)) this.cells.set(id, point);
      }
      this.dirty.base = true;
    }
    if (this.model?.preferences?.highvis !== preferences.highvis || this.model?.preferences?.theme !== preferences.theme) this.dirty.base = true;
    if (this.model?.state.revision !== state.revision || this.model?.memberId !== memberId) this.deathMarkers.clear();
    this.model = { world, state, memberId, groupView, pool, preferences };
    this.activityLayerRenderer?.setModel(this.activityLayers, this.cells);
    this.sandboxUnlocks = new Set(sandbox?.unlockChunks ?? []);
    this.sandboxLocks = new Set(sandbox?.lockChunks ?? []);
    this.members = state.members.map((owner, index) => ({
      ...owner, color: OWNER_COLORS[(configuredOwnerIndexes.get(owner.id) ?? index) % OWNER_COLORS.length], unlockedSet: new Set(owner.unlocked),
      selectedRanks: new Map(owner.selected.map((id, rank) => [id, rank + 1])),
      pendingSet: new Set(owner.pendingRoll),
      stickers: resolveMemberStickers(state, owner), startingChunk: resolveStartingChunk(state, owner),
      chunkColours: resolveMemberChunkColours(state, owner), chunkColourNames: resolveMemberChunkColourNames(state, owner),
    }));
    this.active = this.members.find(owner => owner.id === memberId);
    this.connections = worldPartnerConnections(world, state, memberId, pool);
    this.visibleMembers = groupView ? this.members : [this.active];
    // Prime only present artwork, including overflow stickers, before any size
    // control can reveal it. The type cache bounds requests across model updates.
    for (const owner of this.visibleMembers) for (const id in owner.stickers) {
      for (const sticker of owner.stickers[id]) {
        if (!this.markerImages.has(sticker.type)) this.markerImage(sticker.type);
      }
    }
    this.unlocked = new Set(this.visibleMembers.flatMap(owner => owner.unlocked));
    this.visibleTaskCounts = new Map([...(this.taskCounts ?? [])].filter(([id]) => this.unlocked.has(id)));
    this.poolIds = new Set((pool?.eligible ?? (Array.isArray(pool) ? pool : [])).map(entry => typeof entry === 'string' ? entry : entry.id));
    this.lodestoneOptions = new Set((pool?.eligible ?? []).filter(entry => entry.reasons?.some(reason => reason.travelKind === 'lodestone')).map(entry => entry.id));
    // Only the response pool supplies roll numbers. Eligible hand selections keep
    // their relative order; automatic options follow by ID, in either map view.
    const handCandidates = this.active.selected.filter(id => this.poolIds.has(id));
    const extraCandidates = [...this.poolIds].filter(id => !this.active.selectedRanks.has(id)).sort((a, b) => Number(a) - Number(b));
    this.candidateRanks = new Map([...handCandidates, ...extraCandidates].map((id, index) => [id, index + 1]));
    // Model-dependent ownership and reveal geometry are shared by every pan frame.
    this.cellStates = new Map();
    const colourStyles = chunkColourStyles(preferences);
    this.revealPath = typeof Path2D === 'function' ? new Path2D() : null;
    for (const [id, point] of this.cells) {
      const owners = this.visibleMembers.filter(owner => owner.unlockedSet.has(id));
      const selected = this.visibleMembers.filter(owner => owner.selectedRanks.has(id));
      const pending = this.visibleMembers.some(owner => owner.pendingSet.has(id));
      const candidate = this.candidateRanks.has(id);
      const colourPaint = chunkColourPaint(this.visibleMembers, id, colourStyles);
      this.cellStates.set(id, { owners, selected, pending, candidate, colourPaint });
      if (owners.length || selected.length || pending || candidate) this.revealPath?.rect(point.x * CELL, point.y * CELL, CELL, CELL);
    }
    releaseChunkColourOverview(this.chunkColourOverview);
    this.chunkColourLayer = createChunkColourLayer(this.cells, this.cellStates, CELL);
    this.chunkColourOverview = createChunkColourOverview(this.chunkColourLayer, WORLD_WIDTH, WORLD_HEIGHT);
    this.dirty.state = this.dirty.pins = this.dirty.hover = true;
    if (!this.initialized) {
      this.initialized = true;
      this.centerOnUnlocked();
    }
    this.schedule();
  }

  resize() {
    this.chunkHold?.cancel();
    if (this.disposed) return;
    if (this.touchPointers?.size) this.cancelTouchGesture();
    const bounds = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const deviceDpr = Math.max(1, window.devicePixelRatio || 1);
    // Bound raster/compositing cost on high-density displays. DOM controls keep
    // their full browser density; terrain's native detail is cached separately.
    const dpr = Math.min(MAX_MAP_DPR, deviceDpr);
    this.deviceDpr = deviceDpr;
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.offset.x += (width - this.width) / 2;
    this.offset.y += (height - this.height) / 2;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of this.canvases) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    // Keep the unlocked area framed while layout settles, until the user moves the map.
    if (this.autoFit && this.model) this.centerOnUnlocked();
    this.invalidate(true, true, true);
    // Setting a canvas size wipes it. Resize callbacks run before the browser paints,
    // so draw now rather than next frame, or the map shows one empty (black) frame.
    if (this.model && !this.painting) this.paint();
  }

  /** Replace topology-only preview with the worker's gated travel evidence. */
  setConnections(connections) {
    if (!connections?.byChunk) return;
    this.connections = connections;
    this.invalidate(false, true, true);
  }

  /** Advisory estimates repaint map annotations, never roll eligibility. */
  setDeathMarkers(markers) {
    this.deathMarkers = markers instanceof Map ? markers : new Map();
    if (this.hoverId && this.pointer) this.setHover(this.hoverId);
    this.invalidate(false, true, true);
  }

  setGamePluginPositions(positions) {
    this.gamePluginPositions = Array.isArray(positions) ? positions : [];
    this.invalidate(false, false, true);
  }

  centerOnUnlocked() {
    if (!this.model) return;
    this.autoFit = true;
    const ids = new Set([...this.unlocked, ...this.visibleMembers.flatMap(owner => [...owner.selected, ...owner.pendingRoll])]);
    const points = [...ids].map(id => this.cells.get(id)).filter(Boolean);
    if (!points.length) {
      this.fitBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      return;
    }
    this.fitBounds(Math.min(...points.map(point => point.x)) * CELL,
      Math.min(...points.map(point => point.y)) * CELL,
      (Math.max(...points.map(point => point.x)) + 1) * CELL,
      (Math.max(...points.map(point => point.y)) + 1) * CELL);
  }

  fitBounds(left, top, right, bottom) {
    // Leave room for the floating panels on desktop; on a phone those margins would leave little map.
    const phone = this.width <= 720, marginX = phone ? this.width * 0.08 : 160, marginY = phone ? this.height * 0.12 : 200;
    this.zoom = clamp(Math.min(Math.max(1, this.width - marginX) / (right - left + CELL),
      Math.max(1, this.height - marginY) / (bottom - top + CELL)), MIN_ZOOM, 0.65);
    this.offset = { x: this.width / 2 - (left + right) / 2 * this.zoom,
      y: this.height / 2 - (top + bottom) / 2 * this.zoom };
    this.invalidate(true, true, true);
  }

  centerOnChunk(id) {
    const point = this.cells.get(String(id));
    if (!point) return false;
    this.autoFit = false;
    this.zoom = Math.max(this.zoom, 0.42);
    this.offset = { x: this.width / 2 - (point.x + 0.5) * CELL * this.zoom,
      y: this.height / 2 - (point.y + 0.5) * CELL * this.zoom };
    this.invalidate(true, true, true);
    return true;
  }

  centerOnChunks(ids) {
    const points = [...new Set(ids.map(id => String(id).replace(/-\d+$/, '')))]
      .map(id => this.cells.get(id)).filter(Boolean);
    if (!points.length) return false;
    this.autoFit = false;
    const left = Math.min(...points.map(point => point.x)) * CELL, top = Math.min(...points.map(point => point.y)) * CELL;
    const right = (Math.max(...points.map(point => point.x)) + 1) * CELL, bottom = (Math.max(...points.map(point => point.y)) + 1) * CELL;
    this.fitBounds(left, top, right, bottom);
    return (right - left) * this.zoom <= this.width && (bottom - top) * this.zoom <= this.height;
  }

  zoomBy(factor) { this.zoomAt(factor, { x: this.width / 2, y: this.height / 2 }); }

  zoomAt(factor, anchor) {
    this.chunkHold?.cancel();
    if (!Number.isFinite(factor) || factor <= 0) return;
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.autoFit = false;
    const ratio = next / this.zoom;
    this.offset.x = anchor.x - (anchor.x - this.offset.x) * ratio;
    this.offset.y = anchor.y - (anchor.y - this.offset.y) * ratio;
    this.zoom = next;
    this.invalidate(true, true, true);
  }

  localPoint(event) {
    const bounds = this.stage.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  chunkAt(point) {
    if (!point || !this.model) return null;
    const x = Math.floor((point.x - this.offset.x) / (CELL * this.zoom));
    const y = Math.floor((point.y - this.offset.y) / (CELL * this.zoom));
    if (x < 0 || y < 0 || x >= SURFACE_GRID.columns || y >= SURFACE_GRID.rows) return null;
    const id = String(x * SURFACE_GRID.stride - y + SURFACE_GRID.startId);
    return this.cells.has(id) ? id : null;
  }

  pointerDown(event) {
    if (this.pointerTool?.down(event)) { this.chunkHold.cancel(); return; }
    const point = this.localPoint(event);
    if (event.pointerType === 'touch') {
      this.touchPointers.set(event.pointerId, point);
      if (this.isPhone()) this.chunkHold.down(event, this.chunkAt(point));
      if (this.touchPointers.size > 1) {
        this.hoverCanvas.setPointerCapture(event.pointerId);
        this.startPinch();
        return;
      }
    }
    if (this.drag || (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1)) return;
    // Middle-drag pans like left-drag; stop the browser's autoscroll cursor.
    if (event.button === 1) event.preventDefault?.();
    this.hoverCanvas.focus({ preventScroll: true });
    this.hoverCanvas.setPointerCapture(event.pointerId);
    this.pointer = point;
    this.drag = { pointerId: event.pointerId, start: point, last: point, moved: false, button: event.button ?? 0 };
  }

  pointerMove(event) {
    this.chunkHold?.move(event);
    if (this.touchPointers?.has(event.pointerId)) {
      this.touchPointers.set(event.pointerId, this.localPoint(event));
      if (this.pinch) { this.movePinch(); return; }
    }
    if (this.pointerTool?.move(event)) return;
    if (this.drag && this.drag.pointerId !== event.pointerId) return;
    this.pointer = this.localPoint(event);
    this.schedule();
  }

  applyPointer() {
    if (this.drag && this.pointer) {
      if (Math.hypot(this.pointer.x - this.drag.start.x, this.pointer.y - this.drag.start.y) > 5) this.drag.moved = true;
      if (this.drag.moved) {
        this.autoFit = false;
        this.offset.x += this.pointer.x - this.drag.last.x;
        this.offset.y += this.pointer.y - this.drag.last.y;
        this.dirty.base = this.dirty.state = this.dirty.pins = this.dirty.hover = true;
        this.hoverCanvas.classList.add('dragging');
      }
      this.drag.last = this.pointer;
    }
    this.setHover(this.drag?.moved ? null : this.chunkAt(this.pointer));
  }

  pointerUp(event) {
    const suppressTap = this.chunkHold.up(event);
    this.touchPointers.delete(event.pointerId);
    if (this.pinch) {
      this.resumeTouchDrag();
      if (this.hoverCanvas.hasPointerCapture(event.pointerId)) this.hoverCanvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (this.pointerTool?.up(event)) return;
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.pointer = this.localPoint(event);
    this.applyPointer();
    const id = !suppressTap && !this.drag.moved && this.drag.button !== 1 ? this.chunkAt(this.pointer) : null;
    this.endDrag();
    if (this.hoverCanvas.hasPointerCapture(event.pointerId)) this.hoverCanvas.releasePointerCapture(event.pointerId);
    if (id) this.onChunk(id, { shiftKey: event.shiftKey === true, ctrlKey: event.ctrlKey === true || event.metaKey === true,
      ...(event.pointerType === 'touch' ? { pointerType: 'touch' } : {}) });
  }

  endDrag() {
    this.chunkHold?.cancel();
    this.drag = null;
    this.hoverCanvas.classList.remove('dragging');
    this.schedule();
  }

  startPinch() {
    this.chunkHold.cancel();
    const [first, second] = [...this.touchPointers.values()];
    this.pinch = { distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } };
    this.drag = null;
    this.pointer = null;
    this.hoverCanvas.classList.add('dragging');
    this.setHover(null);
  }

  movePinch() {
    const [first, second] = [...this.touchPointers.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const before = this.pinch;
    if (before.distance > 0 && distance > 0) this.zoomAt(distance / before.distance, before.midpoint);
    this.offset.x += midpoint.x - before.midpoint.x;
    this.offset.y += midpoint.y - before.midpoint.y;
    this.autoFit = false;
    this.pinch = { distance, midpoint };
    this.invalidate(true, true, true);
  }

  resumeTouchDrag() {
    this.endDrag();
    this.pinch = null;
    if (this.touchPointers.size > 1) { this.startPinch(); return; }
    const remaining = this.touchPointers.entries().next().value;
    if (remaining) {
      const [pointerId, point] = remaining;
      this.pointer = point;
      this.drag = { pointerId, start: point, last: point, moved: true, button: 0 };
    }
  }

  cancelPointer(event) {
    if (this.touchPointers.has(event.pointerId)) {
      this.chunkHold.release(event);
      this.touchPointers.delete(event.pointerId);
      this.resumeTouchDrag();
    } else if ((!this.isPhone() && !this.touchPointers.size) || event.pointerId === undefined || this.drag?.pointerId === event.pointerId) this.endDrag();
  }

  cancelTouchGesture() {
    if (!this.touchPointers.size) return;
    const captured = [...this.touchPointers.keys()];
    this.chunkHold.reset();
    this.touchPointers.clear(); this.pinch = null; this.endDrag();
    for (const id of captured) if (this.hoverCanvas.hasPointerCapture(id)) this.hoverCanvas.releasePointerCapture(id);
  }

  keyDown(event) {
    const step = event.shiftKey ? 150 : 65;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      const [x, y] = moves[event.key];
      this.autoFit = false;
      this.offset.x += x;
      this.offset.y += y;
      this.invalidate(true, true, true);
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      this.zoomBy(event.key === '-' ? 1 / 1.25 : 1.25);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      this.centerOnUnlocked();
    } else if (event.key === 'Enter' && this.hoverId) {
      event.preventDefault();
      this.onChunk(this.hoverId);
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && this.hoverId) {
      event.preventDefault();
      const box = this.hoverCanvas.getBoundingClientRect(), point = this.pointer ?? { x: box.width / 2, y: box.height / 2 };
      this.onContext(this.hoverId, box.left + point.x, box.top + point.y);
    }
  }

  setHover(id) {
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.dirty.hover = true;
    }
    this.tooltip.hidden = !id;
    if (!id) { this.hoverCanvas.setAttribute('aria-description', ''); return; }
    const owners = this.visibleMembers.filter(owner => owner.unlockedSet.has(id)).map(owner => owner.name);
    const selected = this.visibleMembers.filter(owner => owner.selectedRanks.has(id));
    const pending = this.visibleMembers.filter(owner => owner.pendingSet.has(id));
    const rank = this.candidateRanks?.get(id);
    const rollStatus = rank
      ? `${this.active.selectedRanks.has(id) && this.model.state.rules?.['roll.selected'] !== false ? 'Hand-added roll option' : this.lodestoneOptions?.has(id) ? 'Lodestone roll option' : 'Automatic roll option'} ${rank} for ${this.active.name}`
      : this.active.pendingSet.has(id) ? `Offered in ${this.active.name}’s pending roll.`
      : this.active.unlockedSet.has(id) ? null : `Outside ${this.active.name}’s current roll pool.`;
    const status = [rollStatus,
      ...(pending.length ? [`Roll choice: ${pending.map(owner => owner.name).join(', ')}`] : []),
      ...(owners.length ? [`Unlocked: ${owners.join(', ')}`] : []),
      ...selected.map(owner => `Saved hand selection ${owner.selectedRanks.get(id)}: ${owner.name}`),
      ...(this.model.state.rules?.['roll.selected'] === false
        ? selected.map(owner => `Hand selections are disabled for ${owner.name}.`) : []),
      ...(this.active.blacklisted?.includes(id) ? ['Never roll'] : []),
    ].filter(Boolean).join('\n') || 'Locked';
    const annotations = this.visibleMembers.flatMap(owner => {
      return [...(owner.startingChunk === id ? [`${owner.name}: Starting marker`] : []),
        ...(owner.stickers[id] ?? []).map(marker => `${owner.name}: ${stickerLabel(marker.type)}${marker.text ? ` · ${marker.text}` : ''}`)];
    });
    const membership = this.overlay !== 'membership' ? [] : [{ members: 'Members-only land', f2p: 'Free-to-play land' }[this.membership(id)] ?? 'Not walkable'];
    const travel = this.model.groupView && !this.active.unlockedSet.has(id) ? this.connections.byChunk[id] : null;
    const death = this.deathMarkers.get(id);
    const deathLabel = death ? [`Estimated death chunk for ${this.active.name}: about ${Math.round(death.hours).toLocaleString()} h; limit ${death.thresholdHours.toLocaleString()} h.${death.unknown?.length ? ' Some task times are unknown.' : ''}`] : [];
    const taskCount = this.model.preferences.showTaskCounts !== false ? this.visibleTaskCounts?.get(id) : 0;
    const taskLabel = taskCount ? [`${taskCount} active task${taskCount === 1 ? '' : 's'}`] : [];
    const hypothetical = this.sandboxUnlocks?.has(id) ? ['Sandbox unlock: nothing is saved'] : this.sandboxLocks?.has(id) ? ['Sandbox lock: nothing is saved'] : [];
    const colours = this.cellStates?.get(id)?.colourPaint?.descriptions ?? [];
    const layerPreferences = this.activityLayerPreferences ?? {};
    const clueTiers = layerPreferences.clueTier !== 'off' ? [...new Set((this.activityLayers?.clues?.get(id) ?? [])
      .filter(row => layerPreferences.clueTier === 'all' || row.tier === layerPreferences.clueTier).map(row => row.tier))] : [];
    const activityLabels = [...(clueTiers.length ? [`Recorded clue locations: ${clueTiers.join(', ')}. Requirements not checked.`] : []),
      ...(layerPreferences.showSlayer && this.activityLayers?.slayer?.has(id) ? [`Locked Slayer task: ${this.activityLayers.slayerLabel ?? 'target'} · recorded monster locations`] : [])];
    const lines = [...availabilityDescription(this.availability, id), ...hypothetical, ...membership, ...taskLabel, ...activityLabels, ...colours, ...annotations, ...deathLabel, ...(travel ? [travel.connected ? `${travel.ownerName}'s chunk, connected for ${this.active.name}: out: ${travel.out}; back: ${travel.back}` : `${travel.ownerName}'s chunk, not connected for ${this.active.name}: ${travel.reason}`] : [])];
    const hit = this.pinHitAt();
    if (hit) {
      const detail = hit.detail;
      const description = detail?.title && !detail.description.startsWith(detail.title)
        ? `${detail.title}. ${detail.description}` : detail?.description;
      lines.push(detail ? `${detail.categoryLabel}: ${description}${detail.members === true ? ' · Members' : ''}`
        : hit.pin.label || this.pins.categories.get(hit.pin.categoryId)?.label || 'Map icon');
    }
    const text = `${this.model.world.chunks.get(id).name}${this.model.preferences.advanced ? ` · ${id}` : ''}\n${status}${lines.length ? `\n${lines.join('\n')}` : ''}`;
    if (this.tooltip.textContent !== text) {
      this.tooltip.textContent = text;
      this.hoverCanvas.setAttribute('aria-description', text);
    }
    this.tooltip.style.whiteSpace = 'pre-line';
    this.tooltip.style.left = `${clamp(this.pointer.x + 16, 6, Math.max(6, this.width - (this.tooltip.offsetWidth || 260) - 6))}px`;
    this.tooltip.style.top = `${clamp(this.pointer.y + 16, 6, Math.max(6, this.height - (this.tooltip.offsetHeight || 60) - 6))}px`;
  }

  invalidate(base, state, hover) {
    this.dirty.base ||= base;
    this.dirty.state ||= state;
    this.dirty.pins ||= base || state;
    this.dirty.hover ||= hover;
    this.schedule();
  }

  schedule() {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  paint() {
    if (this.disposed) return;
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
    this.painting = true;
    try {
      if (Math.max(1, window.devicePixelRatio || 1) !== (this.deviceDpr ?? this.dpr)) this.resize();
      this.applyPointer();
      if (this.dirty.base) this.terrain?.setView(this.visibleBounds(), this.zoom, this.dpr);
      if (this.dirty.base) this.drawBase();
      const probe = globalThis.__rs3Perf;
      if (this.dirty.base && probe?.enabled && probe.events.length < 1000) {
        probe.terrainViewport = { bounds: this.visibleBounds(), zoom: this.zoom,
          visibleRegions: this.terrain?.visibleKeys.size ?? 0,
          nativePaths: [...(this.terrain?.visibleKeys ?? [])].map(key => this.terrain.tiles.get(key)?.path).filter(Boolean),
          selectedNativePaths: [...(this.terrain?.nativeKeys ?? [])].map(key => this.terrain.tiles.get(key)?.path).filter(Boolean),
          overviewPaths: [...new Set([...(this.terrain?.visibleKeys ?? [])]
            .map(key => this.terrain.overviewByTile.get(key)).filter(Boolean))]
            .map(key => this.terrain.overviewPages.get(key)?.path).filter(Boolean) };
        if (this.imageStatus === 'ready' || this.terrain?.committedKeys.size) probe.events.push({ name: 'terrain-drawn', time: performance.now() });
        if (this.terrain?.visibleKeys.size && this.terrain.viewLoaded()
          && [...this.terrain.visibleKeys].every(key => this.terrain.committedKeys.has(key) || this.terrain.failed.has(key))
          && !this.terrain.pageQueue.size && !this.terrain.previewQueue.size && !this.terrain.pageWorkScheduled) probe.events.push({ name: 'visible-tiles-loaded', time: performance.now(),
          visible: this.terrain.visibleKeys.size, failed: [...this.terrain.visibleKeys].filter(key => this.terrain.failed.has(key)).length });
      }
      if (this.dirty.state) this.drawState();
      if (this.searchLayer?.canvas) this.searchLayer.draw(this);
      if (this.dirty.pins) {
        this.drawPins();
        if (this.pointer && this.hoverId) this.setHover(this.hoverId);
      }
      if (this.dirty.hover) this.drawHover();
      this.dirty.base = this.dirty.state = this.dirty.pins = this.dirty.hover = false;
    } finally { this.painting = false; }
  }

  clear(context) {
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
  }

  visibleBounds() {
    return { left: clamp(-this.offset.x / this.zoom, 0, WORLD_WIDTH),
      top: clamp(-this.offset.y / this.zoom, 0, WORLD_HEIGHT),
      right: clamp((this.width - this.offset.x) / this.zoom, 0, WORLD_WIDTH),
      bottom: clamp((this.height - this.offset.y) / this.zoom, 0, WORLD_HEIGHT) };
  }

  drawTerrain(context, left, top, right, bottom, desaturated = false) {
    if (this.terrain?.tiles.size) {
      this.terrain.draw(context, { left, top, right, bottom }, { offset: this.offset, zoom: this.zoom, dpr: this.dpr, desaturated,
        fallback: (ctx, l, t, r, b) => this.drawLegacyTerrain(ctx, l, t, r, b) });
      return;
    }
    if (desaturated) context.filter = 'grayscale(0.6)';
    this.drawLegacyTerrain(context, left, top, right, bottom);
    context.filter = 'none';
  }

  drawLegacyTerrain(context, left, top, right, bottom) {
    if (this.imageStatus !== 'ready' || right <= left || bottom <= top) return;
    const sx = this.image.naturalWidth / WORLD_WIDTH;
    const sy = this.image.naturalHeight / WORLD_HEIGHT;
    context.drawImage(this.image, left * sx, top * sy, (right - left) * sx, (bottom - top) * sy,
      this.offset.x + left * this.zoom, this.offset.y + top * this.zoom,
      (right - left) * this.zoom, (bottom - top) * this.zoom);
  }

  drawBase() {
    const context = this.contexts[0];
    this.clear(context);
    const bounds = this.visibleBounds();
    const preferences = this.model?.preferences ?? {}, palette = themePalettes[preferences.theme] ?? themePalettes.dark;
    context.fillStyle = palette.mapBg ?? '#070b0e';
    context.fillRect(0, 0, this.width, this.height);
    // Locked land is desaturated as well as fogged so unlocked chunks read at a glance.
    this.drawTerrain(context, bounds.left, bounds.top, bounds.right, bounds.bottom, !preferences.highvis);
    context.filter = 'none';
    context.fillStyle = preferences.highvis ? palette.highvisFog : palette.fog;
    context.fillRect(this.offset.x + bounds.left * this.zoom, this.offset.y + bounds.top * this.zoom,
      (bounds.right - bounds.left) * this.zoom, (bounds.bottom - bounds.top) * this.zoom);
    context.beginPath();
    const cellSize = CELL * this.zoom;
    for (let x = Math.ceil(bounds.left / CELL); x <= Math.floor(bounds.right / CELL); x++) {
      const screenX = this.offset.x + x * cellSize;
      context.moveTo(screenX, this.offset.y + bounds.top * this.zoom);
      context.lineTo(screenX, this.offset.y + bounds.bottom * this.zoom);
    }
    for (let y = Math.ceil(bounds.top / CELL); y <= Math.floor(bounds.bottom / CELL); y++) {
      const screenY = this.offset.y + y * cellSize;
      context.moveTo(this.offset.x + bounds.left * this.zoom, screenY);
      context.lineTo(this.offset.x + bounds.right * this.zoom, screenY);
    }
    // Parchment needs a lighter rule than the dark themes to stay a grid rather than a cage.
    context.strokeStyle = palette.scheme === 'light' ? (preferences.highvis ? '#3a2e1a2e' : '#3a2e1a47') : preferences.highvis ? '#00000066' : '#0000008c';
    context.lineWidth = 1;
    if (!preferences.highvis || this.zoom > 0.3) context.stroke();
    if (this.imageStatus !== 'ready' && !this.terrain?.committedKeys.size
      && (!getArtStatus() || !['error', 'placeholder'].includes(this.imageStatus))) {
      context.fillStyle = '#0c131df2';
      context.fillRect(12, 74, Math.min(this.width - 24, 510), 48);
      context.fillStyle = '#e5edf3';
      context.font = '14px "Segoe UI", sans-serif';
      context.fillText(this.imageStatus === 'error' ? 'World artwork could not load. Chunk outlines remain usable.' : 'Loading world artwork…', 22, 103, Math.max(1, this.width - 44));
    }
  }

  eachVisibleCell(callback) {
    const bounds = this.visibleBounds();
    const minX = Math.floor(bounds.left / CELL), minY = Math.floor(bounds.top / CELL);
    const maxX = Math.min(SURFACE_GRID.columns - 1, Math.floor(bounds.right / CELL));
    const maxY = Math.min(SURFACE_GRID.rows - 1, Math.floor(bounds.bottom / CELL));
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const id = String(x * SURFACE_GRID.stride - y + SURFACE_GRID.startId);
      if (this.cells.has(id)) callback(id, x, y);
    }
  }

  drawState() {
    const context = this.contexts[1];
    this.clear(context);
    if (!this.model) return;
    const size = CELL * this.zoom;
    const { highvis, unlockedBorderColor, ids: showIds } = this.model.preferences;
    const cells = [];
    // Pass 1: a cached model path reveals terrain with ONE clipped viewport draw.
    this.eachVisibleCell((id, column, row) => {
      const { owners, selected, pending, candidate = false, colourPaint = null } = this.cellStates?.get(id) ?? {
        owners: this.visibleMembers.filter(owner => owner.unlockedSet.has(id)),
        selected: this.visibleMembers.filter(owner => owner.selectedRanks.has(id)),
        pending: this.visibleMembers.some(owner => owner.pendingSet.has(id)),
      };
      cells.push({ id, column, row, x: this.offset.x + column * size, y: this.offset.y + row * size, owners, selected, pending, candidate, colourPaint });
    });
    if (cells.some(cell => cell.owners.length || cell.selected.length || cell.pending || cell.candidate)) {
      context.save();
      if (this.revealPath) {
        context.setTransform(this.dpr * this.zoom, 0, 0, this.dpr * this.zoom, this.offset.x * this.dpr, this.offset.y * this.dpr);
        context.clip(this.revealPath);
        context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      } else {
        context.beginPath();
        for (const { x, y, owners, selected, pending, candidate } of cells) if (owners.length || selected.length || pending || candidate) context.rect(x, y, size, size);
        context.clip();
      }
      const bounds = this.visibleBounds();
      this.drawTerrain(context, bounds.left, bounds.top, bounds.right, bounds.bottom);
      context.restore();
    }
    // Personal tints sit above terrain and lock fog, below every border,
    // membership/roll highlight, label and sticker. They never reveal terrain.
    const colourAccents = size >= 80;
    const coloursBatched = (!colourAccents && drawChunkColourOverview(context, this.chunkColourOverview, this))
      || drawChunkColourLayer(context, this.chunkColourLayer, this);
    if (!coloursBatched || colourAccents) {
      for (const { x, y, colourPaint } of cells) if (colourPaint) {
        drawChunkColours(context, colourPaint, x, y, size, { fill: !coloursBatched, accents: colourAccents });
      }
    }
    // Availability stays inset from ownership borders and below map labels.
    if (this.availability) for (const { id, x, y } of cells) drawAvailabilityCell(context, this.availability, id, x, y, size);
    // Pass 2: restore the chunk grid over revealed terrain in one path.
    context.beginPath();
    for (const { x, y, owners, selected, pending, candidate } of cells) {
      if (!owners.length && !selected.length && !pending && !candidate) continue;
      context.moveTo(x, y); context.lineTo(x + size, y); context.lineTo(x + size, y + size);
      context.moveTo(x, y); context.lineTo(x, y + size); context.lineTo(x + size, y + size);
    }
    context.strokeStyle = '#00000059';
    context.lineWidth = 1;
    if (!highvis || this.zoom > 0.3) context.stroke();
    if (this.overlay === 'membership') this.drawMembership(context, cells, size);
    // Pass 3: candidate, selection and roll-choice fills, ownership tabs and labels.
    for (const { id, x, y, owners, selected, pending } of cells) {
      if (this.sandboxUnlocks?.has(id) || this.sandboxLocks?.has(id)) drawSandboxMarker(context, x, y, size, this.sandboxLocks.has(id));
      let color = null;
      const rank = this.candidateRanks?.get(id);
      const automaticOption = rank && (!this.active.selectedRanks.has(id) || this.model.state?.rules?.['roll.selected'] === false);
      if (selected.length) {
        context.fillStyle = highvis ? 'rgba(100,255,100,.22)' : 'rgba(100,255,100,.42)';
        context.fillRect(x, y, size, size);
        color = '#5fe35a';
      }
      if (automaticOption) {
        context.fillStyle = highvis ? 'rgba(110,190,255,.12)' : 'rgba(110,190,255,.18)';
        context.fillRect(x, y, size, size);
        color = '#8dcaff';
      }
      if (pending) {
        context.fillStyle = highvis ? 'rgba(255,230,90,.25)' : 'rgba(255,230,90,.48)';
        context.fillRect(x, y, size, size);
        color = '#ffe55c';
      }
      if (color) {
        context.strokeStyle = color;
        context.lineWidth = highvis ? 1 : pending ? 2.5 : 1.5;
        if (automaticOption) context.setLineDash([4, 3]);
        context.strokeRect(x + 1, y + 1, Math.max(0, size - 2), Math.max(0, size - 2));
        if (automaticOption) context.setLineDash([]);
      }
    }
    this.activityLayerRenderer?.draw(context, this, { ...this.activityLayerPreferences, theme: this.model.preferences.theme });
    // Inset activity outlines stay below every label and personal marker.
    for (const { id, x, y, owners, selected, pending } of cells) {
      const rank = this.candidateRanks?.get(id);
      // Group view marks only chunks that not every visible member owns.
      if (!this.pins && owners.length && owners.length < this.visibleMembers.length && size >= 12) this.drawOwnerTabs(context, owners, x, y, size, id);
      const idLayout = showIds && size >= 35 ? chunkIdLayout(this.visibleMembers, id, size,
        this.model.preferences.stickerScale, this.model.preferences.chunkIdScale) : null;
      if (rank && size >= 11) {
        // With chunk IDs on, the roll number stays above the ID line.
        const height = Math.max(1, size - 4 - (idLayout ? idLayout.fontSize + 4 : 0));
        const width = Math.max(1, size - 4);
        const fontSize = fitMapFont(context, String(rank), Math.max(11, Math.min(48, size * 0.5))
          * displayScale(this.model.preferences.rollNumberScale), width, height);
        const middle = y + 2 + height / 2 + fontSize * 0.04;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.lineWidth = Math.max(2.5, fontSize * 0.14);
        context.strokeStyle = '#0b2a0bcc';
        context.strokeText(String(rank), x + size / 2, middle, width);
        context.fillStyle = '#fff';
        context.fillText(String(rank), x + size / 2, middle, width);
      }
      if (idLayout) {
        const right = x + idLayout.idRight, width = Math.max(1, idLayout.idRight - 2);
        fitMapFont(context, id, idLayout.fontSize, width, size - 8);
        context.textAlign = 'right'; context.textBaseline = 'bottom';
        context.strokeStyle = '#000000b3'; context.lineWidth = 3;
        context.strokeText(id, right, y + size - 4, width);
        context.fillStyle = '#fff'; context.fillText(id, right, y + size - 4, width);
      }
      if (!this.pins) {
        this.drawMarkers(context, id, x, y, size);
        this.drawDeathMarker(context, id, x, y, size);
      }
    }
    this.drawUnlockedBorder(context, cells, size, unlockedBorderColor || '#FF0000', highvis);
    if (!this.pinContext) { this.drawTaskCounts(context); this.placeLabels?.draw(context); }
  }

  cellId(column, row) {
    if (column < 0 || row < 0 || column >= SURFACE_GRID.columns || row >= SURFACE_GRID.rows) return null;
    return String(column * SURFACE_GRID.stride - row + SURFACE_GRID.startId);
  }

  membership(id) {
    const { world } = this.model;
    return !world.walkable.has(id) ? null : world.f2p.has(id) ? 'f2p' : 'members';
  }

  /** Distinguishes unwalkable terrain and members land; free land stays untinted. */
  drawMembership(context, cells, size) {
    // Every unwalkable square gets the same treatment, including open ocean with no
    // chunk record, so the overlay never shows two tones of sea.
    const notWalkable = [];
    const bounds = this.visibleBounds();
    const maxX = Math.min(SURFACE_GRID.columns - 1, Math.floor(bounds.right / CELL)), maxY = Math.min(SURFACE_GRID.rows - 1, Math.floor(bounds.bottom / CELL));
    for (let column = Math.floor(bounds.left / CELL); column <= maxX; column++) for (let row = Math.floor(bounds.top / CELL); row <= maxY; row++) {
      const id = String(column * SURFACE_GRID.stride - row + SURFACE_GRID.startId);
      if (!this.model.world.walkable.has(id)) notWalkable.push({ x: this.offset.x + column * size, y: this.offset.y + row * size });
    }
    context.fillStyle = 'rgba(105,120,135,.2)';
    for (const { x, y } of notWalkable) context.fillRect(x, y, size, size);
    context.beginPath();
    for (const { x, y } of notWalkable) for (let c = 8; c < size; c += 12) {
      context.moveTo(x + 3, y + c); context.lineTo(x + size - 3, y + c);
    }
    context.strokeStyle = 'rgba(150,165,180,.3)';
    context.lineWidth = 1;
    context.setLineDash([1, 5]); context.stroke(); context.setLineDash([]);
    // A light wash plus diagonal hatching keeps members land distinct from yellow roll choices.
    const members = cells.filter(({ id }) => this.membership(id) === 'members');
    context.fillStyle = this.model.preferences.highvis ? 'rgba(255,150,40,.1)' : 'rgba(255,150,40,.16)';
    for (const { x, y } of members) context.fillRect(x, y, size, size);
    const spacing = clamp(size / 6, 5, 12);
    context.beginPath();
    for (const { x, y } of members) for (let c = spacing; c < size * 2; c += spacing) {
      const u = Math.min(c, size), v = Math.min(c, size);
      context.moveTo(x + u, y + c - u); context.lineTo(x + c - v, y + v);
    }
    context.strokeStyle = 'rgba(255,170,50,.55)';
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    for (const { id, column, row, x, y } of cells) {
      if (this.membership(id) !== 'members') continue;
      const f2p = (dx, dy) => { const other = this.cellId(column + dx, row + dy); return other !== null && this.cells.has(other) && this.membership(other) === 'f2p'; };
      if (f2p(0, -1)) { context.moveTo(x, y); context.lineTo(x + size, y); }
      if (f2p(0, 1)) { context.moveTo(x, y + size); context.lineTo(x + size, y + size); }
      if (f2p(-1, 0)) { context.moveTo(x, y); context.lineTo(x, y + size); }
      if (f2p(1, 0)) { context.moveTo(x + size, y); context.lineTo(x + size, y + size); }
    }
    context.strokeStyle = '#ffc94a';
    context.lineWidth = clamp(size * 0.02, 1.5, 2.5);
    context.setLineDash([6, 4]);
    context.stroke();
    context.setLineDash([]);
  }

  /** Outlines the outer edge of the visible unlocked area, like the original picker. */
  drawUnlockedBorder(context, cells, size, color, highvis) {
    context.beginPath();
    for (const { column, row, x, y, owners } of cells) {
      if (!owners.length) continue;
      const open = (dx, dy) => !this.unlocked.has(this.cellId(column + dx, row + dy));
      if (open(0, -1)) { context.moveTo(x, y); context.lineTo(x + size, y); }
      if (open(0, 1)) { context.moveTo(x, y + size); context.lineTo(x + size, y + size); }
      if (open(-1, 0)) { context.moveTo(x, y); context.lineTo(x, y + size); }
      if (open(1, 0)) { context.moveTo(x + size, y); context.lineTo(x + size, y + size); }
    }
    context.lineCap = 'square';
    context.strokeStyle = '#000000a6';
    context.lineWidth = (highvis ? 2 : clamp(size * 0.028, 2, 3.5)) + 2;
    context.stroke();
    context.strokeStyle = color;
    context.lineWidth = highvis ? 2 : clamp(size * 0.028, 2, 3.5);
    context.stroke();
    context.lineCap = 'butt';
  }

  /** Corner tabs in each owner's colour; a letter appears once the tab can hold one. */
  drawOwnerTabs(context, owners, x, y, size, id) {
    // Small and slightly translucent so the tab does not hide terrain in the corner.
    const tab = clamp(size * 0.13, 6, 18);
    owners.forEach((owner, index) => {
      const left = x + index * tab * 0.8;
      context.beginPath();
      context.moveTo(left, y); context.lineTo(left + tab, y); context.lineTo(left, y + tab); context.closePath();
      context.globalAlpha = owner.id !== this.active.id && this.connections.byChunk[id]?.connected === false ? 0.3 : 0.85;
      context.fillStyle = owner.color;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = '#000000a6';
      context.lineWidth = 1;
      context.stroke();
      if (tab >= 17) {
        context.font = `bold ${Math.round(tab * 0.5)}px Calibri, "Segoe UI", sans-serif`;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillStyle = '#071017';
        context.fillText(owner.name.slice(0, 1), left + tab * 0.3, y + tab * 0.3);
      }
    });
  }

  markerImage(type) {
    const url = stickerAsset(type);
    if (!url) return null;
    if (!this.markerImages.has(type)) {
      const image = new Image(), entry = { image, loaded: false, failed: false };
      image.onload = () => { if (this.disposed) return; entry.loaded = true; this.invalidate(false, true, false); };
      image.onerror = () => { entry.failed = true; if (!this.disposed) this.invalidate(false, true, false); };
      this.markerImages.set(type, entry);
      image.src = url;
    }
    const entry = this.markerImages.get(type);
    return entry.loaded ? entry.image : null;
  }

  drawMarkers(context, id, x, y, size) {
    if (size < 18) return;
    const scale = displayScale(this.model?.preferences?.stickerScale);
    const prefs = this.model?.preferences ?? {};
    const idLayout = prefs.ids && size >= 35 ? chunkIdLayout(this.visibleMembers, id, size, scale, prefs.chunkIdScale) : null;
    const flagLift = idLayout?.flagLift ?? 0;
    const { markers, overflow } = layoutStickerCluster(this.visibleMembers, id, size, scale, flagLift);
    const showOwner = this.visibleMembers.length > 1;
    const paint = (marker, owner, left, top, markerSize) => {
      const image = marker.start ? null : this.markerImage(marker.type);
      if (image) context.drawImage(image, left, top, markerSize, markerSize);
      else {
        context.font = `900 ${markerSize}px ${stickerFont(marker.type)}`;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.lineWidth = Math.max(2.5, markerSize * 0.16); context.strokeStyle = '#000000d9';
        const glyph = stickerGlyph(marker.type);
        context.strokeText(glyph, left + markerSize / 2, top + markerSize / 2);
        context.fillStyle = marker.color;
        context.fillText(glyph, left + markerSize / 2, top + markerSize / 2, markerSize);
      }
      // In group view a short bar under each marker names whose marker it is.
      if (showOwner) {
        context.fillStyle = '#000000b3';
        context.fillRect(left, top + markerSize, markerSize, 4);
        context.fillStyle = owner.color;
        context.fillRect(left, top + markerSize + 1, markerSize, 2);
      }
    };
    for (const marker of markers) paint(marker.sticker, marker.owner, x + marker.x, y + marker.y, marker.size);
    if (overflow) {
      context.fillStyle = '#071017e6';
      context.fillRect(x + overflow.x, y + overflow.y, overflow.width, overflow.height);
      context.font = `bold ${Math.max(7, overflow.height - 2)}px Calibri, "Segoe UI", sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#ffffff';
      context.fillText(`+${overflow.count}`, x + overflow.x + overflow.width / 2, y + overflow.y + overflow.height / 2, overflow.width);
    }
    // Starting flags remain separate annotations, outside the sticker count.
    const starting = this.visibleMembers.filter(owner => owner.startingChunk === id);
    const startSize = idLayout ? idLayout.flagSize : startingFlagSize(this.visibleMembers, id, size, scale);
    const pad = Math.min(4, size * .1);
    if (size >= 30 || (!markers.length && !overflow)) starting.forEach((owner, index) => paint({ type: 'flag', color: '#00ff00', start: true }, owner,
      x + size - pad - startSize - index * (startSize + 2), y + size - pad - startSize - (showOwner ? 4 : 0) - flagLift, startSize));
  }

  drawDeathMarker(context, id, x, y, size) {
    if (!this.deathMarkers.has(id) || size < 20) return;
    const markerSize = Math.max(12, Math.min(30, size * 0.27));
    context.font = `bold ${markerSize}px "Segoe UI Symbol", sans-serif`;
    context.textAlign = 'left'; context.textBaseline = 'bottom';
    context.strokeStyle = '#1a0914'; context.lineWidth = Math.max(3, markerSize * 0.15);
    context.strokeText('\u2620', x + 4, y + size - 3);
    context.fillStyle = '#ffe3ea'; context.fillText('\u2620', x + 4, y + size - 3);
  }

  drawHover() {
    const context = this.contexts[2];
    this.clear(context);
    if (this.searchLayer && !this.searchLayer.canvas) this.searchLayer.draw(this, context, true);
    this.drawConnectionLines(context);
    this.drawSectionHighlight(context);
    drawGamePluginPositions(context, this, surfaceCoordinates);
    this.drawOpenChunk(context);
    this.pointerTool?.draw(context);
    const point = this.cells.get(this.hoverId);
    if (!point) return;
    const size = CELL * this.zoom;
    const x = this.offset.x + point.x * size, y = this.offset.y + point.y * size;
    context.fillStyle = '#ffffff20';
    context.fillRect(x, y, size, size);
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, Math.max(0, size - 2), Math.max(0, size - 2));
  }

  /** The chunk whose info panel is open: cyan corner brackets, unlike hover (white), selected (green) or roll choice (yellow). */
  drawOpenChunk(context) {
    const point = this.cells.get(this.connectionChunkId);
    if (!point) return;
    const size = CELL * this.zoom;
    const x = this.offset.x + point.x * size, y = this.offset.y + point.y * size;
    const inset = 2.5, arm = Math.max(6, size * 0.3), right = x + size - inset, bottom = y + size - inset;
    const left = x + inset, top = y + inset;
    context.save(); context.beginPath();
    context.rect(left, top, Math.max(0, size - inset * 2), Math.max(0, size - inset * 2));
    context.strokeStyle = '#0b1a24b0'; context.lineWidth = 4; context.stroke();
    context.strokeStyle = '#5cd6ff'; context.lineWidth = 1.5; context.stroke();
    context.beginPath();
    for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]]) {
      context.moveTo(cx + dx * arm, cy); context.lineTo(cx, cy); context.lineTo(cx, cy + dy * arm);
    }
    context.lineCap = 'square'; context.strokeStyle = '#0b1a24'; context.lineWidth = 6; context.stroke();
    context.strokeStyle = '#5cd6ff'; context.lineWidth = 3.5; context.stroke();
    context.restore();
  }

  drawPins() {
    if (!this.pinContext) return;
    this.clear(this.pinContext);
    this.pins?.draw(this.pinContext, { bounds: this.visibleBounds(), offset: this.offset, zoom: this.zoom,
      unlocked: this.unlocked, width: this.width, height: this.height, dpr: this.dpr,
      textLabels: this.model?.preferences.showPlaceNames !== false && !this.placeLabels?.labels.length });
    this.drawTaskCounts(this.pinContext);
    this.placeLabels?.draw(this.pinContext);
    // Keep personal map annotations above imported symbols without repainting terrain.
    if (!this.pins || !this.model) return;
    const size = CELL * this.zoom;
    const tabs = this.visibleMembers.length > 1 && size >= 12;
    const markers = size >= 18 && this.visibleMembers.some(owner => owner.startingChunk || Object.keys(owner.stickers).length);
    const deaths = size >= 20 && this.deathMarkers.size > 0;
    if (!tabs && !markers && !deaths) return;
    this.eachVisibleCell((id, column, row) => {
      const x = this.offset.x + column * size, y = this.offset.y + row * size;
      if (tabs) {
        const owners = this.cellStates?.get(id)?.owners ?? this.visibleMembers.filter(owner => owner.unlockedSet.has(id));
        if (owners.length && owners.length < this.visibleMembers.length) this.drawOwnerTabs(this.pinContext, owners, x, y, size, id);
      }
      if (markers) this.drawMarkers(this.pinContext, id, x, y, size);
      if (deaths) this.drawDeathMarker(this.pinContext, id, x, y, size);
    });
  }

  drawTaskCounts(context) {
    const counts = this.visibleTaskCounts ?? this.taskCounts;
    this.taskCountPlacements = [];
    if (!counts?.size || !this.model || this.model.preferences.showTaskCounts === false) return;
    const key = [this.cellStates, this.model.preferences, this.zoom, this.deathMarkers, this.deathMarkers.size];
    if (!this.taskCountScene || key.some((value, index) => value !== this.taskCountScene.key[index])) {
      const previous = this.taskCountScene;
      const sceneKey = previous && key.every((value, index) => index === 2 || value === previous.key[index]) ? previous.sceneKey : {};
      const annotationCells = previous?.sceneKey === sceneKey ? previous.annotationCells : taskCountAnnotationCells(this);
      this.taskCountScene = { key, sceneKey, annotationCells,
        obstacles: taskCountObstacles(this, { chunkIdLayout, layoutStickerCluster, startingFlagSize }, annotationCells) };
    }
    this.taskCountPlacements = this.taskCountRenderer.draw(context, { counts, cells: this.cells, offset: this.offset,
      zoom: this.zoom, width: this.width, height: this.height, scale: this.model.preferences.taskCountScale,
      worldObstacles: this.taskCountScene.obstacles, sceneKey: this.taskCountScene.sceneKey, dpr: this.dpr });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTouchGesture();
    this.chunkHold.dispose();
    this.chunkTerrainListeners.clear();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.listeners.forEach(remove => remove());
    this.image.onload = this.image.onerror = null;
    this.terrain?.dispose();
    this.pins?.dispose();
    this.searchLayer?.dispose();
    this.activityLayerRenderer?.dispose();
    for (const { image } of this.markerImages.values()) image.onload = image.onerror = null;
    this.markerImages.clear();
    this.taskCountRenderer?.clear();
    this.placeLabels?.dispose();
    this.taskCounts = this.visibleTaskCounts = new Map();
    this.taskCountScene = null;
    this.availability = null;
    this.chunkColourLayer = null;
    releaseChunkColourOverview(this.chunkColourOverview);
    this.chunkColourOverview = null;
    this.tooltip.hidden = true;
    this.hoverCanvas.classList.remove('dragging');
    if (this.drag && this.hoverCanvas.hasPointerCapture(this.drag.pointerId)) this.hoverCanvas.releasePointerCapture(this.drag.pointerId);
    this.drag = null;
  }
}
