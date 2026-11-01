// Serial A/B evaluate diagnostic. Save bodies and bundles stay under /tmp;
// reports contain only hashes, counts, durations and memory sizes.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { deserialize, serialize } from 'node:v8';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCorpus } from '../../tools/calc-check/corpus.mjs';
import { Calculator } from '../../tools/calc-check/client.mjs';
import { hash } from '../../tools/calc-check/compare.mjs';
const { values: o } = parseArgs({ options: {
  reference: { type: 'string' }, candidate: { type: 'string' }, 'data-dir': { type: 'string' },
  output: { type: 'string' }, positions: { type: 'string', default: '4,7,19' },
  runs: { type: 'string', default: '5' }, trial: { type: 'string' }, 'app-dir': { type: 'string' },
} });
const summarize = values => {
  const sorted = [...values].sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: (sorted[Math.floor((n-1)/2)] + sorted[Math.ceil((n-1)/2)]) / 2, min: sorted[0], max: sorted.at(-1) };
};
if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw new Error('NodeVersionError');
if (!path.resolve(o.output ?? '').startsWith('/tmp/')) throw new Error('OutputLocationError');
if (o.trial) {
  const { bundle, state } = deserialize(await readFile(o.trial));
  const input = hash(JSON.stringify(state)), memberIds = state.members.map(m => m.id);
  const calculator = new Calculator(`${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(o['app-dir'], 'calculator/reference/main.mjs'))}`);
  const rows = [];
  try {
    await calculator.init(bundle);
    const base = { pickerId: 'p_00000000000000000000000000000000', revision: state.revision, input, snapshotKey: JSON.stringify([state.revision, input]), memberIds };
    const prepared = await calculator.request({ ...base, type: 'prepare-rules', state: 'body' }, state).promise;
    if (prepared.header.type === 'error') throw new Error('PrepareError');
    for (let member = 0; member < memberIds.length; member++) for (const view of ['play-v1', 'full']) {
      const start = performance.now();
      const reply = await calculator.request({ ...base, type: 'evaluate', state: 'ref', memberId: memberIds[member], view, projections: ['duo', 'duo-sidebar'] }).promise;
      if (reply.header.type === 'error') throw new Error('EvaluateError');
      rows.push({ member, view, wallMs: performance.now() - start, evaluationMs: reply.header.evaluationMs, timingMs: reply.header.timingMs });
    }
    await calculator.sampleMemory();
  } finally { await calculator.close(); }
  await writeFile(o.output, JSON.stringify({ rows, latency: summarize(rows.map(r => r.wallMs)), peakRSSBytes: calculator.peakRSSBytes }));
} else {
  const scratch = await mkdtemp('/tmp/engine-cache-latency-');
  let corpus;
  try {
    corpus = await buildCorpus({ save: { dataDir: o['data-dir'] } }, 17);
    const entries = corpus.groups.flatMap(group => group.states.map(entry => ({ group, entry })));
    const positions = o.positions.split(',').map(Number), runs = Number(o.runs);
    if (!Number.isSafeInteger(runs) || runs < 5 || positions.some(n => !Number.isSafeInteger(n) || n < 0 || n >= entries.length)) throw new Error('OptionsError');
    const report = { node: process.version, manifestHash: corpus.manifestHash, corpusStates: entries.length, seed: 17, runs, trials: [], summary: {} };
    for (const position of positions) {
      const { group, entry } = entries[position], state = await entry.load();
      const input = path.join(scratch, 'input');
      await writeFile(input, serialize({ bundle: group.bundle, state }));
      for (let run = 0; run < runs; run++) for (const side of ['reference', 'candidate']) {
        const output = path.join(scratch, 'trial.json');
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--trial', input, '--app-dir', o[side], '--output', output], { stdio: ['ignore', 'ignore', 'ignore'], env: process.env });
          child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('TrialError')));
        });
        const trial = JSON.parse(await readFile(output, 'utf8'));
        report.trials.push({ position, stateHash: hash(JSON.stringify(state)), run, side, ...trial });
        report.summary[position] = Object.fromEntries(['reference', 'candidate'].map(name => {
          const selected = report.trials.filter(t => t.position === position && t.side === name);
          return [name, { trialMediansMs: summarize(selected.map(t => t.latency.median)), peakRSSBytes: summarize(selected.map(t => t.peakRSSBytes)) }];
        }));
        await writeFile(o.output, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ position, run, side, latency: trial.latency, peakRSSBytes: trial.peakRSSBytes }));
      }
    }
  } finally { await corpus?.close(); await rm(scratch, { recursive: true, force: true }); }
}
