import assert from 'node:assert/strict';

export const evaluate = (page, fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`);
export const button = name => `[...document.querySelectorAll('#tool-dialog button')].find(n => n.textContent === ${JSON.stringify(name)})`;
export const fileButton = "document.querySelector('#tool-dialog .file-picker button')";

// Subscribe before the action. Deadlines diagnose a missing event; no action or
// assertion is retried. The old harness polled the eventual desired DOM instead.
export function event(source, method, accepts = () => true) {
  let listener;
  const cancel = () => { source.listeners.delete(listener); };
  const promise = new Promise((resolve, reject) => {
    listener = message => {
      if (message.method !== method || !accepts(message.params)) return;
      cancel(); resolve(message.params);
    };
    source.listeners.add(listener);
  });
  promise.catch(() => {});
  return { promise, cancel };
}

export async function freshPage(browser) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const listeners = new Set();
  let route;
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    route = message => { if (message.sessionId === sessionId) for (const listener of listeners) listener(message); };
    browser.listeners.add(route);
    const send = (method, params) => browser.send(method, params, sessionId);
    const page = { send, listeners, browserContextId, async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    }, async close() {
      try { await browser.send('Target.disposeBrowserContext', { browserContextId }); }
      finally { browser.listeners.delete(route); }
    } };
    for (const domain of ['Page', 'Runtime', 'Network']) await send(`${domain}.enable`);
    await send('Runtime.addBinding', { name: 'backupTestEvent' });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${install})()` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    return page;
  } catch (error) {
    await browser.send('Target.disposeBrowserContext', { browserContextId });
    browser.listeners.delete(route);
    throw error;
  }
}

function install() {
  const emit = name => window.backupTestEvent(name);
  const events = [];
  events.push = function (...items) {
    const length = Array.prototype.push.apply(this, items);
    if (items.some(item => item.name === 'duo-tasks-shown')) emit('startup-painted');
    return length;
  };
  window.__rs3Perf = { enabled: true, events };
  window.backupTest = {
    arm(kind, node, ticket) {
      if (!node) throw new Error(`Missing ${kind} event source`);
      const done = () => emit(ticket);
      if (['close', 'toggle', 'change'].includes(kind)) {
        node.addEventListener(kind, done, { once: true });
      } else {
        const observer = new MutationObserver(records => {
          // Observe the transition, independently of the result being asserted.
          // Preview's disabled true -> false joins its finally block, including
          // synchronous empty-file errors, not the text of a successful preview.
          if (kind === 'preview' && (!records.some(r => r.oldValue === '') || node.disabled)) return;
          observer.disconnect(); done();
        });
        observer.observe(node, kind === 'status' ? { childList: true } : {
          attributes: true, attributeOldValue: true, attributeFilter: [kind === 'preview' ? 'disabled' : 'open'] });
      }
    },
    async settle(target) {
      await document.fonts.ready;
      const channel = new MessageChannel();
      const frame = () => new Promise(resolve => requestAnimationFrame(() => {
        channel.port1.onmessage = resolve; channel.port2.postMessage(null);
      }));
      const snapshot = () => {
        const nodes = new Set(document.querySelectorAll('.topbar, .more-tools-menu, #tool-dialog, #dialog-content'));
        for (let n = target; n; n = n.parentElement) nodes.add(n);
        return JSON.stringify([innerWidth, innerHeight, scrollX, scrollY, ...[...nodes].map(n => {
          const r = n.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height, n.scrollTop, n.scrollLeft, n.scrollHeight, n.clientHeight];
        })]);
      };
      let previous;
      try {
        for (;;) {
          await frame();
          const current = snapshot();
          if (current === previous) return;
          previous = current;
        }
      } finally { channel.port1.close(); channel.port2.close(); }
    },
  };
}

