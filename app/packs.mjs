import path from 'node:path';
import { lstat, realpath, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REVIEWED_LEGACY_SVG_HASHES } from './art-bindings.mjs';

export const ART_COMPONENTS = Object.freeze(['legacyResources', 'taskArtwork', 'worldImages', 'mapAssets', 'terrainAssets', 'iconAssets']);
export const PACK_LIMITS = Object.freeze({ files: 100000, fileBytes: 128 * 1024 * 1024, jsonBytes: 32 * 1024 * 1024, manifestBytes: 32 * 1024 * 1024, totalBytes: 8 * 1024 ** 3, dimension: 32768, pixels: 150000000 });
export const PACK_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const digestPattern = /^[a-f0-9]{64}$/;
const own = (object, key) => Object.hasOwn(object ?? {}, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new TypeError('Invalid art pack.'); };
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Pack paths are portable relative POSIX paths, never URL-decoded filesystem input. */
export function packRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\:\u0000-\u001f\u007f%]/u.test(value)
    || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail();
  return value;
}

/** Refuse links/junctions and altered canonical paths, including the root's ancestors. */
export async function safeArtFile(root, relative = '') {
  const absoluteRoot = path.resolve(root);
  if (relative) packRelative(relative);
  const target = relative ? path.resolve(absoluteRoot, ...relative.split('/')) : absoluteRoot;
  const base = path.parse(target).root;
  let current = base;
  for (const segment of target.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) fail();
    if (current !== target && !metadata.isDirectory()) fail();
  }
  const metadata = await lstat(target);
  if (relative ? !metadata.isFile() : !metadata.isDirectory()) fail();
  // Canonicalizing the complete root and target covers their ancestor paths too.
  // Keep the ordered lstat walk (including ancestors above root), and repeat this
  // validation after reads as before. Nothing is cached across file opens.
  if (!equalPath(await realpath(absoluteRoot), absoluteRoot) || !equalPath(await realpath(target), target)) fail();
  return target;
}

const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
async function readVerified(root, record, { json = false } = {}) {
  const filename = await safeArtFile(root, record.path);
  const handle = await open(filename, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== record.bytes || metadata.size > PACK_LIMITS.fileBytes
      || (json && metadata.size > PACK_LIMITS.jsonBytes)) fail();
    const hash = createHash('sha256');
    const pieces = json ? [] : null;
    for await (const bytes of handle.createReadStream({ autoClose: false })) { hash.update(bytes); if (pieces) pieces.push(bytes); }
    if (hash.digest('hex') !== record.sha256) fail();
    await safeArtFile(root, record.path);
    if (fingerprint(metadata) !== fingerprint(await handle.stat()) || fingerprint(metadata) !== fingerprint(await lstat(filename))) fail();
    return { filename, fingerprint: fingerprint(metadata), ...(json ? { value: JSON.parse(Buffer.concat(pieces).toString('utf8')) } : {}) };
  } finally { await handle.close(); }
}

function imageDimensions(width, height) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= PACK_LIMITS.dimension)
    || width * height > PACK_LIMITS.pixels) fail();
}

