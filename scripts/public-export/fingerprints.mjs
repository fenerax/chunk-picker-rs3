import { createHmac, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blocked, noLinks, repositoryRoot, stableJSON } from './common.mjs';

export const defaultCorpusDir = path.join(repositoryRoot, '.local/export-gate');
export const normalizationVersion = 'nfkc-fold-path-v1';

export function normalize(value) {
  // Locale-independent Unicode folding, including multi-character folds; retain dotless i.
  return [...value.normalize('NFKC')].map(character => character === '\u0131' ? character : character.toLowerCase().toUpperCase().toLowerCase()).join('')
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
  const expected = createHmac('sha256', key).update(normalizationVersion).digest('hex');
  if (document.keyCheck !== expected) throw blocked('missing-or-invalid-corpus');
  const byLength = new Map(), rollingByLength = new Map();
  for (const row of document.fingerprints) {
    if (!byLength.has(row.length)) byLength.set(row.length, new Set());
    byLength.get(row.length).add(row.digest);
    if (!rollingByLength.has(row.length)) rollingByLength.set(row.length, new Set());
    // A legacy row without a prefilter must still get every HMAC comparison at
    // its length. Re-seeding that value upgrades its row without changing HMAC.
    if (row.rolling === undefined) rollingByLength.set(row.length, null);
    else rollingByLength.get(row.length)?.add(row.rolling);
  }
  return { key, byLength, rollingByLength, rollingBase: rollingBase(key) };
}

export async function loadCorpus(directory = defaultCorpusDir) {
  try {
    await noLinks(directory);
    for (const name of ['key', 'corpus.json']) {
      const file = path.join(directory, name);
      await noLinks(file);
      const info = await lstat(file);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw blocked('missing-or-invalid-corpus');
    }
    return validateCorpus(JSON.parse(await readFile(path.join(directory, 'corpus.json'), 'utf8')), await readFile(path.join(directory, 'key')));
  } catch { throw blocked('missing-or-invalid-corpus'); }
}

export function fingerprintLines(text, corpus) {
  const normalized = normalize(text);
  if (normalized.length * corpus.byLength.size > 5_000_000) throw blocked('scan-limit');
  const lines = new Set();
  for (const [length, digests] of corpus.byLength) {
    if (length > normalized.length) continue;
    const filter = corpus.rollingByLength?.get(length);
    let rolling = filter ? rollingHash(normalized, corpus.rollingBase, length) : 0;
    let outgoingPower = 1;
    if (filter) for (let index = 1; index < length; index++) outgoingPower = Math.imul(outgoingPower, corpus.rollingBase) >>> 0;
    for (let offset = 0; offset <= normalized.length - length; offset++) {
      if (!filter || filter.has(rolling)) {
        // Rolling collisions are expected and are never a match by themselves.
        const digest = createHmac('sha256', corpus.key).update(normalized.slice(offset, offset + length), 'utf8').digest('hex');
        if (digests.has(digest)) lines.add(1 + (normalized.slice(0, offset).match(/\n/g)?.length ?? 0));
      }
      if (filter && offset < normalized.length - length) rolling = (Math.imul(
        (rolling - Math.imul(normalized.charCodeAt(offset) + 1, outgoingPower)) >>> 0, corpus.rollingBase)
        + normalized.charCodeAt(offset + length) + 1) >>> 0;
    }
  }
  return [...lines];
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
    await writeFile(temporary, stableJSON(document), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(directory, 'corpus.json'));
    return document.fingerprints.length;
  } finally {
    if (temporary) await rm(temporary, { force: true });
    await rm(lock, { force: true });
  }
}
