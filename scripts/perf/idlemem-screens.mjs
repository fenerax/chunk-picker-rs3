import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openChrome, sleep, until } from './cdp.mjs';
import { probeSource, snapshotExpression } from './probe.mjs';

// One disposable browser after the memory samples. Never prints a session or
// navigation URL. The caller owns this scratch directory and the heavy lock.
export async function captureIdleScreens({ root, scratch, origin, token }) {
  const candidates = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('Screenshot browser unavailable.');
  const profile = path.join(scratch, 'chrome'); await mkdir(profile);
  const screens = path.join(root, '.local/screens'); await mkdir(screens, { recursive: true });
  const browser = await openChrome(executable, profile);
  const captures = [];
  try {
    const response = await fetch(`${origin}/join/${token}`, { redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (![302, 303].includes(response.status) || !cookie) throw new Error('Screenshot session unavailable.');
    const [pair] = cookie.split(';'), split = pair.indexOf('=');
    await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1),
      url: origin, path: '/', httpOnly: true, sameSite: 'Lax' });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource });
    await browser.send('Page.navigate', { url: `${origin}/` });
    await until(async () => {
      const state = await browser.evaluate(snapshotExpression);
      return state.tasksReady && state.events.some(event => event.name === 'visible-tiles-loaded' && event.visible > 0);
    }, 180000, 100);
    for (const [name, width, height, mobile] of [['desktop-1440', 1440, 900, false], ['phone-390', 390, 844, true]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await sleep(1000);
      const file = path.join(screens, `idlemem-${name}.png`);
      const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(screenshot.data, 'base64'); await writeFile(file, bytes);
      captures.push({ path: path.relative(root, file).split(path.sep).join('/'), width, height, bytes: bytes.length });
    }
    return captures;
  } finally { await browser.close(); }
}
