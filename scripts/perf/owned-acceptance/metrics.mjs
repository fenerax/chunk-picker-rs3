import { acceptanceShape } from './profile.mjs';
export const MiB = 1024 ** 2;
export function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}
export function slope(points) {
  const n = points.length, x = points.reduce((sum, p) => sum + p.x, 0), y = points.reduce((sum, p) => sum + p.y, 0);
  const denominator = n * points.reduce((sum, p) => sum + p.x ** 2, 0) - x ** 2;
  return denominator ? (n * points.reduce((sum, p) => sum + p.x * p.y, 0) - x * y) / denominator : 0;
}
export function totals(rows) {
  const total = { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0, cpuUs: 0 };
  for (const row of rows) {
    // RSS and process.cpuUsage are process-wide: count the relay once, never
    // again for its calculator thread. Heap/backing bytes are isolate-local.
    for (const key of ['heapUsed', 'heapTotal', 'external', 'arrayBuffers']) total[key] += row.memory[key];
    if (row.threadId === 0) { total.rss += row.memory.rss; total.cpuUs += row.cpu.user + row.cpu.system; }
  }
  return total;
}
export const ioDelta = (before, after) => Object.fromEntries(Object.keys(after).map(key => [key, after[key] - (before[key] ?? 0)]));
export const measuredTimes = rows => Object.fromEntries(['wallMs', 'mainCpuMs', 'childCpuMs', 'cpuMs'].map(key =>
  [key, percentiles(rows.filter(row => row[key] !== null).map(row => row[key]))]));

export function decision(result) {
  const baseline = result.baseline.total.heapUsed;
  const states = [...result.openSamples, ...result.commandSamples, result.settled, result.readOnlyWarmup, ...result.repeated];
  const maximum = Math.max(...states.map(row => row.total.heapUsed - baseline));
  const groups = result.groups.map(row => ({ index: row.index, openBytes: row.openBytes,
    commandBytes: row.commandBytes, attributableBytes: Math.max(0, row.openBytes) + Math.max(0, row.commandBytes) }));
  const postSerialHeap = result.commandSamples.at(-1).total.heapUsed - baseline;
  const unattributedGrowthBytes = Math.max(0, maximum - postSerialHeap);
  const repeatDeltas = result.repeated.slice(1).map((row, i) => row.total.heapUsed - result.repeated[i].total.heapUsed);
  const sustainedGrowth = repeatDeltas.length >= 3 && repeatDeltas.every(bytes => bytes > 0);
  const reasons = [];
  if (!result.smoke && !acceptanceShape(result.shape)) reasons.push('required-acceptance-shape-missing');
  if (groups.some(row => row.attributableBytes > 15 * MiB)) reasons.push('attributable-group-over-15-MiB');
  // Concurrent/cache-churn growth has no honest individual owner from deltas.
  // Assign it to the largest possible outlier conservatively until dominators
  // attribute it; never hide it by spreading the growth over fifty groups.
  const worstPossibleGroupBytes = Math.max(...groups.map(row => row.attributableBytes)) + unattributedGrowthBytes;
  if (worstPossibleGroupBytes > 15 * MiB) reasons.push('unattributed-growth-needs-dominators');
  if (maximum > 750 * MiB) reasons.push('aggregate-over-750-MiB');
  if (sustainedGrowth) reasons.push('growth-on-every-read-only-repeat');
  if (result.measuredIO.baseWrites !== 0) reasons.push('base-rewritten-after-publication');
  if (result.errors.length) reasons.push('incomplete-command-workload');
  const targetMet = worstPossibleGroupBytes <= 5 * MiB && maximum <= 250 * MiB;
  return { status: result.smoke ? 'smoke-only' : reasons.length ? 'reject' : targetMet ? 'target-met' : 'within-hard-limits-target-missed',
    acceptanceClaim: !result.smoke && reasons.length === 0 && targetMet, reasons, targetMet, groups,
    maximumGroupHeapBytes: maximum, unattributedGrowthBytes, worstPossibleGroupBytes,
    perGroupBytes: percentiles(groups.map(row => row.attributableBytes)),
    openSlopeBytesPerGroup: slope([{ x: 0, y: 0 }, ...result.openSamples.map(row => ({ x: row.count, y: row.total.heapUsed - baseline }))]),
    repeatDeltas, sustainedGrowth, thresholdsBytes: { targetPerGroup: 5 * MiB, rejectPerGroup: 15 * MiB,
      targetTotal: 250 * MiB, rejectTotal: 750 * MiB } };
}
