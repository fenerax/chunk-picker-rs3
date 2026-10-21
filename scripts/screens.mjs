#!/usr/bin/env node
import { execFileSync, fork, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openChrome, sleep, stopChild, until } from './perf/cdp.mjs';
import { escapeHtml, mainSurfaceReady, prepareMainSurface, prepareScreenshotScroll, screenshotName, screenThemeSnapshot, mainPageState, visibleImagesReady } from './screens-model.mjs';
import { comparison, htmlShell } from './screens-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, '.local/screens');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim());
const USAGE = `Usage: npm run screens -- [--compare OLDER-SHA-OR-DIR] [--source PATH] [--port 9311..9319] [--chrome PATH]
One copied-save server and disposable headless Chrome under the shared light lock.
Captures every gallery entry and real map/tasks/more/helper/search/settings/history
at desktop 1440x900 and phone 390x844, in dark and light themes.
Output: .local/screens/<shortsha>/index.html and report.json. Private save remains read-only.
Comparison ignores channel deltas <=8 and changes covering <=0.1% of pixels.
Long dialogs get up to six viewport pages; remaining overflow is explicit in the report.
`;
const options = { source: path.join(MAIN, '.local/duo'), port: 9311 };
function parse(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return false; }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value || !['--compare', '--source', '--port', '--chrome'].includes(key)) throw new Error(USAGE);
    options[key.slice(2)] = key === '--port' ? Number(value) : value;
  }
  if (!Number.isInteger(options.port) || options.port < 9311 || options.port > 9319) throw new Error('Use an isolated server port from 9311 through 9319.');
  options.source = path.resolve(options.source);
  return true;
}
const inside = (base, target) => { const relative = path.relative(base, target); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function noLinks(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked screenshot source is unsupported.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked screenshot source is unsupported.');
    if (entry.isDirectory()) await noLinks(path.join(directory, entry.name));
  }
}
async function assertLightLock() {
  const ownerPid = Number(process.env.RS3_SCREENS_LIGHT_PID);
  const lock = path.join(MAIN, '.local/claude-tools/locks/light.lock/owner');
  const text = await readFile(lock, 'utf8').catch(() => '');
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || !new RegExp(`^light pid=${ownerPid} `).test(text.replace(/^\uFEFF/, ''))) throw new Error('Use npm run screens (scripts/screens.ps1) to hold the shared light lock.');
  try { process.kill(ownerPid, 0); } catch { throw new Error('Light-lock owner has exited.'); }
}
async function chromeExecutable() {
  for (const candidate of [options.chrome, process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error('Chrome unavailable; pass --chrome PATH.');
}
async function startServer(dataDir) {
  const env = { ...process.env, RS3_DATA_DIR: dataDir, RS3_SCREENS_SCRATCH: dataDir, RS3_SCREENS_PORT: String(options.port),
    RS3_WORKER_IDLE_MS: '20000', RS3_PERF: '1',
    RS3_MAP_ASSETS_DIR: path.join(MAIN, '.local/map-assets'), RS3_GAME_DATA_DIR: path.join(MAIN, '.local/game-data') };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT; delete env.NODE_OPTIONS;
  const child = fork(path.join(ROOT, 'scripts/screens-server.mjs'), [], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('error', () => {});
  try {
    const ready = await new Promise((resolve, reject) => {
      const done = (error, message) => { clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit); error ? reject(error) : resolve(message); };
      const onMessage = message => { if (message?.type === 'ready') done(null, message); else if (message?.type === 'error') done(new Error('Scratch server startup failed.')); };
      const onError = () => done(new Error('Scratch server launch failed.'));
      const onExit = () => done(new Error('Scratch server exited during startup.'));
      const timer = setTimeout(() => done(new Error('Scratch server startup timed out.')), 90000);
      child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit);
    });
    const origin = new URL(ready.inviteUrl).origin;
    if (origin !== `http://127.0.0.1:${options.port}`) throw new Error('Unexpected scratch server address.');
    return { child, origin, inviteUrl: ready.inviteUrl, async close() {
      if (child.connected && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.send({ type: 'stop' }, () => {}); await Promise.race([exited, sleep(12000)]);
      }
      await stopChild(child);
    } };
  } catch (error) { await stopChild(child); throw error; }
}
function memorySampler() {
  const state = { peakSampledBytes: 0, sampleCount: 0, peakProcessCount: 0, intervalMs: 2000, method: 'Windows process-tree working set (runner and descendants)' };
  const child = spawn('powershell.exe', ['-NoProfile', '-File', path.join(ROOT, 'scripts/screens-memory.ps1'), '-RootPid', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    while (pending.includes('\n')) {
      const split = pending.indexOf('\n'), line = pending.slice(0, split); pending = pending.slice(split + 1);
      try { const row = JSON.parse(line); if (Number.isFinite(row.rssBytes) && row.rssBytes >= 0) {
        state.peakSampledBytes = Math.max(state.peakSampledBytes, row.rssBytes); state.peakProcessCount = Math.max(state.peakProcessCount, row.processes); state.sampleCount++;
      } } catch {}
    }
  });
  child.on('error', () => { state.unavailable = true; });
  return { state, close: () => stopChild(child) };
}
const PAGE_READY = `(async () => {
  if (document.readyState !== 'complete') return false;
  await document.fonts.ready;
  if (!(${visibleImagesReady.toString()})(document, window)) return false;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`;
async function settled(browser) { await until(() => browser.evaluate(PAGE_READY), 15000, 80); }

async function capture(browser, output, descriptor, captures) {
  // Let short shipped transitions finish, then pause decorative animations
  // using CDP rather than introducing a CSP-blocked inline stylesheet.
  if (descriptor.source !== 'gallery') await browser.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await browser.evaluate(`document.activeElement?.blur()`);
  await settled(browser);
  if (descriptor.source !== 'gallery') await sleep(200);
  if (descriptor.source !== 'gallery') await browser.send('Animation.setPlaybackRate', { playbackRate: 0 });
  // A long modal keeps its shipped sizing. Scroll its largest overflowing
  // container rather than artificially stretching the dialog for a screenshot.
  const overflow = await browser.evaluate(`(${prepareScreenshotScroll.toString()})(document, window)`);
  const pages = overflow ? Math.min(6, 1 + Math.ceil(overflow.max / overflow.step)) : 1;
  for (let page = 1; page <= pages; page++) {
    if (page > 1) { await browser.evaluate(`window.__screensOverflow.scrollTop = ${Math.min(overflow.max, (page - 1) * overflow.step)}`); await settled(browser); }
    const name = screenshotName({ ...descriptor, page });
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true });
    const bytes = Buffer.from(screenshot.data, 'base64');
    await writeFile(path.join(output, name), bytes);
    captures.push({ ...descriptor, page, name, bytes: bytes.length,
      ...(overflow && page === pages ? { remainingOverflow: Math.max(0, overflow.max - (page - 1) * overflow.step) } : {}) });
  }
}

