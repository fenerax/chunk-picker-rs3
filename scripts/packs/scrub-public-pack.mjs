import { lstat, realpath, readdir, readFile, mkdir, writeFile, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetDigest } from '../../app/datasets.mjs';
import { DATASET_DEFINITION_OVERLAYS } from '../../app/dataset-inputs.mjs';
import { packRelative } from '../../app/packs.mjs';

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
    if (result.length > 10000) throw fail('file-limit');
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
  if (manifest?.schemaVersion !== 1 || manifest.id !== (kind === 'data' ? 'duo-data' : 'duo-rules-text')
    || manifest.kind !== kind || manifest.distribution !== 'private-local' || !Array.isArray(manifest.files)
    || manifest.files.length > 10000 || !/^[a-f0-9]{64}$/.test(manifest.ruleContractHash ?? '')) throw fail('manifest');
  const names = new Set(['pack.json']);
  for (const record of manifest.files) {
    packRelative(record?.path);
    if (names.has(record.path.toLowerCase()) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > limit
      || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw fail('record');
    names.add(record.path.toLowerCase());
    const bytes = await payload(root, record.path);
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw fail('receipt');
    if (/\.json$/i.test(record.path)) {
      try { JSON.parse(bytes.toString('utf8')); } catch { throw fail('payload-json'); }
    }
  }
  const actual = await walk(root);
  if (actual.length !== names.size || actual.some(name => !names.has(name.toLowerCase()))) throw fail('unlisted-file');
  return { manifest, manifestSha256: sha(manifestBytes) };
}

// This binding supplies account defaults rather than game facts. Remove it in
// both mirrors, as open-starter does. Do not treat gameplay IDs or map geometry
// as member IDs. Other personal fields must still pass the publisher's scan.
export function scrubPublicDocument(document, relative) {
  const key = 'app/core/game-progress.mjs#defaultRuneScapeNames';
  if (relative !== 'indexes/values.json' && !/^app\/data\/legacy-dataset-values\.[^/]+\.json$/.test(relative))
    return { document, replacements: 0 };
  const bindings = document?.values?.[key];
  if (bindings === undefined) return { document, replacements: 0 };
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)
    || Object.values(bindings).some(value => typeof value !== 'string')) throw fail('account-default-shape');
  const replacements = Object.keys(bindings).length;
  if (replacements) document.values[key] = {};
  return { document, replacements };
}

export async function scrubPublicPack({ inputDir, outputDir, rulesTextDir, version, reportFile, scrub = scrubPublicDocument } = {}) {
  let createdOutput = false, createdReport = false, output, report;
  try {
    if (![inputDir, outputDir, rulesTextDir].every(value => typeof value === 'string' && path.isAbsolute(value))
      || !/^\d+\.\d+\.\d+-public\.\d+$/.test(version ?? '') || typeof scrub !== 'function'
      || (reportFile !== undefined && (typeof reportFile !== 'string' || !path.isAbsolute(reportFile)))) throw fail('usage');
    const input = path.resolve(inputDir), rules = path.resolve(rulesTextDir);
    output = path.resolve(outputDir); report = reportFile && path.resolve(reportFile);
    await absentOutput(output, [repository, input, rules]);
    if (report) await absentOutput(report, [repository, input, rules, output]);
    const source = await readPack(input, 'data'), text = await readPack(rules, 'rules-text');
    if (source.manifest.ruleContractHash !== text.manifest.ruleContractHash) throw fail('rules-contract');
    const overlays = [[], DATASET_DEFINITION_OVERLAYS].find(candidate => datasetDigest(
      [...source.manifest.files, ...text.manifest.files], source.manifest.capabilities, candidate) === source.manifest.datasetDigest);
    if (!overlays) throw fail('source-digest');
    const manifest = structuredClone(source.manifest), changes = [];
    manifest.version = version;
    await mkdir(path.dirname(output), { recursive: true });
    await checked(path.dirname(output), true);
    await mkdir(output); createdOutput = true;
    for (const record of manifest.files) {
      let bytes = await payload(input, record.path);
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw fail('input-changed');
      if (/\.json$/i.test(record.path)) {
        const document = JSON.parse(bytes.toString('utf8')), before = JSON.stringify(document);
        const result = await scrub(document, record.path);
        if (!result || !Object.hasOwn(result, 'document') || !Number.isSafeInteger(result.replacements) || result.replacements < 0) throw fail('scrub-result');
        if (JSON.stringify(result.document) !== before) {
          if (!result.replacements) throw fail('scrub-result');
          bytes = Buffer.from(encode(result.document));
          if (bytes.length > limit) throw fail('file-limit');
          changes.push({ path: record.path, kind: record.kind, replacements: result.replacements });
        } else if (result.replacements) throw fail('scrub-result');
      }
      const target = path.join(output, ...record.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await checked(path.dirname(target), true);
      await writeFile(target, bytes, { flag: 'wx' });
      record.bytes = bytes.length; record.sha256 = sha(bytes);
    }
    // Inputs are never mutated; refuse any changed manifest before finalizing.
    if (sha(await payload(input, 'pack.json')) !== source.manifestSha256
      || sha(await payload(rules, 'pack.json')) !== text.manifestSha256) throw fail('input-changed');
    manifest.datasetDigest = datasetDigest([...manifest.files, ...text.manifest.files], manifest.capabilities, overlays);
    const manifestBytes = Buffer.from(encode(manifest));
    await writeFile(path.join(output, 'pack.json'), manifestBytes, { flag: 'wx' });
    const receipt = { schemaVersion: 1, changes, files: manifest.files.length, packSha256: sha(manifestBytes), datasetDigest: manifest.datasetDigest };
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
  const flags = { '--input': 'inputDir', '--output': 'outputDir', '--rules-text-pack': 'rulesTextDir', '--version': 'version', '--report': 'reportFile' }, options = {};
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
