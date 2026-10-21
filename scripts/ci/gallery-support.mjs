import path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

export function chromeCandidates({ platform = process.platform, env = process.env } = {}) {
  const windows = platform === 'win32', paths = windows ? path.win32 : path.posix;
  const names = windows ? ['chrome.exe', 'google-chrome.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const search = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean)
    .flatMap(directory => names.map(name => paths.join(directory.replace(/^"|"$/g, ''), name)));
  const usual = windows
    ? [env.PROGRAMFILES ?? 'C:/Program Files', env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', env.LOCALAPPDATA]
      .filter(Boolean).map(directory => paths.join(directory, 'Google/Chrome/Application/chrome.exe'))
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [...new Set([env.CHROME_PATH, env.CHROME_BIN, ...search, ...usual].filter(Boolean))];
}

export async function findChrome(options = {}) {
  const executable = options.executable;
  const canExecute = options.canExecute ?? (async filename => {
    try {
      await access(filename, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return (await stat(filename)).isFile();
    } catch { return false; }
  });
  for (const filename of executable ? [executable] : chromeCandidates(options)) if (await canExecute(filename)) return filename;
  throw new Error('CHROME_UNAVAILABLE');
}

// Only codes and counts leave the checker: renderer errors and URLs can contain credentials.
export function judgeSample(state, id) {
  const failures = [];
  if (state?.ready !== 'true') failures.push('NOT_READY');
  if (state?.error) failures.push('GALLERY_ERROR');
  if (state?.pathname !== '/gallery/preview' || state?.entry !== id) failures.push('WRONG_SAMPLE');
  if (state?.visible !== true) failures.push('EMPTY_SAMPLE');
  if (state?.busy !== false) failures.push('SAMPLE_BUSY');
  if (state?.brokenImages !== 0) failures.push('BROKEN_IMAGE');
  return failures;
}

export function judgeMode(rows, ids, events) {
  return Array.isArray(ids) && Array.isArray(rows) && ids.length > 0 && rows.length === ids.length && new Set(ids).size === ids.length
    && rows.every((row, index) => row?.id === ids[index] && row.ready === true && Array.isArray(row.failures) && row.failures.length === 0)
    && ['consoleErrors', 'exceptions', 'blockedRequests', 'failedRequests', 'httpErrors'].every(key => events?.[key] === 0);
}

export function requestAllowed(url, method, origin) {
  try {
    const target = new URL(url);
    return target.origin === origin && ['GET', 'HEAD'].includes(method) && !target.pathname.startsWith('/api/');
  } catch { return false; }
}

export function httpFailure(status, url) {
  // Classify the browser's implicit icon separately without retaining URLs.
  let resource = 'gallery-resource';
  try { if (new URL(url).pathname === '/favicon.ico') resource = 'browser-favicon'; } catch {}
  return { status, resource };
}

export function originalFixtureFetch(capture) {
  return async (url, request) => {
    const parsed = new URL(url), match = /^\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(parsed.pathname);
    if (request?.method !== 'GET' || parsed.origin !== capture.metadata.sourceOrigin || parsed.search || parsed.hash
      || !(parsed.pathname === '/version.json' || match && capture.metadata.sourceFields.includes(match[2]))) throw new Error('ORIGINAL_FIXTURE_REQUEST');
    return new Response(JSON.stringify(match ? capture.maps[match[1]][match[2]] ?? null : capture.metadata.sourceVersion ?? null));
  };
}
