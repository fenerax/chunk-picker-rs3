// Development artifacts never authorize a production release. Node built-ins only.
import path from 'node:path';
import { mkdir, mkdtemp, lstat, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashTree, digestValue, captureInputIdentity, captureExecutionIdentity, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { exportSource } from './export-repo-source.mjs';

const self = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new Error(message); };
const policy = { schema: 'rs3-dev-build-policy-v1', source: 'single-repository-export', optionalInputs: 'pinned-pack-copies-only', developmentOnly: true, releaseAuthority: false };
const overlaps = (a, b) => { const r = path.relative(a, b); return !r || r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
const relativeName = name => {
  if (typeof name !== 'string' || !name || /[\\:%\u0000-\u001f*?<>"|]/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || /^(?:\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('Development input path refused.');
  return name;
};
async function noLinks(target, missing = false) {
  for (let q = path.resolve(target); ; q = path.dirname(q)) {
    try { if ((await lstat(q)).isSymbolicLink()) fail('Development input link refused.'); }
    catch (error) { if (!missing || error.code !== 'ENOENT') throw error; }
    if (q === path.dirname(q)) return;
  }
}
async function exists(filename) { try { await lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function ordinaryBytes(filename) {
  await noLinks(filename);
  const before = await lstat(filename);
  if (!before.isFile() || before.nlink !== 1) fail('Development input must be an ordinary file.');
  const bytes = await readFile(filename), after = await lstat(filename);
  if (['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].some(k => before[k] !== after[k]) || bytes.length !== before.size) fail('Development input changed.');
  return bytes;
}
async function put(filename, bytes) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes, { flag: 'wx' }); }
const gitEnvironment = () => sanitizeExecutionEnvironment(process.env, { overrides: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' } });
async function git(repo, args, binary = false) {
  try { return (await promisify(execFile)('git', ['-C', repo, ...args], { windowsHide: true, env: gitEnvironment(), encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 ** 2 })).stdout; }
  catch { fail('Development committed source could not be read.'); }
}
async function commitIdentity(repo, commit) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? '')) fail('Full exact commit SHA required.');
  if ((await git(repo, ['rev-parse', '--verify', `${commit}^{commit}`])).trim() !== commit) fail('Exact commit differs.');
  return { commit, tree: (await git(repo, ['rev-parse', `${commit}^{tree}`])).trim() };
}
async function entriesAt(repo, commit) {
  const seen = new Set();
  return (await git(repo, ['ls-tree', '-rz', '--full-tree', commit])).split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match) fail('Committed links or submodules refused.');
    const name = relativeName(match[3]), key = name.toLowerCase();
    if (seen.has(key)) fail('Case-colliding committed paths refused.');
    seen.add(key); return { path: name, oid: match[2] };
  });
}
async function copyInventory(source, target, inventory) {
  await mkdir(target);
  for (const directory of inventory.directories) await mkdir(path.join(target, relativeName(directory.path)), { recursive: true });
  for (const record of inventory.files) {
    const bytes = await ordinaryBytes(path.join(source, relativeName(record.path)));
    if (bytes.length !== record.size || sha(bytes) !== record.sha256) fail('Development pack changed during copying.');
    await put(path.join(target, record.path), bytes);
  }
}
async function acceptedInputs(packsDir) {
  const selectionBytes = await ordinaryBytes(path.join(packsDir, 'selection.json'));
  const selection = JSON.parse(selectionBytes);
  if (selection.schemaVersion !== 1) fail('Accepted pack selection required.');
  const packs = [];
  for (const [kind, id] of [['data', 'duo-data'], ['rulesText', 'duo-rules-text'], ['art', 'duo-art']]) {
    const choice = selection[kind];
    if (choice?.id !== id || !hex(choice.sha256) || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/.test(choice.version ?? '') || /-dev(?:[.-]|$)/i.test(choice.version)) fail('Accepted stable pack pins required.');
    relativeName(choice.version);
    const directory = path.join(packsDir, id, choice.version), inventory = await hashTree(directory);
    const bytes = await ordinaryBytes(path.join(directory, 'pack.json'));
    if (sha(bytes) !== choice.sha256) fail('Accepted pack manifest changed.');
    const manifest = JSON.parse(bytes);
    if (manifest.id !== id || manifest.version !== choice.version || !Array.isArray(manifest.files)) fail('Accepted pack manifest differs.');
    const seen = new Set();
    for (const record of manifest.files) {
      relativeName(record.path);
      if (seen.has(record.path.toLowerCase()) || !hex(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) fail('Accepted pack record invalid.');
      seen.add(record.path.toLowerCase());
      const found = inventory.files.find(f => f.path === record.path);
      if (!found || found.size !== record.bytes || found.sha256 !== record.sha256) fail('Accepted pack payload differs.');
    }
    packs.push({ kind, directory, choice, manifest, inventory });
  }
  return { selection, selectionBytes, selectionHash: sha(selectionBytes), packs };
}
async function materialize(packs, source) {
  for (const pack of packs) for (const record of pack.manifest.files) {
    let name = record.path;
    if (pack.kind === 'art') {
      if (name.startsWith('resources/')) { /* retained */ }
      else if (name.startsWith('world-images/')) name = 'reference/original-picker/' + name.slice(13);
      else if (name.startsWith('map-assets/')) name = '.local/' + name;
      else if (name.startsWith('task-item-artwork.')) name = 'app/web/' + name;
      else continue;
    } else if (name.startsWith('local-map/')) name = '.local/map-assets/' + name.slice(10);
    else if (name.startsWith('local-game/')) name = '.local/game-data/' + name.slice(11);
    else if (/^(?:indexes\/|provenance\.json$)/.test(name)) continue;
    relativeName(name);
    const target = path.join(source, name);
    if (await exists(target)) continue;
    const bytes = await ordinaryBytes(path.join(pack.directory, record.path));
    if (sha(bytes) !== record.sha256 || bytes.length !== record.bytes) fail('Accepted pack changed during materialization.');
    await put(target, bytes);
  }
}
async function runBuilders(stage, source, version, selection) {
  const script = `import {readFile,writeFile} from 'node:fs/promises';
const source=${JSON.stringify(source)}, packsDir=${JSON.stringify(path.join(stage, 'packs'))};
const {buildDataPack}=await import(${JSON.stringify(pathToFileURL(path.join(source, 'scripts/build-data-pack.mjs')).href)});
const {buildDatasetProfile}=await import(${JSON.stringify(pathToFileURL(path.join(source, 'scripts/build-dataset-profile.mjs')).href)});
const {buildPrivateAddon}=await import(${JSON.stringify(pathToFileURL(path.join(source, 'scripts/build-private-addon.mjs')).href)});
let explanations=false;try{await readFile(source+'/app/data/rule-explanations.2026-10-17.v1.json');explanations=true}catch(e){if(e.code!=='ENOENT')throw e}
const built=await buildDataPack({sourceRoot:source,packsDir,version:${JSON.stringify(version)},rulesTextVersion:${JSON.stringify(version)},select:false,includeExplanations:explanations,mapAssetsDir:source+'/.local/map-assets',gameDataDir:source+'/.local/game-data'});
await writeFile(packsDir+'/selection.json',JSON.stringify({...${JSON.stringify(selection)},...built.selection})+'\\n');
await buildDatasetProfile({sourceRoot:source,packsDir,output:${JSON.stringify(path.join(stage, 'profile.json'))}});
await buildPrivateAddon({sourceRoot:source,output:${JSON.stringify(path.join(stage, 'addon'))}});
`;
  const runner = path.join(stage, 'run.mjs'); await put(runner, script);
  const temporary = path.join(stage, '.tmp'); await mkdir(temporary, { recursive: true });
  const env = sanitizeExecutionEnvironment(process.env, { overrides: { TEMP: temporary, TMP: temporary, TMPDIR: temporary } });
  try { await promisify(execFile)(process.execPath, [runner], { cwd: source, windowsHide: true, env, maxBuffer: 1024 ** 2 }); }
  catch { fail('Isolated development builders failed.'); }
}
async function verifyBuilt(stage, version, art) {
  const selection = JSON.parse(await ordinaryBytes(path.join(stage, 'packs/selection.json')));
  if (selection.schemaVersion !== 1 || digestValue(selection.art) !== digestValue(art)) fail('Development builder changed the art pin.');
  for (const [kind, id] of [['data', 'duo-data'], ['rulesText', 'duo-rules-text']]) {
    const choice = selection[kind];
    if (choice?.id !== id || choice.version !== version || !hex(choice.sha256)) fail('Development builder selection differs.');
    const bytes = await ordinaryBytes(path.join(stage, 'packs', id, version, 'pack.json')), manifest = JSON.parse(bytes);
    if (sha(bytes) !== choice.sha256 || manifest.id !== id || manifest.version !== version) fail('Development builder manifest differs.');
  }
  JSON.parse(await ordinaryBytes(path.join(stage, 'profile.json')));
  JSON.parse(await ordinaryBytes(path.join(stage, 'addon/addon.json')));
}

/** One exact commit of this repository; ordinary owned copies; no live roots or implicit CLI defaults. */
export async function buildDevPack(options = {}, hooks = {}) {
  const keys = ['repo', 'acceptedPacksDir', 'outputRoot'];
  for (const key of keys) if (typeof options[key] !== 'string' || !path.isAbsolute(options[key])) fail(`Explicit absolute ${key} required.`);
  const { commit } = options;
  const [repo, acceptedPacksDir, outputRoot] = keys.map(key => path.resolve(options[key]));
  if (outputRoot.split(path.sep).some(part => ['kits', 'packs', 'operator', 'release-v2'].includes(part.toLowerCase()))) fail('Development output must stay outside operational roots.');
  for (const input of [repo, acceptedPacksDir]) {
    await noLinks(input);
    if (!(await lstat(input)).isDirectory() || overlaps(input, outputRoot) || overlaps(outputRoot, input)) fail('Development output overlaps an input.');
  }
  await noLinks(outputRoot, true);
  const sourceIdentity = await commitIdentity(repo, commit);
  // Refuses links, submodules and case-colliding paths before anything is exported.
  await entriesAt(repo, commit);
  const accepted = await acceptedInputs(acceptedPacksDir);
  const policyFiles = options.policyFiles ?? [path.join(path.dirname(self), 'approved-workflows.json')];
  if (!Array.isArray(policyFiles) || policyFiles.some(file => typeof file !== 'string' || !path.isAbsolute(file))) fail('Absolute policy files required.');
  const implementationComponents = [{ name: 'builder', file: self }, { name: 'identity', file: fileURLToPath(new URL('./release-identity.mjs', import.meta.url)) },
    { name: 'exporter', file: fileURLToPath(new URL('./export-repo-source.mjs', import.meta.url)) }, ...policyFiles.map((file, i) => ({ name: `policy-${i}`, file }))];
  const implementation = await captureInputIdentity({ components: implementationComponents });
  const execution = await captureExecutionIdentity({ lane: 'build-dev-pack', cwd: repo, env: sanitizeExecutionEnvironment(), policy });
  const verifyInputs = async () => {
    const current = await acceptedInputs(acceptedPacksDir);
    if (current.selectionHash !== accepted.selectionHash || current.packs.some((p, i) => p.inventory.digest !== accepted.packs[i].inventory.digest) || (await captureInputIdentity({ components: implementationComponents })).digest !== implementation.digest) fail('Development build inputs changed.');
  };
  await mkdir(path.dirname(outputRoot), { recursive: true }); await noLinks(path.dirname(outputRoot));
  const stage = await mkdtemp(path.join(path.dirname(outputRoot), '.build-dev-'));
  let published = false;
  try {
    const source = path.join(stage, 'source'), exporter = hooks.exportSource ?? exportSource;
    if (typeof exporter !== 'function') fail('Source exporter contract required.');
    // Reads Git objects only: the checkout's working tree and index take no part.
    await exporter({ repo, commit, out: source });
    const exported = JSON.parse(await ordinaryBytes(path.join(stage, 'export.json'))), sourceTree = await hashTree(source);
    if (exported.schema !== 'rs3-private-export-v1' || exported.commit !== commit || exported.output !== source || exported.treeHash !== sourceTree.digest) fail('Source export receipt differs.');
    const identity = { schema: 'rs3-dev-input-v2', source: { ...sourceIdentity, exportHash: sourceTree.digest }, accepted: { selectionHash: accepted.selectionHash, packs: accepted.packs.map(p => ({ kind: p.kind, choice: p.choice, digest: p.inventory.digest })) }, implementation: implementation.digest, execution: execution.digest, policy, fixtureExporter: Boolean(hooks.exportSource) };
    const inputId = 'h' + digestValue(identity), version = '0.0.0-dev.' + inputId;
    const result = { packsDir: path.join(outputRoot, 'packs'), profile: path.join(outputRoot, 'profile.json'), addon: path.join(outputRoot, 'addon'), inputId, version, receipt: path.join(outputRoot, 'dev-receipt.json') };
    if (await exists(outputRoot)) {
      const receipt = JSON.parse(await ordinaryBytes(result.receipt));
      const actual = await hashTree(outputRoot, { excludePaths: ['dev-receipt.json'] });
      if (receipt.schema !== 'rs3-dev-pack-v1' || receipt.developmentOnly !== true || receipt.releaseAuthority !== false || receipt.inputId !== inputId || receipt.version !== version || receipt.outputDigest !== actual.digest || digestValue(receipt.identity) !== digestValue(identity)) fail('Existing development output does not match current inputs.');
      await verifyInputs();
      return { ...result, reused: true };
    }
    await mkdir(path.join(stage, 'packs'));
    for (const pack of accepted.packs) {
      const parent = path.join(stage, 'packs', pack.choice.id); await mkdir(parent, { recursive: true });
      await copyInventory(pack.directory, path.join(parent, pack.choice.version), pack.inventory);
    }
    await put(path.join(stage, 'packs/selection.json'), accepted.selectionBytes);
    await materialize(accepted.packs, source);
    await runBuilders(stage, source, version, accepted.selection);
    await verifyBuilt(stage, version, accepted.selection.art);
    // Recheck external inputs after the child before publishing any successful output.
    await verifyInputs();
    for (const name of ['source', 'export.json', 'run.mjs', '.tmp']) await rm(path.join(stage, name), { recursive: true, force: true });
    const output = await hashTree(stage, { excludePaths: ['dev-receipt.json'] });
    await put(path.join(stage, 'dev-receipt.json'), JSON.stringify({ schema: 'rs3-dev-pack-v1', developmentOnly: true, releaseAuthority: false, inputId, version, identity, outputDigest: output.digest }) + '\n');
    await noLinks(outputRoot, true);
    if (await exists(outputRoot)) fail('Development output appeared during build.');
    await rename(stage, outputRoot); published = true;
    return { ...result, reused: false };
  } finally {
    if (!published) { await noLinks(stage); await rm(stage, { recursive: true, force: true }); }
  }
}

const usage = 'Usage: node build-dev-pack.mjs --repo <absolute> --commit <full SHA> --packs-dir <absolute accepted packs> --output <absolute absent or matching dev root>\nDevelopment outputs have no release authority.\n';
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(usage);
  else try {
    const options = {}, names = { '--repo': 'repo', '--commit': 'commit', '--packs-dir': 'acceptedPacksDir', '--output': 'outputRoot' };
    for (let i = 0; i < args.length; i += 2) { const key = names[args[i]]; if (!key || !args[i + 1] || Object.hasOwn(options, key)) fail('Invalid development builder arguments.'); options[key] = args[i + 1]; }
    process.stdout.write(JSON.stringify(await buildDevPack(options)) + '\n');
  } catch { process.stderr.write('Development pack build refused. Check the exact commit, pinned accepted packs and isolated output.\n'); process.exitCode = 1; }
}
