#!/usr/bin/env node
// Only the copied-cache files read by the guide test and resource builder.
// Source folders are read-only; scratch and public output live under outputDir.
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, realpath, mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, createGzip, crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPackHomePath } from '../secret-scan/pack-patterns.mjs';
import { inspectText, loadReviewed } from '../secret-scan/scan.mjs';
import { loadCorpus, defaultCorpusDir, fingerprintLines } from '../secret-scan/fingerprints.mjs';
import { readPlacementChunks } from '../build-resource-catalogue.mjs';

export const cacheInputsVersion = '1.0.0-public.1';
export const cacheInputFiles = Object.freeze([
  'objects-2026-10-08-v3/objects.definitions.v1.json.gz',
  'objects-2026-10-08-v3/objects.layouts.v1.json.gz',
  'objects-2026-10-08-v3/objects.manifest.v1.json',
  'objects-2026-10-08-v3/objects.placements.v1.json.gz',
  'objects-2026-10-08-v3/objects.retained-comparison.v1.json.gz',
  'skill-guides-2026-10-08-v1/skill-guides-manifest.v1.json',
  'skill-guides-2026-10-08-v1/skill-guides.v1.json',
  'walkability-masks.cache-audit-2026-10-07-v4/manifest.v1.json',
  'walkability-masks.cache-audit-2026-10-07-v4/membership.v1.json',
  'walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz',
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const fail = category => Object.assign(new Error(`Cache input pack refused (${category}).`), { category });
const within = (root, file) => { const rel = path.relative(root, file); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
const protectedPath = file => /(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(file);
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

async function checked(file, directory = false) {
  const absolute = path.resolve(file);
  if (protectedPath(absolute)) throw fail('protected-path');
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || (cursor !== absolute && !stat.isDirectory())) throw fail('linked-path');
  }
  if (path.resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw fail('linked-path');
  const stat = await lstat(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1) throw fail('input-type');
  return absolute;
}
async function digest(file) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
function scanner(corpus) {
  if (!(corpus?.byLength instanceof Map)) throw fail('missing-corpus');
  const reviewed = loadReviewed();
  return text => {
    // The shared email rule backtracks on long base64 masks. Bound printable
    // runs for pattern matching only; scan fingerprints on the original and
    // decoded text first, so the inserted breaks cannot conceal a private value.
    let decoded = text;
    for (let pass = 0; pass < 2; pass++) decoded = decoded.replace(/\\u\{([a-f0-9]{1,6})\}|\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi, (whole, extended, unicode, hex) => {
      const point = parseInt(extended ?? unicode ?? hex, 16); return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }).replace(/(?:%[a-f0-9]{2})+/gi, value => { try { return decodeURIComponent(value); } catch { return value; } });
    if (fingerprintLines(text, corpus).length || (decoded !== text && fingerprintLines(decoded, corpus).length)) throw fail('private-fingerprint');
    // Do not split a URL away from a later account/token query. Long URLs are
    // not needed by these exports and cannot borrow a reviewed-host exception.
    if ([...decoded.matchAll(/https?:\/\/[^\s"'<>`\\)]+/gi)].some(match => match[0].length > 512)) throw fail('network-identifier');
    const runs = [];
    const shortened = decoded.replace(/[A-Za-z0-9_+/-]{512,}/g, run => {
      for (let offset = 0; offset < run.length; offset += 256) {
        const start = Math.max(0, offset - 64), end = Math.min(run.length, offset + 320);
        // Padding joins artificial boundaries to a long alphabetic run. Without
        // it, slicing a mask can invent a standalone 43-character token.
        runs.push((start ? 'A'.repeat(64) : '') + run.slice(start, end) + (end < run.length ? 'A'.repeat(64) : ''));
      }
      // Preserve binding context (password/player name/etc.) using a neutral
      // mixed value that is neither a placeholder nor a random 43-char token.
      return 'V7a9R2n4Q6b8L1m3';
    });
    const options = { corpus: null, reviewedHosts: reviewed.hosts, placeholders: reviewed.placeholders, escaped: true };
    const found = inspectText(shortened, options).concat(runs.length ? inspectText(runs.join('\n'), options) : []);
    if (hasPackHomePath(text)) throw fail('machine-path');
    if (found.length) throw fail(found[0].category);
  };
}

// A small grammar validator keeps full documents out of memory. String contents
// are decoded only when scrubbing; JSON escapes still validate for every token.
function jsonSyntax(inspectAtom) {
  const stack = []; let root = false, atom = '';
  const keys = new Map();
  const value = () => {
    const top = stack.at(-1);
    if (!top) { if (root) throw fail('payload-json'); root = true; }
    else if (top.kind === '[' && ['value', 'first'].includes(top.state)) top.state = 'comma';
    else if (top.kind === '{' && top.state === 'value') top.state = 'comma';
    else throw fail('payload-json');
  };
  const flush = () => {
    if (!atom) return;
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(atom)) throw fail('payload-json');
    inspectAtom(atom);
    value(); atom = '';
  };
  const plain = text => {
    for (const part of text.matchAll(/\s+|[\[\]{}:,]|[^\s\[\]{}:,]+/g)) {
      const token = part[0];
      if (!/^[\s\[\]{}:,]/.test(token)) { atom += token; if (atom.length > 128) throw fail('payload-json'); continue; }
      flush();
      if (/^\s/.test(token)) continue;
      const top = stack.at(-1);
      if (token === '[' || token === '{') { value(); stack.push({ kind: token, state: 'first' }); }
      else if (token === ']' || token === '}') {
        if (!top || top.kind !== (token === ']' ? '[' : '{') || !['first', 'comma'].includes(top.state)) throw fail('payload-json');
        stack.pop();
      } else if (token === ':') {
        if (top?.kind !== '{' || top.state !== 'colon') throw fail('payload-json'); top.state = 'value';
      } else {
        if (!top || top.state !== 'comma') throw fail('payload-json'); top.state = top.kind === '[' ? 'value' : 'key';
      }
    }
  };
  const string = token => {
    flush();
    if (!/^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[a-f0-9]{4}))*"$/i.test(token)) throw fail('payload-json');
    const top = stack.at(-1), key = top?.kind === '{' && ['first', 'key'].includes(top.state);
    if (key) {
      if (!keys.has(token)) { if (keys.size >= 10000) keys.clear(); keys.set(token, JSON.parse(token)); }
      top.key = keys.get(token); top.state = 'colon';
    } else value();
    return key;
  };
  return { plain, string, path: () => stack.map(frame => frame.key).filter(key => key !== undefined),
    finish() { flush(); if (!root || stack.length) throw fail('payload-json'); } };
}

// Personal values live in JSON scalars and keys. Scan their complete decoded
// values with the enclosing property names, rather than treating billions of
// repeated numeric tiles as prose. Caches are bounded and include context, so a
// harmless label cannot exempt the same value in an account-name field.
function valueScanner(corpus, scan) {
  const seen = new Set(); let identifiers = '';
  const remember = value => {
    if (seen.has(value)) return false;
    if (seen.size >= 50000) seen.clear();
    seen.add(value); return true;
  };
  const flush = () => {
    if (identifiers && fingerprintLines(identifiers, corpus).length) throw fail('private-fingerprint');
    identifiers = '';
  };
  const atom = value => { if (remember('atom:' + value) && fingerprintLines(value, corpus).length) throw fail('private-fingerprint'); };
  const string = (token, key, keys) => {
    if (key) { if (remember('key:' + token)) scan(token); return; }
    // These generated IDs have no email/host/name/token syntax. They still
    // receive the private-fingerprint check, and only at ordinary object IDs.
    if (['id', 'sourceId'].includes(keys.at(-1)) && !keys.some(part => /player|account|member|owner|identity/i.test(part))
      && /^"object-[a-f0-9]{24}(?:@\d+(?::\d+)+)?"$/.test(token)) {
      identifiers += token + '\n'; if (identifiers.length >= 128 * 1024) flush(); return;
    }
    const signature = JSON.stringify(keys) + ':' + token;
    if (!remember(signature)) return;
    let document = JSON.parse(token);
    for (let index = keys.length - 1; index >= 0; index--) document = { [keys[index]]: document };
    scan(JSON.stringify(document));
  };
  return { atom, string, flush };
}

function parsedVisitor(inspect, receipt) {
  const encodedKeys = new Map(), atoms = new Set();
  const visit = (document, keys = []) => {
    for (const field of Object.keys(document)) {
      const array = Array.isArray(document);
      if (!array) {
        if (!encodedKeys.has(field)) {
          if (encodedKeys.size >= 10000) encodedKeys.clear();
          if (hasPackHomePath(field)) throw fail('home-path-key');
          encodedKeys.set(field, JSON.stringify(field));
          inspect.string(encodedKeys.get(field), true);
        }
      }
      let value = document[field];
      if (typeof value === 'string') {
        const location = array ? keys : [...keys, field];
        if (/users|home|userprofile|\\u|\\x|%/i.test(value) && hasPackHomePath(value)) {
          value = `[redacted-path]/${value.replaceAll('\\', '/').split('/').at(-1)}`;
          document[field] = value; receipt.replacements++;
        }
        inspect.string(JSON.stringify(value), false, location);
      } else if (value && typeof value === 'object') visit(value, array ? keys : [...keys, field]);
      else if (!atoms.has(value)) {
        if (atoms.size >= 50000) atoms.clear();
        inspect.atom(JSON.stringify(value)); atoms.add(value);
      }
    }
    return document;
  };
  return visit;
}

// The authentic placement export is compact and has millions of bounded rows.
// Reuse the builder's delimiter/count validator and native JSON parser, rather
// than allocating a JavaScript grammar token for every numeric tile field.
async function* scrubPlacements(chunks, inspect, receipt) {
  const visit = parsedVisitor(inspect, receipt);
  let prefix, tail = '', output = '', first = true;
  const parse = text => {
    try {
      const document = JSON.parse(text), canonical = JSON.stringify(document);
      // Native parsing must not hide overwritten duplicate keys or rounded
      // numeric literals while we retain the original row bytes. The exporter
      // uses JSON.stringify; harmless whitespace between tokens is accepted.
      if (text !== canonical && text.replace(/("(?:[^"\\]|\\.)*")|\s+/g, (whole, string) => string ?? '') !== canonical) throw fail('payload-json');
      return document;
    } catch { throw fail('payload-json'); }
  };
  async function* tracked() {
    for await (const chunk of chunks) {
      if (prefix === undefined) {
        const end = chunk.indexOf('"placements":[');
        if (end < 0) throw fail('placement-prefix');
        prefix = chunk.slice(0, end);
      }
      tail = (tail + chunk).slice(-1024 * 1024);
      yield chunk;
    }
  }
  for await (const text of readPlacementChunks(tracked())) {
    if (first) {
      const head = visit(parse(prefix.replace(/,\s*$/, '') + '}'));
      output = JSON.stringify(head).slice(0, -1) + ',"placements":[';
    }
    const before = receipt.replacements, row = parse(text);
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id.startsWith('object-')) throw fail('payload-json');
    visit(row);
    output += (first ? '' : ',') + (receipt.replacements === before ? text : JSON.stringify(row));
    first = false;
    if (output.length >= 256 * 1024) { yield output; output = ''; }
  }
  if (first) {
    const head = visit(parse(prefix.replace(/,\s*$/, '') + '}'));
    output = JSON.stringify(head).slice(0, -1) + ',"placements":[';
  }
  const end = tail.lastIndexOf('],"summary":');
  if (end < 0) throw fail('placement-summary');
  const summary = visit(parse('{' + tail.slice(end + 2)));
  inspect.flush();
  yield output + '],' + JSON.stringify(summary).slice(1);
}

async function gzipHeader(file) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(10), trailer = Buffer.alloc(8), stat = await handle.stat();
    await handle.read(head, 0, 10, 0); await handle.read(trailer, 0, 8, stat.size - 8);
    // No names, comments, extra fields, timestamps or concatenated members can
    // bypass the expanded JSON scan. The compressed body length is checked too.
    if (head[0] !== 31 || head[1] !== 139 || head[2] !== 8 || head[3] !== 0) throw fail('gzip-metadata');
    return { trailer, bytes: stat.size };
  } finally { await handle.close(); }
}

// JSON strings are bounded independently of the document. Neither JSON.parse
// nor the scanner receives the large placement export whole.
// Preserve all bytes except complete home-path string values. A home path used
// as an object key is unsafe to rename and is refused.
async function scrubFile(source, target, scan, corpus) {
  const compressed = source.endsWith('.gz'), gzip = compressed && await gzipHeader(source);
  const input = createReadStream(source, compressed ? { start: 10 } : {}), decoded = compressed ? input.pipe(createInflateRaw()) : input;
  decoded.setEncoding('utf8');
  let pending = '', output = '', replacements = 0, crc = 0, expandedBytes = 0;
  const inspect = valueScanner(corpus, scan), syntax = jsonSyntax(inspect.atom);
  async function* textChunks() {
    for await (const chunk of decoded) {
      if (compressed) { const bytes = Buffer.from(chunk); crc = crc32(bytes, crc); expandedBytes += bytes.length; }
      yield chunk;
    }
  }
  const allChunks = textChunks(), firstChunk = await allChunks.next();
  async function* prefetched() { if (!firstChunk.done) yield firstChunk.value; yield* allChunks; }
  async function* transformed() {
    if (source.endsWith('objects.placements.v1.json.gz') && firstChunk.value?.includes('"placements":[')) {
      const receipt = { replacements: 0 };
      try { yield* scrubPlacements(prefetched(), inspect, receipt); }
      catch (error) { throw fail(error.category ?? 'payload-json'); }
      replacements = receipt.replacements;
    } else {
      for await (const chunk of prefetched()) {
        pending += chunk;
        let at = 0; const pieces = [];
        const plain = text => { syntax.plain(text); pieces.push(text); };
        while (at < pending.length) {
          const start = pending.indexOf('"', at);
          if (start < 0) { plain(pending.slice(at)); at = pending.length; break; }
          let end = start + 1;
          for (; end < pending.length; end++) {
            if (pending[end] === '\\') end++;
            else if (pending[end] === '"') break;
          }
          if (end >= pending.length) { plain(pending.slice(at, start)); at = start; break; }
          const token = pending.slice(start, end + 1);
          plain(pending.slice(at, start)); const key = syntax.string(token);
          let clean = token;
          if (/users|home|userprofile|\\u|\\x|%/i.test(token)) {
            let value;
            try { value = JSON.parse(token); } catch { throw fail('payload-json'); }
            if (hasPackHomePath(value)) {
              if (key) throw fail('home-path-key');
              // Receipts identify outputs by basename, including the guide test.
              const basename = value.replaceAll('\\', '/').split('/').at(-1);
              clean = JSON.stringify(`[redacted-path]/${basename}`); replacements++;
              if (hasPackHomePath(clean)) throw fail('machine-path');
            }
          }
          inspect.string(clean, key, key ? undefined : syntax.path());
          pieces.push(clean); at = end + 1;
        }
        output += pieces.join('');
        pending = pending.slice(at);
        if (pending.length > 1024 * 1024) throw fail('json-string-limit');
        if (output.length >= 256 * 1024) {
          yield output; output = '';
        }
      }
      // A final root string is not one of these exported JSON documents.
      if (pending.includes('"')) throw fail('payload-json');
      syntax.plain(pending); syntax.finish(); inspect.flush(); output += pending;
      if (output) yield output;
    }
    if (compressed && (gzip.bytes !== 10 + decoded.bytesWritten + 8 || crc !== gzip.trailer.readUInt32LE(0)
      || (expandedBytes >>> 0) !== gzip.trailer.readUInt32LE(4))) throw fail('gzip-integrity');
  }
  try {
    const streams = [Readable.from(transformed())];
    if (source.endsWith('.gz')) streams.push(createGzip({ level: 9 }));
    streams.push(createWriteStream(target, { flags: 'wx' }));
    await pipeline(...streams);
  } finally { input.destroy(); decoded.destroy(); }
  // Preserve the original compression and hashes for unchanged game masks.
  if (!replacements) await copyFile(source, target);
  return replacements;
}

function repairReceipts(document, transitions) {
  let replacements = 0;
  const walk = object => {
    const paired = typeof object.sha256 === 'string' && transitions.get(object.sha256);
    if (paired && object.bytes === paired.oldBytes) object.bytes = paired.bytes;
    for (const key of Object.keys(object)) {
      const value = object[key];
      if (typeof value === 'string') {
        const match = /^(sha256:)?([a-f0-9]{64})$/.exec(value), next = match && transitions.get(match[2]);
        if (next) { object[key] = (match[1] ?? '') + next.sha256; replacements++; }
      } else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(document); return replacements;
}
function tarHeader(name, bytes) {
  const header = Buffer.alloc(512), slash = name.lastIndexOf('/');
  const leaf = name.length <= 100 ? name : name.slice(slash + 1), prefix = name.length <= 100 ? '' : name.slice(0, slash);
  if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155 || bytes > 0o77777777777) throw fail('tar-limit');
  header.write(leaf, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write(bytes.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263); header.write(prefix, 345, 155);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148); return header;
}
async function archive(files, output) {
  async function* contents() {
    for (const file of files) {
      yield tarHeader(file.name, file.bytes);
      yield* createReadStream(file.source);
      if (file.bytes % 512) yield Buffer.alloc(512 - file.bytes % 512);
    }
    yield Buffer.alloc(1024);
  }
  await pipeline(Readable.from(contents()), createGzip({ level: 9 }), createWriteStream(output, { flags: 'wx' }));
}

export async function buildCacheInputsPack({ outputDir, gameDataDir = process.env.RS3_CACHE_INPUTS_SOURCE_DIR ?? process.env.RS3_GAME_DATA_DIR ?? 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data', corpus } = {}) {
  let scratch;
  try {
    if (typeof outputDir !== 'string' || !outputDir || typeof gameDataDir !== 'string' || !gameDataDir) throw fail('usage');
    const root = await checked(gameDataDir, true), out = path.resolve(outputDir), scan = scanner(corpus);
    if (protectedPath(out) || within(root, out) || within(out, root)) throw fail('output-location');
    // Refuse a linked existing ancestor before mkdir can follow it.
    let ancestor = out;
    while (true) {
      try { await checked(ancestor, true); break; } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    await mkdir(out, { recursive: true }); await checked(out, true);
    const filename = `cache-inputs-${cacheInputsVersion}.tar.gz`, destination = path.join(out, filename);
    for (const file of [destination, destination + '.sha256']) {
      try { await lstat(file); throw fail('output-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    scratch = await mkdtemp(path.join(out, '.cache-inputs-'));
    const records = [], transitions = new Map(); let redactions = 0;
    for (const name of cacheInputFiles) {
      const source = await checked(path.join(root, name)), before = await lstat(source), original = await digest(source);
      const target = path.join(scratch, name); await mkdir(path.dirname(target), { recursive: true });
      redactions += await scrubFile(source, target, scan, corpus);
      if (fingerprint(before) !== fingerprint(await lstat(await checked(source)))) throw fail('input-changed');
      const clean = await digest(target);
      if (original.sha256 !== clean.sha256) transitions.set(original.sha256, { ...clean, oldBytes: original.bytes });
      records.push({ name, source, target, original, ...clean });
    }
    // The three small manifests carry the changed output hashes. Payloads are
    // independent exports; no gameplay field or cache archive hash is inferred.
    for (const record of records.filter(row => /manifest\.v1\.json$/.test(row.name))) {
      const original = JSON.parse(await readFile(record.source));
      for (const output of original.outputs ?? []) {
        const sibling = records.find(row => row.name === path.posix.dirname(record.name) + '/' + path.posix.basename(output.path.replaceAll('\\', '/')));
        if (sibling && (sibling.original.sha256 !== output.sha256 || (output.bytes !== undefined && sibling.original.bytes !== output.bytes))) throw fail('source-receipt');
      }
      const document = JSON.parse(await readFile(record.target));
      if (repairReceipts(document, transitions)) {
        const bytes = Buffer.from(encode(document)); scan(bytes.toString()); await writeFile(record.target, bytes);
        Object.assign(record, await digest(record.target));
      }
    }
    // Recheck sources before publishing; the source folders are never written.
    for (const record of records) if ((await digest(record.source)).sha256 !== record.original.sha256) throw fail('input-changed');
    const manifest = { schemaVersion: 1, id: 'cache-inputs', version: cacheInputsVersion, distribution: 'public',
      files: records.map(({ name, bytes, sha256 }) => ({ path: `local-game/${name}`, bytes, sha256 })) };
    const manifestBytes = Buffer.from(encode(manifest)); scan(manifestBytes.toString());
    const manifestFile = path.join(scratch, 'pack.json'); await writeFile(manifestFile, manifestBytes);
    const prefix = `cache-inputs/${cacheInputsVersion}/`;
    const files = [{ name: prefix + 'pack.json', source: manifestFile, bytes: manifestBytes.length },
      ...records.map(row => ({ name: prefix + 'local-game/' + row.name, source: row.target, bytes: row.bytes }))].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const temporary = path.join(scratch, filename); await archive(files, temporary);
    const receipt = { filename, ...await digest(temporary), manifestSha256: sha(manifestBytes), files: records.length, redactions };
    // Nothing is published until every payload, path and repaired receipt passes.
    await rename(temporary, destination);
    await writeFile(destination + '.sha256', `${receipt.sha256}  ${filename}\n`, { flag: 'wx' });
    return receipt;
  } catch (error) { throw fail(error.category ?? 'invalid-input'); }
  finally {
    if (scratch && within(path.resolve(outputDir), path.resolve(scratch)) && path.dirname(scratch) === path.resolve(outputDir)) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw fail('usage');
    const corpus = await loadCorpus(process.env.SECRET_SCAN_CORPUS ?? defaultCorpusDir);
    console.log(JSON.stringify(await buildCacheInputsPack({ outputDir: process.argv[2], corpus })));
  } catch (error) { console.error(`Cache input pack refused (${error.category ?? 'invalid-input'}).`); process.exitCode = 1; }
}
