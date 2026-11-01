// Compare an explicit START checkout with R2 using public generated states or
// the current copied save plus the first seven valid historical backups in numeric filename order.
// All private outputs are counts, hashes and measurements. Never print rows.
// Usage: node scripts/perf/r2-travel-check.mjs --baseline /tmp/r2-start
//   --candidate . --out /tmp/r2-public.json --runs 3
// Private: set the documented pack/default/process environment; additionally
// pass --data-dir /tmp/copied/game. The source checkout is never writable here.
import { readFile, writeFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { travelRewardKind, EARLY_TRAVEL_UNLOCKS_RULE } from '../../app/data/travel-reward-gates.mjs';

const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'runs', 'data-dir', 'child'].map(k => [k, { type: 'string' }])) });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const spread = values => { const sorted = values.toSorted((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
async function child(config) {
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const raw = config.privateMode ? JSON.parse((await (await load('app/dataset-bootstrap.mjs')).loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8'))
    : JSON.parse(await readFile(path.join(config.root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
  const definitions = prepareTaskDefinitions(raw, selectedDataset);
  let states;
  if (config.privateMode) {
    const { validateOwnedState } = await load('app/core/state.mjs');
    const { createRuleRegistry } = await load('app/core/rules.mjs');
    const registry = createRuleRegistry();
    const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
    states = await Promise.all(config.snapshots.map(async file => {
      if (file === path.join(config.store, 'state.json')) return (await readCopiedState(config.store)).state;
      const bytes = await readFile(file);
      const doc = JSON.parse(bytes[0] === 31 ? gunzipSync(bytes) : bytes);
      if (doc.storage) throw Error('Historical sample requires self-contained backups.');
      return validateOwnedState(doc.state, registry);
    }));
  } else {
    const { createGroupState } = await load('app/core/state.mjs');
    const { playerControlSkills } = await load('app/core/player-controls.mjs');
    const chunks = Object.keys(definitions.chunks).filter(id => /^\d+$/.test(id)).sort();
    states = [0, 1, 2].map(index => {
      const saved = createGroupState(Array.from({ length: index ? 2 : 1 }, (_, slot) => ({ id: `fixture-${slot}`, name: `Fixture ${slot}`,
        unlocked: chunks.filter((_, n) => index ? n % (17 + slot) === index : n === 0) })));
      saved.rules['content.f2p'] = false; saved.taskRules = { Boosting: index === 2 };
      for (const member of saved.members) member.passiveLevels = Object.fromEntries(playerControlSkills.map(skill => [skill, index === 0 ? 1 : index === 1 ? 35 : 70]));
      return saved;
    });
  }
  const scheduler = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } }, requestDeadlineMs: 600000 });
  const samples = [], durationsMs = [];
  try {
    for (const [stateIndex, state] of states.entries()) {
      const tasks = {};
      for (const [memberIndex, member] of state.members.entries()) {
        if (config.early) member.taskRules = { ...member.taskRules, [EARLY_TRAVEL_UNLOCKS_RULE]: true };
        const start = performance.now();
        const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `sample-${stateIndex}-${memberIndex}`)).result;
        durationsMs.push(performance.now() - start);
        for (const row of result.tasks) tasks[hash(`${memberIndex}:${row.id}`)] = {
          hash: hash(row), status: row.status,
          waiting: row.blockers.some(b => b.kind === 'useful-unlock'),
          kind: travelRewardKind(row.category, row.rawLabel, row.record) ?? 'other',
        };
      }
      samples.push({ stateHash: hash(state), tasks });
    }
  } finally { await scheduler.close(); }
  await writeFile(config.result, JSON.stringify({ samples, durationsMs, datasetDigest: selectedDataset.digest }), { mode: 0o600 });
}
function compare(before, after) {
  return before.samples.map((sample, index) => {
    const next = after.samples[index];
    const count = { added: 0, removed: 0, changed: 0, statusChanges: 0, newlyWaiting: 0, waitingReasonsAdded: 0, byKind: {} };
    for (const id of new Set([...Object.keys(sample.tasks), ...Object.keys(next.tasks)])) {
      const a = sample.tasks[id], b = next.tasks[id];
      if (!a) count.added++;
      else if (!b) count.removed++;
      else if (a.hash !== b.hash) {
        count.changed++;
        const group = count.byKind[b.kind] ??= { changed: 0, statusChanges: 0, newlyWaiting: 0, waitingReasonsAdded: 0 };
        group.changed++;
        if (a.status !== b.status) { count.statusChanges++; group.statusChanges++; }
        if (!a.waiting && b.waiting) { count.waitingReasonsAdded++; group.waitingReasonsAdded++; }
        if (a.status === 'available' && b.status === 'blocked' && b.waiting) { count.newlyWaiting++; group.newlyWaiting++; }
      }
    }
    return count;
  });
}
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out) throw Error('Explicit baseline, candidate and out required.');
  const runs = Number(values.runs ?? 3), privateMode = !!values['data-dir'];
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error('Invalid runs.');
  const directory = values['data-dir'] && path.resolve(values['data-dir']);
  if (directory && !directory.startsWith('/tmp/')) throw Error('Private data-dir must be a copy in /tmp.');
  let snapshots = [], snapshotHashes = [], rejectedBackups = 0, validBackups = 0;
  if (privateMode) {
    const backups = path.join(directory, 'backups');
    const files = (await readdir(backups)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const file of files) if (!(await stat(path.join(backups, file))).isFile()) throw Error('Expected backup files.');
    const { validateOwnedState } = await import(pathToFileURL(path.join(path.resolve(values.baseline), 'app/core/state.mjs')));
    const { createRuleRegistry } = await import(pathToFileURL(path.join(path.resolve(values.baseline), 'app/core/rules.mjs')));
    const registry = createRuleRegistry(), valid = [];
    for (const file of files) {
      const full = path.join(backups, file), bytes = await readFile(full);
      try {
        const doc = JSON.parse(bytes[0] === 31 ? gunzipSync(bytes) : bytes);
        if (doc.storage) throw Error('Not self-contained');
        validateOwnedState(doc.state, registry); valid.push(full);
        if (valid.length === 7) break;
      } catch { rejectedBackups++; }
    }
    validBackups = valid.length;
    if (valid.length < 7) throw Error('Seven valid historical states required.');
    snapshots = valid;
    snapshots.push(path.join(directory, 'state.json'));
    snapshotHashes = await Promise.all(snapshots.map(async file => hash(await readFile(file))));
  }
  const scratch = await mkdtemp(path.join(tmpdir(), 'r2-comparison-'));
  const trials = [], differences = [], earlyDifferences = [];
  try {
    for (let run = 0; run < runs; run++) {
      const pair = [];
      for (const [slot, root] of [values.baseline, values.candidate, values.candidate].entries()) {
        const config = { root: path.resolve(root), privateMode, snapshots, store: directory, early: slot === 2, result: path.join(scratch, `result-${run}-${slot}.json`) };
        const input = path.join(scratch, 'config.json');
        await writeFile(input, JSON.stringify(config), { mode: 0o600 });
        const start = performance.now(); let peakRSSBytes = 0;
        await new Promise((resolve, reject) => {
          const env = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process' };
          if (!privateMode) for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256']) delete env[key];
          const handle = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', input], { cwd: config.root, env, stdio: ['ignore', 'ignore', 'pipe'] });
          let diagnosticBytes = 0, diagnosticTail = ''; handle.stderr.on('data', data => { diagnosticBytes += data.length; diagnosticTail = (diagnosticTail + data).slice(-2048); });
          const sample = () => {
            const rows = new Map();
            for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) try {
              const text = readFileSync(`/proc/${pid}/status`, 'utf8');
              rows.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(text)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024 });
            } catch { /* exited */ }
            const visit = pid => (rows.get(pid)?.rss ?? 0) + [...rows].filter(([, r]) => r.parent === pid).reduce((n, [child]) => n + visit(child), 0);
            peakRSSBytes = Math.max(peakRSSBytes, visit(handle.pid));
          };
          const timer = setInterval(sample, 50);
          handle.once('error', error => { clearInterval(timer); reject(error); });
          handle.once('exit', code => {
            clearInterval(timer);
            if (code === 0) return resolve();
            let detail = '';
            for (const line of diagnosticTail.trim().split('\n')) try {
              const error = JSON.parse(line);
              if (/^[a-f0-9]{64}$/.test(error.errorHash) && Array.isArray(error.frames)
                && error.frames.every(frame => /^(app|scripts)\/[a-zA-Z0-9_./-]+\.mjs:\d+:\d+$/.test(frame))) detail = canonical(error);
            } catch { /* Never emit arbitrary child diagnostics or private contents. */ }
            reject(Error(`Comparison failed: exit ${code}; diagnostic bytes ${diagnosticBytes}; ${detail}`));
          });
        });
        pair.push({ ...JSON.parse(await readFile(config.result, 'utf8')), wallMs: performance.now() - start, peakRSSBytes });
      }
      differences.push(compare(pair[0], pair[1])); earlyDifferences.push(compare(pair[0], pair[2]));
      trials.push(pair.map(({ wallMs, peakRSSBytes, durationsMs }) => ({ wallMs, peakRSSBytes, evaluationMs: spread(durationsMs) })));
      console.log(JSON.stringify({ runs: run + 1, changed: differences.at(-1).reduce((n, s) => n + s.changed, 0), earlyChanged: earlyDifferences.at(-1).reduce((n, s) => n + s.changed, 0) }));
    }
    if (differences.some(d => canonical(d) !== canonical(differences[0])) || earlyDifferences.some(d => canonical(d) !== canonical(earlyDifferences[0]))) throw Error('Nondeterministic differences.');
    if (canonical(snapshotHashes) !== canonical(await Promise.all(snapshots.map(async file => hash(await readFile(file)))))) throw Error('Source changed.');
    const report = { runs, states: privateMode ? 8 : 3, rejectedBackups, validBackups, snapshotHashes, differences: differences[0], earlyDifferences: earlyDifferences[0], trials,
      before: { wallMs: spread(trials.map(t => t[0].wallMs)), peakRSSBytes: spread(trials.map(t => t[0].peakRSSBytes)) },
      after: { wallMs: spread(trials.map(t => t[1].wallMs)), peakRSSBytes: spread(trials.map(t => t[1].peakRSSBytes)) } };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    // Intentional first-flight and workbench corrections apply in both modes.
    // Report their option-on differences rather than treating START as a golden output.
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(values.child ? JSON.stringify({ errorHash: hash(error.message), frames: [...error.stack.matchAll(/(?:chunk-picker-rs3|r2-start)\/(app|scripts)\/([a-zA-Z0-9_./-]+\.mjs:\d+:\d+)/g)].slice(0, 4).map(match => `${match[1]}/${match[2]}`) }) : error.message); process.exitCode = 1; });
