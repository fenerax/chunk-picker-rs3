// Opt-in real Chromium regression: PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
// No browser dependency is added to the application. Uses only the public starter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

for (const activation of ['Enter', 'pointer', 'Space']) test(`backup file purpose and filename in Chromium (${activation})`, {
  skip: !process.env.PLAYWRIGHT_MODULE && 'Set PLAYWRIGHT_MODULE to run Chromium', timeout: 60000,
}, async t => {
  process.env.RS3_DATASET = 'open-starter';
  process.env.RS3_TASK_WORKER_MODE = 'process';
  const { chromium } = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)));
  const { startServer } = await import('../app/server.mjs');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'backup-file-browser-'));
  let handle, browser, application;
  t.after(async () => {
    await browser?.close(); await handle?.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(dataDir + '.dataset.json', { force: true });
  });
  const start = async () => { handle = await startServer({ dataDir, host: '127.0.0.1', port: 0 }); application = await handle.ready; };
  await start();
  const origin = `http://127.0.0.1:${handle.address().port}`;
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || await findChrome(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(handle.inviteUrl);
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await page.locator('#tool-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('save-status').dataset.status === 'saved');
  // Restart through normal startup: the setup preference and admin session persist.
  await handle.close(); await start();
  await page.goto(`http://127.0.0.1:${handle.address().port}/`);
  await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Skip setup', exact: true }).count(), 0);
  const savedRevision = application.store.getInfo().revision;
  const savedBytes = await readFile(path.join(dataDir, 'state.json'));
  const open = async () => {
    const launcher = page.locator('#backup-open');
    const menu = launcher.locator('xpath=ancestor::details[1]');
    if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
    await launcher.click();
    await page.getByRole('heading', { name: 'Backup & Import', exact: true }).waitFor();
  };
  await open();
  const dialog = page.locator('#tool-dialog'), button = dialog.locator('.file-picker button');
  const preview = dialog.getByRole('button', { name: 'Preview restore', exact: true });
  await preview.click();
  await dialog.getByRole('alert').filter({ hasText: 'Choose' }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download full backup', exact: true }).click();
  const download = await downloadEvent, backup = await readFile(await download.path());
  const choose = async (name, buffer) => {
    const event = page.waitForEvent('filechooser');
    if (activation === 'pointer') await button.click();
    else { await button.focus(); await page.keyboard.press(activation); }
    const chooser = await event;
    await chooser.setFiles({ name, mimeType: 'application/json', buffer });
    await dialog.locator('.file-picker-name').filter({ hasText: name }).waitFor();
  };
  await choose('invalid-backup.json', Buffer.from('{invalid'));
  await preview.click();
  await dialog.getByRole('alert').filter({ hasText: /full backup/ }).waitFor();
  const ax = await page.context().newCDPSession(page);
  const description = async () => {
    const { nodes } = await ax.send('Accessibility.getFullAXTree');
    return nodes.find(node => !node.ignored && node.role?.value === 'button' && node.name?.value.includes('Choose file'));
  };
  // Collect before choosing again, so a stale filename relationship cannot pass.
  const invalidAX = await description();
  await choose('selected-backup.json.gz', backup);
  await preview.click();
  await dialog.getByRole('heading', { name: 'Review replacement', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Apply reviewed replacement', exact: true }).count(), 1);
  const validAX = await description();
  const relation = await button.evaluate(node => ({
    labelControl: [...node.labels].some(label => label.control === node && label.textContent === 'Choose a full backup'),
    described: (node.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent).join(' '),
    type: node.type,
  }));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const launcher = document.getElementById('backup-open'), menu = launcher.closest('details');
    return document.activeElement === (menu.open ? launcher : menu.querySelector('summary'));
  });
  await open();
  const emptyAX = await description();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const launcher = document.getElementById('backup-open'), menu = launcher.closest('details');
    return document.activeElement === (menu.open ? launcher : menu.querySelector('summary'));
  });
  assert.equal(application.store.getInfo().revision, savedRevision, 'Preview must not apply a restore');
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), savedBytes);
  assert.deepEqual(errors, []);
  assert.equal(relation.type, 'button');
  assert.equal(relation.labelControl, true, 'Purpose label must target the operable button');
  assert.equal(relation.described, 'selected-backup.json.gz');
  assert.match(invalidAX?.name?.value || '', /Choose file.*Choose a full backup/);
  assert.equal(invalidAX?.description?.value, 'invalid-backup.json');
  assert.equal(validAX?.description?.value, 'selected-backup.json.gz');
  assert.equal(emptyAX?.description?.value, 'No file chosen');
});
