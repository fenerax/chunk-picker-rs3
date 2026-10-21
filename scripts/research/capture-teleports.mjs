// Disposable localhost visual review using the project's isolated Chrome harness.
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openChrome, until } from '../perf/cdp.mjs';
import { applyTheme } from '../../app/web/map-tools.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const local = path.join(root, '.local'), source = path.join(local, 'teleports-save');
const output = path.join(local, 'teleports-screenshots');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copyHash = hash(await readFile(path.join(source, 'state.json')));
if (!path.relative(local, await realpath(source)).startsWith('teleports-save')) throw new Error('Use the worktree save copy.');
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(local, 'teleports-visual-'));
let browser, app;
const screenshots = [];
try {
  const dataDir = path.join(scratch, 'duo');
  await cp(source, dataDir, { recursive: true });
  for (const name of ['store.lock', 'invites.json', 'feedback.json', 'access-token']) await rm(path.join(dataDir, name), { force: true });
  process.env.RS3_GAME_DATA_DIR = 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data';
  process.env.RS3_MAP_ASSETS_DIR = 'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets';
  delete process.env.RS3_PUBLIC_ORIGIN; delete process.env.RS3_LOOPBACK_PORT;
  const { createServer } = await import('../../app/server.mjs');
  app = await createServer({ dataDir, host: '127.0.0.1', port: 0, loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false });
  await app.listen();
  const port = app.address().port;
  if ([8788, 8789, 8790].includes(port)) throw new Error('Protected port selected.');
  const origin = `http://127.0.0.1:${port}`;
  let executable;
  for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) {
    try { await access(candidate); executable = candidate; break; } catch {}
  }
  if (!executable) throw new Error('Chrome unavailable.');
  browser = await openChrome(executable, path.join(scratch, 'chrome'));
  const response = await fetch(app.inviteUrl, { redirect: 'manual' });
  const pair = response.headers.get('set-cookie')?.split(';')[0], split = pair?.indexOf('=');
  if (!pair || ![302, 303].includes(response.status)) throw new Error('Scratch authentication failed.');
  await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1), url: origin, path: '/', httpOnly: true, sameSite: 'Lax' });
  await browser.send('Page.navigate', { url: origin });
  await until(() => browser.evaluate(`!!document.getElementById('member')?.options.length && !document.getElementById('teleports-open')?.disabled`), 120000);
  await browser.evaluate(`document.getElementById('teleports-open').click()`);
  await until(() => browser.evaluate(`document.querySelector('.teleports-count')?.textContent`), 120000);
  const evidence = await browser.evaluate(`({title:document.getElementById('dialog-title').textContent,count:document.querySelector('.teleports-count').textContent,groups:[...document.querySelectorAll('.teleports-group-heading h3')].map(n=>n.textContent)})`);
  for (const theme of ['light', 'gray']) {
    const properties = {}, themedRoot = { dataset: {}, style: { setProperty(key, value) { properties[key] = value; } } };
    applyTheme(themedRoot, theme);
    for (const width of [1440, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.evaluate(`(()=>{const root=document.documentElement;Object.assign(root.dataset,${JSON.stringify(themedRoot.dataset)});root.style.colorScheme=${JSON.stringify(themedRoot.style.colorScheme)};for(const [key,value] of Object.entries(${JSON.stringify(properties)}))root.style.setProperty(key,value);document.getElementById('dialog-content').scrollTop=0})()`);
      await browser.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const file = path.join(output, `teleports-${width === 390 ? '390' : 'desktop'}-${theme}.png`);
      const capture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(file, Buffer.from(capture.data, 'base64'));
      const bounds = await browser.evaluate(`(()=>{const d=document.getElementById('tool-dialog');return {viewport:innerWidth,dialogWidth:d.getBoundingClientRect().width,horizontalOverflow:d.scrollWidth>d.clientWidth};})()`);
      screenshots.push({ file: path.relative(root, file).replaceAll('\\', '/'), theme, width, ...bounds });
      if (bounds.horizontalOverflow) throw new Error('Teleports dialog has horizontal overflow.');
    }
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate(`document.querySelectorAll('.teleports-group')[1]?.scrollIntoView({block:'start'})`);
  const spellCapture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, 'teleports-spells-desktop-gray.png'), Buffer.from(spellCapture.data, 'base64'));
  await writeFile(path.join(output, 'review.json'), JSON.stringify({ sourceStateSha256: copyHash, sourceRevision: app.store.getInfo().revision, evidence, screenshots }, null, 2) + '\n');
  console.log(JSON.stringify({ screenshots: screenshots.length + 1, groups: evidence.groups, horizontalOverflow: false }));
} finally {
  await browser?.close(); await app?.close();
  if (path.relative(local, scratch).startsWith('teleports-visual-')) await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (hash(await readFile(path.join(source, 'state.json'))) !== copyHash) throw new Error('Input copy changed.');
}
