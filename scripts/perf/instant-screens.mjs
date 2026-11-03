// Synthetic store only, production browser modules + process calculator. Never
// accepts a save/packs path. Response delay models a slow calculator/network.
// node scripts/perf/instant-screens.mjs --root . --runs 5 --output /tmp/u1.json
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { openChrome, until, sleep } from './cdp.mjs';
const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
assert.ok(Number(process.versions.node.split('.')[0]) > 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 20);
for (const name of Object.keys(process.env)) if (name.startsWith('RS3_')) delete process.env[name];
process.env.RS3_DATASET = 'open-f2p'; process.env.RS3_TASK_WORKER_MODE = 'process';
const root = path.resolve(option('root', '.')), runs = Number(option('runs', 5)), delayMs = Number(option('delay', 600));
assert.ok(runs > 0 && runs <= 10); assert.ok(delayMs >= 0 && delayMs <= 2000);
const { createServer } = await import(pathToFileURL(path.join(root, 'app/server.mjs')));
const { createGroupState } = await import(pathToFileURL(path.join(root, 'app/core/state.mjs')));
const { selectedDataset } = await import(pathToFileURL(path.join(root, 'app/dataset-runtime.mjs')));
// Enable only the browser training/planning surfaces on this tiny public fixture.
const dataset = { ...selectedDataset, capabilities: { ...selectedDataset.capabilities, features: { ...selectedDataset.capabilities.features, training: true, rsCatalogues: true } } };
const grid = selectedDataset.value('app/data/surface-grid.mjs#SURFACE_GRID');
const home = String(grid.startId), east = String(grid.startId + grid.stride), north = String(grid.startId - 1);
const definitions = { chunks: { [home]: { Nickname: 'Synthetic home' }, [east]: { Nickname: 'Synthetic east' }, [north]: { Nickname: 'Synthetic north' } },
  sections: { [home]: { '0': [east, north] }, [east]: { '0': [home] }, [north]: { '0': [home] } },
  walkableChunks: [home, east, north], walkableChunksF2P: [home, east, north],
  challenges: { Quest: { 'Synthetic goal': { Chunks: [home] }, 'Synthetic future': { Chunks: [east] } } } };
