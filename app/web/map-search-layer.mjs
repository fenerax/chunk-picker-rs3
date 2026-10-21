/** Temporary search geometry, independent of ownership, roll choices and map data. */
export class MapSearchLayer {
  constructor(stage, nextCanvas) {
    this.matches = new Map();
    this.dirty = true;
    this.viewKey = null;
    this.scope = null;
    this.disposed = false;
    if (stage?.ownerDocument?.createElement && stage.insertBefore) {
      const canvas = stage.ownerDocument.createElement('canvas');
      const context = canvas.getContext?.('2d');
      if (context) {
        canvas.className = 'map-search-layer';
        canvas.setAttribute('aria-hidden', 'true');
        stage.insertBefore(canvas, nextCanvas);
        this.canvas = canvas;
        this.context = context;
      }
    }
  }

  /** Resolve each surface coordinate once; panning uses only this stored geometry. */
  setMatches(ids, cells, { lockedIds } = {}) {
    if (this.disposed) return false;
    const matches = new Map();
    const locked = lockedIds ? new Set([...lockedIds].map(id => String(id).replace(/-\d+$/, ''))) : null;
    for (const rawId of Array.isArray(ids) || ids instanceof Set ? ids : []) {
      if (typeof rawId !== 'string' && typeof rawId !== 'number') continue;
      const id = String(rawId).trim().replace(/-\d+$/, '');
      if (matches.has(id)) continue;
      const point = cells.get(id);
      if (point) matches.set(id, { x: point.x, y: point.y, locked: locked ? locked.has(id) : null });
    }
    if (matches.size === this.matches.size && [...matches].every(([id, point]) => {
      const previous = this.matches.get(id);
      return previous?.x === point.x && previous?.y === point.y && previous?.locked === point.locked;
    })) return false;
    this.matches = matches;
    this.dirty = true;
    return true;
  }

  setScope(world, memberId, revision) {
    const previous = this.scope;
    this.scope = { world, memberId, revision };
    if (previous && (previous.world !== world || previous.memberId !== memberId || previous.revision !== revision)) {
      this.matches.clear();
      this.dirty = true;
    }
  }

  draw(view, context = this.context, force = false) {
    if (this.disposed || !context) return;
    const { width, height, dpr, zoom, offset } = view;
    const key = [width, height, dpr, zoom, offset.x, offset.y].join(',');
    if (!force && !this.dirty && this.viewKey === key) return;
    this.viewKey = key;
    this.dirty = false;
    if (this.canvas) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
    }
    const size = 128 * zoom;
    context.save();
    context.lineWidth = 2;
    for (const point of this.matches.values()) {
      const x = offset.x + point.x * size, y = offset.y + point.y * size;
      if (x >= width || y >= height || x + size <= 0 || y + size <= 0) continue;
      context.fillStyle = point.locked ? 'rgba(230,155,54,.22)' : 'rgba(238,66,219,.16)';
      context.strokeStyle = point.locked ? '#e69b36' : '#f25fe3';
      context.setLineDash(point.locked === false ? [] : [5, 3]);
      const inset = Math.min(5, size * .2);
      context.fillRect(x, y, size, size);
      context.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    }
    context.restore();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.matches.clear();
    this.canvas?.remove();
    this.canvas = this.context = null;
  }
}
