import { gameToWorld } from '../data/map-pins.mjs';

export const TRAVEL_LINES_KEY = 'picker.travelLines';
// Colour and rhythm both identify the transport: the casing keeps lines visible on terrain.
export const TRAVEL_LINE_TYPES = Object.freeze([
  { id: 'ship', label: 'Ship', color: '#56b4e9', lightColor: '#0072b2', dash: [10, 5] },
  { id: 'canoe', label: 'Canoe', color: '#37c99b', lightColor: '#007b58', dash: [3, 4] },
  { id: 'carpet', label: 'Carpet', color: '#e69f00', lightColor: '#995e00', dash: [12, 4, 3, 4] },
  { id: 'teleport', label: 'Teleport / portal', color: '#cc79a7', lightColor: '#985182', dash: [2, 4, 2, 4, 10, 4] },
  { id: 'other', label: 'Other / unclassified', color: '#ffd36b', lightColor: '#746000', dash: [6, 4] },
].map(value => Object.freeze({ ...value, dash: Object.freeze(value.dash) })));
export function travelLineType(edge) {
  const kind = edge?.kind;
  const description = `${edge?.id ?? ''} ${edge?.label ?? ''}`.toLowerCase();
  const id = ['boat', 'ship'].includes(kind) ? 'ship' : kind === 'canoe' ? 'canoe'
    : kind === 'carpet' || kind === 'transport' && /\bcarpet\b/.test(description) ? 'carpet'
    : ['teleport', 'lodestone', 'portal'].includes(kind) ? 'teleport' : 'other';
  return TRAVEL_LINE_TYPES.find(type => type.id === id);
}
export function readTravelLines(storage) {
  try { return storage?.getItem(TRAVEL_LINES_KEY) !== 'false'; } catch { return true; }
}
export function writeTravelLines(storage, visible) {
  try { storage?.setItem(TRAVEL_LINES_KEY, String(visible !== false)); } catch { /* This viewer's preference only. */ }
}

/** Native controls and a redundant dash key; independent of icon filters and shared saves. */
export function createTravelLinesControl(map, doc = document) {
  const node = (tag, text) => { const value = doc.createElement(tag); if (text) value.textContent = text; return value; };
  const fieldset = node('fieldset'); fieldset.className = 'travel-lines-control';
  const legend = node('legend', 'Travel lines'), label = node('label'), checkbox = node('input');
  checkbox.type = 'checkbox'; checkbox.checked = map.travelLinesVisible !== false;
  label.append(checkbox, doc.createTextNode('Travel lines'));
  checkbox.addEventListener('change', () => map.setTravelLinesVisible(checkbox.checked));
  fieldset.append(legend, label);
  return fieldset;
}

