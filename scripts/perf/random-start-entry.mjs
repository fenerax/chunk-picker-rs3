// Public-only before/after audit of actual random-start outcomes. No server,
// save, private pack, or substituted production candidate pool is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cpus, totalmem } from 'node:os';

const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || major === 24 && minor >= 20, 'Node 24.20+ required');
if (Object.keys(process.env).some(key => key.startsWith('RS3_'))) throw Error('Unset RS3 overrides for this public-only audit.');
const { values } = parseArgs({ options: { checkout: { type: 'string' }, baseline: { type: 'string' }, comparison: { type: 'string' } } });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function probe(checkout) {
  const begin = performance.now(), load = file => import(pathToFileURL(join(resolve(checkout), file)));
  const { selectedDataset: dataset } = await load('app/dataset-runtime.mjs');
  assert.equal(dataset.packed, false);
  assert.equal(dataset.files.filter(row => row.path.startsWith('local-')).length, 0);
  const [{ loadDatasetInputs }, { prepareServerDefinitions }, { buildWorld }, { createGroupState, applyCommand },
    { evaluateRollPool, reachableSections }] = await Promise.all(['app/dataset-bootstrap.mjs', 'app/dataset-pipeline.mjs',
    'app/data/world.mjs', 'app/core/state.mjs', 'app/core/rules.mjs'].map(load));
  const { definitionBytes } = await loadDatasetInputs(dataset, { loadTaskMap: false });
  const world = buildWorld(prepareServerDefinitions(JSON.parse(definitionBytes), dataset, { reviewedOverlays: true }), { dataset });
  const banks = await dataset.json('app/data/members-start-banks.2026-10-12.v1.json');
  const loadMs = performance.now() - begin, casesBegin = performance.now();
  const empty = f2p => { const state = createGroupState([{ id: 'probe', name: 'Public synthetic probe' }]); state.rules = { 'content.f2p': f2p }; return state; };
  const now = () => '2026-11-01T00:00:00.000Z';
  const command = (state, payload, random = () => 0) => applyCommand(state, payload, { world, random, now, membersStartBanks: banks });
  const start = { type: 'random-start', memberId: 'probe', count: 1 };
  const snapshot = state => ({ overrides: state.members[0].sectionOverrides ?? {},
    reached: reachableSections(world, state, 'probe'), pool: evaluateRollPool(world, state, 'probe') });
  function enumerate(f2p) {
    const initial = empty(f2p), states = new Map(), draws = new Map();
    // Admission can only shrink this pre-entry upper bound. A grid at least as
    // fine as the actual RNG intervals visits every production outcome.
    const upper = [...world.surface].filter(id => world.chunks.has(id) && world.walkable.has(id)
      && !world.cacheWalking.blockedRegions.has(id) && (!f2p || world.f2p.has(id))).length;
    for (let i = 0; i < upper; i++) {
      const draw = (i + 0.5) / upper, state = command(initial, start, () => draw), id = state.members[0].unlocked[0];
      states.set(id, state); draws.set(id, draw);
    }
    return { upper, states, draws };
  }
  const members = enumerate(false), free = enumerate(true), rows = [], targets = [];
  for (const [id, state] of [...members.states].sort(([a], [b]) => a.localeCompare(b))) {
    const result = snapshot(state);
    rows.push({ id, sha256: hash(result), reached: result.reached.length, eligible: result.pool.eligible.length });
    if (['9515', '9771', '13353'].includes(id)) {
      let calls = 0;
      const offer = command(empty(false), { ...start, count: 2 }, () => calls++ ? 0 : members.draws.get(id));
      assert.ok(offer.members[0].pendingRoll.includes(id));
      const chosen = command(offer, { type: 'unlock-selection', memberId: 'probe', chunkId: id });
      assert.deepEqual(snapshot(chosen), result);
      let nextRoll = true;
      try { command(state, { type: 'roll', memberId: 'probe', count: 1 }); }
      catch { nextRoll = false; }
      targets.push({ id, reached: result.reached.length, eligible: result.pool.eligible.length, nextRoll });
    }
  }
  const bankRows = banks.optionAF2PExtension.map((bank, ordinal, all) => {
    const state = command(empty(true), { type: 'setup-start' }, () => (ordinal + 0.5) / all.length);
    assert.deepEqual(state.members[0].unlocked, [bank.chunkId]);
    const result = snapshot(state);
    return { id: bank.chunkId, eligible: result.pool.eligible.length, sha256: hash(result) };
  });
  return { loadMs, casesMs: performance.now() - casesBegin, peakRssKiB: process.resourceUsage().maxRSS,
    members: { count: members.states.size, sha256: hash([...members.states.keys()].sort()) },
    f2p: { count: free.states.size, sha256: hash([...free.states.keys()].sort()) },
    banks: { count: bankRows.length, empty: bankRows.filter(row => row.eligible === 0).length, sha256: hash(bankRows) },
    rows, targets };
}

if (values.checkout) console.log(JSON.stringify(await probe(values.checkout)));
else {
  if (!values.baseline || !values.comparison) throw Error('Use --checkout PATH or --baseline PATH --comparison PATH.');
  const samples = [], reports = {}, script = fileURLToPath(import.meta.url);
  for (let pair = 0; pair < 5; pair++) for (const mode of pair % 2 ? ['comparison', 'baseline'] : ['baseline', 'comparison']) {
    const begin = performance.now();
    const child = spawnSync(process.execPath, [script, '--checkout', resolve(values[mode])], { encoding: 'utf8', maxBuffer: 2 ** 22 });
    if (child.status !== 0) throw Error(child.stderr || child.stdout);
    const report = JSON.parse(child.stdout);
    if (reports[mode]) assert.deepEqual(report.rows, reports[mode].rows, 'Unstable outcomes');
    reports[mode] = report;
    samples.push({ mode, pair: pair + 1, wallMs: performance.now() - begin, loadMs: report.loadMs, casesMs: report.casesMs, peakRssKiB: report.peakRssKiB });
  }
  const baseline = new Map(reports.baseline.rows.map(row => [row.id, row.sha256]));
  const comparison = new Map(reports.comparison.rows.map(row => [row.id, row.sha256]));
  const differences = { removed: [...baseline.keys()].filter(id => !comparison.has(id)),
    added: [...comparison.keys()].filter(id => !baseline.has(id)),
    changed: [...comparison].filter(([id, hash]) => baseline.has(id) && baseline.get(id) !== hash).map(([id]) => id) };
  const summary = rows => { const sorted = rows.sort((a, b) => a - b); return { median: sorted[2], min: sorted[0], max: sorted.at(-1) }; };
  const statistics = Object.fromEntries(['baseline', 'comparison'].map(mode => [mode, Object.fromEntries(
    ['loadMs', 'casesMs', 'wallMs', 'peakRssKiB'].map(key => [key, summary(samples.filter(row => row.mode === mode).map(row => row[key]))]))]));
  for (const report of Object.values(reports)) delete report.rows;
  console.log(JSON.stringify({ node: process.version, cpus: cpus().length, ramBytes: totalmem(),
    conditions: 'Five serial alternating fresh-process pairs; warm/uncontrolled OS cache. Full public random corpus and 23 bank pools; no calculator.',
    differences, reports, statistics, samples }, null, 2));
}
