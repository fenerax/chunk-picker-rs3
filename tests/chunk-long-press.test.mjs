import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkLongPress, CHUNK_HOLD_MS, PHONE_MEDIA_QUERY } from '../app/web/chunk-long-press.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { PHONE_QUERY } from '../app/web/phone-layout.mjs';

function manualClock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(delay) {
      const target = now + delay;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > target) break;
        now = timer.at; timers.delete(id); timer.callback();
      }
      now = target;
    },
    get pending() { return timers.size; },
  };
}

const touch = (pointerId = 1, clientX = 150, clientY = 150) => ({ pointerId, pointerType: 'touch', button: 0, clientX, clientY });

test('a long press supplies the touch position for the chunk menu', () => {
  const clock = manualClock(), held = [];
  const hold = createChunkLongPress({ clock, isPhone: () => true, canHold: () => true, onHold: (...args) => held.push(args) });
  hold.down(touch(1, 125, 175), '7495'); clock.advance(CHUNK_HOLD_MS);
  assert.deepEqual(held, [['7495', { clientX: 125, clientY: 175 }]]);
});

function holdHarness() {
  const clock = manualClock(), held = [];
  let phone = true, writable = true;
  const hold = createChunkLongPress({ clock, isPhone: () => phone, canHold: () => writable, onHold: id => held.push(id) });
  return { clock, hold, held, setPhone: value => { phone = value; }, setWritable: value => { writable = value; } };
}

function mapHarness() {
  const h = holdHarness(), chosen = [], captured = new Set();
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    stage: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    hoverCanvas: { focus() {}, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
      releasePointerCapture: id => captured.delete(id), classList: { add() {}, remove() {} } },
    chunkHold: h.hold, isPhone: () => true, touchPointers: new Map(), pinch: null,
    offset: { x: 0, y: 0 }, zoom: 1, width: 400, height: 300, dirty: {}, drag: null, pointer: null, autoFit: false,
    chunkAt: point => point ? '7495' : null, setHover() {}, schedule() {}, invalidate() {},
    onChunk: (id, event) => chosen.push({ id, event }),
  });
  return { ...h, map, chosen, captured };
}

test('holds and phone tabs share the portrait and short touch landscape breakpoint', () => {
  assert.equal(PHONE_MEDIA_QUERY, PHONE_QUERY);
  assert.match(PHONE_QUERY, /max-height:500px/);
  assert.match(PHONE_QUERY, /pointer:coarse/);
});

test('a short phone tap still opens chunk info and cannot fire later', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch()); clock.advance(CHUNK_HOLD_MS - 1); map.pointerUp(touch());
  clock.advance(CHUNK_HOLD_MS);
  assert.deepEqual(held, []);
  assert.deepEqual(chosen, [{ id: '7495', event: { shiftKey: false, ctrlKey: false, pointerType: 'touch' } }]);
  assert.equal(clock.pending, 0);
});

test('holding a phone chunk fires once at the threshold and suppresses release tap', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch()); clock.advance(CHUNK_HOLD_MS - 1);
  assert.deepEqual(held, []);
  clock.advance(1); clock.advance(CHUNK_HOLD_MS); map.pointerUp(touch());
  assert.deepEqual(held, ['7495']); assert.deepEqual(chosen, []);
  // A fresh tap after a hold remains a normal info action.
  map.pointerDown(touch(2)); map.pointerUp(touch(2));
  assert.equal(chosen.length, 1);
});

test('phone panning cancels a hold before a render frame and cannot become a tap', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch()); clock.advance(CHUNK_HOLD_MS - 1);
  map.pointerMove(touch(1, 156, 150)); clock.advance(1);
  // Returning to the original point must not restore the cancelled gesture.
  map.pointerUp(touch());
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
});

test('small touch jitter preserves a deliberate hold', () => {
  const { hold, clock, held } = holdHarness();
  hold.down(touch(), '7495'); hold.move(touch(1, 153, 154)); clock.advance(CHUNK_HOLD_MS);
  assert.deepEqual(held, ['7495']); assert.equal(hold.up(touch()), true);
});

