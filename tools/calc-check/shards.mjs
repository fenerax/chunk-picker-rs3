import { readFile } from 'node:fs/promises';
import { hash } from './compare.mjs';

export function parseShard(value = '1/1') {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match) throw new TypeError('invalid-shard');
  const [index, count] = match.slice(1).map(Number);
  if (![index, count].every(Number.isSafeInteger) || index > count) throw new TypeError('invalid-shard');
  return { index, count };
}
export function partitionCorpus(corpus, shard) {
  let ordinal = 0;
  return corpus.groups.map(group => ({ ...group, states: group.states.filter(() => ordinal++ % shard.count === shard.index - 1) })).filter(group => group.states.length);
}
export function manifestFor(groups) {
  let ordinal = 0;
  return { version: 2, groups: groups.map(group => {
    const bundle = group.bundleHash ?? hash(JSON.stringify(group.bundle, (_, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
    return { bundle, states: group.states.map(entry => {
      const identity = entry.identity ?? entry.digest;
      entry.id = hash(JSON.stringify([ordinal++, bundle, entry.source, identity]));
      return { id: entry.id, source: entry.source, identity };
    }) };
  }) };
}
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const number = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => { throw new TypeError('incompatible-or-incomplete-shards'); };
export function mergeReports(reports) {
  if (!reports.length) fail();
  const first = reports[0], versions = value => stable(Object.fromEntries(['reference', 'candidate'].map(side => [side, [...value[side]].sort((a,b) => stable(a).localeCompare(stable(b)))])));
  if (!first.corpusManifest || first.corpusManifest.version !== 2 || !first.engineVersions?.reference?.length || !first.engineVersions?.candidate?.length) fail();
  const expected = first.corpusManifest.groups.flatMap(group => group.states.map(entry => entry.id));
  if (!expected.length || new Set(expected).size !== expected.length || expected.some(id => !sha(id))) fail();
  const covered = new Set(), indices = new Set();
  const result = { states: 0, comparisons: 0, requests: {}, differences: 0, errors: 0, totalWallMs: 0, maxShardWallMs: 0,
    corpusManifestHash: first.corpusManifestHash, seed: first.seed, engineVersions: first.engineVersions, shards: first.shard?.count };
  for (const report of reports) {
    const shard = report.shard;
    if (report.format !== 'calc-check-shard-report-v1' || !shard || !number(shard.index) || !number(shard.count) || shard.index < 1 || shard.count < 1 || shard.index > shard.count ||
      shard.count !== first.shard.count || !number(report.seed) || report.seed !== first.seed ||
      !sha(report.corpusManifestHash) || report.corpusManifestHash !== first.corpusManifestHash ||
      hash(JSON.stringify(report.corpusManifest)) !== report.corpusManifestHash || stable(report.corpusManifest) !== stable(first.corpusManifest) ||
      !report.engineVersions?.reference?.length || !report.engineVersions?.candidate?.length || versions(report.engineVersions) !== versions(first.engineVersions) ||
      stable(report.checkConfiguration) !== stable(first.checkConfiguration) || stable(report.volatile) !== stable(first.volatile) || indices.has(shard.index) ||
      !Array.isArray(report.stateIds) || report.corpus?.states !== report.stateIds.length ||
      !number(report.differenceCount) || !Array.isArray(report.differences) || report.differenceCount !== report.differences.length || !number(report.errors) ||
      !Number.isFinite(report.durationsMs?.total) || report.durationsMs.total < 0 || !report.requests || Object.values(report.requests).some(n => !number(n))) fail();
    const assigned = expected.filter((_, index) => index % shard.count === shard.index - 1);
    if (report.stateIds.length !== assigned.length || new Set(report.stateIds).size !== assigned.length || report.stateIds.some(id => !assigned.includes(id))) fail();
    indices.add(shard.index);
    for (const id of report.stateIds) { if (covered.has(id)) fail(); covered.add(id); }
    result.states += report.stateIds.length;
    for (const [type, count] of Object.entries(report.requests)) { result.requests[type] = (result.requests[type] ?? 0) + count; result.comparisons += count; }
    result.differences += report.differenceCount; result.errors += report.errors;
    result.totalWallMs += report.durationsMs.total; result.maxShardWallMs = Math.max(result.maxShardWallMs, report.durationsMs.total);
  }
  if (indices.size !== first.shard.count || covered.size !== expected.length || expected.some(id => !covered.has(id))) fail();
  if (!result.comparisons || ![result.states, result.comparisons, result.differences, result.errors].every(number) || !Number.isFinite(result.totalWallMs)) fail();
  return result;
}
export async function mergeReportFiles(files) {
  return mergeReports(await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8')))));
}
