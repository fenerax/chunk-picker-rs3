import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopyListControl } from '../app/web/copy-list-control.mjs';

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.selectCount = 0;
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  focus() { this.ownerDocument.activeElement = this; }
  select() {
    this.selectCount += 1;
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
  async click() {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    if (!this.disabled) {
      await Promise.all((this.listeners.get('click') ?? []).map(listener => listener(event)));
    }
    return event;
  }
}

function descendants(element) {
  return element.children.flatMap(child => child instanceof FakeElement ? [child, ...descendants(child)] : []);
}

function fixture({ readList = () => list(), getClipboard = () => undefined } = {}) {
  const document = { createElement: tagName => new FakeElement(tagName, document), activeElement: null };
  const control = createCopyListControl({ document, id: 'copy-chunks', label: 'Copy unlocked chunks', readList, getClipboard });
  const elements = [...descendants(control.element), ...descendants(control.fallback)];
  const button = elements.find(element => element.tagName === 'BUTTON' && element.textContent === 'Copy');
  const status = elements.find(element => element.getAttribute('role') === 'status');
  const textarea = elements.find(element => element.tagName === 'TEXTAREA');
  const selectAll = elements.find(element => element.tagName === 'BUTTON' && element.textContent === 'Select all');
  const close = elements.find(element => element.tagName === 'BUTTON' && element.textContent === 'Close');
  assert.ok(button && status && textarea && selectAll && close, 'copy and fallback controls are present');
  return { document, control, button, status, textarea, selectAll, close };
}

const list = (items = ['Lumbridge (12850)', 'Draynor (12339)']) => ({
  player: 'Player', title: 'Unlocked chunks', date: '2026-10-12', groups: [{ items }],
});
const expectedText = 'Player — Unlocked chunks (2) — 2026-10-12\n- Lumbridge (12850)\n- Draynor (12339)';

test('copy writes the exact fresh payload, reports success and suppresses summary toggling', async () => {
  const writes = [];
  const { control, button, status } = fixture({ getClipboard: () => ({ writeText: async text => writes.push(text) }) });
  assert.equal(control.fallback.hidden, true);
  assert.equal(button.getAttribute('aria-label'), 'Copy unlocked chunks');
  assert.equal(status.tagName, 'OUTPUT');
  const event = await button.click();
  assert.deepEqual(writes, [expectedText]);
  assert.equal(status.textContent, 'Copied');
  assert.equal(control.fallback.hidden, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test('clipboard denial focuses and selects the entire fallback, with repeat selection and close', async () => {
  const { document, control, button, textarea, selectAll, close } = fixture({
    getClipboard: () => ({ writeText: async () => { throw new Error('Permission denied'); } }),
  });
  await button.click();
  assert.equal(control.fallback.hidden, false);
  assert.equal(textarea.id, 'copy-chunks-text');
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea.value, expectedText);
  assert.equal(document.activeElement, textarea);
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, expectedText.length);
  const selections = textarea.selectCount;
  await selectAll.click();
  assert.equal(textarea.selectCount, selections + 1);
  assert.equal(document.activeElement, textarea);
  await close.click();
  assert.equal(control.fallback.hidden, true);
});

test('a missing clipboard opens a selected fallback without a legacy copy command', async () => {
  const { document, control, button, textarea } = fixture();
  await button.click();
  assert.equal(control.fallback.hidden, false);
  assert.equal(textarea.value, expectedText);
  assert.equal(document.activeElement, textarea);
  assert.equal(textarea.selectionEnd, expectedText.length);
});

test('trimmed clipboard output reports copied counts and retains the omission tail', async () => {
  let copied;
  const { button, status } = fixture({
    readList: () => list(['Lumbridge (12850)', 'x'.repeat(2000), 'Draynor (12339)']),
    getClipboard: () => ({ writeText: async text => { copied = text; } }),
  });
  await button.click();
  assert.equal(status.textContent, 'Copied · 1 of 3');
  assert.equal(copied, 'Player — Unlocked chunks (3) — 2026-10-12\n- Lumbridge (12850)\n…and 2 more');
  assert.ok(copied.length <= 2000);
});

test('fallback uses the same bounded text and omission tail as clipboard copying', async () => {
  const { button, textarea } = fixture({ readList: () => list(['Lumbridge (12850)', 'x'.repeat(2000)]) });
  await button.click();
  assert.equal(textarea.value, 'Player — Unlocked chunks (2) — 2026-10-12\n- Lumbridge (12850)\n…and 1 more');
  assert.ok(textarea.value.length <= 2000);
  assert.equal(textarea.selectionEnd, textarea.value.length);
});

test('each click reads the current list instead of reusing the previous snapshot', async () => {
  let items = ['Lumbridge (12850)'];
  const writes = [];
  const { button } = fixture({ readList: () => list(items), getClipboard: () => ({ writeText: async text => writes.push(text) }) });
  await button.click();
  items = ['Draynor (12339)'];
  await button.click();
  assert.deepEqual(writes, [
    'Player — Unlocked chunks (1) — 2026-10-12\n- Lumbridge (12850)',
    'Player — Unlocked chunks (1) — 2026-10-12\n- Draynor (12339)',
  ]);
});

for (const outcome of ['resolve', 'reject']) {
  test(`refresh invalidates a pending clipboard ${outcome} and permits a new copy`, async () => {
    let settle;
    let calls = 0;
    const pending = new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; });
    const { control, button, status } = fixture({ getClipboard: () => ({ writeText: () => ++calls === 1 ? pending : Promise.resolve() }) });
    const oldClick = button.click();
    assert.equal(button.disabled, true);
    control.refresh();
    assert.equal(status.textContent, '');
    assert.equal(control.fallback.hidden, true);
    assert.equal(button.disabled, false);
    await button.click();
    assert.equal(status.textContent, 'Copied');
    settle(outcome === 'reject' ? new Error('stale denial') : undefined);
    await oldClick;
    assert.equal(status.textContent, 'Copied');
    assert.equal(control.fallback.hidden, true);
    assert.equal(button.disabled, false);
  });
}

test('refresh clears existing success and fallback state', async () => {
  let clipboard = { writeText: async () => {} };
  const { control, button, status } = fixture({ getClipboard: () => clipboard });
  await button.click();
  assert.equal(status.textContent, 'Copied');
  control.refresh();
  assert.equal(status.textContent, '');
  clipboard = undefined;
  await button.click();
  assert.equal(control.fallback.hidden, false);
  control.refresh();
  assert.equal(control.fallback.hidden, true);
  assert.equal(status.textContent, '');
  assert.equal(button.disabled, false);
});
