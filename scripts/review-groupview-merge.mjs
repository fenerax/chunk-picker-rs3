// Isolated copied-save review of Duo + Completed. No save payloads or credentials are reported.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openChrome, stopChild, until, sleep } from './perf/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local/groupview-merge-review');
const main = 'C:/Users/User/Projects/chunk-picker-rs3';
const source = path.join(root, '.local/groupview-merge-save');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(await readFile(path.join(source, 'state.json')));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, 'scratch-'));
let child, browser;
const report = { stateSha256: sourceHash, screenshots: {} };
async function screenshot(filename, width, theme, popup = false) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
  await browser.evaluate(`import('/map-tools.mjs').then(m=>m.applyTheme(document.documentElement,${JSON.stringify(theme)}))`);
  if (!popup) await browser.evaluate(width === 390 ? `document.querySelector('.task-sidebar').scrollIntoView({block:'start'})` : `window.scrollTo(0,0)`);
  await sleep(300);
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, filename), Buffer.from(shot.data, 'base64'));
  const sizes = await browser.evaluate(`({viewport:innerWidth,body:document.body.scrollWidth,dialog:document.getElementById('tool-dialog').open?document.getElementById('tool-dialog').getBoundingClientRect().width:null})`);
  assert.ok(sizes.body <= sizes.viewport, `Horizontal overflow in ${filename}`);
  if (popup) assert.ok(sizes.dialog <= width, `Dialog overflow in ${filename}`);
  report.screenshots[filename] = sizes;
}
try {
  const data = path.join(scratch, 'duo');
  await cp(source, data, { recursive: true, filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
  assert.equal(hash(await readFile(path.join(data, 'state.json'))), sourceHash);
  const env = { ...process.env, RS3_PERF_SCRATCH: data, RS3_PERF_PREWARM: 'off', RS3_PERF_SERVER_ENTRY: path.join(root, 'app/server.mjs'),
    RS3_DATA_DIR: data, RS3_GAME_DATA_DIR: path.join(main, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(main, '.local/map-assets') };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  child = fork(path.join(root, 'scripts/perf/server.mjs'), [], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Review server timed out.')), 180000);
    child.once('message', value => { clearTimeout(timer); value.type === 'ready' ? resolve(value) : reject(new Error('Review server failed.')); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const url = new URL(ready.inviteUrl);
  assert.equal(url.hostname, '127.0.0.1'); assert.ok(![8788, 8789, 8790].includes(Number(url.port)));
  browser = await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__rs3Perf={enabled:true,events:[]};` });
  await browser.send('Page.navigate', { url: ready.inviteUrl });
  await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown'&&e.memberId==='player1')`), 180000);
  report.duo = await browser.evaluate(`({header:document.getElementById('task-count').textContent,rows:[...document.querySelectorAll('#active-tasks .duo-task-row')].map(n=>({id:n.dataset.taskId,owners:n.dataset.owners,label:n.querySelector('.task-label-button').textContent}))})`);
  assert.ok(report.duo.rows.length > 0);
  report.filters = {};
  for (const name of ['Player 1', 'Player 2', 'Both', 'All']) {
    await browser.evaluate(`[...document.querySelectorAll('.duo-task-chip')].find(n=>n.textContent===${JSON.stringify(name)}).click()`);
    await sleep(100);
    report.filters[name] = await browser.evaluate(`document.querySelectorAll('#active-tasks .duo-task-row').length`);
  }
  await screenshot('desktop-group.png', 1440, 'dark');
  await screenshot('phone-group-390.png', 390, 'gray');
  const shared = report.duo.rows.find(row => row.owners === 'player1,player2' || row.owners === 'player2,player1');
  assert.ok(shared, 'Expected a shared task on the copied save.');
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(shared.id)}] .task-label-button').click()`);
  await until(() => browser.evaluate(`document.getElementById('tool-dialog').open&&!document.querySelector('.task-detail-loading')`), 180000);
  report.popup = await browser.evaluate(`({both:document.getElementById('dialog-content').textContent.includes("For Player 1 and Player 2 · showing Player 1's details"),partner:[...document.querySelectorAll('#dialog-content button')].some(n=>n.textContent==='View for Player 2'),failure:document.getElementById('dialog-content').textContent.includes('saved task details changed')})`);
  assert.equal(report.popup.both, true); assert.equal(report.popup.partner, true); assert.equal(report.popup.failure, false);
  await screenshot('desktop-duo-popup.png', 1440, 'dark', true);
  await screenshot('phone-duo-popup-390.png', 390, 'light', true);
  await browser.evaluate(`[...document.querySelectorAll('#dialog-content button')].find(n=>n.textContent==='View for Player 2').click()`);
  await until(() => browser.evaluate(`!document.querySelector('.task-detail-loading')&&document.getElementById('dialog-content').textContent.includes("showing Player 2's details")`), 180000);
  report.partnerPopup = true;
  await browser.evaluate(`document.querySelector('.dialog-header .close-button').click();document.getElementById('completed-open').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('.completed-players')`), 180000);
  report.completed = {};
  for (const name of ['Player 1', 'Player 2', 'Both']) {
    await browser.evaluate(`[...document.querySelectorAll('.completed-player')].find(n=>n.textContent===${JSON.stringify(name)}).click()`);
    await until(() => browser.evaluate(`!!document.querySelector('.completed-players')&&document.querySelector('.completed-view').getAttribute('aria-busy')!=='true'&&[...document.querySelectorAll('.completed-player')].find(n=>n.textContent===${JSON.stringify(name)})?.getAttribute('aria-pressed')==='true'`), 180000);
    report.completed[name] = await browser.evaluate(`({summary:document.querySelector('.completed-totals').textContent,evidence:[...document.querySelectorAll('.completed-attribution')].slice(0,2).map(n=>n.firstElementChild.textContent),map:document.getElementById('member').value,group:document.getElementById('group-view').checked,duoFilter:[...document.querySelectorAll('.duo-task-chip')].find(n=>n.getAttribute('aria-pressed')==='true').textContent})`);
    assert.equal(report.completed[name].map, 'player1'); assert.equal(report.completed[name].group, true); assert.equal(report.completed[name].duoFilter, 'All');
    assert.ok(report.completed[name].evidence.every(line => line.startsWith('Done by ')));
  }
  await browser.evaluate(`[...document.querySelectorAll('.completed-player')].find(n=>n.textContent==='Player 2').click()`);
  await until(() => browser.evaluate(`document.querySelector('.completed-view').getAttribute('aria-busy')!=='true'&&!!document.querySelector('.completed-task-label')`), 180000);
  await browser.evaluate(`document.querySelector('.completed-task-label').click()`);
  await until(() => browser.evaluate(`!document.querySelector('.task-detail-loading')&&[...document.querySelectorAll('#dialog-content button')].some(n=>n.textContent==='Back to Completed Tasks')`), 180000);
  await browser.evaluate(`[...document.querySelectorAll('#dialog-content button')].find(n=>n.textContent==='Back to Completed Tasks').click()`);
  await until(() => browser.evaluate(`document.querySelector('.completed-view')?.getAttribute('aria-busy')!=='true'&&[...document.querySelectorAll('.completed-player')].find(n=>n.textContent==='Player 2')?.getAttribute('aria-pressed')==='true'`), 180000);
  report.backToPlayer2 = true;
  await browser.evaluate(`document.querySelector('.dialog-header .close-button').click();__rs3Perf.events=[];document.getElementById('group-view').checked=false;document.getElementById('group-view').dispatchEvent(new Event('change'))`);
  await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name==='tasks-shown'&&e.memberId==='player1')&&!document.querySelector('#active-tasks .duo-task-row')`), 180000);
  report.personalRestored = true;
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ duo: report.duo.header, filters: report.filters, popup: report.popup, partnerPopup: report.partnerPopup, completed: Object.fromEntries(Object.entries(report.completed).map(([name, value]) => [name, value.summary])), backToPlayer2: report.backToPlayer2, personalRestored: report.personalRestored, screenshots: Object.keys(report.screenshots) }));
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 10000).catch(() => {}); }
  await stopChild(child);
  const resolved = await realpath(scratch), boundary = await realpath(output);
  assert.ok(resolved.startsWith(boundary + path.sep) && path.basename(resolved).startsWith('scratch-'));
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  assert.equal(hash(await readFile(path.join(source, 'state.json'))), sourceHash);
}
