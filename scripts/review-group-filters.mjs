// Disposable copied-save browser review. No live save or ordinary browser is used.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { stopChild, until, sleep } from './perf/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.local/duo'), output = path.join(root, '.local/screens');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash(await readFile(path.join(source, 'state.json')));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, 'groupfilters-scratch-'));
const report = { sourceHash, chips: {}, owners: {}, personalFilters: {}, screenshots: {} };
let child, browser, failure, inspections = 0;
const probe = expression => browser.evaluate(expression);
async function settle() {
  let previous, stable = 0;
  await until(async () => {
    const value = await probe(`JSON.stringify({count:document.getElementById('task-count').textContent,status:[...document.querySelectorAll('#active-tasks .status-detail')].map(n=>n.textContent),headings:[...document.querySelectorAll('#active-tasks .category-heading')].map(n=>n.textContent),rows:[...document.querySelectorAll('#active-tasks .task-row')].map(n=>n.dataset.taskId)})`);
    const state = JSON.parse(value);
    if (value === previous && !/updating|Loading/.test(state.count) && !state.status.length) stable++; else stable = 0;
    previous = value; return stable >= 3;
  }, 180000, 150);
}
async function change(id, value) {
  await probe(`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw Error('Missing control');if(n.type==='checkbox'){if(n.disabled)throw Error('Disabled filter');n.checked=${JSON.stringify(value)}}else n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(n.id==='task-filter'?'input':'change',{bubbles:true}));})()`);
  await sleep(120); await settle();
}
async function owner(name) {
  await probe(`(()=>{const n=[...document.querySelectorAll('.duo-task-chip')].find(n=>n.textContent===${JSON.stringify(name)});if(!n)throw Error('Missing owner');n.click()})()`); await settle();
}
async function snapshot() {
  const value = await probe(`({count:document.getElementById('task-count').textContent,headings:[...document.querySelectorAll('#active-tasks .category-heading')].map(n=>n.textContent),rows:[...document.querySelectorAll('#active-tasks .task-row')].map(n=>({id:n.dataset.taskId,label:n.querySelector('.task-label-button').textContent,owners:n.dataset.owners,blocked:[...n.querySelectorAll('.blocked-reason')].map(n=>n.textContent)}))})`);
  value.total = value.headings.reduce((total, heading) => total + Number(/\((\d+)\)$/.exec(heading)?.[1] ?? 0), 0);
  assert.equal(Number(/Duo tasks (\d+)/.exec(value.count)?.[1]), value.total, 'Heading counts must match displayed task count');
  value.idHash = hash(JSON.stringify(value.rows.map(n => n.id)));
  return value;
}
async function capture(name, width) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
  if (width === 390) await probe(`document.querySelector('.task-sidebar').scrollIntoView({block:'start'})`);
  else await probe('window.scrollTo(0,0)');
  await sleep(200);
  const sizes = await probe(`({viewport:innerWidth,body:document.body.scrollWidth,secondary:document.getElementById('duo-personal-filter').getBoundingClientRect().width})`);
  assert.ok(sizes.body <= width, 'Horizontal overflow'); assert.ok(sizes.secondary <= width, 'Secondary filter overflow');
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, name), Buffer.from(shot.data, 'base64')); report.screenshots[name] = sizes;
}
try {
  const data = path.join(scratch, 'duo');
  await cp(source, data, { recursive: true, filter: name => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(name)) });
  const env = { ...process.env, RS3_PERF_SCRATCH: data, RS3_PERF_PREWARM: 'off', RS3_PERF_SERVER_ENTRY: path.join(root, 'app/server.mjs'), RS3_DATA_DIR: data };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  // Adapt the existing perf child to the job's assigned picker port.
  const serverEntry = path.join(scratch, 'server.mjs');
  const serverCode = (await readFile(path.join(root, 'scripts/perf/server.mjs'), 'utf8')).replace("host: '127.0.0.1', port: 0", "host: '127.0.0.1', port: 9021");
  await writeFile(serverEntry, serverCode);
  child = fork(serverEntry, [], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Scratch server timed out')), 180000);
    child.once('message', message => { clearTimeout(timer); message.type === 'ready' ? resolve(message) : reject(new Error('Scratch server failed')); });
    child.once('error', reject); child.once('exit', () => reject(new Error('Scratch server exited')));
  });
  assert.equal(new URL(ready.inviteUrl).port, '9021');
  const browserEntry = path.join(scratch, 'cdp.mjs');
  const browserCode = (await readFile(path.join(root, 'scripts/perf/cdp.mjs'), 'utf8'))
    .replace('--remote-debugging-port=0', '--remote-debugging-port=9022')
    .replace(/const port = await until\(async \(\) => \{[\s\S]*?\n    \}\);/, 'const port = 9022;');
  await writeFile(browserEntry, browserCode);
  const { openChrome } = await import(pathToFileURL(browserEntry).href);
  browser = await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
  browser.listeners.add(message => { if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).searchParams.get('projection') === 'duo-inspection-v1') inspections++; });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__rs3Perf={enabled:true,events:[]};localStorage.setItem('rs3:group-view','true');` });
  await browser.send('Page.navigate', { url: ready.inviteUrl });
  await until(() => probe(`!!document.querySelector('.duo-task-chip')&&__rs3Perf.events.some(n=>n.name==='duo-tasks-shown')`), 180000);
  await change('group-view', true); await change('hide-completed', true); await owner('All');
  await change('duo-personal-filter', 'group');
  report.chips.normal = await snapshot(); assert.equal(inspections, 0, 'Default page must not fetch inspection rows');
  await change('show-all', true); report.chips.all = await snapshot();
  assert.ok(report.chips.all.total > report.chips.normal.total, 'All possible must change the list');
  const cachedRequests = inspections; assert.equal(cachedRequests, 2, 'First inspection fetches both players once');
  await change('show-all', false); await change('show-blocked', true); report.chips.blocked = await snapshot();
  assert.ok(report.chips.blocked.total > report.chips.all.total, 'Show blocked must expose blocked rows');
  assert.ok(report.chips.blocked.rows.some(row => row.blocked.some(text => /^(Player 1|Player 2):/.test(text))), 'Blocked rows attribute a reason to a player');
  for (const name of ['Player 1', 'Player 2', 'Both']) {
    await owner(name); report.owners[name] = await snapshot();
    assert.ok(report.owners[name].total > 0);
    assert.ok(report.owners[name].rows.every(row => name === 'Both' ? row.owners.split(',').length === 2 : row.owners.includes(name === 'Player 1' ? 'player1' : 'player2')));
  }
  await owner('Player 2'); const example = (await snapshot()).rows.find(row => row.blocked.length);
  assert.ok(example, 'Player 2 has a blocked row'); await change('task-filter', example.label);
  report.search = await snapshot(); assert.ok(report.search.rows.some(row => row.id === example.id));
  await change('task-doable', true); const doable = await snapshot(); assert.ok(doable.rows.every(row => !row.blocked.length));
  await change('task-doable', false); await change('task-filter', ''); await change('show-blocked', false); await owner('All');
  for (const member of ['player1', 'player2']) {
    await change('member', member);
    for (const choice of ['not-done', 'only-player']) {
      await change('duo-personal-filter', choice); report.personalFilters[`${member}:${choice}`] = await snapshot();
      assert.equal(await probe(`document.getElementById('task-doable').disabled`), true, 'Personal mode explains its fixed readiness filter');
    }
  }
  assert.equal(inspections, cachedRequests, 'Repeated chips and selected-player switches reuse revision cache');
  await change('member', 'player1'); await change('duo-personal-filter', 'not-done');
  await capture('groupfilters-desktop-1440.png', 1440); await capture('groupfilters-phone-390.png', 390);
  await browser.send('Page.reload'); await until(() => probe(`document.getElementById('duo-personal-filter')?.value==='not-done'&&__rs3Perf.events.some(n=>n.name==='duo-tasks-shown')`), 180000); await settle();
  report.preferenceRestored = true;
  await change('group-view', false); const personalBefore = await probe(`document.getElementById('task-count').textContent`);
  await change('group-view', true); await change('duo-personal-filter', 'only-player'); await change('group-view', false);
  assert.equal(await probe(`document.getElementById('task-count').textContent`), personalBefore, 'Secondary choice does not affect personal mode');
  report.inspectionRequests = inspections; report.passed = true;
} catch (error) { failure = error; report.passed = false; report.failure = 'Browser review assertion failed'; }
finally {
  const cleanup = [];
  try { await browser?.close(); } catch (error) { cleanup.push(error); }
  try { if (child?.connected && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 10000).catch(() => {}); } await stopChild(child); } catch (error) { cleanup.push(error); }
  if (!cleanup.length) { const resolved = await realpath(scratch), boundary = await realpath(output); assert.ok(resolved.startsWith(boundary + path.sep)); await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); report.scratchRemoved = true; }
  report.sourceUnchanged = hash(await readFile(path.join(source, 'state.json'))) === sourceHash;
  await writeFile(path.join(output, 'groupfilters-checks.json'), JSON.stringify(report, null, 2) + '\n');
  if (cleanup.length && !failure) failure = new Error('Scratch cleanup failed');
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: report.passed, chips: Object.fromEntries(Object.entries(report.chips).map(([name, value]) => [name, value.total])), personal: Object.fromEntries(Object.entries(report.personalFilters).map(([name, value]) => [name, value.total])), sourceUnchanged: report.sourceUnchanged, scratchRemoved: report.scratchRemoved }));
