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
  for (const type of ['focusin', 'focusout', 'blur', 'focus']) {
    window.addEventListener(type, () => focusEvents++, true);
  }
  window.shortHeightReadiness = {
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
      // Two consecutive equal frame samples acknowledge layout and scroll
      // settlement, including ancestors which native Tab may have scrolled.
      let previous, equalFrames = 0, frames = 0;
      const scrollSamples = [];
      const deadline = performance.now() + 10000;
      while (equalFrames < 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const current = snapshot(); frames++;
        const box = document.activeElement.getBoundingClientRect();
        if (scrollSamples.length < 40) scrollSamples.push([scrollX, scrollY, document.body.scrollTop, box.top, box.bottom]);
        equalFrames = current === previous ? equalFrames + 1 : 0;
        previous = current;
        if (performance.now() > deadline) throw new Error('Layout/scroll did not settle');
      }
      return { frames, focusEvents, scrollX, scrollY, scrollSamples };
    },
  };
}
