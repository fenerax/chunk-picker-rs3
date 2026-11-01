// Focused START comparison, not a replacement for tools/calc-check.
// Run this same file with --checkout for each revision, one process at a time.
// --data-dir (copied save states) is disabled: it started the server on a private
// copy, which can copy or create credentials. Public mode is unchanged.
import { parseArgs } from 'node:util';
import { readFile, writeFile, cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: fileURLToPath(new URL('../../', import.meta.url)) },
  'membership-frontier': { type: 'boolean', default: false },
  out: { type: 'string' }, 'data-dir': { type: 'string' }, runs: { type: 'string', default: '3' },
} });
export const PRIVATE_DISABLED = 'Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.';
if (values['data-dir']) throw Error(PRIVATE_DISABLED);
const checkout = path.resolve(values.checkout), output = values.out && path.resolve(values.out);
const runs = Number(values.runs);
if (!output || !Number.isSafeInteger(runs) || runs < 1 || !path.relative(checkout, output).startsWith('..'))
  throw Error('Use --out outside the checkout and positive --runs.');
const load = file => import(pathToFileURL(path.join(checkout, file)));
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const hash = value => createHash('sha256').update(value).digest('hex');
const median = rows => [...rows].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const summarize = rows => ({ median: median(rows), min: Math.min(...rows), max: Math.max(...rows) });
let app, temporary;
try {
  const { selectedDataset: dataset } = await load('app/dataset-runtime.mjs');
  const { createGroupState, applyCommand } = await load('app/core/state.mjs');
  const { evaluateRollPool } = await load('app/core/rules.mjs');
  const started = performance.now(), states = [], publicRows = [];
  let world, sourceSha256;
  if (values['data-dir']) {
    const source = path.resolve(values['data-dir']);
    sourceSha256 = hash(await readFile(path.join(source, 'state.json')));
    temporary = await mkdtemp(path.join(tmpdir(), 'starting-bank-sample-'));
    const dataDir = path.join(temporary, 'game');
    await cp(source, dataDir, { recursive: true });
    await copyFile(source + '.dataset.json', dataDir + '.dataset.json');
    const { createServer } = await load('app/server.mjs');
    app = await createServer({ dataDir, port: 0, predictionPrewarm: false, retention: false });
    world = app.world;
    const current = app.store.getState();
    const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a, b) => a.revision - b.revision);
    if (backups.length < 7) throw Error('Not enough sample states.');
    states.push(current);
    for (let i = 0; i < 7; i++) states.push((await app.store.readBackup(backups[Math.floor(i * (backups.length - 1) / 6)].id)).state);
    if (sourceSha256 !== hash(await readFile(path.join(source, 'state.json')))) throw Error('Source changed.');
  } else {
    const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
    const { prepareServerDefinitions } = await load('app/dataset-pipeline.mjs');
    const { buildWorld } = await load('app/data/world.mjs');
    const { definitionBytes } = await loadDatasetInputs(dataset, { loadTaskMap: false });
    world = buildWorld(prepareServerDefinitions(JSON.parse(definitionBytes), dataset, { reviewedOverlays: true }), { dataset });
    const banks = await dataset.json('app/data/members-start-banks.2026-10-12.v1.json');
    if (banks.optionAF2PExtension.length !== 23) throw Error('Review the bank inventory.');
    const now = () => '2026-11-01T00:00:00.000Z';
    if (values['membership-frontier']) {
      // Every component confirmation in the changed region and its neighbors,
      // in free and members modes. Normal unsplit seeds remain; no start preference.
      const bases = new Set(['13361', ...world.neighbors.get('13361')]);
      for (const component of world.cacheWalking.components.values()) if (bases.has(component.base)) {
        for (const f2p of [true, false]) {
          const state = createGroupState([{ id: 'one', name: 'Synthetic' }]);
          state.rules['content.f2p'] = f2p;
          state.members[0].unlocked = [component.base];
          state.members[0].sectionOverrides = { [component.id]: true };
          states.push(state); publicRows.push({ chunkId: component.base, component: component.id, phase: f2p ? 'component-f2p' : 'component-members' });
        }
      }
    } else for (const [index, bank] of banks.optionAF2PExtension.entries()) {
      const initial = createGroupState([{ id: 'one', name: 'Synthetic' }]);
      initial.tasks = [{ id: 'synthetic:setup', label: 'Synthetic setup task', category: 'quest' }];
      const state = applyCommand(initial, { type: 'setup-start' }, { world, membersStartBanks: banks, now,
        random: () => (index + 0.5) / banks.optionAF2PExtension.length });
      const completed = applyCommand(state, { type: 'complete-task', memberId: 'one', taskId: 'synthetic:setup', completed: true }, { world, now });
      let rolled;
      try { rolled = applyCommand(completed, { type: 'roll', memberId: 'one', count: 1 }, { world, now, random: () => 0 }); }
      catch (error) { if (!(error instanceof RangeError) || !/Roll count must be an integer from 0 through 0/.test(error.message)) throw error; }
      // An ordinary manual unlock must not gain a start-only certificate.
      const manual = applyCommand(initial, { type: 'set-chunk', memberId: 'one', chunkId: bank.chunkId, status: 'unlocked' }, { world, now });
      for (const [phase, snapshot] of [['setup', state], ['completed', completed], ['manual', manual]]) {
        states.push(snapshot); publicRows.push({ chunkId: bank.chunkId, phase });
      }
      publicRows[publicRows.length - 3].rollAccepted = !!rolled;
    }
  }
  const durations = [], trials = [];
  for (let run = 0; run < runs; run++) {
    const began = performance.now(), rows = [];
    for (const state of states) for (const member of state.members) {
      const pool = evaluateRollPool(world, state, member.id);
      rows.push({ hash: hash(canonical(pool)), eligible: pool.eligible.length, excluded: pool.excluded.length });
    }
    trials.push(rows); durations.push(performance.now() - began);
  }
  const first = canonical(trials[0]);
  if (trials.some(rows => canonical(rows) !== first)) throw Error('Unstable comparison.');
  const report = { datasetSha256: dataset.digest, sourceSha256, stateCount: states.length, poolCount: trials[0].length,
    runs, rows: trials[0], ...(publicRows.length ? { publicRows } : {}), digest: hash(first),
    durationMs: summarize(durations), totalMs: performance.now() - started, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ stateCount: report.stateCount, poolCount: report.poolCount, runs, digest: report.digest,
    durationMs: report.durationMs, totalMs: report.totalMs, peakRSSBytes: report.peakRSSBytes }));
} catch {
  console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1;
} finally { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
