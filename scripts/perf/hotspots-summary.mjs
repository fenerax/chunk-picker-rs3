// Summarize numeric calculator artifacts and public synthetic stack captures.
// Pass --engine, --member1, --preview, --cpu, --member1-cpu, --preview-cpu,
// --spans and --full artifact directories; stdout is sanitized evidence JSON.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { stats } from './profile-stack/report.mjs';
const { values: args } = parseArgs({ options: Object.fromEntries(['engine', 'member1', 'member1-cpu', 'preview-cpu', 'preview', 'cpu', 'spans', 'full'].map(k => [k, { type: 'string' }])) });
const artifacts = {};
async function load(key, file) {
  const bytes = await readFile(file);
  artifacts[key] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  return JSON.parse(bytes);
}
const metric = values => ({ n: values.length, ...stats(values) });
function summarize(report) {
  if (report.runs !== 5 || report.profiled || report.trials.length !== 5) throw new Error('FiveUnprofiledTrialsRequired');
  const trials = report.trials;
  for (const key of ['sourceHash', 'stateHash', 'datasetHash']) if (new Set(trials.map(t => t[key])).size !== 1) throw new Error('InputHashDifference');
  const output = { sourceHash: trials[0].sourceHash, stateHash: trials[0].stateHash, datasetHash: trials[0].datasetHash,
    counts: trials[0].counts, startup: {}, startupParts: {}, requests: {}, responses: {}, peakRSS: {} };
  for (const key of ['wallMs', 'compileMs', 'peakRSS']) output.startup[key] = metric(trials.map(t => t.startup[key]));
  for (const key of Object.keys(trials[0].startup.parts)) output.startupParts[key] = metric(trials.map(t => t.startup.parts[key] ?? 0));
  for (const key of Object.keys(trials[0].requests)) {
    const rows = trials.map(t => t.requests[key]), row = {};
    for (const field of ['wallMs', 'evaluationMs', 'peakRSS', 'ownerMs', 'bytes', 'admitted', 'messages'])
      if (rows.every(r => Number.isFinite(r?.[field]))) row[field] = metric(rows.map(r => r[field]));
    if (rows.every(r => r?.stages)) row.stages = Object.fromEntries([...new Set(rows.flatMap(r => Object.keys(r.stages)))].map(k => [k, metric(rows.map(r => r.stages[k] ?? 0))]));
    output.requests[key] = row;
  }
  for (const key of Object.keys(trials[0].responses)) output.responses[key] = Object.fromEntries(['rawBytes', 'gzipBytes', 'jsonMs', 'syncMs', 'asyncMs'].map(k => [k, metric(trials.map(t => t.responses[key][k]))]));
  for (const key of ['worker', 'parent']) output.peakRSS[key] = metric(trials.map(t => t.peakRSS[key]));
  if (trials.every(t => Number.isFinite(t.acceptCommandMs))) {
    output.acceptCommandMs = metric(trials.map(t => t.acceptCommandMs));
    output.acceptRecalculationMs = metric(trials.map(t => t.requests['accept-recalculate-0'].evaluationMs + t.requests['accept-recalculate-1'].evaluationMs));
    output.acceptRequestSumMs = metric(trials.map(t => t.requests['accept-recalculate-0'].wallMs + t.requests['accept-recalculate-1'].wallMs));
    output.admissionFinalPairMs = metric(trials.map(t => t.requests['prediction-admission'].wallMs - t.requests['prediction-admission'].ownerMs));
    output.acceptMissSumMs = metric(trials.map(t => t.acceptCommandMs + t.requests['accept-recalculate-0'].wallMs + t.requests['accept-recalculate-1'].wallMs));
    output.startupPlusFirstTasksMs = metric(trials.map(t => t.startup.wallMs + t.requests['tasks-0-cold'].wallMs));
  } else if (trials[0].requests['preview-cold']) output.startupPlusPreviewMs = metric(trials.map(t => t.startup.wallMs + t.requests['preview-cold'].wallMs));
  else {
    const key = Object.keys(trials[0].requests).find(k => /^tasks-\d+-cold$/.test(k));
    output.startupPlusTasksMs = metric(trials.map(t => t.startup.wallMs + t.requests[key].wallMs));
  }
  return output;
}
const engineRaw = await load('engine', path.join(args.engine, 'measurements.json'));
const engine = summarize(engineRaw);
const member1 = summarize(await load('member1', path.join(args.member1, 'measurements.json')));
const member1Cpu = await load('member1Cpu', path.join(args['member1-cpu'], 'measurements.json'));
const previewCpu = await load('previewCpu', path.join(args['preview-cpu'], 'measurements.json'));
const preview = summarize(await load('preview', path.join(args.preview, 'measurements.json')));
const cpu = await load('cpu', path.join(args.cpu, 'measurements.json'));
if ([cpu, member1Cpu, previewCpu].some(r => !r.profiled || r.trials.length !== 1)) throw new Error('DiagnosticProfileRequired');
const synthetic = {};
for (const mode of ['spans', 'full']) {
  const r = await load(mode, path.join(args[mode], 'profile.json'));
  if (!r.complete || r.summary.some(s => s.runs !== 5)) throw new Error('IncompleteSyntheticCapture');
  synthetic[mode] = { summary: r.summary, runDurationsMs: metric(r.runDurationsMs),
    scenarios: r.clicks.length, cpuProfiles: r.clicks.reduce((n, c) => n + c.cpu.length, 0),
    traceEvents: r.clicks.reduce((n, c) => n + c.traceEvents.length, 0),
    maxFlushSpanMs: Math.max(0, ...r.clicks.flatMap(c => c.spans.filter(s => s.name === 'http.write.flush').map(s => s.end - s.start))),
    maxEncodingSpanMs: Math.max(0, ...r.clicks.flatMap(c => c.spans.filter(s => s.name === 'response.compression-or-cache.encoded').map(s => s.end - s.start))) };
}
console.log(JSON.stringify({ engine, member1, preview, cpu: { ...cpu.trials[0].profiles, ...member1Cpu.trials[0].profiles, ...previewCpu.trials[0].profiles }, synthetic, artifacts,
  retainedOriginalRuns: engineRaw.selectedOriginalRuns, replacementRuns: engineRaw.replacements, excludedOriginalRuns: engineRaw.excludedOriginalRuns }, null, 2));
