// Compare START/candidate through the public comparison evaluator on eight states.
// Current save plus seven evenly spaced retained revisions; one child at a time.
// Only counts, hashes, sizes and timings leave scratch directories.
// --baseline DIR --candidate DIR --source COPIED_SAVE --packs DIR --defaults FILE --out FILE
import { parseArgs } from 'node:util';
import { mkdtemp, cp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'source', 'packs', 'defaults', 'out', 'internal'].map(key => [key, { type: 'string' }])) });
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(name => [name, child[name]])) : child);
async function trial(config) {
  const load = file => import(pathToFileURL(path.join(config.checkout, file)));
  const { createServer } = await load('app/server.mjs');
  const { createComparisonEvaluator, observeTaskViews } = await load('scripts/compare-cache-access.mjs');
  const { evaluateRollPool } = await load('app/core/rules.mjs');
  const { createTaskEngine } = await load('app/tasks/engine.mjs');
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const app = await createServer({ dataDir: config.store, port: 0, predictionPrewarm: false, retention: false,
    now: () => Date.parse('2026-11-01T00:00:00.000Z'),
    originalSync: { fetchImpl: async () => { throw Error('Offline comparison.'); } }, runeMetrics: { fetchImpl: async () => { throw Error('Offline comparison.'); } } });
  let states, world;
  try {
    const current = app.store.getState(); world = app.world;
    const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a, b) => a.revision - b.revision);
    if (backups.length < 7) throw Error('Insufficient retained states.');
    states = [current];
    for (let i = 0; i < 7; i++) states.push((await app.store.readBackup(backups[Math.floor(i * (backups.length - 1) / 6)].id)).state);
  } finally { await app.close(); }
  const evaluate = createComparisonEvaluator(world.definitions, undefined, { reviewedOverlays: true });
  const engine = createTaskEngine(world.definitions, { dataset: selectedDataset, reviewedOverlays: true });
  const rows = [];
  for (const state of states) {
    const inputHash = sha(canonical(state));
    for (const member of state.members) {
      const start = process.hrtime.bigint();
      const result = evaluate(state, member.id), pool = evaluateRollPool(world, state, member.id);
      const gameplay = canonical({ result, pool, views: [observeTaskViews(state, member.id, result), observeTaskViews(state, member.id, result, { showAll: true })] });
      const goal = result.tasks.filter(task => task.status === 'available' && !task.personalCompleted && task.record).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!goal) throw Error('No proof sample.');
      const proofStart = process.hrtime.bigint(), proof = engine.how(state, member.id, goal.id);
      const proofMs = Number(process.hrtime.bigint() - proofStart) / 1e6;
      const rawProof = canonical(proof);
      // The only permitted proof change is the historical source-access gap.
      for (const node of Object.values(proof.nodes)) if (node.gap === 'historical-source-access') {
        node.gap = 'partner-duo'; node.label = 'This supply uses partner access.';
      }
      for (const gap of proof.gaps) if (gap.kind === 'historical-source-access') {
        gap.kind = 'partner-duo'; gap.detail = 'This supply uses partner access.';
      }
      rows.push({ inputHash, gameplayHash: sha(gameplay), gameplayBytes: Buffer.byteLength(gameplay), taskCount: result.tasks.length,
        proofHash: sha(rawProof), permittedProofHash: sha(canonical(proof)), proofBytes: Buffer.byteLength(rawProof), proofMs,
        elapsedMs: Number(process.hrtime.bigint() - start) / 1e6 });
    }
    if (sha(canonical(state)) !== inputHash) throw Error('Input mutation.');
  }
  // This is main-process RSS, not a simultaneous process-tree measurement.
  return { states: states.length, rows, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
}
async function main() {
  if (values.internal) {
    const config = JSON.parse(await readFile(values.internal, 'utf8'));
    await writeFile(config.result, JSON.stringify(await trial(config)), { mode: 0o600 }); return;
  }
  for (const key of ['baseline', 'candidate', 'source', 'packs', 'defaults', 'out']) if (!values[key]) throw Error('Missing argument.');
  const root = await mkdtemp(path.join(tmpdir(), 'how-paths-equivalence-')), results = [];
  const sourceHash = sha(await readFile(path.join(values.source, 'state.json')));
  try {
    for (const checkout of [values.baseline, values.candidate]) {
      const run = await mkdtemp(path.join(root, 'run-')), store = path.join(run, 'game');
      await cp(values.source, store, { recursive: true }); await copyFile(values.source + '.dataset.json', store + '.dataset.json');
      const config = { checkout: path.resolve(checkout), store, result: path.join(run, 'result.json') }, input = path.join(run, 'input.json');
      await writeFile(input, JSON.stringify(config), { mode: 0o600 });
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./duo-compatibility-clock.mjs', import.meta.url)), fileURLToPath(import.meta.url), '--internal', input], {
          stdio: 'ignore', env: { ...process.env, RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: path.resolve(values.packs), RS3_GAME_DEFAULTS_FILE: path.resolve(values.defaults), RS3_TASK_WORKER_MODE: 'process' } });
        child.once('error', () => reject(Error('Comparison child failed.')));
        child.once('exit', code => code === 0 ? resolve() : reject(Error('Comparison child failed.')));
      });
      results.push(JSON.parse(await readFile(config.result, 'utf8')));
    }
    const [before, after] = results;
    const difference = key => before.rows.filter((row, i) => row[key] !== after.rows[i]?.[key]).length;
    const stats = (rows, key) => { const sorted = rows.map(row => row[key]).sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
    const report = { sourceHash, states: before.states, evaluations: before.rows.length, inputDifferences: difference('inputHash'), gameplayDifferences: difference('gameplayHash'),
      proofDifferences: difference('proofHash'), unexpectedProofDifferences: difference('permittedProofHash'),
      before: { elapsedMs: stats(before.rows, 'elapsedMs'), proofMs: stats(before.rows, 'proofMs'), peakRSSBytes: before.peakRSSBytes },
      after: { elapsedMs: stats(after.rows, 'elapsedMs'), proofMs: stats(after.rows, 'proofMs'), peakRSSBytes: after.peakRSSBytes } };
    if (sha(await readFile(path.join(values.source, 'state.json'))) !== sourceHash) throw Error('Source mutation.');
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.inputDifferences || report.gameplayDifferences || report.unexpectedProofDifferences || after.states !== 8 || after.rows.length !== before.rows.length) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(() => { console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1; });
