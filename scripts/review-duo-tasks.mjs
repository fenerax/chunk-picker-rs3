// Isolated real-save/visual review. No credentials or save payloads are reported.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openChrome, stopChild, until, sleep } from './perf/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local/groupview-review');
const main = 'C:/Users/User/Projects/chunk-picker-rs3';
const source = path.join(root, '.local/groupview-save');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(await readFile(path.join(source, 'state.json')));
await mkdir(output, { recursive: true });
// Stop observing before interactions; the probe is installed at document start.
const init = `globalThis.__rs3Perf={enabled:true,events:[]};globalThis.__groupReviewObserver=new MutationObserver(()=>{const n=document.getElementById('group-view');if(n){n.checked=false;__groupReviewObserver.disconnect();}});__groupReviewObserver.observe(document,{childList:true,subtree:true});`;
const reports = {};
async function run(label, entry, actions, { groupOn = false, inspectPersonal = true } = {}) {
  const scratch = await mkdtemp(path.join(output, 'scratch-'));
  let child, browser;
  try {
    const data = path.join(scratch, 'duo');
    await cp(source, data, { recursive: true, filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
    assert.equal(hash(await readFile(path.join(data, 'state.json'))), sourceHash);
    const env = { ...process.env, RS3_PERF_SCRATCH: data, RS3_PERF_PREWARM: 'off', RS3_PERF_SERVER_ENTRY: entry,
      RS3_DATA_DIR: data, RS3_GAME_DATA_DIR: path.join(main, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(main, '.local/map-assets') };
    delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
    child = fork(path.join(root, 'scripts/perf/server.mjs'), [], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Review server timed out.')), 180000); child.once('message', value => { clearTimeout(timer); value.type === 'ready' ? resolve(value) : reject(new Error('Review server failed.')); }); child.once('error', reject); });
    const url = new URL(ready.inviteUrl);
    assert.equal(url.hostname, '127.0.0.1'); assert.ok(![8788, 8789, 8790].includes(Number(url.port)));
    browser = await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: groupOn ? init.replace('n.checked=false', 'n.checked=true') : init });
    await browser.send('Page.navigate', { url: ready.inviteUrl });
    await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name===${JSON.stringify(groupOn ? 'duo-tasks-shown' : 'tasks-shown')}&&e.memberId==='player1')`), 180000);
    const personal = {};
    for (const id of inspectPersonal ? ['player1', 'player2'] : []) {
      await browser.evaluate(`(()=>{const n=document.getElementById('member');n.value=${JSON.stringify(id)};n.dispatchEvent(new Event('change'));})()`);
      await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name==='tasks-shown'&&e.memberId===${JSON.stringify(id)}) && document.getElementById('member').value===${JSON.stringify(id)} && !/Updating|Calculating/.test(document.getElementById('task-engine-status').textContent)`), 180000);
      personal[id] = await browser.evaluate(`(async()=>{const labels=[...document.querySelectorAll('#active-tasks .task-label-button')].map(n=>n.textContent);const header=document.getElementById('task-count').textContent;const result=await fetch('/api/tasks?memberId='+document.getElementById('member').value+'&view=play-v1').then(r=>r.json());return {count:/^[\\d,]+$/.test(header)?Number(header.replaceAll(',','')):labels.length,labels,presentedIds:result.presentation.tasks.map(n=>n.id)};})()`);
    }
    reports[label] = { personal };
    if (actions) await actions(browser, reports[label]);
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 10000).catch(() => {}); }
    await stopChild(child);
    const resolved = await realpath(scratch), boundary = await realpath(output);
    assert.ok(resolved.startsWith(boundary + path.sep) && path.basename(resolved).startsWith('scratch-'));
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    assert.equal(hash(await readFile(path.join(source, 'state.json'))), sourceHash);
  }
}
async function screenshot(browser, filename, width = 1440, theme = 'dark') {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
  await browser.evaluate(`import('/map-tools.mjs').then(m=>m.applyTheme(document.documentElement,${JSON.stringify(theme)}))`);
  if (width === 390) await browser.evaluate(`document.querySelector('.task-sidebar').scrollIntoView({block:'start'})`);
  await sleep(300);
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, filename), Buffer.from(shot.data, 'base64'));
  const sizes = await browser.evaluate(`({viewport:innerWidth,body:document.body.scrollWidth,sidebar:document.querySelector('.task-sidebar').getBoundingClientRect().width})`);
  assert.ok(sizes.body <= sizes.viewport, `Horizontal overflow in ${filename}`);
  return sizes;
}
await run('before', path.join(root, '.local/groupview-baseline/app/server.mjs'));
await run('after', path.join(root, 'app/server.mjs'), async (browser, report) => {
  await browser.evaluate(`document.getElementById('group-view').checked=true;document.getElementById('group-view').dispatchEvent(new Event('change'))`);
  await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown')`), 180000);
  report.duo = await browser.evaluate(`({header:document.getElementById('task-count').textContent,rows:[...document.querySelectorAll('#active-tasks .duo-task-row')].map(n=>({id:n.dataset.taskId,label:n.querySelector('.task-label-button').textContent,owners:n.dataset.owners,badge:n.querySelector('.duo-task-owner').textContent}))})`);
  report.filters = {};
  for (const label of ['Player 1', 'Player 2', 'Both', 'All']) {
    await browser.evaluate(`[...document.querySelectorAll('.duo-task-chip')].find(n=>n.textContent===${JSON.stringify(label)}).click()`); await sleep(100);
    report.filters[label] = await browser.evaluate(`document.querySelectorAll('#active-tasks .duo-task-row').length`);
  }
  report.screenshots = {};
  report.screenshots.desktop = await screenshot(browser, 'desktop-duo.png');
  report.screenshots.light = await screenshot(browser, 'desktop-duo-light.png', 1440, 'light');
  report.screenshots.phone = await screenshot(browser, 'phone-duo.png', 390, 'dark');
  report.screenshots.gray = await screenshot(browser, 'phone-duo-gray.png', 390, 'gray');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate(`import('/map-tools.mjs').then(m=>m.applyTheme(document.documentElement,'dark'));window.scrollTo(0,0);[...document.querySelectorAll('.duo-task-chip')].find(n=>n.textContent==='All').click()`); await sleep(100);
  const partner = report.duo.rows.find(row => row.owners === 'player1'); // Player 2 remains the selected map.
  assert.ok(partner, 'Expected a Player 1-only task on the real save.');
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(partner.id)}] .task-label-button').click()`);
  await until(() => browser.evaluate(`document.getElementById('tool-dialog').open&&!document.querySelector('.task-detail-loading')`), 180000);
  report.popupOwner = await browser.evaluate(`document.getElementById('dialog-content').textContent.includes("showing Player 1's details")`); assert.equal(report.popupOwner, true);
  await screenshot(browser, 'desktop-partner-task.png');
  await browser.evaluate(`document.querySelector('.dialog-header .close-button').click()`);
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(partner.id)}]').scrollIntoView({block:'center'})`);
  await sleep(300); // Scroll events dismiss hover cards; start the hover after scrolling settles.
  const hoverPoint = await browser.evaluate(`(()=>{const r=document.querySelector('[data-task-id=${JSON.stringify(partner.id)}]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
  await until(() => browser.evaluate(`[...document.querySelectorAll('.task-hover')].some(n=>!n.hidden)`), 30000);
  await screenshot(browser, 'desktop-partner-hover.png');
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(partner.id)}]').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))`);
  const both = report.duo.rows.find(row => row.badge === 'Both'); assert.ok(both);
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(both.id)}] input[type=checkbox]').click()`); await sleep(100);
  report.chooserDefault = await browser.evaluate(`document.querySelector('.duo-task-chooser select').value`); assert.equal(report.chooserDefault, 'player2');
  await screenshot(browser, 'desktop-both-chooser.png');
  await browser.evaluate(`document.querySelector('.duo-task-chooser').requestSubmit()`);
  await until(() => browser.evaluate(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(v=>v.state.members.find(m=>m.id==='player2').taskStatus[${JSON.stringify(both.id)}]?.challengeCompleted===true)`), 180000);
  await browser.evaluate(`document.getElementById('hide-completed').checked=false;document.getElementById('hide-completed').dispatchEvent(new Event('change'))`);
  await until(() => browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(both.id)}]')?.textContent.includes('Done by Player 2')`), 180000);
  report.sharedDone = true;
  report.sharedTarget = await browser.evaluate(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(v=>({player2:v.state.members.find(m=>m.id==='player2').taskStatus[${JSON.stringify(both.id)}]?.challengeCompleted===true,player1:v.state.members.find(m=>m.id==='player1').taskStatus[${JSON.stringify(both.id)}]?.challengeCompleted===true}))`);
  assert.deepEqual(report.sharedTarget, { player2: true, player1: false });
  await browser.evaluate(`document.getElementById('undo').click()`);
  await until(() => browser.evaluate(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(v=>!v.state.members.find(m=>m.id==='player2').taskStatus[${JSON.stringify(both.id)}]?.challengeCompleted)`), 180000);
  await browser.evaluate(`document.getElementById('hide-completed').checked=true;document.getElementById('hide-completed').dispatchEvent(new Event('change'))`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-task-id=${JSON.stringify(partner.id)}] .duo-task-backlog:not(:disabled)')`), 180000);
  await browser.evaluate(`document.querySelector('[data-task-id=${JSON.stringify(partner.id)}] .duo-task-backlog').click()`); await sleep(100);
  await browser.evaluate(`document.querySelector('.backlog-form').requestSubmit()`);
  await until(() => browser.evaluate(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(v=>v.state.members.find(m=>m.id==='player1').taskStatus[${JSON.stringify(partner.id)}]?.backlogged===true)`), 180000);
  report.backlogOwner = 'player1';
  await browser.evaluate(`document.getElementById('undo').click()`);
  await until(() => browser.evaluate(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(v=>!v.state.members.find(m=>m.id==='player1').taskStatus[${JSON.stringify(partner.id)}]?.backlogged)`), 180000);
});
// A fresh server/profile exercises optional foreground projection generation;
// the normal-first review above intentionally keeps its existing cache behavior.
await run('thin', path.join(root, 'app/server.mjs'), async (browser, report) => {
  report.projection = await browser.evaluate(`(async()=>{
    const [{state},rules]=await Promise.all([fetch('/api/state?view=play-v1').then(r=>r.json()),fetch('/api/rules').then(r=>r.json())]);
    const id=document.getElementById('member').value;
    const [thin,full]=await Promise.all([fetch('/api/tasks?memberId='+id+'&view=play-v1&projection=duo-sidebar-v1&revision='+state.revision).then(r=>r.json()),fetch('/api/tasks?memberId='+id+'&view=play-v1').then(r=>r.json())]);
    const [{createTaskFactsIndex},{createRuleRegistryFromDefinitions}]=await Promise.all([import('/core/progress-index.mjs'),import('/core/rule-registry.mjs')]);
    const registry=createRuleRegistryFromDefinitions(rules.definitions),owner=state.members.find(m=>m.id===id);
    const select=result=>{const facts=createTaskFactsIndex(state,id,registry,{tasks:result.tasks,completionGroups:result.collectionPlanning?.completionGroups??{}});const rows=result.tasks.filter(t=>t.obligation!==false&&!t.hidden);return {completed:rows.filter(t=>facts.get(t.id,t.completionIds).group).map(t=>t.id).sort(),backlog:rows.filter(t=>owner.taskStatus?.[t.id]?.backlogged).map(t=>t.id).sort(),all:rows.filter(t=>t.status==='available'&&!owner.taskStatus?.[t.id]?.backlogged&&!facts.get(t.id,t.completionIds).group).length};};
    const a=select(thin),b=select(full);
    return {marker:thin.projection,thinRows:thin.tasks.length,fullRows:full.tasks.length,completedMatch:JSON.stringify(a.completed)===JSON.stringify(b.completed),backlogMatch:JSON.stringify(a.backlog)===JSON.stringify(b.backlog),completedCount:b.completed.length,backlogCount:b.backlog.length,expectedAll:b.all,completedUi:document.getElementById('completed-count').textContent,backlogUi:document.getElementById('backlog-count').textContent};
  })()`);
  assert.equal(report.projection.marker, 'duo-sidebar-v1');
  assert.equal(report.projection.completedMatch, true); assert.equal(report.projection.backlogMatch, true);
  assert.equal(report.projection.completedUi, `(${report.projection.completedCount})`);
  assert.equal(report.projection.backlogUi, `(${report.projection.backlogCount})`);
  await browser.evaluate(`__rs3Perf.events=[];document.getElementById('show-all').checked=true;document.getElementById('group-view').checked=false;document.getElementById('group-view').dispatchEvent(new Event('change'))`);
  await until(() => browser.evaluate(`__rs3Perf.events.some(e=>e.name==='tasks-shown'&&e.memberId==='player1')&&Number(document.getElementById('task-count').textContent.replaceAll(',',''))===${report.projection.expectedAll}`), 180000);
  report.normalRestored = await browser.evaluate(`({count:Number(document.getElementById('task-count').textContent.replaceAll(',','')),rendered:document.querySelectorAll('#active-tasks .task-label-button').length,categoryTotal:[...document.querySelectorAll('#active-tasks .category-heading')].reduce((sum,n)=>sum+Number(n.textContent.match(/\\((\\d+)\\)$/)?.[1]??0),0),all:document.getElementById('show-all').checked,enabled:!document.getElementById('show-all').disabled,duoRows:document.querySelectorAll('#active-tasks .duo-task-row').length})`);
  assert.equal(report.normalRestored.count, report.projection.expectedAll);
  assert.equal(report.normalRestored.categoryTotal, report.projection.expectedAll);
  assert.ok(report.normalRestored.rendered > reports.after.duo.rows.length);
  assert.equal(report.normalRestored.all, true); assert.equal(report.normalRestored.enabled, true); assert.equal(report.normalRestored.duoRows, 0);
}, { groupOn: true, inspectPersonal: false });
for (const id of ['player1', 'player2']) assert.deepEqual(reports.after.personal[id], reports.before.personal[id], `Personal task behavior changed for ${id}`);
reports.fixture = { stateSha256: sourceHash, baseline: 'c9d765b' };
await writeFile(path.join(output, 'checks.json'), JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify({ before: Object.fromEntries(Object.entries(reports.before.personal).map(([id, value]) => [id, value.count])), after: Object.fromEntries(Object.entries(reports.after.personal).map(([id, value]) => [id, value.count])), duo: reports.after.duo.header, filters: reports.after.filters, popupOwner: reports.after.popupOwner, chooserDefault: reports.after.chooserDefault, sharedDone: reports.after.sharedDone }));
