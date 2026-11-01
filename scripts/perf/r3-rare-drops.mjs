// Compare explicit checkouts using full process-worker results. Only counts,
// hashes, durations and memory measurements leave the temporary child roots.
// Public: --baseline /tmp/start --candidate . --out /tmp/r3-public.json
// Private: also --data-dir /tmp/copied-save and the documented dataset env.
import { readFile, writeFile, mkdtemp, cp, copyFile, rm, mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'runs', 'data-dir', 'child'].map(k => [k, { type: 'string' }])) });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])) : row);
const hash = value => sha(canonical(value));
function signature(row) {
  const clean = { ...row };
  if (clean.unknownDropWarning && clean.explanation?.endsWith(clean.unknownDropWarning)) clean.explanation = clean.explanation.slice(0, -clean.unknownDropWarning.length).trimEnd();
  delete clean.unknownDropWarning; delete clean.unknownDropKills;
  return { hash: hash(clean), warning: Boolean(row.unknownDropWarning) };
}
const RULE = 'Kills before moving on from an unknown-rate drop';
async function child(config) {
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const definitions = prepareTaskDefinitions(JSON.parse((await loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8')), selectedDataset);
  const states = [];
  let sourceHash;
  if (config.privateMode) {
    const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
    const loaded = await readCopiedState(config.store); sourceHash = loaded.source.stateSha256;
    // Four versions of the copied state, each evaluated for both members.
    // Keep original rules, apply a strict cutoff, enable collection, change hint.
    for (let scenario = 0; scenario < 4; scenario++) {
      const state = structuredClone(loaded.state);
      const patch = scenario === 1 ? { 'Rare Drop': false, 'Rare Drop Amount': '1' }
        : scenario === 2 ? { 'Every Drop': true, 'All Droptables': true }
          : scenario === 3 ? { [RULE]: 4 } : {};
      for (const member of state.members) member.taskRules = { ...member.taskRules, ...patch };
      states.push(state);
    }
    if (states.reduce((n, state) => n + state.members.length, 0) !== 8) throw Error('Expected eight evaluations.');
  } else {
    const { createGroupState } = await load('app/core/state.mjs');
    const { playerControlSkills } = await load('app/core/player-controls.mjs');
    const chunks = Object.keys(definitions.chunks).filter(key => /^\d+$/.test(key)).sort();
    for (let scenario = 0; scenario < 3; scenario++) {
      const state = createGroupState(Array.from({ length: scenario ? 2 : 1 }, (_, slot) => ({
        id: `fixture-${slot}`, name: `Fixture ${slot}`, unlocked: chunks.filter((_, n) => scenario ? n % (17 + slot) === scenario : n === 0),
      })));
      state.rules['content.f2p'] = false;
      state.taskRules = { Boosting: scenario === 2, 'Every Drop': true, 'All Droptables': true };
      for (const member of state.members) member.passiveLevels = Object.fromEntries(playerControlSkills.map(skill => [skill, scenario === 0 ? 1 : scenario === 1 ? 35 : 70]));
      states.push(state);
    }
  }
  const scheduler = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } }, requestDeadlineMs: 600000 });
  const evaluations = [], durationsMs = [];
  try {
    let index = 0;
    for (const state of states) for (const member of state.members) {
      const start = performance.now();
      const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `evaluate-${index}`)).result;
      durationsMs.push(performance.now() - start);
      const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, `pool-${index++}`)).result.pool;
      evaluations.push({ inputHash: hash([state, member.id]), tasks: Object.fromEntries(result.tasks.map(row => [sha(row.id), signature(row)])), poolHash: hash(pool) });
    }
  } finally { await scheduler.close(); }
  await writeFile(config.result, JSON.stringify({ evaluations, durationsMs, sourceHash }), { mode: 0o600 });
}
function compare(before, after) {
  if (before.evaluations.length !== after.evaluations.length) throw Error('Evaluation count mismatch.');
  return before.evaluations.map((a, i) => {
    const b = after.evaluations[i];
    if (a.inputHash !== b.inputHash) throw Error('State input differs.');
    const counts = { added: 0, removed: 0, gainedWarning: 0, lostWarning: 0, otherChanges: 0, poolDifferences: Number(a.poolHash !== b.poolHash) };
    for (const id of new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])) {
      const left = a.tasks[id], right = b.tasks[id];
      if (!left) counts.added++; else if (!right) counts.removed++;
      else {
        if (left.hash !== right.hash) counts.otherChanges++;
        if (!left.warning && right.warning) counts.gainedWarning++;
        if (left.warning && !right.warning) counts.lostWarning++;
      }
    }
    return counts;
  });
}
const spread = values => { const sorted = values.toSorted((a,b) => a-b); return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out) throw Error('Explicit --baseline, --candidate and --out required.');
  const runs = Number(values.runs ?? 3);
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error('Invalid run count.');
  const privateMode = Boolean(values['data-dir']), source = privateMode ? path.resolve(values['data-dir']) : undefined;
  if (source && [values.baseline, values.candidate].some(root => !path.relative(path.resolve(root), source).startsWith('..'))) throw Error('Copied save must be outside checkouts.');
  const sourceHash = source ? sha(await readFile(path.join(source, 'state.json'))) : undefined;
  const scratch = await mkdtemp(path.join(tmpdir(), 'r3-rare-drops-'));
  const trials = [], differences = [];
  try {
    for (let run = 0; run < runs; run++) {
      const pair = [];
      for (const [slot, root] of [values.baseline, values.candidate].entries()) {
        const directory = path.join(scratch, `${run}-${slot}`), store = path.join(directory, 'game');
        await mkdir(directory, { recursive: true });
        if (source) { await cp(source, store, { recursive: true }); await copyFile(source + '.dataset.json', store + '.dataset.json'); }
        const config = { root: path.resolve(root), store, privateMode, result: path.join(directory, 'result.json') };
        const input = path.join(directory, 'config.json'); await writeFile(input, JSON.stringify(config), { mode: 0o600 });
        const start = performance.now(); let peakRSSBytes = 0;
        await new Promise((resolve, reject) => {
          const env = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process' };
          if (!privateMode) for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256']) delete env[key];
          const handle = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', input], { cwd: config.root, env, stdio: ['ignore', 'ignore', 'pipe'] });
          let diagnosticBytes = 0; handle.stderr.on('data', data => { diagnosticBytes += data.length; });
          const sample = () => {
            const rows = new Map();
            for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
              try { const status = readFileSync(`/proc/${pid}/status`, 'utf8'); rows.set(Number(pid), {
                parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 }); } catch {}
            }
            const visit = pid => (rows.get(pid)?.rss ?? 0) + [...rows].filter(([, row]) => row.parent === pid).reduce((n, [child]) => n + visit(child), 0);
            peakRSSBytes = Math.max(peakRSSBytes, visit(handle.pid));
          };
          const timer = setInterval(sample, 50);
          handle.once('error', error => { clearInterval(timer); reject(error); });
          handle.once('exit', code => { sample(); clearInterval(timer); code === 0 ? resolve() : reject(Error(`Comparison child failed: ${code}; diagnostic bytes ${diagnosticBytes}.`)); });
        });
        pair.push({ ...JSON.parse(await readFile(config.result, 'utf8')), wallMs: performance.now() - start, peakRSSBytes });
      }
      trials.push(pair.map(({ wallMs, peakRSSBytes, durationsMs }) => ({ wallMs, peakRSSBytes, evaluationMs: durationsMs })));
      differences.push(compare(pair[0], pair[1]));
      console.log(JSON.stringify({ runs: run + 1, gainedWarnings: differences.at(-1).reduce((n, row) => n + row.gainedWarning, 0) }));
    }
    if (differences.some(d => canonical(d) !== canonical(differences[0]))) throw Error('Nondeterministic differences.');
    if (source && sourceHash !== sha(await readFile(path.join(source, 'state.json')))) throw Error('Source changed.');
    const report = { runs, ...(sourceHash ? { sourceHash } : {}), differences: differences[0], trials,
      before: { wallMs: spread(trials.map(t => t[0].wallMs)), peakRSSBytes: spread(trials.map(t => t[0].peakRSSBytes)) },
      after: { wallMs: spread(trials.map(t => t[1].wallMs)), peakRSSBytes: spread(trials.map(t => t[1].peakRSSBytes)) } };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.differences.some(row => row.added || row.removed || row.otherChanges || row.lostWarning || row.poolDifferences)) process.exitCode = 1;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(values.child ? error : error.message); process.exitCode = 1; });