let sequence = 0;
export async function arm(page, kind, expression) {
  const ticket = `${kind}-${++sequence}`;
  const pending = event(page, 'Runtime.bindingCalled', p => p.name === 'backupTestEvent' && p.payload === ticket);
  try { await page.evaluate(`window.backupTest.arm(${JSON.stringify(kind)}, (${expression}), ${JSON.stringify(ticket)})`); }
  catch (error) { pending.cancel(); throw error; }
  return pending;
}
export const settle = (page, expression) => page.evaluate(`window.backupTest.settle(${expression ? `(${expression})` : 'null'})`);

export async function navigate(page, url) {
  const loaded = event(page, 'Page.loadEventFired');
  const started = event(page, 'Runtime.bindingCalled', p => p.name === 'backupTestEvent' && p.payload === 'startup-painted');
  const statusRequests = new Set();
  const response = ({ method, params }) => {
    if (method === 'Network.responseReceived' && new URL(params.response.url).pathname === '/api/backup-status') statusRequests.add(params.requestId);
  };
  page.listeners.add(response);
  const status = event(page, 'Network.loadingFinished', p => statusRequests.has(p.requestId));
  try {
    const result = await page.send('Page.navigate', { url });
    assert.equal(result.errorText, undefined);
    await loaded.promise; await started.promise; await status.promise;
    await settle(page);
    assert.equal(await page.evaluate('document.readyState'), 'complete');
    assert.equal(await page.evaluate('location.origin'), new URL(url).origin);
  } finally { loaded.cancel(); started.cancel(); status.cancel(); page.listeners.delete(response); }
}

export async function key(page, name) {
  const [key, code, windowsVirtualKeyCode, text] = {
    Tab: ['Tab', 'Tab', 9], Enter: ['Enter', 'Enter', 13, '\r'],
    Space: [' ', 'Space', 32, ' '], Escape: ['Escape', 'Escape', 27],
  }[name];
  await page.send('Input.dispatchKeyEvent', { type: name === 'Tab' ? 'rawKeyDown' : 'keyDown', key, code, windowsVirtualKeyCode,
    ...(text ? { text, unmodifiedText: text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}

export async function tabTo(page, expression) {
  // Native traversal only. A repeated node proves a full cycle; activation is
  // never repeated. This does not wait for a broken focus target to become good.
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const state = await page.evaluate(`(() => {
      window.backupFocusIds ??= new WeakMap(); window.backupFocusSequence ??= 0;
      const n = document.activeElement;
      if (!window.backupFocusIds.has(n)) window.backupFocusIds.set(n, ++window.backupFocusSequence);
      return { reached: n === (${expression}), id: n === document.body ? null : window.backupFocusIds.get(n),
        tag: n.tagName, text: n.textContent?.slice(0, 45), hasFocus: document.hasFocus() };
    })()`);
    if (state.reached) { await settle(page, expression); return; }
    assert.ok(state.id === null || !seen.has(state.id), `Unreachable native Tab target: ${expression}; ${JSON.stringify(state)}`);
    if (state.id !== null) seen.add(state.id);
    await key(page, 'Tab');
  }
  assert.fail(`Native Tab traversal exceeded 100 stops: ${expression}`);
}

export async function point(page, expression) {
  await page.evaluate(`(${expression}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await settle(page, expression);
  const result = await page.evaluate(`(() => {
    const n = (${expression}), r = n.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, visible: n.checkVisibility(), enabled: !n.disabled,
      ownsHit: hit === n || n.contains(hit), focused: document.activeElement === n };
  })()`);
  assert.equal(result.visible, true, `Visible control: ${expression}`);
  assert.equal(result.enabled, true, `Enabled control: ${expression}`);
  assert.equal(result.ownsHit, true, `Hit ownership: ${expression}`);
  return result;
}
export async function activate(page, expression, mode = 'pointer') {
  if (mode !== 'pointer') await tabTo(page, expression);
  const p = await point(page, expression);
  if (mode !== 'pointer') {
    assert.equal(p.focused, true, 'Keyboard target owns focus before input');
    await key(page, mode);
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    assert.equal(await page.evaluate(`document.activeElement === (${expression})`), true, 'Pointer press owns focus before release');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
}
