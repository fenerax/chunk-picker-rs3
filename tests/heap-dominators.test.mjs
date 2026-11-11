import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { dominators, compareSnapshots } from '../scripts/perf/owned-acceptance/heap-dominators.mjs';
import { attributionPairs, attributeSnapshots } from '../scripts/perf/owned-acceptance/attribution.mjs';

function fixture(links, sizes = links.map(() => 1)) {
  return { snapshot: { meta: {
    node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
    node_types: [['synthetic', 'object'], 'string', 'number', 'number', 'number'],
    edge_fields: ['type', 'name_or_index', 'to_node'],
    edge_types: [['property', 'weak'], 'string_or_number', 'node'],
  } }, strings: ['root', 'Object', 'child'],
  nodes: links.flatMap((edges, i) => [i ? 1 : 0, i ? 1 : 0, i * 2 + 1, sizes[i], edges.length]),
  edges: links.flatMap(edges => edges.flatMap(edge => [typeof edge === 'number' ? 0 : 1, 2,
    (typeof edge === 'number' ? edge : edge.weak) * 5])) };
}

test('dominators charge shared diamonds once, handle cycles and exclude weak-only retainers', () => {
  const graph = dominators(fixture([[1, 2], [3, { weak: 5 }], [3], [4], [3], []], [0, 10, 20, 30, 40, 50]));
  assert.deepEqual([...graph.idom], [-1, 0, 0, 0, 3, -1]);
  assert.deepEqual([...graph.retained], [100, 10, 20, 70, 40, 50]);
  assert.equal(graph.visited, 5);
  assert.deepEqual(graph.path(4).map(row => row.id), [1, 7, 9]);
  assert.deepEqual(graph.path(4).at(-1).via, ['property:child']);
});

test('Lengauer-Tarjan matches an independent vertex-removal oracle on cyclic graphs', () => {
  let seed = 1701;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 100; sample++) {
    const links = Array.from({ length: 12 }, (_, i) => i < 11 ? [i + 1] : []);
    for (let i = 0; i < 60; i++) links[random(12)].push(random(12));
    const reachable = omitted => {
      const seen = new Set(), todo = omitted === 0 ? [] : [0];
      while (todo.length) {
        const n = todo.pop(); if (seen.has(n)) continue;
        seen.add(n); todo.push(...links[n].filter(child => child !== omitted));
      }
      return seen;
    };
    const without = links.map((_, i) => reachable(i));
    const expected = links.map((_, n) => n === 0 ? -1 : links.map((_, d) => d)
      .filter(d => d !== n && !without[d].has(n))
      .sort((a, b) => without[b].size - without[a].size)[0]);
    const actual = dominators(fixture(links));
    assert.deepEqual([...actual.idom], expected, `sample ${sample}`);
    for (let n = 0; n < links.length; n++)
      assert.equal(actual.retained[n], links.length - without[n].size);
  }
});

test('snapshot comparisons retain signed removals, native backing sizes and exact file identities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-dominators-'));
  try {
    const first = fixture([[1, 2], [], []], [0, 10, 90]), last = fixture([[1, 2], [], []], [0, 20, 30]);
    for (const snapshot of [first, last]) {
      snapshot.snapshot.meta.node_types[0].push('native'); snapshot.nodes[10] = 2;
    }
    const before = path.join(root, 'before.heapsnapshot'), after = path.join(root, 'after.heapsnapshot');
    await writeFile(before, JSON.stringify(first)); await writeFile(after, JSON.stringify(last));
    const report = await compareSnapshots(before, after);
    assert.equal(report.gating, false);
    assert.equal(report.selfDeltaBytes, -50);
    assert.equal(report.nativeSelfDeltaBytes, -60);
    assert.equal(report.nonNativeSelfDeltaBytes, 10);
    assert.equal(report.differences.reduce((sum, row) => sum + row.selfDeltaBytes, 0), -50);
    assert.equal(report.growth.find(row => row.id === 3).retainedNonNativeDeltaBytes, 10);
    assert.equal(report.after.largest.find(row => row.id === 5).retainedNonNativeBytes, 0);
    assert.match(report.before.sha256, /^[a-f0-9]{64}$/);
    assert.notEqual(report.before.sha256, report.after.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function measuredResult() {
  let sequence = 1;
  const receipt = heap => ({ total: { heapUsed: heap }, isolates: [0, 1, 2].map(threadId => ({
    pid: threadId ? 20 : 10, threadId: threadId ? threadId - 1 : 0, sequence: sequence++,
    memory: { heapUsed: heap / 3, external: heap, arrayBuffers: heap / 2 },
  })) });
  return { mode: 'format2', commandSamples: [receipt(90)], settled: receipt(180), readOnlyWarmup: receipt(270),
    repeated: [1, 2, 3, 4].map(round => ({ round, ...receipt(270 + round * 3) })),
    mutationWarmup: receipt(360), mutationRepeated: [1, 2, 3, 4].map(round => ({ round, ...receipt(360 + round * 3) })),
    decision: { reasons: ['unattributed-growth-needs-dominators', 'growth-on-every-read-only-repeat', 'positive-mutation-repeat-heap-slope'] } };
}

test('attribution covers every measured interval and refuses a missing isolate', () => {
  const result = measuredResult(), pairs = attributionPairs(result);
  assert.equal(pairs.length, 12);
  assert(pairs.some(pair => pair.name === 'read-1-to-read-2'));
  assert(pairs.some(pair => pair.name === 'mutation-3-to-mutation-4'));
  for (const pair of pairs) {
    assert.equal(pair.isolates.length, 3);
    assert.equal(pair.isolates.reduce((sum, row) => sum + row.heapUsedDeltaBytes, 0), pair.heapUsedDeltaBytes);
    for (const row of pair.isolates) {
      assert.equal(row.beforeFile, `${row.isolate}-${row.beforeSequence}.heapsnapshot`);
      assert(row.afterSequence > row.beforeSequence);
    }
  }
  result.repeated[2].isolates.pop();
  assert.throws(() => attributionPairs(result), /same complete isolate inventory/);
});

test('automatic artifact publication preserves all rejection reasons and cannot certify acceptance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-attribution-')), result = measuredResult();
  const original = structuredClone(result);
  try {
    const receipt = await attributeSnapshots(result, root, { compare: async () => ({
      before: { sha256: 'a'.repeat(64) }, after: { sha256: 'b'.repeat(64) }, gating: false,
      nativeSelfDeltaBytes: 0, nonNativeSelfDeltaBytes: 0,
    }) });
    assert.equal(receipt.status, 'diagnostic-only');
    const manifest = JSON.parse(await readFile(path.join(root, 'dominators/index.json'), 'utf8'));
    assert.deepEqual(manifest.gateReasons, result.decision.reasons);
    assert.deepEqual(result, original);
    assert.equal(manifest.intervals.length, 12);
    const first = manifest.intervals[0].isolates[0];
    assert.equal(JSON.parse(await readFile(path.join(root, first.report), 'utf8')).gating, false);
    assert.equal(first.beforeSha256, 'a'.repeat(64));
    assert.equal(first.heapReconciliationResidualBytes, first.heapUsedDeltaBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
