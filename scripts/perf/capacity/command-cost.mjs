// Synthetic CPU probe, independent of server traffic and durable IO. CLI imports
// the app only after clearing inherited dataset/provider configuration.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { catalogue, digest, integer, syntheticWorld } from './model.mjs';

export function probeLimits(profile, iterations, platform = process.platform) {
  integer(iterations, 1, 10, 'iterations');
  integer(profile.fixture.historyEvents, 0, 10000, 'historyEvents');
  if (!Number.isFinite(profile.fixture.unlockFraction) || profile.fixture.unlockFraction < 0 || profile.fixture.unlockFraction > 1) throw new Error('Invalid unlockFraction.');
  if (platform === 'win32' && (profile.name !== 'smoke' || profile.catalogue.chunks > 64
    || profile.catalogue.tasks > 500 || profile.fixture.historyEvents > 20)) throw new Error('PC command probe requires a tiny smoke profile.');
}

const points = maximum => [...new Set([0, Math.floor(maximum / 2), maximum])];
const summary = values => ({ meanMs: values.reduce((a, b) => a + b, 0) / values.length,
  minMs: Math.min(...values), maxMs: Math.max(...values), samplesMs: values });

export async function commandCosts(profile, { iterations = 3, onProgress = () => {} } = {}) {
  probeLimits(profile, iterations);
  const { createGroupState, applyCommand, applyValidatedCommand, validateState } = await import('../../../app/core/state.mjs');
  const { buildWorld } = await import('../../../app/data/world.mjs');
  const { createRuleRegistry } = await import('../../../app/core/rules.mjs');
  const { createTaskEngine } = await import('../../../app/tasks/engine.mjs');
  const data = catalogue(profile.catalogue), world = syntheticWorld(data, buildWorld), registry = createRuleRegistry();
  const tasks = createTaskEngine(data).catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const chunks = Object.keys(data.chunks), maximum = Math.max(1, Math.floor(chunks.length * profile.fixture.unlockFraction));
  const fixedTime = Date.UTC(2026, 9, 1), options = { world, registry, now: fixedTime };
  const rows = [], started = performance.now();
  for (let rosterSize = 1; rosterSize <= 5; rosterSize++) {
    for (const unlocked of points(maximum)) {
      // Seed through real commands before adding the large inert catalogue,
      // exactly as fixture setup does. Every measured input is then fully
      // validated with the entire catalogue and genuine History/Undo chain.
      let state = createGroupState(Array.from({ length: rosterSize }, (_, i) => ({ id: i ? `member${i + 1}` : 'owner', name: `Synthetic probe ${i + 1}` })), registry);
      for (const member of [...state.members]) if (unlocked) state = applyCommand(state,
        { type: 'replace-member', memberId: member.id, member: { ...member, unlocked: chunks.slice(0, unlocked) } }, options);
      const growthHistory = state.history.length;
      let historyWrites = 0;
      for (const historyEvents of points(profile.fixture.historyEvents)) {
        while (historyWrites < historyEvents) {
          state = applyCommand(state, { type: 'set-note', memberId: 'owner', chunkId: chunks[historyWrites % chunks.length], note: `Synthetic history ${historyWrites++}` }, options);
        }
        const input = validateState({ ...state, tasks: structuredClone(tasks) }, registry);
        const stateBytes = Buffer.byteLength(JSON.stringify(input)), stateDigest = digest(input);
        const commands = [
          { type: 'set-chunk', memberId: 'owner', chunkId: chunks[Math.min(unlocked, chunks.length - 1)], status: unlocked === chunks.length ? 'locked' : 'unlocked' },
          { type: 'set-note', memberId: 'owner', chunkId: chunks[0], note: 'Synthetic measured note' },
          { type: 'complete-task', memberId: 'owner', taskId: tasks[0].id, completed: true }
        ];
        for (const command of commands) {
          for (const [boundary, apply] of [['applyCommand', applyCommand], ['applyValidatedCommand', applyValidatedCommand]]) {
            const values = [];
            // One untimed warm-up, then independent calls against the SAME
            // unchanged validated input: no ever-growing measurement history.
            apply(input, command, options);
            for (let i = 0; i < iterations; i++) {
              const at = performance.now();
              const output = apply(input, command, options);
              values.push(performance.now() - at);
              if (output.revision !== input.revision + 1) throw new Error('Probe command did not commit.');
            }
            if (digest(input) !== stateDigest) throw new Error('Probe mutated its baseline.');
            rows.push({ rosterSize, unlockedPerMember: unlocked, noteHistoryEvents: historyEvents,
              historyEntries: historyEvents + growthHistory, tasks: tasks.length, stateBytes, command: command.type, boundary, ...summary(values) });
          }
        }
        await onProgress({ rosterSize, unlocked, historyEvents });
      }
    }
  }
  return { schemaVersion: 1, node: process.version, platform: process.platform, cpuModel: cpus()[0].model,
    stateSourceDigest: digest(await readFile(new URL('../../../app/core/state.mjs', import.meta.url))),
    profile: profile.name, profileDigest: digest(profile), catalogue: profile.catalogue, iterations, elapsedMs: performance.now() - started,
    scope: 'CPU only; excludes durable IO, retention, HTTP, calculator, GC control and concurrency. applyValidatedCommand is the existing store.command boundary.', rows };
}

