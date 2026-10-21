// Private values the secret scan blocks without knowing them: an HMAC-SHA256
// corpus kept off the repository (default .local/export-gate: `key` plus
// `corpus.json`). Matching never returns or prints a value.
// Add values with scripts/secret-scan/corpus-add.mjs.
import { createHmac, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultCorpusDir = fileURLToPath(new URL('../../.local/export-gate', import.meta.url));
export const normalizationVersion = 'nfkc-fold-path-v1';
export const blocked = category => Object.assign(new Error('blocked, not clean'), { category });

export function normalize(value) {
  // Locale-independent Unicode folding, including multi-character folds; retain dotless i.
  return [...value.normalize('NFKC')].map(character => character === 'ı' ? character : character.toLowerCase().toUpperCase().toLowerCase()).join('')
    .replace(/\\+/g, '/').replace(/\/{2,}/g, '/');
}

function rollingBase(key) {
  return (createHmac('sha256', key).update('export-fingerprint-rolling32-v1').digest().readUInt32LE(0) | 0x101) >>> 0;
}

function rollingHash(text, base, length = text.length) {
  let hash = 0;
  for (let index = 0; index < length; index++) hash = (Math.imul(hash, base) + text.charCodeAt(index) + 1) >>> 0;
  return hash;
}

export function fingerprint(value, key) {
  const normalized = normalize(value);
  return { length: normalized.length, digest: createHmac('sha256', key).update(normalized, 'utf8').digest('hex'),
    rolling: rollingHash(normalized, rollingBase(key)) };
}

export function validateCorpus(document, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || document?.schemaVersion !== 1 || document.normalization !== normalizationVersion
    || !Array.isArray(document.fingerprints) || !document.fingerprints.length || document.fingerprints.length > 10000
    || document.fingerprints.some(row => !Number.isInteger(row.length) || row.length < 1 || row.length > 4096 || !/^[a-f0-9]{64}$/.test(row.digest ?? '')
      || (row.rolling !== undefined && (!Number.isInteger(row.rolling) || row.rolling < 0 || row.rolling > 0xffffffff))))
    throw blocked('missing-or-invalid-corpus');
  if (document.keyCheck !== createHmac('sha256', key).update(normalizationVersion).digest('hex')) throw blocked('missing-or-invalid-corpus');
  const byLength = new Map(), rollingByLength = new Map();
  for (const row of document.fingerprints) {
    if (!byLength.has(row.length)) { byLength.set(row.length, new Set()); rollingByLength.set(row.length, new Set()); }
    byLength.get(row.length).add(row.digest);
    // A row without a prefilter gets every HMAC comparison at its length.
    // Re-adding that value upgrades its row without changing the HMAC.
    if (row.rolling === undefined) rollingByLength.set(row.length, null);
    else rollingByLength.get(row.length)?.add(row.rolling);
  }
  return { key, byLength, rollingByLength, rollingBase: rollingBase(key), maxLength: Math.max(...byLength.keys()) };
}

// Each existing ancestor, including a directory junction on Windows.
async function noLinks(absolutePath) {
  const resolved = path.resolve(absolutePath);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || path.resolve(await realpath(current)).toLowerCase() !== path.resolve(current).toLowerCase()) throw blocked('symlink');
  }
}

export async function loadCorpus(directory = defaultCorpusDir) {
  try {
    await noLinks(directory);
    for (const name of ['key', 'corpus.json']) {
      await noLinks(path.join(directory, name));
      const info = await lstat(path.join(directory, name));
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw blocked('missing-or-invalid-corpus');
    }
    return validateCorpus(JSON.parse(await readFile(path.join(directory, 'corpus.json'), 'utf8')), await readFile(path.join(directory, 'key')));
  } catch { throw blocked('missing-or-invalid-corpus'); }
}

