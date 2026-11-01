// Real durable stores, one process at a time. Output contains measurements and
// hashes only. Inputs and all gameplay copies stay in disposable directories.
import { mkdtemp, readFile, writeFile, readdir, stat, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'trial', 'pairs', 'source', 'packs', 'defaults'].map(key => [key, { type: 'string' }])) });
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const now = () => new Date('2026-10-25T12:00:00.000Z');
const world = { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
const measure = async work => { const at = performance.now(); const result = await work(); return { result, ms: performance.now() - at }; };
async function diskBytes(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? await diskBytes(file) : (await stat(file)).size;
  }
  return bytes;
}
// For even windows use the upper of the two central observations. Across the
// five independent trials this is the ordinary (unique) middle observation.
const upperMedian = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const spread = values => ({ median: upperMedian(values), min: Math.min(...values), max: Math.max(...values) });

async function synthetic(config) {
  const { openStore } = await import(pathToFileURL(path.join(config.checkout, 'app/storage/store.mjs')));
  const { createGroupState } = await import(pathToFileURL(path.join(config.checkout, 'app/core/state.mjs')));
  const initialState = createGroupState([{ id: 'player', name: 'Player' }]);
  initialState.tasks = Array.from({ length: 1000 }, (_, index) => ({ id: `custom:${index}`, label: `Task ${index}`, category: 'custom' }));
  const root = await mkdtemp('/tmp/completion-codec-trial-'), dataDir = path.join(root, 'game');
  let store = await openStore({ dataDir, initialState, world, now });
  const rows = [], pairs = [];
  let totalMs = 0;
  try {
    for (let index = 0; index < 1000; index++) {
      const elapsed = await measure(async () => {
        for (const command of [{ type: 'complete-task', memberId: 'player', taskId: `custom:${index}`, completed: true },
          { type: 'tick-active-tasks', memberId: 'player', taskIds: [`custom:${index}`] }]) {
          const reply = await store.commandSerialized(command, store.getInfo().revision, { omitUnchanged: true, view: 'play-v1' });
          void reply.stateJSON;
        }
      });
      pairs.push(elapsed.ms); totalMs += elapsed.ms;
      const count = index + 1;
      if (![100, 250, 500, 1000].includes(count)) continue;
      const state = store.getState(), stateHash = sha(state), historyHash = sha(store.getHistory());
      const bytes = await readFile(path.join(dataDir, 'state.json'));
      const row = { count, pairMs: upperMedian(pairs.slice(-10)), totalMs, stateBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 1 }).length, diskBytes: await diskBytes(dataDir), stateHash, historyHash,
        inverseReferences: state.history.reduce((sum, event) => sum + (event.undo?.memberChanges ?? []).reduce((n, member) => n + member.changes.reduce((m, patch) => m + (patch.path.length === 1 && patch.path[0] === 'completedTasks' ? patch.before.value.length + patch.after.value.length : 0), 0), 0), 0) };
      await store.close();
      const reload = await measure(() => openStore({ dataDir, world, now })); store = reload.result;
      row.reloadMs = reload.ms;
      if (sha(store.getState()) !== stateHash || sha(store.getHistory()) !== historyHash) throw Error('Reload comparison failed.');
      row.peakRSSBytes = process.resourceUsage().maxRSS * 1024;
      rows.push(row);
    }
    const undo = await measure(() => store.commandSerialized({ type: 'undo', undoRevision: 1999 }, 2000, { view: 'play-v1' }));
    void undo.result.stateJSON;
    const liveUndoHash = sha(store.getState());
    // At revision 2001 default retention cuts the archive. Compare complete
    // hydrated History, without random storage reference IDs in provenance.
    const undoHash = sha((await store.backup()).state);
    await store.close(); store = await openStore({ dataDir, world, now });
    if (sha(store.getState()) !== liveUndoHash) throw Error('Undo reload failed.');
    return { rows, undoMs: undo.ms, undoHash, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}

