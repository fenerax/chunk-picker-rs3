// Offline analysis of the harness's synthetic V8 snapshots. Weak edges cannot
// establish dominance. Sizes are observed V8 self/retained sizes, never JSON
// estimates, and this report cannot waive an acceptance gate.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function dominators(snapshot) {
  const { node_fields: nf, edge_fields: ef, node_types: nt, edge_types: et } = snapshot.snapshot.meta;
  const nodes = snapshot.nodes, edges = snapshot.edges, strings = snapshot.strings;
  const nw = nf.length, ew = ef.length, count = nodes.length / nw;
  const ni = Object.fromEntries(nf.map((field, i) => [field, i]));
  const ei = Object.fromEntries(ef.map((field, i) => [field, i]));
  const weak = et[ei.type].indexOf('weak'), offsets = new Uint32Array(count + 1);
  for (let n = 0; n < count; n++) offsets[n + 1] = offsets[n] + nodes[n * nw + ni.edge_count] * ew;
  const edgeTarget = e => edges[e + ei.to_node] / nw;
  const strong = e => edges[e + ei.type] !== weak;
  // Iterative DFS and Lengauer-Tarjan, so catalogue depth cannot overflow JS's
  // stack. Predecessors and buckets use compact linked arrays.
  const order = new Uint32Array(count), vertex = new Uint32Array(count + 1), parent = new Uint32Array(count);
  const stack = [0], cursor = Array.from(offsets.subarray(0, count));
  let visited = 1; order[0] = 1; vertex[1] = 0;
  while (stack.length) {
    const n = stack.at(-1), e = cursor[n];
    if (e === offsets[n + 1]) { stack.pop(); continue; }
    cursor[n] += ew;
    if (!strong(e)) continue;
    const target = edgeTarget(e);
    if (order[target]) continue;
    parent[target] = n; order[target] = ++visited; vertex[visited] = target; stack.push(target);
  }
  const heads = new Int32Array(count).fill(-1), pred = [], next = [];
  for (let n = 0; n < count; n++) if (order[n]) {
    for (let e = offsets[n]; e < offsets[n + 1]; e += ew) if (strong(e)) {
      const target = edgeTarget(e);
      pred.push(n); next.push(heads[target]); heads[target] = pred.length - 1;
    }
  }
  const semi = order.slice(), label = Uint32Array.from({ length: count }, (_, i) => i);
  const ancestor = new Int32Array(count).fill(-1), idom = new Int32Array(count).fill(-1);
  const buckets = new Int32Array(count).fill(-1), bucketNext = new Int32Array(count).fill(-1);
  const evaluate = n => {
    if (ancestor[n] === -1) return label[n];
    const chain = []; let v = n;
    while (ancestor[v] !== -1 && ancestor[ancestor[v]] !== -1) { chain.push(v); v = ancestor[v]; }
    for (let i = chain.length - 1; i >= 0; i--) {
      v = chain[i]; const a = ancestor[v];
      if (semi[label[a]] < semi[label[v]]) label[v] = label[a];
      ancestor[v] = ancestor[a];
    }
    return label[n];
  };
  for (let i = visited; i >= 2; i--) {
    const w = vertex[i], p = parent[w];
    for (let e = heads[w]; e !== -1; e = next[e]) semi[w] = Math.min(semi[w], semi[evaluate(pred[e])]);
    const s = vertex[semi[w]]; bucketNext[w] = buckets[s]; buckets[s] = w;
    ancestor[w] = p;
    for (let v = buckets[p]; v !== -1; v = bucketNext[v]) {
      const u = evaluate(v); idom[v] = semi[u] < semi[v] ? u : p;
    }
    buckets[p] = -1;
  }
  for (let i = 2; i <= visited; i++) {
    const w = vertex[i]; if (idom[w] !== vertex[semi[w]]) idom[w] = idom[idom[w]];
  }
  const retained = Float64Array.from({ length: count }, (_, n) => nodes[n * nw + ni.self_size]);
  const retainedNonNative = Float64Array.from({ length: count }, (_, n) =>
    nt[ni.type][nodes[n * nw + ni.type]] === 'native' ? 0 : nodes[n * nw + ni.self_size]);
  for (let i = visited; i >= 2; i--) {
    const n = vertex[i]; retained[idom[n]] += retained[n]; retainedNonNative[idom[n]] += retainedNonNative[n];
  }
  const type = n => nt[ni.type][nodes[n * nw + ni.type]];
  const name = n => strings[nodes[n * nw + ni.name]];
  const describe = n => ({ id: nodes[n * nw + ni.id], type: type(n),
    name: ['string', 'concatenated string', 'sliced string'].includes(type(n)) ? '(string)' : name(n).slice(0, 100),
    selfBytes: nodes[n * nw + ni.self_size], retainedBytes: retained[n], retainedNonNativeBytes: retainedNonNative[n] });
  const edgeName = e => {
    const t = et[ei.type][edges[e + ei.type]], raw = edges[e + ei.name_or_index];
    return t === 'element' || t === 'hidden' ? `${t}[${raw}]` : `${t}:${strings[raw].slice(0, 100)}`;
  };
  const path = n => {
    const result = [];
    for (let depth = 0; n >= 0 && depth < 32; depth++) {
      const p = idom[n], links = [];
      if (p !== -1) for (let e = offsets[p]; e < offsets[p + 1]; e += ew)
        if (strong(e) && edgeTarget(e) === n) links.push(edgeName(e));
      result.push({ ...describe(n), via: links }); n = p;
    }
    return result.reverse();
  };
  const retainerParent = new Int32Array(count).fill(-1), retainerEdge = new Int32Array(count).fill(-1);
  const queue = new Uint32Array(count); let head = 0, tail = 1; queue[0] = 0; retainerParent[0] = 0;
  while (head < tail) {
    const n = queue[head++];
    for (let e = offsets[n]; e < offsets[n + 1]; e += ew) if (strong(e)) {
      const to = edgeTarget(e); if (retainerParent[to] !== -1) continue;
      retainerParent[to] = n; retainerEdge[to] = e; queue[tail++] = to;
    }
  }
  const retainerPath = n => {
    const result = [];
    for (let depth = 0; n >= 0 && depth < 60; depth++) {
      result.push({ ...describe(n), via: retainerEdge[n] === -1 ? [] : [edgeName(retainerEdge[n])] });
      if (!n) break; n = retainerParent[n];
    }
    return result.reverse();
  };
  const bindingNames = new Set(['current', 'historyEncoding', 'queue', 'currentDiskSerialized', 'poolState', 'calculationSnapshot',
    'rows', 'entries', 'cache', 'stateSnapshots', 'snapshots', 'snapshotBudget', 'engine', 'seen', 'propertyNames',
    'metadata', 'retainedRecords', 'sessions', 'latestRevisions', 'pickers', 'transient']);
  const bindings = [];
  for (let n = 0; n < count; n++) if (order[n] && name(n) === 'system / Context') {
    for (let e = offsets[n]; e < offsets[n + 1]; e += ew) {
      if (et[ei.type][edges[e + ei.type]] !== 'context') continue;
      const variable = strings[edges[e + ei.name_or_index]];
      if (!bindingNames.has(variable)) continue;
      const target = edgeTarget(e), row = { scopeId: describe(n).id, variable, ...describe(target), retainerPath: retainerPath(target) };
      bindings.push(row);
      if (variable === 'current') for (let child = offsets[target]; child < offsets[target + 1]; child += ew) {
        if (et[ei.type][edges[child + ei.type]] !== 'property' || strings[edges[child + ei.name_or_index]] !== 'history') continue;
        bindings.push({ scopeId: describe(n).id, variable: 'current.history', ...describe(edgeTarget(child)), retainerPath: retainerPath(edgeTarget(child)) });
      }
    }
  }
  return { count, visited, idom, retained, describe, path, retainerPath, type, name, bindings };
}

