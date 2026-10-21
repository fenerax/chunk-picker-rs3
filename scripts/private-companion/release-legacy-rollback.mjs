// Stage an immutable copy of the already accepted running distribution.
// This grants no forward gate authority and performs no lifecycle operation.
import path from 'node:path';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hashTree, digestValue } from './release-identity.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const decode = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
async function noLinks(file) {
  if (!path.isAbsolute(file)) throw new Error('Legacy rollback paths must be absolute.');
  let current = path.resolve(file);
  while (true) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Legacy rollback links refused.');
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
async function regular(file) {
  await noLinks(file); const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Legacy rollback regular input required.');
  return file;
}
async function pinned(pin) {
  if (!pin || !path.isAbsolute(pin.path ?? '') || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw new Error('Legacy rollback pin required.');
  const bytes = await readFile(await regular(pin.path));
  if (sha(bytes) !== pin.sha256) throw new Error('Legacy rollback pinned bytes changed.');
  return bytes;
}
function relative(value) {
  if (typeof value !== 'string' || /[\\:%*?"<>|\u0000-\u001f]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()) || /[. ]$/.test(part))) throw new Error('Legacy rollback payload path refused.');
  return value;
}
function gitAt(repo) {
  return (...args) => {
    const extra = typeof args.at(-1) === 'object' ? args.pop() : {};
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repo, ...args], { windowsHide: true, maxBuffer: 64 * 1024 ** 2, stdio: ['pipe', 'pipe', 'pipe'], ...extra });
  };
}
function assertRunningCore(git, revision) {
  if (git('rev-parse', '--verify', 'HEAD').toString().trim() !== revision) throw new Error('Legacy running core revision differs.');
  git('diff', '--exit-code', revision, '--'); git('diff', '--cached', '--exit-code', revision, '--');
  // Runtime files are outside the source contract. Ignored source elsewhere is
  // still an untracked input and cannot be silently adopted as accepted code.
  const untracked = git('ls-files', '--others', '-z').toString().split('\0').filter(Boolean);
  if (untracked.some(name => !name.startsWith('.local/'))) throw new Error('Legacy running core has untracked source.');
}

export async function stageLegacyRollback({ kit, repo, revision, previousConfigPath, privateFiles, packs, exportCore, captureIdentity }) {
  if (![kit, repo, previousConfigPath].every(value => typeof value === 'string' && path.isAbsolute(value)) || !/^[a-f0-9]{40}$/.test(revision ?? '') || typeof exportCore !== 'function' || typeof captureIdentity !== 'function') throw new Error('Legacy rollback staging arguments invalid.');
  await noLinks(kit); await noLinks(repo);
  const previousBytes = await readFile(await regular(previousConfigPath)), previousConfig = decode(previousBytes);
  await noLinks(previousConfig.coreRoot);
  const sourceGit = gitAt(previousConfig.coreRoot), exportGit = gitAt(repo);
  assertRunningCore(sourceGit, revision);
  if (exportGit('rev-parse', '--verify', `${revision}^{commit}`).toString().trim() !== revision) throw new Error('Legacy export revision differs.');
  const modes = exportGit('ls-tree', '-r', revision).toString().trim().split('\n');
  if (modes.some(row => !/^100(?:644|755) blob [a-f0-9]{40}\t/.test(row))) throw new Error('Legacy export contains non-regular source.');
  const profileBytes = await pinned(previousConfig.profile), addonBytes = await pinned(previousConfig.addons);
  const addon = decode(addonBytes), addonRoot = path.dirname(previousConfig.addons.path);
  if (path.basename(previousConfig.addons.path) !== 'addon.json' || addon.schemaVersion !== 1 || !Array.isArray(addon.files)) throw new Error('Legacy addon manifest invalid.');
  const expected = new Map();
  for (const item of addon.files) {
    const name = relative(item.path);
    if (name.toLowerCase() === 'addon.json' || expected.has(name.toLowerCase()) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('Legacy addon inventory invalid.');
    expected.set(name.toLowerCase(), { path: name, sha256: item.sha256 });
  }
  const inventory = await hashTree(addonRoot);
  if (inventory.files.length !== expected.size + 1 || inventory.files.some(file => file.path !== 'addon.json' && expected.get(file.path.toLowerCase())?.sha256 !== file.sha256)) throw new Error('Legacy addon inventory differs.');
  const payloads = new Map();
  for (const item of expected.values()) payloads.set(item.path, await pinned({ path: path.join(addonRoot, item.path), sha256: item.sha256 }));
  for (const name of ['app/data/changelog.json', 'app/data/roadmap.json']) if (!payloads.has(name)) throw new Error('Legacy accepted prose is missing.');
  if (!Array.isArray(privateFiles) || !privateFiles.length || privateFiles.some(item => !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') || !relative(item.path))) throw new Error('Legacy private source inventory invalid.');
  const privateInventory = await hashTree(path.join(kit, 'checks/private-source'));
  const privateExpected = new Map(privateFiles.map(item => [item.path, item.sha256]));
  if (privateExpected.size !== privateFiles.length || privateInventory.files.length !== privateExpected.size || privateInventory.files.some(file => privateExpected.get(file.path) !== file.sha256)) throw new Error('Legacy frozen private source differs.');
  for (const kind of ['data', 'rulesText', 'art']) if (!packs?.[kind] || packs[kind].sha256 !== previousConfig.packs?.[kind]?.sha256) throw new Error('Legacy pack transition refused.');
  if (digestValue(decode(await pinned(previousConfig.selection))) !== digestValue(packs)) throw new Error('Legacy selected packs differ.');
  for (const kind of ['data', 'rulesText', 'art']) await pinned(previousConfig.packs[kind]);

  const releaseId = 'legacy-rel1-' + revision.slice(0, 7), root = path.join(kit, 'releases', releaseId);
  await mkdir(path.join(kit, 'releases'), { recursive: true }); await noLinks(path.join(kit, 'releases'));
  await mkdir(root);
  for (const name of ['core', 'addons', 'text', '.local', 'release-gate']) await mkdir(path.join(root, name));
  await exportCore(exportGit, revision, path.join(root, 'core'));
  await writeFile(path.join(root, 'profile.json'), profileBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(root, 'addons/addon.json'), addonBytes, { flag: 'wx', mode: 0o600 });
  for (const [name, bytes] of payloads) {
    const output = path.join(root, 'addons', name); await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  }
  const textOverrides = [];
  for (const name of ['changelog.json', 'roadmap.json']) {
    const bytes = payloads.get('app/data/' + name), source = path.join(root, 'text', name);
    await writeFile(source, bytes, { flag: 'wx', mode: 0o600 }); textOverrides.push({ path: 'app/data/' + name, source, sha256: sha(bytes) });
  }
  const profile = { path: path.join(root, 'profile.json'), sha256: sha(profileBytes) };
  const addons = { path: path.join(root, 'addons/addon.json'), sha256: sha(addonBytes) };
  await save(path.join(root, 'companion.json'), { schemaVersion: 1, coreRoot: path.join(root, 'core'), privateFiles, packs, textOverrides, profile, addons });
  await save(path.join(root, 'config.json'), { ...previousConfig, coreRoot: path.join(root, 'core'), profile, addons });
  await save(path.join(root, 'pointer.json'), { schemaVersion: 2, releaseId, config: { path: path.join(root, 'config.json'), sha256: sha(await readFile(path.join(root, 'config.json'))) } });
  const previousConfigPin = { path: previousConfigPath, sha256: sha(previousBytes) };
  const migration = { runningConfig: previousConfigPin, coreRevision: revision };
  await save(path.join(root, 'request.json'), { releaseId, migration });
  const plan = { schemaVersion: 2, releaseId, revision, base: revision, repo, previousConfig: previousConfigPin, previousRelease: null, lane: 'adopted', migration };
  await save(path.join(root, 'release-plan.json'), plan);
  // Reprove read-only adoption after copying. Never label changed live inputs as
  // an accepted baseline merely because an earlier read happened to match.
  assertRunningCore(sourceGit, revision);
  if (sha(await readFile(await regular(previousConfigPath))) !== previousConfigPin.sha256 || sha(await pinned(previousConfig.profile)) !== profile.sha256 || sha(await pinned(previousConfig.addons)) !== addons.sha256 || (await hashTree(addonRoot)).digest !== inventory.digest) throw new Error('Legacy inputs changed while staging.');
  const identity = await captureIdentity(kit, root);
  if (!/^[a-f0-9]{64}$/.test(identity?.digest ?? '')) throw new Error('Legacy rollback identity invalid.');
  const createdAt = new Date().toISOString();
  await save(path.join(root, 'release.json'), { ...plan, identity, createdAt, timings: [] });
  await save(path.join(root, 'release-gate/adopted.json'), { schemaVersion: 2, kind: 'accepted-running-migration', inputDigest: identity.digest, migration, createdAt });
  return root;
}
