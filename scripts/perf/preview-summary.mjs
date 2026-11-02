// Summarize one member's five fresh before/after calculator measurements.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values: args } = parseArgs({ options: { before: { type: 'string' }, after: { type: 'string' } } });
const before = JSON.parse(await readFile(args.before, 'utf8')).trials;
const after = JSON.parse(await readFile(args.after, 'utf8')).trials;
if (before.length !== 5 || after.length !== 5) throw Error('FiveTrialsRequired');
const stats = values => {
  if (values.some(value => !Number.isFinite(value))) throw Error('NumericMetricRequired');
  values.sort((a,b) => a-b); return { median: values[2], min: values[0], max: values[4] };
};
for (const field of ['datasetHash', 'sourceHash', 'stateHash']) if (new Set([...before,...after].map(row => row[field])).size !== 1) throw Error('InputDifference');
const hashes = {}, counts = {};
for (const key of ['pool','first','repeat','evaluate']) {
  const rows = [...before,...after].map(row => row.requests[key]);
  if (new Set(rows.map(row => row.hash)).size !== 1 || new Set(rows.map(row => row.count)).size !== 1) throw Error('ResultDifference');
  hashes[key] = rows[0].hash; counts[key] = rows[0].count;
}
if (after.some(row => row.requests.first.prepared.resultHash !== row.requests.first.resultHash
  || row.requests.repeat.prepared.resultHash !== row.requests.repeat.resultHash)) throw Error('EarlyResultDifference');
function summarize(rows, early) {
  return { startupMs: stats(rows.map(row => row.startup.wallMs)),
    visibleMs: stats(rows.map(row => early ? row.requests.first.prepared.wallMs : row.requests.first.wallMs)),
    finalMs: stats(rows.map(row => row.requests.first.wallMs)),
    repeatVisibleMs: stats(rows.map(row => early ? row.requests.repeat.prepared.wallMs : row.requests.repeat.wallMs)),
    removedWaitMs: stats(rows.map(row => row.requests.first.wallMs - row.requests.first.prepared.wallMs)),
    stagesMs: Object.fromEntries(['baselineMs','hypotheticalMs','partnerMs','predictionMs','projectionMs','serializationMs'].map(key => [key,stats(rows.map(row => row.requests.first.timingMs[key]))])),
    previewPeakBytes: stats(rows.map(row => row.requests.repeat.workerMemory.VmHWM)),
    workerPeakBytes: stats(rows.map(row => row.idle.worker.VmHWM)), workerIdleBytes: stats(rows.map(row => row.idle.worker.VmRSS)),
    parentPeakBytes: stats(rows.map(row => row.idle.parent.VmHWM)), parentIdleBytes: stats(rows.map(row => row.idle.parent.VmRSS)) };
}
const reference = summarize(before, false), candidate = summarize(after, true);
console.log(JSON.stringify({ trials: 5, datasetHash: before[0].datasetHash, sourceHash: before[0].sourceHash, stateHash: before[0].stateHash,
  inputCounts: before[0].counts, resultCounts: counts, hashes, differenceCount: 0, earlyResultDifferenceCount: 0,
  before: reference, after: candidate, medianSavingMs: reference.visibleMs.median - candidate.visibleMs.median }, null, 2));
