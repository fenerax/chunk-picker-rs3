#!/usr/bin/env node
// node scripts/ci/gallery-check.mjs [--checkout DIR] [--output DIR] [--chrome EXE]
// Run after .github/packs/fetch-packs.mjs, just like the workflow. All saves and
// browser profiles are fresh scratch; no release kit, live save or Chrome session is used.
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fork, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openChrome, sleep, stopChild, until } from '../perf/cdp.mjs';
import { findChrome, httpFailure, judgeMode, judgeSample, requestAllowed } from './gallery-support.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeCode = error => /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'CHECK_FAILED';

async function scratchPort() {
  for (let port = 8900; port <= 8999; port++) {
    const probe = net.createServer();
    const free = await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('NO_SCRATCH_PORT');
}

export async function startServer(checkout, scratch, port, ownChild) {
  // Discard inherited app/profile/asset selection, preload hooks and credentials.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:RS3_|NODE_OPTIONS$|NODE_PATH$|GH_TOKEN$|GITHUB_TOKEN$)/i.test(key)));
  Object.assign(env, { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: path.join(scratch, 'no-packs'),
    RS3_MAP_ASSETS_DIR: path.join(checkout, '.local/map-assets'), RS3_GAME_DATA_DIR: path.join(checkout, '.local/game-data'),
    RS3_TASK_WORKER_MODE: 'process' });
  const child = fork(fileURLToPath(new URL('./gallery-server.mjs', import.meta.url)), [checkout, scratch, String(port)],
    { cwd: checkout, env, execArgv: ['--max-old-space-size=640', '--expose-gc'], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  ownChild(child);
  child.on('error', () => {});
  const close = async () => {
    if (child.connected && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.send({ type: 'stop' }, () => {});
      await Promise.race([exited, sleep(12000)]);
    }
    await stopChild(child);
  };
  try {
    const ready = await new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer); child.off('message', message); child.off('exit', exited); child.off('error', failed);
        error ? reject(error) : resolve(value);
      };
      const message = value => value?.type === 'ready' ? finish(null, value) : value?.type === 'error'
        && finish(new Error(/^[A-Z_]+$/.test(value.code ?? '') ? value.code : 'SERVER_START_FAILED'));
      const exited = () => finish(new Error('SERVER_EXITED'));
      const failed = () => finish(new Error('SERVER_START_FAILED'));
      const timer = setTimeout(() => finish(new Error('SERVER_START_TIMEOUT')), 180000);
      child.on('message', message); child.once('exit', exited); child.once('error', failed);
    });
    const origin = `http://127.0.0.1:${port}`;
    if (new URL(ready.inviteUrl).origin !== origin) throw new Error('SERVER_ORIGIN');
    return { ...ready, origin, close };
  } catch (error) { await close(); throw error; }
}

