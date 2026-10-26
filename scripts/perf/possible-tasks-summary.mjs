// Summarize the observer's raw measurements, keeping cached timing metadata
// separate from work actually performed. No app imports or external data.
// node scripts/perf/possible-tasks-summary.mjs REPORT.json > SUMMARY.md
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = values => { const measured = values.filter(Number.isFinite); return measured.length ? `${median(measured).toFixed(2)} [${Math.min(...measured).toFixed(2)}, ${Math.max(...measured).toFixed(2)}]` : 'unmeasured'; };
const event = (click, name) => click.client.find(value => value.event === name);
const serialize = click => click.events.find(value => value.event === 'serialize');
const dispatch = click => click.events.find(value => value.event === 'dispatch' && value.type === 'chunk-planning');
const worker = click => event(click, 'api')?.cache;
const computation = click => worker(click)?.hit === false ? worker(click).evaluationMs : 0;
const phase = (click, name) => worker(click)?.hit === false ? worker(click).timingMs[name] ?? 0 : 0;
const section = (run, index) => run.clicks[index];
let repeats = 0;
for (const run of report.runs) for (const [key, digest] of Object.entries(run.responses)) {
  if (!key.endsWith('/2')) continue;
  assert.equal(digest, run.responses[key.slice(0, -1) + '1'], 'Repeated planning response differs');
  repeats++;
}
let comparisons = 0;
for (const before of report.runs.filter(run => run.label === 'before')) {
  const after = report.runs.find(run => run.label === 'after' && run.pair === before.pair && run.group === before.group);
  if (!after) continue;
  assert.deepEqual(after.responses, before.responses, 'Full responses differ (cache metadata excluded)');
  comparisons += Object.keys(before.responses).length;
}
console.log(`Baseline: ${report.baseline}. Completed server/browser observations: ${report.runs.length}. Paired full-response comparisons: ${comparisons}; repeated-response comparisons: ${repeats}.`);
console.log('All timings are milliseconds: median [minimum, maximum]. RSS is sampled MiB. Each view uses fresh production servers.');
console.log('\n| Group view | Tree | First unlocked click | Second unlocked click | First locked click | Second locked click | Listen-to-ready | Server tree peak RSS | Main peak RSS |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const group of [false, true]) for (const label of ['before', 'after']) {
  const runs = report.runs.filter(run => run.group === group && run.label === label);
  const cells = [group ? 'on' : 'off', label, ...[0, 1, 2, 3].map(i => stats(runs.map(run => section(run, i).totalMs))),
    stats(runs.map(run => run.readyMs)), stats(runs.map(run => run.peakTreeRSS / 1048576)), stats(runs.map(run => run.peakMainRSS / 1048576))];
  console.log(`| ${cells.join(' | ')} |`);
}
console.log('\n| Group | Tree | Request | Foreground settle | Queue to dispatch | Worker total | Engine | Collection | Equipment | Presentation | Index | Other worker | Other request/IPC | JSON serialization | Raw bytes | Render | DOM mutation batches |');
console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const group of [false, true]) for (const label of ['before', 'after']) for (let index = 0; index < 4; index++) {
  const clicks = report.runs.filter(run => run.group === group && run.label === label).map(run => section(run, index));
  const cells = [group ? 'on' : 'off', label, ['unlocked 1', 'unlocked 2', 'locked 1', 'locked 2'][index],
    stats(clicks.map(c => event(c, 'foreground')?.ms ?? 0)), stats(clicks.map(c => dispatch(c)?.queueMs ?? 0)), stats(clicks.map(computation)),
    ...['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'planningIndexMs'].map(name => stats(clicks.map(c => phase(c, name)))),
    stats(clicks.map(c => computation(c) - ['engineMs','collectionMs','equipmentMs','presentationMs','planningIndexMs'].reduce((sum,name)=>sum+phase(c,name),0))),
    stats(clicks.map(c => worker(c) ? worker(c).requestMs - (dispatch(c)?.queueMs ?? 0) - computation(c) : 0)),
    stats(clicks.map(c => serialize(c)?.ms ?? 0)), stats(clicks.flatMap(c => serialize(c) ? [serialize(c).bytes] : [])),
    stats(clicks.map(c => event(c, 'render')?.ms ?? 0)), stats(clicks.map(c => c.mutations))];
  console.log(`| ${cells.join(' | ')} |`);
}
console.log('\nPrediction-worker compilation observed in later HTTP diagnostics (candidate clicks use the separate helper):');
for (const group of [false, true]) for (const label of ['before', 'after']) {
  const values = report.runs.filter(r => r.group === group && r.label === label).map(r => r.predictionCompileMs ?? r.rows[0].laneBefore.prediction.worker.compileMs);
  console.log(`${group ? 'on' : 'off'} ${label}: ${stats(values)}.`);
}
console.log('\nBrowser wire bytes (first unlocked):');
for (const group of [false, true]) for (const label of ['before', 'after']) {
  const resources = report.runs.filter(r => r.group === group && r.label === label).flatMap(r => r.clicks[0].resources ?? []);
  console.log(`${group ? 'on' : 'off'} ${label}: encoded ${stats(resources.map(r => r.encodedBodySize))}; decoded ${stats(resources.map(r => r.decodedBodySize))}.`);
}
console.log('\nPaired differences, after minus before (negative is faster):');
for (const group of [false, true]) {
  const differences = [];
  for (const before of report.runs.filter(r => r.group === group && r.label === 'before')) {
    const after = report.runs.find(r => r.pair === before.pair && r.group === group && r.label === 'after');
    if (after) differences.push(after.clicks[0].totalMs - before.clicks[0].totalMs);
  }
  console.log(`${group ? 'on' : 'off'} first unlocked: ${stats(differences)}; pairs ${differences.length}.`);
}
console.log('\nHTTP planning for the second member after browser cases (baseline may already be warm):');
for (const group of [false, true]) for (const label of ['before', 'after']) {
  const rows = report.runs.filter(r => r.group === group && r.label === label).map(run => run.rows.find(row => row.memberId === 'explorer-2' && row.chunkId === run.clicks[0].chunkId && row.occurrence === 1));
  console.log(`${group ? 'on' : 'off'} ${label}: request ${stats(rows.map(r => r.totalMs))}; worker ${stats(rows.map(r => r.cache.hit ? 0 : r.cache.evaluationMs))}; repeat ${stats(report.runs.filter(r => r.group === group && r.label === label).map(run => run.rows.find(row => row.memberId === 'explorer-2' && row.chunkId === run.clicks[0].chunkId && row.occurrence === 2).totalMs))}.`);
}
console.log('\nAt first unlocked admission, work already in the same lane:');
const admissions = {};
for (const run of report.runs) {
  const admitted = run.clicks[0].events.find(e => e.event === 'admit' && e.type === 'chunk-planning');
  const key = JSON.stringify({ type: admitted?.activeType ?? 'none', warm: admitted?.activeWarm ?? false, queued: admitted?.queueDepth ?? 0, warmQueued: admitted?.warmDepth ?? 0 });
  admissions[key] = (admissions[key] ?? 0) + 1;
}
for (const [key, count] of Object.entries(admissions)) console.log(`${count}: ${key}`);

if (report.runs.some(run => run.clicks.length > 4)) {
  console.log('\nBoth members after their normal foreground task list settles:');
  console.log('| Group | Member | Tree | First unlocked | Second unlocked | First locked | Second locked |');
  console.log('|---|---|---|---:|---:|---:|---:|');
  for (const group of [false, true]) for (const member of ['explorer-1', 'explorer-2']) for (const label of ['before', 'after']) {
    const runs = report.runs.filter(r => r.group === group && r.label === label);
    const clicks = run => run.clicks.filter(c => c.memberId === member);
    console.log(`| ${[group ? 'on' : 'off', member, label, ...[0,1,2,3].map(i => stats(runs.map(r => clicks(r)[i].totalMs)))].join(' | ')} |`);
    if (label === 'after') for (const run of runs) for (const click of clicks(run)) {
      const cache = worker(click);
      if (cache && !cache.hit) {
        assert.equal(cache.timingMs.engineMs ?? 0, 0, 'Candidate planning re-evaluated its baseline');
        assert.equal(dispatch(click)?.lane, 'planning', 'Candidate missed baseline handoff');
      }
    }
  }
  console.log('\nHandoff memory and encoding cost (MiB or milliseconds; median [min, max]):');
  for (const group of [false, true]) for (const label of ['before', 'after']) {
    const runs = report.runs.filter(r => r.group === group && r.label === label);
    console.log(`${group ? 'on' : 'off'} ${label}: helper RSS ${stats(runs.map(r => (r.peakPlanningRSS ?? 0) / 1048576))}; retained compressed baselines ${stats(runs.map(r => (r.planningBaselines?.bytes ?? 0) / 1048576))}; encoding mean per evaluated baseline ${stats(runs.flatMap(r => r.baselineEncoding ? [r.baselineEncoding.meanMs] : []))}.`);
  }
}
if (report.runs.some(run => run.clicks.length > 4)) {
  console.log('\nPaired first-click differences for both members, after minus before (ms):');
  for (const group of [false, true]) for (const memberId of ['explorer-1', 'explorer-2']) {
    const deltas = [];
    for (const before of report.runs.filter(r => r.label === 'before' && r.group === group)) {
      const after = report.runs.find(r => r.label === 'after' && r.group === group && r.pair === before.pair);
      if (after) deltas.push(after.clicks.find(c => c.memberId === memberId).totalMs - before.clicks.find(c => c.memberId === memberId).totalMs);
    }
    console.log(`${group ? 'on' : 'off'} ${memberId}: ${stats(deltas)}; ${deltas.length} pairs.`);
  }
}
