import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildIdentityIndex, legacyTaskId } from '../app/tasks/identity.mjs';
import { projectMemberTaskFacts } from '../app/tasks/migration.mjs';

// No network, live saves, temporary servers or writes. Optional baseline modules
// must be an original-code copy inside this worktree, supplied by the operator.
const root = fileURLToPath(new URL('../', import.meta.url));
const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
let baselineFactory;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--baseline') throw new Error('Usage: node scripts/benchmark-identities.mjs [--baseline LOCAL_APP_DIRECTORY]');
  const directory = resolve(root, args[1]);
  const scoped = relative(root, directory);
  if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw new Error('Baseline modules must be inside this worktree');
  ({ createTaskEngine: baselineFactory } = await import(pathToFileURL(resolve(directory, 'tasks/engine.mjs'))));
}

const state = createGroupState([
  { id: 'player1', name: 'Player 1', unlocked: ['12342', '12850', '12849', '12594', '12593', '12338', '12339'] },
  { id: 'player2', name: 'Player 2', unlocked: ['12850', '12851', '12595', '13106', '13107', '13362'] },
]);
state.members[0].taskRules = { 'Kill X': true, 'Every Drop': true, 'All Shops': true, 'Wield Crafted Items': true };
const median = samples => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const measured = samples => ({ medianMs: median(samples), minimumMs: Math.min(...samples), maximumMs: Math.max(...samples), samples: samples.length });
const compile = factory => {
  const samples = []; let engine;
  for (let i = 0; i < 5; i++) {
    const start = performance.now(); engine = factory(definitions); samples.push(performance.now() - start);
  }
  return { engine, timings: measured(samples) };
};
const current = compile(createTaskEngine);
const baseline = baselineFactory ? compile(baselineFactory) : null;
// Old IDs and substantial saved status metadata use the same input on each side.
const savedRows = current.engine.catalogue.slice(0, 300).map(task => ({
  id: legacyTaskId(task.category, task.rawLabel), label: task.label, category: task.category,
}));
state.tasks = savedRows;
for (const [index, member] of state.members.entries()) {
  member.completedTasks = savedRows.filter((_, position) => position % 11 === index).map(task => task.id);
  member.taskStatus = Object.fromEntries(savedRows.filter((_, position) => position % 3 === index).map(task => [task.id, { challengeCompleted: true, favorite: true, note: 'Synthetic benchmark saved progress' }]));
}
const factories = [['current', current], ...(baseline ? [['baseline', baseline]] : [])];
const fullTask = Object.fromEntries(factories.map(([name]) => [name, []]));
const checksums = Object.fromEntries(factories.map(([name]) => [name, 0]));
for (let iteration = 0; iteration < 9; iteration++) {
  // Alternate order to limit warmup and concurrent-load bias.
  for (const [name, value] of iteration % 2 ? [...factories].reverse() : factories) {
    const start = performance.now();
    for (const member of state.members) checksums[name] += value.engine.evaluate(state, member.id).tasks.length;
    if (iteration >= 2) fullTask[name].push(performance.now() - start);
  }
}
const indexStart = performance.now();
const identityIndex = buildIdentityIndex(current.engine.catalogue);
const aliasIndexCompileMs = performance.now() - indexStart;
const aliases = savedRows.map(task => task.id);
const resolutions = [];
let resolved = 0;
const lookupCount = 100_000;
for (let sample = 0; sample < 9; sample++) {
  const start = performance.now();
  for (let i = 0; i < lookupCount; i++) if (identityIndex.resolve(aliases[i % aliases.length]).status === 'resolved') resolved++;
  resolutions.push(performance.now() - start);
}
if (resolved !== lookupCount * resolutions.length) throw new Error('Benchmark aliases did not all resolve');
const projection = [];
for (let sample = 0; sample < 11; sample++) {
  const start = performance.now();
  for (const member of state.members) projectMemberTaskFacts(state, member, current.engine.catalogue);
  projection.push(performance.now() - start);
}
const report = {
  node: process.version,
  fixture: 'Synthetic Player 1/Player 2 ownership, retained full reference definitions, 300 historical task rows; not live gameplay',
  catalogueCount: current.engine.catalogue.length,
  savedStatusRecords: state.members.reduce((sum, member) => sum + Object.keys(member.taskStatus).length, 0),
  compile: { current: current.timings, ...(baseline ? { baseline: baseline.timings } : {}) },
  duoFullTaskCalculation: Object.fromEntries(Object.entries(fullTask).map(([name, samples]) => [name, measured(samples)])),
  ...(baseline ? { currentToBaselineMedianRatio: median(fullTask.current) / median(fullTask.baseline) } : {}),
  aliasIndexCompileMs,
  aliasLookup: { lookupsPerSample: lookupCount, ...measured(resolutions), medianNanosecondsPerLookup: median(resolutions) * 1e6 / lookupCount },
  duoSavedFactProjection: measured(projection),
  checksums,
  method: 'Five compile samples; two warmups then seven interleaved duo evaluations; nine 100,000-alias batches; no flaky wall-clock assertions. Timings include full eligibility and source calculation but exclude JSON reading, browser rendering and module import.',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
