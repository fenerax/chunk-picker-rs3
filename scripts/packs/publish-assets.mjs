// Default: prepare a reviewed plan locally. GitHub mutations need an exact-tag
// environment approval as well as --apply. Never discovers a save by itself.
import { createReadStream, existsSync } from 'node:fs';
import { lstat, realpath, readdir, mkdir, open, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { scanEntries, loadReviewed } from '../secret-scan/scan.mjs';
import { defaultCorpusDir, loadCorpus } from '../secret-scan/fingerprints.mjs';
import { loadPackReviewed, reviewedPackCategories } from '../secret-scan/pack-reviewed.mjs';
import { fail, relativeName, visitArchive, writeArchive } from './publish-archive.mjs';

const repository = 'fenerax/chunk-picker-rs3';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const kinds = [['data', 'duo-data', 'dataPack', 'data'], ['rulesText', 'duo-rules-text', 'rulesTextPack', 'rules-text'], ['art', 'duo-art', 'artPack', 'art']];
const simple = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encode = value => JSON.stringify(value, null, 2) + '\n';
const within = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)); };

async function noLinks(file) {
  const absolute = path.resolve(file); let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || path.resolve(await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) throw fail('linked-path');
  }
  return absolute;
}

async function inputPath(file) {
  const absolute = path.resolve(file);
  protectInput(absolute);
  return noLinks(absolute);
}

function protectInput(absolute) {
  if (/(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(absolute)) throw fail('protected-input');
}

async function* directoryFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const item of entries) {
    const name = relative ? `${relative}/${item.name}` : item.name;
    if (!relativeName(name) || item.isSymbolicLink()) throw fail('pack-path');
    protectInput(path.join(root, name));
    if (item.isDirectory()) yield* directoryFiles(root, name);
    else if (item.isFile()) yield { name, source: path.join(root, name) };
    else throw fail('pack-entry');
  }
}

