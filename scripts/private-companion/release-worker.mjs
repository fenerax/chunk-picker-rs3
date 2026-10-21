#!/usr/bin/env node
// One-shot private worker. Installation/scheduling belongs to the operator.
import path from 'node:path';
import { lstat, readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { queuePrivate, privateConfig, pairStatus } from './post-merge-private.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const absent = async file => { try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const within = (root, file) => { const rel = path.relative(root, file); return !!rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
const git = (repo, args) => {
  try { return execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 ** 2 }).trim(); }
  catch { fail('RS3_WORKER_GIT_REFUSED'); }
};
const ancestor = (repo, base, revision) => {
  try { execFileSync('git', ['--no-optional-locks', '-C', repo, 'merge-base', '--is-ancestor', base, revision], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch (error) { if (error.status === 1) return false; fail('RS3_WORKER_GIT_REFUSED'); }
};
async function noLinks(file, allowMissing = false) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('RS3_WORKER_PATH_REFUSED'); }
    catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
async function readJSON(file) { await noLinks(file); const stat = await lstat(file); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 ** 2) fail('RS3_WORKER_INPUT_REFUSED'); return json(file); }
async function atomicJSON(file, value) {
  await noLinks(file, true); await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function configuration(config) {
  const required = ['coreRepo', 'privateRepo', 'mergeReceiptsDir', 'pairsDir', 'accepted', 'packs', 'current', 'kitsDir', 'evidenceDir', 'jobsDir', 'savePath', 'request', 'heavyLock', 'lightLock'];
  if (!config || required.some(key => !path.isAbsolute(config[key] ?? ''))) fail('RS3_WORKER_CONFIG_REFUSED');
  if (config.source !== undefined && !path.isAbsolute(config.source)) fail('RS3_WORKER_CONFIG_REFUSED');
  if (config.publicCiRef !== undefined && (typeof config.publicCiRef !== 'string' || !/^(?:refs\/|checked-candidate\/)[A-Za-z0-9_./-]+$/.test(config.publicCiRef))) fail('RS3_WORKER_CONFIG_REFUSED');
  if (config.publicCiLocalFallback !== undefined && typeof config.publicCiLocalFallback !== 'boolean') fail('RS3_WORKER_CONFIG_REFUSED');
  if (config.concurrency !== undefined && ![1, 2, 3].includes(config.concurrency)) fail('RS3_WORKER_CONFIG_REFUSED');
  return config;
}

async function currentRelease(config) {
  const pointerBytes = await readFile(config.current);
  const pointer = await readJSON(config.current);
  if (pointer.schemaVersion !== 2 || !path.isAbsolute(pointer.config?.path ?? '') || !hash(pointer.config.sha256)) fail('RS3_WORKER_CURRENT_REFUSED');
  await noLinks(pointer.config.path);
  if (sha(await readFile(pointer.config.path)) !== pointer.config.sha256) fail('RS3_WORKER_CURRENT_REFUSED');
  const manifest = await readJSON(path.join(path.dirname(pointer.config.path), 'release.json'));
  if (!commit(manifest.revision)) fail('RS3_WORKER_CURRENT_REFUSED');
  const privateCommit = manifest.pairedInput?.privateCommit ?? null;
  if (privateCommit !== null && !commit(privateCommit)) fail('RS3_WORKER_CURRENT_REFUSED');
  return { revision: manifest.revision, privateCommit, pointerSha256: sha(pointerBytes) };
}

async function pinnedFiles(config) {
  for (const file of [config.request, path.join(config.packs, 'selection.json')]) await noLinks(file);
  return { requestSha256: sha(await readFile(config.request)), selectionSha256: sha(await readFile(path.join(config.packs, 'selection.json'))) };
}

// Pair receipts are local input declarations, never a substitute for real gates.
export async function selectCandidate(rawConfig) {
  const config = configuration(rawConfig);
  for (const file of [config.coreRepo, config.privateRepo, config.current]) await noLinks(file);
  if (git(config.coreRepo, ['rev-parse', '--is-shallow-repository']) !== 'false' || git(config.privateRepo, ['rev-parse', '--is-shallow-repository']) !== 'false') fail('RS3_WORKER_HISTORY_REFUSED');
  if (git(config.privateRepo, ['remote'])) fail('RS3_WORKER_PRIVATE_REMOTE_REFUSED');
  const live = await currentRelease(config), pins = await pinnedFiles(config);
  const main = git(config.coreRepo, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  const history = git(config.coreRepo, ['rev-list', '--first-parent', main]).split('\n');
  const liveIndex = history.indexOf(live.revision);
  if (liveIndex < 0) fail('RS3_WORKER_HISTORY_REFUSED');
  for (const revision of history.slice(0, liveIndex + (live.privateCommit ? 1 : 0))) {
    const mergeFile = path.join(config.mergeReceiptsDir, revision + '.json'), pairFile = path.join(config.pairsDir, revision + '.json');
    if (await absent(mergeFile) || await absent(pairFile)) continue;
    const merged = await readJSON(mergeFile), pair = await readJSON(pairFile);
    if (merged.schemaVersion !== 1 || merged.status !== 'merged-not-live' || merged.squash !== revision || merged.check?.[revision]?.passed !== true) continue;
    if (pair.schema !== 'rs3-release-pair-v1' || pair.core !== revision || !commit(pair.privateCommit) || pair.green !== true ||
      pair.packs?.selectionSha256 !== pins.selectionSha256 || pair.requestSha256 !== pins.requestSha256 || !hash(pair.profile?.sha256) || !hash(pair.gatePolicy?.sha256)) continue;
    if (revision === live.revision && (pair.privateCommit === live.privateCommit || !ancestor(config.privateRepo, live.privateCommit, pair.privateCommit))) continue;
    // An object merely left in the Git object database is not accepted input.
    if (git(config.privateRepo, ['rev-parse', '--verify', pair.privateCommit + '^{commit}']) !== pair.privateCommit || !git(config.privateRepo, ['for-each-ref', '--contains=' + pair.privateCommit, '--format=%(refname)', 'refs/heads'])) continue;
    const pairDigest = sha(JSON.stringify(pair));
    const key = sha(JSON.stringify({ revision, privateCommit: pair.privateCommit, pairDigest, live, pins }));
    return { id: 'auto-' + revision.slice(0, 10) + '-' + key.slice(0, 16), core: revision, privateCommit: pair.privateCommit,
      pair, pairDigest, mergeReceiptDigest: sha(JSON.stringify(merged)), ...pins, base: live.revision, currentPointerSha256: live.pointerSha256 };
  }
  return null;
}

// This legacy entrypoint now queues checks only. Go-live stays an explicit,
// separately authorized operator action; no staging/promotion adapter is loaded.
export async function runWorker(rawConfig, injected = {}) {
  let privateSource = rawConfig.privateSource ?? rawConfig.source;
  if (!privateSource && rawConfig.privateRepo) privateSource = (await readJSON(path.join(rawConfig.privateRepo, '.private-source/capture.json'))).source;
  const normalized = { ...rawConfig, privateSource,
    acceptedKit: rawConfig.acceptedKit ?? rawConfig.accepted,
    packsDir: rawConfig.packsDir ?? rawConfig.packs,
    logsRoot: rawConfig.logsRoot ?? rawConfig.jobsDir,
    workRoot: rawConfig.workRoot };
  for (const key of Object.keys(normalized)) if (normalized[key] === undefined) delete normalized[key];
  const config = await privateConfig(normalized);
  const core = git(config.coreRepo, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  const result = await (injected.queuePrivate ?? queuePrivate)(core, config);
  return { ...result, reason: 'checks-only; go-live requires explicit operator approval', phase: 'checking', candidate: { core } };
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log('Usage: node release-worker.mjs --config ABSOLUTE_JSON\nChecks only; queues latest local-main pair under the shared heavy lock. No idle wait, staging, practice or go-live.'); return; }
  if (args.length !== 2 || args[0] !== '--config' || !path.isAbsolute(args[1])) fail('RS3_WORKER_CONFIG_REFUSED');
  const result = await runWorker(await readJSON(args[1]));
  console.log(JSON.stringify({ status: result.status, reason: result.reason, phase: result.phase }));
  if (result.status === 'failed' || result.status === 'refused') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(() => { console.error('Release worker refused; inspect its private job state.'); process.exitCode = 1; });
