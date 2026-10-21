import { selectedDataset } from './dataset-runtime.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildWorld, findTaskIdCollisions } from './data/world.mjs';
import { loadOriginalData } from './data/original-data.mjs';
import { createRuleRegistry, evaluateRollPool, taskCompletion } from './core/rules.mjs';
import { createGroupState, importLegacyMaps, exportBackup, importBackup } from './core/state.mjs';

const root = new URL('../', import.meta.url);
const registry = createRuleRegistry();
const args = process.argv.slice(2);
const command = args.shift() ?? 'inspect';

function readOptions(values) {
  const options = {};
  while (values.length) {
    const key = values.shift();
    if (key !== '--snapshot' || !values.length || values[0].startsWith('--')) {
      throw new Error('Usage: node app/cli.mjs inspect|benchmark [--snapshot PATH]');
    }
    if (options.snapshot) throw new Error('Only one snapshot may be supplied.');
    options.snapshot = values.shift();
  }
  return options;
}

async function loadInputs(options) {
  const start = performance.now();
  const { definitionBytes, taskBytes, selection } = await loadOriginalData();
  const definitions = JSON.parse(definitionBytes.toString('utf8'));
  const parsedAt = performance.now();
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const indexedAt = performance.now();
  const taskMap = JSON.parse(taskBytes.toString('utf8'));
  const collisions = findTaskIdCollisions(taskMap);
  let state;
  let warnings = [];
  let fixture;
  let snapshotSha256 = null;
  if (options.snapshot) {
    const snapshotBytes = await readFile(options.snapshot);
    snapshotSha256 = createHash('sha256').update(snapshotBytes).digest('hex');
    fixture = JSON.parse(snapshotBytes.toString('utf8'));
    ({ state, warnings } = importLegacyMaps(fixture, { members: [
      { id: 'player1', name: 'Player 1', mapId: 'qxa' },
      { id: 'player2', name: 'Player 2', mapId: 'qxb' },
    ], registry }));
  } else {
    state = createGroupState([
      { id: 'player1', name: 'Player 1', unlocked: ['12342'] },
      { id: 'player2', name: 'Player 2', unlocked: ['12850'] },
    ], registry);
    state.tasks = [{ id: 'example:group-requirement', label: 'Synthetic example requirement', category: 'Example' }];
    state.members[1].completedTasks.push('example:group-requirement');
    // A manually confirmed synthetic destination; this does not claim an actual unlocked teleport.
    state.members[0].teleports.push({ id: 'example:teleport', label: 'Synthetic confirmed teleport',
      destination: '11828', available: true, consumable: false });
  }
  return { world, state, warnings, collisions,
    source: { path: fileURLToPath(new URL(selection.definitions.path, root)),
      sha256: sha256RepositoryText(definitionBytes),
      state: options.snapshot ? 'Captured local QXA/QXB gameplay snapshot; not a live refresh' : 'Synthetic example; not personal game progress',
      snapshotPath: options.snapshot ?? null, snapshotSha256 },
    timings: { definitionReadAndParseMs: parsedAt - start, indexBuildMs: indexedAt - parsedAt } };
}

function summary({ world, state, warnings, collisions, source, timings }) {
  const backup = exportBackup(state, registry);
  const roundTrip = importBackup(JSON.stringify(backup), registry);
  if (JSON.stringify(state) !== JSON.stringify(roundTrip)) throw new Error('Backup round-trip changed state.');
  const active = registry.resolve(state.rules);
  return {
    implementation: 'Roll-pool CLI; the private server includes the browser UI and migrated task, presentation, and equipment pipelines',
    source, timings,
    world: { chunks: world.chunks.size, namedAreas: world.areas.size, surfaceChunks: world.surface.size,
      walkable: world.walkable.size, f2p: world.f2p.size,
      diagnosticCounts: Object.fromEntries([...new Set(world.issues.map(issue => issue.code))]
        .map(code => [code, world.issues.filter(issue => issue.code === code).length])),
      diagnosticPreview: world.issues.slice(0, 12), duplicateLegacyTaskIds: collisions.length },
    policy: active,
    members: state.members.map(member => {
      const pool = evaluateRollPool(world, state, member.id, registry);
      return { id: member.id, sourceMapId: member.sourceMapId, unlocked: member.unlocked.length,
        savedSelected: member.selected.length, pendingRoll: member.pendingRoll.length,
        accessible: pool.accessible.length, eligible: pool.eligible.length, excluded: pool.excluded.length,
        eligiblePreview: pool.eligible.slice(0, 4).map(candidate => ({ id: candidate.id,
          name: world.chunks.get(candidate.id)?.name, reasons: candidate.reasons.slice(0, 2), reasonCount: candidate.reasons.length })),
        ...(state.tasks.length ? { exampleCompletion: taskCompletion(state, state.tasks[0].id, member.id, registry) } : {}) };
    }),
    backupRoundTrip: 'passed', warnings,
    limits: ['This CLI inspects roll pools; subsection content access and task eligibility are evaluated by the private server.',
      'This CLI retains legacy rules, task checks, and notes for migration; checkmarks are not personal game completions.',
      'This CLI does not perform network requests, live map writes, durable storage writes, or task calculation.'],
  };
}

function benchmark(inputs) {
  const { world, state } = inputs;
  for (let i = 0; i < 20; i++) for (const member of state.members) evaluateRollPool(world, state, member.id, registry);
  const elapsed = [];
  const iterations = 250;
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    for (const member of state.members) count += evaluateRollPool(world, state, member.id, registry).eligible.length;
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  const percentile = fraction => elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * fraction))];
  return { stage: 'CLI roll rules for both members together; excludes task generation and browser rendering',
    source: inputs.source, setupTimings: inputs.timings, iterations,
    medianMs: percentile(0.5), p95Ms: percentile(0.95), maximumMs: elapsed.at(-1),
    checksum: count, budgetMs: 100,
    budgetMet: percentile(0.95) <= 100,
    comparison: 'No speedup ratio: this CLI times roll-pool evaluation; the previous 10–19-second benchmark timed task calculation.' };
}

try {
  if (!['inspect', 'benchmark'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const inputs = await loadInputs(readOptions(args));
  process.stdout.write(`${JSON.stringify(command === 'inspect' ? summary(inputs) : benchmark(inputs), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