// Bound memory even for the art pack's large diagnostic JSON. Overlap covers
// encoded corpus values (up to 4096 chars), token rules and multiline defaults.
function scanner(corpus, corpusSha256) {
  const reviewed = loadReviewed(), overlap = Math.max(65536, (corpus?.maxLength ?? 0) * 12);
  const packReviewed = loadPackReviewed();
  const state = { files: 0, bytes: 0, findings: 0, categories: {}, locations: [], reviewed: 0, reviewedCategories: {} };
  const add = result => {
    for (const finding of result.findings) {
      state.findings++;
      state.categories[finding.category] = (state.categories[finding.category] ?? 0) + 1;
      // Never retain matched values or input paths. A stable file ordinal lets
      // an operator locate the input without copying its name into a report.
      if (state.locations.length < 30) state.locations.push({ category: finding.category, file: state.files });
    }
  };
  const inspect = (name, bytes, pending) => {
    const result = scanEntries([{ path: name, bytes }], { corpus, reviewed });
    if (pending) {
      for (const finding of result.findings) pending.set(finding.category, (pending.get(finding.category) ?? 0) + 1);
    } else add(result);
  };
  const finish = (name, digest, pending) => {
    const allowed = reviewedPackCategories(name, digest, packReviewed, corpusSha256);
    for (const [category, count] of pending) if (allowed.has(category)) {
      state.reviewed += count;
      state.reviewedCategories[category] = (state.reviewedCategories[category] ?? 0) + count;
    } else {
      // Store counts only. Review applies after the entire payload is hashed;
      // a partial window can never borrow an exception from another payload.
      for (let index = 0; index < count; index++) add({ findings: [{ category }] });
    }
  };
  async function content(name, chunks, { expanded = false, capture = false } = {}) {
    let tail = Buffer.alloc(0), textTail = '', size = 0; const hash = createHash('sha256'), captured = [], pending = new Map();
    const decoder = /\.(?:json|jsonl|[cm]?js|ts|txt|md|svg|csv|xml)$/i.test(name) ? new StringDecoder('utf8') : null;
    for await (const bytes of chunks) {
      size += bytes.length;
      if (size > 512 * 1024 ** 2) throw fail('file-limit');
      hash.update(bytes);
      if (capture) {
        if (size > 16 * 1024 ** 2) throw fail('manifest-limit');
        captured.push(bytes);
      }
      const text = decoder ? textTail + decoder.write(bytes) : null;
      const window = decoder ? Buffer.from(text.replace(/\0/g, '\n')) : Buffer.concat([tail, bytes]);
      // Repeated overlap findings are intentionally still blocking. Reported
      // counts are scan hits, not a count of distinct private values.
      inspect(name, window, pending);
      if (decoder) textTail = text.slice(-overlap);
      else tail = Buffer.from(window.subarray(Math.max(0, window.length - overlap)));
    }
    if (decoder) inspect(name, Buffer.from((textTail + decoder.end()).replace(/\0/g, '\n')), pending);
    if (!expanded) state.bytes += size;
    const digest = hash.digest('hex');
    finish(name, digest, pending);
    return { bytes: size, sha256: digest, ...(capture ? { manifestBytes: Buffer.concat(captured) } : {}) };
  }
  async function file(name, chunks, capture = false) {
    state.files++; inspect(name);
    if (/\.gz$/i.test(name)) {
      // Scan the transport bytes and the expanded payload. Hash the original
      // bytes: these are what the manifest and release asset must pin.
      const unzip = createGunzip(); let receipt;
      async function* tapped() {
        // content consumes the same stream through a generator, retaining only
        // a scan window. No second full-size copy of a compressed file.
        let tail = Buffer.alloc(0), textTail = '', size = 0; const pending = new Map();
        const hash = createHash('sha256'), decoder = new StringDecoder('utf8');
        for await (const bytes of chunks) {
          size += bytes.length; if (size > 512 * 1024 ** 2) throw fail('file-limit');
          hash.update(bytes); const window = Buffer.concat([tail, bytes]); inspect(name, window, pending);
          tail = Buffer.from(window.subarray(Math.max(0, window.length - overlap)));
          const text = textTail + decoder.write(bytes);
          inspect(name, Buffer.from(text.replace(/\0/g, '\n')), pending); textTail = text.slice(-overlap);
          yield bytes;
        }
        inspect(name, Buffer.from((textTail + decoder.end()).replace(/\0/g, '\n')), pending);
        state.bytes += size; receipt = { bytes: size, sha256: hash.digest('hex') };
        finish(`${name}#gzip-transport`, receipt.sha256, pending);
      }
      const source = Readable.from(tapped()); source.on('error', error => unzip.destroy(error)); source.pipe(unzip);
      try { await content(name.replace(/\.gz$/i, ''), unzip, { expanded: true }); }
      finally { source.destroy(); unzip.destroy(); }
      return receipt;
    }
    return content(name, chunks, { capture });
  }
  const rawFile = async (name, chunks) => {
    state.files++; inspect(name);
    async function* metadata() {
      const decoder = new StringDecoder('utf8'); let tail = '';
      for await (const bytes of chunks) {
        // Preserve Unicode in optional gzip metadata as well as the binary
        // scanner's ordinary ASCII runs. Retain original bytes for the hash.
        const text = tail + decoder.write(bytes);
        inspect(name, Buffer.from(text.replace(/\0/g, '\n'))); tail = text.slice(-overlap);
        yield bytes;
      }
      inspect(name, Buffer.from((tail + decoder.end()).replace(/\0/g, '\n')));
    }
    return content(name, metadata());
  };
  return { state, inspect, file, rawFile };
}

