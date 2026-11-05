// Off-PC Phase B operator tool. Three commands, none of which touches the live save,
// data dirs or a kit:
//   packs    --packs DIR --out DIR [--pin FILE]   build one deterministic .tar.gz per
//            selected pack (pack.json-listed bytes only) and the pin the workflow checks.
//   dispatch --core-sha SHA --private-sha SHA [--branch B] [--packs true|false]
//            start an allowlist run once the branch head on GitHub is the private commit.
//   verify   --kit DIR --release DIR   what a release would import, read fresh from GitHub.
// Uploading the pack assets is deliberately not here: the private release asset is
// created by hand once, after review (see the Phase B report).
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, rename } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packIdentity } from './neutral-lane.mjs';

const kinds = ['data', 'rulesText', 'art'];
const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';

/** One ustar header: fixed owner, mode and mtime so equal bytes give an equal archive. */
export function tarHeader(name, size) {
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.length !== name.length || /[\\\x00-\x1f]/.test(name)) throw Error('Pack path must be plain ASCII: ' + name);
  let prefix = '', base = name;
  if (name.length > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut); base = name.slice(cut + 1);
    if (cut < 0 || prefix.length > 155 || base.length > 100 || !base) throw Error('Pack path too long for ustar: ' + name);
  }
  const header = Buffer.alloc(512);
  header.write(base, 0, 100, 'ascii');
  header.write(octal(0o644, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii'); header.write(octal(0, 8), 116, 'ascii');
  header.write(octal(size, 12), 124, 'ascii'); header.write(octal(0, 12), 136, 'ascii');
  header.fill(0x20, 148, 156); header.write('0', 156, 'ascii');
  header.write('ustar\0' + '00', 257, 'ascii');
  header.write(prefix, 345, 155, 'ascii');
  let sum = 0; for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

async function* tarStream(root, entries) {
  for (const { name, file, size } of entries) {
    yield tarHeader(name, size);
    let seen = 0;
    for await (const chunk of createReadStream(file)) { seen += chunk.length; yield chunk; }
    if (seen !== size) throw Error('Pack file changed while archiving: ' + name);
    if (size % 512) yield Buffer.alloc(512 - (size % 512));
  }
  yield Buffer.alloc(1024);
}

const sha256File = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

/** Builds `<id>-<version>.tar.gz` for each selected pack and returns the pin. Every
 * payload is checked against its pack.json first (packIdentity), and only those bytes
 * plus pack.json go in, in pack.json order. */
export async function buildPackAssets({ packs, out, tag = 'neutral-packs' }) {
  await packIdentity(packs);
  const selection = JSON.parse(await readFile(path.join(packs, 'selection.json'), 'utf8'));
  await mkdir(out, { recursive: true });
  const assets = [], pinned = {};
  for (const kind of kinds) {
    const { id, version, sha256 } = selection[kind];
    pinned[kind] = { id, version, sha256 };
    const name = `${id}-${version}.tar.gz`;
    if (!/^[A-Za-z0-9._-]+\.tar\.gz$/.test(name)) throw Error('Pack asset name refused.');
    if (assets.some(asset => asset.name === name)) throw Error('Two pack kinds share one pack; the pin needs three assets.');
    const root = path.join(packs, id, version), records = JSON.parse(await readFile(path.join(root, 'pack.json'))).files;
    const entries = [{ name: `${id}/${version}/pack.json`, file: path.join(root, 'pack.json'), size: (await lstat(path.join(root, 'pack.json'))).size },
      ...records.map(record => ({ name: `${id}/${version}/${record.path}`, file: path.join(root, record.path), size: record.bytes }))];
    const target = path.join(out, name), partial = target + '.partial';
    await pipeline(tarStream(root, entries), createGzip({ level: 9 }), createWriteStream(partial, { flags: 'wx' }));
    await rename(partial, target);
    assets.push({ name, bytes: (await lstat(target)).size, sha256: await sha256File(target) });
  }
  return { schema: 'rs3-neutral-pack-pin-v1', tag, selection: pinned, assets };
}

function args(argv, allowed) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!allowed.includes(key) || value === undefined || options[key.slice(2)] !== undefined) throw Error(`Usage: ${allowed.join(' ')}`);
    options[key.slice(2)] = value;
  }
  return options;
}
const gh = list => execFileSync('gh', list, { encoding: 'utf8', windowsHide: true, timeout: 30000 });