/** New SVGs accept only drawing primitives with a deliberately small inert attribute set. */
export function validateInertSvg(bytes, digest) {
  if (bytes.length > 2 * 1024 * 1024) fail();
  const source = bytes.toString('utf8');
  if (REVIEWED_LEGACY_SVG_HASHES.has(digest)) return;
  let text = source.replace(/^\s*<\?xml\s+[^?]*\?>/u, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<!|<\?|&|url\s*\(|javascript:|data:/iu.test(text)) fail();
  const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc']);
  const attributes = new Set(['xmlns', 'version', 'width', 'height', 'viewBox', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'role', 'aria-label']);
  const stack = [];
  let rootSeen = false, offset = 0;
  for (const match of text.matchAll(/<([^<>]*)>/g)) {
    const content = text.slice(offset, match.index);
    if (content.trim() && !['title', 'desc'].includes(stack.at(-1))) fail();
    offset = match.index + match[0].length;
    const token = match[1], closing = token.startsWith('/'), ending = token.endsWith('/');
    const name = /^\/?([A-Za-z]+)(?:\s|\/|$)/.exec(token)?.[1];
    if (!tags.has(name)) fail();
    if (closing) { if (token !== `/${name}` || stack.pop() !== name) fail(); continue; }
    if (!rootSeen) { if (name !== 'svg') fail(); rootSeen = true; }
    else if (!stack.length || name === 'svg') fail();
    let rest = token.slice(name.length).replace(/\/$/, '');
    const values = {};
    while (rest.trim()) {
      const attribute = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(["'])([^"'<>]*)\2/u.exec(rest);
      if (!attribute || !attributes.has(attribute[1]) || own(values, attribute[1])) fail();
      const [, key, , value] = attribute;
      if (key === 'xmlns' ? value !== 'http://www.w3.org/2000/svg' : /[:;{}\\]/u.test(value)) fail();
      if (['fill', 'stroke'].includes(key) && !/^(?:none|currentColor|[a-z]+|#[0-9a-f]{3,8})$/i.test(value)) fail();
      values[key] = value; rest = rest.slice(attribute[0].length);
    }
    if (name === 'svg') {
      const width = Number((values.width ?? '').replace(/px$/, '')), height = Number((values.height ?? '').replace(/px$/, ''));
      if (width && height) imageDimensions(width, height);
      else { const view = (values.viewBox ?? '').trim().split(/[ ,]+/).map(Number); if (view.length !== 4) fail(); imageDimensions(view[2], view[3]); }
    }
    if (!ending) stack.push(name);
  }
  if (!rootSeen || stack.length || text.slice(offset).trim()) fail();
}

export async function validateArtPayload(filename, record) {
  const extension = path.extname(record.path).toLowerCase();
  if (extension === '.json') return;
  const handle = await open(filename, 'r');
  try {
    const head = Buffer.alloc(Math.min(record.bytes, 64)); await handle.read(head, 0, head.length, 0);
    if (extension === '.png') {
      if (record.bytes < 45 || !head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || head.readUInt32BE(8) !== 13 || head.toString('ascii', 12, 16) !== 'IHDR') fail();
      imageDimensions(head.readUInt32BE(16), head.readUInt32BE(20));
      const end = Buffer.alloc(12); await handle.read(end, 0, 12, record.bytes - 12);
      if (!end.equals(Buffer.from('0000000049454e44ae426082', 'hex'))) fail();
    } else if (extension === '.webp') {
      if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP' || head.readUInt32LE(4) + 8 !== record.bytes) fail();
      const kind = head.toString('ascii', 12, 16);
      if (kind === 'VP8X') { if (head[20] & 2) fail(); imageDimensions(head.readUIntLE(24, 3) + 1, head.readUIntLE(27, 3) + 1); }
      else if (kind === 'VP8L') { if (head[20] !== 0x2f) fail(); const bits = head.readUInt32LE(21); imageDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
      else if (kind === 'VP8 ') { if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) fail(); imageDimensions(head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff); }
      else fail();
    } else if (extension === '.svg') {
      if (record.bytes > 2 * 1024 * 1024) fail(); validateInertSvg(await handle.readFile(), record.sha256);
    } else if (extension === '.woff2') {
      if (head.toString('ascii', 0, 4) !== 'wOF2' || head.readUInt32BE(8) !== record.bytes) fail();
    } else fail();
  } finally { await handle.close(); }
}

function unavailable(health = 'absent', receipt) {
  return Object.freeze({ status: () => ({ available: false, kind: 'art', health, reason: health === 'absent' ? 'not-selected' : 'invalid-pack',
    ...(receipt ? { id: receipt.id, version: receipt.version } : {}), components: [] }), root: () => null, file: async () => null, files: () => [], expected: () => null, bindings: new Map() });
}

/** Load only the explicit hash-pinned selection. Art failure never selects another pack. */
export async function loadArtPack({ packsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.local', 'packs'), selectionPath = path.join(packsDir, 'selection.json'), selection: injectedSelection } = {}) {
  let selected = false, receipt;
  try {
    let selection = injectedSelection;
    if (selection === undefined) {
      const selectionFile = await safeArtFile(path.dirname(path.resolve(selectionPath)), path.basename(selectionPath));
      const selectionHandle = await open(selectionFile, 'r');
      try { if ((await selectionHandle.stat()).size > 65536) fail(); selection = JSON.parse(await selectionHandle.readFile('utf8')); }
      finally { await selectionHandle.close(); }
    }
    if (selection?.schemaVersion !== 1) fail();
    if (!own(selection, 'art')) return unavailable();
    if (selection.art === null) return unavailable();
    const choice = selection.art;
    selected = true;
    if (!plain(choice) || choice.id !== 'duo-art' || !PACK_VERSION.test(choice.version ?? '') || !digestPattern.test(choice.sha256 ?? '')) fail();
    receipt = { id: choice.id, version: choice.version };
    const packRoot = path.resolve(packsDir, choice.id, choice.version);
    const manifestFile = await safeArtFile(packRoot, 'pack.json');
    const manifestSize = (await lstat(manifestFile)).size;
    if (manifestSize > PACK_LIMITS.manifestBytes) fail();
    const checkedManifest = await readVerified(packRoot, { path: 'pack.json', bytes: manifestSize, sha256: choice.sha256 }, { json: true });
    const manifest = checkedManifest.value, requires = manifest?.requires;
    if (manifest.schemaVersion !== 1 || manifest.id !== choice.id || manifest.kind !== 'art' || manifest.version !== choice.version
      || requires?.corePackApi !== 1 || requires.datasetId !== 'duo-legacy' || requires.datasetContractVersion !== 1 || requires.coordinateSystem !== 'surface-grid-v1'
      || manifest.distribution !== 'private-local' || !plain(manifest.roots) || !Array.isArray(manifest.files)
      || manifest.files.length > PACK_LIMITS.files || !plain(manifest.catalogues)) fail();
    const roots = new Map(), missingRoots = new Set();
    for (const [component, relative] of Object.entries(manifest.roots)) {
      if (!ART_COMPONENTS.includes(component)) fail(); packRelative(relative);
      try { await safeArtFile(path.join(packRoot, relative)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; missingRoots.add(relative); }
      roots.set(component, relative);
    }
    const records = new Map(), missing = new Set(); let total = 0;
    for (const record of manifest.files) {
      packRelative(record?.path);
      if (record.path === 'pack.json' || records.has(record.path) || !Number.isSafeInteger(record.bytes) || record.bytes < 1
        || record.bytes > PACK_LIMITS.fileBytes || !digestPattern.test(record.sha256 ?? '') || !/\.(?:json|png|webp|svg|woff2)$/i.test(record.path)) fail();
      if (record.role !== undefined && (record.role !== 'opaque-manifest'
        || [manifest.catalogues.artBindings, manifest.provenance].includes(record.path)
        || !/(?:^|\/)interiors\.cache-[A-Za-z0-9_-]+\/manifest\.json$/.test(record.path))) fail();
      total += record.bytes; if (total > PACK_LIMITS.totalBytes) fail();
      // Payload paths/types/limits are declared now; image filesystem opens are
      // deferred. Large trees must not incur an ancestor walk per tile at startup.
      // Roots and every eager JSON open still refuse links before activation.
      if ([...missingRoots].some(root => record.path.startsWith(`${root}/`))) missing.add(record.path);
      records.set(record.path, Object.freeze({ ...record }));
    }
    if (!records.has(manifest.catalogues.artBindings) || !records.has(manifest.provenance)) fail();
    const verified = new Map(), jsons = new Map();
    for (const record of records.values()) if (record.path.toLowerCase().endsWith('.json') && record.role !== 'opaque-manifest' && !missing.has(record.path)) {
      try {
        const checked = await readVerified(packRoot, record, { json: true }); verified.set(record.path, checked.fingerprint);
        if (record.path === manifest.catalogues.artBindings) jsons.set(record.path, checked.value);
      } catch (error) {
        if ([manifest.catalogues.artBindings, manifest.provenance].includes(record.path)) throw error;
        missing.add(record.path);
      }
    }
    const catalogue = jsons.get(manifest.catalogues.artBindings);
    if (catalogue?.schemaVersion !== 1 || !Array.isArray(catalogue.bindings)) fail();
    const bindings = new Map();
    for (const binding of catalogue.bindings) {
      if (!plain(binding) || typeof binding.route !== 'string' || !/^\/(?:assets\/|task-item-artwork\.)/.test(binding.route)
        || /[\\?#%\u0000-\u001f]/.test(binding.route) || bindings.has(binding.route) || !roots.has(binding.component)) fail();
      packRelative(binding.relative);
      if (!records.has(`${roots.get(binding.component)}/${binding.relative}`)) fail();
      bindings.set(binding.route, Object.freeze({ component: binding.component, relative: binding.relative }));
    }
    let partial = missing.size > 0;
    const rejected = new Set(missing), pending = new Map();
    const provider = {
      status: () => ({ available: true, kind: 'art', health: partial ? 'partial' : 'healthy', id: manifest.id, version: manifest.version, digest: choice.sha256, components: [...roots.keys()] }),
      root: component => roots.has(component) ? path.join(packRoot, roots.get(component)) : null,
      files: component => roots.has(component) ? [...records.keys()].filter(value => value.startsWith(`${roots.get(component)}/`)).map(value => value.slice(roots.get(component).length + 1)) : [],
      expected: filename => {
        if (typeof filename !== 'string' || !path.isAbsolute(filename)) return null;
        const relative = path.relative(packRoot, filename).split(path.sep).join('/');
        if (!equalPath(path.resolve(packRoot, relative), filename)) return null;
        const record = records.get(relative);
        return record ? Object.freeze({ bytes: record.bytes, sha256: record.sha256 }) : null;
      },
      bindings,
      async file(component, relative) {
        try {
          packRelative(relative); if (!roots.has(component)) return null;
          const key = `${roots.get(component)}/${relative}`, record = records.get(key);
          if (!record || rejected.has(key)) return null;
          const filename = await safeArtFile(packRoot, key);
          if (verified.has(key)) { if (verified.get(key) !== fingerprint(await lstat(filename))) fail(); return filename; }
          if (!pending.has(key)) pending.set(key, (async () => {
            const checked = await readVerified(packRoot, record);
            await validateArtPayload(checked.filename, record);
            await safeArtFile(packRoot, key);
            if (checked.fingerprint !== fingerprint(await lstat(checked.filename))) fail();
            verified.set(key, checked.fingerprint); return checked.filename;
          })());
          return await pending.get(key);
        } catch { partial = true; if (roots.has(component) && typeof relative === 'string') rejected.add(`${roots.get(component)}/${relative}`); return null; }
      },
    };
    return Object.freeze(provider);
  } catch (error) { return unavailable(!selected && error.code === 'ENOENT' ? 'absent' : 'invalid', receipt); }
}
