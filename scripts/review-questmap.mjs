// Run only through .local/with-heavy.ps1. Credentials and gameplay state stay in scratch.
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer as tcpServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopChild, until, sleep } from './perf/cdp.mjs';

const filename = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(filename), '..');
const origin = 'http://127.0.0.1:8951', output = path.join(root, '.local/screens');
const source = path.join(root, '.local/duo');
const hash = value => createHash('sha256').update(value).digest('hex');

if (process.argv.includes('--server-child')) {
  let application;
  try {
    const { openInviteStore } = await import('../app/storage/invites.mjs');
    const invites = await openInviteStore({ dataDir: process.env.RS3_REVIEW_SCRATCH, masterToken: 'scratch-fixture-only' });
    const viewer = await invites.create({ label: 'Scratch browser viewer', viewer: true });
    await invites.close();
    const { createServer } = await import('../app/server.mjs');
    application = await createServer({ dataDir: process.env.RS3_REVIEW_SCRATCH, host: '127.0.0.1', port: 8951,
      loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false });
    await application.listen();
    process.send({ type: 'ready', admin: application.inviteUrl, viewer: `${origin}/join/${viewer.token}` });
    process.on('message', async message => { if (message.type === 'stop') { await application.close(); process.exit(0); } });
    process.once('disconnect', async () => { await application.close(); process.exit(0); });
  } catch { process.send?.({ type: 'error' }); await application?.close(); process.exit(1); }
} else {
  await main();
}

