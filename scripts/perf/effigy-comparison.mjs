// Compare the rule split against a pinned checkout using public inputs.
// Private mode (--store) is disabled and fails before any save is read.
import { parseArgs } from 'node:util';
import { mkdtemp, cp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const { values } = parseArgs({ options: { ...Object.fromEntries(['baseline', 'candidate', 'store', 'out', 'internal', 'repeats', 'source-order-baseline'].map(key => [key, { type: 'string' }])), catalogue: { type: 'boolean', default: false }, 'both-on': { type: 'boolean', default: false } } });
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const digestRows = (rows, key) => Object.fromEntries(rows.map(row => [sha(row[key]), sha(canonical(row))]));
const capture = (result, estimateItemDrop) => {
  const rows = { tasks: digestRows(result.tasks, 'id'), presented: digestRows(result.presentation?.tasks ?? [], 'id'),
    items: digestRows(result.items, 'name') };
  if (estimateItemDrop) {
    const effigies = result.items.filter(item => item.name === 'Starved ancient effigy');
    // Keep exact comparisons above. These extra views explain source-order
    // differences without hiding them or exporting source text.
    rows.availability = digestRows(result.tasks.map(({ id, status, hidden, obligation }) => ({ id, status, hidden, obligation })), 'id');
    rows.displayed = digestRows(result.tasks.map(task => ({ id: task.id, source: task.sources?.[0] ?? null })), 'id');
    rows.effigySourceSets = digestRows(effigies.map(item => ({ ...item, sources: item.sources.map(canonical).sort() })), 'name');
    rows.chosen = digestRows(effigies.map(item => ({ name: item.name, source: estimateItemDrop(item.name, item.sources,
      { monsterSecondsPerKill: {}, defaultSecondsPerKill: 60 }).source ?? null })), 'name');
  }
  return rows;
};
const statistics = numbers => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
};
async function internal(config) {
  const load = relative => import(pathToFileURL(path.join(config.checkout, relative)));
  const durationsMs = [], rows = [], migration = { on: 0, off: 0 };
  let close = async () => {};
  try {
    if (!config.store) {
      const { createTaskEngine } = await load('app/tasks/engine.mjs');
      const { estimateItemDrop } = await load('app/tasks/time-estimates.mjs');
      const items = ['Starved ancient effigy', 'Mimic kill token', 'Spirit sapphire', 'Spirit emerald', 'Spirit ruby'];
      let definitions = { chunks: { '1': { Monster: { 'Fixture monster': true } } },
        drops: { 'Fixture monster': Object.fromEntries(items.map(item => [item, { 1: 'Always' }])) },
        taskUnlocks: { Items: Object.fromEntries(items.map(item => [item + '^', [{ 'Universal tertiary': 'Nonskill' }]])) },
        challenges: { Nonskill: { 'Universal tertiary': { Category: ['Universal Tertiary'] } },
          Extra: Object.fromEntries(items.map(item => ['Use ' + item, { Items: [item] }])) } };
      let dataset;
      if (config.catalogue) {
        ({ selectedDataset: dataset } = await load('app/dataset-runtime.mjs'));
        const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
        definitions = JSON.parse((await loadDatasetInputs(dataset)).definitionBytes);
      }
      const unlocked = config.catalogue ? Object.keys(definitions.chunks).filter(id => /^\d+$/.test(id)) : ['1'];
      const engine = createTaskEngine(definitions, { dataset, cacheWalking: false, cacheResources: false, cacheArchaeology: false,
        cacheShops: false, metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
        skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false });
      for (const [tertiary, effigies] of config.bothOn ? [[true, true]] : [[false, false], [true, false], [true, true], [false, true]]) {
        let result;
        for (let i = 0; i < config.repeats; i++) {
          const start = performance.now();
          result = engine.evaluate({ rules: { 'content.f2p': false }, members: [{ id: 'a', unlocked, completedTasks: [],
            taskRules: { 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies } }] }, 'a');
          durationsMs.push(performance.now() - start);
        }
        rows.push(capture(result, estimateItemDrop));
      }
    } else {
      throw Error('Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.');
      const dataDir = path.join(config.run, 'game');
      await cp(config.store, dataDir, { recursive: true });
      await copyFile(config.store + '.dataset.json', dataDir + '.dataset.json');
      const { createServer } = await load('app/server.mjs');
      const app = await createServer({ dataDir, port: 0, predictionPrewarm: false, retention: false });
      close = () => app.close();
      let states;
      if (config.baseline) {
        const current = app.store.getState();
        const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a, b) => a.revision - b.revision);
        if (backups.length < 7) throw Error('Insufficient samples.');
        states = [];
        for (let i = 0; i < 7; i++) states.push((await app.store.readBackup(backups[Math.floor(i * (backups.length - 1) / 6)].id)).state);
        states.push(current);
        await writeFile(config.states, JSON.stringify(states), { mode: 0o600 });
      } else {
        const { validateState } = await load('app/core/state.mjs');
        states = JSON.parse(await readFile(config.states, 'utf8')).map(state => validateState(state));
      }
      const world = app.world, dataset = app.dataset;
      await app.close();
      const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
      const { preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
      const scheduler = await createTaskScheduler({ workerData: { definitions: world.definitions,
        world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, datasetSelection: dataset.workerSelection(),
        datasetDigest: dataset.digest, datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: preparedDefinitionStages(world.definitions) } });
      close = () => scheduler.close();
      for (let index = 0; index < states.length; index++) {
        const state = states[index], preserved = [], disabled = [];
        for (const member of state.members) {
          if (!config.baseline) migration[member.taskRules?.['Ancient Effigies'] === true ? 'on' : 'off']++;
          const start = performance.now();
          const evaluation = await scheduler.evaluate(state, member.id, 'evaluate', undefined, `sample-${index}-${member.id}`);
          durationsMs.push(performance.now() - start);
          preserved.push(capture(evaluation.result));
          if (!config.baseline && state.members.every(owner => owner.taskRules?.['Ancient Effigies'] === false)) {
            disabled.push(preserved.at(-1));
          } else if (!config.baseline) {
            const off = { ...state, members: state.members.map(owner => ({ ...owner, taskRules: { ...owner.taskRules, 'Ancient Effigies': false } })) };
            const evaluationOff = await scheduler.evaluate(off, member.id, 'evaluate', undefined, `off-${index}-${member.id}`);
            disabled.push(capture(evaluationOff.result));
          }
        }
        rows.push({ preserved, disabled });
      }
    }
    await writeFile(config.result, JSON.stringify({ rows, migration, durationsMs: statistics(durationsMs) }), { mode: 0o600 });
  } finally { await close(); }
}
const delta = (before, after) => ({ added: Object.keys(after).filter(key => !Object.hasOwn(before, key)).length,
  removed: Object.keys(before).filter(key => !Object.hasOwn(after, key)).length,
  changed: Object.keys(before).filter(key => Object.hasOwn(after, key) && before[key] !== after[key]).length });