export function commandCostMarkdown(result) {
  const maxUnlocked = Math.max(...result.rows.map(row => row.unlockedPerMember));
  const maxHistory = Math.max(...result.rows.map(row => row.noteHistoryEvents));
  const table = ['| Roster | Unlocks/member | Note History | KiB | Boundary | set-chunk ms | set-note ms | complete-task ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const rosterSize of [1, 2, 3, 4, 5]) for (const [unlocked, history] of [[0, 0], [maxUnlocked, maxHistory]]) {
    for (const boundary of ['applyCommand', 'applyValidatedCommand']) {
      const rows = result.rows.filter(row => row.rosterSize === rosterSize && row.unlockedPerMember === unlocked && row.noteHistoryEvents === history && row.boundary === boundary);
      table.push(`| ${rosterSize} | ${unlocked} | ${history} | ${(rows[0].stateBytes / 1024).toFixed(1)} | ${boundary} | ${rows.map(row => row.meanMs.toFixed(3)).join(' | ')} |`);
    }
  }
  return `# Synthetic command CPU cost\n\n${result.node}, ${result.platform}, ${result.cpuModel}; ${result.iterations} samples/cell after one warm-up. Values are arithmetic mean milliseconds. JSON contains every intermediate point and sample.\n\n${table.join('\n')}\n\n${result.scope}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({ options: { profile: { type: 'string', default: 'smoke' }, output: { type: 'string' }, iterations: { type: 'string', default: '3' } } });
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24.');
  const profilePath = ['smoke', 'nominal', 'step-up'].includes(args.profile) ? new URL(`./profiles/${args.profile}.json`, import.meta.url) : path.resolve(args.profile);
  const profile = JSON.parse(await readFile(profilePath, 'utf8')), iterations = Number(args.iterations);
  probeLimits(profile, iterations);
  if (!args.output) throw new Error('Use --output NEW_DIRECTORY.');
  const output = path.resolve(args.output); await mkdir(output, { mode: 0o700 });
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
  process.env.RS3_DATASET = 'duo-legacy'; process.env.RS3_PACKS_DIR = path.join(output, 'no-packs');
  process.env.RS3_GAME_DATA_DIR = path.join(output, 'no-game-data'); process.env.RS3_MAP_ASSETS_DIR = path.join(output, 'no-assets');
  const result = await commandCosts(profile, { iterations, onProgress: row => console.log(JSON.stringify(row)) });
  await writeFile(path.join(output, 'command-cost.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  await writeFile(path.join(output, 'command-cost.md'), commandCostMarkdown(result), { flag: 'wx' });
  console.log(path.join(output, 'command-cost.md'));
}
