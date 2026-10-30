// Summarize the count/duration/size-only output of roll-pool.mjs.
// node scripts/perf/roll-pool-summary.mjs /tmp/before.json /tmp/after.json
import { readFile } from 'node:fs/promises';

const phases = ['state-load', 'state', 'ranking', 'sandbox', 'death-estimates', 'roll', 'state-after', 'envelope'];
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0], max: sorted.at(-1) };
};
function summarize(report) {
  if (!Array.isArray(report.runs) || report.runs.length !== 5) throw new Error('Expected five trials.');
  const result = { runs: report.runs.length, phases: {} };
  for (const phase of phases) {
    const rows = report.runs.map(run => run.measurements.find(row => row.type === phase));
    if (rows.some(row => !row)) throw new Error('Missing measurement phase.');
    const sum = calls => calls.reduce((total, call) => total + call.ms, 0);
    const sites = [...new Set(rows.flatMap(row => row.calls.map(call => call.site)))];
    result.phases[phase] = { ...Object.fromEntries(['wallMs', 'loopMaxMs', 'loopP99Ms', 'rssBytes'].map(field => [field, stats(rows.map(row => row[field]))])),
      inlineCount: stats(rows.map(row => row.calls.length)), inlineMs: stats(rows.map(row => sum(row.calls))),
      sites: Object.fromEntries(sites.map(site => {
        const calls = rows.map(row => row.calls.filter(call => call.site === site));
        return [site, { count: stats(calls.map(row => row.length)), requestMs: stats(calls.map(sum)), perCallMs: stats(calls.flat().map(call => call.ms)) }];
      })), ...(phase === 'death-estimates' ? { httpStatus: rows.map(row => row.httpStatus), estimateCount: stats(rows.map(row => row.estimateCount)) } : {}) };
  }
  result.mainPeakRSSBytes = Math.max(...report.runs.map(run => run.mainPeakRSSBytes));
  result.calculatorPeakRSSBytes = Math.max(0, ...report.runs.flatMap(run => run.workerPeakRSSBytes));
  return result;
}
try {
  if (process.argv.length !== 4) throw new Error('Use before and after report paths.');
  const [before, after] = await Promise.all(process.argv.slice(2).map(async file => summarize(JSON.parse(await readFile(file, 'utf8')))));
  console.log(JSON.stringify({ before, after }, null, 2));
} catch { console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1; }
