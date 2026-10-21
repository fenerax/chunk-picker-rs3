import { inflateSync } from 'node:zlib';

export const NOISE = Object.freeze({ channelDelta: 8, changedFraction: 0.001 });
export function screenshotName({ source, id, theme, viewport, page = 1 }) {
  for (const value of [source, id, theme, viewport]) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error('Unsafe screenshot name.');
  }
  if (!Number.isInteger(page) || page < 1) throw new Error('Unsafe screenshot page.');
  return `${source}--${id}--${theme}--${viewport}${page > 1 ? `--page-${page}` : ''}.png`;
}
export function pairScreens(before, after) {
  const older = new Set(before), newer = new Set(after);
  return [...new Set([...older, ...newer])].sort().map(name => ({ name,
    status: !older.has(name) ? 'new' : !newer.has(name) ? 'missing' : 'paired' }));
}
export function prepareScreenshotScroll(document, viewport) {
  const dialog = [...document.querySelectorAll('dialog[open], [role="dialog"]')].find(element => !element.hidden && element.getClientRects().length);
  viewport.__screensOverflow = undefined;
  if (!dialog) {
    const element = document.documentElement?.dataset.galleryCapture === 'true' ? document.scrollingElement : null;
    if (!element || element.scrollHeight <= element.clientHeight + 40) return null;
    viewport.__screensOverflow = element; element.scrollTop = 0;
    return { max: element.scrollHeight - element.clientHeight, step: Math.max(100, element.clientHeight - 40) };
  }
  const candidates = [dialog, ...dialog.querySelectorAll('*')].filter(element =>
    /(auto|scroll)/.test(viewport.getComputedStyle(element).overflowY) && element.clientHeight > 100 && element.scrollHeight > element.clientHeight + 40
  ).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const element = viewport.__screensOverflow = candidates[0];
  if (!element) return null;
  element.scrollTop = 0;
  return { max: element.scrollHeight - element.clientHeight, step: Math.max(100, element.clientHeight - 40) };
}
// This is an in-memory display override. Preserve gameplay and revision fields;
// never send a preference command to the copied save.
export function screenThemeSnapshot(value, theme) {
  if (!['dark', 'light'].includes(theme) || !Array.isArray(value?.state?.members)) return value;
  return { ...value, state: { ...value.state, members: value.state.members.map(member => ({ ...member, preferences: { ...member.preferences, theme } })) } };
}
export function mainPageState(document, probe) {
  const error = document.getElementById('startup-error');
  return { error: !!error && !error.hidden,
    tasks: /[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent ?? ''),
    art: probe?.events?.some(event => event.name === 'terrain-drawn') === true || document.getElementById('map-stage')?.dataset.mapImage === 'ready' };
}
export function visibleImagesReady(document, viewport) {
  const helper = document.getElementById('helper-page');
  const scope = document.querySelector('dialog[open]') ?? (helper && !helper.hidden ? helper : document);
  const intersect = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  for (const image of scope.querySelectorAll('img')) {
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    let visible = intersect(rect, { left: 0, top: 0, right: viewport.innerWidth, bottom: viewport.innerHeight });
    for (let parent = image.parentElement; parent; parent = parent.parentElement) {
      const style = viewport.getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { visible.left = Math.max(visible.left, box.left); visible.right = Math.min(visible.right, box.right); }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { visible.top = Math.max(visible.top, box.top); visible.bottom = Math.min(visible.bottom, box.bottom); }
    }
    if (visible.right > visible.left && visible.bottom > visible.top && !image.complete) return false;
  }
  return true;
}

// Serialized into the scratch browser. Helper owns a full page; tools own a
// dialog. Exercise their shipped close controls to dispose pending requests.
export function prepareMainSurface(document, buttonId) {
  const helper = document.getElementById('helper-page');
  if (helper && !helper.hidden) helper.querySelector('.helper-header button')?.click();
  document.querySelectorAll('dialog[open]').forEach(dialog => {
    const close = dialog.querySelector('.dialog-header .close-button');
    if (close) close.click(); else dialog.close();
  });
  document.querySelectorAll('details.more-tools[open]').forEach(details => { details.open = false; });
  document.getElementById('phone-tab-map')?.click();
  if (buttonId) document.getElementById(buttonId)?.click();
}

export function mainSurfaceReady(document, id) {
  const host = id === 'helper' ? document.getElementById('helper-page') : document.querySelector('dialog[open]');
  if (!host || host.hidden || host.getAttribute('aria-busy') === 'true') return false;
  if (host.querySelector('[aria-busy="true"]')) return false;
  const statuses = host.querySelectorAll('[role="status"], .status-detail, .completed-loading, .helper-note, .helper-training-status');
  return ![...statuses].some(element => !element.hidden && (!element.getClientRects || element.getClientRects().length > 0)
    && /^(Loading|Searching|Connecting|Opening tool)\b/i.test(element.textContent.trim()));
}

// Chrome screenshots are non-interlaced, 8-bit RGB/RGBA PNGs. Decode those
// directly with Node's zlib, avoiding a package install or a second browser.
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid screenshot PNG.');
  let width, height, channels, offset = 8;
  const chunks = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error('Truncated screenshot PNG.');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!width || !height || width * height > 25_000_000 || data[8] !== 8 || !channels || data[10] || data[11] || data[12]) throw new Error('Unsupported screenshot PNG.');
    }
    if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!channels || !chunks.length) throw new Error('Incomplete screenshot PNG.');
  const stride = width * channels, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid screenshot raster.');
  const raster = Buffer.alloc(stride * height), pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Unsupported screenshot filter.');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? raster[y * stride + x - channels] : 0;
      const above = y ? raster[(y - 1) * stride + x] : 0;
      const diagonal = y && x >= channels ? raster[(y - 1) * stride + x - channels] : 0;
      const p = left + above - diagonal, a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - diagonal);
      const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2)
        : filter === 4 ? (a <= b && a <= c ? left : b <= c ? above : diagonal) : 0;
      raster[y * stride + x] = raw[y * (stride + 1) + 1 + x] + predictor;
    }
    for (let x = 0; x < width; x++) {
      const src = y * stride + x * channels, dest = (y * width + x) * 4;
      pixels[dest] = raster[src]; pixels[dest + 1] = raster[src + 1]; pixels[dest + 2] = raster[src + 2];
      pixels[dest + 3] = channels === 4 ? raster[src + 3] : 255;
    }
  }
  return { width, height, pixels };
}

// Serializable so the offline HTML viewer uses exactly the tested model.
export function pixelDifference(before, after, noise = { channelDelta: 8, changedFraction: 0.001 }) {
  if (before.width !== after.width || before.height !== after.height) return { changed: true, dimensionsChanged: true, changedPixels: null, fraction: 1 };
  let changedPixels = 0;
  for (let i = 0; i < before.pixels.length; i += 4) {
    if ([0, 1, 2, 3].some(channel => Math.abs(before.pixels[i + channel] - after.pixels[i + channel]) > noise.channelDelta)) changedPixels++;
  }
  const fraction = changedPixels / (before.width * before.height);
  return { changed: fraction > noise.changedFraction, dimensionsChanged: false, changedPixels, fraction };
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
