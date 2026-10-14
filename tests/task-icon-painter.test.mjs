import test from 'node:test';
import assert from 'node:assert/strict';

test('late inventory artwork replaces a category fallback in the same image', () => {
  let ready = false;
  const painter = createTaskIconPainter({ resolveIcon: () => ready ? '/inventory.png' : '/category.svg', createImage: () => ({}), refreshOnSettle: true });
  const body = host([{ label: 'Existing control' }]), image = painter.append(body, {});
  assert.equal(image.src, '/category.svg');
  ready = true;
  assert.equal(painter.settle(true), 1);
  assert.equal(body.children[0], image);
  assert.equal(image.src, '/inventory.png');
  assert.equal(body.children.length, 2);
  assert.equal(painter.pendingCount, 0);
});
import { createTaskIconPainter } from '../app/web/task-icon-painter.mjs';

// A minimal insertion surface records existing control identities and state.
// The painter uses only these standard DOM operations; no browser is required.
const host = (children = [], isConnected = true) => ({
  children: [...children], isConnected,
  get firstChild() { return this.children[0] ?? null; },
  insertBefore(image, before) {
    const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, image);
  },
});

test('late icons fill connected task bodies without rebuilding controls or changing their state', () => {
  let ready = false, imageCount = 0;
  const painter = createTaskIconPainter({ resolveIcon: task => ready ? task.url : null, createImage: () => { imageCount++; return {}; } });
  const button = { focused: true, listeners: [() => 'opens details'] }, note = { value: 'Keep my draft' };
  const body = host([button, note]);
  assert.equal(painter.append(body, { url: '/inventory.png' }), null);
  assert.equal(painter.pendingCount, 1);
  ready = true;
  assert.equal(painter.settle(true), 1);
  assert.equal(painter.pendingCount, 0);
  assert.equal(imageCount, 1);
  assert.deepEqual(body.children[0], { className: 'task-icon', src: '/inventory.png', alt: '', width: 22, height: 22, loading: 'lazy' });
  assert.equal(body.children[1], button); assert.equal(button.focused, true); assert.equal(button.listeners[0](), 'opens details');
  assert.equal(body.children[2], note); assert.equal(note.value, 'Keep my draft');
  assert.equal(painter.settle(true), 0);
  assert.equal(imageCount, 1);
});

test('settling skips discarded rows and clears both detached and unresolved pending hosts', () => {
  let ready = false;
  const queried = [];
  const painter = createTaskIconPainter({ resolveIcon: task => { queried.push(task.name); return ready ? task.url : null; }, createImage: () => ({}) });
  const retained = host(), removed = host(), unknown = host();
  painter.append(retained, { name: 'retained', url: '/retained.png' });
  painter.append(removed, { name: 'removed', url: '/removed.png' });
  painter.append(unknown, { name: 'unknown' });
  removed.isConnected = false; ready = true; queried.length = 0;
  assert.equal(painter.settle(true), 1);
  assert.deepEqual(queried, ['retained', 'unknown']);
  assert.equal(removed.children.length, 0);
  assert.equal(unknown.children.length, 0);
  assert.equal(painter.pendingCount, 0);
  painter.append(host(), { name: 'later unknown' });
  assert.equal(painter.pendingCount, 0);
});

test('failed readiness releases all pending rows and never queues later unknown names', () => {
  for (const loaded of [false, undefined, 'true', 1]) {
    let resolutions = 0;
    const painter = createTaskIconPainter({ resolveIcon: () => { resolutions++; return null; }, createImage: () => { throw new Error('No failed-load artwork'); } });
    const body = host([{ draft: 'Unchanged' }]);
    painter.append(body, {});
    assert.equal(painter.settle(loaded), 0);
    assert.equal(resolutions, 1);
    assert.equal(painter.pendingCount, 0);
    painter.append(host(), {});
    assert.equal(painter.pendingCount, 0);
    assert.deepEqual(body.children, [{ draft: 'Unchanged' }]);
    assert.equal(painter.settle(true), 0);
  }
});

test('ready rows get immediate icons and existing skill fallbacks stay intact', () => {
  const painter = createTaskIconPainter({ resolveIcon: task => task.itemUrl || task.skillUrl || null, createImage: () => ({}) });
  const fallbackHost = host([{ label: 'Unknown inventory, known skill' }], false);
  const fallback = painter.append(fallbackHost, { skillUrl: '/skill.png' });
  assert.equal(fallback.src, '/skill.png');
  assert.equal(painter.pendingCount, 0);
  assert.equal(painter.settle(true), 0);
  assert.equal(fallbackHost.children[0], fallback);
  assert.equal(painter.append(fallbackHost, { skillUrl: '/skill.png' }), fallback);
  assert.equal(fallbackHost.children.length, 2);
  const newHost = host([], false);
  const image = painter.append(newHost, { itemUrl: '/item.png', skillUrl: '/skill.png' });
  assert.equal(image.src, '/item.png');
  assert.equal(newHost.children[0], image);
  assert.equal(painter.append(host(), {}), null);
  assert.equal(painter.pendingCount, 0);
});

test('late category artwork keeps its 18px heading presentation and existing text node', () => {
  let ready = false;
  const category = createTaskIconPainter({ className: 'category-icon', size: 18,
    resolveIcon: name => ready && name === 'Necromancy' ? '/necromancy.png' : null, createImage: () => ({}) });
  const text = { textContent: 'Necromancy (1)' }, heading = host([text]);
  assert.equal(category.append(heading, 'Necromancy'), null);
  assert.equal(category.pendingCount, 1);
  ready = true;
  assert.equal(category.settle(true), 1);
  assert.deepEqual(heading.children[0], { className: 'category-icon', src: '/necromancy.png', alt: '', width: 18, height: 18, loading: 'lazy' });
  assert.equal(heading.children[1], text);
  assert.equal(text.textContent, 'Necromancy (1)');
  assert.equal(category.pendingCount, 0);
});
