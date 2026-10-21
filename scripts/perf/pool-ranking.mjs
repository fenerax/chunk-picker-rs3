#!/usr/bin/env node
// Real-save acceptance probe; run only through .local/with-heavy.ps1.
import { fork } from 'node:child_process';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openChrome, stopChild, sleep, until } from './cdp.mjs';
import { probeSource } from './probe.mjs';
import { surfaceCoordinates } from '../../app/data/surface-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = 'C:/Users/User/Projects/chunk-picker-rs3';
const OUTPUT = path.join(ROOT, '.local/perf/wholepool');
const TIMEOUT = Number(process.env.RS3_POOL_TIMEOUT_MS ?? 240000);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, target) => { const relative = path.relative(base, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
async function noLinks(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw Error('Fixture cannot contain links.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Fixture cannot contain links.');
    if (entry.isDirectory()) await noLinks(path.join(directory, entry.name));
  }
}
async function chromeExecutable() {
  for (const candidate of [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw Error('Chrome executable missing.');
}
async function startServer(dataDir) {
  const env = { ...process.env, RS3_PERF: '1', RS3_PERF_SCRATCH: dataDir,
    RS3_PERF_SERVER_ENTRY: path.join(ROOT, 'app/server.mjs'), RS3_DATA_DIR: dataDir,
    RS3_MAP_ASSETS_DIR: path.join(MAIN, '.local/map-assets'),
    RS3_TERRAIN_ASSETS_DIR: path.join(MAIN, '.local/map-assets'), RS3_GAME_DATA_DIR: path.join(MAIN, '.local/game-data') };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  const child = fork(path.join(ROOT, 'scripts/perf/server.mjs'), [], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  child.on('error', () => {});
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Scratch server startup timed out.')), TIMEOUT);
      child.once('error', () => { clearTimeout(timer); reject(Error('Scratch server failed.')); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Scratch server exited.')); });
      child.once('message', value => { clearTimeout(timer); value.type === 'ready' ? resolve(value) : reject(Error('Scratch server failed.')); });
    });
    const url = new URL(ready.inviteUrl);
    if (url.hostname !== '127.0.0.1' || [8788, 8789, 8790, 8791].includes(Number(url.port))) throw Error('Protected server address.');
    let sequence = 0;
    return { child, origin: url.origin, inviteUrl: ready.inviteUrl, rssReadyBytes: ready.rssBytes,
      rss: () => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { child.off('message', receive); reject(Error('RSS timeout.')); }, 10000);
        function receive(value) { if (value.type === 'rss' && value.id === id) { clearTimeout(timer); child.off('message', receive); resolve(value.rssBytes); } }
        child.on('message', receive); child.send({ type: 'rss', id });
      }),
      async close() {
        if (child.exitCode === null && child.signalCode === null && child.connected) {
          const exited = new Promise(resolve => child.once('exit', resolve)); child.send({ type: 'stop' });
          await Promise.race([exited, sleep(15000)]);
        }
        await stopChild(child);
      } };
  } catch (error) { await stopChild(child); throw error; }
}
async function join(link) {
  const response = await fetch(link, { redirect: 'manual' });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (![302, 303].includes(response.status) || !cookie) throw Error('Scratch authentication failed.');
  return cookie;
}
async function main() {
  if (!process.env.RS3_HEAVY_LOCK_PATH || !process.env.RS3_HEAVY_LOCK_TOKEN) throw Error('Run through powershell -NoProfile -File .local/with-heavy.ps1 node scripts/perf/pool-ranking.mjs');
  const owner = JSON.parse((await readFile(path.join(process.env.RS3_HEAVY_LOCK_PATH, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== process.env.RS3_HEAVY_LOCK_TOKEN) throw Error('Heavy lock ownership mismatch.');
  const source = await realpath(path.join(MAIN, '.local/duo'));
  await noLinks(source); await mkdir(OUTPUT, { recursive: true });
  const output = await realpath(OUTPUT), root = await realpath(ROOT);
  if (!inside(root, output) || inside(source, output) || inside(output, source)) throw Error('Unsafe output directory.');
  const scratch = await mkdtemp(path.join(output, 'scratch-'));
  if (!inside(output, await realpath(scratch))) throw Error('Unsafe scratch directory.');
  const result = { capturedAt: new Date().toISOString(), node: process.version, complete: false, checks: {}, errors: [], measurements: {} };
  const stamp = result.capturedAt.replace(/[:.]/g, '-');
  let server, browser, sampling = false, samplePromise, peak = 0, cleaned = false;
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    const before = await readFile(path.join(source, 'state.json'));
    const dataDir = path.join(scratch, 'duo');
    await cp(source, dataDir, { recursive: true, dereference: false,
      filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
    assert(hash(await readFile(path.join(source, 'state.json'))) === hash(before) && hash(await readFile(path.join(dataDir, 'state.json'))) === hash(before), 'Source changed while copying.');
    result.fixtureSha256 = hash(before);
    server = await startServer(dataDir); peak = server.rssReadyBytes;
    sampling = true;
    samplePromise = (async () => { while (sampling) { peak = Math.max(peak, await server.rss()); await sleep(100); } })();
    browser = await openChrome(await chromeExecutable(), path.join(scratch, 'chrome'));
    const cookie = await join(server.inviteUrl), split = cookie.indexOf('=');
    await browser.send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: server.origin, path: '/', httpOnly: true, sameSite: 'Lax' });
    await browser.send('Network.clearBrowserCache');
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource });
    browser.listeners.add(message => {
      if (message.method === 'Runtime.exceptionThrown') result.errors.push('Browser runtime exception.');
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        const response = message.params.response;
        result.errors.push(`${new URL(response.url).pathname}: HTTP ${response.status}`);
      }
    });
    const get = route => browser.evaluate(`fetch(${JSON.stringify(route)},{cache:'no-store'}).then(async r=>({status:r.status,data:await r.json()}))`);
    const pool = async member => (await get(`/api/pool-ranking?memberId=${member}`)).data;
    const diagnostics = async () => (await get('/api/diagnostics')).data;
    const click = selector => browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing probe control');e.click();})()`);
    const settled = async (member, after = 0) => until(() => browser.evaluate(`document.getElementById('member')?.value===${JSON.stringify(member)} && /[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent??'') && (window.__rs3Perf?.events??[]).some(e=>e.name==='tasks-shown' && e.memberId===${JSON.stringify(member)} && e.time>=${after})`), TIMEOUT);
    const switchMember = async member => {
      const after = await browser.evaluate('performance.now()');
      await browser.evaluate(`(()=>{const e=document.getElementById('member');e.value=${JSON.stringify(member)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await settled(member, after);
    };
    const allChecked = async member => until(async () => {
      const value = await pool(member);
      assert(value.memberId === member, 'Pool response belongs to wrong player.');
      if (value.total > 0 && value.checked === value.total && value.rows.length === value.total && value.rows.every(row => row.status === 'checked' && Number.isFinite(row.count))) return value;
      return false;
    }, TIMEOUT, 150);
    await browser.send('Page.navigate', { url: `${server.origin}/` });
    await settled('player1'); await switchMember('player2');
    result.checks.player2TasksSettled = true;
    result.measurements.player2AlreadyCheckedOnOpen = (await pool('player2')).checked;
    console.log('Player 2 task lists are ready. Checking the whole roll pool.');
    let started = performance.now(); await click('#pool-ranking-toggle');
    const player2 = await allChecked('player2');
    result.measurements.player2OpenToAllCheckedMs = performance.now() - started;
    result.measurements.player2Rows = player2.total;
    result.player2 = player2;
    console.log(`Checked ${player2.total} Player 2 chunks in ${(result.measurements.player2OpenToAllCheckedMs / 1000).toFixed(1)} seconds.`);
    await until(() => browser.evaluate(`document.querySelectorAll('#pool-ranking-rows .pool-ranking-row[data-status="checked"]').length===${player2.total}`), TIMEOUT);
    const counts = () => browser.evaluate(`Array.from(document.querySelectorAll('#pool-ranking-rows .pool-ranking-row')).map(e=>({id:e.dataset.chunkId,count:Number(e.querySelector('.pool-ranking-count').textContent.replace(/[^0-9]/g,''))}))`);
    const descending = values => values.every((value, index) => index === 0 || values[index - 1].count >= value.count);
    assert(descending(await counts()), 'Total rows are not descending.');
    result.checks.totalSorting = true;
    const skill = await browser.evaluate(`Array.from(document.querySelector('#pool-ranking-sort').options).find(e=>e.value==='Mining')?.value || Array.from(document.querySelector('#pool-ranking-sort').options).find(e=>e.value)?.value`);
    assert(skill, 'No skill sorting option.');
    await browser.evaluate(`(()=>{const e=document.querySelector('#pool-ranking-sort');e.value=${JSON.stringify(skill)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const skillRows = await counts();
    assert(descending(skillRows) && skillRows.every(row => row.count === (player2.rows.find(value => String(value.id) === row.id)?.bySkill?.[skill]?.count ?? 0)), 'Skill sorting/counts differ from response.');
    result.checks.skillSorting = skill;
    // visibleBounds clips at the world edge. Use an interior chunk so its
    // viewport midpoint is also the geometric centre being asserted.
    const centeredId = skillRows.find(row => { const point = surfaceCoordinates(row.id);
      return point && point.x > 10 && point.x < 37 && point.y > 10 && point.y < 40; })?.id;
    assert(centeredId, 'No surface ranking row available for center probe.');
    await click(`#pool-ranking-rows [data-chunk-id="${centeredId}"] .pool-ranking-view`);
    const point = surfaceCoordinates(centeredId), expected = { x: (point.x + .5) * 128, y: (point.y + .5) * 128 };
    result.centering = await until(() => browser.evaluate(`(()=>{const v=window.__rs3Perf?.terrainViewport;if(!v)return false;const x=(v.bounds.left+v.bounds.right)/2,y=(v.bounds.top+v.bounds.bottom)/2;return Math.abs(x-${expected.x})<2 && Math.abs(y-${expected.y})<2 ? {chunkId:${JSON.stringify(centeredId)},x,y,zoom:v.zoom}:false;})()`), 10000);
    result.checks.rowCentersMap = true;
    console.log('Sorting and map centering passed. Taking desktop and phone screenshots.');
    await browser.send('Page.captureScreenshot', { format: 'png' }).then(value => writeFile(path.join(output, `${stamp}-desktop.png`), Buffer.from(value.data, 'base64')));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await browser.send('Page.captureScreenshot', { format: 'png' }).then(value => writeFile(path.join(output, `${stamp}-390px.png`), Buffer.from(value.data, 'base64')));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await click('#pool-ranking-toggle');
    started = performance.now(); await click('#pool-ranking-toggle');
    const reopened = await allChecked('player2');
    result.measurements.player2ReopenMs = performance.now() - started;
    assert(JSON.stringify(reopened.rows) === JSON.stringify(player2.rows), 'Reopen lost checked rows.');
    result.checks.reopenPreservesRows = true;
    await click('#pool-ranking-toggle'); await switchMember('player1');
    result.checks.player1TasksSettled = true;
    started = performance.now(); await click('#pool-ranking-toggle');
    await sleep(30);
    result.beforeClose = await diagnostics();
    await click('#pool-ranking-toggle');
    result.afterClose = await until(async () => {
      const value = await diagnostics(), ranking = value.predictionLane?.ranking;
      return ranking && ranking.pending === 0 && !ranking.active && value.poolRanking?.watchers === 0 ? value : false;
    }, 30000, 150);
    result.checks.closingStopsRankingWork = true;
    result.checks.cancellationObservedWhileBusy = !!(result.beforeClose.predictionLane?.ranking?.pending || result.beforeClose.predictionLane?.ranking?.active);
    result.measurements.player1OpenThenCloseMs = performance.now() - started;
    const created = await browser.evaluate(`fetch('/api/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'Pool acceptance viewer',viewer:true})}).then(async r=>{if(!r.ok)throw Error('Viewer setup failed');return r.json();})`);
    const viewerCookie = await join(created.link);
    const beforeViewer = await diagnostics();
    const viewerResponse = await fetch(`${server.origin}/api/pool-ranking?memberId=player1`, { headers: { Cookie: viewerCookie }, cache: 'no-store' });
    const viewerPayload = await viewerResponse.json();
    const afterViewer = await diagnostics();
    result.viewer = { status: viewerResponse.status, total: viewerPayload.total ?? null, checked: viewerPayload.checked ?? null, before: beforeViewer, after: afterViewer };
    assert(viewerResponse.ok, 'Viewer GET unavailable.');
    assert(afterViewer.poolRanking?.watchers === 0 && afterViewer.predictionLane?.ranking?.pending === 0 && !afterViewer.predictionLane?.ranking?.active,
      'Viewer GET scheduled ranking work.');
    result.checks.viewerGetDoesNotStartRanking = true;
    await click('#pool-ranking-toggle');
    started = performance.now(); result.player1 = await allChecked('player1');
    result.measurements.player1ReopenToAllCheckedMs = performance.now() - started;
    assert(result.errors.length === 0, 'Browser reported errors; see report.');
    assert(hash(await readFile(path.join(source, 'state.json'))) === result.fixtureSha256, 'Original fixture changed during run.');
    result.checks.originalFixtureUnchanged = true;
    result.complete = true;
  } catch (error) {
    result.errors.push(error.message); process.exitCode = 1;
  } finally {
    sampling = false;
    if (samplePromise) await samplePromise.catch(error => { result.errors.push(error.message); result.complete = false; process.exitCode = 1; });
    result.measurements.peakPickerRssBytes = peak;
    const shutdown = await Promise.allSettled([browser?.close(), server?.close()]);
    for (const entry of shutdown) if (entry.status === 'rejected') { result.errors.push(entry.reason.message); result.complete = false; process.exitCode = 1; }
    if (shutdown.every(entry => entry.status === 'fulfilled')) {
      const resolved = await realpath(scratch);
      if (inside(output, resolved)) { await rm(resolved, { recursive: true, force: true }); cleaned = true; }
    }
    result.scratchRemoved = cleaned;
    const filename = path.join(output, `${stamp}-report.json`);
    await writeFile(filename, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ complete: result.complete, measurements: result.measurements, errors: result.errors, report: filename, scratchRemoved: cleaned }, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
