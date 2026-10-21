import { selectedDataset } from '../app/dataset-runtime.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readCopiedState } from './research/local-parity-model.mjs';
import { applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { applyEquipmentCorrections } from '../app/data/equipment-corrections.mjs';
import { applyCacheShops, cacheShopContentsEnabled } from '../app/data/cache-shops.mjs';
import { cacheResourceContentsEnabled } from '../app/data/cache-resources.mjs';
import { cacheArchaeologyContentsEnabled } from '../app/data/cache-archaeology.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { projectDuoSidebarResult } from '../app/duo-play-view.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { hasGameplayMigration, hasCurrentProgressAliasMigration, migrateOwnedGameplay,
  resolveSavedTaskId, stripTaskMarkup } from '../app/tasks/migration.mjs';
import { deserialize } from 'node:v8';

// Read-only copied-save proof. No store, HTTP server, browser, game sync, token,
// invitation, history compaction or save-writing API is used by this script.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, target) => { const relative = path.relative(base, target); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const normalized = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
const parsedShared = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const flags = process.argv.slice(2);
const option = (name, fallback) => { const index = flags.indexOf(name); return index < 0 ? fallback : flags[index + 1]; };

async function appFingerprint() {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('App hash input must not contain a symlink');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push([path.relative(root, file).replaceAll('\\', '/'), hash(await readFile(file))]);
    }
  }
  await visit(path.join(root, 'app'));
  return { sha256: hash(JSON.stringify(files)), files: files.length };
}

async function inputFingerprint(directory) {
  const stateBytes = await readFile(path.join(directory, 'state.json'));
  const document = JSON.parse(stateBytes), dependencies = [];
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference?.id ?? '')) throw new Error('Invalid copied static dependency');
    dependencies.push([key, reference.id, hash(await readFile(path.join(directory, 'static', reference.id)))]);
  }
  return { stateSha256: hash(stateBytes), dependencySha256: hash(JSON.stringify(dependencies)), dependencies: dependencies.length };
}

async function startWorker(definitionBytes, world) {
  const shared = new SharedArrayBuffer(definitionBytes.length); Buffer.from(shared).set(definitionBytes);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: {
    definitionBytes: shared, world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [],
  } });
  let sequence = 0, stopping = false;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const startupTimer = setTimeout(() => readyReject(new Error('Worker startup exceeded 120 seconds')), 120000);
  function fail(error) {
    clearTimeout(startupTimer); readyReject(error);
    for (const callbacks of pending.values()) { clearTimeout(callbacks.timer); callbacks.reject(error); }
    pending.clear();
  }
  worker.on('error', fail);
  worker.on('exit', code => { if (!stopping) fail(new Error(`Worker exited (${code})`)); });
  worker.on('message', message => {
    if (message.type === 'ready') { clearTimeout(startupTimer); readyResolve(message.dynamicCatalogueBytes === undefined ? message : { ...message, dynamicCatalogue: deserialize(message.dynamicCatalogueBytes) }); return; }
    const callbacks = pending.get(message.id); if (!callbacks) return;
    pending.delete(message.id); clearTimeout(callbacks.timer);
    if (message.error) callbacks.reject(new Error(`Worker ${message.error.name}: ${message.error.message}`));
    else callbacks.resolve(message);
  });
  const close = async () => { stopping = true; fail(new Error('Worker stopped')); await worker.terminate(); };
  try {
    return { ready: await ready, close, send(request) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Worker calculation exceeded 120 seconds')); }, 120000);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, ...request }); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    } };
  } catch (error) { await close(); throw error; }
}

function currentMigration(state, ready) {
  const registered = new Set(state.tasks.map(task => task.id));
  return ready.catalogue.every(row => registered.has(row.id)) && state.identityRegistry?.schemaVersion === 1
    && hasCurrentProgressAliasMigration(state)
    && state.members.every(member => member.sourceMapId == null || state.legacy?.gameplayMigration?.schemaVersion >= 2 && hasGameplayMigration(state, member))
    && state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
      && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)));
}

function summary(result, state, memberId, registry) {
  const member = state.members.find(row => row.id === memberId), presented = new Set(result.presentation.tasks.map(row => row.id));
  const facts = createTaskFactsIndex(state, memberId, registry, { tasks: result.tasks, completionGroups: result.collectionPlanning.completionGroups });
  const possible = result.tasks.filter(row => row.status === 'available' && row.obligation !== false);
  const active = possible.filter(row => !row.hidden && presented.has(row.id) && !member.taskStatus?.[row.id]?.backlogged && !facts.get(row.id, row.completionIds).group);
  return { report: { possibleTasks: possible.length, activeTasks: active.length,
    activeExamples: active.slice(0, 3).map(row => ({ category: row.category, label: stripTaskMarkup(row.label) })) },
    active: active.map(row => ({ id: row.id, category: row.category, label: stripTaskMarkup(row.label) })),
    taskRowHashes: new Map(result.tasks.map(row => [row.id, hash(JSON.stringify(normalized(row)))])) };
}

