import { CHUNK_COLOURS, LEGACY_CHUNK_COLOURS } from '../core/chunk-colours.mjs';
import { readableColor, themePalettes } from './map-tools.mjs';

const definitions = new Map([...LEGACY_CHUNK_COLOURS, ...CHUNK_COLOURS].map(colour => [colour.id, colour]));
const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')},${alpha})`;

/** Theme-dependent styles are resolved once with the model, never on a pan frame. */
export function chunkColourStyles(preferences = {}) {
  const palette = themePalettes[preferences.theme] ?? themePalettes.dark;
  const background = palette.mapBg ?? palette.bg;
  return new Map([...definitions].map(([id, colour]) => [id, {
    id, color: colour.color, label: colour.label,
    fill: rgba(colour.color, preferences.highvis ? .2 : .3),
    accent: readableColor(colour.color, background, 3),
    backing: palette.scheme === 'light' ? '#ffffffb3' : '#10151ab3',
  }]));
}

/**
 * A model-time cell annotation. Shared colours paint once; hover retains every
 * owner's own names and inherited order. Legacy palettes have at most eight IDs.
 */
export function chunkColourPaint(members, chunkId, styles) {
  const segments = [], seen = new Set(), descriptions = [];
  for (const owner of members) {
    const colours = owner.chunkColours?.[chunkId] ?? [];
    const names = [];
    for (const id of colours) {
      const style = styles.get(id);
      if (!style) continue;
      names.push(owner.chunkColourNames?.[id] ?? style.label);
      if (!seen.has(id)) { seen.add(id); segments.push(style); }
    }
    if (names.length) descriptions.push(`${owner.name}: colour · ${names.join(', ')}`);
  }
  return segments.length ? { segments, descriptions } : null;
}

/** Cache world-space rectangles by palette ID once when the model changes. */
export function createChunkColourLayer(cells, cellStates, cellSize = 128) {
  if (typeof Path2D !== 'function') return null;
  const layers = new Map();
  for (const [id, { colourPaint }] of cellStates) {
    if (!colourPaint) continue;
    const point = cells.get(id);
    if (!point) continue;
    const count = colourPaint.segments.length;
    for (let index = 0; index < count; index++) {
      const style = colourPaint.segments[index];
      if (!layers.has(style.id)) layers.set(style.id, { style, path: new Path2D() });
      layers.get(style.id).path.rect((point.x + index / count) * cellSize,
        point.y * cellSize, cellSize / count, cellSize);
    }
  }
  return [...layers.values()];
}

/** At most eight fills, clipped by the viewport canvas, regardless of cell count. */
export function drawChunkColourLayer(context, layers, { offset, zoom, dpr }) {
  if (!layers) return false;
  if (layers.length) {
    context.save();
    context.setTransform(dpr * zoom, 0, 0, dpr * zoom, offset.x * dpr, offset.y * dpr);
    for (const { style, path } of layers) {
      context.fillStyle = style.fill;
      context.fill(path);
    }
    context.restore();
  }
  return true;
}

/** One small transparent overview, capped at 752 × 800 for the surface grid. */
export function createChunkColourOverview(layers, width, height) {
  if (!layers?.length || typeof OffscreenCanvas !== 'function') return null;
  const density = 1 / 8;
  const canvas = new OffscreenCanvas(Math.ceil(width * density), Math.ceil(height * density));
  const context = canvas.getContext('2d');
  if (!context) { canvas.width = canvas.height = 0; return null; }
  context.setTransform(density, 0, 0, density, 0, 0);
  for (const { style, path } of layers) {
    context.fillStyle = style.fill;
    context.fill(path);
  }
  return { canvas, width, height };
}

export function releaseChunkColourOverview(overview) {
  if (overview?.canvas) overview.canvas.width = overview.canvas.height = 0;
}

/** One viewport-clipped blit replaces repeated palette geometry at overview zoom. */
export function drawChunkColourOverview(context, overview, { offset, zoom }) {
  if (!overview) return false;
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(overview.canvas, offset.x, offset.y, overview.width * zoom, overview.height * zoom);
  context.restore();
  return true;
}

/** Bounded translucent slices leave terrain, lock fog and later annotations visible. */
export function drawChunkColours(context, paint, x, y, size, { fill = true, accents = true } = {}) {
  if (!paint?.segments.length || !Number.isFinite(size) || size <= 0) return;
  const count = paint.segments.length;
  for (let index = 0; index < count; index++) {
    const style = paint.segments[index], left = x + size * index / count;
    const width = size * (index + 1) / count - (left - x);
    if (fill) {
      context.fillStyle = style.fill;
      context.fillRect(left, y, width, size);
    }
    // Insets leave the chunk's perimeter to ownership and roll highlights. Tiny
    // overview cells keep only the wash rather than crowding their terrain.
    if (!accents || width < 12 || size < 18) continue;
    const inset = Math.min(4, width * .15, size * .1);
    const rect = [left + inset, y + inset, width - inset * 2, size - inset * 2];
    context.strokeStyle = style.backing; context.lineWidth = 3;
    context.strokeRect(...rect);
    context.strokeStyle = style.accent; context.lineWidth = 1.5;
    context.strokeRect(...rect);
  }
}