/** Colour/dash key for travel lines, shown in the Map legend. */
export function createTravelLinesKey(doc = document) {
  const node = (tag, text) => { const value = doc.createElement(tag); if (text) value.textContent = text; return value; };
  const key = node('div'); key.className = 'travel-lines-key';
  key.title = 'Routes from the selected chunk. They show where you can travel, not what you have access to.';
  for (const type of TRAVEL_LINE_TYPES) {
    const row = node('span'); row.className = 'travel-line-key';
    const swatch = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    swatch.setAttribute('viewBox', '0 0 66 12'); swatch.setAttribute('aria-hidden', 'true');
    swatch.style.setProperty('--travel-colour', type.color); swatch.style.setProperty('--travel-light-colour', type.lightColor);
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [name, value] of Object.entries({ x1: 2, y1: 6, x2: 64, y2: 6, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-dasharray': type.dash.join(' ') })) line.setAttribute(name, String(value));
    swatch.append(line); row.append(swatch, node('span', type.label)); key.append(row);
  }
  return key;
}

/** Optional reference data is fetched separately from gameplay and definitions. */
export async function loadMapInformation(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher('/api/map-info');
    if (!response.ok) return null;
    const data = await response.json();
    return data.schemaVersion === 1 && Array.isArray(data.pinDetails?.pins)
      && Array.isArray(data.connections?.connections) ? data : null;
  } catch { return null; }
}

export function indexPinDetails(catalogue) {
  return new Map((catalogue?.pins ?? []).filter(row => typeof row.id === 'string').map(row => [row.id, row]));
}

function endpointMatches(endpoint, id) {
  return [endpoint?.chunkId, endpoint?.areaId, endpoint?.sectionId, endpoint?.displayChunkId].some(value => value != null
    && (String(value) === id || (!id.includes('-') && String(value).split('-')[0] === id)));
}

/** Both incoming and outgoing links are useful when inspecting a location. */
export function mapConnectionsForChunk(catalogue, chunkId) {
  if (chunkId == null || chunkId === '') return [];
  const id = String(chunkId);
  return (catalogue?.connections ?? []).filter(edge => endpointMatches(edge.from, id) || endpointMatches(edge.to, id));
}


// Only real travel earns a line: walking edges, and reference links between the same or
// neighbouring surface chunks, are ordinary walking and would bury the map in lines.
const regionXY = id => { const value = Number(id); return Number.isInteger(value) ? [value >> 8, value & 255] : null; };
function neighbouring(a, b) {
  if (a?.areaId || b?.areaId) return false;
  const one = regionXY(a?.chunkId), two = regionXY(b?.chunkId);
  return !!one && !!two && Math.abs(one[0] - two[0]) <= 1 && Math.abs(one[1] - two[1]) <= 1;
}
export function isTravelConnection(edge) {
  if (!edge || edge.kind === 'walking') return false;
  if (['boat', 'ship', 'carpet', 'transport', 'portal', 'canoe', 'teleport', 'lodestone', 'shortcut'].includes(edge.kind)) return true;
  return !neighbouring(edge.from, edge.to);
}
const endpointMatchesChunk = (endpoint, id) => endpointMatches(endpoint, String(id));
const endpointKey = endpoint => endpoint?.areaId ?? endpoint?.chunkId ?? `${endpoint?.x},${endpoint?.y}`;
function displayPoint(endpoint) {
  if (endpoint?.mapId !== 28 || endpoint.plane !== 0) return null;
  if (Number.isFinite(endpoint.worldX) && Number.isFinite(endpoint.worldY)) return { x: endpoint.worldX, y: endpoint.worldY };
  return Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y) ? gameToWorld(endpoint.x, endpoint.y) : null;
}

/** Reference links, not a navigable route or a grant of chunk access.
 * Returns screen segments so another UI can add labels, hover or selection.
 */
