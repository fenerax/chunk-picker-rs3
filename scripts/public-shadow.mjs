import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parityInstant } from './lib/dataset-parity-clock.mjs';
import { compareShadowProfiles } from './lib/public-shadow-profile.mjs';
import { stopChild } from './perf/cdp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const fail = code => { throw Object.assign(new Error('Shadow run failed.'), { shadowCode: code }); };

async function verifyLock() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) fail('HEAVY_LOCK_REQUIRED');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) fail('HEAVY_LOCK_OWNERSHIP');
  process.kill(Number(pid), 0);
}

async function profile(appRoot, directory, mode, options, instant) {
  const env = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: options.packsDir,
    RS3_PACK_SELECTION: path.join(options.packsDir, 'selection.json'), RS3_PARITY_INSTANT: instant,
    RS3_PUBLIC_SHADOW_DISPOSABLE: '1', RS3_TASK_WORKER_MODE: 'process', RS3_LOOPBACK_PORT: '', RS3_PUBLIC_ORIGIN: '' };
  env.RS3_PARITY_RANDOM_SEED = options.randomSeed;
  for (const key of ['RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256']) delete env[key];
  if (mode === 'public') {
    env.RS3_DATASET_PROFILE = options.profile; env.RS3_DATASET_PROFILE_SHA256 = options.profileSha256;
    env.RS3_PRIVATE_ADDON = options.addons; env.RS3_PRIVATE_ADDON_SHA256 = options.addonsSha256;
  }
  const child = spawn(process.execPath, ['--expose-gc', '--import', new URL('./lib/dataset-parity-inputs.mjs', import.meta.url).href,
    fileURLToPath(new URL('./lib/public-shadow-profile.mjs', import.meta.url)), appRoot, directory, mode],
  { cwd: appRoot, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderrBytes = 0;
  child.stdout.on('data', chunk => { if (output.length < 1024 * 1024) output += chunk; });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  const timeout = setTimeout(() => { void stopChild(child); }, 15 * 60 * 1000);
  try {
    const [code] = await once(child, 'close');
    let result;
    try { result = JSON.parse(output.trim()); } catch { fail('INVALID_PROFILE_RECEIPT'); }
    if (code !== 0) return { failed: true, ...result, stderrBytes };
    return result;
  } finally { clearTimeout(timeout); await stopChild(child); }
}

export async function runPublicShadow(options) {
  await verifyLock();
  const local = await realpath(path.join(root, '.local'));
  for (const key of ['publicRoot', 'inputSave', 'packsDir', 'profile', 'addons', 'receipt']) {
    if (typeof options[key] !== 'string') fail('MISSING_ARGUMENT');
    options[key] = path.resolve(options[key]);
  }
  if (!inside(local, await realpath(options.inputSave)) || !inside(local, options.receipt)
    || inside(path.resolve(root), options.publicRoot) || !/^[a-f0-9]{64}$/.test(options.profileSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(options.addonsSha256 ?? '')) fail('ISOLATION_REQUIRED');
  const scratchRoot = path.join(local, 'public-shadow'); await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'run-'));
  try {
    const captured = await realpath(options.inputSave);
    const instant = parityInstant(JSON.parse(await readFile(path.join(captured, 'state.json'), 'utf8')));
    options.randomSeed = randomBytes(32).toString('hex');
    const profiles = [];
    for (const mode of ['private', 'public']) {
      const directory = path.join(scratch, mode);
      await cp(captured, directory, { recursive: true, dereference: false, filter: async filename => {
        if (['access-token', 'store.lock'].includes(path.basename(filename))) return false;
        const canonical = await realpath(filename);
        if (canonical !== captured && !inside(captured, canonical)) fail('SAVE_LINK_REFUSED');
        return true;
      } });
      process.stderr.write(`Shadow profile: ${mode}.\n`);
      const result = await profile(mode === 'private' ? root : options.publicRoot, directory, mode, options, instant);
      profiles.push(result);
      if (result.failed) {
        const failure = { passed: false, mode, failureStage: result.failureStage, code: result.code, stderrBytes: result.stderrBytes };
        await writeFile(options.receipt, JSON.stringify(failure, null, 2) + '\n');
        return failure;
      }
    }
    const comparison = compareShadowProfiles(...profiles);
    const result = { ...comparison, profiles, applicationRoots: { private: root, public: options.publicRoot },
      addonManifestSha256: options.addonsSha256 };
    await writeFile(options.receipt, JSON.stringify(result, null, 2) + '\n');
    return { ...comparison, comparisons: Object.keys(profiles[0].hashes).length, counts: profiles[0].counts };
  } finally {
    if (!inside(scratchRoot, path.resolve(scratch))) fail('CLEANUP_CONTAINMENT');
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, flags = { '--public-root': 'publicRoot', '--input-save': 'inputSave', '--packs-dir': 'packsDir', '--profile': 'profile', '--profile-sha256': 'profileSha256', '--addons': 'addons', '--addons-sha256': 'addonsSha256', '--receipt': 'receipt' };
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = flags[process.argv[index]], value = process.argv[index + 1];
      if (!key || !value || Object.hasOwn(options, key)) fail('INVALID_ARGUMENT');
      options[key] = value;
    }
    const result = await runPublicShadow(options);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.passed) process.exitCode = 1;
  } catch (error) { process.stderr.write(`Shadow run failed (${/^[A-Z_]+$/.test(error.shadowCode ?? '') ? error.shadowCode : 'OPERATOR_CHECK'}).\n`); process.exitCode = 1; }
}