// Probe the actual iframe document in framed mode. Entry identity prevents a
// previously ready document from satisfying the next navigation's wait.
function sampleProbe(framed) {
  const document = framed ? globalThis.document.getElementById('gallery-preview')?.contentDocument : globalThis.document;
  if (!document?.documentElement) return null;
  const view = document.defaultView;
  const visible = element => {
    const box = element.getBoundingClientRect(), style = view.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  return { ready: document.documentElement.dataset.galleryReady, error: !!document.documentElement.dataset.galleryError,
    pathname: document.location.pathname, entry: new URLSearchParams(document.location.search).get('entry'),
    visible: [...document.querySelectorAll('canvas, dialog[open], h1, h2, button, .sample-region')].some(visible),
    busy: !!document.querySelector('#helper-page[aria-busy="true"], #helper-content[aria-busy="true"]'),
    brokenImages: [...document.images].filter(image => visible(image) && (!image.complete || !image.naturalWidth)).length };
}

export async function saveProbe(framed) {
  const document = framed ? globalThis.document.getElementById('gallery-preview')?.contentDocument : globalThis.document;
  const checkbox = document?.querySelector('.task-row input[type="checkbox"]');
  const note = document?.querySelector('.gallery-safety-note');
  if (!checkbox || checkbox.disabled || !note) return false;
  const previous = checkbox.checked;
  note.textContent = '';
  checkbox.click();
  await new Promise(resolve => setTimeout(resolve, 50));
  const blocked = document.querySelector('.gallery-safety-note')?.textContent === 'Not saved: gallery' && checkbox.checked === previous;
  document.querySelector('#notice button')?.click();
  return blocked;
}

export async function runMode({ mode, browser, server, ids, output, isInterrupted }) {
  const started = Date.now(), framed = mode === 'framed';
  const events = { consoleErrors: 0, exceptions: 0, blockedRequests: 0, failedRequests: 0, httpErrors: 0 };
  const rows = [], pending = new Set();
  const httpFailures = [];
  const listener = message => {
    const params = message.params;
    if (message.method === 'Runtime.consoleAPICalled' && params.type === 'error'
      || message.method === 'Log.entryAdded' && params.entry.level === 'error') events.consoleErrors++;
    if (message.method === 'Runtime.exceptionThrown') events.exceptions++;
    if (message.method === 'Network.loadingFailed' && !params.canceled) {
      if (params.blockedReason) events.blockedRequests++; else events.failedRequests++;
    }
    if (message.method === 'Network.responseReceived' && params.response.status >= 400) {
      events.httpErrors++;
      if (httpFailures.length < 50) httpFailures.push(httpFailure(params.response.status, params.response.url));
    }
    if (message.method === 'Fetch.requestPaused') {
      const allowed = requestAllowed(params.request.url, params.request.method, server.origin);
      if (!allowed) events.blockedRequests++;
      const action = browser.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        { requestId: params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) })
        .catch(() => { events.failedRequests++; }).finally(() => pending.delete(action));
      pending.add(action);
    }
  };
  browser.listeners.add(listener);
  await browser.send('Log.enable');
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  try {
    for (const id of ids) {
      if (isInterrupted()) throw new Error('INTERRUPTED');
      const before = { ...events }, failures = [];
      let state;
      try {
        const url = framed ? `${server.origin}/gallery#${encodeURIComponent(id)}`
          : `${server.origin}/gallery/preview?entry=${encodeURIComponent(id)}`;
        await browser.send('Page.navigate', { url });
        await until(async () => {
          if (isInterrupted()) throw new Error('INTERRUPTED');
          state = await browser.evaluate(`(${sampleProbe.toString()})(${framed})`).catch(() => null);
          if (state?.entry !== id || state?.pathname !== '/gallery/preview') return false;
          if (state.error) throw new Error('GALLERY_ERROR');
          return state.ready === 'true';
        }, 15000, 50);
        await sleep(100);
        state = await browser.evaluate(`(${sampleProbe.toString()})(${framed})`);
        failures.push(...judgeSample(state, id));
        if (id === 'main' && !await browser.evaluate(`(${saveProbe.toString()})(${framed})`)) failures.push('SAVE_STUB_FAILED');
      } catch (error) {
        if (isInterrupted()) throw new Error('INTERRUPTED');
        failures.push(safeCode(error));
      }
      for (const key of Object.keys(events)) if (events[key] !== before[key]) failures.push(key);
      const row = { id, ready: state?.ready === 'true' && state?.entry === id, failures: [...new Set(failures)] };
      if (row.failures.length) {
        try {
          const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const name = `${mode}-${id}.png`;
          await mkdir(path.join(output, 'failures'), { recursive: true });
          await writeFile(path.join(output, 'failures', name), Buffer.from(shot.data, 'base64'));
          row.screenshot = `failures/${name}`;
        } catch { row.failures.push('SCREENSHOT_FAILED'); }
      }
      rows.push(row);
      if (row.failures.length) console.log(`${mode} ${id}: ${row.failures.join(', ')}`);
      // Each fixture decodes the full catalogue. Reclaim the previous page on
      // every navigation instead of letting Chrome grow toward its heap limit.
      await browser.send('HeapProfiler.collectGarbage');
      if (rows.length % 10 === 0 || rows.length === ids.length) console.log(`${mode}: ${rows.length}/${ids.length} checked`);
    }
    // Settle interceptions before disabling them so late errors still fail the mode.
    await sleep(100); await Promise.all([...pending]);
  } finally {
    await browser.send('Fetch.disable').catch(() => {});
    await Promise.all([...pending]); browser.listeners.delete(listener);
  }
  return { passed: judgeMode(rows, ids, events), ready: rows.filter(row => row.ready).length, total: ids.length,
    elapsedMs: Date.now() - started, events, httpFailures, samples: rows };
}