async function freePort(port) {
  const server = tcpServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

async function launchChrome(profile) {
  const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=8952', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  let socket;
  try {
    const target = await until(async () => {
      if (child.exitCode !== null) throw Error('Scratch Chrome exited.');
      try { return (await (await fetch('http://127.0.0.1:8952/json')).json()).find(row => row.type === 'page'); } catch { return false; }
    });
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('CDP connection failed.')), { once: true }); });
    let next = 0;
    const pending = new Map(), listeners = new Set();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) { for (const listener of listeners) listener(message); return; }
      const entry = pending.get(message.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      message.error ? entry.reject(Error(`CDP ${entry.method} failed.`)) : entry.resolve(message.result);
    });
    socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('CDP closed.')); } pending.clear(); });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP ${method} timed out.`)); }, 180000);
      pending.set(id, { resolve, reject, method, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Unknown browser exception';
        throw Error(`Browser probe: ${detail}`.replace(/\/join\/[^\s'"<>]+/g, '/join/[redacted]')
          .replace(/https?:\/\/[^\s'"<>]+/g, '[redacted URL]').slice(0, 250));
      }
      return result.result?.value;
    };
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await send(method);
    return { send, evaluate, listeners, async close() { try { await send('Browser.close'); } catch {} socket.close(); await stopChild(child); } };
  } catch (error) { socket?.close(); await stopChild(child); throw error; }
}

async function main() {
  assert.ok(process.env.RS3_HEAVY_LOCK_PATH && process.env.RS3_HEAVY_LOCK_TOKEN, 'Run through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(process.env.RS3_HEAVY_LOCK_PATH, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  assert.ok(owner.token === process.env.RS3_HEAVY_LOCK_TOKEN, 'Shared heavy lock ownership mismatch.');
  assert.ok(process.env.RS3_GAME_DATA_DIR && process.env.RS3_MAP_ASSETS_DIR, 'Shared read-only asset paths required.');
  await freePort(8951); await freePort(8952);
  const before = hash(await readFile(path.join(source, 'state.json')));
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(path.join(output, 'scratch-questmap-'));
  const data = path.join(scratch, 'duo');
  const report = { passed: false, stage: 'setup', screenshots: {}, checks: {}, pageErrors: 0, externalRequests: 0, gameplayWrites: 0, csp: [] };
  let child, browser, initialStateHash, unlocked, failed = false;
  const probe = expression => browser.evaluate(expression);
  const wait = expression => until(() => probe(expression), 180000);
  const visible = selector => `(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n&&!n.hidden&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0})()`;
  async function click(selector, text) {
    assert.equal(await probe(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!n)return false;n.click();return true})()`), true, `Missing control: ${text}`);
  }
  async function readyPage(url, viewer = false) {
    await browser.send('Page.navigate', { url });
    await wait(`!!document.getElementById('member')&&globalThis.__rs3Perf?.events.some(e=>e.name==='tasks-shown'||e.name==='duo-tasks-shown')${viewer ? "&&document.documentElement.dataset.readOnly==='true'" : ''}`);
    await probe(`(async()=>{const {ChunkMap}=await import('/map.mjs');globalThis.__mapReview={matches:[],fits:[]};const set=ChunkMap.prototype.setSearchMatches,fit=ChunkMap.prototype.centerOnChunks;ChunkMap.prototype.setSearchMatches=function(ids,options){__mapReview.matches.push({ids:[...(ids??[])],options:options??null});return set.call(this,ids,options)};ChunkMap.prototype.centerOnChunks=function(ids){const result=fit.call(this,ids);__mapReview.fits.push({ids:[...ids],result});return result};})()`);
  }
  async function searchQuest(name) {
    await probe(`document.getElementById('tool-dialog').close();document.getElementById('search-open').click()`);
    await wait(`document.getElementById('dialog-title').textContent==='Search'&&!!document.querySelector('#dialog-content input[type="search"]')`);
    assert.equal(await probe(`document.querySelector('.quest-map-status')?.hidden!==false`), true, 'Opening Search must clear quest highlights.');
    await probe(`(()=>{const n=[...document.querySelectorAll('#dialog-content select')].find(n=>[...n.options].some(o=>o.value==='Quests'));n.value='Quests';n.dispatchEvent(new Event('change',{bubbles:true}));const q=document.querySelector('#dialog-content input[type="search"]');q.value=${JSON.stringify(name)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    // Local presentation preferences can survive earlier reviews. Reset chips.
    await probe(`(()=>{for(const group of ['Quest progress','Activity status']){const n=[...document.querySelectorAll('#dialog-content [aria-label="'+group+'"] button')].find(n=>n.textContent==='All');n?.click();}})()`);
    await wait(`document.querySelector('.search-results')?.getAttribute('aria-busy')!=='true'&&[...document.querySelectorAll('.search-result')].some(n=>n.querySelector('span')?.textContent.startsWith(${JSON.stringify(name)}))`);
    const label = await probe(`(()=>{const rows=[...document.querySelectorAll('.search-result')].filter(n=>n.querySelector('span')?.textContent.startsWith(${JSON.stringify(name)}));const row=rows.find(n=>/Complete the (quest|miniquest|subquest)/i.test(n.querySelector('span').textContent))??rows[0];const label=row.querySelector('span').textContent;row.querySelector('button').click();return label})()`);
    await wait(visible('#dialog-content .quest-map-controls button'));
    return label;
  }
  async function show(name, expectedIds, interior) {
    await click('#dialog-content .quest-map-controls button', 'Show on map');
    await wait(visible('.quest-map-status'));
    const state = await probe(`(()=>{const n=document.querySelector('.quest-map-status');return {open:document.getElementById('tool-dialog').open,title:n.querySelector('strong').textContent,status:n.querySelector('[role="status"]').textContent,notes:n.querySelector('.quest-map-notes').textContent,clear:n.querySelector('button').getAttribute('aria-label'),match:__mapReview.matches.at(-1),fit:__mapReview.fits.at(-1)}})()`);
    assert.equal(state.open, false, 'Show on map must close task/Activity Info dialog.');
    assert.equal(state.title, name);
    assert.deepEqual([...state.match.ids].sort(), [...expectedIds].sort(), `${name} route differs from retained recorded surface chunks.`);
    assert.ok(Array.isArray(state.match.options?.lockedIds), 'Locked styling options are absent.');
    assert.deepEqual([...state.match.options.lockedIds].sort(), expectedIds.filter(id => !unlocked.has(id)).sort(), 'Locked chunks must use ownership union of both players.');
    assert.deepEqual(state.fit.ids, state.match.ids, 'Fit must include every highlighted chunk.');
    assert.equal(state.fit.result, true, 'Fit did not center the recorded route.');
    assert.equal(state.status, `${expectedIds.length} ${expectedIds.length === 1 ? 'chunk' : 'chunks'} · ${state.match.options.lockedIds.length} still locked`);
    if (interior) assert.ok(state.notes.includes(interior), 'Recorded interior limitation missing.');
    assert.equal(state.clear, 'Clear quest highlights');
    assert.equal(await probe(visible('.quest-map-status button')), true);
    return { chunks: state.match.ids.length, locked: state.match.options.lockedIds.length, fit: true, interior: interior ?? null };
  }
  async function screenshot(name, width, height) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    await sleep(250);
    assert.equal(await probe('scrollY'), 0, 'Showing a quest must retain the top of the map in view.');
    const sizes = await probe(`(()=>{const n=document.querySelector('.quest-map-status'),r=n.getBoundingClientRect();return {viewport:innerWidth,body:document.body.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hidden:n.hidden}})()`);
    assert.equal(sizes.hidden, false);
    assert.ok(sizes.body <= width + 1 && sizes.left >= 0 && sizes.right <= width + 1 && sizes.top >= 0 && sizes.bottom <= height, 'Quest strip must fit visibly within screenshot viewport.');
    const png = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, name), Buffer.from(png.data, 'base64'));
    report.screenshots[name] = { width, height, path: `.local/screens/${name}` };
  }
  async function activityQuest(name) {
    await probe(`document.getElementById('activity-open').click()`);
    await wait(`document.getElementById('dialog-title').textContent==='Activity Info'&&!!document.querySelector('#dialog-content [role="tab"]')`);
    await click('#dialog-content [role="tab"]', 'Quests');
    await probe(`(()=>{for(const group of ['Quest progress','Activity status']){const n=[...document.querySelectorAll('#dialog-content [aria-label="'+group+'"] button')].find(n=>n.textContent==='All');n?.click();}})()`);
    // Group lists are paged; use their own search before expanding a natural quest group.
    await probe(`(()=>{const n=document.querySelector('#dialog-content [role="tabpanel"] input[type="search"]');if(n){n.value=${JSON.stringify(name)};n.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await wait(`[...document.querySelectorAll('#dialog-content [role="tabpanel"] details')].some(n=>n.querySelector('summary')?.textContent.startsWith(${JSON.stringify(name + ' · ')}))`);
    await probe(`(()=>{const n=[...document.querySelectorAll('#dialog-content [role="tabpanel"] details')].find(n=>n.querySelector('summary')?.textContent.startsWith(${JSON.stringify(name + ' · ')}));n.open=true;n.dispatchEvent(new Event('toggle'));})()`);
    await wait(visible('#dialog-content .quest-map-controls button'));
  }
  try {
    await cp(source, data, { recursive: true, filter: file => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(file)) });
    const env = { ...process.env, RS3_REVIEW_SCRATCH: data, RS3_DATA_DIR: data };
    delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
    child = fork(filename, ['--server-child'], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Scratch server timeout.')), 180000);
      child.once('message', message => { clearTimeout(timer); message.type === 'ready' ? resolve(message) : reject(Error('Scratch server failed.')); });
      child.once('error', () => { clearTimeout(timer); reject(Error('Scratch server launch failed.')); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Scratch server exited.')); });
    });
    for (const url of [ready.admin, ready.viewer]) assert.equal(new URL(url).origin, origin);
    initialStateHash = hash(await readFile(path.join(data, 'state.json')));
    const storedState = JSON.parse(await readFile(path.join(data, 'state.json'), 'utf8'));
    unlocked = new Set((storedState.state?.members ?? storedState.members).flatMap(member => member.unlocked));
    browser = await launchChrome(path.join(scratch, 'chrome'));
    browser.listeners.add(message => {
      if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error') report.pageErrors++;
      if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request, url = new URL(request.url);
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) report.externalRequests++;
        if (!['GET', 'HEAD'].includes(request.method) && /^\/api\/(command|runemetrics|original-sync|restore|import|training-plan|invites)(\/|$)/.test(url.pathname)) report.gameplayWrites++;
      }
      if (message.method === 'Network.responseReceived' && message.params.type === 'Document') report.csp.push(Object.entries(message.params.response.headers).find(([name]) => name.toLowerCase() === 'content-security-policy')?.[1] ?? '');
    });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__rs3Perf={enabled:true,events:[]};' });
    await readyPage(ready.admin);
    report.stage = 'admin task dialog';
    report.taskLabel = await searchQuest('Druidic Ritual');
    report.checks.taskDialog = await show('Druidic Ritual', ['11572', '11573', '11574'], 'Burthorpe Slayer Cave');
    const animalChunks = ['11575', '11826', '12340', '12849', '12850', '13622', '13879', '14391'];
    await searchQuest('Animal Magnetism');
    report.checks.animalMagnetismDesktop = await show('Animal Magnetism', animalChunks);
    await screenshot('questmap-desktop-1440.png', 1440, 900);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(250);
    await searchQuest('Animal Magnetism');
    report.checks.animalMagnetismPhone = await show('Animal Magnetism', animalChunks);
    await screenshot('questmap-phone-390.png', 390, 844);
    await click('.quest-map-status button', 'Clear');
    assert.equal(await probe(`document.querySelector('.quest-map-status').hidden&&__mapReview.matches.at(-1).ids.length===0`), true);
    report.checks.clear = true;
    report.stage = 'replacement and lifecycle';
    await searchQuest('Druidic Ritual'); await show('Druidic Ritual', ['11572', '11573', '11574'], 'Burthorpe Slayer Cave');
    await searchQuest('Goblin Diplomacy'); await show('Goblin Diplomacy', ['11830']);
    assert.equal(await probe(`document.querySelectorAll('.quest-map-status:not([hidden])').length`), 1);
    report.checks.replacement = true;
    const switched = await probe(`(()=>{const n=document.getElementById('member'),next=[...n.options].find(o=>o.value!==n.value);if(!next)return false;n.value=next.value;n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    assert.equal(switched, true, 'Real duo save needs two members.');
    await wait(`document.querySelector('.quest-map-status').hidden&&__mapReview.matches.at(-1).ids.length===0`);
    report.checks.memberSwitch = true;
    report.stage = 'Activity Info quest';
    await activityQuest('Druidic Ritual');
    report.checks.activityInfo = await show('Druidic Ritual', ['11572', '11573', '11574'], 'Burthorpe Slayer Cave');
    await probe(`document.getElementById('search-open').click()`);
    await wait(`document.getElementById('dialog-title').textContent==='Search'&&document.querySelector('.quest-map-status').hidden&&__mapReview.matches.at(-1).ids.length===0`);
    report.checks.searchClears = true;
    report.stage = 'viewer task and Activity Info';
    await browser.send('Network.clearBrowserCookies');
    await readyPage(ready.viewer, true);
    await searchQuest('Druidic Ritual');
    assert.equal(await probe(`[...document.querySelectorAll('#dialog-content button')].some(n=>!n.disabled&&/Save note|Restore from backlog|Backlog/.test(n.textContent))`), false, 'Viewer has active write controls.');
    report.checks.viewerTask = await show('Druidic Ritual', ['11572', '11573', '11574'], 'Burthorpe Slayer Cave');
    await activityQuest('Druidic Ritual');
    report.checks.viewerActivity = await show('Druidic Ritual', ['11572', '11573', '11574'], 'Burthorpe Slayer Cave');
    report.gameplayStateUnchanged = hash(await readFile(path.join(data, 'state.json'))) === initialStateHash;
    assert.equal(report.gameplayStateUnchanged, true, 'Browser review changed scratch state.');
    assert.equal(report.pageErrors, 0); assert.equal(report.gameplayWrites, 0); assert.equal(report.externalRequests, 0);
    assert.ok(report.csp.length >= 2 && report.csp.every(csp => csp.includes("default-src 'self'") && !csp.includes("'unsafe-eval'") && !/script-src[^;]*'unsafe-inline'/.test(csp)), 'Strict CSP missing.');
    report.passed = true; report.stage = 'complete';
  } catch (error) {
    failed = true;
    report.failure = `${error.name}: ${error.message}`.replace(/\/join\/[^\s'"<>]+/g, '/join/[redacted]').replace(/https?:\/\/[^\s'"<>]+/g, '[redacted URL]').slice(0, 250);
  } finally {
    let clean = true;
    try { await browser?.close(); } catch { clean = false; }
    try { if (child?.connected && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 15000).catch(() => {}); } await stopChild(child); } catch { clean = false; }
    if (clean) {
      const absolute = await realpath(scratch), boundary = await realpath(output);
      assert.ok(absolute.startsWith(boundary + path.sep) && path.basename(absolute).startsWith('scratch-questmap-'));
      await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    report.scratchRemoved = clean;
    report.sourceUnchanged = hash(await readFile(path.join(source, 'state.json'))) === before;
    report.passed &&= clean && report.sourceUnchanged;
    await writeFile(path.join(output, 'questmap-checks.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (failed || !report.passed) throw Error(`Quest map review failed at ${report.stage}; see .local/screens/questmap-checks.json (credentials redacted).`);
  console.log(JSON.stringify({ passed: true, checks: report.checks, screenshots: report.screenshots, gameplayWrites: report.gameplayWrites, pageErrors: report.pageErrors, sourceUnchanged: report.sourceUnchanged, scratchRemoved: report.scratchRemoved }));
}
