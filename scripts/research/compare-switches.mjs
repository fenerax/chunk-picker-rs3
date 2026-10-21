#!/usr/bin/env node
// Read-only comparison: no store, listener, credential, network or save writes.
import { readFile, realpath, lstat, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, brotliCompressSync, constants } from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const variants = ['off', 'archaeology', 'shops', 'transport', 'house', 'all'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...new Set(values)].sort();
const delta = (before, after) => ({ added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const flags = process.argv.slice(2);
function option(name, fallback) {
  const index = flags.indexOf(name);
  if (index < 0) return fallback;
  if (!flags[index + 1] || flags[index + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return flags[index + 1];
}
async function safeDirectory(input) {
  const absolute = path.resolve(input), resolved = await realpath(absolute);
  for (let cursor = absolute; ; cursor = path.dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Use a copy without symlinks/junctions');
    if (cursor === path.dirname(cursor)) break;
  }
  if (/[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(resolved)) {
    throw new Error('Use a separately named data-directory copy, not .local/duo');
  }
  const names = await readdir(resolved);
  if (names.includes('store.lock') || names.includes('invites.json')) throw new Error('Remove store.lock and invites.json from the COPY first');
  return resolved;
}
async function loadCopy(dataDir) {
  const dependencies = [];
  async function readDependency(file) {
    const resolved = await realpath(file), relative = path.relative(dataDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || (await lstat(file)).isSymbolicLink()) throw new Error('Save dependency escapes copied data directory');
    const bytes = await readFile(resolved);
    dependencies.push({ file: resolved, sha256: hash(bytes) });
    return bytes;
  }
  const bytes = await readDependency(path.join(dataDir, 'state.json'));
  const envelope = JSON.parse(bytes);
  if (envelope.format !== 'rs3-chunk-picker' || envelope.schemaVersion !== 1) throw new Error('Expected picker state.json backup envelope');
  if (envelope.storage) {
    if (envelope.storage.schemaVersion !== 1 || Object.keys(envelope.storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new Error('Invalid static storage metadata');
    const allowed = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
    for (const [key, reference] of Object.entries(envelope.storage.fields ?? {})) {
      if (!allowed.has(key) || Object.hasOwn(envelope.state, key) || !/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)
        || reference.id !== `static-${reference.sha256}.json.gz`) throw new Error('Invalid static save reference');
      const fieldBytes = gunzipSync(await readDependency(path.join(dataDir, 'static', reference.id)));
      if (hash(fieldBytes) !== reference.sha256) throw new Error('Static save checksum mismatch');
      envelope.state[key] = JSON.parse(fieldBytes);
    }
  }
  return { state: envelope.state, sourceSha256: hash(bytes), dependencies };
}
async function verifyDependencies(dependencies) {
  for (const row of dependencies) if (hash(await readFile(row.file)) !== row.sha256) throw new Error('Copied input changed during comparison');
}
function named(world, id) {
  const base = id.split('-')[0];
  return { id, name: world.chunks.get(id)?.name ?? world.areas.get(id)?.name ?? world.chunks.get(base)?.name ?? id };
}
function taskSummary(task, active, presented, possible) {
  return { id: task.id, label: task.label, category: task.category, level: task.level ?? null,
    status: task.status, obligation: task.obligation !== false, hidden: !!task.hidden,
    active: active.has(task.id), presented: presented.has(task.id), possible: possible.has(task.id),
    blockers: task.blockers?.map(row => ({ kind: row.kind, detail: row.detail })) ?? [],
    sources: task.sources ?? [], members: !!task.record?.['Not F2P'] };
}
async function childComparison(dataDir, variant, runs) {
  const { state: loaded, sourceSha256, dependencies } = await loadCopy(dataDir);
  const { validateState, applyCommand } = await import('../../app/core/state.mjs');
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  const { buildWorld } = await import('../../app/data/world.mjs');
  const { applyCacheShops } = await import('../../app/data/cache-shops.mjs');
  const { applyEquipmentCorrections } = await import('../../app/data/equipment-corrections.mjs');
  const { evaluateRollPool, createRuleRegistry, reachableSections } = await import('../../app/core/rules.mjs');
  const { createTaskFactsIndex } = await import('../../app/core/progress-index.mjs');
  const { evaluateTransportRoutes } = await import('../../app/core/transport-access.mjs');
  const { projectPlayResult } = await import('../../app/play-view.mjs');
  const { flattenChunkContents } = await import('../preview-resource-contents.mjs');
  let state = validateState(loaded);
  const originalSettings = { transport: state.rules['access.transport'] ?? false,
    consumableTeleports: state.rules['roll.consumableTeleports'] ?? false,
    house: Object.fromEntries(state.members.map(member => [member.id, member.taskRules?.['House storage tasks'] ?? state.taskRules?.['House storage tasks'] ?? false])) };
  state = applyCommand(state, { type: 'set-rule', ruleId: 'access.transport', value: ['transport', 'all'].includes(variant) });
  for (const member of state.members) state = applyCommand(state, { type: 'set-task-rule', memberId: member.id,
    ruleId: 'House storage tasks', value: ['house', 'all'].includes(variant) });
  const definitionBytes = await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'));
  const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(definitionBytes)));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const started = performance.now();
  const worker = new Worker(new URL('../../app/tasks/worker.mjs', import.meta.url), {
    workerData: { definitions, world: { chunks: world.chunks, surface: world.surface } } });
  let nextId = 0;
  const pending = new Map();
  const failPending = error => { for (const callbacks of pending.values()) callbacks.reject(error); pending.clear(); };
  worker.on('error', failPending);
  worker.on('exit', code => failPending(new Error(`Task worker exited (${code})`)));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Task worker startup exceeded 120 seconds')), 120000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Task worker exited before readiness (${code})`)); });
    worker.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message); }
      else if (pending.has(message.id)) { const callbacks = pending.get(message.id); pending.delete(message.id);
        if (message.error) callbacks.reject(new Error(message.error.message)); else callbacks.resolve(message); }
    });
  }).catch(async error => { await worker.terminate(); throw error; });
  const startupMs = performance.now() - started;
  async function evaluate(memberId, input, compact = false) {
    const id = ++nextId, requestStarted = performance.now();
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Task calculation exceeded 120 seconds')); }, 120000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      worker.postMessage({ id, state, memberId, input, ...(compact ? { resultTransport: 'json-shared-v1', resultView: 'play-v1' } : {}) });
    });
    return { ...reply, requestMs: performance.now() - requestStarted };
  }
  try {
    const members = [];
    for (const member of state.members) {
      const fullSamples = [], playSamples = [];
      let result, playBytes;
      for (let run = 0; run < runs; run++) {
        const full = await evaluate(member.id, `full:${member.id}:${run}`);
        result = full.result;
        fullSamples.push({ ...full.timingMs, requestMs: full.requestMs });
        const compact = await evaluate(member.id, `play:${member.id}:${run}`, true);
        playBytes = Buffer.from(compact.playJSON);
        playSamples.push({ ...compact.timingMs, requestMs: compact.requestMs });
      }
      const projected = Buffer.from(JSON.stringify(projectPlayResult(result)));
      if (projected.length < 1 || playBytes.length < 1) throw new Error('Empty task payload');
      const normalizePlay = value => { const normalized = structuredClone(value); delete normalized.metrics.elapsedMs; return normalized; };
      if (!isDeepStrictEqual(normalizePlay(JSON.parse(projected)), normalizePlay(JSON.parse(playBytes)))) throw new Error('Full/compact task results disagree');
      const presented = new Set(result.presentation.tasks.map(row => row.id));
      const possible = new Set(result.tasks.filter(row => row.status === 'available' && row.obligation !== false).map(row => row.id));
      if (possible.size !== result.metrics.availableCount) throw new Error('Possible task count disagrees with production metric');
      const facts = createTaskFactsIndex(state, member.id, createRuleRegistry(), { tasks: result.tasks,
        completionGroups: result.collectionPlanning.completionGroups });
      const active = new Set(result.tasks.filter(row => possible.has(row.id) && !row.hidden && presented.has(row.id)
        && !member.taskStatus?.[row.id]?.backlogged && !facts.get(row.id, row.completionIds).group).map(row => row.id));
      const pool = evaluateRollPool(world, state, member.id);
      // The production roll pool is the selectable set under the saved policy.
      // Manual selection is an independent explicit candidate source.
      const selectable = sorted(pool.eligible.map(row => row.id));
      const accessible = result.access;
      const timing = samples => Object.fromEntries(Object.keys(samples[0]).map(key => [key, median(samples.map(row => row[key]))]));
      members.push({ id: member.id, name: member.name, unlockedCount: member.unlocked.length, selectedCount: member.selected.length,
        counts: { active: active.size, presented: presented.size, possible: result.metrics.availableCount,
          rollPool: pool.eligible.length, selectable: selectable.length, areas: accessible.areas.length },
        tasks: result.tasks.map(row => taskSummary(row, active, presented, possible)),
        access: { ownSections: reachableSections(world, state, member.id), sections: accessible.sections, components: accessible.components ?? [], areas: accessible.areas,
          obligationSections: result.obligationAccess.sections, obligationComponents: result.obligationAccess.components, obligationAreas: result.obligationAccess.areas },
        partnerConnections: result.partnerConnections,
        pool: { eligible: pool.eligible, excluded: pool.excluded, selectable },
        transportRoutes: evaluateTransportRoutes(world, state, member.id),
        equipment: { currentBiS: result.currentBiS, planning: result.equipmentPlanning },
        items: result.items.map(row => ({ name: row.name, sources: row.sources })),
        performance: { full: timing(fullSamples), play: timing(playSamples), fullSamples, playSamples,
          fullBytes: Buffer.byteLength(JSON.stringify(result)), playBytes: playBytes.length,
          playBrotliBytes: brotliCompressSync(playBytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length },
        contentScope: { owned: member.unlocked, selected: member.selected, pending: member.pendingRoll,
          accessible: accessible.bases },
        diagnostics: result.diagnostics,
        houseStorage: result.houseStorage,
      });
    }
    const contents = [...world.resourceContents].map(([id, record]) => ({ ...named(world, id),
      objects: flattenChunkContents(record, id), shops: (() => { const rows = [];
        function visit(node, location) { for (const name of Object.keys(node?.Shop ?? {})) for (const [item, available] of Object.entries(definitions.shopItems?.[name] ?? {})) rows.push({ shop: name, item, available, location });
          for (const [section, part] of Object.entries(node?.Sections ?? {})) visit(part, `${id}-${section}`); }
        visit(record, id); return rows; })() }));
    await verifyDependencies(dependencies);
    return { variant, sourceSha256, sourceRevision: loaded.revision, referenceSha256: hash(definitionBytes), originalSettings,
      f2p: state.rules['content.f2p'] ?? true, compileMs: ready.compileMs, startupMs, members, contents,
      locations: [...world.chunks.values(), ...world.areas.values()] };
  } finally { await worker.terminate(); }
}
function compare(before, after) {
  const names = new Map(after.locations.map(row => [row.id, row.name]));
  const namedIds = ids => ids.map(id => ({ id, name: names.get(id) ?? names.get(id.split('-')[0]) ?? id }));
  const contentsBefore = new Map(before.contents.map(row => [row.id, row]));
  const contents = after.contents.flatMap(row => {
    const old = contentsBefore.get(row.id), prior = new Map((old?.objects ?? []).map(value => [value.id, value])), next = new Map(row.objects.map(value => [value.id, value]));
    const objects = sorted([...prior.keys(), ...next.keys()]).flatMap(id => isDeepStrictEqual(prior.get(id), next.get(id)) ? [] : [{ before: prior.get(id) ?? null, after: next.get(id) ?? null }]);
    const shops = isDeepStrictEqual(old?.shops ?? [], row.shops) ? [] : [{ before: old?.shops ?? [], after: row.shops }];
    return objects.length || shops.length ? [{ id: row.id, name: row.name, objects, shops }] : [];
  });
  const members = after.members.map(member => {
    const old = before.members.find(row => row.id === member.id), prior = new Map(old.tasks.map(row => [row.id, row])), next = new Map(member.tasks.map(row => [row.id, row]));
    const tasks = sorted([...prior.keys(), ...next.keys()]).flatMap(id => isDeepStrictEqual(prior.get(id), next.get(id)) ? [] : [{ id, label: (next.get(id) ?? prior.get(id)).label,
      category: (next.get(id) ?? prior.get(id)).category, before: prior.get(id) ?? null, after: next.get(id) ?? null }]);
    const listDelta = field => delta(old.tasks.filter(row => row[field]).map(row => row.id), member.tasks.filter(row => row[field]).map(row => row.id));
    const taskDelta = field => { const changes = listDelta(field); return { added: changes.added.map(id => next.get(id)), removed: changes.removed.map(id => prior.get(id)) }; };
    return { id: member.id, name: member.name, before: old.counts, after: member.counts,
      activeTasks: taskDelta('active'), presentedTasks: taskDelta('presented'), possibleTasks: taskDelta('possible'), taskChanges: tasks,
      reachability: Object.fromEntries(Object.keys(member.access).map(key => { const changes = delta(old.access[key], member.access[key]); return [key, { added: namedIds(changes.added), removed: namedIds(changes.removed) }]; })),
      partnerConnectionChanges: isDeepStrictEqual(old.partnerConnections, member.partnerConnections) ? [] : [{ before: old.partnerConnections, after: member.partnerConnections }],
      rollPool: { ...delta(old.pool.eligible.map(row => row.id), member.pool.eligible.map(row => row.id)), additions: member.pool.eligible.filter(row => !old.pool.eligible.some(value => value.id === row.id)).map(row => ({ ...row, name: names.get(row.id) ?? row.id })) },
      selectable: (() => { const change = delta(old.pool.selectable, member.pool.selectable); return { added: namedIds(change.added), removed: namedIds(change.removed) }; })(),
      transportRoutes: member.transportRoutes,
      equipmentChanged: !isDeepStrictEqual(old.equipment, member.equipment),
      equipmentChanges: Object.keys(member.equipment).flatMap(key => isDeepStrictEqual(old.equipment[key], member.equipment[key]) ? [] : [{ field: key, before: old.equipment[key], after: member.equipment[key] }]),
      itemAvailability: delta(old.items.map(row => row.name), member.items.map(row => row.name)),
      itemSourceChanges: member.items.flatMap(row => {
        const priorItem = old.items.find(value => value.name === row.name);
        return priorItem && !isDeepStrictEqual(priorItem.sources, row.sources) ? [{ name: row.name, before: priorItem.sources, after: row.sources }] : [];
      }),
      contentChanges: contents.flatMap(row => {
        const scopes = Object.keys(member.contentScope).filter(scope => member.contentScope[scope].includes(row.id));
        return scopes.length ? [{ ...row, scopes }] : [];
      }),
      performance: { before: old.performance, after: member.performance }, houseStorage: member.houseStorage,
      f2pAvailableMembersTasks: member.tasks.filter(row => row.possible && row.members === true),
      changedDiagnostics: member.diagnostics.filter(row => !old.diagnostics.some(value => isDeepStrictEqual(row, value))),
    };
  });
  return { variant: after.variant, compileMs: after.compileMs, startupMs: after.startupMs, contents, members };
}
async function runChild(dataDir, variant, runs) {
  const env = { ...process.env, RS3_ARCHAEOLOGY_CONTENTS: ['archaeology', 'all'].includes(variant) ? 'game-data' : 'retained',
    RS3_CACHE_SHOP_CONTENTS: ['shops', 'all'].includes(variant) ? '1' : '0' };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', '--data-dir', dataDir, '--variant', variant, '--runs', String(runs)], { cwd: root, env, windowsHide: true });
    const chunks = [], errors = [];
    child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.on('data', bytes => errors.push(bytes));
    child.on('error', reject); child.on('close', code => {
      if (code) reject(new Error(Buffer.concat(errors).toString() || `Comparison failed: ${variant}`));
      else { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); } }
    });
  });
}
async function main() {
  if (flags.includes('--help')) { console.log('node scripts/research/compare-switches.mjs --data-dir <COPY without store.lock/invites.json> [--runs 3] [--output .local/switches-report.json]\nNo save writes, server or network. All four switches OFF is the baseline; other settings are preserved. Report contains task/source diffs, not save contents.'); return; }
  const allowed = new Set(['--data-dir', '--runs', '--output', '--child', '--variant']);
  for (let index = 0; index < flags.length; index++) { if (!allowed.has(flags[index])) throw new Error(`Unknown option ${flags[index]}`); if (flags[index] !== '--child') index++; }
  if (!option('--data-dir')) throw new Error('An explicit copied --data-dir is required');
  const dataDir = await safeDirectory(option('--data-dir')), runs = Number(option('--runs', '3'));
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be 1..20');
  if (flags.includes('--child')) {
    const variant = option('--variant'); if (!variants.includes(variant)) throw new Error('Unknown variant');
    process.stdout.write(JSON.stringify(await childComparison(dataDir, variant, runs))); return;
  }
  const output = path.resolve(option('--output', path.join(root, '.local/switches-report.json')));
  const outputRelative = path.relative(root, output);
  if (!outputRelative || outputRelative.startsWith('..') || path.isAbsolute(outputRelative)
    || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(output)) throw new Error('Output must stay in this worktree, outside .local/duo');
  for (let cursor = path.dirname(output); cursor !== root; cursor = path.dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Output parent must not be a symlink/junction'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Output must not be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (output === dataDir || !path.relative(dataDir, output).startsWith('..')) throw new Error('Output must be outside the copied save');
  const loaded = await loadCopy(dataDir);
  const sourceFiles = ['scripts/research/compare-switches.mjs', 'app/tasks/worker.mjs', 'app/tasks/engine.mjs',
    'app/tasks/access.mjs', 'app/data/access-policy.mjs'];
  const sourceHashes = await Promise.all(sourceFiles.map(async file => ({ file, sha256: hash(await readFile(path.join(root, file))) })));
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const trackedDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'app'], { cwd: root }));
  const snapshots = [];
  for (const variant of variants) { console.error(`Comparing ${variant} (${runs} uncached calculations per member/view)`); snapshots.push(await runChild(dataDir, variant, runs)); }
  const before = snapshots[0];
  for (const snapshot of snapshots) if (snapshot.sourceSha256 !== before.sourceSha256 || snapshot.referenceSha256 !== before.referenceSha256) throw new Error('Inputs changed between variants');
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), node: process.version, runs,
    gitCommit, trackedDiffSha256, sourceHashes,
    activeDefinition: 'Unfinished, visible, presented own obligations; completed and backlogged goals excluded, no search/show-all/show-blocked display filters or custom-task fallback.',
    brotliQuality: 4,
    sourceSha256: before.sourceSha256, sourceRevision: before.sourceRevision, referenceSha256: before.referenceSha256,
    settings: { f2p: before.f2p, original: before.originalSettings, resourceContents: process.env.RS3_RESOURCE_CONTENTS === 'retained' ? 'retained' : 'game-data' },
    baseline: { compileMs: before.compileMs, startupMs: before.startupMs, members: before.members.map(row => ({ id: row.id, name: row.name,
      unlockedCount: row.unlockedCount, selectedCount: row.selectedCount, counts: row.counts, performance: row.performance })) },
    comparisons: snapshots.slice(1).map(snapshot => compare(before, snapshot)) };
  await verifyDependencies(loaded.dependencies);
  for (const row of sourceHashes) if (hash(await readFile(path.join(root, row.file))) !== row.sha256) throw new Error('Comparison source changed during evaluation');
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Comparison report written: ${output}`);
  for (const comparison of report.comparisons) for (const member of comparison.members) console.log(`${comparison.variant} / ${member.name}: active ${member.before.active} -> ${member.after.active}; possible ${member.before.possible} -> ${member.after.possible}; pool ${member.before.rollPool} -> ${member.after.rollPool}`);
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
