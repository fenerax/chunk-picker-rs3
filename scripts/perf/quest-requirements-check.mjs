// QFIX1 comparison against an explicit checkout. Public generated games use
// tracked inputs; copied private saves use released packs and process workers.
// Only hashes, counts and measurements from private inputs leave child runs.
// Usage: node scripts/perf/quest-requirements-check.mjs --baseline /tmp/start
//   --candidate . --out /tmp/public-counts.json [--runs 3]
// Private: additionally --data-dir /tmp/copied-game, with the documented
// RS3_DATASET/RS3_PACKS_DIR/RS3_GAME_DEFAULTS_FILE environment already set.
// This bounded check does not implement the full calculator-protocol corpus.
import { readFile, writeFile, mkdtemp, cp, copyFile, rm, mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import corrections from '../../app/data/quest-requirements-corrections.2026-10-31.v1.mjs';

const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'runs', 'data-dir', 'child'].map(k => [k, { type: 'string' }])) });
if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw Error('Node 24.20+ required.');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])) : row);
const hash = value => sha(canonical(value));
const groups = [
  ["Kili's Knowledge", 'H01'], ['Barbarian Training', 'H02-H03'], ['Cold War', 'H04-H06'],
  ['Recipe for Disaster: Freeing Evil Dave', 'H07'], ['Recipe for Disaster: Freeing King Awowogei', 'H08'],
  ['Recipe for Disaster: Freeing Pirate Pete', 'H09'], ['Recipe for Disaster: Freeing Skrach Uglogwee', 'H10-H11'],
  ['Regicide', 'H12'], ["Shades of Mort'ton", 'H13'], ['God Emissaries Exploration', 'H14'],
  ["Beneath Scabaras' Sands", 'H15'], ["King's Ransom", 'H16-H17'], ['Big Chompy Bird Hunting', 'H18'],
];
const groupOf = row => groups.find(([title]) => title === row.baseQuest || title === row.record?.BaseQuest)?.[1] ?? 'outside';
const allowedLabels = new Set([...corrections.patches.filter(p => p.path[0] === 'challenges').map(p => p.path.at(-1)),
  '~|God Emissaries Exploration|~ 4', "~|Beneath Scabaras' Sands|~ 6", '~|Big Chompy Bird Hunting|~ 8']);
const taskSignature = (row, privateMode) => ({ hash: hash(row), status: row.status, group: groupOf(row), inScope: allowedLabels.has(row.rawLabel),
  ...(!privateMode ? { label: row.rawLabel ?? row.label } : {}) });
const taskMap = (rows, privateMode) => Object.fromEntries(rows.map(row => [sha(row.id), taskSignature(row, privateMode)]));
function poolMap(pool) {
  return Object.fromEntries(['eligible', 'excluded', 'accessible'].flatMap(kind => (pool[kind] ?? []).map(row =>
    [sha(`${kind}:${typeof row === 'string' ? row : row.id}`), hash(row)])));
}

