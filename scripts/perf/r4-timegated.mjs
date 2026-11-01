// Bounded R4 comparison. One process calculator at a time; only counts, hashes,
// sizes and measurements leave temporary runs, including for private inputs.
// --baseline START --timing TIMING_ONLY --candidate . --out /tmp/counts.json
// [--runs 3] [--view full|play-v1] [--data-dir /tmp/copied-game]. Set the documented dataset/packs/
// defaults environment for private runs. TIMING_ONLY is START with just the
// activity-timing overlay/source gate and the Timegated automatic default.
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'timing', 'candidate', 'out', 'runs', 'data-dir', 'view', 'child'].map(k => [k, { type: 'string' }])) });
let privateRun = Boolean(values['data-dir']);
const view = values.view ?? 'full';
if (!['full', 'play-v1'].includes(view)) throw Error('Invalid result view.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])) : row);
const hash = value => sha(canonical(value));
const taskMap = rows => Object.fromEntries(rows.map(row => [sha(row.id), { hash: hash(row), status: row.status }]));
const poolMap = pool => Object.fromEntries(['eligible', 'excluded', 'accessible'].flatMap(kind => (pool[kind] ?? []).map(row =>
  [sha(`${kind}:${typeof row === 'string' ? row : row.id}`), hash(row)])));
const spread = values => { const sorted = values.toSorted((a, b) => a - b); const n = sorted.length;
  return { median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, min: sorted[0], max: sorted.at(-1) }; };
async function child(config) {
  privateRun = Boolean(config.source);
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const { createGroupState, validateOwnedState } = await load('app/core/state.mjs');
  const { playerControlSkills } = await load('app/core/player-controls.mjs');
  const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
  let raw;
  if (config.source) {
    const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
    raw = JSON.parse((await loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8'));
  } else raw = JSON.parse(await readFile(path.join(config.root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
  const inputHash = hash(raw);
  const definitions = prepareTaskDefinitions(raw, selectedDataset);
  const states = [];
  if (config.source) {
    const live = (await readCopiedState(config.source)).state;
    const backups = (await readdir(path.join(config.source, 'backups')))
      .filter(name => /^\d{16}-[a-f0-9]{16}\.json\.gz$/.test(name) && Number(name.slice(0, 16)) < live.revision).sort();
    const unique = [...new Map(backups.map(name => [name.slice(0, 16), name])).values()];
    if (unique.length < 7) throw Error('Eight-state sample needs seven earlier standalone revisions.');
    for (let i = 0; i < 7; i++) {
      const name = unique[Math.floor(i * (unique.length - 1) / 6)];
      const document = JSON.parse(gunzipSync(await readFile(path.join(config.source, 'backups', name))));
      for (const [field, reference] of Object.entries(document.storage?.fields ?? {})) {
        if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)) throw Error('Invalid static reference.');
        const bytes = gunzipSync(await readFile(path.join(config.source, 'static', reference.id)));
        if (sha(bytes) !== reference.sha256) throw Error('Static checksum mismatch.');
        document.state[field] = JSON.parse(bytes);
      }
      states.push(validateOwnedState(document.state));
    }
    states.push(live);
  } else {
    const chunks = Object.keys(definitions.chunks).filter(key => /^\d+$/.test(key)).sort();
    for (let i = 0; i < 7; i++) {
      const state = createGroupState(Array.from({ length: i === 1 ? 2 : 1 }, (_, slot) => ({ id: `fixture-${slot}`, name: `Fixture ${slot}`,
        unlocked: chunks.filter((id, n) => i > 1 ? n % 41 === 0 || ['10548', '14916', '14659', '14660', '8756', '12082', '12584'].includes(id) : i ? n % (17 + slot) === i : n === 0) })));
      state.rules['content.f2p'] = false;
      const taskRules = { 'All Shops': true, 'Kill X': true, 'Every Drop': true, 'All Droptables': true };
      if (i < 6) Object.assign(taskRules, { PortSkills: true, Timegated: i === 3 || i === 5 });
      for (const member of state.members) {
        member.taskRules = taskRules;
        if (i > 1) {
          member.primaryOverrides = Object.fromEntries(playerControlSkills.map(skill => [skill, true]));
          if (i === 4 || i === 5) member.maxLevels = { Thieving: 89 };
        }
      }
      states.push(state);
    }
  }
  const scheduler = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } },
    deadlineMs: 600000, startupDeadlineMs: 600000 });
  const captures = [], durationsMs = [];
  try {
    for (const [index, state] of states.entries()) {
      // Fresh generated games can share a revision. Bind the worker cache to
      // the complete input, including unlocks and level/primary controls.
      const fingerprint = hash(state);
      const members = [];
      for (const [slot, member] of state.members.entries()) {
        const start = performance.now();
        const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `eval-${index}-${slot}`, fingerprint, undefined, [], config.view)).result;
        durationsMs.push(performance.now() - start);
        const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, `pool-${index}-${slot}`, fingerprint)).result.pool;
        const byId = new Map(result.tasks.map(row => [row.id, row]));
        const active = config.view === 'play-v1' ? result.presentation.tasks.map(row => {
          if (!byId.has(row.id)) throw Error('Active task missing from fact table.');
          return byId.get(row.id);
        }) : result.presentation.tasks;
        members.push({ all: taskMap(result.tasks), active: taskMap(active), pool: poolMap(pool) });
      }
      captures.push({ stateHash: fingerprint, members });
    }
  } finally { await scheduler.close(); }
  await writeFile(config.result, JSON.stringify({ captures, durationsMs, inputHash, datasetDigest: selectedDataset.digest }), { mode: 0o600 });
}
function delta(a, b) {
  const counts = { added: 0, removed: 0, changed: 0, statusChanges: 0 };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) counts.added++;
    else if (!(key in b)) counts.removed++;
    else if (a[key].hash !== b[key].hash) { counts.changed++; if (a[key].status !== b[key].status) counts.statusChanges++; }
  }
  return counts;
}
function compare(before, after) {
  if (before.inputHash !== after.inputHash || before.captures.length !== after.captures.length) throw Error('Input mismatch.');
  return before.captures.map((state, index) => {
    const next = after.captures[index];
    if (state.stateHash !== next.stateHash || state.members.length !== next.members.length) throw Error('State mismatch.');
    const row = { state: index + 1, members: state.members.length, all: { added: 0, removed: 0, changed: 0, statusChanges: 0 },
      active: { added: 0, removed: 0, changed: 0, statusChanges: 0 }, poolDifferences: 0 };
    for (const [slot, member] of state.members.entries()) {
      for (const kind of ['all', 'active']) for (const [key, value] of Object.entries(delta(member[kind], next.members[slot][kind]))) row[kind][key] += value;
      const a = member.pool, b = next.members[slot].pool;
      row.poolDifferences += [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]).length;
    }
    return row;
  });
}
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  for (const key of ['baseline', 'timing', 'candidate', 'out']) if (!values[key]) throw Error('Missing comparison argument.');
  const runs = Number(values.runs ?? 3);
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error('Invalid run count.');
  const source = values['data-dir'] && path.resolve(values['data-dir']);
  if (source && !source.startsWith(tmpdir() + path.sep)) throw Error('Private runs require a disposable save under the temporary directory.');
  const sourceHash = source ? sha(await readFile(path.join(source, 'state.json'))) : undefined;
  const scratch = await mkdtemp(path.join(tmpdir(), 'r4-comparison-'));
  const trials = [], differences = [];
  let inputHash, datasetDigests;
  try {
    for (let run = 0; run < runs; run++) {
      const captures = [], measured = [];
      for (const [slot, root] of [values.baseline, values.timing, values.candidate].entries()) {
        const config = { root: path.resolve(root), source, view, result: path.join(scratch, `result-${run}-${slot}.json`) };
        const input = path.join(scratch, 'input.json'); await writeFile(input, JSON.stringify(config), { mode: 0o600 });
        const env = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process' };
        if (!source) for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256']) delete env[key];
        const started = performance.now(); let peakRSSBytes = 0;
        await new Promise((resolve, reject) => {
          const handle = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', input], { cwd: config.root, env, stdio: ['ignore', 'ignore', 'pipe'] });
          let diagnosticBytes = 0; handle.stderr.on('data', bytes => { diagnosticBytes += bytes.length; if (!source) process.stderr.write(bytes); });
          const sample = () => {
            // This sandbox does not expose /proc/PID/task/PID/children.
            const rows = new Map();
            for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
              try {
                const status = readFileSync(`/proc/${pid}/status`, 'utf8');
                rows.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
                  rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
              } catch { /* Exited between discovery and sampling. */ }
            }
            const visit = pid => (rows.get(pid)?.rss ?? 0) + [...rows].filter(([, row]) => row.parent === pid).reduce((n, [child]) => n + visit(child), 0);
            peakRSSBytes = Math.max(peakRSSBytes, visit(handle.pid));
          };
          const timer = setInterval(sample, 50);
          handle.once('error', () => { clearInterval(timer); reject(Error('Comparison could not start.')); });
          handle.once('exit', code => { sample(); clearInterval(timer); code === 0 ? resolve() : reject(Error(`Comparison child failed: ${code}; diagnostic bytes ${diagnosticBytes}.`)); });
        });
        if (!peakRSSBytes) throw Error('No process memory samples were captured.');
        const result = JSON.parse(await readFile(config.result, 'utf8'));
        console.log(JSON.stringify({ completedVariants: slot + 1, run: run + 1 }));
        measured.push({ wallMs: performance.now() - started, peakRSSBytes, evaluationMs: result.durationsMs }); captures.push(result);
      }
      inputHash = captures[0].inputHash; datasetDigests = captures.map(row => row.datasetDigest);
      trials.push(measured);
      differences.push({ total: compare(captures[0], captures[2]), Timegated: compare(captures[0], captures[1]), PortSkills: compare(captures[1], captures[2]) });
      console.log(JSON.stringify({ completedRuns: run + 1, states: differences.at(-1).total.length }));
    }
    if (differences.some(row => canonical(row) !== canonical(differences[0]))) throw Error('Nondeterministic differences.');
    if (source && sourceHash !== sha(await readFile(path.join(source, 'state.json')))) throw Error('Copied source changed.');
    const report = { runs, view, inputHash, datasetDigests, ...(sourceHash ? { sourceHash } : {}), differences: differences[0], trials,
      measurements: Object.fromEntries(['before', 'timingOnly', 'after'].map((key, slot) => [key, {
        wallMs: spread(trials.map(row => row[slot].wallMs)), peakRSSBytes: spread(trials.map(row => row[slot].peakRSSBytes)),
        evaluationMs: spread(trials.flatMap(row => row[slot].evaluationMs)),
      }])) };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(privateRun ? 'R4 comparison failed; no private diagnostics printed.' : error.stack); process.exitCode = 1; });