export function drawMapConnections(context, catalogue, { chunkId, offset = { x: 0, y: 0 }, zoom = 1,
  style = {} } = {}) {
  if (!context || !Number.isFinite(zoom) || zoom <= 0) return [];
  const segments = [];
  const seen = new Set();
  for (const edge of mapConnectionsForChunk(catalogue, chunkId)) {
    if (edge.drawable === false || !isTravelConnection(edge)) continue;
    // Interiors and off-map destinations would draw into the void; the panel lists them.
    if (style.isSurface && (!style.isSurface(edge.from) || !style.isSurface(edge.to))) continue;
    // Deduplicate reverse records, retaining distinct transport types and verified directions.
    const oneWay = edge.directionVerified === true && edge.bidirectional === false;
    const type = travelLineType(edge);
    const pair = `${type.id}:${oneWay ? `${endpointKey(edge.from)}>${endpointKey(edge.to)}` : [endpointKey(edge.from), endpointKey(edge.to)].sort().join('|')}`;
    if (seen.has(pair)) continue; seen.add(pair);
    const from = displayPoint(edge.from), to = displayPoint(edge.to);
    if (!from || !to) continue;
    const a = { x: offset.x + from.x * zoom, y: offset.y + from.y * zoom };
    const b = { x: offset.x + to.x * zoom, y: offset.y + to.y * zoom };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    segments.push({ edge, from: a, to: b, type });
  }
  if (!segments.length) return segments;
  // Work in screen pixels so zoomed-out bundles retain useful separation. Sort by
  // route identity to keep lane assignment stable when catalogue order changes.
  const routes = segments.map(segment => {
    const reverse = !endpointMatchesChunk(segment.edge.from, chunkId);
    const near = reverse ? segment.to : segment.from, far = reverse ? segment.from : segment.to;
    const dx = far.x - near.x, dy = far.y - near.y, length = Math.hypot(dx, dy);
    return { segment, near, far, dx, dy, length, origin: endpointKey(reverse ? segment.edge.to : segment.edge.from) };
  }).sort((a, b) => String(a.segment.edge.id ?? '').localeCompare(String(b.segment.edge.id ?? ''))
    || a.far.x - b.far.x || a.far.y - b.far.y || a.segment.type.id.localeCompare(b.segment.type.id));
  const unassigned = new Set(routes);
  for (const seed of routes) {
    if (!unassigned.delete(seed)) continue;
    const group = [seed];
    // Include transitive neighbours: a shallow fan still needs distinct lanes.
    for (let index = 0; index < group.length; index++) for (const candidate of unassigned) {
      const route = group[index];
      if (candidate.origin === route.origin && (candidate.dx * route.dx + candidate.dy * route.dy) / (candidate.length * route.length) > .9) {
        unassigned.delete(candidate); group.push(candidate);
      }
    }
    group.sort((a, b) => routes.indexOf(a) - routes.indexOf(b));
    if (group.length < 2) continue;
    group.forEach((route, index) => {
      const bend = Math.max(-route.length * .3, Math.min(route.length * .3, (index - (group.length - 1) / 2) * 36));
      route.segment.control = { x: (route.near.x + route.far.x) / 2 - route.dy / route.length * bend,
        y: (route.near.y + route.far.y) / 2 + route.dx / route.length * bend };
    });
  }
  const trace = ({ from, to, control }) => {
    context.beginPath(); context.moveTo(from.x, from.y);
    if (!control) context.lineTo(to.x, to.y);
    else if (context.quadraticCurveTo) context.quadraticCurveTo(control.x, control.y, to.x, to.y);
    else for (let step = 1; step <= 16; step++) {
      const t = step / 16, u = 1 - t;
      context.lineTo(u * u * from.x + 2 * u * t * control.x + t * t * to.x, u * u * from.y + 2 * u * t * control.y + t * t * to.y);
    }
    context.stroke();
  };
  const colorFor = segment => style.color ?? (style.scheme === 'light' ? segment.type.lightColor : segment.type.color);
  context.save();
  context.lineCap = 'round';
  context.globalAlpha = style.alpha ?? 0.95;
  context.setLineDash([]);
  context.strokeStyle = style.casing ?? 'rgba(10,8,4,.7)';
  context.lineWidth = (style.lineWidth ?? 2) + 3;
  for (const segment of segments) trace(segment);
  context.lineWidth = style.lineWidth ?? 2;
  for (const segment of segments) {
    const { edge, from, to, control } = segment;
    const dash = style.dash ?? segment.type.dash;
    context.strokeStyle = colorFor(segment); context.setLineDash(dash); trace(segment);
    // A missing reverse dependency does not establish one-way gameplay.
    if (style.arrows !== false && edge.directionVerified === true && edge.bidirectional === false) {
      const tangent = control ?? from;
      const angle = Math.atan2(to.y - tangent.y, to.x - tangent.x), size = style.arrowSize ?? 8;
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
      context.lineTo(to.x, to.y);
      context.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
      context.stroke(); context.setLineDash(dash);
    }
  }
  context.setLineDash([]);
  for (const segment of segments) for (const point of [segment.from, segment.to]) {
    context.beginPath(); context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = colorFor(segment); context.fill();
    context.lineWidth = 2; context.strokeStyle = style.casing ?? 'rgba(10,8,4,.8)'; context.stroke();
  }
  if (segments.length <= (style.maxLabels ?? 6)) {
    context.font = '600 12px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
    context.textBaseline = 'middle'; context.lineJoin = 'round';
    // Label the far end with where the line goes; skip labels that would land on another.
    const placed = [];
    for (const { edge, from, to } of segments) {
      const far = endpointMatchesChunk(edge.from, chunkId) ? { point: to, place: edge.to } : { point: from, place: edge.from };
      const label = String(far.place?.name ?? edge.label ?? '').slice(0, 40); if (!label) continue;
      const x = far.point.x + 8, y = far.point.y - 10, width = context.measureText?.(label).width ?? label.length * 7;
      if (placed.some(box => x < box.x + box.width + 6 && box.x < x + width + 6 && Math.abs(box.y - y) < 16)) continue;
      placed.push({ x, y, width });
      context.lineWidth = 4; context.strokeStyle = 'rgba(10,8,4,.85)'; context.strokeText(label, x, y);
      context.fillStyle = '#fff3d1'; context.fillText(label, x, y);
    }
  }
  context.restore();
  return segments;
}
