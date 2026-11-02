import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareValues } from '../../../tools/calc-check/compare.mjs';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const options = Object.freeze({ cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false, reviewedOverlays: false });
export const operations = ['evaluate', 'predict', 'how-task', 'sandbox', 'area-check', 'roll-pool', 'death-estimates', 'chunk-planning', 'prepare-rules'];
export const harvestTests = ['planning.test.mjs', 'engine-hotspots.test.mjs', 'game-plugin-mapping.test.mjs'];
export async function attest(dataset, materialize, input, root) {
  if (dataset.packed || dataset.workerSelection().selection?.data) throw Error('Public tracked inputs required');
  const files = [];
  for (const record of dataset.files.filter(record => record.kind !== 'evidence' || /\.(?:json(?:\.gz)?|csv|tsv|txt)$/.test(record.path)).sort((a,b) => a.path.localeCompare(b.path))) {
    const bytes = record.kind === 'evidence' ? await readFile(path.join(root, record.path)) : await dataset.bytes(record.path);
    if (sha(bytes) !== record.sha256 || bytes.length !== record.bytes) throw Error('Input bytes failed verification');
    files.push({ path: record.path, bytes: bytes.length, sha256: sha(bytes) });
  }
  return { datasetId: dataset.datasetId, contractVersion: dataset.datasetContractVersion,
    capabilities: dataset.capabilities, definitionOverlays: dataset.definitionOverlays ?? [], overlayOrder: dataset.overlayOrder, gameDefaults: dataset.gameDefaults,
    files, valuesSHA256: sha(JSON.stringify(await materialize())), definitionsSHA256: sha(input.definitionBytes),
    optionsSHA256: sha(JSON.stringify(input.datasetOptions)), extraRulesSHA256: sha(JSON.stringify(input.extraRules ?? [])) };
}
export function verifyInputs(left, right) {
  // Compare exact serialized manifests, without result canonicalization or exclusions.
  if (JSON.stringify(left) !== JSON.stringify(right)) throw Error('Data inputs differ; no requests compared for this bundle');
  return sha(JSON.stringify(left));
}
export function resultValue(reply, type, datasetDigest, inputsSHA256) {
  // Transport envelope is outside the result. Keep all decoded gameplay values;
  // the lane comparator alone decides which nested telemetry is volatile.
  const { id, type: envelopeType, timingMs, evaluationMs, ...value } = reply;
  if (type === 'how-task' && value.result?.context) {
    if (value.result.context.datasetDigest !== datasetDigest) throw Error('Unattested how-task dataset provenance');
    value.result.context.datasetDigest = inputsSHA256;
  }
  return value;
}
export { compareValues };
export function validateEngineReport(report) {
  const counts = [report.requestPairs, report.expectedPairs, report.resultPairs, report.errorPairs,
    ...Object.values(report.successfulRequests ?? {}), ...Object.values(report.successfulSources ?? {})];
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isFinite(report.durationMs) || report.durationMs <= 0 || !Number.isFinite(report.limits?.wallMs)
    || report.format !== 'q2-engine-diff-v1' || report.complete !== true || report.exitCode !== 0 || report.errors !== 0 || report.differences !== 0
    || report.inputsVerified !== true || report.requestPairs !== report.expectedPairs || report.requestPairs < 1
    || !report.sources.synthetic || !report.sources.harvest || !report.successfulSources?.synthetic || !report.successfulSources?.harvest
    || report.resultPairs + report.errorPairs !== report.requestPairs || operations.some(type => !report.successfulRequests?.[type])
    || report.durationMs > report.limits.wallMs) throw Error('Incomplete engine differential report');
  return true;
}
