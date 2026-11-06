// Public/synthetic full engine benchmark. No server, scheduler, storage or network.
// node scripts/perf/task-engine.mjs --companion .local/perf/task-engine-scale400
//   --baseline <START> --baseline-root <temporary-worktree> --pairs 7 --output .local/perf/task-engine-report.json
// Add --profile for a separate node --cpu-prof run. --matrix checks both members,
// sharing on/off, three unlock states, and with/without area overrides.
// --fixture uses the small public regression duo instead of a companion.
// For two-CPU Linux measurements, prefix the command with taskset -c 0,1.
// Each pair uses fresh processes in AB/BA order, with a prepared engine and
// a cold eligibility cache. RSS includes loading, compilation and hashing.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineFixture, fixtureStates } from '../../tests/fixtures/task-engine.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? fallback : process.argv[at + 1]; };
const flag = name => process.argv.includes(`--${name}`);
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child);
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  return { median, min: sorted[0], max: sorted.at(-1), spread: sorted.at(-1) - sorted[0] };
};
function instrument(source, original) {
  source = source.replace(/\bfrom (['"])(\.[^'"\r\n]+)\1/g, (_, quote, relative) => `from ${quote}${pathToFileURL(path.resolve(path.dirname(original), relative)).href}${quote}`);
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Instrumentation anchor differs: ${before}`);
    source = source.replace(before, after);
  };
  replace('buildAccessIndex, calculateAccess, collectBaseItemSources,', 'buildAccessIndex, calculateAccess as rawCalculateAccess, collectBaseItemSources as rawCollectBaseItemSources,');
  replace('processingSkills, selectProcessingSources }', 'processingSkills, selectProcessingSources as rawSelectProcessingSources }');
  replace('      while (changed && counters.passes - roundStart < compiled.length + 2) {', '      while (changed && counters.passes - roundStart < compiled.length + 2) {\n        const phaseStarted = performance.now();');
  replace('        if (discoveryExpanded) { changed = true; discoveryExpanded = false; }', '        if (discoveryExpanded) { changed = true; discoveryExpanded = false; }\n        addPhase("closure", performance.now() - phaseStarted);');
  replace('    const rows = (proofSubject ? [proofSubject] : compiled).map(task => {\n      const blockers', '    const projectionStarted = performance.now();\n    const rows = (proofSubject ? [proofSubject] : compiled).map(task => {\n      const blockers');
  replace('    const equipment = [];\n    const houseStorage', '    addPhase("rows", performance.now() - projectionStarted);\n    const equipment = [];\n    const houseStorage');
  return source + `\nexport const phases = {};\nexport function resetPhases() { for (const key of Object.keys(phases)) delete phases[key]; }\nfunction addPhase(name, ms) { phases[name] = (phases[name] ?? 0) + ms; }\nfunction measured(name, fn, args) { const start = performance.now(); try { return fn(...args); } finally { addPhase(name, performance.now() - start); } }\nfunction calculateAccess(...args) { return measured('access', rawCalculateAccess, args); }\nfunction collectBaseItemSources(...args) { return measured('baseSources', rawCollectBaseItemSources, args); }\nfunction selectProcessingSources(...args) { return measured('processing', rawSelectProcessingSources, args); }\n`;
}
async function child() {
  const app = path.resolve(option('app-dir', path.join(root, 'app')));
  const load = file => import(pathToFileURL(path.join(app, file)).href);
  const { selectedDataset } = await load('dataset-runtime.mjs');
  const { loadDatasetInputs } = await load('dataset-bootstrap.mjs');
  const { prepareServerDefinitions } = await load('dataset-pipeline.mjs');
  const inputs = flag('fixture') ? null : await loadDatasetInputs(selectedDataset);
  let definitions = flag('fixture') ? engineFixture() : prepareServerDefinitions(JSON.parse(inputs.definitionBytes), selectedDataset);
  if (flag('matrix') && !flag('fixture')) {
    const first = Object.keys(definitions.chunks)[0];
    definitions = { ...definitions, chunks: { ...definitions.chunks, [first]: { ...definitions.chunks[first], Connect: { ...definitions.chunks[first].Connect, 'Synthetic interior': true } },
      'Synthetic interior': { Spawn: { 'Synthetic key': 1 } } }, challenges: { ...definitions.challenges, Extra: { ...definitions.challenges.Extra,
        'Synthetic interior goal': { Chunks: ['Synthetic interior'], Items: ['Synthetic key'] } } } };
  }
  const original = path.join(app, 'tasks/engine.mjs');
  const source = await readFile(original, 'utf8');
  const engineFile = path.resolve(option('engine-file'));
  await writeFile(engineFile, instrument(source, original));
  const { createTaskEngine, phases, resetPhases } = await import(pathToFileURL(engineFile).href);
  const engine = createTaskEngine(definitions, flag('fixture') ? {} : { dataset: selectedDataset });
  engine.prepare({});
  const chunks = Object.keys(definitions.chunks).filter(id => /^\d+$/.test(id));
  const areas = Object.keys(definitions.chunks).filter(id => !/^\d+$/.test(id));
  const rows = [];
  const cases = flag('fixture') ? fixtureStates() : [];
  if (!flag('fixture')) for (const shared of flag('matrix') ? [false, true] : [true]) {
    for (const withAreas of flag('matrix') ? [false, true] : [false]) {
      for (const fraction of flag('matrix') ? [0.05, 0.5, 1] : [1]) {
        cases.push({ name: `${shared}/${withAreas}/${fraction}`, state: { rules: { 'content.f2p': false, 'access.shared': shared }, taskRules: {}, members: [0, 1].map(index => ({
          id: `m${index}`, name: `Synthetic ${index}`, unlocked: chunks.filter((_, at) => at % 2 === index).slice(0, Math.ceil(chunks.length * fraction / 2)),
          completedTasks: [], ...(withAreas ? { areaOverrides: Object.fromEntries(areas.slice(0, 20).map((id, at) => [id, at % 2 === 0])) } : {}) })) } });
      }
    }
  }
  const { createRuleRegistry, builtInRules } = await load('core/rules.mjs');
  const registry = createRuleRegistry(['content.f2p', 'access.shared'].filter(id => !builtInRules.some(rule => rule.id === id))
    .map(id => ({ id, label: id, type: 'boolean', default: true })));
  const { selectPresentedTasks } = await load('tasks/presentation.mjs');
  const { projectPlayResult } = await load('play-view.mjs');
  const { projectDuoPlayResult, projectDuoSidebarResult, projectDuoInspectionJSON } = await load('duo-play-view.mjs');
  for (const { name, state } of cases) {
    state.tasks = [];
    for (const member of flag('matrix') || flag('fixture') ? state.members : [state.members[0]]) {
      resetPhases();
      const start = performance.now();
      const result = engine.evaluate(state, member.id);
      const ms = performance.now() - start;
      const phaseTimes = { ...phases };
      const hashes = { full: sha(normalize({ result, processing: result.processing, processingPrimary: result.tasks.map(row => row.processingPrimary),
        metrics: Object.fromEntries(Object.getOwnPropertyNames(result.metrics).filter(key => key !== 'elapsedMs').map(key => [key, result.metrics[key]])) })) };
      if (flag('matrix') || flag('fixture')) {
        result.memberId = member.id;
        result.presentation = selectPresentedTasks(result, state, member.id, definitions);
        const play = projectPlayResult(result), bytes = Buffer.from(normalize(play));
        hashes.personal = sha(bytes);
        hashes.group = sha(normalize(projectDuoPlayResult(play, state)));
        hashes.sidebar = sha(normalize(projectDuoSidebarResult(play, state, registry, member.id)));
        hashes.inspection = sha(projectDuoInspectionJSON(bytes));
      }
      rows.push({ case: `${name}/${member.id}`, ms, engineMs: result.metrics.elapsedMs, phases: phaseTimes, hash: sha(JSON.stringify(hashes)), hashes,
        tasks: result.tasks.length, items: result.items.length, available: result.metrics.availableCount,
        metrics: Object.fromEntries(Object.getOwnPropertyNames(result.metrics).map(key => [key, result.metrics[key]])) });
    }
  }
  console.log(JSON.stringify({ rows, chunks: chunks.length, areas: areas.length, peakRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version }));
}
async function main() {
  let environment = { ...process.env, RS3_DATASET: 'open-f2p' };
  if (!flag('fixture')) {
    const companion = path.resolve(option('companion'));
    const receipt = JSON.parse(await readFile(path.join(companion, 'companion.json'), 'utf8'));
    environment = { ...environment, RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(companion, receipt.profile.path),
      RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(companion, 'packs'), RS3_PACK_SELECTION: path.join(companion, 'selection.json') };
  }
  const scratchRoot = path.join(root, '.local/perf'); await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'task-engine-'));
  const baseline = option('baseline', 'HEAD');
  const baselineRoot = path.resolve(option('baseline-root'));
  const command = (cmd, args) => {
    const run = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: environment });
    if (run.status !== 0) throw new Error(`${cmd} failed (${run.status}): ${run.stderr}\n${run.stdout.slice(-2000)}`);
    return run.stdout;
  };
  try {
    const historicalHead = command('git', ['-C', baselineRoot, 'rev-parse', 'HEAD']).trim();
    const expectedHead = command('git', ['rev-parse', baseline]).trim();
    if (historicalHead !== expectedHead) throw new Error('Baseline worktree does not match --baseline.');
    const run = (kind, extra = [], matrix = false) => JSON.parse(command(process.execPath, ['--max-old-space-size=3072', ...extra, fileURLToPath(import.meta.url), '--child',
      '--app-dir', kind === 'before' ? path.join(baselineRoot, 'app') : path.join(root, 'app'), '--engine-file', path.join(scratch, `engine-${kind}.mjs`), ...(matrix ? ['--matrix'] : []), ...(flag('fixture') ? ['--fixture'] : [])]).trim().split('\n').at(-1));
    if (flag('matrix-only')) {
      const matrix = { before: run('before', [], true), after: run('after', [], true) };
      const hashes = result => result.rows.map(row => [row.case, row.hash]);
      if (JSON.stringify(hashes(matrix.before)) !== JSON.stringify(hashes(matrix.after))) throw new Error('Matrix response changed.');
      await writeFile(path.resolve(option('output')), JSON.stringify({ baseline, node: process.version, matrix }, null, 2) + '\n');
      console.log(`Matrix: ${matrix.before.rows.length} complete equal responses`);
      return;
    }
    const pairs = Number(option('pairs', 7)), runs = [];
    for (let index = 0; index < pairs; index++) {
      const pair = {};
      for (const kind of index % 2 ? ['after', 'before'] : ['before', 'after']) {
        pair[kind] = run(kind);
        console.error(`pair ${index + 1} ${kind}: ${pair[kind].rows[0].ms.toFixed(1)} ms / RSS ${pair[kind].peakRssMiB.toFixed(1)} MiB`);
      }
      if (JSON.stringify(pair.before.rows.map(row => row.hash)) !== JSON.stringify(pair.after.rows.map(row => row.hash))) throw new Error('Full baseline response changed.');
      runs.push(pair);
      if (option('output')) await writeFile(path.resolve(option('output')), JSON.stringify({ baseline, node: process.version, pairs, runs, complete: false }, null, 2) + '\n');
    }
    const report = { baseline, node: process.version, pairs, runs, summary: Object.fromEntries(['before', 'after'].map(kind => [kind, {
      ms: summary(runs.map(pair => pair[kind].rows[0].ms)), engineMs: summary(runs.map(pair => pair[kind].rows[0].engineMs)),
      peakRssMiB: summary(runs.map(pair => pair[kind].peakRssMiB)), phases: Object.fromEntries(Object.keys(runs[0][kind].rows[0].phases).map(phase => [phase, summary(runs.map(pair => pair[kind].rows[0].phases[phase]))])) }])) };
    report.pairedImprovementPercent = summary(runs.map(pair => 100 * (1 - pair.after.rows[0].ms / pair.before.rows[0].ms)));
    if (option('output')) await writeFile(path.resolve(option('output')), JSON.stringify(report, null, 2) + '\n');
    if (flag('matrix')) {
      report.matrix = { before: run('before', [], true), after: run('after', [], true) };
      const hashes = result => result.rows.map(row => [row.case, row.hash]);
      if (JSON.stringify(hashes(report.matrix.before)) !== JSON.stringify(hashes(report.matrix.after))) throw new Error('Matrix response changed.');
    }
    if (flag('profile')) {
      for (const kind of ['before', 'after']) {
        run(kind, ['--cpu-prof', `--cpu-prof-dir=${scratch}`, `--cpu-prof-name=${kind}.cpuprofile`]);
        const profile = JSON.parse(await readFile(path.join(scratch, `${kind}.cpuprofile`), 'utf8'));
        const nodes = new Map(profile.nodes.map(row => [row.id, row]));
        const evaluation = new Set(), coldCall = new Set();
        const visit = (id, selected) => { selected.add(id); for (const child of nodes.get(id).children ?? []) visit(child, selected); };
        for (const node of profile.nodes) {
          if (node.callFrame.functionName === 'computeEligibility') visit(node.id, evaluation);
          if (node.callFrame.functionName === 'evaluate' && node.callFrame.url.endsWith(`/engine-${kind}.mjs`)) visit(node.id, coldCall);
        }
        const summarize = selected => {
          const self = new Map();
          profile.samples.forEach((id, at) => { if (!selected.has(id)) return;
            const frame = nodes.get(id).callFrame, name = `${frame.functionName || '(anonymous)'} ${path.basename(frame.url)}:${frame.lineNumber + 1}`;
            self.set(name, (self.get(name) ?? 0) + profile.timeDeltas[at] / 1000); });
          return [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
        };
        report[`${kind}Cpu`] = summarize(evaluation);
        report[`${kind}ColdCallCpu`] = summarize(coldCall);
        if (option('output')) await writeFile(`${path.resolve(option('output'))}.${kind}.cpuprofile`, JSON.stringify(profile));
      }
    }
    if (option('output')) await writeFile(path.resolve(option('output')), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ summary: report.summary, pairedImprovementPercent: report.pairedImprovementPercent, beforeCpu: report.beforeCpu, afterCpu: report.afterCpu }, null, 2));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
if (flag('child')) await child(); else await main();
