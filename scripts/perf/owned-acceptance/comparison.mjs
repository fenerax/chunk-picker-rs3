export const formats = Object.freeze(['format1', 'format2']);

// Both a sequential local comparison and downloaded CI receipts use this
// decision. Format 1 is the control, so its memory target is not a format-2 gate;
// its commands and publication invariant must nevertheless be complete.
export function compare(report) {
  report.comparisonErrors ??= [];
  const trials = formats.map(mode => report.results.find(row => row.mode === mode));
  const sameHashes = field => trials.every(row => Array.isArray(row?.[field]) && row[field].length > 0)
    && JSON.stringify(trials[0][field]) === JSON.stringify(trials[1][field]);
  report.equivalent = report.results.length === 2 && trials.every(Boolean)
    && sameHashes('fixtureHashes') && sameHashes('finalHashes');
  if (report.failures.length) report.comparisonErrors.push('failed-format-process');
  for (const trial of trials.filter(Boolean)) {
    if (trial.errors.length) report.comparisonErrors.push(`${trial.mode}: incomplete-command-workload`);
    if (trial.allPostPublicationIO.baseWrites !== 0) report.comparisonErrors.push(`${trial.mode}: base-rewritten-after-publication`);
  }
  const f2 = trials[1];
  if (f2 && (!report.equivalent || report.comparisonErrors.length)) {
    const reason = !report.equivalent ? 'format-comparison-mismatch' : 'format-comparison-incomplete';
    if (!f2.decision.reasons.includes(reason)) f2.decision.reasons.push(reason);
    f2.decision.acceptanceClaim = false;
    if (!report.smoke) f2.decision.status = 'reject';
  }
  return report;
}

// A pair is an OS/repetition, not a physical VM. Preserve each host separately;
// matching run identity and runtime prevents cross-dispatch or cross-SHA joins.
export function pairReports(receipts) {
  const pairs = new Map(), complete = [];
  for (const report of receipts) {
    if (!report.selectedFormat) { complete.push(compare(structuredClone(report))); continue; }
    const key = JSON.stringify([report.host.os, report.ci.freshRun]);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(report);
  }
  for (const reports of pairs.values()) {
    const first = reports[0], report = { ...structuredClone(first), selectedFormat: null,
      results: [], failures: [], comparisonErrors: [], formatHosts: {} };
    for (const mode of formats) {
      const matches = reports.filter(row => row.selectedFormat === mode);
      if (matches.length !== 1) report.comparisonErrors.push(`${mode}: expected one receipt`);
      for (const receipt of matches) {
        if (receipt.results.some(row => row.mode !== mode) || receipt.results.length > 1)
          report.comparisonErrors.push(`${mode}: unexpected trial`);
        report.results.push(...structuredClone(receipt.results));
        report.failures.push(...structuredClone(receipt.failures));
        report.formatHosts[mode] = receipt.host;
      }
    }
    if (reports.length !== 2) report.comparisonErrors.push('expected two format receipts');
    for (const receipt of reports) {
      if (['commit', 'seed', 'smoke', 'snapshots'].some(key => receipt[key] !== first[key])
        || ['node', 'v8', 'arch'].some(key => receipt.runtime[key] !== first.runtime[key])
        || ['run', 'attempt', 'freshRun'].some(key => receipt.ci[key] !== first.ci[key]))
        report.comparisonErrors.push('mismatched format receipt metadata');
    }
    complete.push(compare(report));
  }
  return complete;
}
