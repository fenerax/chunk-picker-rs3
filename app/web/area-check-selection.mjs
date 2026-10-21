const CELL = 128;
export const AREA_CHECK_CAP = 128;

export function rectangleChunks(cells, first, last, cap = AREA_CHECK_CAP) {
  const left = Math.min(first.x, last.x), right = Math.max(first.x, last.x);
  const top = Math.min(first.y, last.y), bottom = Math.max(first.y, last.y);
  const ids = [];
  for (const [id, point] of cells) {
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) continue;
    ids.push(id);
    if (ids.length > cap) return { chunkIds: [], overCap: true, cap };
  }
  return { chunkIds: ids.sort((a, b) => Number(a) - Number(b)), overCap: false, cap };
}

/** Pointer interception is local to this tool; normal map navigation stays in ChunkMap. */
export function createAreaSelection(map, { onSelect, onHint, onCancel }) {
  let active = false, first, last, pointer;
  const cellAt = point => ({ x: Math.floor((point.x - map.offset.x) / (CELL * map.zoom)),
    y: Math.floor((point.y - map.offset.y) / (CELL * map.zoom)) });
  const redraw = () => map.invalidate(false, false, true);
  const release = id => { if (map.hoverCanvas.hasPointerCapture?.(id)) map.hoverCanvas.releasePointerCapture(id); };
  const complete = () => {
    const selection = rectangleChunks(map.cells, first, last);
    if (selection.overCap || !selection.chunkIds.length) {
      first = last = undefined; redraw();
      onHint(selection.overCap ? `Choose a smaller area: the limit is ${AREA_CHECK_CAP} chunks.` : 'No mapped chunks here. Choose another area.');
      return;
    }
    active = false; redraw(); onSelect(selection.chunkIds);
  };
  const chooseCorner = point => {
    last = cellAt(point);
    if (!first) { first = last; onHint('Choose the opposite corner. Escape cancels.'); redraw(); }
    else complete();
  };
  return {
    get active() { return active; },
    start() { active = true; first = last = pointer = undefined; map.endDrag(); map.setHover(null); redraw(); },
    cancel() { const wasActive = active; active = false; first = last = undefined; if (pointer) release(pointer.id); pointer = undefined; redraw(); if (wasActive) onCancel(); },
    down(event) {
      if (!active || event.button === 1 || event.button === 2) return false;
      if (pointer) return true;
      const point = map.localPoint(event);
      map.hoverCanvas.focus({ preventScroll: true }); map.hoverCanvas.setPointerCapture(event.pointerId);
      pointer = { id: event.pointerId, start: point, touch: event.pointerType === 'touch' };
      if (!pointer.touch) first = last = cellAt(point);
      event.preventDefault?.(); redraw(); return true;
    },
    move(event) {
      if (!active || !pointer) return false;
      if (pointer.id !== event.pointerId) return true;
      const point = map.localPoint(event);
      if (!pointer.touch) last = cellAt(point);
      else if (Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 5) {
        // Touch drags pan; short taps choose the two corners.
        const previous = pointer.last ?? pointer.start;
        pointer.moved = true; map.autoFit = false;
        map.offset.x += point.x - previous.x; map.offset.y += point.y - previous.y;
        map.invalidate(true, true, true);
      }
      pointer.last = point; redraw(); return true;
    },
    up(event) {
      if (!active || !pointer) return false;
      if (pointer.id !== event.pointerId) return true;
      const previous = pointer; pointer = undefined; release(event.pointerId);
      if (previous.touch) { if (!previous.moved) chooseCorner(map.localPoint(event)); }
      else { last = cellAt(map.localPoint(event)); complete(); }
      return true;
    },
    corner(point) { if (active) chooseCorner(point); },
    draw(context) {
      if (!first || !last) return;
      const size = CELL * map.zoom, x = map.offset.x + Math.min(first.x, last.x) * size,
        y = map.offset.y + Math.min(first.y, last.y) * size;
      const width = (Math.abs(first.x - last.x) + 1) * size, height = (Math.abs(first.y - last.y) + 1) * size;
      context.save(); context.fillStyle = 'rgba(233,185,85,.18)'; context.strokeStyle = '#e9b955';
      context.lineWidth = 2; context.setLineDash([6, 3]); context.fillRect(x, y, width, height);
      context.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2)); context.restore();
    },
  };
}