async function captureSuite(browser, server, output, entries, captures, report) {
  const galleryRequests = [];
  const requests = event => {
    if (event.method !== 'Network.requestWillBeSent') return;
    const { request, documentURL } = event.params;
    if (documentURL?.startsWith(`${server.origin}/gallery/preview`) &&
        (request.url.startsWith(`${server.origin}/api/`) || !['GET', 'HEAD'].includes(request.method))) galleryRequests.push(request.method);
  };
  browser.listeners.add(requests);
  report.galleryNetwork = { apiOrWriteRequests: 0, saveStubVerified: false };
  const auth = await fetch(server.inviteUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const cookie = auth.headers.get('set-cookie');
  if (![302, 303].includes(auth.status) || !cookie) throw new Error('Scratch authentication failed.');
  const pair = cookie.split(';')[0], split = pair.indexOf('=');
  await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1), url: server.origin, path: '/', httpOnly: true, sameSite: 'Lax' });
  await browser.send('Animation.enable');
  await browser.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.__rs3Perf = { enabled: true, events: [] };
    try { localStorage.setItem('picker.phone-tab', 'map'); } catch {}
    const theme=new URLSearchParams(location.search).get('screens-theme');
    if(location.pathname==='/' && ['dark','light'].includes(theme)) {
      const original=globalThis.fetch.bind(globalThis), appearance=${screenThemeSnapshot.toString()};
      globalThis.fetch=async (...args)=>{const response=await original(...args),url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);if(url.pathname==='/api/state'){const json=response.json.bind(response);response.json=async()=>appearance(await json(),theme);}return response;};
    }
  })();` });
  const viewports = [{ id: 'desktop-1440', width: 1440, height: 900, mobile: false }, { id: 'phone-390', width: 390, height: 844, mobile: true }];
  const surfaces = [{ id: 'map' }, { id: 'tasks', button: 'phone-tab-tasks' }, { id: 'more', button: 'phone-tab-more' }, { id: 'helper', button: 'helper-open' },
    { id: 'search', button: 'search-open' }, { id: 'settings', button: 'settings-open' }, { id: 'history', button: 'history-open' }];
  for (const viewport of viewports) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const theme of ['dark', 'light']) {
      await assertLightLock();
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
        await browser.send('Animation.setPlaybackRate', { playbackRate: 1 });
        await browser.send('Page.navigate', { url: `${server.origin}/?screens-theme=${theme}` });
        await until(async () => {
          const ready = await browser.evaluate(`(${mainPageState.toString()})(document, window.__rs3Perf)`).catch(() => ({ unavailable: true }));
          report.mainReadiness = ready;
          if (ready.error) throw new Error('Scratch main view failed to load.');
          return ready.tasks && ready.art;
        }, 120000, 100);
        for (const surface of surfaces) {
          await browser.evaluate(`(${prepareMainSurface.toString()})(document, ${JSON.stringify(surface.button ?? null)})`);
          if (surface.id === 'more' && !viewport.mobile) await browser.evaluate(`document.querySelector('#more-tools > summary')?.click()`);
          if (surface.button && !['tasks','more'].includes(surface.id)) await until(() => browser.evaluate(`(${mainSurfaceReady.toString()})(document, ${JSON.stringify(surface.id)})`), 30000, 80);
          await capture(browser, output, { source: 'main', id: surface.id, label: `Copied save: ${surface.id}`, theme, viewport: viewport.id }, captures);
        }
        console.log(`Captured ${viewport.id} ${theme}: ${surfaces.length} main surfaces.`);
    }
  }
  // Rebuild once per entry, then let the real responsive layout and preference
  // helpers produce its four appearances. Theme controls retain fresh documents.
  await browser.send('Animation.setPlaybackRate', { playbackRate: 1 });
  for (const [index, entry] of entries.entries()) {
    let loaded = false;
    for (const viewport of viewports) {
      // Gallery widths match its iframe. Mobile auto-fit would shrink isolated
      // overflowing toolbars after a desktop-to-phone resize.
      await browser.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await browser.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      for (const theme of ['dark', 'light']) {
        await assertLightLock();
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
        if (!loaded || entry.captureFresh) {
        await browser.send('Page.navigate', { url: `${server.origin}/gallery/preview?entry=${encodeURIComponent(entry.id)}&theme=${theme}&capture=1` });
        await until(async () => {
          // Navigation can briefly expose a new document before its root exists.
          const state = await browser.evaluate(`({ready: document.documentElement?.dataset.galleryReady, error: !!document.documentElement?.dataset.galleryError})`).catch(() => ({}));
          if (state.error) throw new Error(`Gallery sample failed: ${entry.id}.`);
          return state.ready === 'true' && await browser.evaluate(`location.pathname === '/gallery/preview' && new URLSearchParams(location.search).get('entry') === ${JSON.stringify(entry.id)} && new URLSearchParams(location.search).get('theme') === ${JSON.stringify(theme)}`);
        }, 15000, 50);
          loaded = true;
        } else {
          const changed = await browser.evaluate(`window.__galleryCapture?.(${JSON.stringify(theme)})`);
          if (!changed || await browser.evaluate(`!!document.documentElement.dataset.galleryError`)) throw new Error(`Gallery capture appearance failed: ${entry.id}.`);
        }
        if (!await browser.evaluate(`innerWidth === ${viewport.width}`)) throw new Error(`Gallery capture width drifted: ${entry.id}.`);
        if (entry.id === 'main' && !report.galleryNetwork.saveStubVerified) {
          const blocked = await browser.evaluate(`(async () => { const checkbox=document.querySelector('.task-row input[type="checkbox"]');if(!checkbox)return false;const previous=checkbox.checked;checkbox.click();await new Promise(resolve=>setTimeout(resolve,50));const note=document.querySelector('.gallery-safety-note')?.textContent;const reverted=checkbox.checked===previous;document.querySelector('#notice button')?.click();return note==='Not saved: gallery'&&reverted; })()`);
          if (!blocked) throw new Error('Gallery save stub did not block a task checkbox.');
          report.galleryNetwork.saveStubVerified = true;
        }
        if (galleryRequests.length) throw new Error('Gallery issued an API or write request.');
        await capture(browser, output, { source: 'gallery', id: entry.id, label: entry.label, theme, viewport: viewport.id }, captures);
      }
    }
    if ((index + 1) % 10 === 0 || index === entries.length - 1) console.log(`Captured ${index + 1}/${entries.length} gallery entries in all four appearances.`);
  }
  report.galleryNetwork.apiOrWriteRequests = galleryRequests.length;
  browser.listeners.delete(requests);
}


async function run() {
  const started = performance.now();
  await assertLightLock();
  const sourceHash = hash(await readFile(path.join(options.source, 'state.json')));
  await noLinks(options.source);
  const sha = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  if (!/^[a-f0-9]{7,40}$/.test(sha)) throw new Error('Invalid source revision.');
  const output = path.join(OUTPUT, sha);
  let compareDir = null;
  if (options.compare) {
    if (/^[a-f0-9]{7,40}$/.test(options.compare)) {
      const matches = (await readdir(OUTPUT)).filter(name => /^[a-f0-9]{7,40}$/.test(name) && (name.startsWith(options.compare) || options.compare.startsWith(name)));
      if (matches.length !== 1) throw new Error('Comparison baseline SHA must identify one existing screenshot directory.');
      compareDir = await realpath(path.join(OUTPUT, matches[0]));
    } else compareDir = await realpath(path.resolve(options.compare));
  }
  if (compareDir && path.resolve(compareDir).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Comparison baseline is the current output directory; copy it elsewhere first.');
  await mkdir(OUTPUT, { recursive: true });
  if (!inside(await realpath(ROOT), await realpath(OUTPUT))) throw new Error('Unsafe screenshot output directory.');
  await mkdir(output, { recursive: true });
  await noLinks(output);
  const { galleryEntries } = await import(pathToFileURL(path.join(ROOT, 'app/web/gallery-catalogue.mjs')).href);
  if (!Array.isArray(galleryEntries) || !galleryEntries.length || new Set(galleryEntries.map(entry => entry.id)).size !== galleryEntries.length) throw new Error('Gallery catalogue unavailable or duplicate entry IDs.');
  for (const entry of galleryEntries) screenshotName({ source: 'gallery', id: entry.id, theme: 'dark', viewport: 'desktop-1440' });
  const scratch = await mkdtemp(path.join(OUTPUT, 'scratch-'));
  const captures = [], report = { revision: sha, capturedAt: new Date().toISOString(), galleryEntries: galleryEntries.length, captures };
  report.workingTreeDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: ROOT, windowsHide: true, encoding: 'utf8' }).trim();
  let server, browser, sampler, cleaned = false, browserClose, serverClose;
  const closeBrowser = () => browser ? (browserClose ??= browser.close()) : undefined;
  const closeServer = () => server ? (serverClose ??= server.close()) : undefined;
  try {
    const sourceBase = await realpath(options.source), scratchBase = await realpath(scratch);
    if (sourceBase === scratchBase || inside(sourceBase, scratchBase) || inside(scratchBase, sourceBase)) throw new Error('Unsafe screenshot source/scratch overlap.');
    const dataDir = path.join(scratch, 'duo');
    await cp(options.source, dataDir, { recursive: true, dereference: false,
      filter: filename => !['store.lock', 'access-token', 'invites.json', 'feedback.json'].includes(path.basename(filename)) });
    if (hash(await readFile(path.join(options.source, 'state.json'))) !== sourceHash || hash(await readFile(path.join(dataDir, 'state.json'))) !== sourceHash) throw new Error('Source state changed while copying; retry with a stable save.');
    sampler = memorySampler();
    server = await startServer(dataDir);
    const profile = path.join(scratch, 'chrome'); await mkdir(profile);
    browser = await openChrome(await chromeExecutable(), profile, { extraArgs: ['--disable-features=BackForwardCache'] });
    const signalAbort = () => { void closeBrowser()?.catch(() => {}); void closeServer()?.catch(() => {}); };
    process.once('SIGINT', signalAbort); process.once('SIGTERM', signalAbort);
    try { await captureSuite(browser, server, output, galleryEntries, captures, report); }
    finally { process.off('SIGINT', signalAbort); process.off('SIGTERM', signalAbort); }
    await closeServer();
    report.copyStateUnchanged = hash(await readFile(path.join(dataDir, 'state.json'))) === sourceHash;
    if (!report.copyStateUnchanged) throw new Error('Scratch save state changed during screenshot capture.');
    report.status = 'complete';
    const names = captures.map(capture => capture.name);
    // Remove only stale generated screenshot filenames; never recurse into output.
    for (const name of await readdir(output)) if (/^(gallery|main)--[a-z0-9-]+\.png$/.test(name) && !names.includes(name)) await rm(path.join(output, name));
    if (compareDir) {
      report.comparison = await comparison(compareDir, output, names);
      await browser.send('Animation.setPlaybackRate', { playbackRate: 1 });
      await browser.send('Page.navigate', { url: pathToFileURL(path.join(output, 'compare.html')).href });
      await until(() => browser.evaluate(`location.protocol==='file:' && document.readyState==='complete'`), 30000, 100);
      await browser.evaluate(`document.querySelector('canvas')?.scrollIntoView({block:'center'})`);
      await until(() => browser.evaluate(`document.readyState==='complete' && (![...document.querySelectorAll('canvas')].length || !!document.querySelector('canvas[data-ready="true"]'))`), 30000, 100);
      report.comparison.canvasVerified = true;
    }
    else await rm(path.join(output, 'compare.html'), { force: true });
    await closeBrowser();
  } catch (error) {
    report.status = 'failed'; report.error = 'Screenshot run did not finish; incomplete images retained.';
    if (/^(Gallery |CDP |Benchmark browser probe failed|Timed out waiting)/.test(error.message)) report.failure = error.message;
    if (browser) report.galleryProbe = await browser.evaluate(`(() => { if(!location.pathname.startsWith('/gallery/preview'))return {gallery:false,startupError:document.getElementById('startup-error')?.textContent?.replace(/\\/join\\/[A-Za-z0-9_-]+/g,'/join/<redacted>'),taskStatus:document.getElementById('task-engine-status')?.textContent,mapImage:document.getElementById('map-stage')?.dataset.mapImage,events:window.__rs3Perf?.events?.map(event=>event.name)};return {gallery:true,entry:new URLSearchParams(location.search).get('entry'),ready:document.documentElement?.dataset.galleryReady,error:document.documentElement?.dataset.galleryError,taskRows:document.querySelectorAll('.task-row').length,checkboxes:document.querySelectorAll('.task-row input').length}; })()`).catch(() => ({ unavailable: true }));
    throw error;
  }
  finally {
    const stopped = await Promise.allSettled([closeBrowser(), closeServer(), sampler?.close()].filter(Boolean));
    let cleanupError = stopped.find(result => result.status === 'rejected');
    if (!cleanupError) {
      try {
        const base = await realpath(OUTPUT), target = await realpath(scratch);
        if (!inside(base, target) || !path.basename(target).startsWith('scratch-')) throw new Error('Unsafe screenshot scratch cleanup target.');
        await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); cleaned = true;
      } catch { cleanupError = true; }
    }
    report.scratchRemoved = cleaned; report.elapsedMs = Math.round(performance.now() - started); report.memory = sampler?.state ?? { unavailable: true };
    if (!report.memory.sampleCount) report.memory.unavailable = true;
    if (cleanupError) { report.status = 'failed'; report.error = 'Owned processes or scratch cleanup did not finish; scratch retained.'; }
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const groups = [...new Set(captures.map(capture => `${capture.source}--${capture.id}`))];
    const body = `<h1>Chunk picker screenshots · ${sha}</h1><p>${captures.length} images · ${(report.elapsedMs / 1000).toFixed(1)} seconds · sampled peak ${(report.memory.peakSampledBytes / 1024 ** 2 || 0).toFixed(0)} MiB · ${report.status}${report.workingTreeDirty ? ' · working tree includes uncommitted changes' : ''}.</p><p>Desktop 1440 × 900 and phone 390 × 844. Dark and light. Main surfaces use an isolated copy of the saved duo; gallery samples use fixtures. Scratch ${cleaned ? 'removed' : 'retained because cleanup failed'}.</p><p><a href="report.json">Machine-readable report</a>${report.comparison ? ' · <a href="compare.html">Changed/new/missing comparison</a>' : ''}</p><nav>${groups.map(group => `<a href="#${group}">${escapeHtml(group.replace('--', ': '))}</a>`).join('')}</nav>${groups.map(group => `<article id="${group}"><h2>${escapeHtml(group.replace('--', ': '))}</h2><div class="shots">${captures.filter(capture => `${capture.source}--${capture.id}` === group).map(capture => `<figure><figcaption>${escapeHtml(capture.theme)} · ${escapeHtml(capture.viewport)}${capture.page > 1 ? ` · page ${capture.page}` : ''}${capture.remainingOverflow > 0 ? ` · ${capture.remainingOverflow}px overflow remains after page limit` : ''}</figcaption><a href="${capture.name}"><img loading="lazy" src="${capture.name}" alt="${escapeHtml(capture.label)} ${capture.theme} ${capture.viewport}"></a></figure>`).join('')}</div></article>`).join('\n')}`;
    await writeFile(path.join(output, 'index.html'), htmlShell(`Screenshots ${sha}`, body));
    if (cleanupError) throw new Error('Owned screenshot process or scratch cleanup did not finish; scratch retained.');
  }
  console.log(`Screenshots: .local/screens/${sha}/index.html`);
  console.log(`Elapsed ${(report.elapsedMs / 1000).toFixed(1)}s; sampled process-tree peak ${(report.memory.peakSampledBytes / 1024 ** 2 || 0).toFixed(0)} MiB (${report.memory.sampleCount ?? 0} samples). Scratch removed.`);
}

if (parse(process.argv.slice(2))) run().catch(error => {
  // Errors from requests/browser startup can contain credentials. Emit only
  // authored safe errors; never dump stack traces, IPC or navigation URLs.
  const safe = /^(Use |Chrome unavailable|Light-lock|Linked screenshot|Gallery |Scratch |Source state|Unexpected scratch|Unsafe screenshot|Owned screenshot|Comparison baseline|Invalid source)/.test(error.message);
  console.error(safe ? error.message : 'Screenshot run failed; inspect report.json when available.'); process.exitCode = 1;
});