export async function runGallery({ checkout = root, output = path.join(root, '.local/ci-gallery'), chrome } = {}) {
  checkout = path.resolve(checkout); output = path.resolve(output);
  // Each output directory is new: a passing run cannot upload stale failure pictures.
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(output, 'summary.json'), '', { flag: 'wx' });
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-ci-gallery-'));
  const started = Date.now(), summary = { schema: 'rs3-ci-gallery-v1', passed: false, modes: {}, failures: [] };
  const ownedChildren = [], ownChild = child => { ownedChildren.push(child); return child; };
  let server, browser, interrupted = false;
  const interrupt = () => { interrupted = true; void browser?.close().catch(() => {}); };
  const deadline = setTimeout(interrupt, 18 * 60000);
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const executable = await findChrome({ executable: chrome });
    const { galleryEntries } = await import(pathToFileURL(path.join(checkout, 'app/web/gallery-catalogue.mjs')).href);
    const ids = galleryEntries.map(entry => entry.id);
    if (!ids.length || ids.some(id => !/^[a-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('INVALID_CATALOGUE');
    server = await startServer(checkout, scratch, await scratchPort(), ownChild);
    const before = hash(await readFile(path.join(scratch, 'save/state.json')));
    for (const mode of ['plain', 'framed']) {
      if (interrupted) throw new Error('INTERRUPTED');
      const cdpPort = await scratchPort(), previousPort = process.env.RS3_SCRATCH_CDP_PORT;
      process.env.RS3_SCRATCH_CDP_PORT = String(cdpPort);
      try {
        browser = await openChrome(executable, path.join(scratch, mode), { port: cdpPort,
          // Hosted Linux Chrome needs no desktop session or shared-memory mount.
          extraArgs: ['--disable-gpu', '--disable-features=BackForwardCache', '--js-flags=--max-old-space-size=192',
            ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])] },
        { spawn: (...args) => ownChild(spawn(...args)) });
        const close = browser.close.bind(browser);
        let closing;
        browser.close = () => closing ??= close();
      } finally {
        if (previousPort === undefined) delete process.env.RS3_SCRATCH_CDP_PORT;
        else process.env.RS3_SCRATCH_CDP_PORT = previousPort;
      }
      try {
        const auth = await fetch(server.inviteUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        const cookie = auth.headers.get('set-cookie');
        if (![302, 303].includes(auth.status) || !cookie) throw new Error('AUTH_FAILED');
        const pair = cookie.split(';')[0], split = pair.indexOf('=');
        const installed = await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1),
          url: server.origin, path: '/', httpOnly: true, sameSite: 'Lax' });
        if (!installed.success) throw new Error('AUTH_FAILED');
        summary.modes[mode] = await runMode({ mode, browser, server, ids, output, isInterrupted: () => interrupted });
      } finally { await browser.close(); browser = undefined; }
    }
    if (before !== hash(await readFile(path.join(scratch, 'save/state.json')))) throw new Error('SAVE_CHANGED');
    summary.passed = !interrupted && ['plain', 'framed'].every(mode => summary.modes[mode]?.passed === true);
  } catch (error) { summary.failures.push(safeCode(error)); }
  finally {
    clearTimeout(deadline);
    let cleanupFailed = false;
    try { await browser?.close(); } catch { cleanupFailed = true; }
    try { await server?.close(); } catch { cleanupFailed = true; }
    for (const child of ownedChildren) try { await stopChild(child); } catch { cleanupFailed = true; }
    if (cleanupFailed) { summary.passed = false; summary.failures.push('CLEANUP_FAILED'); }
    else try { await rm(scratch, { recursive: true, force: true }); }
    catch { summary.passed = false; summary.failures.push('SCRATCH_CLEANUP_FAILED'); }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    summary.elapsedMs = Date.now() - started;
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: summary.passed, elapsedMs: summary.elapsedMs,
    ...Object.fromEntries(Object.entries(summary.modes).map(([mode, result]) => [mode, { ready: result.ready, total: result.total }])),
    failures: summary.failures }));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { checkout: { type: 'string' }, output: { type: 'string' }, chrome: { type: 'string' } } });
    if (!(await runGallery(values)).passed) process.exitCode = 1;
  } catch { console.error('Gallery check setup failed; use a fresh output directory.'); process.exitCode = 1; }
}