const PRIVATE_DISABLED = 'Private mode is disabled: it opened the normal store on a private save copy, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.';
async function privateSample(config) {
  throw Error(PRIVATE_DISABLED);
  const { openStore } = await import(pathToFileURL(path.join(config.checkout, 'app/storage/store.mjs')));
  const candidate = await import(pathToFileURL(path.join(config.checkout, 'app/core/state.mjs')));
  const reference = await import(pathToFileURL(path.join(config.baseline ?? config.checkout, 'app/core/state.mjs')));
  const { createCompletionEncoder, decodeCompletionDocument } = await import(pathToFileURL(path.join(config.checkout, 'app/storage/completion-codec.mjs')));
  const root = await mkdtemp('/tmp/completion-codec-sample-'), dataDir = path.join(root, 'game');
  await cp(config.source, dataDir, { recursive: true, preserveTimestamps: true });
  let store;
  try {
    store = await openStore({ dataDir, now });
    const backups = (await store.listBackups()).sort((a, b) => a.revision - b.revision);
    if (backups.length < 8) throw Error('Eight sample states required.');
    const rows = [];
    for (let index = 0; index < 8; index++) {
      const document = await store.readBackup(backups[Math.floor(index * (backups.length - 1) / 7)].id);
      const bytes = JSON.stringify(document);
      const encoded = await measure(() => createCompletionEncoder()(document));
      const compact = JSON.stringify(encoded.result);
      const decoded = await measure(() => decodeCompletionDocument(JSON.parse(compact)));
      const imported = await measure(() => candidate.importBackup(JSON.parse(compact)));
      const differences = sha(decoded.result) === sha(document) ? 0 : 1;
      if (differences || sha(imported.result) !== sha(document.state)) throw Error('Sample codec comparison failed.');
      const eligibility = reference.getUndoEligibility(document.state);
      if (JSON.stringify(eligibility) !== JSON.stringify(candidate.getUndoEligibility(imported.result))) throw Error('Sample Undo eligibility differed.');
      let undo;
      if (eligibility.canUndo) {
        const before = await measure(() => reference.applyCommand(document.state, { type: 'undo' }, { now }));
        const after = await measure(() => candidate.applyCommand(imported.result, { type: 'undo' }, { now }));
        if (sha(before.result) !== sha(after.result)) throw Error('Sample Undo differed.');
        undo = { beforeMs: before.ms, afterMs: after.ms, differences: 0 };
      }
      rows.push({ beforeBytes: Buffer.byteLength(bytes), afterBytes: Buffer.byteLength(compact), beforeGzipBytes: gzipSync(bytes, { level: 1 }).length,
        afterGzipBytes: gzipSync(compact, { level: 1 }).length, encodeMs: encoded.ms, decodeMs: decoded.ms,
        importMs: imported.ms, undo, differences, sha256: sha(document), peakRSSBytes: process.resourceUsage().maxRSS * 1024 });
    }
    return { samples: rows, differences: 0, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
  } finally { await store?.close(); await rm(root, { recursive: true, force: true }); }
}

async function child(config, root) {
  const input = path.join(root, 'input.json'), result = path.join(root, 'result.json');
  await writeFile(input, JSON.stringify({ ...config, result }), { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const job = spawn(process.execPath, [fileURLToPath(import.meta.url), '--trial', input], {
      stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RS3_DATASET: config.source ? 'duo-legacy' : 'open-f2p',
        RS3_COMPLETION_CODEC: config.enabled ? '1' : '0', RS3_TASK_WORKER_MODE: 'process',
        ...(config.source ? { RS3_PACKS_DIR: config.packs, RS3_GAME_DEFAULTS_FILE: config.defaults } : {}) } });
    // Keep error text private. Public output never includes input values.
    let failed = false; job.stderr.on('data', () => { failed = true; });
    job.once('error', reject); job.once('exit', code => code === 0 ? resolve() : reject(Error(`Measurement child failed (${code}; stderr=${Number(failed)}).`)));
  });
  return JSON.parse(await readFile(result, 'utf8'));
}

if (values.trial) {
  const config = JSON.parse(await readFile(values.trial, 'utf8'));
  await writeFile(config.result, JSON.stringify(await (config.source ? privateSample(config) : synthetic(config))), { mode: 0o600 });
} else {
  if (values.source) throw Error(PRIVATE_DISABLED);
  if (!values.baseline || !values.candidate || !values.out) throw Error('--baseline, --candidate and --out required.');
  const root = await mkdtemp('/tmp/completion-codec-pairs-'), trials = [];
  try {
    const count = Number(values.pairs ?? 5);
    if (!Number.isSafeInteger(count) || count < 1) throw Error('Invalid pair count.');
    for (let pair = 0; pair < count; pair++) {
      const rows = {};
      for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        rows[enabled ? 'after' : 'before'] = await child({ checkout: path.resolve(enabled ? values.candidate : values.baseline), enabled }, root);
        await writeFile(values.out, JSON.stringify({ node: process.version, trials, pending: rows }, null, 2));
        console.log(JSON.stringify({ pair: pair + 1, enabled: Number(enabled), completed: 1000 }));
      }
      for (let i = 0; i < 4; i++) for (const key of ['stateHash', 'historyHash', 'inverseReferences']) {
        if (rows.before.rows[i][key] !== rows.after.rows[i][key]) throw Error('Paired authoritative comparison failed.');
      }
      if (rows.before.undoHash !== rows.after.undoHash) throw Error('Paired Undo comparison failed.');
      trials.push(rows);
      await writeFile(values.out, JSON.stringify({ node: process.version, trials }, null, 2));
    }
    const summary = [100, 250, 500, 1000].map((count, i) => ({ count, ...Object.fromEntries(['before', 'after'].map(side => [side,
      Object.fromEntries(['pairMs', 'totalMs', 'stateBytes', 'gzipBytes', 'diskBytes', 'reloadMs', 'peakRSSBytes'].map(key => [key, spread(trials.map(trial => trial[side].rows[i][key]))]))])) }));
    let sample;
    if (values.source) {
      throw Error(PRIVATE_DISABLED);
      if (!values.packs || !values.defaults) throw Error('--packs and --defaults required.');
      sample = await child({ checkout: path.resolve(values.candidate), baseline: path.resolve(values.baseline), enabled: true, source: path.resolve(values.source), packs: path.resolve(values.packs), defaults: path.resolve(values.defaults) }, root);
    }
    await writeFile(values.out, JSON.stringify({ node: process.version, trials, summary, sample, differences: 0 }, null, 2));
    console.log(JSON.stringify({ pairs: count, checkpoints: count * 4, samples: sample?.samples.length ?? 0, differences: 0 }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