export async function summarizeSnapshot(file, top = 40) {
  const bytes = await readFile(file), snapshot = JSON.parse(bytes);
  const graph = dominators(snapshot), objects = new Map(), groups = new Map();
  for (let n = 0; n < graph.count; n++) {
    const row = graph.describe(n), key = `${row.type}:${row.name}`;
    objects.set(row.id, { ...row, node: n });
    const group = groups.get(key) ?? { key, count: 0, selfBytes: 0 };
    group.count++; group.selfBytes += row.selfBytes; groups.set(key, group);
  }
  const largest = [...objects.values()].filter(row => row.type !== 'synthetic')
    .sort((a, b) => b.retainedBytes - a.retainedBytes).slice(0, top)
    .map(row => ({ ...row, path: graph.path(row.node), retainerPath: graph.retainerPath(row.node) }));
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'),
    nodes: graph.count, reachable: graph.visited, selfBytes: [...objects.values()].reduce((sum, row) => sum + row.selfBytes, 0),
    largest, groups: [...groups.values()].sort((a, b) => b.selfBytes - a.selfBytes), bindings: graph.bindings, objects, graph };
}

export async function compareSnapshots(beforeFile, afterFile, top = 40) {
  // Do not retain two packed snapshots: the first comparison needs IDs/sizes
  // only. The analyzer runs outside the measured process after all rounds.
  const before = await summarizeSnapshot(beforeFile, top);
  before.graph = undefined;
  const after = await summarizeSnapshot(afterFile, top);
  const differencesByObject = [...after.objects.values()].map(row => ({ ...row,
    retainedDeltaBytes: row.retainedBytes - (before.objects.get(row.id)?.retainedBytes ?? 0),
    retainedNonNativeDeltaBytes: row.retainedNonNativeBytes - (before.objects.get(row.id)?.retainedNonNativeBytes ?? 0),
    isNew: !before.objects.has(row.id) })).filter(row => row.type !== 'synthetic');
  const withPaths = row => ({ ...row, path: after.graph.path(row.node), retainerPath: after.graph.retainerPath(row.node) });
  const growth = differencesByObject.filter(row => row.retainedDeltaBytes > 0)
    .sort((a, b) => b.retainedDeltaBytes - a.retainedDeltaBytes).slice(0, top)
    .map(withPaths);
  const nonNativeGrowth = differencesByObject.filter(row => row.retainedNonNativeDeltaBytes > 0)
    .sort((a, b) => b.retainedNonNativeDeltaBytes - a.retainedNonNativeDeltaBytes).slice(0, top).map(withPaths);
  const beforeGroups = new Map(before.groups.map(row => [row.key, row])), afterGroups = new Map(after.groups.map(row => [row.key, row]));
  const differences = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].map(key => ({ key,
    before: beforeGroups.get(key) ?? { count: 0, selfBytes: 0 }, after: afterGroups.get(key) ?? { count: 0, selfBytes: 0 },
    selfDeltaBytes: (afterGroups.get(key)?.selfBytes ?? 0) - (beforeGroups.get(key)?.selfBytes ?? 0) }))
    .sort((a, b) => b.selfDeltaBytes - a.selfDeltaBytes);
  const clean = ({ objects, graph, ...receipt }) => receipt;
  const beforeBindings = new Map(before.bindings.map(row => [`${row.scopeId}:${row.variable}`, row]));
  const bindings = after.bindings.map(row => {
    const previous = beforeBindings.get(`${row.scopeId}:${row.variable}`);
    return { ...row, before: previous ? { id: previous.id, retainedBytes: previous.retainedBytes,
      retainedNonNativeBytes: previous.retainedNonNativeBytes } : null,
    retainedDeltaBytes: row.retainedBytes - (previous?.retainedBytes ?? 0),
    retainedNonNativeDeltaBytes: row.retainedNonNativeBytes - (previous?.retainedNonNativeBytes ?? 0) };
  }).sort((a, b) => b.retainedNonNativeDeltaBytes - a.retainedNonNativeDeltaBytes);
  const nativeSelfDeltaBytes = differences.filter(row => row.key.startsWith('native:')).reduce((sum, row) => sum + row.selfDeltaBytes, 0);
  return { schemaVersion: 1, algorithm: 'Lengauer-Tarjan; V8 strong edges (weak excluded)',
    gating: false, accounting: 'Native self sizes include external backing stores. Non-native snapshot sizes are diagnostic, not a replacement for process.memoryUsage().heapUsed. Retained deltas overlap and must never be summed.',
    before: clean(before), after: clean(after), selfDeltaBytes: after.selfBytes - before.selfBytes,
    nativeSelfDeltaBytes, nonNativeSelfDeltaBytes: after.selfBytes - before.selfBytes - nativeSelfDeltaBytes,
    growth, nonNativeGrowth, differences, bindings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after, output] = process.argv.slice(2);
  const report = await compareSnapshots(before, after);
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selfDeltaBytes: report.selfDeltaBytes,
    growth: report.growth.slice(0, 15).map(row => ({ bytes: row.retainedDeltaBytes, path: row.path.map(p => `${p.name}[${p.via}]`).join(' / ') })) }));
}