const difference = (before, after) => Object.fromEntries(Object.keys(before).map(key => [key, delta(before[key], after[key])]));
async function main() {
  if (values.store) throw Error('Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.');
  if (values.internal) return internal(JSON.parse(await readFile(values.internal, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out) throw Error('Use --baseline, --candidate and --out; optionally --catalogue for tracked public definitions or --store for eight private samples.');
  if (values.store && values['source-order-baseline']) throw Error('Source-order attribution uses public inputs only.');
  const repeats = Number(values.repeats ?? 3);
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw Error('Invalid repeat count.');
  const root = await mkdtemp(path.join(tmpdir(), 'effigy-comparison-'));
  try {
    const runs = [];
    for (const [index, checkout] of [values.baseline, values.candidate, ...(values['source-order-baseline'] ? [values['source-order-baseline']] : [])].entries()) {
      const run = await mkdtemp(path.join(root, 'run-'));
      const config = { checkout: path.resolve(checkout), run, store: values.store && path.resolve(values.store),
        baseline: index === 0, catalogue: values.catalogue, repeats, bothOn: index === 2 || values['both-on'], states: path.join(root, 'states.json'), result: path.join(run, 'result.json') };
      const input = path.join(run, 'input.json'); await writeFile(input, JSON.stringify(config), { mode: 0o600 });
      let peakRSSBytes = 0;
      const start = performance.now();
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--internal', input], { stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = ''; child.stderr.on('data', bytes => { errors += bytes; });
        const sample = rootPid => {
          // Some managed kernels omit task/*/children. PPid is available in
          // status on those kernels, so build the tree from that instead.
          const processes = new Map();
          for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
            try {
              const status = readFileSync(`/proc/${pid}/status`, 'utf8');
              processes.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
                rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
            } catch { /* A process may exit during a sample. */ }
          }
          const visit = pid => (processes.get(pid)?.rss ?? 0) + [...processes].filter(([, row]) => row.parent === pid)
            .reduce((sum, [child]) => sum + visit(child), 0);
          return visit(rootPid);
        };
        const timer = setInterval(() => { peakRSSBytes = Math.max(peakRSSBytes, sample(child.pid)); }, 50);
        child.once('error', () => { clearInterval(timer); reject(Error('Comparison child failed.')); });
        child.once('exit', code => { clearInterval(timer); code === 0 ? resolve() : reject(Error(`Comparison failed (${code}); error hash ${sha(errors)}.`)); });
      });
      runs.push({ ...JSON.parse(await readFile(config.result, 'utf8')), peakRSSBytes, wallMs: performance.now() - start });
    }
    const differences = runs[0].rows.map((before, index) => values.store ? {
      preserved: before.preserved.map((row, member) => difference(row, runs[1].rows[index].preserved[member])),
      effigiesOff: before.preserved.map((row, member) => difference(row, runs[1].rows[index].disabled[member])),
    } : difference(before, runs[1].rows[index]));
    const sourceOrder = runs[2] ? difference(runs[2].rows[0], runs[1].rows[values['both-on'] ? 0 : 2]) : undefined;
    const report = { sourceOrder, sampleCount: differences.length, differences, migration: runs[1].migration,
      before: { durationsMs: runs[0].durationsMs, peakRSSBytes: runs[0].peakRSSBytes, wallMs: runs[0].wallMs },
      after: { durationsMs: runs[1].durationsMs, peakRSSBytes: runs[1].peakRSSBytes, wallMs: runs[1].wallMs } };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
