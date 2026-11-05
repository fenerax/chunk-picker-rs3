// A byte-preserving metadata cut is release input, never release authority.
import path from 'node:path';
import { lstat, readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashTree, digestValue } from './release-identity.mjs';

const self = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const fail = message => { throw new Error(message); };
const inside = (a, b) => { const r = path.relative(a, b); return !r || r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
const relative = name => {
  if (typeof name !== 'string' || !name || /[\\:%\u0000-\u001f*?<>"|]/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || /^(?:\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('Release pack path refused.');
  return name;
};
async function noLinks(target, missing = false) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('Release pack links refused.'); }
    catch (error) { if (!missing || error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) return;
  }
}
async function exists(target) { try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function bytesAt(target) {
  await noLinks(target);
  const before = await lstat(target);
  if (!before.isFile() || before.nlink !== 1) fail('Release pack ordinary file required.');
  const bytes = await readFile(target), after = await lstat(target);
  if (bytes.length !== before.size || ['ino', 'dev', 'size', 'nlink', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k])) fail('Release pack input changed.');
  return bytes;
}
async function put(target, bytes) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }); }
async function verifiedDev(devRoot) {
  const receipt = JSON.parse(await bytesAt(path.join(devRoot, 'dev-receipt.json')));
  if (receipt.schema !== 'rs3-dev-pack-v1' || receipt.developmentOnly !== true || receipt.releaseAuthority !== false || !/^h[a-f0-9]{64}$/.test(receipt.inputId ?? '') || receipt.version !== `0.0.0-dev.${receipt.inputId}` || !hex(receipt.outputDigest) || receipt.identity?.schema !== 'rs3-dev-input-v1' || !plain(receipt.identity.core) || !plain(receipt.identity.private)) fail('Verified development receipt required.');
  const inventory = await hashTree(devRoot, { excludePaths: ['dev-receipt.json'] });
  if (inventory.digest !== receipt.outputDigest) fail('Development output digest differs.');
  if ('h' + digestValue(receipt.identity) !== receipt.inputId) fail('Development input identity differs.');
  return { receipt, inventory, receiptHash: sha(await bytesAt(path.join(devRoot, 'dev-receipt.json'))) };
}

