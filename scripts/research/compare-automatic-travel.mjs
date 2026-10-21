#!/usr/bin/env node
// Read-only save comparison. No server, store, network, account sync or gameplay writes.
import { readFile, realpath, lstat, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';

const root = path.resolve(import.meta.dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...new Set(values ?? [])].sort();
const changes = (before, after) => ({ added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) });
const variants = [
  { id: 'baseline', automatic: false, transport: false },
  { id: 'automatic', automatic: true, transport: false },
  { id: 'automatic-transport', automatic: true, transport: true },
];
const flags = process.argv.slice(2);
function option(name, fallback) {
  const index = flags.indexOf(name);
  if (index < 0) return fallback;
  if (!flags[index + 1] || flags[index + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return flags[index + 1];
}
const within = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
async function noLinks(absolute) {
  for (let cursor = absolute; ; cursor = path.dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlinks/junctions are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cursor === path.dirname(cursor)) break;
  }
}
async function copiedDirectory(input) {
  const absolute = path.resolve(input); await noLinks(absolute);
  const resolved = await realpath(absolute);
  if (!within(path.join(root, '.local'), resolved) || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(resolved)) {
    throw new Error('Save must be a separately named copy inside this worktree .local, outside .local/duo');
  }
  return resolved;
}
async function inventory(directory) {
  const records = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Copied input contains a symlink/junction');
      if (/^(store\.lock|invites\.json|feedback(?:\.json)?|access-token(?:\..*)?)$/i.test(entry.name)) throw new Error('Remove lock, invitation, feedback and access-token files from the COPY first');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) records.push({ file: path.relative(directory, file).replaceAll('\\', '/'), sha256: hash(await readFile(file)) });
      else throw new Error('Copied input contains a non-regular file');
    }
  }
  await visit(directory);
  return { count: records.length, sha256: hash(JSON.stringify(records)) };
}
async function hydrate(directory) {
  const stateBytes = await readFile(path.join(directory, 'state.json'));
  const envelope = JSON.parse(stateBytes);
  if (envelope.format !== 'rs3-chunk-picker' || envelope.schemaVersion !== 1) throw new Error('Expected picker state.json envelope');
  if (envelope.storage) {
    if (envelope.storage.schemaVersion !== 1 || Object.keys(envelope.storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new Error('Invalid static storage metadata');
    const allowed = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
    for (const [key, reference] of Object.entries(envelope.storage.fields ?? {})) {
      if (!allowed.has(key) || Object.hasOwn(envelope.state, key) || !/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)
        || reference.id !== `static-${reference.sha256}.json.gz`) throw new Error('Invalid static save reference');
      const file = path.join(directory, 'static', reference.id), resolved = await realpath(file);
      if (!within(directory, resolved)) throw new Error('Static dependency escapes copied save');
      const bytes = gunzipSync(await readFile(file));
      if (hash(bytes) !== reference.sha256) throw new Error('Static save checksum mismatch');
      envelope.state[key] = JSON.parse(bytes);
    }
  }
  return { state: envelope.state, sha256: hash(stateBytes) };
}
async function startWorker(definitions, world) {
  const worker = new Worker(new URL('../../app/tasks/worker.mjs', import.meta.url), { workerData: { definitions, world: { chunks: world.chunks, surface: world.surface } } });
  let nextId = 0;
  const pending = new Map();
  const fail = error => { for (const callbacks of pending.values()) callbacks.reject(error); pending.clear(); };
  worker.on('error', fail); worker.on('exit', code => fail(new Error(`Task worker exited (${code})`)));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup exceeded 120 seconds')), 120000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited before readiness (${code})`)); });
    worker.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message); }
      else if (pending.has(message.id)) { const callbacks = pending.get(message.id); pending.delete(message.id); message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message); }
    });
  }).catch(async error => { await worker.terminate(); throw error; });
  return { worker, ready, evaluate: (state, memberId, input) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('Task calculation exceeded 120 seconds')); }, 120000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value.result); }, reject: error => { clearTimeout(timer); reject(error); } });
    worker.postMessage({ id, state, memberId, input });
  }) };
}
async function main() {
  if (flags.includes('--help')) { console.log('node scripts/research/compare-automatic-travel.mjs --data-dir .local/<COPY> [--output .local/automatic-travel-report.json]\nThree sequential scenarios, one hydrated copied save, saved consumables preserved. No server, network, sync or save writes. Output is a compact capability/delta report.'); return; }
  for (let index = 0; index < flags.length; index += 2) if (!['--data-dir', '--output'].includes(flags[index])) throw new Error(`Unknown option ${flags[index]}`);
  if (!option('--data-dir')) throw new Error('An explicit copied --data-dir is required');
  const directory = await copiedDirectory(option('--data-dir'));
  const output = path.resolve(option('--output', path.join(root, '.local/automatic-travel-report.json')));
  if (!within(path.join(root, '.local'), output) || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(output) || within(directory, output) || output === directory) throw new Error('Output must stay inside this worktree .local, outside the copied save and .local/duo');
  await noLinks(output);
  const copiedBefore = await inventory(directory), loaded = await hydrate(directory);
  const sourceFiles = ['scripts/research/compare-automatic-travel.mjs', 'app/core/automatic-transport.mjs', 'app/core/transport-access.mjs', 'app/core/rules.mjs', 'app/tasks/worker.mjs', 'app/tasks/engine.mjs', 'app/tasks/access.mjs', 'app/data/world.mjs', 'app/data/transport-routes.mjs'];
  const routeLoader = await readFile(path.join(root, 'app/data/transport-routes.mjs'), 'utf8');
  for (const match of routeLoader.matchAll(/from\s+['"](.\/[^'"]+\.json)['"]/g)) sourceFiles.push(path.posix.join('app/data', match[1]));
  const sourceHashes = await Promise.all(sourceFiles.map(async file => ({ file, sha256: hash(await readFile(path.join(root, file))) })));
  const trackedAppDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'app'], { cwd: root }));
  const { validateState } = await import('../../app/core/state.mjs');
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  const { buildWorld } = await import('../../app/data/world.mjs');
  const { applyCacheShops } = await import('../../app/data/cache-shops.mjs');
  const { applyEquipmentCorrections } = await import('../../app/data/equipment-corrections.mjs');
  const { evaluateRollPool, createRuleRegistry } = await import('../../app/core/rules.mjs');
  const { createTaskFactsIndex } = await import('../../app/core/progress-index.mjs');
  const { evaluateTransportRoutes } = await import('../../app/core/transport-access.mjs');
  const { configureAutomaticTransport, deriveAutomaticTransport } = await import('../../app/core/automatic-transport.mjs');
  const { sameRuneScapeName } = await import('../../app/core/game-progress.mjs');
  const original = validateState(loaded.state);
  const definitionBytes = await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'));
  const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(definitionBytes))), world = buildWorld(definitions, { dataset: selectedDataset });
  const named = id => ({ id, name: world.chunks.get(id)?.name ?? world.areas.get(id)?.name ?? world.chunks.get(id.split('-')[0])?.name ?? id });
  const namedIds = ids => sorted(ids).map(named);
  const taskLabel = row => ({ id: row.id, label: row.label, category: row.category });
  const baselines = new Map(), snapshots = [];
  configureAutomaticTransport(world, { engine: { evaluate: (_state, memberId) => { const result = baselines.get(memberId); if (!result) throw new Error('Baseline must precede automatic scenario'); return result; } } });
  const { worker, ready, evaluate } = await startWorker(definitions, world);
  try {
    for (const variant of variants) {
      const state = { ...original, rules: { ...original.rules, 'travel.automatic': variant.automatic, 'access.transport': variant.transport } };
      const members = [];
      for (const member of state.members) {
        console.error(`Comparing ${variant.id} / ${member.name}`);
        const result = await evaluate(state, member.id, `automatic-report:${variant.id}:${member.id}`);
        if (variant.id === 'baseline') baselines.set(member.id, result);
        const presented = new Set(result.presentation.tasks.map(row => row.id));
        const possible = result.tasks.filter(row => row.status === 'available' && row.obligation !== false);
        const facts = createTaskFactsIndex(state, member.id, createRuleRegistry(), { tasks: result.tasks, completionGroups: result.collectionPlanning.completionGroups });
        const active = possible.filter(row => !row.hidden && presented.has(row.id) && !member.taskStatus?.[row.id]?.backlogged && !facts.get(row.id, row.completionIds).group);
        if (possible.length !== result.metrics.availableCount) throw new Error('Possible count disagrees with production metric');
        const pool = evaluateRollPool(world, state, member.id), routes = evaluateTransportRoutes(world, state, member.id);
        const context = deriveAutomaticTransport(world, state, member.id);
        const locationFields = ['bases', 'sections', 'components', 'areas'];
        const reachability = Object.fromEntries(locationFields.flatMap(field => [
          [`own${field[0].toUpperCase()}${field.slice(1)}`, sorted(result.obligationAccess[field])],
          [`shared${field[0].toUpperCase()}${field.slice(1)}`, sorted(result.access[field])],
        ]));
        const departureScope = new Set(Object.entries(reachability).filter(([key]) => key.startsWith('shared')).flatMap(([, ids]) => ids));
        const ownDepartureScope = new Set(Object.entries(reachability).filter(([key]) => key.startsWith('own')).flatMap(([, ids]) => ids));
        const displayAvailable = row => row.global ? row.rollAvailable === true : row.available === true;
        const summarizeRoute = row => ({ id: row.id, name: row.name, kind: row.kind, group: row.group, from: row.from, to: row.to,
          destination: row.rollDestination?.chunkId || row.destination ? named(row.rollDestination?.chunkId ?? row.destination) : null,
          rollDestination: row.rollDestination ?? null, estimated: row.estimated, levelEstimated: row.levelEstimated === true,
          activationEstimated: row.activationEstimated === true, global: row.global,
          available: displayAvailable(row), accessAvailable: row.available === true,
          rollAvailable: row.global && row.rollAvailable === true, rollOnly: row.global && row.rollAvailable === true && row.available !== true,
          currentlyReachableDeparture: row.global ? context.safeOrigin === true : departureScope.has(row.from),
          ownReachableDeparture: row.global ? null : ownDepartureScope.has(row.from),
          reasons: row.reasons, accessBlockers: [...row.unmet, ...row.unknown], rollReasons: row.rollReasons ?? null,
          preparations: row.preparations ?? [] });
        members.push({ id: member.id, name: member.name, runescapeName: member.runescapeName,
          counts: { active: active.length, possible: possible.length, rollPool: pool.eligible.length,
            usableRoutes: routes.filter(displayAvailable).length, accessUsableRoutes: routes.filter(row => row.available).length,
            rollOnlyRoutes: routes.filter(row => row.global && row.rollAvailable === true && !row.available).length,
            ...Object.fromEntries(Object.entries(reachability).map(([key, ids]) => [key, ids.length])) },
          activeTasks: active.map(taskLabel), possibleTasks: possible.map(taskLabel),
          reachability: Object.fromEntries(Object.entries(reachability).map(([key, ids]) => [key, namedIds(ids)])),
          pool: pool.eligible.map(row => ({ ...named(row.id), reasons: row.reasons })),
          usableRoutes: routes.filter(displayAvailable).map(summarizeRoute),
          unknownEndpoints: routes.filter(row => row.unknown?.some(reason => ['endpoint', 'pending-route', 'unresolved-destination'].includes(reason.requirement))).map(summarizeRoute),
          manualTeleports: member.teleports.filter(row => row.available && (!row.consumable || state.rules['roll.consumableTeleports'])).map(row => ({ id: row.id, label: row.label, destination: named(row.destination), consumable: row.consumable })),
          estimatedLevels: [...context.estimatedLevels].sort().map(skill => ({ skill, level: context.facts.levels[skill] })),
          observedLevels: [...context.observedLevels].sort().map(skill => ({ skill, level: context.facts.levels[skill] })),
          partnerConnections: result.partnerConnections,
        });
      }
      snapshots.push({ ...variant, members });
    }
  } finally { await worker.terminate(); }
  function compare(before, after) {
    return { before: before.id, after: after.id, members: after.members.map(member => {
      const prior = before.members.find(row => row.id === member.id);
      const listDelta = (oldRows, rows) => { const diff = changes(oldRows.map(row => row.id), rows.map(row => row.id)); return { added: rows.filter(row => diff.added.includes(row.id)), removed: oldRows.filter(row => diff.removed.includes(row.id)) }; };
      return { id: member.id, name: member.name, before: prior.counts, after: member.counts,
        deltas: Object.fromEntries(Object.keys(member.counts).map(key => [key, member.counts[key] - prior.counts[key]])),
        rollPool: listDelta(prior.pool, member.pool), activeTasks: listDelta(prior.activeTasks, member.activeTasks), possibleTasks: listDelta(prior.possibleTasks, member.possibleTasks),
        usableRoutes: listDelta(prior.usableRoutes, member.usableRoutes),
        reachability: Object.fromEntries(Object.keys(member.reachability).map(key => [key, listDelta(prior.reachability[key], member.reachability[key])])) };
    }) };
  }
  const copiedAfter = await inventory(directory);
  if (JSON.stringify(copiedBefore) !== JSON.stringify(copiedAfter)) throw new Error('Copied save files changed during comparison');
  for (const source of sourceHashes) if (hash(await readFile(path.join(root, source.file))) !== source.sha256) throw new Error(`Comparison source changed during evaluation: ${source.file}`);
  if (hash(execFileSync('git', ['diff', 'HEAD', '--', 'app'], { cwd: root })) !== trackedAppDiffSha256) throw new Error('Tracked app source changed during evaluation');
  const statusRecords = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).split('\0');
  const changedFiles = [];
  for (let index = 0; index < statusRecords.length; index++) {
    const record = statusRecords[index]; if (!record) continue;
    const status = record.slice(0, 2), file = record.slice(3).replaceAll('\\', '/');
    if (/[RC]/.test(status)) index++;
    if (!file.startsWith('.local/') && (status === '??' || /[MARCU]/.test(status))) changedFiles.push({ file, status: status.trim() });
  }
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), node: process.version,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trackedAppDiffSha256, sourceHashes, changedFiles,
    sourceSha256: loaded.sha256, sourceRevision: original.revision, referenceSha256: hash(definitionBytes), copiedInput: { ...copiedBefore, unchanged: true },
    settings: { savedAutomatic: original.rules['travel.automatic'] ?? false, savedTransport: original.rules['access.transport'] ?? false,
      consumableTeleports: original.rules['roll.consumableTeleports'] ?? false, f2p: original.rules['content.f2p'] ?? true,
      teleportsEnabled: original.rules['roll.teleports'] ?? true, teleportScope: original.rules['roll.teleportScope'] ?? 'personal',
      neighborMode: original.rules['roll.neighborMode'] ?? 'accessible',
      resourceContents: process.env.RS3_RESOURCE_CONTENTS === 'retained' ? 'retained' : 'game-data', archaeologyContents: process.env.RS3_ARCHAEOLOGY_CONTENTS === 'retained' ? 'retained' : 'game-data' },
    activeDefinition: 'Unfinished, visible, presented own obligations, excluding completed and backlogged tasks; no search/show-all/show-blocked display filters or custom-task fallback.',
    possibleDefinition: 'Production availableCount: available own obligations, including completed/hidden/backlogged tasks before Active filtering.',
    reachabilityDefinition: 'Own = obligationAccess (owned task territory); shared = access (owned plus round-trip-connected partner convenience territory). bases means chunks; sections and cache components remain separate.',
    travelDefinition: 'Displayed usable globals use rollAvailable and pinned surface rollDestination evidence; non-global routes use strict available. accessAvailable requires resolved component geometry. rollOnly destinations confer roll eligibility without resources or access.',
    evidence: original.members.map(member => ({ id: member.id, name: member.name, runescapeName: member.runescapeName, sourceMapId: member.sourceMapId,
      unlockedCount: member.unlocked.length, selectedCount: member.selected.length, savedManualTeleportCount: member.teleports.length,
      syncedSkills: Object.entries(member.skillProgress ?? {}).filter(([, row]) => row.source === 'runemetrics' && sameRuneScapeName(row.runescapeName, member.runescapeName)).map(([skill, row]) => ({ skill, level: row.level, fetchedAt: row.fetchedAt })),
      syncedCompletedQuests: Object.entries(member.questProgress ?? {}).filter(([id, row]) => member.completedTasks.includes(id) && row.source === 'runemetrics' && sameRuneScapeName(row.runescapeName, member.runescapeName)).map(([id, row]) => ({ id, title: row.title, fetchedAt: row.fetchedAt })),
      explicitTransportFactCounts: Object.fromEntries(Object.entries(member.transportFacts ?? {}).map(([key, rows]) => [key, Object.keys(rows).length])) })),
    compileMs: ready.compileMs, scenarios: snapshots,
    comparisons: [compare(snapshots[0], snapshots[1]), compare(snapshots[1], snapshots[2]), compare(snapshots[0], snapshots[2])] };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Comparison report written: ${output}`);
  for (const scenario of report.scenarios) for (const member of scenario.members) console.log(`${scenario.id} / ${member.name}: Active ${member.counts.active}; possible ${member.counts.possible}; roll pool ${member.counts.rollPool}; usable routes ${member.usableRoutes.length}`);
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
