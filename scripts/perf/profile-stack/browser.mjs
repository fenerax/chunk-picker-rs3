// Injected only by the profiling runner; no production page changes.
export function browserProbe(enabled = true, initialId = 'setup') {
  const records = [], pending = new Set(); let profileId = initialId, sequence = 0, lastActivity = performance.now();
  const at = () => performance.now();
  const add = (name, start, end, extra = {}, owner = profileId) => records.push({ kind: 'span', id: `browser:${++sequence}`, profileId: owner, layer: 'browser', processId: 'renderer', name, start, end, ...extra });
  let inputSequence = 0;
  document.addEventListener('click', () => { profileId = initialId + '.c' + (++inputSequence); const start = at(); add('input.click', start, start, { instant: true }); lastActivity = at(); }, true);
  const original = fetch;
  globalThis.fetch = async function (...args) {
    const owner = profileId, start = at(), id = ++sequence;
    const headers = new Headers(args[1]?.headers ?? (args[0] instanceof Request ? args[0].headers : undefined));
    if (enabled) headers.set('x-rs3-profile', owner);
    pending.add(id); lastActivity = at();
    try {
      const response = await original.call(this, args[0], { ...args[1], headers });
      add('fetch.headers', start, at(), { envelope: true }, owner);
      const readText = response.text.bind(response);
      response.json = async () => { const started = at(); let text; try { text = await readText(); } finally { add('response.body', started, at(), {}, owner); } const parseStart = at(); try { return parse(text); } finally { add('response.parse', parseStart, at(), {}, owner); } };
      for (const method of ['text', 'arrayBuffer']) {
        const read = response[method].bind(response);
        response[method] = async (...params) => { const started = at(); try { return await read(...params); } finally { add(`response.${method}`, started, at(), {}, owner); } };
      }
      return response;
    } finally { pending.delete(id); lastActivity = at(); }
  };
  // JSON.parse separates synchronous parse from body delivery/decoding waits.
  const parse = JSON.parse;
  JSON.parse = function (...args) { const start = at(); try { return parse.apply(this, args); } finally { add('response.parse', start, at()); } };
  new PerformanceObserver(list => { for (const e of list.getEntries()) add('longTask', e.startTime, e.startTime + e.duration, { envelope: true }); }).observe({ entryTypes: ['longtask'] });
  globalThis.__rs3Stack = { records, begin(id) { profileId = initialId = id; inputSequence = 0; lastActivity = at(); },
    settled() { return !pending.size && at() - lastActivity > 120; }, clock: at };
}
const deliberate = (browser, name, work) => browser.wait ? browser.wait(name, work) : work();
export async function settle(browser) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await browser.evaluate(`!!globalThis.__rs3Stack?.settled() && !!document.querySelector('[data-task-control="complete"]') && document.querySelector('#startup-error')?.hidden !== false`)) {
      await deliberate(browser, 'settlement.frames', () => browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')); return;
    }
    await deliberate(browser, 'poll.sleep', () => new Promise(resolve => setTimeout(resolve, 30)));
  }
  throw new Error('Browser did not reach task-ready/network-idle settlement');
}
export async function click(browser, selector) {
  await browser.evaluate(`(() => { const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>!n.disabled); for(let p=n?.parentElement;p;p=p.parentElement) if(p.tagName==='DETAILS'&&!p.open)p.querySelector('summary')?.click(); })()`);
  await deliberate(browser, 'driver.frames', () => browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'));
  const point = await browser.evaluate(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(selector)})].find(n => !n.disabled && n.checkVisibility() && n.getClientRects().length); if (!n) return null; n.scrollIntoView({block:'center'}); const r = n.getBoundingClientRect(); const point={x:r.x+r.width/2,y:r.y+r.height/2}; const hit=document.elementFromPoint(point.x,point.y); if(!n.contains(hit) && hit?.control!==n)return {blocked:true,expected:n.tagName,actual:hit?.tagName}; return point; })()`);
  if (point?.blocked) throw new Error(`Occluded scenario control: ${selector} (${point.expected}/${point.actual})`);
  if (!point) throw new Error(`No enabled visible scenario control: ${selector}`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
export async function waitFor(browser, expression) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) { if (await browser.evaluate(expression)) return; await deliberate(browser, 'poll.sleep', () => new Promise(resolve => setTimeout(resolve, 30))); }
  throw new Error('Scenario milestone timed out');
}
export const scenarios = ['cold', 'reload', 'roll', 'complete', 'why', 'how', 'map', 'settings'];
export async function perform(name, browser, origin) {
  if (name === 'cold' || name === 'reload') {
    if (name === 'cold') await browser.send('Network.clearBrowserCache');
    await browser.send('Page.navigate', { url: origin + '/' }); await settle(browser); return;
  }
  if (name === 'roll') {
    await click(browser, '#roll-two'); await waitFor(browser, `!!document.querySelector('.pending-choice .choice-view')`); await settle(browser);
    await click(browser, '.pending-choice .choice-view');
    await waitFor(browser, `!![...document.querySelectorAll('[role="tab"]')].find(n=>n.textContent==='Preview')`);
    await browser.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(n=>n.textContent==='Preview').click()`);
    await waitFor(browser, `!!document.querySelector('.unlock-preview') && !document.querySelector('.unlock-preview').textContent.includes('Working out')`); await settle(browser);
    await click(browser, '.pending-choice .primary-action'); await settle(browser); return;
  }
  if (name === 'complete') {
    await click(browser, '[data-task-control="complete"]:not(:checked)');
    if (await browser.evaluate(`!!document.querySelector('.duo-task-chooser')`)) await click(browser, '.duo-task-chooser button[type="submit"]');
    await settle(browser); return;
  }
  if (name === 'why' || name === 'how') {
    await click(browser, name === 'why' ? '.task-why' : '.task-how');
    await waitFor(browser, name === 'why' ? `!!document.querySelector('.task-why-panel:not([hidden]) .task-why-content')` : `!!document.querySelector('.task-how-panel:not([hidden]) .task-why-content')`);
    await settle(browser); return;
  }
  if (name === 'map') {
    await click(browser, '#center-map'); await click(browser, '#zoom-in'); await click(browser, '#zoom-out');
    const p = await browser.evaluate(`(() => { const r=document.querySelector('#map-stage').getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.6}; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + i * 8, y: p.y + i * 3, button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + 80, y: p.y + 30, button: 'left', clickCount: 1 });
    await settle(browser); return;
  }
  if (name === 'settings') {
    await click(browser, '#settings-open');
    await waitFor(browser, `document.querySelector('#tool-dialog')?.open && !!document.querySelector('.settings-layout')`);
    // Settings contains display preferences; gameplay rules have their own UI.
    await click(browser, '#tool-dialog .close-button'); await settle(browser);
    await click(browser, '#rules-open');
    await waitFor(browser, `!!document.querySelector('[data-rule-id="access.shared"] input')`);
    await click(browser, '[data-rule-id="access.shared"] input'); await settle(browser);
    if (await browser.evaluate(`document.querySelector('#tool-dialog')?.open`)) { await click(browser, '#tool-dialog .close-button'); await settle(browser); }
  }
}
