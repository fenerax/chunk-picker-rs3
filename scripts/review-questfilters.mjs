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
const origin = 'http://127.0.0.1:8831', output = path.join(root, '.local/screens');
const source = path.join(root, '.local/duo'), key = 'rs3:activity-info-filters:v1';
const hash = value => createHash('sha256').update(value).digest('hex');

if (process.argv.includes('--server-child')) {
  let application;
  try {
    const { openInviteStore } = await import('../app/storage/invites.mjs');
    const invites = await openInviteStore({ dataDir: process.env.RS3_REVIEW_SCRATCH, masterToken: 'scratch-fixture-only' });
    const viewer = await invites.create({ label: 'Scratch browser viewer', viewer: true });
    await invites.close();
    const { createServer } = await import('../app/server.mjs');
    application = await createServer({ dataDir: process.env.RS3_REVIEW_SCRATCH, host: '127.0.0.1', port: 8831,
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
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=8832', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  let socket;
  try {
    const target = await until(async () => {
      if (child.exitCode !== null) throw Error('Scratch Chrome exited.');
      try { return (await (await fetch('http://127.0.0.1:8832/json')).json()).find(row => row.type === 'page'); } catch { return false; }
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
  assert.equal(owner.token, process.env.RS3_HEAVY_LOCK_TOKEN, 'Shared heavy lock ownership mismatch.');
  assert.ok(process.env.RS3_GAME_DATA_DIR && process.env.RS3_MAP_ASSETS_DIR, 'Shared read-only asset paths required.');
  await freePort(8831); await freePort(8832);
  const before = hash(await readFile(path.join(source, 'state.json')));
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(path.join(output, 'scratch-questfilters-'));
  const report = { stage: 'setup', passed: false, tabs: {}, quests: {}, screenshots: {}, pageErrors: 0, externalRequests: 0, gameplayWrites: 0, csp: [] };
  let child, browser, failed, scratchStateHash;
  const probe = expression => browser.evaluate(expression);
  async function click(selector, text) {
    assert.equal(await probe(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!n)return false;n.click();return true})()`), true, `Missing control: ${text}`);
    await sleep(100);
  }
  const panel = '#dialog-content [role="tabpanel"]';
  async function tab(name) { await click('#dialog-content [role="tab"]', name); }
  async function chip(group, text) { await click(`#dialog-content .activity-filter-controls [aria-label="${group}"] button`, text); }
  async function openInfo() {
    await probe(`document.getElementById('tool-dialog').close();document.getElementById('activity-open').click()`);
    await until(() => probe(`document.getElementById('dialog-title').textContent==='Activity Info'&&!!document.querySelector('#dialog-content .activity-filter-controls')`), 180000);
  }
  async function questNames() {
    for (let pass = 0; pass < 20; pass++) {
      const more = await probe(`(()=>{const n=document.querySelector(${JSON.stringify(panel)}+' .info-list > button');if(!n||n.hidden)return false;n.click();return true})()`);
      if (!more) break;
    }
    return probe(`[...document.querySelector(${JSON.stringify(panel)}+' .info-list').children[1].children].filter(n=>n.tagName==='DETAILS').map(n=>n.querySelector('summary').textContent.split(' · ')[0]).sort()`);
  }
  async function expectQuests(statuses, canDoNow, label) {
    const expected = await probe(`__review.quests.filter(g=>(!${JSON.stringify(statuses)}.length||${JSON.stringify(statuses)}.includes(g.questStatus))&&(!${canDoNow}||g.canDoNow===true)).map(g=>g.name).sort()`);
    assert.deepEqual(await questNames(), expected, `${label} quest groups differ from worker facts.`);
    const count = await probe(`document.querySelector(${JSON.stringify(panel)}+' .info-list > .info-toolbar [aria-live]').textContent`);
    assert.match(count, new RegExp(`${expected.length.toLocaleString()} total quests$`));
    report.quests[label] = { count: expected.length, namesSha256: hash(JSON.stringify(expected)) };
  }
  async function screenshot(name, width) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await probe(`document.getElementById('tool-dialog').scrollTop=0;document.getElementById('dialog-content').scrollTop=0`);
    await sleep(200);
    const sizes = await probe(`({viewport:innerWidth,body:document.body.scrollWidth,dialog:document.getElementById('tool-dialog').getBoundingClientRect().width,content:document.getElementById('dialog-content').scrollWidth,client:document.getElementById('dialog-content').clientWidth})`);
    assert.ok(sizes.body <= width && sizes.dialog <= width && sizes.content <= sizes.client + 1, 'Activity dialog horizontal overflow.');
    const png = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, name), Buffer.from(png.data, 'base64')); report.screenshots[name] = sizes;
  }
  try {
    const data = path.join(scratch, 'duo');
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
    scratchStateHash = hash(await readFile(path.join(data, 'state.json')));
    browser = await launchChrome(path.join(scratch, 'chrome'));
    browser.listeners.add(message => {
      if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error') report.pageErrors++;
      if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request, url = new URL(request.url);
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) report.externalRequests++;
        if (!['GET', 'HEAD'].includes(request.method) && /^\/api\/(command|runemetrics|original-sync|restore|import|training-plan|invites)(\/|$)/.test(url.pathname)) report.gameplayWrites++;
      }
      if (message.method === 'Network.responseReceived' && message.params.type === 'Document') {
        const headers = message.params.response.headers;
        report.csp.push(Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-security-policy')?.[1] ?? '');
      }
    });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__rs3Perf={enabled:true,events:[]};' });
    await browser.send('Page.navigate', { url: ready.admin });
    await until(() => probe(`!!document.getElementById('member')&&__rs3Perf.events.some(e=>e.name==='tasks-shown'||e.name==='duo-tasks-shown')`), 180000);
    await openInfo();
    await probe(`(async()=>{globalThis.__review=await fetch('/api/tasks?memberId='+encodeURIComponent(document.getElementById('member').value)).then(r=>r.json());__review.quests=__review.activityInfo.quests;})()`);
    assert.equal(await probe(`__review.quests.every(g=>['not-started','in-progress','done'].includes(g.questStatus)&&typeof g.canDoNow==='boolean')`), true, 'Worker quest progress facts missing.');
    report.stage = 'six Activity Info tabs';
    for (const name of ['Skills', 'Quests', 'Achievements', 'Activities', 'Slayer', 'Clues']) {
      await tab(name);
      const controls = await probe(`({chips:[...document.querySelectorAll('#dialog-content [aria-label="Activity status"] button')].map(n=>n.textContent),sort:document.querySelector('#dialog-content select[aria-label="Sort activities"]')?.value})`);
      assert.deepEqual(controls.chips, ['All', 'Done', 'Doable', 'Blocked']); assert.equal(controls.sort, 'default');
      await chip('Activity status', 'Blocked');
      assert.equal(await probe(`document.querySelector('#dialog-content [aria-label="Activity status"] button[aria-pressed="true"]').textContent`), 'Blocked');
      await probe(`(()=>{const n=document.querySelector('#dialog-content select[aria-label="Sort activities"]');n.value='level';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await tab(name === 'Quests' ? 'Skills' : 'Quests'); await tab(name);
      assert.equal(await probe(`document.querySelector('#dialog-content select[aria-label="Sort activities"]').value`), 'level');
      await nestedBlocked(name, probe, panel, report);
      await chip('Activity status', 'All');
      report.tabs[name] = { chips: controls.chips, sort: true, toggle: true, tabPersistence: true, ...report.tabs[name] };
    }
    report.stage = 'quest facts and persistence'; await tab('Quests');
    assert.deepEqual(await probe(`[...document.querySelectorAll('#dialog-content [aria-label="Quest progress"] button')].map(n=>n.textContent)`), ['All', 'Not started', 'In progress', 'Done', 'Can do now']);
    await expectQuests([], false, 'all');
    for (const [name, status] of [['Not started', 'not-started'], ['In progress', 'in-progress'], ['Done', 'done']]) {
      await chip('Quest progress', 'All'); await chip('Quest progress', name); await expectQuests([status], false, status);
    }
    await chip('Quest progress', 'All'); await chip('Quest progress', 'Not started'); await chip('Quest progress', 'In progress');
    await expectQuests(['not-started', 'in-progress'], false, 'unfinished');
    await chip('Quest progress', 'Can do now'); await expectQuests(['not-started', 'in-progress'], true, 'unfinished-can-do-now');
    const saved = await probe(`localStorage.getItem(${JSON.stringify(key)})`);
    await tab('Skills'); await tab('Quests'); assert.equal(await probe(`localStorage.getItem(${JSON.stringify(key)})`), saved);
    await browser.send('Page.reload');
    await until(() => probe(`__rs3Perf.events.some(e=>e.name==='tasks-shown'||e.name==='duo-tasks-shown')`), 180000);
    await openInfo(); await tab('Quests'); assert.equal(await probe(`localStorage.getItem(${JSON.stringify(key)})`), saved);
    await probe(`fetch('/api/tasks?memberId='+encodeURIComponent(document.getElementById('member').value)).then(r=>r.json()).then(n=>{globalThis.__review=n;__review.quests=n.activityInfo.quests})`);
    await expectQuests(['not-started', 'in-progress'], true, 'reload'); report.persistence = true;
    await screenshot('questfilters-desktop.png', 1440); await screenshot('questfilters-phone-390.png', 390);
    report.stage = 'quest search open';
    await probe(`document.getElementById('tool-dialog').close();document.getElementById('search-open').click()`);
    await until(() => probe(`document.getElementById('dialog-title').textContent==='Search'&&[...document.querySelectorAll('#dialog-content select')].some(n=>[...n.options].some(o=>o.value==='Quests'))`), 180000);
    report.stage = 'quest search mode';
    await probe(`(()=>{const n=[...document.querySelectorAll('#dialog-content select')].find(n=>[...n.options].some(o=>o.value==='Quests'));n.value='Quests';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(() => probe(`!!document.querySelector('.search-results .status-detail')&&!document.querySelector('.search-results [aria-busy]')`), 180000);
    report.stage = 'quest search filter';
    await chip('Quest progress', 'Can do now');
    const searchCount = await probe(`(()=>{const groups=new Map(__review.activityInfo.quests.flatMap(g=>g.tasks.map(t=>[t.id,t])));return __review.tasks.map(t=>({...t,...(__review.activityInfo.questStates?.[t.id]??groups.get(t.id))})).filter(t=>t.category==='Quest'&&t.canDoNow===true).length})()`);
    report.stage = 'quest search count';
    await until(() => probe(`document.querySelector('.search-results .status-detail')?.textContent.startsWith(${JSON.stringify(searchCount.toLocaleString() + ' results')})`), 180000);
    assert.equal(await probe(`document.querySelector('#dialog-content [aria-label="Quest progress"] button[aria-pressed="true"]').textContent`), 'Can do now');
    report.search = { canDoNowCount: searchCount, selectedChip: true };
    report.stage = 'viewer';
    await browser.send('Network.clearBrowserCookies'); await browser.send('Page.navigate', { url: ready.viewer });
    await until(() => probe(`document.documentElement.dataset.readOnly==='true'&&__rs3Perf.events.some(e=>e.name==='tasks-shown'||e.name==='duo-tasks-shown')`), 180000);
    await openInfo();
    assert.equal(await probe(`[...document.querySelectorAll('#dialog-content button,#dialog-content summary')].some(n=>/Save training|RuneMetrics sync|Save Slayer/.test(n.textContent))`), false);
    await tab('Quests'); await chip('Quest progress', 'All'); await chip('Quest progress', 'Can do now');
    report.viewer = { filters: true, trainingAndSyncControlsAbsent: true };
    report.stage = 'chunk quests search';
    await probe(`document.getElementById('tool-dialog').close();document.getElementById('search-open').click()`);
    await until(() => probe(`document.getElementById('dialog-title').textContent==='Search'&&!!document.querySelector('#dialog-content input[type="search"]')`), 180000);
    await probe(`(()=>{const n=document.querySelector('#dialog-content input[type="search"]');n.value='12850';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(() => probe(`!!document.querySelector('.search-results .search-result')&&!document.querySelector('.search-results[aria-busy="true"]')`), 180000);
    assert.match(await probe(`document.querySelector('.search-results .search-result span').textContent`), /Lumbridge/i, 'Chunk12850 index entry should identify Lumbridge.');
    await probe(`document.querySelector('.search-results .search-result button').click()`);
    await until(() => probe(`!document.getElementById('chunk-info').hidden&&!!document.querySelector('#chunk-content [role="tab"]')`), 180000);
    report.stage = 'chunk quests contents';
    await click('#chunk-content [role="tab"]', 'Contents');
    await until(() => probe(`!!document.querySelector('#chunk-content .chunk-quest-list[aria-busy="false"]')`), 180000);
    await probe(`fetch('/api/tasks?memberId='+encodeURIComponent(document.getElementById('member').value)).then(r=>r.json()).then(n=>{globalThis.__review=n})`);
    const questRoot = '#chunk-content .chunk-quest-list';
    const chunkChip = text => click(`${questRoot} [aria-label="Quest progress"] button`, text);
    const chunkNames = () => probe(`[...document.querySelector(${JSON.stringify(questRoot)}).querySelectorAll('.chunk-quest-rows .content-row')].map(n=>n.dataset.questName).sort()`);
    assert.deepEqual(await probe(`[...document.querySelector(${JSON.stringify(questRoot)}).querySelectorAll('[aria-label="Quest progress"] button')].map(n=>n.textContent)`), ['All', 'Not started', 'In progress', 'Done', 'Can do now']);
    await chunkChip('All');
    const allChunkQuests = await chunkNames();
    assert.ok(allChunkQuests.length > 0, 'Lumbridge chunk should contain named quests.');
    await probe(`(()=>{
      const clean=n=>String(n??'').trim(),facts=__review.activityInfo.questStates??{},byName=new Map();
      for(const t of __review.tasks??[]){if(t.category!=='Quest')continue;const name=t.baseQuest??t.record?.BaseQuest??/~\\|([^|]+)\\|~/.exec(t.rawLabel??'')?.[1]?.split('#')[0]??t.label;if(facts[t.id])byName.set(clean(name),facts[t.id]);}
      for(const g of __review.activityInfo.quests??[]){if(g.questStatus)byName.set(clean(g.name),g);}
      globalThis.__chunkReviewFacts=byName;
    })()`);
    report.chunkQuests = { total: allChunkQuests.length, namesSha256: hash(JSON.stringify(allChunkQuests)) };
    for (const [text, property, value] of [['Done', 'questStatus', 'done'], ['Can do now', 'canDoNow', true]]) {
      report.stage = `chunk quests ${property}`;
      await chunkChip('All'); await chunkChip(text);
      const expected = await probe(`${JSON.stringify(allChunkQuests)}.filter(name=>__chunkReviewFacts.get(name)?.[${JSON.stringify(property)}]===${JSON.stringify(value)}).sort()`);
      assert.deepEqual(await chunkNames(), expected, `Chunk ${text} quest names differ from worker progress facts.`);
      assert.equal(await probe(`document.querySelector(${JSON.stringify(questRoot)}+' .chunk-quest-rows [aria-live]').textContent`), `${expected.length} of ${allChunkQuests.length} quests`);
      assert.equal(await probe(`document.querySelector(${JSON.stringify(questRoot)}+' [aria-label="Quest progress"] button[aria-pressed="true"]').textContent`), text);
      report.chunkQuests[property] = { count: expected.length, namesSha256: hash(JSON.stringify(expected)) };
    }
    await chunkChip('All'); assert.deepEqual(await chunkNames(), allChunkQuests);
    report.gameplayStateUnchanged = hash(await readFile(path.join(data, 'state.json'))) === scratchStateHash;
    assert.equal(report.gameplayStateUnchanged, true, 'Browser presentation changed scratch gameplay state.');
    assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0); assert.equal(report.gameplayWrites, 0);
    assert.ok(report.csp.length >= 2 && report.csp.every(csp => csp.includes("default-src 'self'") && !csp.includes("'unsafe-eval'") && !/script-src[^;]*'unsafe-inline'/.test(csp)), 'Strict CSP missing.');
    report.stage = 'complete'; report.passed = true;
  } catch (error) {
    failed = true;
    report.failure = `${error.name}: ${error.message}`.replace(/\/join\/[^\s'"<>]+/g, '/join/[redacted]')
      .replace(/https?:\/\/[^\s'"<>]+/g, '[redacted URL]').slice(0, 250);
  }
  finally {
    let clean = true;
    try { await browser?.close(); } catch { clean = false; }
    try { if (child?.connected && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 15000).catch(() => {}); } await stopChild(child); } catch { clean = false; }
    if (clean) {
      const absolute = await realpath(scratch), boundary = await realpath(output);
      assert.ok(absolute.startsWith(boundary + path.sep) && path.basename(absolute).startsWith('scratch-questfilters-'));
      await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    report.scratchRemoved = clean; report.sourceUnchanged = hash(await readFile(path.join(source, 'state.json'))) === before;
    report.passed &&= clean && report.sourceUnchanged;
    await writeFile(path.join(output, 'questfilters-checks.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (failed || !report.passed) throw Error(`Quest filter review failed at ${report.stage}; see .local/screens/questfilters-checks.json (credentials redacted).`);
  console.log(JSON.stringify({ passed: true, tabs: Object.keys(report.tabs), quests: report.quests, viewer: report.viewer, screenshots: Object.keys(report.screenshots), sourceUnchanged: report.sourceUnchanged, scratchRemoved: report.scratchRemoved }));
}

async function nestedBlocked(tab, probe, panel, report) {
  // Expand only presentation details; never activate save, task or external-link controls.
  let skill, group;
  if (tab === 'Skills') {
    skill = await probe(`(()=>{const n=document.querySelector(${JSON.stringify(panel)}+' .skill-tile');const name=n?.querySelector('.skill-name').textContent;n?.click();return name})()`);
  } else {
    if (tab === 'Achievements') await probe(`(()=>{const n=document.querySelector('[aria-label="Achievement group visibility"]');n.value='all';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    if (tab !== 'Activities') group = await probe(`(()=>{const root=document.querySelector(${JSON.stringify(panel)}),n=[...root.querySelectorAll('details')].find(n=>n.querySelector('summary')?.textContent.includes(' · '));if(!n)return null;const name=n.querySelector('summary').textContent.split(' · ')[0];n.open=true;n.dispatchEvent(new Event('toggle'));return name})()`);
  }
  await sleep(100);
  // Inspect one lazy group and the first page only. Large activity catalogues stay lazy.
  const expected = await probe(`(()=>{
    const view=__review.activityInfo,blocked=t=>!t.personalCompleted&&!t.challengeSatisfied&&!(t.status==='available'&&!t.blockers?.length);
    const tab=${JSON.stringify(tab)},group=${JSON.stringify(group ?? null)};
    const level=t=>typeof t.level==='number'&&Number.isFinite(t.level)&&t.level>0?t.level:Infinity;
    const page=tasks=>tasks.filter(blocked).sort((a,b)=>level(a)-level(b)).slice(0,60).map(t=>t.label);
    if(tab==='Skills'){const s=view.skills.find(s=>s.skill===${JSON.stringify(skill)});return page([...new Map([...(s?.availableTasks??[]),...(s?.blockedTasks??[])].map(t=>[t.id,t])).values()]).sort()}
    if(tab==='Quests'||tab==='Achievements'){const g=view[tab==='Quests'?'quests':'achievements'].find(g=>g.name===group);return g?[...page(g.tasks),...(g.wholeCompletion??[]).filter(blocked).map(t=>t.label)].sort():[]}
    if(tab==='Activities')return page(view.activities).sort();
    if(tab==='Clues'){const g=view.clues.tiers.find(g=>String(g.tier).replace(/^./,l=>l.toUpperCase())===group);return page(g?.tasks??[]).sort()}
    const g=view.slayer.masters.find(g=>g.name===group);if(!g)return [];
    const tasks=g.tasks.filter(t=>!t.planningEligible).map(t=>({...t,level:Math.max(Number(t.requirements?.Level)||0,...Object.values(t.requirements?.Skills??{}).map(Number),0)}));
    return [...tasks.sort((a,b)=>level(a)-level(b)).slice(0,60).map(t=>t.name),...(g.method&&blocked(g.method)?[g.method.label]:[])].sort();
  })()`);
  const actual = await probe(`(()=>{const root=document.querySelector(${JSON.stringify(panel)});return [...root.querySelectorAll(${JSON.stringify(tab === 'Skills' ? '.method-name' : tab === 'Slayer' ? '.info-row > strong' : '.info-row-title')})].map(n=>n.textContent).sort()})()`);
  assert.deepEqual(actual, expected, `${tab} nested Blocked rows differ from worker task facts.`);
  report.tabs[tab] = { nestedBlockedRows: actual.length, firstPageOnly: true, namesSha256: hash(JSON.stringify(actual)) };
}
