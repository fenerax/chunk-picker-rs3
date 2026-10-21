import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// This module deliberately imports no application modules before selection.
export async function requireHeavyLock() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Run measurements through the shared heavy-work wrapper.');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy-work lock ownership differs.');
  process.kill(Number(pid), 0);
}

export async function selectCompanion(output) {
  const root = process.env.RS3_PERF_COMPANION_ROOT;
  if (!root) return; // Existing RS3_DATASET / profile / pack environment also works.
  const receipt = JSON.parse(await readFile(path.join(root, 'companion.json'), 'utf8'));
  await mkdir(output, { recursive: true });
  const selection = path.resolve(output, 'pack-selection.json');
  await writeFile(selection, JSON.stringify(receipt.packs));
  process.env.RS3_DATASET = 'duo-legacy';
  process.env.RS3_DATASET_PROFILE = path.resolve(root, receipt.profile.path);
  process.env.RS3_DATASET_PROFILE_SHA256 = receipt.profile.sha256;
  process.env.RS3_PACKS_DIR = path.resolve(root, 'packs');
  process.env.RS3_PACK_SELECTION = selection;
  if (receipt.addons) {
    process.env.RS3_PRIVATE_ADDON = path.resolve(root, receipt.addons.path);
    process.env.RS3_PRIVATE_ADDON_SHA256 = receipt.addons.sha256;
  }
}

export async function readScratchState(filename, { calculationOnly = false } = {}) {
  if (!filename) throw new Error('Set RS3_PERF_STATE to a disposable state.json copy.');
  const resolved = await realpath(filename);
  // Read only explicitly designated scratch; never open an installed game.
  if (!resolved.replaceAll('\\', '/').includes('/perfwalk/')) throw new Error('Save copy must be inside a perfwalk scratch directory.');
  const bytes = await readFile(resolved), document = JSON.parse(bytes);
  const state = document.state ?? document;
  const omitted = new Set(['provenance', 'history', 'taskClaims', 'progressSnapshots', 'finishLine', 'groupGoals', 'ruleReviews']);
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key)
      || !/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)) throw new Error('Invalid scratch static reference.');
    if (calculationOnly && omitted.has(key)) continue;
    const content = gunzipSync(await readFile(path.join(path.dirname(resolved), 'static', reference.id)));
    if (createHash('sha256').update(content).digest('hex') !== reference.sha256) throw new Error('Scratch static checksum differs.');
    state[key] = JSON.parse(content);
  }
  if (calculationOnly) for (const key of omitted) delete state[key];
  state.tasks ??= []; state.history ??= [];
  return { state, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export const mib = bytes => Math.round(bytes / 1048576 * 10) / 10;
