export const observationNames = [
  'initial layout', 'Roll visible', 'Controls visible', 'controls expanded', 'Forfeit visible',
  ...['forward', 'reverse'].flatMap(direction => Array.from({ length: 7 }, (_, i) => `confirmation:${direction}:${i}`)),
  'Cancel visible', 'confirmation closed', 'task search visible', 'short task search', 'task visible',
  ...['forward', 'reverse'].flatMap(direction => Array.from({ length: 7 }, (_, i) => `task detail:${direction}:${i}`)),
  'task detail closed', 'long task search', 'long task reached',
  ...['forward', 'reverse'].flatMap(direction => Array.from({ length: 7 }, (_, i) => `wrapping task title:${direction}:${i}`)),
  'wrapping task closed', 'result Controls visible', 'result Roll two visible', 'result visible',
];

// One owned Chrome per genuine browser-font preference; every combination gets
// a new incognito context, target, cookies, storage and application listeners.
export async function freshPage(browser) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const listeners = new Set();
  const route = message => { if (message.sessionId === sessionId) for (const listener of listeners) listener(message); };
  browser.listeners.add(route);
  const send = (method, params) => browser.send(method, params, sessionId);
  const page = { send, listeners, async evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  }, async close() {
    browser.listeners.delete(route);
    await browser.send('Target.disposeBrowserContext', { browserContextId });
  } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installReadiness})()` });
  return page;
}

// Installed in each new document before application listeners run. These probes
// never focus, scroll, resize, or test visibility: stable bad geometry is ready.
export function installReadiness() {
  // The application already publishes tasks-shown only after its calculator
  // result and sliced DOM painting have completed. Saved alone precedes this.
  window.__rs3Perf = { enabled: true, events: [] };
  let focusEvents = 0;
  let nextIdentity = 0;
  const identities = new WeakMap();
  const identity = node => {
    if (!identities.has(node)) identities.set(node, ++nextIdentity);
    return identities.get(node);
  };
  const focusHistory = [];
  for (const type of ['focusin', 'focusout', 'blur', 'focus']) {
    window.addEventListener(type, event => {
      focusEvents++;
      if (type === 'focusin') {
        focusHistory.push({ id: event.target.id, tag: event.target.tagName, text: event.target.textContent?.slice(0, 40) });
        if (focusHistory.length > 120) focusHistory.shift();
      }
    }, true);
  }
  window.shortHeightReadiness = {
    focusHistory,
    traversalState() {
      const order = [...document.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
        .filter(node => node.tabIndex >= 0 && !node.disabled && !node.closest('[inert]') && node.checkVisibility())
        .map(identity).join(',');
      return document.activeElement === document.body ? null : `${order}:${identity(document.activeElement)}`;
    },
    armDialogClose() {
      window.shortHeightDialogClosed = new Promise(resolve =>
        document.querySelector('#tool-dialog').addEventListener('close', resolve, { once: true }));
    },
    armTaskSearch() {
      window.shortHeightTaskChanged = false;
      const observer = new MutationObserver(() => { window.shortHeightTaskChanged = true; observer.disconnect(); });
      observer.observe(document.querySelector('#active-tasks'), { childList: true, subtree: true });
    },
    armFocus() { return { events: focusEvents, element: document.activeElement }; },
    focusLanded(before) {
      return { events: focusEvents - before.events, changed: document.activeElement !== before.element,
        body: document.activeElement === document.body };
    },
    async settled() {
      await document.fonts.ready;
      const snapshot = () => {
        const nodes = new Set(document.querySelectorAll(
          '.topbar, #backup-status-notice, .workspace, #phone-tabs, #tool-dialog, .dialog-header, #dialog-content'));
        for (let node = document.activeElement; node; node = node.parentElement) nodes.add(node);
        return JSON.stringify([innerWidth, innerHeight, document.fonts.status,
          matchMedia('(max-width:720px)').matches, document.documentElement.className,
          ...[...nodes].map(node => {
            const r = node.getBoundingClientRect();
            return [node.id, r.x, r.y, r.width, r.height, node.clientWidth, node.clientHeight,
              node.scrollWidth, node.scrollHeight, node.scrollLeft, node.scrollTop];
          })]);
      };
      // Sample after rendering, including ResizeObserver delivery and the
      // application's focus-reveal callbacks. A rAF callback itself runs before
      // that work; a MessageChannel task joins the completed frame without a
      // timer or a delay tied to machine speed.
      const channel = new MessageChannel();
      const frame = () => new Promise(resolve => requestAnimationFrame(() => {
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      }));
      // Two consecutive equal frame samples acknowledge layout and scroll
      // settlement, including ancestors which native Tab may have scrolled.
      let previous, equalFrames = 0, frames = 0;
      const scrollSamples = [];
      const deadline = performance.now() + 10000;
      while (equalFrames < 1) {
        await frame();
        const current = snapshot(); frames++;
        const box = document.activeElement.getBoundingClientRect();
        if (scrollSamples.length < 40) scrollSamples.push([scrollX, scrollY, document.body.scrollTop, box.top, box.bottom]);
        equalFrames = current === previous ? equalFrames + 1 : 0;
        previous = current;
        if (performance.now() > deadline) throw new Error('Layout/scroll did not settle');
      }
      channel.port1.close(); channel.port2.close();
      return { frames, focusEvents, scrollX, scrollY, scrollSamples };
    },
  };
}

export function focusedGeometry() {
    const e = document.activeElement, r = e.getBoundingClientRect(), dialog = e.closest('dialog');
    const header = dialog?.querySelector('.dialog-header').getBoundingClientRect();
    const content = dialog?.querySelector('#dialog-content'), cr = content?.getBoundingClientRect();
    let top = content?.contains(e) ? Math.max(0, header.bottom, cr.top) : 0;
    let bottom = dialog ? Math.min(innerHeight, dialog.getBoundingClientRect().bottom, content?.contains(e) ? cr.bottom : Infinity) : document.querySelector('#phone-tabs').getBoundingClientRect().top;
    for (let parent = e.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'visible') continue;
      const clip = parent.getBoundingClientRect(), edge = clip.top + parent.clientTop;
      top = Math.max(top, edge); bottom = Math.min(bottom, edge + parent.clientHeight);
      // A modal is in the top layer and escapes clipping by body/html.
      if (parent === dialog) break;
    }
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const ancestors = [];
    if (Math.min(bottom, r.bottom) - Math.max(top, r.top) < r.height - 1) {
      for (let node = e; node; node = node.parentElement) {
        const box = node.getBoundingClientRect();
        ancestors.push({ id: node.id, tag: node.tagName, top: box.top, bottom: box.bottom,
          scrollTop: node.scrollTop, scrollLeft: node.scrollLeft, clientHeight: node.clientHeight });
      }
    }
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, dialogScroll: dialog?.scrollTop, contentScroll: content?.scrollTop, contentTop: cr?.top, contentBottom: cr?.bottom, headerBottom: header?.bottom, control: e !== document.body, id: e.id, text: e === document.body ? '' : e.textContent?.slice(0, 100), height: r.height, visible: Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top)), hit: e === hit || e.contains(hit), owner: hit?.tagName, ...(ancestors.length ? { ancestors } : {}) };
}