async function chromeRss(pid) {
  // This sandbox lacks /proc/<pid>/task/<pid>/children. ps exposes only numeric
  // process metadata here; never inspect command lines, environments or tokens.
  const table = await new Promise((resolve, reject) => execFile('ps', ['-eo', 'pid=,ppid=,rss='], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const processes = table.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([pid]);
  for (let pass = 0; pass < 16; pass++) {
    const count = owned.size;
    for (const [child, parent] of processes) if (owned.has(parent)) owned.add(child);
    if (owned.size === count) break;
  }
  return processes.filter(([child]) => owned.has(child)).reduce((total, [, , rss]) => total + rss * 1024, 0);
}
const sourceHash = createHash('sha256');
for (const name of (await readdir(path.join(root, 'app/web'))).filter(name => name.endsWith('.mjs')).sort()) sourceHash.update(name).update(await readFile(path.join(root, 'app/web', name)));
const browserSourceSha256 = sourceHash.digest('hex');
const screenshotDir = option('screenshots'); if (screenshotDir) await mkdir(path.resolve(screenshotDir), { recursive: true });
const startupOnly = process.argv.includes('--startup-only');
const rows = [], memory = [], screenshots = [];
for (let run = 0; run < runs; run++) {
  const directory = await mkdtemp(path.join(tmpdir(), 'instant-screens-'));
  let app, page, sampler, peakChromeRss = 0, sampling = false;
  try {
    const state = createGroupState([{ id: 'player1', name: 'Synthetic one', unlocked: [home] }, { id: 'player2', name: 'Synthetic two', unlocked: [home] }]);
    state.members[0].selected = [east, north];
    for (const member of state.members) member.preferences = { setupGuide: 'skipped', showTaskHow: true };
    app = await createServer({ dataset, dataDir: path.join(directory, 'game'), webRoot: path.join(root, 'app/web'), definitions, taskMap: {}, initialState: state, port: 0 });
    await app.listen();
    const profile = path.join(directory, 'chrome'); await mkdir(profile);
    page = await openChrome('/usr/bin/chromium', profile, { extraArgs: ['--no-sandbox'] });
    const sample = async () => { if (sampling) return; sampling = true; try { peakChromeRss = Math.max(peakChromeRss, await chromeRss(page.child.pid)); } finally { sampling = false; } };
    sampler = setInterval(() => { void sample(); }, 200); await sample();
    const errors = [];
    page.listeners.add(message => {
      if (message.method === 'Runtime.exceptionThrown') { errors.push(message.params.exceptionDetails.text); console.error(JSON.stringify(message.params.exceptionDetails)); }
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) console.error(JSON.stringify({path:new URL(message.params.response.url).pathname,status:message.params.response.status}));
      if (message.method === 'Network.loadingFailed' && !message.params.canceled) console.error(JSON.stringify(message.params));
      if (message.method === 'Fetch.requestPaused') setTimeout(() => { void page?.send('Fetch.continueRequest', { requestId: message.params.requestId }).catch(() => {}); }, delayMs);
    });
    await page.send('Fetch.enable', { patterns: ['state', 'tasks', 'task-how', 'task-why', 'predict', 'chunk-planning', 'helper-progress', 'pool-ranking'].map(name => ({ urlPattern: `*/api/${name}?*`, requestStage: 'Response' }))
      .concat([{ urlPattern: '*/api/helper-progress', requestStage: 'Response' }]) });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "globalThis.__rs3Perf={enabled:true,events:[]}; globalThis.__u1Paint={}; (function poll(){const counts=document.querySelector('#map-counts'),tasks=document.querySelector('#active-tasks .task-row'); if(counts?.textContent.trim()&&!globalThis.__u1Paint.state) requestAnimationFrame(()=>{globalThis.__u1Paint.state??=performance.now()}); if(tasks&&!globalThis.__u1Paint.tasks) requestAnimationFrame(()=>{globalThis.__u1Paint.tasks??=performance.now()}); if(globalThis.__rs3Perf.events.some(e=>e.name==='state-adopted')&&!globalThis.__u1Paint.roll)requestAnimationFrame(()=>{globalThis.__u1Paint.roll??=performance.now()}); if(globalThis.__u1Paint.tasks&&!tasks&&!globalThis.__rs3Perf.events.some(e=>e.name==='tasks-shown'))globalThis.__u1Paint.blankFrames=(globalThis.__u1Paint.blankFrames??0)+1; if(!globalThis.__rs3Perf.events.some(e=>e.name==='tasks-shown'))requestAnimationFrame(poll)})();" });
    const ready = expression => until(() => page.evaluate(`Boolean(${expression})`), 20000, 15);
    const measure = async (view, temperature, action, content) => {
      const result = await page.evaluate(`(async()=>{const start=performance.now(); ${action}; for(let n=0;n<1200;n++){await new Promise(requestAnimationFrame); if(${content}) {await new Promise(requestAnimationFrame);return {ms:performance.now()-start,updating:document.body.textContent.includes('Updating…')};}} throw Error('No meaningful result for ${view}');})()`);
      rows.push({ run, view, temperature, ...result }); console.log(JSON.stringify(rows.at(-1)));
    };
    const shot = async (view, temperature) => {
      if (!screenshotDir || temperature !== 'cold' || run !== 0) return;
      if (view === 'play') await ready("!document.querySelector('#task-count').textContent.includes('previous counts')");
      if (view === 'ranking') await ready("document.querySelector('#pool-ranking-status').textContent.includes('checked') && !document.querySelector('#pool-ranking-status').textContent.includes('still checking')");
      await page.evaluate("new Promise(resolve=>{if(!document.querySelector('[data-u1-capture]')){const style=document.createElement('style');style.dataset.u1Capture='true';style.textContent='input,textarea{caret-color:transparent!important}';document.head.append(style)}requestAnimationFrame(()=>requestAnimationFrame(resolve))})");
      const capture = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(capture.data, 'base64'); await writeFile(path.resolve(screenshotDir, `${view}.png`), bytes);
      screenshots.push({ view, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    };
    for (const temperature of ['cold', 'warm']) {
      await page.send('Page.navigate', { url: temperature === 'cold' ? app.inviteUrl : `http://127.0.0.1:${app.address().port}/` });
      await ready("document.querySelector('#active-tasks .task-row')");
      await ready('globalThis.__u1Paint.state && globalThis.__u1Paint.tasks');
      const paint = await page.evaluate("({state:globalThis.__u1Paint.state,tasks:globalThis.__u1Paint.tasks,cached:globalThis.__rs3Perf.events.some(e=>e.name==='cached-shell-shown'),fcp:performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint')?.startTime})");
      const firstLoad = { run, view: 'first-load', temperature, ms: paint.state, cached: paint.cached, shellFcpMs: paint.fcp };
      rows.push(firstLoad);
      rows.push({ run, view: 'play', temperature, ms: paint.tasks, cached: paint.cached });
      await ready("globalThis.__rs3Perf.events.some(e=>e.name==='tasks-shown')");
      firstLoad.blankFrames = await page.evaluate('globalThis.__u1Paint.blankFrames??0');
      if (startupOnly) {
        await ready('globalThis.__u1Paint.roll');
        rows.push({ run, view: 'roll-controls', temperature, ms: await page.evaluate('globalThis.__u1Paint.roll') });
        await sleep(250); continue;
      }
      await shot('play', temperature);
      await page.evaluate("document.querySelector('#group-view').checked=false; document.querySelector('#group-view').dispatchEvent(new Event('change'))");
      await ready("document.querySelector('.task-how')");
      await sleep(100);
      await measure('how', temperature, "document.querySelector('.task-how').click()", "document.querySelector('.task-how-panel:not([hidden]) .task-why-content')");
      await ready("document.querySelector('.task-how-panel[aria-busy=\"false\"]')");
      await shot('how', temperature);
      await page.evaluate("document.querySelector('.task-how').click()");
      await measure('why', temperature, "document.querySelector('.task-why:not(.task-how)').click()", "document.querySelector('.task-why-panel:not([hidden]) .task-why-content')");
      await ready("document.querySelector('.task-why-panel:not([hidden])[aria-busy=\"false\"]')");
      await shot('why', temperature);
      await page.evaluate("document.querySelector('.task-why:not(.task-how)').click()");
      await measure('ranking', temperature, "document.querySelector('#pool-ranking-toggle').click()", "document.querySelector('#pool-ranking-rows .pool-ranking-row')");
      await ready("document.querySelector('#pool-ranking-status').textContent.includes('checked')");
      await shot('ranking', temperature);
      await page.evaluate("document.querySelector('#pool-ranking-close').click()");
      // Select an ordinary pool chunk via its existing legend control.
      await page.evaluate("document.querySelector('#pool-ranking-toggle').click(); document.querySelector('#pool-ranking-rows .pool-ranking-view').click(); document.querySelector('#pool-ranking-close').click()");
      // Search uses the shipped chunk dialog path, avoiding map coordinate guesses.
      await page.evaluate("document.querySelector('#search-open').click()");
      await ready("document.querySelector('#dialog-content input')");
      await page.evaluate(`const input=document.querySelector('#dialog-content input'); input.value=${JSON.stringify(east)}; input.dispatchEvent(new Event('input'))`);
      await ready(`document.querySelector('#dialog-content button[aria-label="View Synthetic east"]')`);
      await ready(`document.querySelector('.search-results:not([aria-busy])')`);
      await page.evaluate(`document.querySelector('#dialog-content button[aria-label="View Synthetic east"]').click()`);
      await ready("document.querySelector('#chunk-info:not([hidden])')");
      await measure('preview', temperature, "[...document.querySelectorAll('#chunk-content button')].find(n=>n.textContent==='Preview').click()", "document.querySelector('.unlock-preview .unlock-count')");
      await ready("document.querySelector('.unlock-preview .unlock-count') && !document.querySelector('#chunk-content').textContent.includes('Last known preview')");
      await shot('preview', temperature);
      await measure('planning', temperature, "[...document.querySelectorAll('#chunk-content button')].find(n=>n.textContent==='Tasks').click()", "document.querySelector('#chunk-content .chunk-section .task-filter-bar')");
      await ready("!document.querySelector('#chunk-content').textContent.includes('Last known chunk tasks')");
      await shot('planning', temperature);
      await page.evaluate("document.querySelector('#helper-open').click()");
      await ready("document.querySelector('[data-section=progress]')");
      await measure('progress', temperature, "document.querySelector('[data-section=progress]').click()", "document.querySelector('.helper-progress-totals')");
      await ready("document.querySelector('.helper-content').textContent.includes('Saved counts as of')");
      await shot('progress', temperature);
      await page.evaluate("document.querySelector('.helper-header button').click()");
      await sleep(250); // Let optional IndexedDB transaction complete before reload.

    }
    if (process.argv.includes('--expect-cache')) {
      assert.ok(rows.filter(row=>row.run===run&&row.temperature==='warm'&&row.view!=='roll-controls').every(row=>['first-load','play'].includes(row.view)?row.cached:row.updating), 'Warm candidate paints known data as updating');
    }
    await sleep(1000);
    const idleChromeRss = await chromeRss(page.child.pid); peakChromeRss = Math.max(peakChromeRss, idleChromeRss);
    assert.ok(idleChromeRss > 0 && peakChromeRss > 0, 'Chrome RSS sampling is available');
    memory.push({ run, peakChromeRssMiB: peakChromeRss / 1024**2, idleChromeRssMiB: idleChromeRss / 1024**2 });
    assert.equal(errors.length, 0, 'No uncaught renderer exceptions');
  } catch (error) { console.error(await page?.evaluate("JSON.stringify({status:document.querySelector('#task-engine-status')?.textContent,notice:document.querySelector('#notice')?.textContent,events:globalThis.__rs3Perf?.events,active:document.querySelector('#active-tasks')?.textContent,pool:document.querySelector('#pool-ranking-panel')?.textContent,errors:document.body.textContent.slice(-2000)})")); throw error; } finally { clearInterval(sampler); await page?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
}
const summary = [];
for (const view of new Set(rows.map(row => row.view))) for (const temperature of ['cold', 'warm']) {
  const values = rows.filter(row => row.view === view && row.temperature === temperature).map(row => row.ms).sort((a,b)=>a-b);
  summary.push({ view, temperature, medianMs: values[Math.floor(values.length/2)], minMs: values[0], maxMs: values.at(-1), count: values.length });
}
const output = { runs, delayMs, startupOnly, rssSamplingMs: 200, browserSourceSha256, rows, summary, memory, screenshots };
if (option('output')) await writeFile(path.resolve(option('output')), JSON.stringify(output, null, 2)+'\n');
console.log(JSON.stringify(summary));
