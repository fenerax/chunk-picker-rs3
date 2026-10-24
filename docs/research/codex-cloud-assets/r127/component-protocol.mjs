import { writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const stages = new Set(['start', 'reference-start', 'reference-ready', 'reference-result', 'reference-close', 'measured-start', 'measured-ready', 'episode-start', 'episode-end', 'cleanup-start', 'cleanup-end', 'result', 'error']);
export function stage(name) { if (!stages.has(name)) throw new Error('unknown-stage'); writeSync(3, JSON.stringify({ stage: name }) + '\n'); }
export function metricKey(cell) {
  const mode = { 'original-sync': 'OriginalSync', 'prototype-sync': 'PrototypeSync', 'old-cooperative': 'OldCooperative', 'new-budgeted': 'NewBudgeted' }[cell.mode];
  if (!mode || !['cold', 'warm'].includes(cell.cache) || ![0, 1, 2].includes(cell.repetition)) throw new Error('invalid-cell');
  return `r127${mode}${cell.cache === 'cold' ? 'Cold' : 'Warm'}Rep${cell.repetition}Ms`;
}
export function publicCase({ count = 0, complete = false, failureCode = 'runtime-error', elapsedMs = 0, sourcePin, oracle = {}, fixtureSha256, datasetDigest, runs = [], setupMs }) {
  if (!Number.isInteger(count) || count < 0 || count > 24 || !Array.isArray(runs) || runs.length > 24 || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 1e15) throw new Error('invalid-result');
  if (!['runtime-error', 'fixture-hash-mismatch', 'controller-deadline', 'child-failed'].includes(failureCode)) throw new Error('invalid-code');
  const metrics = {};
  for (const run of runs) {
    if (!Number.isFinite(run.totalMs) || run.totalMs < 0 || run.totalMs >= 1e15) throw new Error('invalid-metric');
    const key = metricKey(run); if (Object.hasOwn(metrics, key)) throw new Error('duplicate-cell'); metrics[key] = run.totalMs;
  }
  if (setupMs !== undefined) { if (!Number.isFinite(setupMs) || setupMs < 0 || setupMs >= 1e15) throw new Error('invalid-metric'); metrics.r127SetupMs = setupMs; }
  const golden = datasetDigest === '3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9'
    && oracle.stateSHA256 === 'fa89db91597b583cf033e89d972a62bed6c856d787cf897496a3bcde9b64cbc7'
    && oracle.logicalPlanningRows === 772 && oracle.rowBytes === 408272
    && oracle.rowSHA256 === 'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519'
    && oracle.orderedIndexSHA256 === 'bd2f94e96f82fcb8c09f0a9829d06728f377b8278d4632b8364e869062c0bef0';
  const valid = complete && golden && count === 24 && runs.length === 24 && Object.keys(metrics).filter(key => key !== 'r127SetupMs').length === 24;
  const result = { schema: 'container-component-control-v1', mode: 'r127-four-mode-docker-v1', status: valid ? 'correct' : 'failed', code: valid ? 'summary' : failureCode,
    passed: valid, strictPassed: valid, frozenPassed: valid, count, durationMs: elapsedMs, sourceCommit: '6f22fefa782747790e2eaefa01e4e5ea7b557323', metrics };
  for (const [key, value] of Object.entries({ sourcePin, fixtureSha256, datasetDigest, componentStateSha256: oracle.stateSHA256, componentRowsSha256: oracle.rowSHA256, componentIndexSha256: oracle.orderedIndexSHA256 })) {
    if (value !== undefined) { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('invalid-hash'); result[key] = value; }
  }
  return result;
}
export async function writeCase(result) {
  const bytes = JSON.stringify(result) + '\n';
  if (Buffer.byteLength(bytes) > 32768) throw new Error('case-result-too-large');
  const file = await open('/scratch/case-result.json', 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
