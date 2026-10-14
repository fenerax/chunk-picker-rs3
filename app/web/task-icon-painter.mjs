/** Fill late inventory/skill artwork without rebuilding task rows or their controls.
 * Call append once while constructing each task body, then settle with the shared
 * icon loader's result. Unknown names remain unqueued after that single load.
 */
export function createTaskIconPainter({ resolveIcon, createImage, className = 'task-icon', size = 22, refreshOnSettle = false }) {
  if (typeof resolveIcon !== 'function' || typeof createImage !== 'function') throw new TypeError('Task icon resolution and image creation functions are required.');
  if (typeof className !== 'string' || !className.trim() || !Number.isSafeInteger(size) || size < 1) throw new TypeError('Icon class and positive integer size are required.');
  let settled = false;
  const pending = new Map(), painted = new WeakMap();
  function paint(host, url) {
    const image = createImage();
    image.className = className;
    image.src = url; image.alt = ''; image.width = image.height = size; image.loading = 'lazy';
    host.insertBefore(image, host.firstChild);
    painted.set(host, image);
    return image;
  }
  function append(host, task) {
    const existing = painted.get(host);
    if (existing) return existing;
    const url = resolveIcon(task);
    if (url) {
      if (refreshOnSettle && !settled) pending.set(host, task); else pending.delete(host);
      return paint(host, url);
    }
    if (!settled) pending.set(host, task);
    return null;
  }
  function settle(loaded) {
    if (settled) return 0;
    settled = true;
    // Release even detached rows and failed loads. Clearing before resolution
    // also avoids retaining old controls if a supplied resolver throws.
    const waiting = [...pending]; pending.clear();
    let count = 0;
    if (loaded === true) for (const [host, task] of waiting) {
      if (!host.isConnected) continue;
      const url = resolveIcon(task);
      if (url) {
        const existing = painted.get(host);
        if (existing) { if (existing.src !== url) { existing.src = url; count++; } }
        else { paint(host, url); count++; }
      }
    }
    return count;
  }
  return { append, settle, get pendingCount() { return pending.size; } };
}
