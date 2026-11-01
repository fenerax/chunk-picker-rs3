// Native Chromium input against the production starter and disposable saves.
// node --test tests/backup-file-browser.test.mjs (no npm/browser dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome, sleep, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

const evaluate = (page, fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const wait = (page, fn, ...args) => until(() => evaluate(page, fn, ...args), 10000);
const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
const dialogButton = name => `[...document.querySelectorAll('#tool-dialog button')].find(node => node.textContent === ${JSON.stringify(name)})`;
async function key(page, key) {
  const [value, code, windowsVirtualKeyCode, text] = {
    Enter: ['Enter', 'Enter', 13, '\r'], Space: [' ', 'Space', 32, ' '], Escape: ['Escape', 'Escape', 27],
  }[key];
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode,
    ...(text ? { text, unmodifiedText: text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode });
}
async function click(page, expression) {
  await until(() => page.evaluate(`(() => { const node = ${expression}; return node && !node.disabled && node.checkVisibility(); })()`), 10000);
  await page.evaluate(`(${expression}).scrollIntoView({ block: 'center' })`);
  await sleep(50);
  const point = await page.evaluate(`(() => {
    const node = ${expression}, r = node.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === node || node.contains(hit) };
  })()`);
  assert.equal(point.hit, true, 'Pointer target owns its centre');
  const { x, y } = point;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

for (const activation of ['Enter', 'pointer', 'Space']) test(`backup file purpose and filename in Chromium (${activation})`, {
  timeout: 60000,
}, async t => {
  let executable;
  try { executable = await findChrome(); } catch (error) {
    if (error.message !== 'CHROME_UNAVAILABLE') throw error;
    t.skip('Chrome not found'); return;
  }
  process.env.RS3_DATASET = 'open-starter';
  process.env.RS3_TASK_WORKER_MODE = 'process';
  for (const name of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR',
    'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256',
    'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN',
    'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN']) delete process.env[name];
  const { startServer } = await import('../app/server.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'backup-file-browser-'));
  const dataDir = path.join(directory, 'save'), downloads = path.join(directory, 'downloads');
  let handle, page, application;
  t.after(async () => {
    try { await page?.close(); }
    finally {
      try { await handle?.close(); }
      finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    }
  });
  const start = async () => {
    handle = await startServer({ dataDir, host: '127.0.0.1', port: 0, predictionPrewarm: false });
    application = await handle.ready;
  };
  await start();
  const origin = `http://127.0.0.1:${handle.address().port}`;
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  page = await openChrome(executable, path.join(directory, 'chrome'), {
    extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const errors = [], choosers = [];
  page.listeners.add(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === 'Page.fileChooserOpened') choosers.push(params);
  });
  await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
  await mkdir(downloads);
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.send('Page.navigate', { url: handle.inviteUrl });
  await click(page, dialogButton('Skip setup'));
  await wait(page, () => !document.getElementById('tool-dialog').open);
  await wait(page, () => document.getElementById('save-status').dataset.status === 'saved');
  // Restart through normal startup: the setup preference and admin session persist.
  await handle.close(); await start();
  const restartedOrigin = `http://127.0.0.1:${handle.address().port}`;
  await page.send('Page.navigate', { url: restartedOrigin + '/' });
  await wait(page, origin => location.origin === origin && document.readyState === 'complete'
    && document.getElementById('save-status')?.textContent === 'Saved', restartedOrigin);
  assert.equal(await page.evaluate(`!!(${dialogButton('Skip setup')})`), false);
  const savedRevision = application.store.getInfo().revision;
  const savedBytes = await readFile(path.join(dataDir, 'state.json'));
  const open = async () => {
    if (!await page.evaluate("document.getElementById('backup-open').closest('details').open")) {
      await click(page, "document.getElementById('backup-open').closest('details').querySelector('summary')");
    }
    await click(page, element('#backup-open'));
    await wait(page, () => document.getElementById('tool-dialog').open && document.getElementById('dialog-title').textContent === 'Backup & Import');
  };
  await open();
  const button = element('#tool-dialog .file-picker button'), preview = dialogButton('Preview restore');
  const alert = text => wait(page, text => [...document.querySelectorAll('#tool-dialog [role="alert"]')]
    .some(node => node.checkVisibility() && node.textContent.includes(text)), text);
  await click(page, preview);
  await alert('Choose');
  await click(page, dialogButton('Download full backup'));
  // Chrome renames its .crdownload only after the actual download completes.
  const downloaded = await until(async () => (await readdir(downloads)).find(name => name.endsWith('.json.gz')), 10000);
  const backup = await readFile(path.join(downloads, downloaded));
  assert.ok(backup.length > 0, 'Full backup download contains bytes');
  const choose = async (name, buffer) => {
    const filename = path.join(directory, name);
    await writeFile(filename, buffer);
    assert.equal(choosers.length, 0, 'No stale file chooser event');
    if (activation === 'pointer') await click(page, button);
    else {
      await page.evaluate(`(${button}).focus()`);
      assert.equal(await page.evaluate(`document.activeElement === (${button})`), true);
      await key(page, activation);
    }
    const chooser = await until(() => choosers.shift(), 10000);
    assert.equal(chooser.mode, 'selectSingle');
    assert.ok(Number.isInteger(chooser.backendNodeId), 'Native activation opened the file input');
    await page.send('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [filename] });
    await wait(page, name => document.querySelector('#tool-dialog .file-picker-name')?.textContent === name, name);
  };
  await choose('invalid-backup.json', Buffer.from('{invalid'));
  await click(page, preview);
  await alert('full backup');
  const description = async () => {
    const { nodes } = await page.send('Accessibility.getFullAXTree');
    return nodes.find(node => !node.ignored && node.role?.value === 'button' && node.name?.value.includes('Choose file'));
  };
  // Collect before choosing again, so a stale filename relationship cannot pass.
  const invalidAX = await description();
  await choose('selected-backup.json.gz', backup);
  await click(page, preview);
  await wait(page, () => [...document.querySelectorAll('#tool-dialog h3')].some(node => node.textContent === 'Review replacement' && node.checkVisibility()));
  assert.equal(await page.evaluate(`[...document.querySelectorAll('#tool-dialog button')].filter(node => node.textContent === 'Apply reviewed replacement').length`), 1);
  const validAX = await description();
  const relation = await evaluate(page, () => {
    const node = document.querySelector('#tool-dialog .file-picker button');
    return {
      labelControl: [...node.labels].some(label => label.control === node && label.textContent === 'Choose a full backup'),
      described: (node.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent).join(' '),
      type: node.type,
    };
  });
  const closedAndFocused = () => wait(page, () => {
    const launcher = document.getElementById('backup-open'), menu = launcher.closest('details');
    return !document.getElementById('tool-dialog').open && document.activeElement === (menu.open ? launcher : menu.querySelector('summary'));
  });
  await key(page, 'Escape');
  await closedAndFocused();
  await open();
  const emptyAX = await description();
  await click(page, element('#tool-dialog [aria-label="Close dialog"]'));
  await closedAndFocused();
  assert.equal(application.store.getInfo().revision, savedRevision, 'Preview must not apply a restore');
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), savedBytes);
  assert.deepEqual(errors, []);
  assert.equal(relation.type, 'button');
  assert.equal(relation.labelControl, true, 'Purpose label must target the operable button');
  assert.equal(relation.described, 'selected-backup.json.gz');
  assert.match(invalidAX?.name?.value || '', /Choose file.*Choose a full backup/);
  assert.equal(invalidAX?.description?.value, 'invalid-backup.json');
  assert.match(validAX?.name?.value || '', /Choose file.*Choose a full backup/);
  assert.equal(validAX?.description?.value, 'selected-backup.json.gz');
  assert.match(emptyAX?.name?.value || '', /Choose file.*Choose a full backup/);
  assert.equal(emptyAX?.description?.value, 'No file chosen');
});