const contracts = { datasetId: 'duo-legacy', datasetContractVersion: 1, identityNamespace: 'rs3', coordinateSystem: 'surface-grid-v1', corePackApi: 1 };
const commonKeys = ['schemaVersion', 'id', 'kind', 'version', 'requires', 'distribution', 'catalogues', 'provenance', 'files'];
function supportedManifest(manifest, kind, choice, devVersion) {
  const allowed = [...commonKeys, ...(kind === 'art' ? ['roots'] : ['ruleContractHash', ...(kind === 'data' ? ['datasetDigest', 'capabilities', 'overlayOrder', 'environment'] : [])])];
  if (!plain(manifest) || Object.keys(manifest).some(k => !allowed.includes(k)) || manifest.schemaVersion !== 1 || manifest.id !== choice.id || manifest.version !== choice.version || manifest.kind !== kind || manifest.distribution !== 'private-local' || !plain(manifest.requires) || !plain(manifest.catalogues) || !Array.isArray(manifest.files)) fail('Unsupported release pack manifest.');
  const required = kind === 'art' ? Object.fromEntries(Object.entries(contracts).filter(([k]) => k !== 'identityNamespace')) : contracts;
  if (digestValue(manifest.requires) !== digestValue(required)) fail('Unsupported release pack contract.');
  if (kind === 'art') {
    if (!plain(manifest.roots) || Object.keys(manifest.catalogues).some(k => k !== 'artBindings') || typeof manifest.catalogues.artBindings !== 'string') fail('Unsupported art manifest.');
  } else {
    if (choice.version !== devVersion || !hex(manifest.ruleContractHash) || Object.keys(manifest.catalogues).some(k => k !== 'values') || typeof manifest.catalogues.values !== 'string') fail('Unsupported development pack manifest.');
    if (kind === 'data' && (!hex(manifest.datasetDigest) || !plain(manifest.capabilities) || !plain(manifest.environment) || !plain(manifest.overlayOrder) || Object.values(manifest.overlayOrder).some(value => typeof value !== 'string' && (!Array.isArray(value) || value.some(x => typeof x !== 'string'))))) fail('Unsupported data manifest.');
    // The reviewed builders reference their pack version only at the top level.
    // Future version references require a reviewed migration rather than blind replacement.
    const { version, ...rest } = manifest;
    if (JSON.stringify(rest).includes(devVersion)) fail('Unsupported nested pack version reference.');
  }
  relative(manifest.provenance);
  for (const name of Object.values(manifest.catalogues)) relative(name);
}
async function selectedPack(packsDir, kind, choice, devVersion) {
  const id = { data: 'duo-data', rulesText: 'duo-rules-text', art: 'duo-art' }[kind];
  if (!plain(choice) || choice.id !== id || !hex(choice.sha256)) fail('Pinned development selection required.');
  relative(choice.version);
  const directory = path.join(packsDir, id, choice.version), inventory = await hashTree(directory);
  const bytes = await bytesAt(path.join(directory, 'pack.json'));
  if (sha(bytes) !== choice.sha256) fail('Development manifest pin differs.');
  const manifest = JSON.parse(bytes), manifestKind = kind === 'rulesText' ? 'rules-text' : kind;
  supportedManifest(manifest, manifestKind, choice, devVersion);
  const records = new Map();
  for (const record of manifest.files) {
    relative(record.path);
    if (record.path === 'pack.json' || records.has(record.path.toLowerCase()) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !hex(record.sha256) || (kind !== 'art' && !['input', 'evidence', 'generated', 'provenance'].includes(record.kind))) fail('Unsupported pack payload record.');
    records.set(record.path.toLowerCase(), record);
    const actual = inventory.files.find(row => row.path === record.path);
    if (!actual || actual.size !== record.bytes || actual.sha256 !== record.sha256) fail('Development pack payload differs.');
  }
  if (inventory.files.length !== records.size + 1 || !records.has(manifest.provenance.toLowerCase()) || Object.values(manifest.catalogues).some(name => !records.has(name.toLowerCase()))) fail('Unsupported unlisted pack payload.');
  return { directory, inventory, manifest, choice, bytes };
}
async function copyTree(source, target, inventory, { manifestBytes } = {}) {
  await mkdir(target, { recursive: true });
  for (const directory of inventory.directories) await mkdir(path.join(target, relative(directory.path)), { recursive: true });
  for (const record of inventory.files) {
    if (record.path === 'pack.json' && manifestBytes) { await put(path.join(target, record.path), manifestBytes); continue; }
    const bytes = await bytesAt(path.join(source, relative(record.path)));
    if (bytes.length !== record.size || sha(bytes) !== record.sha256) fail('Release cut input changed during copying.');
    await put(path.join(target, record.path), bytes);
  }
}

