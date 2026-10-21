// One locked acceptance session: real save copy, all viewports, then cleanup.
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { entityId } from '../app/tasks/identity.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';
import { openChrome, sleep, until } from './perf/cdp.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = 'C:/Users/User/Projects/chunk-picker-rs3/.local/duo';
const screens = path.join(root, '.local/screens');
const gate = path.join(screens, 'group-goals-review-continue.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function locked() {
  const lock = process.env.RS3_HEAVY_LOCK_PATH, token = process.env.RS3_HEAVY_LOCK_TOKEN;
  assert.ok(lock && token, 'Run through .local/with-heavy.ps1');
  const owner = JSON.parse((await readFile(path.join(lock, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  assert.equal(owner.token, token); assert.equal(String(owner.pid), process.env.RS3_HEAVY_LOCK_PID);
}
await locked();
await mkdir(screens, { recursive: true });
await rm(gate, { force: true });
const scratch = await mkdtemp(path.join(root, '.local/goals-review-'));
assert.equal(path.dirname(scratch), path.join(root, '.local'));
const dataDir = path.join(scratch, 'duo'), originalHash = hash(await readFile(path.join(source, 'state.json')));
let app, browser;
const report = { checks: [], screenshots: [], originalSaveUnchanged: false };
try {
  await cp(source, dataDir, { recursive: true, filter: filename => !['store.lock', 'access-token'].includes(path.basename(filename)) });
  app = await createServer({ dataDir, host: '127.0.0.1', port: 9191, predictionPrewarm: false });
  await app.listen();
  assert.equal(app.address().port, 9191);
  const url = new URL(app.inviteUrl), origin = url.origin;
  const auth = { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
  const request = async (route, body) => {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { ...auth,
      ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `Review request failed: ${route} ${response.status}`);
    return response.json();
  };
  const command = payload => request('/api/command', { command: payload, expectedRevision: app.store.getInfo().revision });
  const state = app.store.getState(), [player1] = state.members;
  report.imported = Object.entries(state.legacy?.maps ?? {}).map(([id, map]) => ({ map: id,
    planningFields: Object.keys(map.chunkinfo ?? {}).filter(key => /goal|fav|task|note/i.test(key)),
    hasTopLevelGoals: Object.keys(map).some(key => /goal/i.test(key)) }));
  for (const goal of state.groupGoals ?? []) await command({ type: 'remove-group-goal', goalId: goal.id });
  const dragon = state.tasks.find(task => /dragon slayer/i.test(task.label) && /quest/i.test(task.category));
  await command({ type: 'add-group-goal', goalId: 'group-goal:sample-pickaxes', text: 'Both get a rune pickaxe', completion: 'players',
    link: { kind: 'item', id: entityId('item', 'Rune pickaxe'), label: 'Rune pickaxe' } });
  await command({ type: 'set-group-goal-done', goalId: 'group-goal:sample-pickaxes', memberId: player1.id, done: true });
  await command({ type: 'add-group-goal', goalId: 'group-goal:sample-dragon', text: 'Finish Dragon Slayer before members', completion: 'players',
    ...(dragon ? { link: { kind: 'task', id: dragon.id, label: dragon.label } } : {}) });
  const candidates = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  assert.ok(executable, 'Screenshot browser unavailable');
  const profile = path.join(scratch, 'chrome'); await mkdir(profile);
  browser = await openChrome(executable, profile);
  const errors = [];
  browser.listeners.add(message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push('Browser exception');
    if (message.method === 'Log.entryAdded' && message.params.entry.source === 'security' && message.params.entry.level === 'error') errors.push('CSP error');
  });
  await browser.send('Log.enable');
  const join = await fetch(app.inviteUrl, { redirect: 'manual' });
  const sessionCookie = join.headers.get('set-cookie').split(';')[0];
  const cookie = async pair => {
    const split = pair.indexOf('=');
    await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1), url: origin, path: '/', httpOnly: true, sameSite: 'Lax' });
  };
  await cookie(sessionCookie);
  await browser.send('Page.navigate', { url: origin + '/' });
  await until(() => browser.evaluate(`document.querySelectorAll('#group-goals .group-goal').length===2 && !!document.querySelector('#group-goals button')`), 180000, 250);
  const click = async selector => {
    await until(() => browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return !!node&&!node.disabled})()`), 30000);
    return browser.evaluate(`(()=>{document.querySelector(${JSON.stringify(selector)}).click();return true})()`);
  };
  const fill = (selector, value) => browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Review field unavailable');node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await click('#group-goals .group-goals-heading .group-goal-action');
  await fill('#group-goals .group-goal-editor input[type=text]', 'Stock the group bank with food');
  await fill('#group-goals .group-goal-editor select', 'group');
  await click('#group-goals .group-goal-save');
  await until(() => browser.evaluate(`document.querySelectorAll('#group-goals .group-goal').length===3 && !document.querySelector('#group-goals .group-goal-editor')`), 30000);
  const third = app.store.getState().groupGoals[2];
  const thirdSelector = `[data-goal-id="${third.id}"]`;
  await click(`#group-goals ${thirdSelector} input`);
  await until(() => app.store.getState().groupGoals.find(goal => goal.id === third.id).done, 30000);
  await click(`#group-goals ${thirdSelector} button[aria-label^="Move up:"]`);
  await until(() => app.store.getState().groupGoals[1].id === third.id, 30000);
  await click(`#group-goals ${thirdSelector} button[aria-label^="Edit:"]`);
  await fill('#group-goals .group-goal-editor input[type=text]', 'Stock the group bank with food and logs');
  await click('#group-goals .group-goal-save');
  await until(() => app.store.getState().groupGoals[1].text.endsWith('and logs'), 30000);
  await click(`#group-goals ${thirdSelector} button[aria-label^="Remove:"]`);
  await until(() => app.store.getState().groupGoals.length === 2, 30000);
  await command({ type: 'undo' });
  await until(() => browser.evaluate(`document.querySelectorAll('#group-goals .group-goal').length===3`), 30000);
  report.checks.push('UI add, group tick, reorder, edit, remove and Undo');
  // Keep a stale draft open while the other browser's command arrives.
  await click(`#group-goals ${thirdSelector} button[aria-label^="Edit:"]`);
  await fill('#group-goals .group-goal-editor input[type=text]', 'Unsubmitted local draft');
  await command({ type: 'set-group-goal-done', goalId: 'group-goal:sample-dragon', memberId: player1.id, done: true });
  await until(() => browser.evaluate(`document.querySelector('#group-goals .group-goal-editor')?.textContent.includes('Review before keeping your draft')`), 30000);
  assert.equal(await browser.evaluate(`document.querySelector('#group-goals .group-goal-editor input[type=text]').value`), 'Unsubmitted local draft');
  await click('#group-goals .group-goal-editor button.group-goal-action');
  report.checks.push('Live update preserves draft and requires revision review');
  const sentences = app.store.getHistory().history.map(event => describeHistoryEvent(event));
  assert.ok(sentences.includes('Added group goal “Both get a rune pickaxe”'));
  assert.ok(sentences.includes('Removed group goal “Stock the group bank with food and logs”'));
  const capture = async () => {
    for (const [name, width, height, mobile] of [['desktop-1440', 1440, 900, false], ['phone-390', 390, 844, true]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await sleep(700);
      if (mobile) await click('#phone-tab-tasks');
      await sleep(300);
      const layout = await browser.evaluate(`(()=>{const r=document.querySelector('#group-goals').getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,goals:{left:r.left,right:r.right,bottom:r.bottom},count:document.querySelectorAll('#group-goals .group-goal').length}})()`);
      assert.equal(layout.count, 3); assert.ok(layout.goals.left >= 0 && layout.goals.right <= width + 1, 'Goals overflow viewport');
      assert.ok(layout.documentWidth <= width + 1, 'Page overflow');
      const filename = path.join(screens, `group-goals-${name}.png`);
      const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(filename, Buffer.from(screenshot.data, 'base64'));
      report.screenshots.push({ path: path.relative(root, filename).replaceAll('\\', '/'), width, height, layout });
    }
  };
  await capture();
  console.log(JSON.stringify({ phase: 'screens-ready', screenshots: report.screenshots.map(row => row.path) }));
  // The parent inspects both images while this same server/browser stays open.
  const review = await until(async () => { try { return JSON.parse(await readFile(gate, 'utf8')); } catch { return false; } }, 600000, 250);
  await rm(gate, { force: true });
  if (review.recapture) { await browser.send('Page.reload', { ignoreCache: true }); await until(() => browser.evaluate(`document.querySelectorAll('#group-goals .group-goal').length===3`), 30000); await capture(); }
  const invitation = await request('/api/invites', { label: 'Goals review viewer', viewer: true });
  const viewerJoin = await fetch(invitation.link, { redirect: 'manual' });
  await browser.send('Network.clearBrowserCookies'); await cookie(viewerJoin.headers.get('set-cookie').split(';')[0]);
  await browser.send('Page.navigate', { url: origin + '/' });
  await until(() => browser.evaluate(`document.querySelectorAll('#group-goals .group-goal').length===3`), 30000);
  await click('#phone-tab-tasks');
  const viewer = await browser.evaluate(`({inputs:document.querySelectorAll('#group-goals input, #group-goals select, #group-goals textarea').length,writeButtons:document.querySelectorAll('#group-goals .group-goal-action, #group-goals .group-goal-save').length,readText:document.querySelector('#group-goals').textContent})`);
  assert.equal(viewer.inputs, 0); assert.equal(viewer.writeButtons, 0); assert.ok(viewer.readText.includes('Stock the group bank'));
  const denied = await browser.evaluate(`fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,command:{type:'remove-group-goal',goalId:'group-goal:sample-pickaxes'}})}).then(r=>r.status)`);
  assert.equal(denied, 403); assert.deepEqual(errors, []);
  report.checks.push('Viewer reads goals, has no write controls and receives 403 for writes', 'No browser exceptions or CSP errors', 'Desktop and phone fit their viewports');
} finally {
  await browser?.close(); await app?.close();
  assert.equal(path.dirname(scratch), path.join(root, '.local'));
  await rm(scratch, { recursive: true, force: true });
  report.originalSaveUnchanged = hash(await readFile(path.join(source, 'state.json'))) === originalHash;
  await writeFile(path.join(screens, 'group-goals-review.json'), JSON.stringify(report, null, 2) + '\n');
  assert.ok(report.originalSaveUnchanged);
}
console.log(JSON.stringify({ phase: 'complete', checks: report.checks, originalSaveUnchanged: report.originalSaveUnchanged }));