async function child(config) {
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  let raw;
  if (config.privateMode) {
    const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
    raw = JSON.parse((await loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8'));
  } else raw = JSON.parse(await readFile(path.join(config.root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
  const definitions = prepareTaskDefinitions(raw, selectedDataset);
  const sourceChecks = [Object.hasOwn(definitions.chunks, 'Nature grotto'),
    Object.hasOwn(definitions.skillItems.Slayer.Mogre, "Necromancer's flippers"),
    Object.values(definitions.challenges.Archaeology).some(row => row.Output === 'Ceremonial mace'),
    Object.hasOwn(definitions.skillItems.Mining.Granite, 'Granite (5kg)'),
    Object.values(definitions.shopItems).some(row => Object.hasOwn(row, 'Raw potato'))];
  if (!sourceChecks.every(Boolean)) throw Error('Corrected source declaration missing.');
  const recordHashes = {};
  if (!config.privateMode) {
    for (const [category, rows] of Object.entries(definitions.challenges)) for (const [label, record] of Object.entries(rows)) {
      recordHashes[canonical(['challenges', category, label])] = { hash: hash(record), label, group: groupOf({ record }) };
    }
    for (const [key, value] of Object.entries(definitions)) if (key !== 'challenges') {
      if (key !== 'codeItems') recordHashes[canonical([key])] = { hash: hash(value), group: 'outside' };
      else for (const [kind, rows] of Object.entries(value)) for (const [name, record] of Object.entries(rows))
        recordHashes[canonical([key, kind, name])] = { hash: hash(record), group: 'outside' };
    }
  }
  const states = [];
  if (config.privateMode) {
    const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
    states.push((await readCopiedState(config.store)).state);
  } else {
    const { createGroupState } = await load('app/core/state.mjs');
    const { playerControlSkills } = await load('app/core/player-controls.mjs');
    const chunks = Object.keys(definitions.chunks).filter(key => /^\d+$/.test(key)).sort();
    // Fixed deterministic corpus: fresh solo, sampled duo, sampled boosted duo.
    for (let i = 0; i < 3; i++) {
      const state = createGroupState(Array.from({ length: i ? 2 : 1 }, (_, slot) => ({
        id: `fixture-${slot}`, name: `Fixture ${slot}`, unlocked: chunks.filter((_, n) => i ? n % (17 + slot) === i : n === 0),
      })));
      state.rules['content.f2p'] = false; state.taskRules = { Boosting: i === 2 };
      for (const member of state.members) member.passiveLevels = Object.fromEntries(playerControlSkills.map(skill => [skill, i === 0 ? 1 : i === 1 ? 35 : 70]));
      states.push(state);
    }
  }
  const scheduler = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } },
    requestDeadlineMs: 600000 });
  const evaluations = [], durationsMs = [];
  try {
    let index = 0;
    for (const state of states) for (const member of state.members) {
      const start = performance.now();
      const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `evaluate-${index}`)).result;
      durationsMs.push(performance.now() - start);
      const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, `pool-${index++}`)).result.pool;
      evaluations.push({ tasks: taskMap(result.tasks, config.privateMode), pool: poolMap(pool) });
    }
  } finally { await scheduler.close(); }
  await writeFile(config.result, JSON.stringify({ recordHashes, evaluations, durationsMs,
    declaredSourceChecks: sourceChecks.length, datasetDigest: selectedDataset.digest, peakParentRSSBytes: process.resourceUsage().maxRSS * 1024 }), { mode: 0o600 });
}
function compare(before, after, privateMode) {
  const result = { groups: Object.fromEntries(groups.map(([, id]) => [id, { taskRows: 0, statusChanges: 0, addedRows: 0 }])),
    outsideTaskRows: 0, outOfScopeTaskRows: 0, poolEntries: 0, definitionDifferences: 0, unexpectedDefinitionDifferences: 0,
    ...(!privateMode ? { differingRows: {} } : {}) };
  const allowedPaths = new Set(corrections.patches.map(p => canonical(p.path)));
  for (const key of new Set([...Object.keys(before.recordHashes), ...Object.keys(after.recordHashes)])) {
    if (before.recordHashes[key]?.hash === after.recordHashes[key]?.hash) continue;
    result.definitionDifferences++;
    if (!allowedPaths.has(key)) result.unexpectedDefinitionDifferences++;
  }
  if (before.evaluations.length !== after.evaluations.length) throw Error('Evaluation count mismatch.');
  for (let i = 0; i < before.evaluations.length; i++) {
    const a = before.evaluations[i], b = after.evaluations[i];
    for (const id of new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])) {
      const left = a.tasks[id], right = b.tasks[id];
      if (left?.hash === right?.hash) continue;
      const group = (right ?? left).group, counts = result.groups[group];
      if (!(right ?? left).inScope) result.outOfScopeTaskRows++;
      if (!counts) result.outsideTaskRows++;
      else {
        counts.taskRows++;
        if (!left || !right) counts.addedRows++;
        else if (left.status !== right.status) counts.statusChanges++;
      }
      if (!privateMode) { const label = (right ?? left).label; result.differingRows[label] = (result.differingRows[label] ?? 0) + 1; }
    }
    for (const id of new Set([...Object.keys(a.pool), ...Object.keys(b.pool)])) if (a.pool[id] !== b.pool[id]) result.poolEntries++;
  }
  return result;
}
const spread = values => { const sorted = values.toSorted((a,b) => a-b); return { median: sorted[Math.floor(sorted.length/2)], min: sorted[0], max: sorted.at(-1) }; };
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out) throw Error('Explicit --baseline, --candidate and --out required.');
  const runs = Number(values.runs ?? 3);
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error('Invalid run count.');
  const privateMode = Boolean(values['data-dir']);
  const source = privateMode ? path.resolve(values['data-dir']) : undefined;
  // Refuse any private source inside either checkout. All writable copies live in /tmp.
  if (source && [values.baseline, values.candidate].some(root => !path.relative(path.resolve(root), source).startsWith('..'))) throw Error('Copied save must be outside checkouts.');
  const sourceHash = source ? sha(await readFile(path.join(source, 'state.json'))) : undefined;
  const scratch = await mkdtemp(path.join(tmpdir(), 'quest-requirements-check-'));
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
              try {
                const status = readFileSync(`/proc/${pid}/status`, 'utf8');
                rows.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
                  rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
              } catch { /* Process exited between discovery and sampling. */ }
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
      differences.push(compare(pair[0], pair[1], privateMode));
      console.log(JSON.stringify({ runs: run + 1, taskRows: Object.values(differences.at(-1).groups).reduce((n, g) => n + g.taskRows, 0),
        outsideTaskRows: differences.at(-1).outsideTaskRows, poolEntries: differences.at(-1).poolEntries }));
    }
    if (differences.some(d => canonical(d) !== canonical(differences[0]))) throw Error('Nondeterministic differences.');
    if (source && sourceHash !== sha(await readFile(path.join(source, 'state.json')))) throw Error('Source changed.');
    const report = { runs, publicCorpusEvaluations: privateMode ? 0 : 5, declaredSourceChecks: 5, ...(sourceHash ? { sourceHash } : {}), differences: differences[0], trials,
      before: { wallMs: spread(trials.map(t => t[0].wallMs)), peakRSSBytes: spread(trials.map(t => t[0].peakRSSBytes)) },
      after: { wallMs: spread(trials.map(t => t[1].wallMs)), peakRSSBytes: spread(trials.map(t => t[1].peakRSSBytes)) } };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.differences.outsideTaskRows || report.differences.outOfScopeTaskRows || report.differences.unexpectedDefinitionDifferences || report.differences.poolEntries) process.exitCode = 1;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(values.child ? error : error.message); process.exitCode = 1; });
