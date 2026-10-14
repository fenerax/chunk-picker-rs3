const GRID_SIZE = 64;
const MASK_BYTES = 512;
const MASK_ENCODING = 'base64-bitset-lsb0-y64+x';
const COLORS = ['#56B4E9', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#F0E442', '#0072B2', '#999999'];
export function sectionColor(index) {
  const base = COLORS[index % COLORS.length], tier = Math.floor(index / COLORS.length);
  if (!tier) return base;
  // Larger fragment lists use light and dark variants of the same safe hue
  // families. Numbers remain the identifier at every list size.
  const amount = 1 - 0.78 ** Math.ceil(tier / 2), target = tier % 2 ? 0 : 255;
  return `#${[1, 3, 5].map(start => Math.round(parseInt(base.slice(start, start + 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('')}`;
}
const decodedMasks = new WeakMap();
const geometryMessages = {
  'selector-correspondence-unresolved': 'This section has no verified tile mapping.',
  'geometry-bundle-missing': 'Section outlines are not installed on this server.',
  'geometry-bundle-invalid': 'The installed outlines do not match this map version.',
  'cache-walking-unavailable': 'Walkable tile outlines are not available for this map.',
  'component-mask-unavailable': 'No verified tile outline is available for this area.',
};

/** Decode only the documented local x-east/y-north tile mask. Unknown geometry
 * stays unknown rather than acquiring an approximate outline. */
export function decodeSectionMask(mask) {
  if (!mask || typeof mask !== 'object' || mask.encoding !== MASK_ENCODING || typeof mask.data !== 'string') return null;
  if (decodedMasks.has(mask)) return decodedMasks.get(mask);
  let bytes = null;
  if (/^[A-Za-z0-9+/]{683}=$/.test(mask.data)) {
    try {
      const binary = atob(mask.data);
      if (binary.length === MASK_BYTES) bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch { /* A malformed base64 value is not a tile boundary. */ }
  }
  decodedMasks.set(mask, bytes);
  return bytes;
}

function maskBytes(mask) {
  return mask instanceof Uint8Array && mask.length === MASK_BYTES ? mask : decodeSectionMask(mask);
}
function hasTile(bytes, x, y) {
  if (!bytes || x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return false;
  const bit = y * GRID_SIZE + x;
  return Boolean(bytes[bit >>> 3] & (1 << (bit & 7)));
}
function tileCount(bytes) {
  let count = 0;
  for (const byte of bytes) for (let value = byte; value; value &= value - 1) count++;
  return count;
}

/** Local grid-edge coordinates, with y increasing north. Shared tile edges are
 * omitted. The main map applies its own world-to-screen transform. */
export function sectionBoundarySegments(mask) {
  const bytes = maskBytes(mask), segments = [];
  if (!bytes) return segments;
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    if (!hasTile(bytes, x, y)) continue;
    if (!hasTile(bytes, x, y - 1)) segments.push([[x, y], [x + 1, y]]);
    if (!hasTile(bytes, x + 1, y)) segments.push([[x + 1, y], [x + 1, y + 1]]);
    if (!hasTile(bytes, x, y + 1)) segments.push([[x + 1, y + 1], [x, y + 1]]);
    if (!hasTile(bytes, x - 1, y)) segments.push([[x, y + 1], [x, y]]);
  }
  return segments;
}

function displayNumber(section, index) {
  return section.displayNumber ?? (section.kind === 'cache-component' ? `C${index + 1}` : String(section.id).split('-').at(-1));
}
function labelTile(section, bytes) {
  const point = section.labelPoint;
  if (Number.isFinite(point?.x) && Number.isFinite(point?.y) && hasTile(bytes, Math.floor(point.x), Math.floor(point.y))) {
    return { x: Number.isInteger(point.x) ? point.x + 0.5 : point.x, y: Number.isInteger(point.y) ? point.y + 0.5 : point.y };
  }
  // Choose the tile nearest the component's centre when no certified label is
  // present. This positions a badge only; it never changes the tile mask.
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (hasTile(bytes, x, y)) { sumX += x + 0.5; sumY += y + 0.5; count++; }
  if (!count) return null;
  const centreX = sumX / count, centreY = sumY / count;
  let best = null, distance = Infinity;
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (hasTile(bytes, x, y)) {
    const next = (x + 0.5 - centreX) ** 2 + (y + 0.5 - centreY) ** 2;
    if (next < distance) { best = { x: x + 0.5, y: y + 0.5 }; distance = next; }
  }
  return best;
}

/** Draw over the terrain crop without clearing it. A tile gets one colour:
 * smaller sections take precedence over aggregate section 0, and a highlighted
 * section takes precedence over both. Duplicate masks retain separate badges. */
export function drawSectionOverlay(ctx, sections, { size = 256, highlightedId = null } = {}) {
  const tileSize = size / GRID_SIZE;
  let cacheNumber = 0;
  const exact = sections.map((section, index) => {
    const number = section.kind === 'cache-component' ? section.displayNumber ?? `C${++cacheNumber}` : displayNumber(section, index);
    const bytes = section.geometryStatus === 'exact' ? maskBytes(section.mask) : null;
    return bytes ? { section, bytes, count: tileCount(bytes), color: section.color ?? sectionColor(index), number } : null;
  }).filter(row => row?.count > 0);
  const ordered = [...exact].sort((a, b) => (a.section.id === highlightedId ? -1 : b.section.id === highlightedId ? 1 : a.count - b.count));
  ctx.save();
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    const owner = ordered.find(row => hasTile(row.bytes, x, y));
    if (!owner) continue;
    ctx.fillStyle = owner.color;
    ctx.globalAlpha = highlightedId ? owner.section.id === highlightedId ? 0.55 : 0.12 : 0.28;
    ctx.fillRect(x * tileSize, (GRID_SIZE - 1 - y) * tileSize, tileSize, tileSize);
  }
  // Aggregate boundaries sit beneath the smaller component boundaries.
  const outlines = [...exact].sort((a, b) => b.count - a.count);
  for (const row of outlines.filter(row => row.section.id !== highlightedId).concat(outlines.filter(row => row.section.id === highlightedId))) {
    ctx.strokeStyle = row.color;
    ctx.globalAlpha = highlightedId && row.section.id !== highlightedId ? 0.4 : 1;
    ctx.lineWidth = row.section.id === highlightedId ? 2.5 : 1;
    ctx.beginPath();
    for (const [[x1, y1], [x2, y2]] of sectionBoundarySegments(row.bytes)) {
      ctx.moveTo(x1 * tileSize, (GRID_SIZE - y1) * tileSize);
      ctx.lineTo(x2 * tileSize, (GRID_SIZE - y2) * tileSize);
    }
    ctx.stroke();
  }
  const badges = [];
  for (const row of outlines) {
    const point = labelTile(row.section, row.bytes);
    if (!point) continue;
    const width = Math.max(22, String(row.number).length * 8 + 12), height = 22;
    let x = Math.min(size - width / 2 - 2, Math.max(width / 2 + 2, point.x * tileSize));
    let y = Math.min(size - height / 2 - 2, Math.max(height / 2 + 2, (GRID_SIZE - point.y) * tileSize));
    const anchor = { x, y };
    // Shared unions can have the same label point. Move their badge, retaining
    // a leader to the certified location, so every number stays readable.
    for (let attempt = 0; attempt < 100 && badges.some(b => Math.abs(x - b.x) < (width + b.width) / 2 + 3 && Math.abs(y - b.y) < height + 3); attempt++) {
      const ring = Math.floor(attempt / 8) + 1, angle = (attempt % 8) * Math.PI / 4;
      x = Math.min(size - width / 2 - 2, Math.max(width / 2 + 2, anchor.x + Math.cos(angle) * ring * (width + 4)));
      y = Math.min(size - height / 2 - 2, Math.max(height / 2 + 2, anchor.y + Math.sin(angle) * ring * (height + 4)));
    }
    ctx.globalAlpha = 1;
    if (x !== anchor.x || y !== anchor.y) {
      ctx.strokeStyle = row.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.fillStyle = '#15202b'; ctx.fillRect(x - width / 2, y - height / 2, width, height);
    ctx.strokeStyle = row.color; ctx.lineWidth = row.section.id === highlightedId ? 3 : 2; ctx.strokeRect(x - width / 2, y - height / 2, width, height);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px Calibri, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(row.number), x, y);
    badges.push({ x, y, width });
  }
  ctx.restore();
}

/** Immediate retained controls plus asynchronously loaded, verified geometry.
 * Disposal releases terrain subscriptions and prevents late request updates. */
export function createChunkSections({ document = globalThis.document, canWrite = () => true, chunkId, topologyKeys = [], overrides = {}, load, onOverride = async () => {}, onHighlight = () => {}, drawTerrain, subscribeTerrain } = {}) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const element = make('div', 'chunk-sections');
  const map = make('div', 'chunk-section-map'), canvas = make('canvas', 'chunk-section-canvas');
  canvas.width = 256; canvas.height = 256; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Section outlines for chunk ${chunkId}, north at the top. Numbers match the section list.`);
  canvas.textContent = 'Section outlines are also described in the list below.';
  map.append(canvas, make('span', 'chunk-section-north', 'N ↑'));
  const status = make('p', 'chunk-section-status', 'Loading section outlines…'); status.setAttribute('role', 'status');
  const retry = make('button', 'chunk-section-retry', 'Retry outlines'); retry.type = 'button'; retry.hidden = true;
  const intro = make('p', 'chunk-section-intro', 'Choose whether each section counts as reachable. Automatic uses your current access rules.');
  const list = make('ul', 'chunk-section-list');
  element.append(map, status, retry, intro, list);
  const rows = new Map(), listeners = [];
  let sections = [], disposed = false, request = 0, hoveredId = null, focusedId = null, highlightedId = null;
  const listen = (node, type, callback) => { node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback)); };
  let ctx;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  function redraw() {
    if (disposed || !ctx) return;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#17212a'; ctx.fillRect(0, 0, 256, 256);
    if (drawTerrain) drawTerrain(ctx, 256);
    drawSectionOverlay(ctx, sections, { size: 256, highlightedId });
  }
  function highlight(force = false) {
    const next = hoveredId ?? focusedId;
    if (!force && next === highlightedId) return;
    highlightedId = next;
    for (const [id, row] of rows) row.element.classList.toggle('chunk-section-highlighted', id === next);
    redraw(); onHighlight(sections.find(section => section.id === next) ?? null);
  }
  function addRow(section, controlled) {
    const row = make('li', 'chunk-section-row'); row.dataset.sectionId = section.id; row.tabIndex = 0;
    const badge = make('span', 'chunk-section-badge', section.displayNumber); badge.style.setProperty('--section-color', section.color); badge.setAttribute('aria-hidden', 'true');
    const body = make('div', 'chunk-section-body');
    const name = make('span', 'chunk-section-name', controlled ? `Section ${section.displayNumber}` : `Walkable area ${section.displayNumber.slice(1)}`);
    const detail = make('p', 'chunk-section-detail', 'Loading outline…');
    body.append(name, detail); row.append(badge, body);
    const record = { element: row, badge, detail, controlled, section };
    if (controlled) {
      const label = make('label', 'chunk-section-control'), labelText = make('span', 'chunk-section-control-label', `Section ${section.displayNumber} access`), select = make('select', 'chunk-section-select');
      for (const [value, text] of [['auto', 'Automatic'], ['true', 'Accessible'], ['false', 'Blocked']]) { const option = make('option', '', text); option.value = value; select.append(option); }
      select.value = overrides[section.id] === true ? 'true' : overrides[section.id] === false ? 'false' : 'auto';
      select.disabled = !canWrite();
      label.append(labelText, select); row.append(label); record.select = select;
      let saved = select.value;
      listen(select, 'change', async () => {
        if (!canWrite()) { select.value = saved; return; }
        const value = select.value; select.disabled = true;
        try {
          await onOverride(section.id, value === 'auto' ? null : value === 'true');
          saved = value;
          if (!disposed) { record.error?.remove(); record.error = null; }
        } catch {
          if (!disposed) {
            select.value = saved;
            if (!record.error) { record.error = make('p', 'chunk-section-save-error', 'Access override could not be saved. Try again.'); record.error.setAttribute('role', 'alert'); row.append(record.error); }
          }
        } finally { if (!disposed) select.disabled = !canWrite(); }
      });
    }
    listen(row, 'pointerenter', () => { hoveredId = section.id; highlight(); });
    listen(row, 'pointerleave', () => { if (hoveredId === section.id) hoveredId = null; highlight(); });
    listen(row, 'focusin', () => { focusedId = section.id; highlight(); });
    listen(row, 'focusout', event => { if (row.contains(event.relatedTarget)) return; if (focusedId === section.id) focusedId = null; highlight(); });
    rows.set(section.id, record); list.append(row);
    return record;
  }
  const keys = [...new Set(topologyKeys.map(key => String(key).startsWith(`${chunkId}-`) ? String(key) : `${chunkId}-${key}`))];
  for (const [index, id] of keys.entries()) {
    const section = { id, kind: 'retained-section', retainedSectionIds: [id], cacheComponentIds: [], mask: null, labelPoint: null, walkableTileCount: null, description: '', geometryStatus: 'unknown', geometryReason: 'Geometry has not loaded yet.', color: sectionColor(index), displayNumber: id.slice(String(chunkId).length + 1) };
    sections.push(section); addRow(section, true);
  }
  if (!keys.length) intro.textContent = 'Walkable areas are shown for reference. This chunk has no section access choices.';
  function applyPayload(payload) {
    if (payload?.schemaVersion !== 1 || String(payload.chunkId) !== String(chunkId) || payload.gridSize !== GRID_SIZE || payload.coordinateSystem !== 'local-x-east-y-north' || !Array.isArray(payload.sections)) throw new Error('Unsupported section geometry');
    const source = new Map(payload.sections.filter(section => section && typeof section.id === 'string').map(section => [section.id, section]));
    let cacheNumber = 0;
    const normalized = sections.filter(section => rows.get(section.id).controlled).map(section => ({ ...section, ...(source.get(section.id)?.kind === 'retained-section' ? source.get(section.id) : {}), id: section.id, kind: 'retained-section', color: section.color, displayNumber: section.displayNumber }));
    for (const candidate of source.values()) {
      if (candidate.kind !== 'cache-component' || rows.get(candidate.id)?.controlled) continue;
      normalized.push({ ...candidate, color: sectionColor(normalized.length), displayNumber: `C${++cacheNumber}` });
    }
    for (const section of normalized) {
      const bytes = section.geometryStatus === 'exact' ? decodeSectionMask(section.mask) : null;
      if (!bytes || tileCount(bytes) === 0) {
        section.geometryStatus = 'unknown'; section.mask = null; section.labelPoint = null;
        section.geometryReason = typeof section.geometryReason === 'string' && section.geometryReason !== 'Geometry has not loaded yet.' ? section.geometryReason : 'No verified outline is available for this section.';
      }
      let row = rows.get(section.id);
      if (!row) row = addRow(section, false);
      row.section = section;
      const description = typeof section.description === 'string' ? section.description.trim() : '';
      row.detail.textContent = section.geometryStatus === 'exact'
        ? `${tileCount(bytes).toLocaleString()} walkable tiles.${description ? ` ${description}` : ''}${row.controlled ? '' : ' Map only; no access choice.'}`
        : `Outline unavailable. ${geometryMessages[section.geometryReason] ?? 'No verified outline is available for this section.'}${description ? ` ${description}` : ''}`;
      row.element.classList.toggle('chunk-section-unknown', section.geometryStatus !== 'exact');
    }
    sections = normalized;
    const known = sections.filter(section => section.geometryStatus === 'exact').length;
    status.textContent = known ? `${known} verified ${known === 1 ? 'outline' : 'outlines'}. Numbers match the list; some sections may share tiles.${sections.length > known ? ' Unverified sections have no outline.' : ''}` : 'No verified section outlines are available. Access overrides remain available.';
    highlight(true);
  }
  async function reload() {
    const current = ++request;
    retry.hidden = true; status.textContent = 'Loading section outlines…';
    try {
      const payload = await load();
      if (!disposed && request === current) applyPayload(payload);
    } catch {
      if (disposed || request !== current) return;
      status.textContent = 'Section outlines could not be loaded. Access overrides remain available.';
      retry.hidden = false;
      for (const row of rows.values()) if (row.section.geometryStatus !== 'exact') { row.detail.textContent = 'The section outline could not be loaded.'; row.element.classList.add('chunk-section-unknown'); }
    }
  }
  listen(retry, 'click', reload);
  redraw();
  const unsubscribe = subscribeTerrain?.(redraw);
  Promise.resolve().then(() => { if (!disposed) return reload(); });
  return { element, dispose() {
    if (disposed) return;
    disposed = true; request++; listeners.forEach(remove => remove());
    if (typeof unsubscribe === 'function') unsubscribe();
    onHighlight(null);
  } };
}
