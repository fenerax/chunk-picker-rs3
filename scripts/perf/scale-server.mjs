import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic large-dataset fixture for server memory trials. It tiles the
// public open-f2p batch into synthetic copies with remapped cells, identities,
// names and coordinates. Nothing comes from a game cache or the original
// picker; copied rows keep their RuneScape Wiki provenance (CC BY-NC-SA 3.0).
const root = fileURLToPath(new URL('../../', import.meta.url));
const datasetPath = 'app/datasets/open-f2p/wiki-derived/dataset.json';
export const DEFAULT_TARGET_BYTES = 130 * 1024 ** 2;
const replicated = ['cells', 'connections', 'sources', 'tasks', 'shops', 'stock', 'services', 'routes', 'quests', 'achievements',
  'achievementReview', 'equipment', 'acquisitions', 'monsters', 'drops', 'facilities', 'recipes', 'equipmentReview', 'harvests', 'dialogueSupplies'];
// Fields whose values must stay unique per copy: catalogue keys and task labels.
const uniqueNames = { shops: ['name'], tasks: ['label'], monsters: ['name'], quests: ['page'], achievements: ['page'] };

export async function readOpenF2P() {
  return JSON.parse(await readFile(path.join(root, datasetPath), 'utf8'));
}

function bounds(cells) {
  const xs = cells.map(row => row.regionX), ys = cells.map(row => row.regionY);
  return { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
}

/** Copy k of the batch. Copy 0 is the original; others shift by whole areas. */
function replica(batch, k, columns) {
  const box = bounds(batch.cells), dx = (k % columns) * box.width, dy = Math.floor(k / columns) * box.height;
  const cells = new Map(batch.cells.map(row => [row.id, String((row.regionX + dx) * 256 + row.regionY + dy)]));
  const tag = ` · S${k}`;
  const text = value => k === 0 ? value : value.replace(/(?<!\d)\d{5}(?!\d)/g, match => cells.get(match) ?? match);
  const walk = (value, key) => {
    if (typeof value === 'string') {
      const mapped = text(value);
      return k && mapped.startsWith('rs3:open-f2p:') ? `${mapped}:s${k}` : mapped;
    }
    if (Array.isArray(value)) return value.map(entry => walk(entry, key));
    if (!value || typeof value !== 'object') return value;
    if (key === 'provenance' || key === 'evidence') return value;
    const copy = {};
    for (const [field, entry] of Object.entries(value)) {
      copy[field] = k && typeof entry === 'number' && ((field === 'x' || field === 'y') && typeof value.x === 'number' && typeof value.y === 'number')
        ? entry + (field === 'x' ? dx : dy) * 64
        : k && typeof entry === 'number' && field === 'regionX' ? entry + dx
          : k && typeof entry === 'number' && field === 'regionY' ? entry + dy : walk(entry, field);
    }
    return copy;
  };
  return Object.fromEntries(replicated.map(name => [name, (batch[name] ?? []).map(row => {
    const copy = walk(row);
    if (k) for (const field of uniqueNames[name] ?? []) if (typeof copy[field] === 'string') copy[field] += tag;
    return copy;
  })]));
}

/** A tiled batch of `copies` areas joined into one walkable surface. */
export function scaleOpenF2P(batch, { copies }) {
  if (!Number.isSafeInteger(copies) || copies < 1) throw new TypeError('copies must be a positive integer.');
  const columns = Math.ceil(Math.sqrt(copies));
  const scaled = { ...batch, version: `${batch.version}-synthetic-x${copies}` };
  for (const name of replicated) scaled[name] = [];
  // Link copies at the public game's starting cell, so play can walk outward.
  const anchor = Math.max(0, batch.cells.findIndex(row => row.id === '12850')), starts = [];
  for (let k = 0; k < copies; k++) {
    const copy = replica(batch, k, columns);
    for (const name of replicated) scaled[name].push(...copy[name]);
    starts.push(copy.cells[anchor].id);
  }
  // Synthetic links keep every copy reachable from the starting area.
  for (let k = 1; k < copies; k++) scaled.connections.push({ id: `rs3:open-f2p:connection:synthetic:${k}`, from: starts[k - 1], to: starts[k],
    reason: 'Synthetic link between scaled test areas.', provenance: [] });
  scaled.coverage = Object.fromEntries(Object.entries(batch.coverage).map(([key, value]) => [key,
    typeof value === 'number' && Array.isArray(scaled[key]) ? scaled[key].length : value]));
  return scaled;
}

/** Copies needed for about `targetBytes` of dataset JSON, as written below. */
export function copiesFor(batch, targetBytes = DEFAULT_TARGET_BYTES) {
  const size = copies => Buffer.byteLength(serialize(scaleOpenF2P(batch, { copies })));
  const one = size(1), each = size(2) - one;
  return Math.max(1, Math.round((targetBytes - one) / each) + 1);
}
const serialize = batch => JSON.stringify(batch, null, 2) + '\n';

/**
 * Write a runnable application copy under `directory` (app/ and scripts/lib/)
 * whose open-f2p dataset is the scaled batch. Run the server from that copy.
 */
export async function writeScaledApp(directory, { targetBytes = DEFAULT_TARGET_BYTES, copies } = {}) {
  const batch = await readOpenF2P();
  copies ??= copiesFor(batch, targetBytes);
  const target = path.resolve(directory);
  await mkdir(path.join(target, 'scripts'), { recursive: true });
  await cp(path.join(root, 'app'), path.join(target, 'app'), { recursive: true });
  await cp(path.join(root, 'scripts', 'lib'), path.join(target, 'scripts', 'lib'), { recursive: true });
  const bytes = Buffer.from(serialize(scaleOpenF2P(batch, { copies })));
  await writeFile(path.join(target, datasetPath), bytes);
  return { appDir: path.join(target, 'app'), copies, bytes: bytes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, flag, value] = process.argv.slice(2);
  if (!directory || flag && flag !== '--mib' && flag !== '--copies') throw new TypeError('Usage: node scripts/perf/scale-server.mjs <dir> [--mib 130 | --copies N]');
  const result = await writeScaledApp(directory, flag === '--copies' ? { copies: Number(value) } : { targetBytes: Number(value ?? 130) * 1024 ** 2 });
  console.log(`Wrote ${result.copies} synthetic copies (${(result.bytes / 1024 ** 2).toFixed(1)} MiB) to ${result.appDir}`);
}
