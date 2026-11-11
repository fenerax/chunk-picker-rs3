import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { compareSnapshots } from './heap-dominators.mjs';

const heapUsed = row => row.receipt.total.heapUsed;
const peak = rows => rows.reduce((a, b) => heapUsed(a) >= heapUsed(b) ? a : b);

// Only these barriers write snapshots (trial.mjs): the last serial command
// sample, settling, and every read-only and mutation checkpoint.
function capturedBarriers(result) {
  const serial = { name: 'serial', receipt: result.commandSamples.at(-1) };
  return [serial, { name: 'settled', receipt: result.settled },
    { name: 'read-warmup', receipt: result.readOnlyWarmup },
    ...result.repeated.map(row => ({ name: `read-${row.round}`, receipt: row })),
    { name: 'mutation-warmup', receipt: result.mutationWarmup },
    ...result.mutationRepeated.map(row => ({ name: `mutation-${row.round}`, receipt: row }))];
}

// A heap peak at an open or intermediate command sample has no snapshot, so it
// cannot be attributed. Report it explicitly instead of comparing a missing file.
export function uncoveredMaximum(result) {
  const captured = peak(capturedBarriers(result));
  const overall = peak([
    ...(result.openSamples ?? []).map(row => ({ name: `open-${row.count}`, receipt: row })),
    ...result.commandSamples.map(row => ({ name: `commands-${row.count}`, receipt: row })),
    ...capturedBarriers(result)]);
  return heapUsed(overall) > heapUsed(captured)
    ? { sample: overall.name, heapUsedBytes: heapUsed(overall), capturedMaximum: captured.name, capturedHeapUsedBytes: heapUsed(captured) }
    : null;
}

export function attributionPairs(result) {
  const phases = capturedBarriers(result), [serial] = phases;
  const maximum = peak(phases);
  const intervals = phases.slice(1).map((after, i) => ({ name: `${phases[i].name}-to-${after.name}`, before: phases[i], after }));
  if (maximum.receipt !== serial.receipt && !intervals.some(row => row.before === serial && row.after.receipt === maximum.receipt))
    intervals.unshift({ name: 'serial-to-maximum', before: serial, after: maximum });
  return intervals.map(interval => {
    const before = new Map(interval.before.receipt.isolates.map(row => [`${row.pid}-${row.threadId}`, row]));
    const after = new Map(interval.after.receipt.isolates.map(row => [`${row.pid}-${row.threadId}`, row]));
    if (before.size !== interval.before.receipt.isolates.length || after.size !== interval.after.receipt.isolates.length
      || before.size !== after.size || [...before.keys()].some(key => !after.has(key)))
      throw new Error('Snapshot attribution requires the same complete isolate inventory.');
    return { name: interval.name,
      heapUsedDeltaBytes: interval.after.receipt.total.heapUsed - interval.before.receipt.total.heapUsed,
      isolates: [...before].map(([isolate, first]) => {
        const last = after.get(isolate);
        return { isolate, beforeSequence: first.sequence, afterSequence: last.sequence,
          beforeFile: `${isolate}-${first.sequence}.heapsnapshot`, afterFile: `${isolate}-${last.sequence}.heapsnapshot`,
          heapUsedDeltaBytes: last.memory.heapUsed - first.memory.heapUsed,
          externalDeltaBytes: last.memory.external - first.memory.external,
          arrayBufferDeltaBytes: last.memory.arrayBuffers - first.memory.arrayBuffers };
      }) };
  });
}

// Invoked only after the trial and every calculator have exited. Analysis never
// allocates graphs in a measured isolate or competes with its calculator.
export async function attributeSnapshots(result, modeDirectory, { compare = compareSnapshots } = {}) {
  const directory = path.join(modeDirectory, 'dominators');
  await mkdir(directory, { recursive: true });
  const intervals = [];
  for (const interval of attributionPairs(result)) {
    const isolates = [];
    for (const isolate of interval.isolates) {
      const report = await compare(path.join(modeDirectory, 'probes', isolate.beforeFile), path.join(modeDirectory, 'probes', isolate.afterFile));
      const file = `${interval.name}-${isolate.isolate}.json`;
      await writeFile(path.join(directory, file), JSON.stringify(report, null, 2), { flag: 'wx' });
      isolates.push({ ...isolate, report: `dominators/${file}`,
        beforeSha256: report.before.sha256, afterSha256: report.after.sha256,
        snapshotNonNativeDeltaBytes: report.nonNativeSelfDeltaBytes,
        snapshotNativeDeltaBytes: report.nativeSelfDeltaBytes,
        heapReconciliationResidualBytes: isolate.heapUsedDeltaBytes - report.nonNativeSelfDeltaBytes });
    }
    intervals.push({ ...interval, isolates });
  }
  const report = { schemaVersion: 1, mode: result.mode, status: 'diagnostic-only',
    gateReasons: [...result.decision.reasons],
    uncoveredMaximum: uncoveredMaximum(result),
    interpretation: 'Dominator paths, stable-owner comparisons and snapshot self-size differences are evidence for review. They do not prove a bound on future growth, waive gates, subtract History or native bytes from heapUsed, or replace raw heap limits.',
    intervals };
  await writeFile(path.join(directory, 'index.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return { status: report.status, index: `${result.mode}/dominators/index.json`, intervals: intervals.length };
}