test('a second touch cancels the hold, pinches around the midpoint, and suppresses both taps', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch(1, 100, 100)); clock.advance(CHUNK_HOLD_MS - 1);
  map.pointerDown(touch(2, 200, 100)); map.pointerMove(touch(2, 300, 100)); clock.advance(1);
  assert.equal(map.zoom, 2);
  assert.deepEqual(map.offset, { x: -100, y: -100 });
  assert.equal(map.drag, null, 'A pinch cannot also apply the old one-finger pan');
  map.pointerUp(touch(2, 300, 100));
  assert.equal(map.drag.pointerId, 1); assert.equal(map.drag.moved, true);
  map.pointerMove(touch(1, 110, 110)); map.applyPointer();
  assert.deepEqual(map.offset, { x: -90, y: -90 }, 'The remaining finger can continue panning');
  map.pointerUp(touch(1, 110, 110));
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
  assert.equal(map.touchPointers.size, 0); assert.equal(map.pinch, null);
});

test('pinch cancellation releases only that touch and never rearms the remaining finger', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch(1)); map.pointerDown(touch(2, 250, 150));
  map.cancelPointer(touch(1)); clock.advance(CHUNK_HOLD_MS);
  assert.equal(map.drag.pointerId, 2); assert.equal(map.drag.moved, true);
  map.pointerUp(touch(2, 250, 150));
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
});

test('three-touch gestures rebase the active pair and tolerate delayed capture-loss events', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.pointerDown(touch(1, 100, 100)); map.pointerDown(touch(2, 200, 100)); map.pointerDown(touch(3, 300, 100));
  map.cancelPointer(touch(1, 100, 100));
  const rebased = map.pinch;
  map.cancelPointer(touch(1, 100, 100));
  assert.equal(map.pinch, rebased, 'A delayed lostpointercapture from a removed touch leaves the new pair intact');
  map.pointerMove(touch(3, 400, 100));
  assert.equal(map.zoom, 2); assert.deepEqual(map.offset, { x: -200, y: -100 });
  map.pointerUp(touch(2, 200, 100)); map.cancelPointer(touch(2, 200, 100));
  assert.equal(map.drag.pointerId, 3);
  map.pointerUp(touch(3, 400, 100)); clock.advance(CHUNK_HOLD_MS);
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
  map.pointerDown(touch(1)); clock.advance(CHUNK_HOLD_MS); map.pointerUp(touch(1));
  assert.deepEqual(held, ['7495'], 'A fresh gesture can hold after all earlier fingers are gone');
});

test('view-only links cannot arm a write but retain the normal info tap', () => {
  const { map, clock, held, chosen, setWritable } = mapHarness();
  setWritable(false); map.pointerDown(touch()); clock.advance(CHUNK_HOLD_MS * 2); map.pointerUp(touch());
  assert.equal(clock.pending, 0); assert.deepEqual(held, []); assert.equal(chosen.length, 1);
});

test('write permission and phone layout are checked again before a hold fires', () => {
  for (const revoke of [h => h.setWritable(false), h => h.setPhone(false)]) {
    const h = holdHarness(); h.hold.down(touch(), '7495'); revoke(h); h.clock.advance(CHUNK_HOLD_MS);
    assert.deepEqual(h.held, []);
  }
});

test('wide touch taps carry touch identity while mouse and pen keep their modifiers', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.isPhone = () => false;
  for (const event of [touch(), { ...touch(2), pointerType: 'mouse', ctrlKey: true }, { ...touch(3), pointerType: 'pen', shiftKey: true }]) {
    map.pointerDown(event); clock.advance(CHUNK_HOLD_MS); map.pointerUp(event);
  }
  assert.deepEqual(held, []);
  assert.deepEqual(chosen.map(item => item.event), [{ shiftKey: false, ctrlKey: false, pointerType: 'touch' }, { shiftKey: false, ctrlKey: true }, { shiftKey: true, ctrlKey: false }]);
  assert.equal(map.touchPointers.size, 0);
});