async function main([command, ...rest]) {
  if (command === 'packs') {
    const options = args(rest, ['--packs', '--out', '--pin']);
    if (!options.packs || !options.out) throw Error('packs needs --packs and --out.');
    const pin = await buildPackAssets({ packs: path.resolve(options.packs), out: path.resolve(options.out) });
    if (options.pin) await writeFile(path.resolve(options.pin), JSON.stringify(pin, null, 2) + '\n', { flag: 'w' });
    console.log(JSON.stringify(pin, null, 2));
    return;
  }
  if (command === 'dispatch') {
    const options = args(rest, ['--core-sha', '--private-sha', '--branch', '--packs']);
    const branch = options.branch ?? 'main', packs = options.packs ?? 'false';
    if (!/^[0-9a-f]{40}$/.test(options['core-sha'] ?? '') || !/^[0-9a-f]{40}$/.test(options['private-sha'] ?? '')) throw Error('Full 40-character SHAs required.');
    if (branch !== 'main' && branch !== `neutral/${options['private-sha']}`) throw Error('The verifier accepts only main or neutral/<private sha>.');
    if (!['true', 'false'].includes(packs)) throw Error('--packs is true or false.');
    const { REPOSITORY } = await import('./neutral-evidence.mjs');
    const head = JSON.parse(gh(['api', '--method', 'GET', `repos/${REPOSITORY}/branches/${encodeURIComponent(branch)}`])).commit?.sha;
    if (head !== options['private-sha']) throw Error(`GitHub ${branch} is at ${head}, not the release's private commit.`);
    gh(['workflow', 'run', 'private-neutral-lane.yml', '--repo', REPOSITORY, '--ref', branch, '-f', `core_sha=${options['core-sha']}`, '-f', 'mode=allowlist', '-f', `packs=${packs}`]);
    console.log(`Dispatched: neutral allowlist core ${options['core-sha']} on ${branch}.`);
    return;
  }
  if (command === 'verify') {
    const options = args(rest, ['--kit', '--release']);
    const { planNeutral, verifyNeutralEvidence } = await import('./neutral-evidence.mjs');
    const kit = path.resolve(options.kit), release = path.resolve(options.release);
    const manifest = JSON.parse(await readFile(path.join(release, 'release.json'), 'utf8'));
    const companion = JSON.parse(await readFile(path.join(release, 'companion.json'), 'utf8'));
    const { readdir } = await import('node:fs/promises');
    const inventory = [...new Set([...(await readdir(path.join(release, 'core/tests'))), ...(await readdir(path.join(kit, 'checks/private-source/tests')))])].filter(name => name.endsWith('.test.mjs')).sort();
    const plan = await planNeutral({ core: path.join(release, 'core'), privateSource: path.join(kit, 'checks/private-source'), packsRoot: companion.packsDir, inventory });
    // The tests directories stand in for the release's planned inventory here.
    console.log(JSON.stringify({ inventory: 'approximate', planned: plan.files.length, reason: plan.reason, refused: plan.refused, key: plan.key, packs: plan.packs }, null, 2));
    if (!plan.files.length) return;
    const receipt = await verifyNeutralEvidence({ privateSha: manifest.pairedInput?.privateCommit, coreSha: manifest.revision, key: plan.key, files: plan.files, packs: plan.packs });
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  throw Error('Commands: packs, dispatch, verify.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.code ? `${error.message}` : error.message); process.exitCode = 1; });
}