// Line numbers (1-based, of the window start) where a corpus value occurs in
// the normalized text. Any length works: the text is normalized in line-bounded
// pieces and each piece carries the previous piece's tail, so a value that
// spans a line break still matches.
export function fingerprintLines(text, corpus, pieceSize = 1 << 18) {
  const lines = new Set(), tailLength = corpus.maxLength - 1;
  let start = 0, tail = '', tailLine = 1;
  while (start < text.length) {
    let end = Math.min(text.length, start + pieceSize);
    if (end < text.length) { const newline = text.indexOf('\n', end); end = newline === -1 ? text.length : newline + 1; }
    const window = tail + normalize(text.slice(start, end));
    const breaks = [];
    for (let index = window.indexOf('\n'); index !== -1; index = window.indexOf('\n', index + 1)) breaks.push(index);
    const lineAt = offset => { let low = 0, high = breaks.length; while (low < high) { const mid = (low + high) >> 1; if (breaks[mid] < offset) low = mid + 1; else high = mid; } return tailLine + low; };
    for (const [length, digests] of corpus.byLength) {
      if (length > window.length) continue;
      const filter = corpus.rollingByLength.get(length);
      let rolling = filter ? rollingHash(window, corpus.rollingBase, length) : 0, outgoingPower = 1;
      if (filter) for (let index = 1; index < length; index++) outgoingPower = Math.imul(outgoingPower, corpus.rollingBase) >>> 0;
      for (let offset = 0; offset <= window.length - length; offset++) {
        // Rolling collisions are expected and are never a match by themselves.
        if ((!filter || filter.has(rolling)) && digests.has(createHmac('sha256', corpus.key).update(window.slice(offset, offset + length), 'utf8').digest('hex')))
          lines.add(lineAt(offset));
        if (filter && offset < window.length - length) rolling = (Math.imul(
          (rolling - Math.imul(window.charCodeAt(offset) + 1, outgoingPower)) >>> 0, corpus.rollingBase) + window.charCodeAt(offset + length) + 1) >>> 0;
      }
    }
    const kept = Math.min(tailLength, window.length);
    tailLine = lineAt(window.length - kept);
    tail = window.slice(window.length - kept);
    start = end;
  }
  return [...lines].sort((a, b) => a - b);
}

export const hasFingerprint = (text, corpus) => fingerprintLines(text, corpus).length > 0;

// Never returns the input. Values and normalized windows live only in process memory.
export async function addFingerprints(values, directory = defaultCorpusDir) {
  const rows = values.map(value => normalize(value)).filter(value => value.length);
  if (!rows.length || rows.some(value => value.length > 4096)) throw blocked('invalid-fingerprint-input');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await noLinks(directory);
  const lock = path.join(directory, 'write.lock');
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  let temporary;
  try {
    const keyFile = path.join(directory, 'key');
    let key, document;
    try {
      await noLinks(keyFile);
      key = await readFile(keyFile);
      document = JSON.parse(await readFile(path.join(directory, 'corpus.json'), 'utf8'));
      await loadCorpus(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw blocked('missing-or-invalid-corpus');
      // Never replace a surviving key or corpus from an incomplete configuration.
      for (const name of ['key', 'corpus.json']) {
        try { await lstat(path.join(directory, name)); throw blocked('missing-or-invalid-corpus'); }
        catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      }
      key = randomBytes(32);
      await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
      document = { schemaVersion: 1, normalization: normalizationVersion,
        keyCheck: createHmac('sha256', key).update(normalizationVersion).digest('hex'), fingerprints: [] };
    }
    const unique = new Map(document.fingerprints.map(row => [`${row.length}:${row.digest}`, row]));
    for (const value of rows) {
      const row = fingerprint(value, key);
      unique.set(`${row.length}:${row.digest}`, row);
    }
    document.fingerprints = [...unique.values()].sort((a, b) => a.length - b.length || a.digest.localeCompare(b.digest));
    validateCorpus(document, key);
    temporary = path.join(directory, `corpus-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(directory, 'corpus.json'));
    return document.fingerprints.length;
  } finally {
    if (temporary) await rm(temporary, { force: true });
    await rm(lock, { force: true });
  }
}