test('a wide touch layout pinches and resumes panning without arming a hold or selecting a chunk', () => {
  const { map, clock, held, chosen } = mapHarness();
  map.isPhone = () => false;
  map.pointerDown(touch(1, 100, 100)); map.pointerDown(touch(2, 200, 100));
  map.pointerMove(touch(2, 300, 100));
  assert.equal(map.zoom, 2);
  map.pointerUp(touch(2, 300, 100)); map.cancelPointer(touch(2, 300, 100));
  assert.equal(map.drag.pointerId, 1, 'Delayed capture loss cannot cancel the remaining finger');
  map.pointerMove(touch(1, 110, 110)); map.applyPointer();
  assert.deepEqual(map.offset, { x: -90, y: -90 });
  map.pointerUp(touch(1, 110, 110)); clock.advance(CHUNK_HOLD_MS * 2);
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
  assert.equal(map.touchPointers.size, 0); assert.equal(map.pinch, null);
});

test('resizing out of the phone layout cancels a touch gesture and releases both captures', () => {
  const { map, clock, held, chosen, captured } = mapHarness();
  map.pointerDown(touch()); map.pointerDown(touch(2, 250, 150));
  map.isPhone = () => false;
  map.disposed = false; map.width = 400; map.height = 300; map.dpr = 1;
  map.stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  const previous = globalThis.window;
  try { globalThis.window = { devicePixelRatio: 1 }; map.resize(); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  clock.advance(CHUNK_HOLD_MS); map.pointerUp(touch()); map.pointerUp(touch(2));
  assert.equal(captured.size, 0); assert.equal(map.drag, null); assert.equal(map.pinch, null);
  assert.deepEqual(held, []); assert.deepEqual(chosen, []);
});

test('cancel, pointer cancellation, zoom and disposal remove pending holds', () => {
  for (const stop of [h => h.hold.cancel(), h => h.hold.release(touch()), h => h.hold.dispose(), h => h.map.cancelPointer(touch()), h => h.map.zoomBy(1.2)]) {
    const h = mapHarness(); h.map.pointerDown(touch()); stop(h); h.clock.advance(CHUNK_HOLD_MS * 2);
    assert.deepEqual(h.held, []); assert.equal(h.clock.pending, 0);
  }
});

test('hiding the map or losing the page releases touch state and permits the next gesture', () => {
  const { map, clock, held, chosen, captured } = mapHarness();
  map.pointerDown(touch()); map.cancelTouchGesture(); clock.advance(CHUNK_HOLD_MS * 2);
  assert.deepEqual(held, []); assert.equal(captured.size, 0);
  assert.equal(map.touchPointers.size, 0); assert.equal(map.drag, null);
  map.pointerDown(touch()); clock.advance(CHUNK_HOLD_MS); map.pointerUp(touch());
  assert.deepEqual(held, ['7495']); assert.deepEqual(chosen, []);
  map.isPhone = () => false;
  const mouse = { ...touch(2), pointerType: 'mouse' };
  map.pointerDown(mouse); map.cancelTouchGesture(); map.pointerUp(mouse);
  assert.equal(chosen.length, 1, 'Phone lifecycle cancellation does not change a desktop mouse gesture');
});

test('release movement and repeated multitouch never trigger a cancelled hold', () => {
  const { hold, clock, held } = holdHarness();
  hold.down(touch(), '7495'); assert.equal(hold.up(touch(1, 160, 150)), true);
  hold.down(touch(2), '7495'); hold.down(touch(3), '7494'); hold.down(touch(4), '7751');
  clock.advance(CHUNK_HOLD_MS * 2);
  assert.equal(hold.up(touch(2)), true); assert.equal(hold.up(touch(3)), true); assert.equal(hold.up(touch(4)), true);
  assert.deepEqual(held, []);
});