async function scanPack(source, id, scan) {
  const absolute = await inputPath(source), info = await lstat(absolute);
  const records = [], seen = new Set(); let archive = false, archiveReceipt;
  const add = async (name, chunks, diskSource, header) => {
    if (!relativeName(name) || seen.has(name.toLowerCase()) || records.length >= 50000) throw fail('pack-path');
    seen.add(name.toLowerCase());
    if (header) scan.inspect(`${id}/archive-header`, header);
    const receipt = await scan.file(`${id}/${name}`, chunks, name === 'pack.json');
    records.push({ name, source: diskSource, ...receipt });
  };
  if (info.isDirectory()) {
    for await (const file of directoryFiles(absolute)) await add(file.name, createReadStream(file.source), file.source);
  } else if (info.isFile() && /\.tar\.gz$/i.test(absolute)) {
    archive = true;
    // Includes the outer gzip header's optional filename/comment/extra fields.
    // Pin the entire scanned transport so metadata cannot change afterwards.
    archiveReceipt = await scan.rawFile(`${id}/transport.tar.gz`, createReadStream(absolute));
    // Archive layout is checked without writing any unpacked file.
    await visitArchive(absolute, async (entry, body) => {
      scan.inspect(entry.name, entry.header);
      scan.inspect(entry.name, Buffer.from(new TextDecoder().decode(entry.header).replace(/\0/g, '\n')));
      if (entry.directory) return;
      const [packId, version, ...rest] = entry.name.split('/');
      if (packId !== id || !simple(version) || !rest.length) throw fail('archive-layout');
      records.archiveVersion ??= version;
      if (version !== records.archiveVersion) throw fail('archive-layout');
      await add(rest.join('/'), body, undefined);
    });
  } else throw fail('pack-input');
  return { id, source: absolute, archive, archiveReceipt, records };
}

