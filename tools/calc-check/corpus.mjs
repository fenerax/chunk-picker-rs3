import { readFile, readdir, mkdtemp, rm, realpath, cp, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hash } from './compare.mjs';
import { manifestFor } from './shards.mjs';
import { saveSnapshots } from './save-snapshots.mjs';
import { packValue, unpackValue } from './values.mjs';
import { rebuildHistoryRevisions } from './history.mjs';
import { gunzipSync } from 'node:zlib';
import { completeFixtureState } from './fixture-state.mjs';
import { captureTests, fixturePreparers } from './fixture-tools.mjs';

export function randomFor(seed) {
  let x = seed >>> 0;
  return () => { x += 0x6D2B79F5; let t = Math.imul(x ^ x >>> 15, 1 | x); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function sample(values, cap, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, cap);
}
export async function buildCorpus(spec, seed) {
  const cleanups = [];
  try { return await assemble(spec, seed, cleanups); }
  catch (error) { for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {}); throw error; }
}
async function assemble(spec, seed, cleanups) {
  const [{ selectedDataset: dataset }, { loadDatasetInputs }, pipeline, { buildWorld }, rules, stateModule, death, { openStore }, binding] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'), import('../../app/data/world.mjs'),
    import('../../app/core/rules.mjs'), import('../../app/core/state.mjs'), import('../../app/core/death-settings.mjs'), import('../../app/storage/store.mjs'), import('../../app/dataset-binding.mjs'),
  ]);
  const registry = rules.createRuleRegistry(), random = randomFor(seed), groups = [];
  const coverage = { saveRevisions: 0, historyRevisions: 0, uncoveredHistoryRevisions: 0, fixtureTestFiles: 0, fixtureCaptures: 0 };
  const limits = spec.limits ?? {};
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = () => '2026-01-01T00:00:00.000Z';
  function bundleFor(definitions, reviewed = false) {
    definitions = pipeline.prepareServerDefinitions(definitions, dataset, { reviewedOverlays: reviewed });
    const options = { reviewedOverlays: reviewed, ...(!reviewed ? { cacheWalking: false } : {}) };
    const world = buildWorld(definitions, { dataset, ...options });
    return { bundle: { definitions, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions: options,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), omitReadyCatalogue: true, world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [] }, world };
  }
  let selected;
  async function selectedInput() {
    if (!selected) {
      const input = await loadDatasetInputs(dataset, { loadTaskMap: false });
      selected = bundleFor(JSON.parse(input.definitionBytes), true);
    }
    return selected;
  }
  function addGroup(input, states, source) {
    if (!states.length) return;
    groups.push({ ...input, states: states.map(state => ({ state, source, revision: state.revision, digest: hash(JSON.stringify(state)) })) });
  }
  if (spec.generated) {
    const input = spec.generated.definitionsFile ? bundleFor(JSON.parse(await readFile(spec.generated.definitionsFile, 'utf8'))) : await selectedInput();
    const states = [], steps = spec.generated.steps ?? 8;
    const ids = [...input.world.surface].filter(id => input.world.chunks.has(id)).sort();
    if (!ids.length) throw new TypeError('invalid');
    for (const memberCount of [1, 2]) {
      let state = stateModule.createGroupState(Array.from({ length: memberCount }, (_, i) => ({ id: `generated${i}`, name: `Player ${i + 1}`, unlocked: [ids[Math.floor(random() * ids.length)]] })), registry);
      const { permanentTaskId } = await import('../../app/tasks/identity.mjs');
      state.tasks = Object.entries(input.bundle.definitions.challenges ?? {}).flatMap(([category, entries]) => Object.entries(entries).map(([label, record]) => ({ id: permanentTaskId(category, label, record), label, category })));
      states.push(structuredClone(state));
      for (const member of state.members) {
        const choices = ids.filter(id => !member.unlocked.includes(id));
        if (choices.length) {
          state = stateModule.applyCommand(state, { type: 'set-chunk', memberId: member.id, chunkId: choices[Math.floor(random() * choices.length)], status: 'selected' }, { world: input.world, registry, now, random });
          states.push(structuredClone(state));
        }
      }
      for (const rule of registry.definitions) {
        const values = rule.type === 'boolean' ? [false, true] : rule.type === 'enum' ? rule.options : [rule.default];
        for (const value of values) {
          state = stateModule.applyCommand(state, { type: 'set-rule', ruleId: rule.id, value }, { world: input.world, registry, now, random });
          states.push(structuredClone(state));
        }
      }
      for (let step = 0; step < steps; step++) {
        const member = state.members[Math.floor(random() * memberCount)];
        const available = ids.filter(id => !member.unlocked.includes(id));
        if (available.length) {
          // Direct unlocks model accepted offers without random-roll pool bias.
          state = stateModule.applyCommand(state, { type: 'set-chunk', memberId: member.id, chunkId: available[Math.floor(random() * available.length)], status: 'unlocked' }, { world: input.world, registry, now, random });
          states.push(structuredClone(state));
        }
        const task = state.tasks.length ? state.tasks[Math.floor(random() * state.tasks.length)] : null;
        if (task) {
          state = stateModule.applyCommand(state, { type: 'complete-task', memberId: member.id, taskId: task.id, completed: true }, { registry, world: input.world, now, random });
          states.push(structuredClone(state));
        }
      }
      for (const definition of death.deathSettingDefinitions) {
        if (!['boolean', 'number'].includes(definition.type)) continue;
        const value = definition.type === 'boolean' ? !definition.default : Math.min(definition.max, Math.max(definition.min + 1, Number(definition.default ?? 1) * 1.1));
        state = { ...state, revision: state.revision + 1, members: state.members.map((m, i) => i ? m : { ...m, preferences: { ...m.preferences, [definition.id]: value } }) };
        states.push(structuredClone(state));
      }
    }
    // Caps sample the full generated set after exercising every generator path.
    addGroup(input, sample(states, limits.generated ?? Infinity, random), 'generated');
  }
  if (spec.fixtures) {
    const directory = path.join(root, 'tests', 'fixtures');
    async function scan(base) {
      const result = [];
      for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(base, entry.name);
        if (entry.isDirectory()) result.push(...await scan(file));
        else if (entry.name.endsWith('.json')) {
          const value = JSON.parse(await readFile(file, 'utf8'));
          if (value?.schemaVersion === 1 && value?.members && value?.tasks && value?.history) result.push({ state: value, directory: base });
        }
      }
      return result;
    }
    const documents = await scan(directory);
    for (const entry of documents.slice(0, limits.fixtures ?? Infinity)) {
      let definitions;
      try { definitions = JSON.parse(await readFile(path.join(entry.directory, 'definitions.json'), 'utf8')); }
      catch { definitions = (await selectedInput()).bundle.definitions; }
      const state = completeFixtureState(entry.state);
      addGroup(bundleFor(definitions), [state], 'fixtures');
    }
    if (spec.fixtures.capture !== false && documents.length < (limits.fixtures ?? Infinity)) {
      const reused = Boolean(spec.fixtures.captureDir);
      const captureDir = reused ? await realpath(spec.fixtures.captureDir) : await mkdtemp(path.join(tmpdir(), 'calc-check-fixtures-'));
      try {
        const files = spec.fixtures.tests ?? await coreTestFiles(root);
        coverage.fixtureTestFiles = files.length;
        if (!reused) coverage.fixtureTests = await captureTests(root, files, captureDir);
        const preparers = fixturePreparers();
        cleanups.push(() => preparers.close());
        let remaining = (limits.fixtures ?? Infinity) - documents.length;
        const definitions = new Map();
        for (const name of (await readdir(captureDir)).filter(name => name.endsWith('.entry')).sort()) {
          coverage.fixtureCaptures++;
          if (remaining-- <= 0) continue;
          const entry = JSON.parse(await readFile(path.join(captureDir, name), 'utf8'));
          if (![entry.definitionHash, entry.stateHash, entry.key].every(value => /^[a-f0-9]{64}$/.test(value)) || name !== `${entry.key}.entry`) throw new TypeError('invalid');
          if (entry.revision === undefined) entry.revision = JSON.parse(gunzipSync(await readFile(path.join(captureDir, `${entry.key}.state.gz`)))).revision;
          let input = definitions.get(entry.definitionHash);
          if (!input) {
            const bytes = gunzipSync(await readFile(path.join(captureDir, `defs-${entry.definitionHash}.json.gz`)));
            if (hash(bytes) !== entry.definitionHash) throw new TypeError('invalid');
            const capture = JSON.parse(bytes);
            capture.definitions = { walkableChunks: [], walkableChunksF2P: [], ...capture.definitions };
            input = await preparers.prepare(capture);
            definitions.set(entry.definitionHash, input);
          }
          const raw = gunzipSync(await readFile(path.join(captureDir, `${entry.key}.state.gz`)));
          if (hash(raw) !== entry.stateHash) throw new TypeError('invalid');
          const normalized = completeFixtureState(JSON.parse(raw), input.catalogue);
          groups.push({ ...input, states: [{ source: 'fixtures', revision: normalized.revision, digest: hash(JSON.stringify(normalized)),
            load: async () => { const bytes = gunzipSync(await readFile(path.join(captureDir, `${entry.key}.state.gz`))); if (hash(bytes) !== entry.stateHash) throw new TypeError('invalid'); return completeFixtureState(JSON.parse(bytes), input.catalogue); } }] });
        }
        await preparers.close();
        if (!reused) cleanups.push(() => rm(captureDir, { recursive: true, force: true }));
      } catch (error) { if (!reused) await rm(captureDir, { recursive: true, force: true }); throw error; }

    }
  }
  if (spec.save) {
    const source = await realpath(spec.save.dataDir);
    const checked = await binding.verifyDatasetBinding(source, dataset);
    if (!checked.bound) throw new TypeError('invalid');
    const temporary = await mkdtemp(path.join(tmpdir(), 'calc-check-save-'));
    cleanups.push(() => rm(temporary, { recursive: true, force: true }));
    const dataDir = path.join(temporary, 'game');
    await mkdir(dataDir);
    // Gameplay-only copy: authentication and operator files are never needed.
    for (const name of ['state.json', 'static', 'history', 'backups']) {
      try { await cp(path.join(source, name), path.join(dataDir, name), { recursive: true, errorOnExist: true, dereference: true, preserveTimestamps: true }); }
      catch (error) { if (error.code !== 'ENOENT' || name === 'state.json') throw error; }
    }
    await copyFile(binding.bindingPath(source), binding.bindingPath(dataDir));
    const input = await selectedInput();
    // Opening only the verified copy permits storage's normal startup files;
    // retention is disabled so retained revisions cannot be pruned.
    const store = await openStore({ dataDir, world: input.world, registry, retention: false });
    cleanups.push(() => store.close());
    try {
      const current = (await store.backup()).state;
      const historyRevisions = new Set(current.history.map(event => event.revision));
      const snapshots = await saveSnapshots(dataDir, registry);
      const backups = await snapshots.listBackups();
      const byRevision = new Map(backups.map(backup => [backup.revision, { identity: hash(JSON.stringify([snapshots.identity, backup.id])), load: () => snapshots.readBackup(backup) }]));
      byRevision.set(current.revision, { identity: hash(JSON.stringify([snapshots.identity, 'current'])), load: async () => current });
      coverage.rebuiltHistoryRevisions = await rebuildHistoryRevisions(current, byRevision, { world: input.world, registry });
      coverage.saveRevisions = byRevision.size;
      coverage.historyRevisions = historyRevisions.size;
      coverage.uncoveredHistoryRevisions = [...historyRevisions].filter(revision => !byRevision.has(revision)).length;
      const cap = limits.save ?? Infinity;
      const earlier = [...byRevision].filter(([revision]) => revision !== current.revision).sort((a,b) => a[0]-b[0]);
      const ordered = cap > 0 ? [...sample(earlier, Math.max(0, cap - 1), random), [current.revision, byRevision.get(current.revision)]].sort((a,b) => a[0]-b[0]) : [];
      const entries = [];
      const loaded = new Map();
      for (const [revision, original] of ordered) {
        let packed;
        const entry = { source: 'save', revision, identity: original.identity ?? hash(JSON.stringify([snapshots.identity, revision])), async load() {
          if (loaded.has(revision)) { const state = loaded.get(revision); loaded.delete(revision); loaded.set(revision, state); return state; }
          const state = packed ? unpackValue(packed) : await original.load();
          if (!packed) { entry.digest = hash(JSON.stringify(state)); packed = packValue(state); }
          loaded.set(revision, state);
          while (loaded.size > 2) loaded.delete(loaded.keys().next().value);
          return state;
        } };
        entries.push(entry);
      }
      groups.push({ ...input, states: entries });
    } catch (error) { await store.close(); throw error; }
  }

  if (!groups.length) throw new TypeError('invalid');
  const merged = new Map();
  for (const group of groups) {
    const key = hash(JSON.stringify(group.bundle, (_, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
    if (merged.has(key)) merged.get(key).states.push(...group.states); else merged.set(key, group);
  }
  groups.splice(0, groups.length, ...merged.values());
  for (const group of groups) group.states.sort((a,b) => (a.revision ?? 0) - (b.revision ?? 0));
  const manifest = manifestFor(groups);
  return { groups, registry, dataset, coverage, manifest, close: async () => { for (const cleanup of [...cleanups].reverse()) await cleanup(); }, manifestHash: hash(JSON.stringify(manifest)) };
}
export async function coreTestFiles(root) {
  const files = [];
  for (const name of (await readdir(path.join(root, 'tests'))).sort()) {
    if (!name.endsWith('.test.mjs')) continue;
    const source = await readFile(path.join(root, 'tests', name), 'utf8');
    if (!/from ['"]\.\.\/app\/(?:core\/|tasks\/engine|sandbox)/.test(source)) continue;
    if (/node:(?:worker_threads|child_process|net)|createServer|app\/server|new Worker|fixtureServer|server-dataset/.test(source)) continue;
    files.push(name);
  }
  return files;
}
