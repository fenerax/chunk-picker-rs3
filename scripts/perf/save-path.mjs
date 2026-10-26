// Synthetic-only save-path profiler. Run with Node 24 and a 3 GiB heap.
// node scripts/perf/save-path.mjs --companion <scale-dataset output> --out <report.json>
// --baseline <checkout> enables alternating paired runs (default: 7 pairs).
// --summarize <report.json> verifies outputs and adds medians/min/max.
// Each child owns a fresh temporary save; only scale-dataset synthetic packs
// are accepted. No live save or external service is used.
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const option = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const root = path.resolve(option('root', fileURLToPath(new URL('../../', import.meta.url))));
const companion = path.resolve(option('companion', '.local/perf/task-l/scale400'));
const out = path.resolve(option('out', '.local/perf/task-l/save-path.json'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  const middle = (n - 1) / 2;
  return { n, median: (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2, min: sorted[0], max: sorted.at(-1) };
};
function summarize(runs) {
  for (const key of ['responseHash', 'stateHash', 'fullSaveBytes', 'compactBytes']) {
    if (new Set(runs.map(run => run[key])).size !== 1) throw new Error(`Outputs differ: ${key}`);
  }
  const scenarios = {};
  for (const name of ['note-save', 'save-burst']) {
    const variants = {};
    for (const variant of [...new Set(runs.map(run => run.variant))]) {
      const rows = runs.filter(run => run.variant === variant).map(run => run.rows.find(row => row.name === name));
      variants[variant] = Object.fromEntries(['savedMs', 'durableMs', 'maxRssMiB'].map(key => [key, stats(rows.map(row => row[key]))]));
      variants[variant].stages = Object.fromEntries(Object.keys(rows[0].timings).map(key => [key, stats(rows.map(row => row.timings[key].ms))]));
    }
    const pairs = runs.filter(run => run.variant === 'before').flatMap(before => {
      const after = runs.find(run => run.pair === before.pair && run.variant === 'after');
      if (!after) return [];
      const a = before.rows.find(row => row.name === name).savedMs, b = after.rows.find(row => row.name === name).savedMs;
      return [{ deltaMs: b - a, changePercent: (b / a - 1) * 100 }];
    });
    scenarios[name] = { variants, ...(pairs.length ? { pairedDeltaMs: stats(pairs.map(pair => pair.deltaMs)), pairedChangePercent: stats(pairs.map(pair => pair.changePercent)) } : {}) };
  }
  return { outputsIdentical: true, scenarios };
}
if (option('summarize')) {
  const filename = path.resolve(option('summarize'));
  const report = JSON.parse(await readFile(filename, 'utf8'));
  report.summary = summarize(report.runs);
  await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
} else if (process.argv.includes('--child')) {
  const receipt = JSON.parse(await readFile(path.join(companion, 'companion.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(path.join(companion, 'packs', receipt.packs.data.id, receipt.packs.data.version, 'provenance.json'), 'utf8'));
  if (provenance.synthetic !== true || provenance.generator !== 'scripts/perf/scale-dataset.mjs') throw new Error('Use scale-dataset synthetic packs only.');
  Object.assign(process.env, { RS3_TASK_WORKER_MODE: 'process', RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(companion, receipt.profile.path),
    RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(companion, 'packs'), RS3_PACK_SELECTION: path.join(companion, 'selection.json') });
  let active = false, timings = {};
  globalThis.__saveProbe = (name, fn, args) => {
    if (!active) return fn(...args);
    const start = performance.now();
    const done = () => { const row = timings[name] ??= { ms: 0, calls: 0 }; row.ms += performance.now() - start; row.calls++; };
    try { const result = fn(...args); if (result?.then) return result.finally(done); done(); return result; } catch (error) { done(); throw error; }
  };
  const targets = {
    '/storage/store.mjs': ['atomicWrite', 'prepared', 'retainBackup', 'serializedDiskState', 'compactHistory', 'playProjection', 'rollPools', 'commandSnapshot', 'capturedCalculation'],
    '/core/state.mjs': ['applyValidatedCommand'],
    '/server.mjs': ['bodyJSON', 'commandJSON'],
  };
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    const names = Object.entries(targets).find(([suffix]) => url === pathToFileURL(path.join(root, 'app', suffix.slice(1))).href)?.[1];
    if (!names) return result;
    let source = String(result.source);
    for (const name of names) {
      const pattern = new RegExp(`(async )?function ${name}\\(`);
      if (!pattern.test(source)) throw new Error(`Missing probe ${name}`);
      source = source.replace(pattern, (_match, asyncKeyword = '') => `function ${name}(...args) { return globalThis.__saveProbe('${name}', __probe_${name}, args); }\n${asyncKeyword}function __probe_${name}(`);
    }
    if (url.endsWith('/storage/store.mjs')) {
      for (const [name, expression] of Object.entries({ tempWrite: 'handle.writeFile(contents)', fsync: 'handle.sync()', rename: 'rename(temporary, file)' })) {
        source = source.replace('await ' + expression, `await globalThis.__saveProbe('${name}', () => ${expression}, [])`);
      }
      source = source.replace('listener({ revision: current.revision,', `globalThis.__saveProbe('broadcast', listener, [{ revision: current.revision,`)
        .replace('...(noteEdit ? { noteEdit: true } : {}) }); } catch', '...(noteEdit ? { noteEdit: true } : {}) }]); } catch');
    }
    return { ...result, source };
  } });
  const load = file => import(pathToFileURL(path.join(root, file)));
  const { createGroupState } = await load('app/core/state.mjs');
  const { createServer } = await load('app/server.mjs');
  const initialState = createGroupState([{ id: 'explorer-1', name: 'Explorer 1' }, { id: 'explorer-2', name: 'Explorer 2' }]);
  const scratch = await mkdtemp(path.join(path.dirname(out), 'save-path-'));
  let app;
  try {
    app = await createServer({ dataDir: scratch, initialState, port: 0, host: '127.0.0.1', predictionPrewarm: false,
      now: () => '2026-01-01T00:00:00.000Z' });
    await app.listen();
    const url = new URL(app.inviteUrl), token = url.pathname.slice('/join/'.length);
    const request = async (route, body) => {
      const response = await fetch(url.origin + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`,
        ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
    };
    const { createSaveStatus } = await load('app/web/screen-save-status.mjs');
    const badge = { dataset: {} }; let pending = false;
    const saved = createSaveStatus({ canWrite: () => true, hasPendingCommand: () => pending, $: () => badge });
    const chunks = [...app.world.chunks.keys()].filter(id => !app.world.surface || app.world.surface.has(id)).sort();
    if (chunks.length < 2) throw new Error('Fixture needs two surface chunks');
    for (const memberId of ['explorer-1', 'explorer-2']) await app.store.command({ type: 'set-chunk', memberId, chunkId: chunks[0], status: 'unlocked' }, app.store.getInfo().revision);
    const session = await request('/api/action-session', { clientId: '00000000-0000-4000-8000-000000000001' });
    let sequence = 0, durableAt, start;
    const unsubscribe = app.store.subscribe(() => { durableAt = performance.now() - start; });
    const responses = [], rows = [];
    const baseline = await request('/api/state?view=play-v1');
    const { mergeCommandState } = await load('app/web/command-state.mjs'); let state = baseline.state;
    async function edit(memberId, chunkId, note) {
      pending = true; saved('Saving…');
      const response = await request('/api/command?view=play-v1', { requestId: `v3.${session.scope}.${session.slot}.${session.generation}.${sequence + 1}`, requestAck: sequence, expectedRevision: app.store.getInfo().revision,
        command: { type: 'set-note', memberId, chunkId, note } });
      state = mergeCommandState(state, response); if (!state) throw new Error('State merge failed');
      pending = false; saved('Saved', false, response.state.revision, { confirmed: true });
      if (badge.textContent !== 'Saved') throw new Error('Save status not confirmed');
      const comparable = structuredClone(response); if (comparable.receipt) comparable.receipt.requestId = 'synthetic-request'; responses.push({ response: comparable, state }); sequence++;
    }
    for (const [name, count] of [['note-save', 1], ['save-burst', 4]]) {
      timings = {}; start = performance.now(); active = true;
      for (let i = 0; i < count; i++) await edit(`explorer-${i % 2 + 1}`, chunks[i % 2], `Synthetic edit ${sequence}`);
      const savedMs = performance.now() - start; active = false;
      rows.push({ name, savedMs, durableMs: durableAt, timings, maxRssMiB: process.resourceUsage().maxRSS / 1024 });
    }
    unsubscribe();
    const full = await app.store.backup();
    console.log('SAVE_PATH_RESULT ' + JSON.stringify({ node: process.version, fixture: provenance, rows, responseHash: sha(responses), stateHash: sha(full),
      fullSaveBytes: Buffer.byteLength(JSON.stringify(full)), compactBytes: (await readFile(path.join(scratch, 'state.json'))).length,
      actionSession: Boolean(session), notes: ['Inclusive nested stage times; do not sum.', 'Local HTTP plus actual status reducer; excludes phone network, DOM rendering and task-list refresh.', 'Process high-water RSS includes startup; calculator RSS excluded.'] }));
  } finally { if (app) await app.close(); await rm(scratch, { recursive: true, force: true }); }
} else {
  await mkdir(path.dirname(out), { recursive: true });
  const baseline = option('baseline'); const pairs = Number(option('pairs', baseline ? '7' : '1')); const runs = [];
  for (let pair = 0; pair < pairs; pair++) {
    const order = baseline ? (pair % 2 ? [['after', root], ['before', path.resolve(baseline)]] : [['before', path.resolve(baseline)], ['after', root]]) : [['before', root]];
    for (const [variant, source] of order) {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--max-old-space-size=3072', fileURLToPath(import.meta.url), '--child', '--root', source, '--companion', companion, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
        child.on('error', reject); child.on('exit', code => { const line = stdout.split('\n').find(line => line.startsWith('SAVE_PATH_RESULT '));
          if (code || !line) reject(new Error(`Child ${code}: ${stderr}\n${stdout.slice(-2000)}`)); else resolve(JSON.parse(line.slice(17))); });
      });
      runs.push({ pair, variant, ...result }); console.log(JSON.stringify({ pair, variant, rows: result.rows }));
      await writeFile(out, JSON.stringify({ runs }, null, 2) + '\n');
    }
  }
  await writeFile(out, JSON.stringify({ format: 'synthetic-save-path-v1', runs, summary: summarize(runs) }, null, 2) + '\n');
}