function verifyPack(pack, kind) {
  const record = pack.records.find(item => item.name === 'pack.json');
  if (!record?.manifestBytes) throw fail('pack-manifest');
  let manifest;
  try { manifest = JSON.parse(record.manifestBytes.toString('utf8')); } catch { throw fail('pack-manifest'); }
  if (manifest.schemaVersion !== 1 || manifest.id !== pack.id || manifest.kind !== kind || !simple(manifest.version)
    || !Array.isArray(manifest.files) || (pack.archive && manifest.version !== pack.records.archiveVersion)) throw fail('pack-manifest');
  if (kind === 'data' && !/-public\.\d+$/.test(manifest.version)) throw fail('public-data-required');
  const actual = new Map(pack.records.map(item => [item.name, item])), names = new Set(['pack.json']);
  for (const item of manifest.files) {
    if (!relativeName(item.path) || names.has(item.path) || !digest(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw fail('pack-record');
    const found = actual.get(item.path); names.add(item.path);
    if (!found || found.bytes !== item.bytes || found.sha256 !== item.sha256) throw fail('pack-receipt');
  }
  if (names.size !== actual.size) throw fail('unlisted-pack-file');
  return { manifest, choice: { id: manifest.id, version: manifest.version, sha256: record.sha256 } };
}

async function hashFile(file) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

async function safeNewOutput(file) {
  let ancestor = path.dirname(path.resolve(file));
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  await noLinks(ancestor);
  if (existsSync(file)) throw fail('output-exists');
}

export async function publishAssets(options, { log = console.log } = {}) {
  if (!simple(options.tag) || !options.outputDir || !options.pinOut || kinds.some(([, , key]) => !options[key])) throw fail('usage');
  const output = path.resolve(options.outputDir), pinOut = path.resolve(options.pinOut);
  const corpusDir = options.corpusDir || process.env.SECRET_SCAN_CORPUS || defaultCorpusDir;
  let corpus = null, corpusSha256;
  if (options.corpusDir || process.env.SECRET_SCAN_CORPUS || existsSync(corpusDir)) {
    const receipt = async () => createHash('sha256').update(await readFile(path.join(corpusDir, 'corpus.json'))).digest('hex');
    corpusSha256 = await receipt();
    corpus = await loadCorpus(corpusDir);
    if (corpusSha256 !== await receipt()) throw fail('corpus-changed');
  }
  const scan = scanner(corpus, corpusSha256);
  scan.inspect('release-tag', Buffer.from(options.tag));
  const packs = [];
  // Nothing is created, hashed for publication or sent to gh until all upload
  // inputs (including every unlisted file) have passed this first scan.
  for (const [, id, key] of kinds) {
    log(`Scanning ${id}...`);
    packs.push(await scanPack(options[key], id, scan));
    log(`${id} scanned; cumulative ${scan.state.files} files, ${scan.state.bytes} input bytes.`);
  }
  let save;
  if (options.saveCopy) {
    const source = await inputPath(options.saveCopy);
    if (!(await lstat(source)).isFile() || !/\.json$/i.test(source)) throw fail('save-copy-input');
    save = { source, ...await scan.file('scrubbed-save.json', createReadStream(source), true) };
  }
  log(`Secret scan: ${corpus ? 'local corpus and patterns' : 'patterns only; no local corpus found'}; ${scan.state.files} files, ${scan.state.bytes} input bytes, ${scan.state.findings} hits.`);
  if (scan.state.reviewed) log(`Exact-payload reviews: ${scan.state.reviewed} false-positive hits; ${JSON.stringify(scan.state.reviewedCategories)}.`);
  if (scan.state.findings) {
    log(`Scan categories: ${JSON.stringify(scan.state.categories)}`);
    log(`Scan locations (input file ordinals; values withheld): ${JSON.stringify(scan.state.locations)}`);
    throw Object.assign(fail('secret-scan'), { scan: scan.state });
  }
  if (options.apply && process.env.RS3_PUBLISH_APPROVED !== options.tag) throw fail('approval-required');
  if (pinOut.toLowerCase() === path.join(repoRoot, '.github/packs/pack-pin.json').toLowerCase()) throw fail('repository-pin');
  for (const pack of packs) {
    if (within(pack.source, output) || within(pack.source, pinOut) || (save && within(output, save.source))) throw fail('output-overlaps-input');
  }
  const verified = packs.map((pack, index) => verifyPack(pack, kinds[index][3]));
  if (!digest(verified[0].manifest.ruleContractHash) || verified[0].manifest.ruleContractHash !== verified[1].manifest.ruleContractHash) throw fail('rules-contract');
  if (save) { try { JSON.parse(save.manifestBytes.toString('utf8')); } catch { throw fail('save-copy-json'); } }
  const names = verified.map(({ choice }) => `${choice.id}-${choice.version}.tar.gz`);
  if (save) names.push('scrubbed-save.json');
  // Scan generated public names before logging or using them in commands.
  for (const name of names) scan.inspect(name);
  if (scan.state.findings) throw fail('secret-scan');
  await safeNewOutput(pinOut);
  if (existsSync(output)) {
    await noLinks(output);
    if ((await readdir(output)).length) throw fail('output-exists');
  }
  for (const name of names) await safeNewOutput(path.join(output, name));
  await mkdir(output, { recursive: true }); await noLinks(output);
  await mkdir(path.dirname(pinOut), { recursive: true }); await noLinks(path.dirname(pinOut));
  const created = [], assets = [];
  const claim = async target => {
    const handle = await open(target, 'wx');
    created.push(target);
    return handle;
  };
  try {
    for (let index = 0; index < packs.length; index++) {
      const pack = packs[index], choice = verified[index].choice, target = path.join(output, names[index]);
      const handle = await claim(target);
      if (pack.archive) {
        await pipeline(createReadStream(pack.source), handle.createWriteStream());
        const after = await hashFile(target);
        if (after.bytes !== pack.archiveReceipt.bytes || after.sha256 !== pack.archiveReceipt.sha256) throw fail('input-changed');
        // Re-read the prepared archive against the scanned member receipts.
        const members = new Map(pack.records.map(item => [item.name, item]));
        await visitArchive(target, async (entry, body) => {
          if (entry.directory) return;
          if (!entry.name.startsWith(`${choice.id}/${choice.version}/`)) throw fail('input-changed');
          const name = entry.name.split('/').slice(2).join('/'), expected = members.get(name);
          const hash = createHash('sha256'); let bytes = 0;
          for await (const chunk of body) { bytes += chunk.length; hash.update(chunk); }
          if (!expected || bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw fail('input-changed');
          members.delete(name);
        });
        if (members.size) throw fail('input-changed');
      } else await writeArchive(handle.createWriteStream(), pack.records.map(record => ({ ...record, name: `${choice.id}/${choice.version}/${record.name}` })));
      const receipt = await hashFile(target);
      if (receipt.bytes >= 2 * 1024 ** 3) throw fail('release-asset-limit');
      assets.push({ name: names[index], ...receipt });
    }
    if (save) {
      const target = path.join(output, 'scrubbed-save.json'), handle = await claim(target);
      await pipeline(createReadStream(save.source), handle.createWriteStream());
      const receipt = await hashFile(target);
      if (receipt.bytes !== save.bytes || receipt.sha256 !== save.sha256) throw fail('input-changed');
      assets.push({ name: 'scrubbed-save.json', ...receipt });
    }
    const pin = { schema: 'rs3-ci-pack-pin-v1', tag: options.tag,
      selection: Object.fromEntries(kinds.map(([key], index) => [key, verified[index].choice])), assets: assets.filter(asset => asset.name.endsWith('.tar.gz')) };
    const pinHandle = await claim(pinOut);
    try { await pinHandle.writeFile(encode(pin)); } finally { await pinHandle.close(); }
    const createArgs = ['release', 'create', options.tag, '--repo', repository, '--verify-tag', '--title', options.tag, '--notes', 'Data packs and optional scrubbed save. See WIKI-NOTICE.md and THIRD_PARTY_NOTICES.md in the repository.'];
    const uploadArgs = ['release', 'upload', options.tag, ...assets.map(asset => asset.name), '--repo', repository];
    const command = args => 'gh ' + args.map(arg => `'${arg}'`).join(' ');
    log(`Release tag: ${options.tag}`);
    for (const asset of assets) log(`${asset.name}: ${asset.bytes} bytes (${(asset.bytes / 1024 ** 2).toFixed(2)} MiB); sha256 ${asset.sha256}`);
    log('From the prepared asset directory, for a new release (tag must already exist on GitHub):'); log(command(createArgs));
    log('For a new or existing release:'); log(command(uploadArgs));
    log('Proposed CI pin written to the requested separate path. The repository pin was not changed.');
    if (options.apply) {
      // Both code paths require approval. No clobber: an existing asset refuses.
      const run = args => execFileSync('gh', args, { cwd: output, stdio: 'pipe', windowsHide: true });
      let present = true;
      try { run(['release', 'view', options.tag, '--repo', repository, '--json', 'tagName']); } catch { present = false; }
      if (!present) run(createArgs);
      run(uploadArgs); log('Approved release assets uploaded.');
    } else log('Dry run only. No GitHub command was executed.');
    return { pin, assets, scan: scan.state };
  } catch (error) {
    // Delete only this invocation's new outputs, never any input or old asset.
    for (const file of created) await rm(file, { force: true }).catch(() => {});
    throw error;
  }
}

export function parseArgs(args) {
  const options = {}, names = { '--tag': 'tag', '--data-pack': 'dataPack', '--rules-text-pack': 'rulesTextPack', '--art-pack': 'artPack',
    '--save-copy': 'saveCopy', '--output-dir': 'outputDir', '--pin-out': 'pinOut', '--corpus-dir': 'corpusDir' };
  let mode;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--dry-run' || name === '--apply') {
      if (mode) throw fail('usage'); mode = name; options.apply = name === '--apply';
    } else if (names[name] && args[index + 1] && !args[index + 1].startsWith('--') && options[names[name]] === undefined) options[names[name]] = args[++index];
    else throw fail('usage');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await publishAssets(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(`Publish refused (${error.category ?? 'input-or-io-error'}). No matched values are printed.`); process.exitCode = 1; }
}
