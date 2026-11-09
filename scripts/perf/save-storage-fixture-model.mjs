// Pure timeline/arithmetic companion to save-storage-attribution.mjs.
// node scripts/perf/save-storage-fixture-model.mjs .local/save-storage-attribution-.../results.json
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, setPriority } from 'node:os';

export function fixtureTimeline({ commands = 1300, players = 4, chunks = 4096, queued = false } = {}) {
  const unlocked = Math.floor(chunks / 2), growthTicks = players * (unlocked + 6) + 2;
  const expectedTicks = players * (unlocked + 6) + 1 + commands;
  const base = Date.UTC(2026, 9, 1) + (growthTicks - expectedTicks) * 12 * 3600000;
  const standalone = new Map([[-1, { position: -1, at: base, pinned: true }]]), packed = [], passes = [];
  function maintain(position, reason) {
    const before = standalone.size, copies = [...standalone.values()].sort((a, b) => b.position - a.position);
    const keep = new Set([copies[0], copies.at(-1)]), days = new Set(), cutoff = base + position * 12 * 3600000 - 90 * 86400000;
    const removed = [];
    for (const copy of copies) {
      const day = new Date(copy.at).toISOString().slice(0, 10), checkpoint = !days.has(day); days.add(day);
      if (copy.at >= cutoff || checkpoint || keep.has(copy) || copy.pinned) continue;
      standalone.delete(copy.position); removed.push(copy.position); packed.push(copy.position);
    }
    passes.push({ position, reason, before, newlyPacked: removed.length });
  }
  for (let i = 1; i <= commands; i++) {
    // The preimage at step i contains i-1 completed note commands.
    standalone.set(i - 1, { position: i - 1, at: base + i * 12 * 3600000 });
    if (!queued && (i + 1) % 50 === 0) maintain(i, 'scheduled');
  }
  maintain(commands, 'prepareSnapshot');
  assert.equal(packed.length + standalone.size, commands + 1);
  return { growthTicks, expectedTicks, base: new Date(base).toISOString(), final: new Date(base + commands * 12 * 3600000).toISOString(),
    packed: packed.sort((a, b) => a - b), standalone: standalone.size, retained: commands + 1, passes,
    standaloneStats: passes.reduce((sum, row) => sum + row.before, 0) };
}

function interpolate(rows, position, get) {
  if (position <= rows[0].position) return get(rows[0]);
  for (let i = 1; i < rows.length; i++) if (position <= rows[i].position) {
    const previous = rows[i - 1], next = rows[i], fraction = (position - previous.position) / (next.position - previous.position);
    return get(previous) * (1 - fraction) + get(next) * fraction;
  }
  return get(rows.at(-1));
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function extrapolate(result) {
  const rows = result.rows;
  // Maintenance no longer exercises every startup path (notably History
  // hydration). Include startup-only categories in the conserved CPU total.
  const samples = [result.growth, result.initialOpen, result.replacement, ...rows.flatMap(row => [row.packing, ...row.commands])];
  const keys = [...new Set(samples.flatMap(sample => Object.keys(sample.categories)))];
  assert(rows.length > 1, 'At least two history positions are needed for fixture interpolation.');
  const timeline = fixtureTimeline({ players: result.item.size, chunks: result.shape.chunks });
  assert.deepEqual(timeline.packed, fixtureTimeline({ players: result.item.size, chunks: result.shape.chunks, queued: true }).packed,
    'Final packed set must agree when background work is delayed until the end.');
  const get = (sample, key, unit) => key === 'total' ? sample.spans.total[unit] : sample.categories[key]?.[unit] ?? 0;
  function estimate(key, unit) {
    const commandAt = position => interpolate(rows, position, row => mean(row.commands.map(sample => get(sample, key, unit))));
    const packingAt = position => interpolate(rows, position, row => get(row.packing, key, unit) / row.packed);
    const commands = Array.from({ length: 1300 }, (_, i) => commandAt(i)).reduce((sum, value) => sum + value, 0);
    const packing = timeline.packed.reduce((sum, position) => sum + packingAt(position), 0);
    const startup = [result.growth, result.initialOpen, result.replacement].reduce((sum, sample) => sum + get(sample, key, unit), 0);
    return { commands, packing, startup, total: commands + packing + startup };
  }
  const categories = Object.fromEntries(keys.map(key => [key, estimate(key, 'cpuMs')]));
  const total = estimate('total', 'cpuMs'), wall = estimate('total', 'wallMs');
  assert(Math.abs(Object.values(categories).reduce((sum, value) => sum + value.total, 0) - total.total) < 0.01);
  const sampledCommandCPU = rows.flatMap(row => row.commands.map(sample => sample.spans.total.cpuMs));
  const sampledPackingCPU = rows.map(row => row.packing.spans.total.cpuMs / row.packed);
  return { scope: 'Instrumented PC arithmetic, not a measured complete fixture or Linux calibration. No cold reopen occurs in fixture-group.',
    assumptions: 'Linear interpolation over completed note count; mean of six nearby commands; packing cost per point from two-point batches. Normal maintenance batches can be larger. Shared catalogue build, metadata-only passes and registry/key setup excluded.',
    timeline, total, wall, categories,
    sampledEnvelopeCPU: { lower: 1300 * Math.min(...sampledCommandCPU) + timeline.packed.length * Math.min(...sampledPackingCPU),
      upper: 1300 * Math.max(...sampledCommandCPU) + timeline.packed.length * Math.max(...sampledPackingCPU) },
    comparisonTo25Minutes: total.total / (25 * 60000),
    samples: rows.map(row => ({ position: row.position, packed: row.packed,
      commandMeanCPU: mean(row.commands.map(sample => sample.spans.total.cpuMs)),
      commandMeanWall: mean(row.commands.map(sample => sample.spans.total.wallMs)),
      packingCPUPerPoint: row.packing.spans.total.cpuMs / row.packed, packingWallPerPoint: row.packing.spans.total.wallMs / row.packed,
      coldCPU: row.cold.spans.total.cpuMs, coldWall: row.cold.spans.total.wallMs,
      indexCPUPerPoint: row.cold.spans.retainedArchiveIndex.cpuMs / row.packed, indexWallPerPoint: row.cold.spans.retainedArchiveIndex.wallMs / row.packed })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  const root = fileURLToPath(new URL('../../', import.meta.url)), file = path.resolve(process.argv[2] ?? '');
  assert(file.startsWith(path.join(root, '.local', 'save-storage-attribution-')) && path.basename(file) === 'results.json',
    'Only results.json from a local synthetic attribution run is accepted.');
  const result = JSON.parse(await fs.readFile(file, 'utf8')), model = extrapolate(result);
  await fs.writeFile(path.join(path.dirname(file), 'fixture-model.json'), JSON.stringify(model, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output: path.join(path.dirname(file), 'fixture-model.json'), total: model.total,
    retained: model.timeline.retained, packed: model.timeline.packed.length, categories: model.categories }, null, 2));
}
