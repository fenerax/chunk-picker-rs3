import { lstat, realpath, readdir, readFile, mkdir, writeFile, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { datasetDigest } from '../../app/datasets.mjs';
import { DATASET_DEFINITION_OVERLAYS } from '../../app/dataset-inputs.mjs';
import { packRelative, PACK_VERSION } from '../../app/packs.mjs';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { hasPackHomePath } from '../secret-scan/pack-patterns.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const limit = 128 * 1024 ** 2;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const ownFailure = Symbol('public-pack-scrub-failure');
const fail = category => Object.assign(new Error(`Public pack scrub refused (${category}).`), { category, [ownFailure]: true });
const within = (root, file) => { const rel = path.relative(root, file); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
const protectedPath = file => /(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(file);

async function checked(file, directory = false) {
  const absolute = path.resolve(file);
  if (protectedPath(absolute)) throw fail('protected-path');
  let cursor = path.parse(absolute).root;
  for (const segment of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || (cursor !== absolute && !stat.isDirectory())) throw fail('linked-path');
  }
  if (path.resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw fail('linked-path');
  const stat = await lstat(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1 || stat.size > limit) throw fail('input-type');
  return absolute;
}

async function payload(root, relative) {
  packRelative(relative);
  const file = await checked(path.join(root, ...relative.split('/')));
  const before = await lstat(file), bytes = await readFile(file), after = await lstat(await checked(file));
  if (bytes.length > limit || bytes.length !== before.size || before.size !== after.size
    || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail('input-changed');
  return bytes;
}

async function walk(root, relative = '', result = []) {
  for (const entry of await readdir(await checked(path.join(root, relative), true), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    packRelative(name);
    if (entry.isSymbolicLink()) throw fail('linked-path');
    if (entry.isDirectory()) await walk(root, name, result);
    else if (entry.isFile()) result.push(name);
    else throw fail('input-type');
    if (result.length > 50001) throw fail('file-limit');
  }
  return result.sort();
}

async function absentOutput(file, roots) {
  if (protectedPath(file) || roots.some(root => within(root, file) || within(file, root))) throw fail('output-location');
  try { await lstat(file); throw fail('output-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let ancestor = path.dirname(file);
  while (true) {
    try { await checked(ancestor, true); break; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

async function readPack(root, kind) {
  await checked(root, true);
  const manifestBytes = await payload(root, 'pack.json');
  let manifest;
  try { manifest = JSON.parse(manifestBytes); } catch { throw fail('manifest-json'); }
  if (manifest?.schemaVersion !== 1 || manifest.id !== ({ data: 'duo-data', 'rules-text': 'duo-rules-text', art: 'duo-art' })[kind]
    || manifest.kind !== kind || manifest.distribution !== 'private-local' || !Array.isArray(manifest.files)
    || manifest.files.length > (kind === 'art' ? 50000 : 10000)
    || (kind !== 'art' && !/^[a-f0-9]{64}$/.test(manifest.ruleContractHash ?? ''))) throw fail('manifest');
  const names = new Set(['pack.json']);
  for (const record of manifest.files) {
    packRelative(record?.path);
    if (hasPackHomePath(record.path)) throw fail('home-path-key');
    if (names.has(record.path.toLowerCase()) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > limit
      || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw fail('record');
    names.add(record.path.toLowerCase());
    const bytes = await payload(root, record.path);
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw fail('receipt');
    if (jsonFile(record.path)) parseDocument(bytes, record.path);
  }
  const actual = await walk(root);
  if (actual.length !== names.size || actual.some(name => !names.has(name.toLowerCase()))) throw fail('unlisted-file');
  return { manifest, manifestSha256: sha(manifestBytes) };
}

const jsonFile = relative => /\.json(?:\.gz)?$/i.test(relative);
const jsonBytes = (bytes, relative) => /\.gz$/i.test(relative) ? gunzipSync(bytes, { maxOutputLength: limit }) : bytes;
function parseDocument(bytes, relative) {
  try { return JSON.parse(jsonBytes(bytes, relative).toString('utf8')); }
  catch { throw fail('payload-json'); }
}
function encodeDocument(document, relative) {
  const expanded = Buffer.from(encode(document));
  if (expanded.length > limit) throw fail('file-limit');
  const bytes = /\.gz$/i.test(relative) ? gzipSync(expanded, { level: 9 }) : expanded;
  if (bytes.length > limit) throw fail('file-limit');
  return bytes;
}

// Remove provenance home strings wholesale, and remove account defaults only
// at the two reviewed mirror locations. Gameplay identifiers stay intact.
export function scrubPublicDocument(document, relative) {
  const key = 'app/core/game-progress.mjs#defaultRuneScapeNames';
  let replacements = 0;
  if (relative === 'indexes/values.json' || /^app\/data\/legacy-dataset-values\.[^/]+\.json$/.test(relative)) {
    const bindings = document?.values?.[key];
    if (bindings !== undefined) {
      if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)
        || Object.values(bindings).some(value => typeof value !== 'string')) throw fail('account-default-shape');
      replacements += Object.keys(bindings).length;
      if (Object.keys(bindings).some(hasPackHomePath)) throw fail('home-path-key');
      if (Object.keys(bindings).length) document.values[key] = {};
    }
  }
  const holder = { value: document }, pending = [holder];
  while (pending.length) {
    const object = pending.pop();
    for (const field of Object.keys(object)) {
      if (hasPackHomePath(field)) throw fail('home-path-key');
      const value = object[field];
      if (typeof value === 'string' && hasPackHomePath(value)) { object[field] = 'redacted-local-source'; replacements++; }
      else if (value !== null && typeof value === 'object') pending.push(value);
    }
  }
  return { document: holder.value, replacements };
}

function hashTransitions() {
  const changes = new Map();
  const resolve = value => {
    const visited = new Set(); let current = value, bytes, oldBytes;
    while (changes.has(current)) {
      if (visited.has(current)) throw fail('hash-cycle');
      visited.add(current);
      const next = changes.get(current);
      oldBytes ??= next.oldBytes; bytes = next.bytes; current = next.sha256;
    }
    return current === value ? null : { sha256: current, bytes, oldBytes };
  };
  const add = (oldHash, newHash, oldBytes, bytes) => {
    if (oldHash === newHash) return;
    const existing = resolve(oldHash), target = resolve(newHash);
    const finalHash = target?.sha256 ?? newHash;
    if (finalHash === oldHash) throw fail('hash-cycle');
    if (existing && existing.sha256 !== finalHash) throw fail('ambiguous-hash');
    if (!existing) changes.set(oldHash, { sha256: newHash, oldBytes, bytes });
  };
  const remember = (before, after, relative) => {
    add(sha(before), sha(after), before.length, after.length);
    if (jsonFile(relative)) {
      const oldText = jsonBytes(before, relative), newText = jsonBytes(after, relative);
      add(sha(oldText), sha(newText), oldText.length, newText.length);
      const normalizedLength = bytes => {
        let length = bytes.length;
        for (let index = 0; index + 1 < bytes.length; index++) if (bytes[index] === 13 && bytes[index + 1] === 10) length--;
        return length;
      };
      add(sha256RepositoryText(oldText), sha256RepositoryText(newText), normalizedLength(oldText), normalizedLength(newText));
    }
  };
  const repair = document => {
    const holder = { value: document }, pending = [holder]; let replacements = 0;
    while (pending.length) {
      const object = pending.pop();
      // Only paired receipt sizes are changed; arbitrary numeric game data is
      // never inferred to be a payload size.
      const pairedHash = typeof object.sha256 === 'string' ? /^(?:sha256:)?([a-f0-9]{64})$/i.exec(object.sha256) : null;
      if (pairedHash) {
        const next = resolve(pairedHash[1].toLowerCase());
        if (next && Number.isSafeInteger(object.bytes) && object.bytes === next.oldBytes) object.bytes = next.bytes;
      }
      for (const field of Object.keys(object)) {
        const value = object[field];
        if (typeof value === 'string') {
          const match = /^(sha256:)?([a-f0-9]{64})$/i.exec(value);
          if (match) {
            const next = resolve(match[2].toLowerCase());
            if (next) { object[field] = (match[1] ? 'sha256:' : '') + next.sha256; replacements++; }
          }
        } else if (value !== null && typeof value === 'object') pending.push(value);
      }
    }
    return { document: holder.value, replacements };
  };
  return { remember, repair };
}

export async function scrubPublicPack({ inputDir, outputDir, rulesTextDir, version, reportFile, kind = 'data', scrub = scrubPublicDocument } = {}) {
  let createdOutput = false, createdReport = false, output, report;
  try {
    if (!['data', 'art'].includes(kind)
      || ![inputDir, outputDir, ...(kind === 'data' ? [rulesTextDir] : [])].every(value => typeof value === 'string' && path.isAbsolute(value))
      || !PACK_VERSION.test(version ?? '') || !/-public\.\d+$/.test(version ?? '') || typeof scrub !== 'function'
      || (kind === 'art' && rulesTextDir !== undefined)
      || (reportFile !== undefined && (typeof reportFile !== 'string' || !path.isAbsolute(reportFile)))) throw fail('usage');
    const input = path.resolve(inputDir), rules = kind === 'data' ? path.resolve(rulesTextDir) : null;
    output = path.resolve(outputDir); report = reportFile && path.resolve(reportFile);
    const protectedRoots = [repository, input, ...(rules ? [rules] : [])];
    await absentOutput(output, protectedRoots);
    if (report) await absentOutput(report, [...protectedRoots, output]);
    const source = await readPack(input, kind), text = rules ? await readPack(rules, 'rules-text') : null;
    let overlays;
    if (kind === 'data') {
      if (source.manifest.ruleContractHash !== text.manifest.ruleContractHash) throw fail('rules-contract');
      overlays = [[], DATASET_DEFINITION_OVERLAYS].find(candidate => datasetDigest(
        [...source.manifest.files, ...text.manifest.files], source.manifest.capabilities, candidate) === source.manifest.datasetDigest);
      if (!overlays) throw fail('source-digest');
    }
    let manifest = structuredClone(source.manifest);
    const changes = new Map(), transitions = hashTransitions();
    const note = (relative, fileKind, replacements = 0, hashReferences = 0) => {
      if (!replacements && !hashReferences) return;
      const row = changes.get(relative) ?? { path: relative, kind: fileKind, replacements: 0, hashReferences: 0 };
      row.replacements += replacements; row.hashReferences += hashReferences; changes.set(relative, row);
    };
    const transform = async (document, relative) => {
      if (scrub === scrubPublicDocument) {
        const result = scrubPublicDocument(document, relative);
        return { ...result, changed: result.replacements > 0 };
      }
      const before = JSON.stringify(document), result = await scrub(document, relative);
      if (!result || !Object.hasOwn(result, 'document') || !Number.isSafeInteger(result.replacements) || result.replacements < 0) throw fail('scrub-result');
      const changed = JSON.stringify(result.document) !== before;
      if (changed !== Boolean(result.replacements)) throw fail('scrub-result');
      return { ...result, changed };
    };
    // The optional recipe applies to payload documents; manifest structure is
    // controlled here and receives only the built-in provenance cleanup.
    const manifestClean = scrubPublicDocument(manifest, 'pack.json');
    manifest = manifestClean.document;
    note('pack.json', 'manifest', manifestClean.replacements);
    manifest.version = version;
    await mkdir(path.dirname(output), { recursive: true });
    await checked(path.dirname(output), true);
    await mkdir(output); createdOutput = true;
    for (const record of manifest.files) {
      const before = await payload(input, record.path);
      if (before.length !== record.bytes || sha(before) !== record.sha256) throw fail('input-changed');
      let bytes = before;
      if (jsonFile(record.path)) {
        const result = await transform(parseDocument(before, record.path), record.path);
        if (result.changed) {
          bytes = encodeDocument(result.document, record.path);
          transitions.remember(before, bytes, record.path);
          note(record.path, record.kind ?? kind, result.replacements);
        }
      }
      const target = path.join(output, ...record.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await checked(path.dirname(target), true);
      await writeFile(target, bytes, { flag: 'wx' });
      record.bytes = bytes.length; record.sha256 = sha(bytes);
    }
    // Sequential passes repair nested receipts after their payloads change.
    // Intermediate hashes remain in the transition table, so a reference from
    // an earlier pass follows the entire chain to its latest receipt.
    let settled = false;
    for (let pass = 0; pass < 16; pass++) {
      let changed = false;
      for (const record of manifest.files) {
        if (!jsonFile(record.path)) continue;
        const before = await payload(output, record.path);
        const result = transitions.repair(parseDocument(before, record.path));
        if (!result.replacements) continue;
        const bytes = encodeDocument(result.document, record.path);
        transitions.remember(before, bytes, record.path);
        await writeFile(await checked(path.join(output, ...record.path.split('/'))), bytes);
        record.bytes = bytes.length; record.sha256 = sha(bytes);
        note(record.path, record.kind ?? kind, 0, result.replacements); changed = true;
      }
      if (!changed) { settled = true; break; }
    }
    if (!settled) throw fail('hash-repair-limit');
    const repairedManifest = transitions.repair(manifest);
    manifest = repairedManifest.document;
    note('pack.json', 'manifest', 0, repairedManifest.replacements);
    // Inputs are never mutated; refuse any changed manifest before finalizing.
    if (sha(await payload(input, 'pack.json')) !== source.manifestSha256
      || (rules && sha(await payload(rules, 'pack.json')) !== text.manifestSha256)) throw fail('input-changed');
    if (kind === 'data') manifest.datasetDigest = datasetDigest([...manifest.files, ...text.manifest.files], manifest.capabilities, overlays);
    if (manifest.ruleContractHash !== source.manifest.ruleContractHash) throw fail('rules-contract');
    for (const record of manifest.files) {
      const bytes = await payload(output, record.path);
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw fail('repaired-receipt');
    }
    const manifestBytes = Buffer.from(encode(manifest));
    await writeFile(path.join(output, 'pack.json'), manifestBytes, { flag: 'wx' });
    const receipt = { schemaVersion: 1, changes: [...changes.values()], files: manifest.files.length, packSha256: sha(manifestBytes),
      ...(kind === 'data' ? { datasetDigest: manifest.datasetDigest } : {}) };
    if (report) {
      await mkdir(path.dirname(report), { recursive: true }); await checked(path.dirname(report), true);
      const handle = await open(report, 'wx'); createdReport = true;
      try { await handle.writeFile(encode(receipt)); } finally { await handle.close(); }
    }
    return receipt;
  } catch (error) {
    if (createdReport) await rm(report, { force: true }).catch(() => {});
    if (createdOutput) await checked(output, true).then(() => rm(output, { recursive: true, force: true })).catch(() => {});
    throw fail(error?.[ownFailure] ? error.category : 'invalid-input');
  }
}

export function parseArgs(args) {
  const flags = { '--input': 'inputDir', '--output': 'outputDir', '--rules-text-pack': 'rulesTextDir', '--version': 'version', '--report': 'reportFile', '--kind': 'kind' }, options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = flags[args[i]];
    if (!key || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw fail('usage');
    options[key] = args[i + 1];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await scrubPublicPack(parseArgs(process.argv.slice(2))); console.log(JSON.stringify({ files: result.files, changed: result.changes.length })); }
  catch (error) { console.error(`Public pack scrub refused (${error.category ?? 'invalid-input'}).`); process.exitCode = 1; }
}
