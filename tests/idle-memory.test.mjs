import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleMemoryReclaimer } from '../app/idle-memory.mjs';

function clock() {
  let callback;
  return { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() { callback = undefined; },
    async tick() { const fn = callback; callback = undefined; await fn?.(); }, pending: () => !!callback };
}

test('releases and collects once after every lane has finished retiring', async () => {
  const fake = clock(); let ready = null, releases = 0, collections = 0;
  const memory = createIdleMemoryReclaimer({ clock: fake, idle: () => ready,
    release: () => releases++, collect: async () => collections++ });
  memory.sleep(); await fake.tick();
  assert.equal(releases, 0); assert.equal(collections, 0); assert.equal(fake.pending(), true);
  ready = true; await fake.tick(); await fake.tick();
  assert.equal(releases, 1); assert.equal(collections, 1); assert.equal(fake.pending(), false);
});

test('wake, active requests and shutdown cancel a pending collection', async () => {
  const fake = clock(); let ready = true, collections = 0;
  const memory = createIdleMemoryReclaimer({ clock: fake, idle: () => ready, collect: () => collections++ });
  memory.sleep(); memory.wake(); await fake.tick(); assert.equal(collections, 0);
  memory.sleep(); ready = false; await fake.tick(); assert.equal(collections, 0); assert.equal(fake.pending(), false);
  ready = true; memory.sleep(); memory.close(); await fake.tick(); assert.equal(collections, 0);
  memory.sleep(); assert.equal(fake.pending(), false);
});

test('missing optional GC still releases caches, and failed collection is contained', async () => {
  const fake = clock(); let releases = 0;
  const withoutGC = createIdleMemoryReclaimer({ clock: fake, idle: () => true, collect: null, release: () => releases++ });
  withoutGC.sleep(); await fake.tick(); assert.equal(releases, 1);
  assert.equal(withoutGC.diagnostics().available, false);
  const failed = createIdleMemoryReclaimer({ clock: fake, idle: () => true, collect: () => { throw new Error('GC failed'); } });
  failed.sleep(); await fake.tick(); assert.equal(failed.diagnostics().failures, 1);
});
