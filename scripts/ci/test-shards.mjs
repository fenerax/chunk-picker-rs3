import { readFile } from 'node:fs/promises';
import { feedbackOrder } from '../test-affected.mjs';

export function orderShardPrefix(files, selected, policy) {
  const affected = new Set(selected), prefix = files.filter(file => affected.has(file));
  // Group solo work to avoid repeatedly draining shared workers. Sentinels
  // still lead, then longest-first assignment order is retained within groups.
  return feedbackOrder([...prefix.filter(file => policy(file).solo), ...prefix.filter(file => !policy(file).solo)]);
}

export function assertPartition(files, shards) {
  const assigned = shards.flatMap(shard => shard.files);
  if (new Set(files).size !== files.length || new Set(assigned).size !== assigned.length
      || assigned.length !== files.length || files.some(file => !assigned.includes(file))) {
    throw Error('Shard inventory is incomplete or contains duplicate assignments');
  }
}

// Longest processing time first, stable filename and shard-index tie breakers.
// Serial weights are conservative: each runner may admit several shared files.
export function balanceTests(files, timings, count = 4, policy = () => ({})) {
  if (!Number.isInteger(count) || count < 1 || count > 32) throw Error('Invalid shard count');
  if (!(timings.defaultMs > 0) || Object.values(timings.files).some(ms => !Number.isFinite(ms) || ms <= 0)) throw Error('Invalid timing table');
  const weight = file => timings.files[`tests/${file}`] ?? timings.defaultMs;
  const shards = Array.from({ length: count }, () => ({ files: [], wallMs: 0, soloMs: 0, sharedMs: 0, longestMs: 0, estimatedMs: 0 }));
  const estimate = (shard, file) => {
    const solo = policy(file).solo;
    return shard.soloMs + (solo ? weight(file) : 0)
      + Math.max(shard.longestMs, solo ? 0 : weight(file), (shard.sharedMs + (solo ? 0 : weight(file))) / 6);
  };
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0))) {
    const target = shards.reduce((best, shard) => estimate(shard, file) < estimate(best, file)
      || estimate(shard, file) === estimate(best, file) && shard.wallMs < best.wallMs ? shard : best);
    target.estimatedMs = estimate(target, file);
    target.files.push(file); target.wallMs += weight(file);
    if (policy(file).solo) target.soloMs += weight(file);
    else { target.sharedMs += weight(file); target.longestMs = Math.max(target.longestMs, weight(file)); }
  }
  assertPartition(files, shards);
  return shards;
}

export async function shardTests(files, count = 4) {
  const { testRunPolicy } = await import('../test-selection.mjs');
  return balanceTests(files, JSON.parse(await readFile(new URL('./test-timings.json', import.meta.url), 'utf8')), count, testRunPolicy);
}