/** Explicit version metadata only; callers still run ordinary production gates. */
export async function cutReleasePacks({ devRoot, output, version, rulesTextVersion = version } = {}) {
  if (![devRoot, output].every(value => typeof value === 'string' && path.isAbsolute(value)) || !stableVersion.test(version ?? '') || !stableVersion.test(rulesTextVersion ?? '')) fail('Explicit absolute paths and stable semantic versions required.');
  devRoot = path.resolve(devRoot); output = path.resolve(output);
  if (inside(devRoot, output) || inside(output, devRoot)) fail('Release cut output overlaps development inputs.');
  if (output.split(path.sep).some(part => ['kits', 'packs', 'operator', 'release-v2', '.git'].includes(part.toLowerCase()))) fail('Release cut output must stay outside operational roots.');
  await noLinks(devRoot); await noLinks(output, true);
  if (await exists(output)) fail('Release cut output already exists.');
  const dev = await verifiedDev(devRoot), packsDir = path.join(devRoot, 'packs');
  const selection = JSON.parse(await bytesAt(path.join(packsDir, 'selection.json')));
  if (selection.schemaVersion !== 1 || Object.keys(selection).some(k => !['schemaVersion', 'data', 'rulesText', 'art'].includes(k))) fail('Unsupported development selection.');
  const data = await selectedPack(packsDir, 'data', selection.data, dev.receipt.version);
  const text = await selectedPack(packsDir, 'rulesText', selection.rulesText, dev.receipt.version);
  const art = await selectedPack(packsDir, 'art', selection.art, dev.receipt.version);
  if (data.manifest.ruleContractHash !== text.manifest.ruleContractHash) fail('Development data/text contracts differ.');
  const profile = await bytesAt(path.join(devRoot, 'profile.json'));
  const addon = await hashTree(path.join(devRoot, 'addon'));
  JSON.parse(profile); JSON.parse(await bytesAt(path.join(devRoot, 'addon/addon.json')));
  await mkdir(path.dirname(output), { recursive: true }); await noLinks(path.dirname(output));
  const stage = await mkdtemp(path.join(path.dirname(output), '.cut-release-packs-'));
  let published = false;
  try {
    const next = { schemaVersion: 1 };
    for (const [kind, pack, selectedVersion] of [['data', data, version], ['rulesText', text, rulesTextVersion], ['art', art, art.choice.version]]) {
      const bytes = kind === 'art' ? pack.bytes : Buffer.from(JSON.stringify({ ...pack.manifest, version: selectedVersion }, null, 2) + '\n');
      await copyTree(pack.directory, path.join(stage, 'packs', pack.choice.id, selectedVersion), pack.inventory, { manifestBytes: bytes });
      next[kind] = kind === 'art' ? { ...pack.choice } : { id: pack.choice.id, version: selectedVersion, sha256: sha(bytes) };
    }
    await put(path.join(stage, 'packs/selection.json'), JSON.stringify(next, null, 2) + '\n');
    await put(path.join(stage, 'profile.json'), profile);
    await copyTree(path.join(devRoot, 'addon'), path.join(stage, 'addon'), addon);
    const after = await verifiedDev(devRoot);
    if (after.receiptHash !== dev.receiptHash || after.inventory.digest !== dev.inventory.digest) fail('Development inputs changed during release cut.');
    const cut = { schema: 'rs3-release-pack-cut-v1', releaseAuthority: false, version, rulesTextVersion, packs: next,
      source: { schema: dev.receipt.schema, inputId: dev.receipt.inputId, version: dev.receipt.version, outputDigest: dev.receipt.outputDigest, core: dev.receipt.identity.core, private: dev.receipt.identity.private, identity: dev.receipt.identity },
      implementationSha256: sha(await bytesAt(self)), outputDigest: (await hashTree(stage, { excludePaths: ['cut-receipt.json'] })).digest };
    await put(path.join(stage, 'cut-receipt.json'), JSON.stringify(cut, null, 2) + '\n');
    await noLinks(output, true); if (await exists(output)) fail('Release cut output appeared during copying.');
    await rename(stage, output); published = true;
    return { packsDir: path.join(output, 'packs'), profile: path.join(output, 'profile.json'), addon: path.join(output, 'addon'), receipt: path.join(output, 'cut-receipt.json'), version, rulesTextVersion };
  } finally { if (!published) { await noLinks(stage); await rm(stage, { recursive: true, force: true }); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write('Usage: node cut-release-packs.mjs --dev-root <absolute verified dev output> --output <absolute absent release-inputs directory> --version <stable semver> [--rules-text-version <stable semver>]\nMetadata cut only; production preflight, full gates and activation remain required.\n');
  else try {
    const options = {}, names = { '--dev-root': 'devRoot', '--output': 'output', '--version': 'version', '--rules-text-version': 'rulesTextVersion' };
    for (let i = 0; i < args.length; i += 2) { const key = names[args[i]]; if (!key || !args[i + 1] || Object.hasOwn(options, key)) fail('Invalid release cut arguments.'); options[key] = args[i + 1]; }
    process.stdout.write(JSON.stringify(await cutReleasePacks(options)) + '\n');
  } catch { process.stderr.write('Release pack metadata cut refused. Verify the development receipt, explicit stable versions and isolated absent output.\n'); process.exitCode = 1; }
}
