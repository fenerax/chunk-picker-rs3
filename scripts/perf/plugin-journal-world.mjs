// Synthetic durable ingestion only; no calculator, private save or external client.
// node scripts/perf/plugin-journal-world.mjs BEFORE_CHECKOUT AFTER_CHECKOUT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || major === 24 && minor >= 20, 'Node 24.20+ required');
if (process.argv[2] === '--worker') {
  assert.equal(process.env.RS3_DATASET, 'open-f2p');
  const checkout = path.resolve(process.argv[3]), mode = process.argv[4];
  assert.ok(['direct-live', 'lost-beta-ack'].includes(mode));
  const load = relative => import(pathToFileURL(path.join(checkout, relative)));
  const [{ openStore }, { openGamePlugin }, { createGroupState }] = await Promise.all([
    load('app/storage/store.mjs'), load('app/game-plugin.mjs'), load('app/core/state.mjs')]);
  const goal = 'rs3:goal:equipment:000597', wear = 'rs3:task:000b41', item = 34830;
  const catalogue = [{ id: goal, category: 'BiS', label: 'Synthetic Obtain goal' }, { id: wear, category: 'Skill', label: 'Synthetic Wear task' }];
  let at = Date.parse('2026-11-01T12:00:00Z'), store, controller, input, output, key, seq = 0, queue = Promise.resolve();
  const started = performance.now(), dataDir = await mkdtemp(path.join(tmpdir(), 'plugin-journal-world-perf-'));
  async function start() {
    const state = createGroupState([{ id: 'synthetic', name: 'Synthetic player' }]);
    state.tasks = structuredClone(catalogue);
    store = await openStore({ dataDir, initialState: state, taskCatalogue: new Map(catalogue.map(row => [row.id, row])), retention: false,
      now: () => new Date(at).toISOString() });
    controller = await openGamePlugin({ dataDir, store, clock: () => at, world: { chunks: new Map() }, registry: { resolve: () => ({}) }, questMapping: new Map(),
      taskCatalogue: () => catalogue, serializeMutation: operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; },
      bodyJSON: async () => input, json: async (_req, _res, status, value) => { assert.equal(status, 200); output = value; },
      checkRequestOrigin: () => {}, log: () => { throw new Error('Unexpected synthetic ingestion warning'); } });
  }
  const event = [1, item, 'Synthetic beta item'], worn = [[0, item, 1, 'Synthetic item']];
  async function send(beta, events = [], rows = []) {
    at += 1001;
    input = { v: 1, seq: ++seq, sentAt: new Date(at).toISOString(), position: { x: 1, z: 1, floor: 0 }, world: { id: beta ? 204 : 1, beta },
      items: { snapshot: '0123456789abcdef', worn: rows, backpack: [], journal: { id: 'aaaaaaaaaaaaaaaa', events } } };
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} });
    return output;
  }
  async function inspect() {
    const state = store.getState(), member = state.members[0];
    const fact = JSON.parse(await readFile(path.join(dataDir, 'plugin-items.json'), 'utf8')).players.synthetic.items[item];
    const disk = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).state.members[0];
    const completed = Number(member.completedTasks.includes(goal));
    assert.equal(Number(disk.completedTasks.includes(goal)), completed);
    assert.equal(Number(Boolean(fact?.ownedAt)), completed);
    assert.equal(Number(Boolean(fact?.wornAt)), completed);
    assert.equal(member.completedTasks.includes(wear), false);
    assert.equal(state.history.filter(row => row.command?.items?.length).length, completed);
    assert.equal((controller.review({ admin: true }, 'synthetic').items ?? []).filter(row => row.taskId === wear && row.world === 'live').length, completed);
    return completed;
  }
  try {
    await start();
    ({ key } = await controller.create({ admin: true }, { memberId: 'synthetic', label: 'Synthetic benchmark' }));
    assert.equal((await send(false)).items.journal.event, 0);
    assert.equal((await send(true, mode === 'lost-beta-ack' ? [event] : [], worn)).items.journal.event, mode === 'lost-beta-ack' ? 1 : 0);
    await send(false, mode === 'lost-beta-ack' ? [event] : [], mode === 'direct-live' ? worn : []);
    const completed = await inspect();
    await controller.close(); await store.close(); await start();
    await send(false);
    assert.equal(await inspect(), completed);
    console.log(JSON.stringify({ mode, elapsedMs: performance.now() - started, peakRSSKiB: process.resourceUsage().maxRSS, completed }));
  } finally {
    try { await controller?.close(); } finally { try { await store?.close(); } finally { await rm(dataDir, { recursive: true, force: true }); } }
  }
} else {
  const checkouts = process.argv.slice(2);
  assert.equal(checkouts.length, 2, 'Pass before and after checkout paths');
  const env = { ...process.env, RS3_DATASET: 'open-f2p' };
  for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DATA_DIR', 'RS3_GAME_DEFAULTS_FILE']) delete env[key];
  const samples = [];
  for (let pair = 0; pair < 5; pair++) for (const mode of ['direct-live', 'lost-beta-ack']) for (const side of pair % 2 ? [1, 0] : [0, 1]) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', checkouts[side], mode], { env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    samples.push({ pair: pair + 1, side: side ? 'after' : 'before', ...JSON.parse(child.stdout) });
  }
  const spread = values => { const sorted = values.toSorted((a, b) => a - b); return { median: sorted[2], min: sorted[0], max: sorted.at(-1) }; };
  const summaries = {};
  for (const side of ['before', 'after']) for (const mode of ['direct-live', 'lost-beta-ack']) {
    const rows = samples.filter(row => row.side === side && row.mode === mode);
    summaries[`${side}:${mode}`] = { elapsedMs: spread(rows.map(row => row.elapsedMs)), peakRSSKiB: spread(rows.map(row => row.peakRSSKiB)),
      completed: rows.reduce((sum, row) => sum + row.completed, 0), runs: rows.length };
  }
  console.log(JSON.stringify({ node: process.version, conditions: 'five sequential AB/BA pairs per case; fresh processes and synthetic durable stores; imports excluded; setup, three reports, disk/state inspection and reopen included; final cleanup excluded; warm filesystem caches; no explicit warmup', samples, summaries }, null, 2));
}
