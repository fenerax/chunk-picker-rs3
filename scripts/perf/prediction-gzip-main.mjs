// Small synthetic main-thread admission benchmark; no saves, server or workers.
// node scripts/perf/prediction-gzip-main.mjs [iterations=40]
import assert from 'node:assert/strict';
import { isMainThread } from 'node:worker_threads';
import { createUnlockResultCache } from '../../app/tasks/unlock-reuse.mjs';

assert.ok(isMainThread);
const iterations = Number(process.argv[2] ?? 40);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new TypeError('Invalid iteration count.');
const shared = value => {
  const bytes = Buffer.from(JSON.stringify(value)), buffer = new SharedArrayBuffer(bytes.length);
  Buffer.from(buffer).set(bytes); return buffer;
};
const stats = samples => {
  samples.sort((a, b) => a - b);
  return Object.fromEntries([['p50', .5], ['p95', .95], ['max', 1]]
    .map(([key, p]) => [key, Number(samples[Math.max(0, Math.ceil(samples.length * p) - 1)].toFixed(3))]));
};
const results = [];
for (const target of [16 * 1024, 128 * 1024, 1024 * 1024]) {
  const tasks = [];
  // Deterministic varied task text and IDs with repeated structural fields.
  // This intentionally models compressible JSON, not arbitrary binary entropy.
  let seed = 17, length = 40;
  while (length < target) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const row = { id: `synthetic-${tasks.length}-${seed.toString(16)}`, label: `Player 1 task ${tasks.length}`,
      status: 'available', explanation: `Synthetic source ${seed % 1000} is accessible in the selected chunk.`,
      sources: [{ chunkId: String(100 + seed % 200), kind: 'object', label: `Synthetic object ${seed % 500}` }] };
    tasks.push(row); length += Buffer.byteLength(JSON.stringify(row)) + 1;
  }
  const playJSON = shared({ format: 'play-v1', tasks });
  const sidebarJSON = shared({ projection: 'duo-sidebar-v1', tasks: tasks.filter((_, i) => i % 2 === 0) });
  const proposal = memberId => ({ taskInputKey: 'a'.repeat(64), sourceRevision: 0, memberId,
    playJSON, duoJSON: sidebarJSON, duoSidebarJSON: sidebarJSON });
  const pair = [proposal('player1'), proposal('player2')];
  const ownerMs = [], pairMs = [], totalMs = [];
  let retained;
  for (let i = -5; i < iterations; i++) {
    const cache = createUnlockResultCache({ limit: 4, byteLimit: 32 * 1024 * 1024 });
    const start = performance.now();
    assert.ok(cache.admit(pair[0], 3, 'synthetic-prediction'));
    const ownerEnd = performance.now();
    assert.ok(cache.admitMany(pair, 3, 'synthetic-prediction'));
    const end = performance.now();
    retained = cache.getDiagnostics().compressedBytes;
    if (i >= 0) { ownerMs.push(ownerEnd - start); pairMs.push(end - ownerEnd); totalMs.push(end - start); }
  }
  results.push({ playBytesPerOwner: playJSON.byteLength, sidebarBytesPerOwner: sidebarJSON.byteLength,
    retainedPairBytes: retained, ownerAdmissionMs: stats(ownerMs), pairAdmissionMs: stats(pairMs), totalMs: stats(totalMs) });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, iterations, warmups: 5,
  note: 'Owner progress followed by final owner+partner admission: 3 then 6 level-1 Z_SYNC_FLUSH gzip calls.', results }, null, 2));