async function main() {
  if (flags.includes('--help')) { console.log('node scripts/check-worker-unlocks.mjs --source .local/workers-save --output .local/check/worker-unlocks.json [--chunk-player1 ID] [--chunk-player2 ID]\nOne native worker at a time; copied save and static dependencies read-only. No server or live save access.'); return; }
  for (let index = 0; index < flags.length; index += 2) if (!['--source', '--output', '--chunk-player1', '--chunk-player2'].includes(flags[index]) || !flags[index + 1]) throw new Error(`Invalid option ${flags[index]}`);
  if (!option('--source')) throw new Error('An explicit frozen copied --source is required');
  const local = await realpath(path.join(root, '.local')), directory = await realpath(path.resolve(root, option('--source')));
  if (!inside(local, directory) || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(directory)) throw new Error('Source must be a copied save inside this worktree .local, outside .local/duo');
  const output = path.resolve(root, option('--output', '.local/check/worker-unlocks.json'));
  if (!inside(local, output) || inside(directory, output) || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(output)) throw new Error('Output must stay in worktree .local, outside the source and .local/duo');
  await mkdir(path.dirname(output), { recursive: true });
  const outputDirectory = await realpath(path.dirname(output));
  if (!inside(local, outputDirectory) || outputDirectory === directory || inside(directory, outputDirectory)) throw new Error('Output directory escapes authorized report area');
  try { if (!(await lstat(output)).isFile()) throw new Error('Output must be a regular file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const copiedBefore = await inputFingerprint(directory), appBefore = await appFingerprint();
  const scriptSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const registry = createRuleRegistry(), loaded = await readCopiedState(directory, registry);
  const rawDefinitions = await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'));
  const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(rawDefinitions.toString('utf8'))));
  const definitionBytes = Buffer.from(JSON.stringify(definitions)), world = buildWorld(definitions, { dataset: selectedDataset });
  const report = { format: 'worker-unlock-equality-v1', sourceRevision: loaded.state.revision,
    inputs: { ...copiedBefore, definitionSha256: hash(rawDefinitions), effectiveDefinitionSha256: hash(definitionBytes), scriptSha256, app: appBefore },
    contentFlags: { cacheShops: cacheShopContentsEnabled(), cacheResources: cacheResourceContentsEnabled(), cacheArchaeology: cacheArchaeologyContentsEnabled() },
    normalization: 'elapsedMs only; task ordering, evidence and all projection fields retained', scenarios: [] };
  let original = loaded.state, migrationChecked = false;
  try {
    for (const savedMember of original.members) {
      let predictionWorker, fullWorker;
      try {
        console.error(`Checking ${savedMember.name}: baseline and hypothetical unlock`);
        predictionWorker = await startWorker(definitionBytes, world);
        if (!migrationChecked) {
          const current = currentMigration(original, predictionWorker.ready);
          if (!current) original = migrateOwnedGameplay(original, { definitions, catalogue: predictionWorker.ready.catalogue,
            dynamicCatalogue: predictionWorker.ready.dynamicCatalogue, taskMap: JSON.parse(await readFile(path.join(root, 'reference/original-picker/tasksMap.json'), 'utf8')),
            taskMapHistory: JSON.parse(await readFile(path.join(root, 'app/data/legacy-task-history.json'), 'utf8')) }).state;
          report.migrationReused = current; migrationChecked = true;
        }
        const { history, provenance, ...calculation } = original; calculation.history = [];
        const member = calculation.members.find(owner => owner.id === savedMember.id);
        const chunkId = option(`--chunk-${member.id}`) ?? member.selected.find(id => !member.unlocked.includes(id) && !member.pendingRoll.includes(id)
          && /^[1-9]\d*$/.test(id) && world.chunks.has(id) && world.surface.has(id));
        if (!chunkId) throw new Error(`No locked surface selected chunk for ${member.name}`);
        if (member.unlocked.includes(chunkId) || !world.surface.has(chunkId)) throw new Error(`Use a locked surface chunk for ${member.name}`);
        const ownershipBefore = calculation.members.map(owner => ({ memberId: owner.id, owned: owner.unlocked.length }));
        const originalInput = taskReuseInputKey(calculation), baselines = new Map();
        for (const owner of calculation.members) {
          const baseline = await predictionWorker.send({ type: 'evaluate', state: calculation, memberId: owner.id, input: originalInput });
          baselines.set(owner.id, summary(baseline.result, calculation, owner.id, registry));
        }
        const prediction = await predictionWorker.send({ type: 'predict', state: calculation, memberId: member.id, chunkId, input: originalInput });
        if (!prediction.unlockReuse) throw new Error('Prediction did not export compact unlock reuse projections');
        await predictionWorker.close(); predictionWorker = undefined;
        const after = applyCommand(calculation, { type: 'set-chunk', memberId: member.id, chunkId, status: 'unlocked' }, { world, registry });
        const afterInput = taskReuseInputKey(after);
        assert.equal(prediction.unlockReuse.taskInputKey, afterInput, 'Saved and hypothetical task inputs must match');
        assert.equal(taskReuseInputKey(calculation), originalInput, 'Unlock must not mutate original input');
        assert.deepEqual(calculation.members.map(owner => ({ memberId: owner.id, owned: owner.unlocked.length })), ownershipBefore);
        for (const owner of calculation.members) if (owner.id !== member.id) assert.equal(hash(JSON.stringify(after.members.find(row => row.id === owner.id))),
          hash(JSON.stringify(owner)), 'Partner ownership and progress must remain unchanged');
        console.error(`Checking ${member.name}: fresh saved unlock and group projections`);
        fullWorker = await startWorker(definitionBytes, world);
        const members = [];
        let equality;
        const partnerProjections = {};
        for (const owner of after.members) {
          const evaluated = await fullWorker.send({ type: 'evaluate', state: after, memberId: owner.id, input: afterInput });
          const afterSummary = summary(evaluated.result, after, owner.id, registry), beforeSummary = baselines.get(owner.id);
          const beforeIds = new Set(beforeSummary.active.map(row => row.id)), afterIds = new Set(afterSummary.active.map(row => row.id));
          const added = afterSummary.active.filter(row => !beforeIds.has(row.id)), removed = beforeSummary.active.filter(row => !afterIds.has(row.id));
          const completeTaskIds = new Set([...beforeSummary.taskRowHashes.keys(), ...afterSummary.taskRowHashes.keys()]);
          const changedTaskRows = [...completeTaskIds].filter(id => beforeSummary.taskRowHashes.get(id) !== afterSummary.taskRowHashes.get(id)).length;
          members.push({ name: owner.name, memberId: owner.id, before: beforeSummary.report, after: afterSummary.report,
            changedTaskRows,
            activeGoalsAdded: added.length, addedExamples: added.slice(0, 3).map(({ category, label }) => ({ category, label })),
            activeGoalsRemoved: removed.length, removedExamples: removed.slice(0, 3).map(({ category, label }) => ({ category, label })) });
          {
            const prepared = owner.id === member.id ? prediction.unlockReuse : prediction.partnerUnlockReuse;
            assert.equal(prepared?.memberId, owner.id, 'Every player needs a complete prepared result');
            assert.equal(prepared.taskInputKey, afterInput, 'Partner preparation must match the saved task inputs');
            const play = projectPlayResult(evaluated.result), actual = { playJSON: play, duoJSON: projectDuoSidebarResult(play, after, registry, owner.id),
              duoSidebarJSON: projectDuoSidebarResult(play, after, registry, owner.id) };
            const projections = {};
            for (const [key, value] of Object.entries(actual)) {
              const expected = normalized(parsedShared(prepared[key])), fresh = normalized(value);
              try { assert.deepEqual(expected, fresh); }
              catch { throw new Error(`${owner.name} ${key} differs from fresh saved calculation: prepared ${hash(JSON.stringify(expected))}, fresh ${hash(JSON.stringify(fresh))}`); }
              projections[key] = { equal: true, sha256: hash(JSON.stringify(fresh)) };
            }
            if (owner.id === member.id) equality = projections; else partnerProjections[owner.id] = projections;
          }
        }
        await fullWorker.close(); fullWorker = undefined;
        report.scenarios.push({ unlockedBy: member.name, memberId: member.id, chunkId, chunkName: world.chunks.get(chunkId)?.name ?? chunkId,
          taskInputSignatureEqual: true, beforeTaskInputSha256: originalInput, afterTaskInputSha256: afterInput,
          projections: equality, partnerProjections, members, ownershipBefore, ownershipAfter: after.members.map(owner => ({ memberId: owner.id, owned: owner.unlocked.length })),
          originalOwnershipUnchanged: true, partnerStateUnchanged: true });
      } finally { await predictionWorker?.close(); await fullWorker?.close(); }
    }
    assert.deepEqual(await inputFingerprint(directory), copiedBefore, 'Frozen state and static dependencies must remain unchanged');
    assert.deepEqual(await appFingerprint(), appBefore, 'App source must remain unchanged during proof');
    report.sourceUnchanged = true; report.appUnchanged = true; report.allEquivalent = true;
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ report: path.relative(root, output).replaceAll('\\', '/'), scenarios: report.scenarios.length,
      allEquivalent: true, sourceUnchanged: true, appUnchanged: true }));
  } finally { assert.deepEqual(await inputFingerprint(directory), copiedBefore, 'Frozen source changed during check'); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
