export { PHONE_QUERY as PHONE_MEDIA_QUERY } from './phone-layout.mjs';
export const CHUNK_HOLD_MS = 550;
export const CHUNK_HOLD_SLOP = 5;

// A hold only arms for one touch on a phone. Permission is checked again at
// expiry; gesture cancellation never turns into a delayed write or a tap.
export function createChunkLongPress({ isPhone, canHold, onHold, clock = globalThis }) {
  const touches = new Map();
  let pending = null, timer = null, disposed = false;

  function clearTimer() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    pending = null;
  }

  function cancel() {
    clearTimer();
    for (const touch of touches.values()) touch.suppressTap = true;
  }

  function down(event, chunkId) {
    if (disposed || event.pointerType !== 'touch' || !isPhone()) return;
    if (touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, suppressTap: false });
    if (touches.size !== 1) { cancel(); return; }
    if (!chunkId || !canHold(chunkId)) return;
    const candidate = { pointerId: event.pointerId, chunkId };
    pending = candidate;
    timer = clock.setTimeout(() => {
      if (pending !== candidate || disposed) return;
      clearTimer();
      if (!isPhone() || !canHold(chunkId)) return;
      const touch = touches.get(candidate.pointerId);
      if (!touch || touch.suppressTap || touches.size !== 1) return;
      touch.suppressTap = true;
      onHold(chunkId, { clientX: event.clientX, clientY: event.clientY });
    }, CHUNK_HOLD_MS);
  }

  function move(event) {
    const touch = touches.get(event.pointerId);
    if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > CHUNK_HOLD_SLOP) cancel();
  }

  function up(event) {
    move(event);
    const suppressTap = touches.get(event.pointerId)?.suppressTap === true;
    if (pending?.pointerId === event.pointerId) clearTimer();
    touches.delete(event.pointerId);
    return suppressTap;
  }

  function release(event) {
    cancel();
    touches.delete(event.pointerId);
  }

  function reset() { cancel(); touches.clear(); }
  function dispose() { disposed = true; reset(); }

  return { down, move, up, cancel, release, reset, dispose };
}
