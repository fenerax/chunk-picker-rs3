import './helpers/file-safety-stop.mjs';
// Real Chromium input, chooser, download and AX against disposable starter saves.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openChrome } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { activate, arm, button, evaluate, event, fileButton, freshPage, key, navigate, settle } from './helpers/backup-file-browser.mjs';

let browser, browserDirectory, unavailable;
before(async () => {
  let executable;
  try { executable = await findChrome(); } catch (error) {
    if (error.message !== 'CHROME_UNAVAILABLE') throw error;
    unavailable = true; return;
  }
  process.env.RS3_DATASET = 'open-starter';
  process.env.RS3_TASK_WORKER_MODE = 'process';
  for (const name of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR',
    'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256',
    'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN',
    'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_SCRATCH_CDP_PORT']) delete process.env[name];
  browserDirectory = await mkdtemp(path.join(tmpdir(), 'backup-file-chrome-'));
  browser = await openChrome(executable, path.join(browserDirectory, 'profile'), {
    browser: true, port: 0,
    extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
});
after(async () => {
  // Contexts close before joining the owned Chrome process and removing its profile.
  await browser?.close();
  if (browserDirectory) await rm(browserDirectory, { recursive: true, force: true });
});

const dialog = "document.getElementById('tool-dialog')";
const menu = "document.getElementById('more-tools')";
const launcher = "document.getElementById('backup-open')";

async function transition(page, kind, expression, action) {
  const pending = await arm(page, kind, expression);
  try { await action(); await pending.promise; await settle(page); }
  finally { pending.cancel(); }
}
async function open(page) {
  assert.equal(await page.evaluate(`${dialog}.open`), false, 'No existing modal before opening More');
  assert.equal(await page.evaluate(`${menu}.open`), false, 'More starts closed');
  // Opening More and the backup dialog each refresh backup health. Join that
  // asynchronous render too, so a late status line cannot move a pointer target
  // between measuring its centre and dispatching the one permitted input.
  const refresh = action => transition(page, 'status', "document.getElementById('backup-status-menu')", action);
  await refresh(() => transition(page, 'toggle', menu, () => activate(page, `${menu}.querySelector('summary')`)));
  assert.equal(await page.evaluate(`${menu}.open`), true, 'Native summary activation opens More');
  await refresh(() => transition(page, 'dialog', dialog, () => activate(page, launcher)));
  assert.equal(await page.evaluate(`${dialog}.open`), true, 'Launcher opens the real dialog');
  assert.equal(await page.evaluate("document.getElementById('dialog-title').textContent"), 'Export / Import');
}
async function preview(page, expected) {
  await transition(page, 'preview', button('Preview restore'), () => activate(page, button('Preview restore')));
  const result = await evaluate(page, () => ({
    alerts: [...document.querySelectorAll('#tool-dialog [role="alert"]')].filter(n => n.checkVisibility()).map(n => n.textContent),
    headings: [...document.querySelectorAll('#tool-dialog h3')].filter(n => n.checkVisibility()).map(n => n.textContent),
    apply: [...document.querySelectorAll('#tool-dialog button')].filter(n => n.textContent === 'Apply reviewed replacement').length,
  }));
  if (expected === 'valid') {
    assert.deepEqual(result.alerts, []);
    assert.ok(result.headings.includes('Review replacement'), 'Successful preview presents its review');
    assert.equal(result.apply, 1);
  } else {
    assert.equal(result.apply, 0);
    assert.match(result.alerts.join(' '), expected === 'empty' ? /Choose/ : /full backup/);
  }
}
async function accessibility(page, filename) {
  const { nodes } = await page.send('Accessibility.getFullAXTree');
  const matches = nodes.filter(n => !n.ignored && n.role?.value === 'button' && n.name?.value.includes('Choose file'));
  assert.equal(matches.length, 1, 'Exactly one accessible file control');
  assert.match(matches[0].name.value, /Choose file.*Choose a full backup/);
  assert.equal(matches[0].description?.value, filename);
  const relation = await evaluate(page, () => {
    const n = document.querySelector('#tool-dialog .file-picker button');
    return { type: n.type, label: [...n.labels].some(l => l.control === n && l.textContent === 'Choose a full backup'),
      described: (n.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent).join(' ') };
  });
  assert.deepEqual(relation, { type: 'button', label: true, described: filename });
}
async function close(page, mode) {
  await transition(page, 'close', dialog, () => mode === 'Escape' ? key(page, 'Escape')
    : activate(page, "document.querySelector('#tool-dialog [aria-label=\"Close dialog\"]')"));
  assert.equal(await page.evaluate(`${dialog}.open`), false);
  // Assert once after close, which includes application focus restoration.
  assert.equal(await page.evaluate(`document.activeElement === (${menu}.open ? ${launcher} : ${menu}.querySelector('summary'))`), true,
    `${mode} restores focus to the launcher or its visible summary`);
}

for (const activation of ['Enter', 'pointer', 'Space']) test(`backup file purpose and filename in Chromium (${activation})`, {
  }, async t => {
  if (unavailable) { t.skip('Chrome not found'); return; }
  const directory = await mkdtemp(path.join(tmpdir(), 'backup-file-browser-'));
  const dataDir = path.join(directory, 'save'), downloads = path.join(directory, 'downloads');
  let handle, application, page;
  let chooserCount = 0, selections = 0;
  const errors = [];
  const start = async () => {
    const { startServer } = await import('../app/server.mjs');
    handle = await startServer({ dataDir, host: '127.0.0.1', port: 0, predictionPrewarm: false });
    application = await handle.ready;
  };
  try {
    await start();
    page = await freshPage(browser);
    page.listeners.add(({ method, params }) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
      if (method === 'Page.fileChooserOpened') chooserCount++;
    });
    assert.deepEqual((await page.send('Network.getCookies', { urls: [handle.inviteUrl] })).cookies, [], 'Fresh context has no cookies');
    assert.equal((await fetch(`http://127.0.0.1:${handle.address().port}/api/state`)).status, 401);
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await mkdir(downloads);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads,
      browserContextId: page.browserContextId, eventsEnabled: true });
    await navigate(page, handle.inviteUrl);
    assert.equal(await page.evaluate('localStorage.getItem("backup-browser-contamination")'), null);
    await page.evaluate('localStorage.setItem("backup-browser-contamination", "synthetic")');
    await transition(page, 'close', dialog, () => activate(page, button('Skip setup')));
    assert.equal(await page.evaluate("document.getElementById('save-status').dataset.status"), 'saved');
    const persistedRevision = application.store.getInfo().revision;
    const persistedBytes = await readFile(path.join(dataDir, 'state.json'));
    const persistedState = structuredClone(application.store.getState());
    await handle.close(); await start();
    assert.equal(application.store.getInfo().revision, persistedRevision, 'Restart retains the saved revision');
    assert.deepEqual(application.store.getState(), persistedState, 'Restart retains the complete synthetic save');
    assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), persistedBytes, 'Restart retains exact state bytes');
    await navigate(page, `http://127.0.0.1:${handle.address().port}/`);
    assert.equal(await page.evaluate(`${dialog}.open`), false, 'Persisted setup dismissal survives server restart');
    assert.equal(await page.evaluate(`!!(${button('Skip setup')})`), false);
    const savedRevision = application.store.getInfo().revision;
    const savedBytes = await readFile(path.join(dataDir, 'state.json'));
    const unchanged = async phase => {
      assert.equal(application.store.getInfo().revision, savedRevision, `${phase}: preview must not change revision`);
      assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), savedBytes, `${phase}: preview must not write state.json`);
    };
    await open(page);
    await accessibility(page, 'No file chosen');
    await preview(page, 'empty'); await unchanged('empty');
    // Both listeners precede input, including a completion which can arrive in
    // the same CDP batch as downloadWillBegin for a small compressed save.
    const begun = event(browser, 'Browser.downloadWillBegin');
    const completions = new Map();
    const collect = ({ method, params }) => {
      if (method === 'Browser.downloadProgress' && ['completed', 'canceled'].includes(params.state)) completions.set(params.guid, params);
    };
    browser.listeners.add(collect);
    let backup;
    try {
      await activate(page, button('Full picker backup'));
      const download = await begun.promise;
      assert.match(download.suggestedFilename, /\.json\.gz$/);
      const completed = event(browser, 'Browser.downloadProgress', p => p.guid === download.guid && ['completed', 'canceled'].includes(p.state));
      try {
        const result = completions.get(download.guid) ?? await completed.promise;
        assert.equal(result.state, 'completed', 'Real compressed download completes');
      } finally { completed.cancel(); }
      assert.deepEqual(await readdir(downloads), [download.suggestedFilename], 'No partial or unexpected downloads');
      backup = await readFile(path.join(downloads, download.suggestedFilename));
      assert.deepEqual([...backup.subarray(0, 2)], [0x1f, 0x8b], 'Downloaded bytes are gzip');
      const decoded = JSON.parse(gunzipSync(backup));
      assert.equal(decoded.format, 'rs3-chunk-picker');
      assert.deepEqual(decoded.state, persistedState, 'Downloaded backup contains the exact saved state');
    } finally { begun.cancel(); browser.listeners.delete(collect); }
    const choose = async (filename, bytes) => {
      const file = path.join(directory, filename);
      await writeFile(file, bytes);
      assert.equal(chooserCount, selections, 'No stale file chooser event');
      const chooser = event(page, 'Page.fileChooserOpened');
      try {
        await activate(page, fileButton, activation);
        const chosen = await chooser.promise;
        assert.equal(chooserCount, ++selections, 'Exactly one chooser per native activation');
        assert.equal(chosen.mode, 'selectSingle');
        assert.ok(Number.isInteger(chosen.backendNodeId), 'Native input opens a real file chooser');
        await transition(page, 'change', "document.querySelector('#tool-dialog input[type=file]')", () =>
          page.send('DOM.setFileInputFiles', { backendNodeId: chosen.backendNodeId, files: [file] }));
        assert.equal(await page.evaluate("document.querySelector('#tool-dialog .file-picker-name').textContent"), filename);
      } finally { chooser.cancel(); }
    };
    await choose('invalid-backup.json', Buffer.from('{invalid'));
    await preview(page, 'invalid');
    await accessibility(page, 'invalid-backup.json'); await unchanged('invalid');
    await choose('selected-backup.json.gz', backup);
    await preview(page, 'valid');
    await accessibility(page, 'selected-backup.json.gz'); await unchanged('valid');
    await close(page, 'Escape');
    await open(page);
    await accessibility(page, 'No file chosen');
    await close(page, 'Close');
    await unchanged('closed');
    assert.equal(chooserCount, 2, 'No unsolicited file chooser events');
    assert.deepEqual(errors, [], 'No page errors');
  } catch (error) {
    t.diagnostic(`${error.name}: ${error.message}`); throw error;
  } finally {
    try { await page?.close(); }
    finally {
      try { await handle?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
});
