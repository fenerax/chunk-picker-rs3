import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { validatePluginReport } from '../app/integrations/game-plugin.mjs';
import { GAME_ITEMS, GAME_WORN_TASKS, matchGameItems } from '../app/integrations/game-items.mjs';
import { applyCommand, createGroupState, importBackup, validateState } from '../app/core/state.mjs';
import { importBackup as loadLiveBackup, applyCommand as applyLiveCommand, exportBackup as exportLiveBackup } from './fixtures/rollback-main/state.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { dismissPluginItemEvidence, exportPluginItemEvidence, openPluginItems, openPluginJournalCommits, stagePluginItemDecisions } from '../app/plugin-items.mjs';
import { retainPluginItemEvidence } from '../app/core/plugin-item-evidence.mjs';
import { currencyAfterCommand, loadPluginCurrency, observePluginCurrency } from '../app/storage/plugin-currency.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';

const identity = { admin: true };
const journalId = 'aaaaaaaaaaaaaaaa';
const CHAINBODY = 34830, CHAINBODY_NOTED = 34831, YEW_SHORTBOW = 857, BRONZE_DAGGER = 1205, UNKNOWN = 999999;
const goal = suffix => `rs3:goal:equipment:${suffix}`;
const WEAR_TASK = 'rs3:task:000b41';
// Synthetic catalogue rows with the real generated IDs; labels are local.
const catalogue = [
  { id: goal('000597'), label: 'Obtain a Gud raider chainbody', category: 'BiS' },
  { id: goal('000dc1'), label: 'Obtain a Yew shortbow', category: 'BiS' },
  { id: goal('0002ae'), label: 'Obtain a Bronze dagger', category: 'BiS' },
  { id: WEAR_TASK, label: 'Wear a piece of gud raider equipment', category: 'Skill' },
  { id: goal('00080a'), label: 'Obtain a Noose wand', category: 'BiS' },
  { id: goal('0009f8'), label: 'Obtain a Rune hatchet', category: 'BiS' },
];
const items = ({ snapshot = '0123456789abcdef', worn = [], backpack = [], events = [], id = journalId } = {}) => ({ snapshot, worn, backpack, journal: { id, events } });

test('acknowledged journals survive frozen portable import, edit, Undo, and export without sidecars', async t => {
  const source = await fixture(t, { durable: true });
  assert.equal((await source.send(items({ events: [[1, CHAINBODY, 'Synthetic rollback journal']] }))).items.journal.event, 1);
  const portable = await source.backup();
  assert.deepEqual(portable.state.provenance.pluginItemEvidence.players, portable.optionalSidecarEvidence.entries.pluginItems.players);
  let frozen = loadLiveBackup(portable);
  frozen = applyLiveCommand(frozen, { type: 'set-journal', memberId: 'a', note: 'Synthetic frozen edit' });
  frozen = applyLiveCommand(frozen, { type: 'undo' });
  const resumed = await fixture(t, { durable: true });
  await resumed.restore(exportLiveBackup(frozen));
  await resumed.restart();
  assert.ok(resumed.review().items.some(row => row.taskId === WEAR_TASK));
  assert.equal((await resumed.send(items())).items.journal.event, 1);
});

test('frozen whole-save provenance archives rebuild imported journal reviews without a report', async t => {
  const source = await fixture(t, { durable: true });
  await source.send(items({ events: [[1, CHAINBODY, 'Synthetic archived journal']] }));
  const frozen = loadLiveBackup(await source.backup());
  frozen.provenance = { restore: { incomingProvenance: frozen.provenance } };
  const resumed = await fixture(t, { durable: true });
  await resumed.restore(exportLiveBackup(frozen));
  assert.ok(resumed.review().items.some(row => row.taskId === WEAR_TASK));
  await resumed.restart();
  assert.ok(resumed.review().items.some(row => row.taskId === WEAR_TASK));
  assert.equal((await resumed.send(items())).items.journal.event, 1);
});

async function fixture(t, { betaAsLive = false, durable = false, legacyCoins, externalLegacy = false } = {}) {
  const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-items-test-', import.meta.url)));
  let at = Date.parse('2026-10-22T12:00:00Z'), input, output, seq = 0, controller;
  const warnings = [], commands = [], taskCatalogue = new Map(catalogue.map(row => [row.id, row])), failing = { command: false, tickPublication: false, publication: false };
  let state = createGroupState([{ id: 'a', name: 'Explorer 1' }, { id: 'b', name: 'Explorer 2' }]), currencyMetadata;
  if (legacyCoins !== undefined) state = applyCommand(state, { type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: legacyCoins } } });
  if (externalLegacy) state.legacy = { syntheticPadding: 'x'.repeat(300000) };
  let store = {
    getInfo: () => ({ revision: state.revision }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => null,
    command: async (command, expectedRevision) => {
      if (failing.command) throw new Error('Synthetic write failure');
      const before = state;
      state = applyCommand(state, command, { expectedRevision, now: () => new Date(at).toISOString(), taskCatalogue });
      currencyMetadata = currencyAfterCommand(currencyMetadata, command, before, state);
      commands.push(structuredClone(command)); return state;
    },
    observePluginCurrency: async observation => {
      const result = observePluginCurrency(state, currencyMetadata, observation, { now: () => new Date(at).toISOString() });
      if (failing.command && result.state !== state) throw new Error('Synthetic write failure');
      if (result.state.revision !== state.revision) commands.push(structuredClone(result.state.history.at(-1).command));
      state = result.state; currencyMetadata = result.metadata; return { currencyRetry: result.retry };
    },
    commitPluginReview: async ({ memberId, taskIds, taskWorlds, unmappedIds, command }, expectedRevision, options) => {
      const evidence = dismissPluginItemEvidence(await exportPluginItemEvidence(dataDir, id => id, state.provenance?.pluginItemEvidence), memberId, taskIds, unmappedIds, new Date(at).toISOString(), taskWorlds);
      if (command) await store.command(command, expectedRevision, options);
      else if (failing.command || failing.publication) throw new Error('Synthetic write failure');
      state = retainPluginItemEvidence(state, evidence);
      return state;
    },
  };
  let queue = Promise.resolve();
  async function start(runtime = { openStore, openGamePlugin }) {
    if (durable) store = await runtime.openStore({ dataDir, initialState: state, taskCatalogue, retention: false, now: () => new Date(at).toISOString(),
      beforeCommit: async context => { if (failing.command || failing.tickPublication && context.operation === 'command') throw new Error('Synthetic write failure'); if (failing.publication) throw new Error('Synthetic publication failure'); await failing.onCommit?.(context); } });
    controller = await runtime.openGamePlugin({ dataDir, store, clock: () => at, world: { chunks: new Map() }, registry: { resolve: () => ({}) }, questMapping: new Map(),
      serializeMutation: operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; },
      bodyJSON: async () => input, json: async (_request, _response, status, value) => { assert.equal(status, 200); output = value; },
      checkRequestOrigin: () => {}, taskCatalogue: () => catalogue, itemsBetaAsLive: betaAsLive, log: message => warnings.push(message) });
  }
  await start();
  const { key } = await controller.create(identity, { memberId: 'a', label: 'Synthetic plugin' });
  t.after(async () => { await controller.close(); if (durable) await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function send(value, beta = false, field = 'items') {
    at += 1001; input = { v: 1, seq: ++seq, sentAt: new Date(at).toISOString(), position: { x: 50, z: 50, floor: 0 }, ...(beta === null ? {} : { world: { id: beta ? 204 : 1, beta } }), ...(value === undefined ? {} : { [field]: value }) };
    return dispatch();
  }
  async function dispatch(bearer = key) {
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${bearer}` } };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  async function apply(selected) {
    const preview = controller.review(identity, 'a');
    const review = controller.findReview(identity, { previewId: preview.previewId, expectedRevision: preview.stateRevision, items: selected.map(taskId => ({ taskId })) }, true);
    await controller.finish('a', { command: review.command, expectedRevision: preview.stateRevision });
    return review.command;
  }
  return { get store() { return store; }, get controller() { return controller; }, get state() { return durable ? store.getState() : state; }, get at() { return at; }, get lastReport() { return structuredClone(input); }, advance: ms => { at += ms; }, commands, send, apply, dataDir, warnings, failing,
    replay: async (report, bearer) => { input = structuredClone(report); return dispatch(bearer); },
    createKey: () => controller.create(identity, { memberId: 'a', label: 'Synthetic second plugin' }),
    command: command => store.command(command, store.getInfo().revision),
    backup: () => store.backup(),
    portable: async () => JSON.parse((await store.exportBackup({ dataset: {
      datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {},
    } })).bytes.toString()),
    transfer: async backup => {
      const preview = await store.prepareTransfer(serialize({ backup }), {
        dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
        world: { chunks: new Map() }, route: '/api/restore/preview' });
      await store.applyTransfer(preview.ticket, store.getInfo().revision);
    },
    restore: async document => store.replace(document ?? await store.backup(), store.getInfo().revision),
    restoreMember: async backup => {
      const preview = await store.prepareTransfer(serialize({ backup, memberId: 'a', sourceMemberId: 'a' }), {
        dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
        world: { chunks: new Map() }, route: '/api/member-restore/preview' });
      await store.applyTransfer(preview.ticket, store.getInfo().revision);
    },
    sendBank: (value, beta = false) => send(value, beta, 'bank'),
    review: () => controller.review(identity, 'a'), restart: async runtime => { await controller.close(); if (durable) await store.close(); await start(runtime); } };
}

test('explicit item decisions remain valid through the accepted real frozen rollback boundaries', async t => {
  const frozen = await frozenRuntime(t);
  const runtime = { ...frozen, ...await import(pathToFileURL(path.join(frozen.checkout, 'app/game-plugin.mjs')).href) };
  for (const action of ['dismiss', 'apply', 'skip']) for (const boundary of ['report', 'older-restore']) await t.test(`${action}: ${boundary}`, async t => {
    const f = await fixture(t, { durable: true });
    const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic rollback item']] });
    await f.send(observation);
    const beforeDecision = await f.backup();
    assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
    if (action === 'dismiss') await f.controller.finish('a');
    else await f.apply(action === 'apply' ? [WEAR_TASK] : []);
    const lowered = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.a;
    assert.ok(lowered.handled.includes(WEAR_TASK));
    assert.ok(lowered.handled.includes(`~plugin-review:${WEAR_TASK}`));
    await f.restart(runtime);
    if (boundary === 'older-restore') await f.restore(beforeDecision);
    else if (action !== 'dismiss') await f.command({ type: 'undo' });
    await f.send(observation);
    await f.restart();
    assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
    await f.send(observation);
    assert.deepEqual(f.review(), { preview: null }, 'Roll-forward recovers decisions even after a frozen restore');
  });
  for (const action of ['dismiss', 'apply', 'skip']) for (const beta of [true, null]) await t.test(`non-live-only ${action} round trip (${beta})`, async t => {
    const f = await fixture(t, { durable: true });
    const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic non-live rollback item']] });
    await f.send(observation, beta);
    assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
    if (action === 'dismiss') await f.controller.finish('a');
    else await f.apply(action === 'apply' ? [WEAR_TASK] : []);
    const world = beta ? 'beta' : 'unknown';
    assert.ok(f.store.getPluginItemEvidence().players.a.records[world].handled.includes(WEAR_TASK));
    await f.restart(runtime);
    if (action === 'apply') await f.command({ type: 'undo' });
    await f.send(observation, beta);
    validateState(f.state);
    await f.restart();
    assert.ok(f.store.getPluginItemEvidence().players.a.records[world].handled.includes(WEAR_TASK));
    await f.send(observation, beta);
    assert.deepEqual(f.review(), { preview: null });
  });
  // Review reproductions: frozen matching may re-offer a decided row. It must
  // remain loadable, and surviving current provenance must still win on return.
  for (const action of ['dismiss', 'apply', 'skip']) for (const kind of ['container', 'journal']) for (const beta of [true, null]) await t.test(`later frozen ${action}/${kind}/${beta}`, async t => {
    const f = await fixture(t, { durable: true });
    const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic cross-world gear']] });
    await f.send(observation);
    assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
    if (action === 'dismiss') await f.controller.finish('a');
    else await f.apply(action === 'apply' ? [WEAR_TASK] : []);
    const decisions = structuredClone(f.store.getPluginItemEvidence().players.a.records.live.handled);
    await f.restart(runtime);
    if (action === 'apply') await f.command({ type: 'undo' });
    if (kind === 'container') await f.send(observation, beta);
    else await f.send(items({ events: [[2, CHAINBODY, 'Synthetic frozen non-live journal', beta ? 'beta' : 'unknown']] }));
    validateState(f.state);
    const completed = [...f.state.members[0].completedTasks];
    await f.restart();
    const recovered = f.store.getPluginItemEvidence().players.a.records.live.handled;
    assert.ok(decisions.every(id => recovered.includes(id)), 'Roll-forward never discards a surviving current decision');
    assert.deepEqual(f.state.members[0].completedTasks, completed, 'Roll-forward changes no task progress');
    await f.send(observation, beta);
    assert.deepEqual(f.review(), { preview: null });
    await f.backup();
  });
  for (const boundary of ['portable restore', 'older restore and export']) await t.test(`frozen ${boundary} keeps surviving current decisions on return`, async t => {
    const source = await fixture(t, { durable: true });
    const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic portable frozen gear']] });
    await source.send(observation);
    const older = await source.backup();
    assert.ok(source.review().items.some(row => row.taskId === WEAR_TASK));
    await source.controller.finish('a');
    const portable = await source.backup();
    const carrier = boundary === 'portable restore' ? await fixture(t, { durable: true }) : source;
    await carrier.restart(runtime);
    await carrier.restore(boundary === 'portable restore' ? portable : older);
    await carrier.send(observation);
    validateState(carrier.state);
    const exported = await carrier.backup();
    const completed = [...carrier.state.members[0].completedTasks];
    const target = await fixture(t, { durable: true });
    // A fresh portable restore has its incoming decision archived by frozen.
    // An older frozen restore may discard that carrier: preserve any decision
    // still held in the current destination when importing its frozen export.
    if (boundary === 'older restore and export') await target.restore(portable);
    await target.restore(exported);
    await target.restart();
    assert.ok(target.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
    assert.deepEqual(target.state.members[0].completedTasks, completed);
    await target.send(observation);
    assert.deepEqual(target.review(), { preview: null });
    if (carrier === source) {
      await source.restart();
      assert.ok(source.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
    }
  });
});

for (const action of ['dismiss', 'apply', 'skip']) for (const world of ['live', 'beta', 'unknown']) for (const kind of ['containers', 'catch-up journal']) test(`${action} accepts ${world} ${kind} with food, runes and unmapped identities`, async t => {
  const f = await fixture(t, { durable: true });
  const beta = world === 'live' ? false : world === 'beta' ? true : null;
  const observation = kind === 'containers' ? items({ worn: [[4, CHAINBODY, 1, 'Synthetic wearable']],
    backpack: [[0, 379, 1, 'Lobster'], [1, 556, 10, 'Air rune'], [2, UNKNOWN, 1, 'Synthetic unmapped']] })
    : items({ events: [CHAINBODY, 379, 556, UNKNOWN].map((id, index) => [index + 1, id, 'Synthetic catch-up item', world]) });
  await f.send(observation, beta);
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  assert.ok([379, 556, UNKNOWN].every(id => f.review().unmappedItems.some(row => row.gameItemId === id)));
  if (action === 'dismiss') await f.controller.finish('a');
  else await f.apply(action === 'apply' ? [WEAR_TASK] : []);
  assert.equal(f.state.members[0].completedTasks.includes(WEAR_TASK), action === 'apply');
  if (action === 'apply') await f.command({ type: 'undo' });
  await f.restart();
  await f.send(observation, beta);
  assert.deepEqual(f.review(), { preview: null });
  await f.backup();
});

for (const world of ['beta', 'unknown']) for (const source of ['containers', 'journal', 'bank']) test(`authoritative ${world} decisions at capacity suppress ${source} without optional markers`, async t => {
  const f = await fixture(t, { durable: true }), beta = world === 'beta' ? true : null;
  const retained = await openPluginItems({ dataDir: f.dataDir, members: () => f.state.members, journalWorld: world });
  try { await retained.put('a', { baselineAt: new Date(f.at).toISOString(), items: {}, journal: null,
    handled: Array.from({ length: 1998 }, (_, i) => `synthetic-${String(i).padStart(4, '0')}`) }); }
  finally { await retained.close(); }
  await f.restart();
  const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic capacity wearable']] });
  await f.send(observation, beta);
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  const handled = f.store.getPluginItemEvidence().players.a.records[world].handled;
  assert.equal(handled.length, 2000);
  assert.ok([WEAR_TASK, goal('000597')].every(id => handled.includes(id)));
  assert.equal(handled.some(id => id.startsWith('~plugin-review:')), false);
  await f.restart();
  if (source === 'containers') await f.send(observation, beta);
  else if (source === 'bank') await f.sendBank(bank(1, 1, [[CHAINBODY, 1]]), beta);
  else await f.send(items({ events: [[1, CHAINBODY, 'Synthetic later journal', world]] }), beta);
  assert.deepEqual(f.review(), { preview: null });
  await f.restart();
  assert.deepEqual(f.review(), { preview: null });
});

for (const world of ['beta', 'unknown']) for (const failure of ['full live scope', 'failed lowering']) test(`authoritative ${world} decisions survive ${failure} across writable recovery`, async t => {
  const f = await fixture(t, { durable: true }), beta = world === 'beta' ? true : null;
  if (failure === 'full live scope') {
    const live = await openPluginItems({ dataDir: f.dataDir, members: () => f.state.members });
    try { await live.put('a', { baselineAt: new Date(f.at).toISOString(), items: {}, journal: null,
      handled: Array.from({ length: 2000 }, (_, i) => `synthetic-${String(i).padStart(4, '0')}`) }); }
    finally { await live.close(); }
    await f.restart();
  } else f.failing.onCommit = async () => {
    for (const name of (await readdir(f.dataDir)).filter(name => /^plugin-items\.json\..*\.tmp$/.test(name))) await unlink(path.join(f.dataDir, name));
  };
  const observation = items({ worn: [[4, CHAINBODY, 1, 'Synthetic optional lowering wearable']] });
  await f.send(observation, beta);
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  assert.ok(f.store.getPluginItemEvidence().players.a.records[world].handled.includes(WEAR_TASK));
  await f.restart();
  await f.send(observation, beta);
  assert.deepEqual(f.review(), { preview: null });
});

const BOGUS_MARKER = '{"v":1,"players":{"a":{"baselineAt":"2026-10-22T12:00:00.000Z","items":{},"handled":["~plugin-review:bogus"],"journal":null}}}';
test('optional item readers validate source semantics before merging authoritative evidence', async t => {
  const record = { baselineAt: '2026-10-22T12:00:00.000Z', items: {}, handled: [WEAR_TASK, `~plugin-review:${WEAR_TASK}`].sort(), journal: null };
  const inherited = { v: 1, players: { a: { records: { live: record }, commits: { journals: [] } } } };
  const mutations = [
    ['review marker', value => { value.handled = ['~plugin-review:bogus']; }],
    ['item identity', value => { value.items.invalid = { name: 'Synthetic invalid identity', ownedAt: value.baselineAt, wornAt: null, first: true }; }],
    ['scope field', value => { value.world = 'unrecognized'; }],
    ['journal watermark', value => { value.journal = { id: journalId, event: -1 }; }],
    ['bank field', value => { value.bank = { snapshot: journalId, seenAt: value.baselineAt, coins: -1 }; }],
  ];
  const cases = ['live', 'beta', 'unknown'].flatMap(world => mutations.map(([label, mutate]) => {
    const value = structuredClone(record); mutate(value);
    return { label: `${world}: ${label}`, world, document: { v: 1, players: { a: value } } };
  }));
  cases.push(...cases.filter(entry => entry.label.endsWith('review marker')).map(entry => ({
    ...entry, label: `${entry.label} after reader open`, late: true })));
  for (const [label, journals] of [
    ['pending scope', [{ id: journalId, committed: 0, pending: [[1, UNKNOWN, 'Synthetic pending', 'unrecognized']] }]],
    ['pending item', [{ id: journalId, committed: 0, pending: [[1, 1000001, 'Synthetic pending', 'unknown']] }]],
    ['pending ordering', [{ id: journalId, committed: 1, pending: [[1, UNKNOWN, 'Synthetic pending', 'unknown']] }]],
    ['duplicate journal', Array.from({ length: 2 }, () => ({ id: journalId, committed: 0, pending: [] }))],
  ]) cases.push({ label, commits: true, document: { v: 1, players: { a: { journals } } } });
  for (const commits of [false, true]) for (const owner of ['constructor', 'too many players']) cases.push({
    label: `${commits ? 'ledger' : 'items'}: ${owner}`, commits, world: 'live', document: { v: 1, players: Object.fromEntries(
      (owner === 'constructor' ? ['constructor'] : Array.from({ length: 257 }, (_, i) => `synthetic-${i}`))
        .map(id => [id, commits ? { journals: [] } : structuredClone(record)])) } });
  for (const entry of cases) await t.test(entry.label, async t => {
    const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-items-test-', import.meta.url)));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const name = entry.commits ? 'plugin-item-journal-commits.json' : entry.world === 'live' ? 'plugin-items.json' : `plugin-item-journal-${entry.world}.json`;
    const file = path.join(dataDir, name), bytes = JSON.stringify(entry.document), warnings = [];
    await writeFile(file, bytes);
    const exported = await exportPluginItemEvidence(dataDir, id => id, inherited, { log: message => warnings.push(message) });
    assert.deepEqual(exported, inherited);
    if (entry.late) await writeFile(file, JSON.stringify({ v: 1, players: { a: record } }));
    const reader = await (entry.commits ? openPluginJournalCommits : openPluginItems)({ dataDir, members: () => [{ id: 'a' }],
      ...(entry.world && entry.world !== 'live' ? { journalWorld: entry.world } : {}),
      inherited: () => entry.commits ? inherited.players.a.commits : record, log: message => warnings.push(message) });
    try {
      if (entry.late) {
        await writeFile(file, bytes);
        assert.deepEqual(await exportPluginItemEvidence(dataDir, id => id, inherited, { log: message => warnings.push(message) }), inherited);
      }
      const healthy = entry.commits ? inherited.players.a.commits : record;
      assert.deepEqual(reader.get('a'), healthy);
      assert.equal(await readFile(file, 'utf8'), bytes);
      await reader.put('a', healthy);
      const archive = (await readdir(dataDir)).find(name => name.startsWith(`${path.basename(file)}.corrupt-`));
      assert.ok(archive); assert.equal(await readFile(path.join(dataDir, archive), 'utf8'), bytes);
      assert.ok(warnings.length >= 2);
    } finally { await reader.close(); }
  });
});

test('unknown literal IDs remain valid and invalid optional markers cannot veto startup', async t => {
  const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-items-test-', import.meta.url)));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const record = { baselineAt: '2026-10-22T12:00:00.000Z', handled: ['synthetic-future-task', `unmapped:${UNKNOWN}`].sort(),
    items: { [UNKNOWN]: { name: 'Synthetic unmapped item', ownedAt: '2026-10-22T12:00:00.000Z', wornAt: null, first: true } }, journal: null };
  await writeFile(path.join(dataDir, 'plugin-items.json'), JSON.stringify({ v: 1, players: { a: record } }));
  assert.deepEqual((await exportPluginItemEvidence(dataDir)).players.a.records.live, record);
  const invalid = { v: 1, players: { a: { records: { live: { ...record, handled: ['~plugin-review:bogus'] } }, commits: { journals: [] } } } };
  await assert.rejects(exportPluginItemEvidence(dataDir, id => id, invalid), /Invalid plugin item review marker/);
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'a', name: 'Synthetic player' }]), retention: false });
  t.after(() => store.close());
  await store.close();
  const file = path.join(dataDir, 'state.json'), document = JSON.parse(await readFile(file));
  document.state.provenance = { pluginItemEvidence: invalid, pluginItemEvidenceReconciled: 1 };
  const bytes = JSON.stringify(document); await writeFile(file, bytes);
  const reopened = await openStore({ dataDir, retention: false });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getState().members, document.state.members);
  assert.ok((await reopened.backup()).state);
  assert.equal(reopened.getPluginItemEvidence()?.players.a.records.live.handled.includes('~plugin-review:bogus') ?? false, false);
});

test('a well-formed review marker for a later-retired task stays healthy evidence', async t => {
  const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-items-test-', import.meta.url)));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const at = '2026-10-22T12:00:00.000Z', members = () => [{ id: 'a' }, { id: 'b' }];
  const record = { baselineAt: at, handled: [WEAR_TASK, `~plugin-review:${WEAR_TASK}`].sort(), journal: { id: journalId, event: 1 },
    items: { [UNKNOWN]: { name: 'Synthetic acknowledged evidence', ownedAt: at, wornAt: null, first: true } } };
  const writer = await openPluginItems({ dataDir, members });
  await writer.put('a', record); await writer.close();
  const file = path.join(dataDir, 'plugin-items.json'), original = await readFile(file, 'utf8');
  const retired = GAME_WORN_TASKS.get(WEAR_TASK); GAME_WORN_TASKS.delete(WEAR_TASK);
  let reader;
  try {
    // A fresh module instance models the next release after this task leaves the catalogue.
    const runtime = await import('../app/plugin-items.mjs?retired-catalogue');
    const warnings = [], log = message => warnings.push(message);
    assert.deepEqual((await runtime.exportPluginItemEvidence(dataDir, id => id, undefined, { log })).players.a.records.live, record);
    const inherited = { v: 1, players: { a: { records: { live: record }, commits: { journals: [] } } } };
    assert.deepEqual((await runtime.exportPluginItemEvidence(dataDir, id => id, inherited, { log })).players.a.records.live, record);
    reader = await runtime.openPluginItems({ dataDir, members, log });
    assert.deepEqual(reader.get('a'), record);
    await reader.put('b', { baselineAt: at, items: {}, handled: [], journal: null });
    assert.equal((await readdir(dataDir)).some(name => name.startsWith('plugin-items.json.corrupt-')), false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).players.a, JSON.parse(original).players.a);
    assert.deepEqual(warnings, []);
    const bogus = { v: 1, players: { a: { records: { live: { ...record, handled: ['~plugin-review:bogus'] } }, commits: { journals: [] } } } };
    await assert.rejects(runtime.exportPluginItemEvidence(dataDir, id => id, bogus), /Invalid plugin item review marker/);
  } finally { await reader?.close(); GAME_WORN_TASKS.set(WEAR_TASK, retired); }
});

for (const name of ['plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json']) test(`decision recovery tolerates an unknown review marker in optional ${name}`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic retained live item']], events: [
    [1, BRONZE_DAGGER, 'Synthetic beta evidence', 'beta'], [2, CHAINBODY, 'Synthetic legacy evidence']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.controller.close(); await f.store.close();
  await writeFile(path.join(f.dataDir, name), BOGUS_MARKER);
  await f.restart();
  assert.equal(await readFile(path.join(f.dataDir, name), 'utf8'), BOGUS_MARKER);
  assert.ok(f.warnings.some(message => /Invalid plugin item store/.test(message)));
  assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
  assert.deepEqual(f.review(), { preview: null });
  const backup = await f.backup(), portable = await f.portable();
  assert.ok(backup.state.provenance.pluginItemEvidence.players.a.records.live.handled.includes(WEAR_TASK));
  assert.ok(portable.optionalSidecarEvidence.entries.pluginItems.players.a.records.live.handled.includes(WEAR_TASK));
  await f.store.previewReplacement(backup);
  assert.equal(await readFile(path.join(f.dataDir, name), 'utf8'), BOGUS_MARKER, 'All readers leave the corrupt source for archival repair');
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live retry']], events: [
    [3, BRONZE_DAGGER, 'Synthetic beta retry', 'beta'], [4, CHAINBODY, 'Synthetic legacy retry']] }));
  const archive = (await readdir(f.dataDir)).find(file => file.startsWith(`${name}.corrupt-`));
  assert.ok(archive);
  assert.equal(await readFile(path.join(f.dataDir, archive), 'utf8'), BOGUS_MARKER);
  await f.restart(); await f.backup();
  assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
  assert.deepEqual(f.review(), { preview: null });
});

for (const name of ['plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']) for (const bytes of ['{broken', '{"v":1,"players":{"a":{}}}']) test(`decision recovery preserves corrupt ${name} (${bytes === '{broken' ? 'syntax' : 'record'}) for archival repair`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic retained live item']], events: [
    [1, BRONZE_DAGGER, 'Synthetic beta evidence', 'beta'], [2, CHAINBODY, 'Synthetic legacy evidence']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.controller.close(); await f.store.close();
  await writeFile(path.join(f.dataDir, name), bytes);
  await f.restart();
  assert.equal(await readFile(path.join(f.dataDir, name), 'utf8'), bytes, 'Opening never replaces corrupt optional evidence');
  assert.ok(f.warnings.some(message => /Invalid plugin item store/.test(message)));
  assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
  assert.deepEqual(f.review(), { preview: null });
  const reply = await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live retry']], events: [
    [3, BRONZE_DAGGER, 'Synthetic beta retry', 'beta'], [4, CHAINBODY, 'Synthetic legacy retry']] }));
  assert.equal(reply.items.journal.event, 4);
  const archive = (await readdir(f.dataDir)).find(file => file.startsWith(`${name}.corrupt-`));
  assert.ok(archive);
  assert.equal(await readFile(path.join(f.dataDir, archive), 'utf8'), bytes);
  await f.restart(); await f.backup();
  assert.deepEqual(f.review(), { preview: null });
});

test('optional unsealed journal recovery cannot veto a strict read-only open or change its checkpoint', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic sealed decision']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.send(items({ events: [[1, UNKNOWN, 'Synthetic newer journal']] }));
  await f.controller.close(); await f.store.close();
  const file = path.join(f.dataDir, 'state.json'), document = JSON.parse(await readFile(file));
  delete document.state.provenance.pluginItemEvidenceReconciled;
  document.state.provenance.restore = { incomingProvenance: { pluginItemEvidence: structuredClone(document.state.provenance.pluginItemEvidence) } };
  const bytes = JSON.stringify(document); await writeFile(file, bytes);
  let standby;
  try {
    standby = await openStore({ dataDir: f.dataDir, readOnly: true, liveSwapStrict: true, retention: false });
    assert.deepEqual(standby.getState().members, document.state.members);
  }
  finally { await standby?.close(); }
  assert.equal(await readFile(file, 'utf8'), bytes);
  await f.restart();
  assert.equal(JSON.parse(await readFile(file)).state.provenance.pluginItemEvidenceReconciled, 1);
});

test('missing optional legacy projection never blocks export and is repaired on writable open', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic repair item']] }));
  const prior = await readFile(path.join(f.dataDir, 'plugin-items.json'));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.controller.close(); await f.store.close();
  await writeFile(path.join(f.dataDir, 'plugin-items.json'), prior);
  assert.ok((await exportPluginItemEvidence(f.dataDir)).players.a.records.live.handled.includes(WEAR_TASK));
  await f.restart();
  assert.ok(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.a.handled.includes(WEAR_TASK));
  assert.deepEqual(f.review(), { preview: null });
  await f.backup();
});

for (const action of ['dismiss', 'apply']) test(`failed optional legacy lowering cannot roll back ${action} or its gameplay`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live lowering item']], events: [[1, CHAINBODY, 'Synthetic lowering failure']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  const before = await readFile(path.join(f.dataDir, 'plugin-items.json'));
  f.failing.onCommit = async () => {
    const staged = (await readdir(f.dataDir)).filter(name => /^plugin-items\.json\..*\.tmp$/.test(name));
    assert.equal(staged.length, 1);
    await unlink(path.join(f.dataDir, staged[0]));
  };
  if (action === 'apply') await f.apply([WEAR_TASK]);
  else await f.controller.finish('a');
  assert.deepEqual(await readFile(path.join(f.dataDir, 'plugin-items.json')), before);
  assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
  assert.equal(f.state.members[0].completedTasks.includes(WEAR_TASK), action === 'apply');
  await f.backup();
  f.failing.onCommit = undefined;
  await f.restart();
  assert.deepEqual(f.review(), { preview: null });
});

test('optional legacy marker capacity never refuses a valid current decision', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic capacity item']] }));
  await f.controller.close(); await f.store.close();
  const file = path.join(f.dataDir, 'plugin-items.json'), document = JSON.parse(await readFile(file));
  document.players.a.handled = Array.from({ length: 1999 }, (_, i) => `synthetic-${String(i).padStart(4, '0')}`);
  await writeFile(file, JSON.stringify(document)); await f.restart();
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  assert.ok(f.store.getPluginItemEvidence().players.a.records.live.handled.includes(WEAR_TASK));
  assert.equal(f.store.getPluginItemEvidence().players.a.records.live.handled.length, 2000);
  await f.restart(); await f.backup();
  assert.deepEqual(f.review(), { preview: null });
});

test('optional rollback markers never consume the last slot needed by a current decision or import union', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic first decision']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.controller.close(); await f.store.close();
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json'), document = JSON.parse(await readFile(file));
  document.players.a.handled = [WEAR_TASK, `~plugin-review:${WEAR_TASK}`, goal('000597'), `~plugin-review:${goal('000597')}`,
    ...Array.from({ length: 1996 }, (_, i) => `synthetic-${String(i).padStart(4, '0')}`)].sort();
  await writeFile(file, JSON.stringify(document)); await f.restart();
  await f.send(items({ events: [[2, BRONZE_DAGGER, 'Synthetic newer decision']] }));
  assert.ok(f.review().items.some(row => row.taskId === goal('0002ae')));
  await f.controller.finish('a');
  await f.restart();
  const retained = (await f.backup()).state.provenance.pluginItemEvidence.players.a.records.unknown;
  assert.equal(retained.handled.length, 2000);
  assert.ok(retained.handled.includes(WEAR_TASK));
  assert.ok(retained.handled.includes(goal('0002ae')));
  assert.deepEqual(f.review(), { preview: null });
});

test('another player sidecar write retains a decision lowered after the reader opened', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic preserved decision']] }));
  const reader = await openPluginItems({ dataDir: f.dataDir, members: () => f.state.members });
  try {
    assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
    await f.controller.finish('a');
    const at = new Date(f.at).toISOString();
    await reader.put('b', { baselineAt: at, items: {}, handled: [], journal: null });
    assert.ok(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.a.handled.includes(WEAR_TASK));
  } finally { await reader.close(); }
});

for (const publication of ['command', 'startup repair', 'replacement', 'prepared transfer']) test(`decision projection preserves a sibling's first acknowledged live journal through ${publication}`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic initial decision']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  const beforeSibling = await f.backup();
  const { key } = await f.controller.create(identity, { memberId: 'b', label: 'Synthetic sibling plugin' });
  const response = await f.replay({ ...f.lastReport, seq: 1,
    items: items({ events: [[1, UNKNOWN, 'Synthetic sibling live journal', 'live']] }) }, key);
  assert.equal(response.items.journal.event, 1, 'The real sender may now discard this event');
  assert.equal(f.store.getPluginItemEvidence().players.b, undefined, 'The sibling is absent from the retained provenance projection');
  const file = path.join(f.dataDir, 'plugin-items.json'), before = JSON.parse(await readFile(file)).players.b;
  assert.ok(before.items[UNKNOWN]);
  if (publication === 'command') await f.command({ type: 'set-journal', memberId: 'a', note: 'Synthetic subsequent edit' });
  else if (publication === 'startup repair') {
    await f.controller.close(); await f.store.close();
    const legacy = JSON.parse(await readFile(file));
    legacy.players.a.handled = legacy.players.a.handled.filter(id => id !== WEAR_TASK && id !== `~plugin-review:${WEAR_TASK}`);
    await writeFile(file, JSON.stringify(legacy));
    await f.restart();
  } else if (publication === 'replacement') await f.restore(beforeSibling);
  else await f.transfer(beforeSibling);
  assert.deepEqual(JSON.parse(await readFile(file)).players.b, before, 'Lowering cannot delete another current member or alter their retained record');
  await f.restart();
  const recovered = (await f.backup()).optionalSidecarEvidence.entries.pluginItems.players.b;
  assert.ok(recovered.records.live.items[UNKNOWN]);
  assert.equal(recovered.commits.journals[0].committed, 1);
});

for (const world of ['live', 'beta', 'unknown']) test(`new ${world} evidence after a decision keeps read-only backup, export and previews available`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic existing decision']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  await f.backup();
  const event = [1, BRONZE_DAGGER, 'Synthetic newer journal evidence'];
  if (world !== 'unknown') event.push(world);
  assert.equal((await f.send(items({ events: [event] }))).items.journal.event, 1);
  assert.equal(f.store.getPluginItemEvidence().players.a.records[world]?.items[BRONZE_DAGGER], undefined,
    'The newer fact intentionally lives outside the older provenance capture');
  const before = await itemEvidenceBytes(f.dataDir);
  const backup = await f.backup(), portable = await f.portable();
  for (const document of [backup, portable]) {
    const evidence = document.optionalSidecarEvidence.entries.pluginItems.players.a;
    assert.ok(evidence.records[world].items[BRONZE_DAGGER]);
    assert.equal(evidence.commits.journals[0].committed, 1);
  }
  const replacement = await f.store.previewReplacement(backup);
  assert.ok(replacement.state.provenance.pluginItemEvidence.players.a.records[world].items[BRONZE_DAGGER]);
  const prepared = await f.store.prepareTransfer(serialize({ backup }), transferOptions);
  assert.ok(prepared.ticket);
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before, 'Read-only consumers never need a writable restart or rewrite healthy files');
});

test('the optional legacy union can omit new compatibility markers without refusing current state', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic union item']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  const incoming = await exportPluginItemEvidence(f.dataDir);
  const file = path.join(f.dataDir, 'plugin-items.json'), legacy = JSON.parse(await readFile(file));
  const base = legacy.players.a.handled;
  const reserve = [...new Set([...GAME_ITEMS.values()].map(item => item.goalId))].filter(id => !base.includes(id)).length;
  const count = Math.floor((2000 - reserve - base.length) / 2) + 1;
  assert.ok(count > 0 && 2 * count + base.length <= 2000, 'The record bound alone admits this union');
  const padding = prefix => Array.from({ length: count }, (_, i) => `synthetic-${prefix}-${String(i).padStart(4, '0')}`);
  legacy.players.a.handled = [...base, ...padding('destination')].sort();
  incoming.players.a.records.live.handled = [...base, ...padding('incoming')].sort();
  await writeFile(file, JSON.stringify(legacy));
  const before = await itemEvidenceBytes(f.dataDir);
  const staged = await stagePluginItemDecisions(f.dataDir, incoming);
  await staged?.cancel();
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before);
});

test('item reports are bounded, separate and keep unreadable containers as null', () => {
  const base = { v: 1, seq: 1, sentAt: '2026-10-22T12:00:00.000Z', position: { x: 1, z: 1, floor: 0 } };
  assert.doesNotThrow(() => validatePluginReport({ ...base, items: items({ worn: null, backpack: [[0, 1205, 1, 'Bronze dagger']] }) }));
  for (const bad of [
    { ...base, items: items(), achievements: { snapshot: '0123456789abcdef', part: 1, parts: 1, complete: [] } },
    { ...base, items: items(), skills: {} },
    { ...base, items: { ...items(), extra: 1 } },
    { ...base, items: items({ snapshot: 'short' }) },
    { ...base, items: items({ worn: [[0, 1, 1, 'A'], [0, 2, 1, 'B']] }) },
    { ...base, items: items({ worn: [[0, 1, 0, 'A']] }) },
    { ...base, items: items({ backpack: [[0, 1, 1, 'Bad\u0000name']] }) },
    { ...base, items: items({ backpack: Array.from({ length: 65 }, (_, slot) => [slot, 1, 1, 'A']) }) },
    { ...base, items: items({ events: [[2, 1, 'A'], [2, 1, 'A']] }) },
    { ...base, items: items({ events: Array.from({ length: 33 }, (_, index) => [index + 1, 1, 'A']) }) },
    { ...base, items: items({ id: 'xyz' }) },
  ]) assert.throws(() => validatePluginReport(bad), error => error.status === 400);
});

test('the reviewed table only maps checked IDs; possession matches Obtain goals and wearing matches Wear tasks', () => {
  assert.equal(GAME_ITEMS.get(CHAINBODY).goalId, goal('000597'));
  assert.equal(GAME_ITEMS.get(CHAINBODY_NOTED).noted, true);
  assert.equal(GAME_ITEMS.has(UNKNOWN), false);
  const task = id => catalogue.find(row => row.id === id) ?? null;
  const evidence = new Map([[CHAINBODY, { name: 'Gud raider chainbody', ownedAt: '2026-10-22T12:00:00.000Z', wornAt: null, first: true }]]);
  const owned = matchGameItems({ evidence, task, completed: new Set(), world: 'live' });
  assert.deepEqual(owned.rows.map(row => [row.taskId, row.evidence, row.seen]), [[goal('000597'), 'owned', 'owned when first seen; source unknown']]);
  evidence.get(CHAINBODY).wornAt = '2026-10-22T12:01:00.000Z';
  const worn = matchGameItems({ evidence, task, completed: new Set([goal('000597')]), world: 'live' });
  assert.deepEqual(worn.rows.map(row => [row.taskId, row.evidence]), [[WEAR_TASK, 'worn']]);
  assert.equal(matchGameItems({ evidence, task: () => null, completed: new Set(), world: 'live' }).rows.length, 0, 'Tasks absent from the catalogue are never proposed');
  const ticking = matchGameItems({ evidence, task, completed: new Set(), world: 'live', autoTick: true });
  assert.deepEqual([ticking.ticks.map(row => row.taskId), ticking.rows.map(row => row.taskId)], [[goal('000597')], [WEAR_TASK]], 'Only owned goals tick');
});

test('the eight BiS goals from the in-game test map to their checked IDs, noted copies included', () => {
  for (const [suffix, wearable, noted] of [['00080a', 10150, 10151], ['0009f0', 46845, 46846], ['0009f8', 1359, 1360], ['000a6e', 46885, 46886],
    ['000a80', 46865, 46866], ['000b61', 3385, 3386], ['000be4', 45465, 1194], ['000cb2', 4405, 4406]]) {
    assert.equal(GAME_ITEMS.get(wearable).goalId, goal(suffix)); assert.equal(GAME_ITEMS.get(wearable).noted, false);
    assert.equal(GAME_ITEMS.get(noted).goalId, goal(suffix)); assert.equal(GAME_ITEMS.get(noted).noted, true);
  }
});

test('better owned gear from the second in-game test maps to its checked IDs, noted copies included', () => {
  for (const [suffix, name, slot, wearable, noted] of [['00006c', 'Adamant kiteshield', 'off-hand', 45519, 1200], ['0009f4', 'Rune gauntlets + 3', 'hands', 46938, 46939],
    ['0009c5', 'Rune armoured boots + 3', 'feet', 46925, 46926], ['0000e3', 'Amulet of power', 'neck', 1731, 1732],
    ['000a5d', 'Rune pickaxe', 'main hand weapon', 45548, 1276]]) {
    assert.deepEqual([GAME_ITEMS.get(wearable).goalId, GAME_ITEMS.get(wearable).name, GAME_ITEMS.get(wearable).slot, GAME_ITEMS.get(wearable).noted], [goal(suffix), name, slot, false]);
    assert.deepEqual([GAME_ITEMS.get(noted).goalId, GAME_ITEMS.get(noted).noted], [goal(suffix), true]);
  }
  // Lent copies stay unmapped.
  for (const lent of [45042, 46940, 46927]) assert.equal(GAME_ITEMS.has(lent), false);
});

test('every reviewed row names the picker item whose generated Obtain goal it ticks', () => {
  for (const [id, item] of GAME_ITEMS) assert.equal(equipmentTaskIdentity(item.name).id, item.goalId, `${id} ${item.name}`);
});

test('live owned items tick their BiS goals with labels and provenance; Wear tasks stay in review', async t => {
  const f = await fixture(t);
  const value = items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow'], [1, UNKNOWN, 3, 'Mystery item']] });
  const status = await f.send(value);
  assert.deepEqual(status.items, { snapshot: value.snapshot, journal: { id: journalId, event: 0 } });
  assert.equal(f.commands.length, 1, 'One History entry for the batch');
  assert.deepEqual(f.commands[0].items.map(row => [row.taskId, row.evidence, row.gameItemId, row.seen]), [
    [goal('000dc1'), 'owned', YEW_SHORTBOW, 'owned when first seen; source unknown'],
    [goal('000597'), 'owned', CHAINBODY, 'owned when first seen; source unknown'],
  ]);
  const member = f.state.members[0];
  assert.deepEqual([...member.completedTasks].sort(), [goal('000dc1'), goal('000597')].sort());
  assert.deepEqual(member.itemProgress[goal('000597')], { title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'owned',
    seen: 'owned when first seen; source unknown', source: 'game-plugin', fetchedAt: '2026-10-22T12:00:01.001Z', memberId: 'a' });
  assert.ok(f.state.tasks.some(task => task.id === goal('000597')), 'Generated goal registered from the trusted catalogue');
  assert.doesNotThrow(() => validateState(f.state));
  const preview = f.review();
  assert.deepEqual(preview.items.map(row => [row.taskId, row.evidence, row.seen, row.world]), [[WEAR_TASK, 'worn', 'worn 2026-10-22T12:00:01.001Z', 'live']]);
  assert.deepEqual(preview.unmappedItems, [{ gameItemId: UNKNOWN, name: 'Mystery item' }]);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.players.a.items).sort(), [String(YEW_SHORTBOW), String(CHAINBODY)].sort(), 'Only reviewed IDs are stored');
  assert.equal(saved.players.a.items[CHAINBODY].first, true);
  assert.deepEqual(saved.players.a.handled, [goal('000dc1'), goal('000597')].sort());

  // Later gains tick as new; a repeat of the same report ticks nothing.
  await f.send(items({ snapshot: '1123456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  assert.equal(f.commands.length, 2);
  assert.deepEqual(f.commands[1].items.map(row => [row.taskId, row.seen]), [[goal('0002ae'), 'new since 2026-10-22T12:00:02.002Z']]);
  await f.send(items({ snapshot: '1123456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  assert.equal(f.commands.length, 2);
});

test('an undone item tick is not ticked again, and a failed tick waits in review', async t => {
  const f = await fixture(t);
  f.failing.command = true;
  await f.send(items({ backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.evidence]), [[goal('000dc1'), 'owned']], 'Kept for review when the write fails');
  f.failing.command = false;
  await f.send(items({ snapshot: '1123456789abcdef', backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')), 'The next report ticks it');
  const undone = applyCommand(f.state, { type: 'undo' }, { expectedRevision: f.state.revision, now: () => '2026-10-22T13:00:00.000Z' });
  assert.equal(undone.members[0].completedTasks.includes(goal('000dc1')), false);
  assert.equal(undone.members[0].itemProgress?.[goal('000dc1')], undefined, 'Undo removes the evidence');
  await f.restart();
  await f.send(items({ snapshot: '2223456789abcdef', backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.equal(f.commands.length, 1, 'Handled across restart');
});

for (const restore of ['checkpoint', 'older-backup', 'member']) test(`an automatic item tick keeps suppression through sidecar failure, Undo and ${restore} restore`, async t => {
  const f = await fixture(t, { durable: true });
  const older = f.state;
  const file = path.join(f.dataDir, 'plugin-items.json'), backup = path.join(f.dataDir, 'synthetic-held-items.json');
  const command = f.store.command;
  f.store.command = async (...args) => {
    const result = await command(...args);
    if (args[0].type === 'apply-game-progress') { await rename(file, backup); await mkdir(file); }
    return result;
  };
  const value = items({ backpack: [[0, YEW_SHORTBOW, 1, 'Synthetic bow']] });
  await f.send(value);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')));
  assert.ok(f.warnings.some(message => /handled plugin item/.test(message)));
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  const rolledBack = applyLiveCommand(loadLiveBackup(saved), { type: 'undo' });
  assert.deepEqual(rolledBack.members[0].completedTasks, []);
  assert.deepEqual(rolledBack.provenance.pluginAutoHandled, saved.state.provenance.pluginAutoHandled, 'The legacy loader and Undo retain the additive replay policy');
  assert.doesNotThrow(() => validateState(rolledBack));
  await f.store.command({ type: 'undo' }, f.state.revision);
  await rm(file, { recursive: true }); await rename(backup, file);
  await f.restart();
  const revision = f.state.revision;
  await f.send(value);
  assert.deepEqual(f.state.members[0].completedTasks, [], 'The failed sidecar cannot undo a committed suppression decision');
  assert.equal(f.state.revision, revision, 'Replay adds no tick or History entry');
  assert.equal(f.store.isPluginHandled('b', 'items', goal('000dc1')), false, 'Suppression belongs to the observed player');
  const destination = restore === 'member' ? await fixture(t, { durable: true }) : f;
  if (restore === 'member') {
    // A fresh picker has no handled sidecar to hide a lost transfer marker.
    await f.store.command({ type: 'set-runescape-name', memberId: 'a', name: 'FixtureActor' }, f.state.revision);
    const review = await destination.store.prepareTransfer(serialize({ backup: await f.store.backup(), memberId: 'a', sourceMemberId: 'a' }),
      { dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() }, route: '/api/member-restore/preview' });
    await destination.store.applyTransfer(review.ticket, destination.state.revision);
    // Undo the restore too: imported replay decisions remain committed policy.
    await destination.store.command({ type: 'undo' }, destination.state.revision);
  } else await destination.store.replace(restore === 'checkpoint' ? f.state : older, f.state.revision);
  await destination.restart();
  const restoredRevision = destination.state.revision;
  await destination.send(value);
  assert.deepEqual(destination.state.members[0].completedTasks, [], 'Restore retains the committed replay policy');
  assert.equal(destination.state.revision, restoredRevision, 'Restored observations cannot tick again');
});

test('a failed gameplay publication commits neither the item tick nor its suppression', async t => {
  const f = await fixture(t, { durable: true });
  f.failing.tickPublication = true;
  const value = items({ backpack: [[0, YEW_SHORTBOW, 1, 'Synthetic bow']] });
  const revision = f.state.revision;
  await f.send(value);
  assert.equal(f.state.revision, revision);
  assert.equal(f.store.isPluginHandled('a', 'items', goal('000dc1')), false);
  assert.ok(f.review().items.some(row => row.taskId === goal('000dc1')), 'The failed tick stays available for retry');
  f.failing.tickPublication = false;
  await f.restart();
  await f.send(value);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')));
  assert.equal(f.store.isPluginHandled('a', 'items', goal('000dc1')), true);
});

test('Apply ticks only chosen review rows; shown live rows stay handled across restart', async t => {
  const f = await fixture(t);
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  const command = await f.apply([WEAR_TASK]);
  assert.deepEqual(command.items.map(row => [row.taskId, row.evidence, row.seen]), [[WEAR_TASK, 'worn', 'worn 2026-10-22T12:00:01.001Z']]);
  const member = f.state.members[0];
  assert.deepEqual(member.itemProgress[WEAR_TASK], { title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'worn',
    seen: 'worn 2026-10-22T12:00:01.001Z', source: 'game-plugin', fetchedAt: '2026-10-22T12:00:01.001Z', memberId: 'a' });
  assert.doesNotThrow(() => validateState(f.state));
  const saved = await exportPluginItemEvidence(f.dataDir, id => id, f.state.provenance?.pluginItemEvidence);
  assert.deepEqual(saved.players.a.records.live.handled, [WEAR_TASK, `~plugin-review:${WEAR_TASK}`, goal('000597'), goal('000dc1')].sort());

  await f.restart();
  await f.send(items({ snapshot: '2223456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.equal(f.review().preview, null, 'Handled and completed rows do not return after a restart');
});

test('a Wear row left unticked stays handled and is not offered again', async t => {
  const f = await fixture(t);
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']] }));
  await f.apply([]);
  assert.equal(f.state.members[0].completedTasks.includes(WEAR_TASK), false, 'Skipped rows stay unticked');
  await f.send(items({ snapshot: '2223456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']] }));
  assert.equal(f.review().preview, null);
});

test('beta snapshots never tick, stay in memory and are labelled; journal events count once per journal', async t => {
  const f = await fixture(t);
  const status = await f.send(items({ backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody', 'beta'], [2, CHAINBODY_NOTED, 'Gud raider chainbody', 'beta']] }), true);
  assert.deepEqual(status.items.journal, { id: journalId, event: 2 });
  assert.equal(f.commands.length, 0, 'Beta items never tick');
  const rows = f.review().items;
  assert.ok(rows.every(row => row.world === 'beta'));
  assert.ok(rows.some(row => row.taskId === WEAR_TASK), 'A worn journal event is worn evidence');
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'), { code: 'ENOENT' });
  await f.controller.finish('a');
  await f.send(items({ snapshot: '3323456789abcdef', backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody', 'beta']] }), true);
  assert.deepEqual(f.review(), { preview: null }, 'The beta decision suppresses later duplicate evidence');
});

test('a scratch picker can let beta items tick as live ones would', async t => {
  const f = await fixture(t, { betaAsLive: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }), true);
  assert.deepEqual(f.commands[0].items.map(row => row.taskId), [goal('0002ae'), goal('000597')]);
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [[WEAR_TASK, 'live']]);
  assert.ok(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a.items[CHAINBODY]);
});

test('a first look with an unreadable container records nothing and keeps the journal unacknowledged', async t => {
  const f = await fixture(t);
  const status = await f.send(items({ worn: null, backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody']] }));
  assert.deepEqual(status.items, { snapshot: '0123456789abcdef', journal: null });
  assert.equal(f.review().preview, null);
});

test('saved item progress validates provenance, evidence kind and task references', () => {
  let state = createGroupState([{ id: 'a', name: 'Explorer 1' }]);
  const taskCatalogue = new Map(catalogue.map(row => [row.id, row]));
  const base = { type: 'apply-game-progress', memberId: 'a', fetchedAt: '2026-10-22T12:00:00.000Z', skills: [], quests: [] };
  const seen = 'owned when first seen; source unknown';
  for (const bad of [[{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'gift', seen }], [{ taskId: 'rs3:goal:equipment:ffffff', title: 'X', gameItemId: 1, evidence: 'owned', seen }],
    [{ taskId: goal('000597'), title: 'X', gameItemId: -1, evidence: 'owned', seen }], [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned', seen, source: 'other' }],
    [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned' }], [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned', seen: 'bad\nlabel' }]]) {
    assert.throws(() => applyCommand(state, { ...base, items: bad }, { expectedRevision: state.revision, taskCatalogue }));
  }
  state = applyCommand(state, { ...base, items: [{ taskId: goal('000597'), title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'owned', seen }] }, { expectedRevision: state.revision, taskCatalogue });
  const unticked = applyCommand(state, { type: 'complete-task', memberId: 'a', taskId: goal('000597'), completed: false }, { expectedRevision: state.revision, taskCatalogue });
  assert.equal(Object.hasOwn(unticked.members[0].itemProgress, goal('000597')), false, 'Unticking clears the item evidence');
  const bad = structuredClone(state); bad.members[0].itemProgress[goal('000597')].memberId = 'b';
  assert.throws(() => validateState(bad));
});

test('a corrupt item sidecar is archived on the next write, never deleted', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.dataDir, 'plugin-items.json'), '{not json');
  await f.restart();
  assert.ok(f.warnings.some(line => /Invalid plugin item store/.test(line)));
  await f.send(items({ backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  const { readdir } = await import('node:fs/promises');
  assert.ok((await readdir(f.dataDir)).some(name => name.startsWith('plugin-items.json.corrupt-')));
});

const NOOSE_WAND = 10150, RUNE_HATCHET = 1359, RUNE_PICKAXE = 45548;
const bank = (part, parts, rows, { snapshot = 'b0123456789abcde', age = 0 } = {}) => ({ snapshot, part, parts, age, rows });

test('tool belt, pouch and bank reports are bounded and the bank travels alone', () => {
  const base = { v: 1, seq: 1, sentAt: '2026-10-22T12:00:00.000Z', position: { x: 1, z: 1, floor: 0 } };
  assert.doesNotThrow(() => validatePluginReport({ ...base, items: { ...items(), toolbelt: [['HATCHET_LEVEL', 6], ['NOOSE_WAND', 1]], pouch: [[0, 995, 82094, 'Coins']] } }));
  assert.doesNotThrow(() => validatePluginReport({ ...base, items: { ...items(), toolbelt: null, pouch: null } }));
  assert.doesNotThrow(() => validatePluginReport({ ...base, bank: bank(1, 2, [[995, 1000], [995, 5], [857, 1]], { age: 30 }) }));
  for (const bad of [
    { ...base, items: { ...items(), toolbelt: [['NOOSE_WAND', 1], ['HATCHET_LEVEL', 6]] } },
    { ...base, items: { ...items(), toolbelt: [['NOOSE_WAND', 1], ['NOOSE_WAND', 1]] } },
    { ...base, items: { ...items(), toolbelt: [['noose_wand', 1]] } },
    { ...base, items: { ...items(), toolbelt: [['NOOSE_WAND', 0]] } },
    { ...base, items: { ...items(), toolbelt: Array.from({ length: 129 }, (_, n) => [`T${String(n).padStart(3, '0')}`, 1]) } },
    { ...base, items: { ...items(), pouch: [[0, 995, 0, 'Coins']] } },
    { ...base, items: items(), bank: bank(1, 1, []) },
    { ...base, bank: bank(1, 1, []), diagnostics: [] },
    { ...base, bank: { ...bank(1, 1, []), extra: 1 } },
    { ...base, bank: bank(2, 1, []) },
    { ...base, bank: bank(1, 9, []) },
    { ...base, bank: bank(1, 1, [], { age: -1 }) },
    { ...base, bank: bank(1, 1, [], { snapshot: 'nope' }) },
    { ...base, bank: bank(1, 1, [[995, 0]]) },
    { ...base, bank: bank(1, 1, [[995, 1, 'Coins']]) },
    { ...base, bank: bank(1, 1, Array.from({ length: 701 }, () => [995, 1])) },
  ]) assert.throws(() => validatePluginReport(bad), error => error.status === 400);
});

test('reviewed tool belt entries count as owned; other entries are not listed', async t => {
  const f = await fixture(t);
  await f.send({ ...items(), toolbelt: [['HATCHET', 1], ['HATCHET_LEVEL', 6], ['NOOSE_WAND', 1], ['PICKAXE_LEVEL', 16]] });
  assert.deepEqual(f.commands[0].items.map(row => [row.taskId, row.gameItemId, row.title]),
    [[goal('0009f8'), RUNE_HATCHET, 'Rune hatchet'], [goal('00080a'), NOOSE_WAND, 'Noose wand']]);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.players.a.items).sort(), [String(RUNE_HATCHET), String(NOOSE_WAND), String(RUNE_PICKAXE)].sort());
  // Unmapped belt entries don't join the unmapped item list.
  await f.send({ ...items({ snapshot: '2223456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']] }), toolbelt: [['HATCHET', 1], ['PICKAXE_LEVEL', 15]] });
  assert.deepEqual(f.review().unmappedItems, []);
});

test('bank parts assemble in order, tick owned goals and are acknowledged once complete, across a restart', async t => {
  const f = await fixture(t);
  let status = await f.sendBank(bank(2, 2, [[BRONZE_DAGGER, 1]]));
  assert.equal(status.bank, null, 'A set starts at part 1');
  status = await f.sendBank(bank(1, 2, [[995, 1000], [YEW_SHORTBOW, 1], [UNKNOWN, 3]], { age: 120 }));
  assert.equal(status.bank, null, 'Not acknowledged until every part arrives');
  status = await f.sendBank(bank(2, 2, [[BRONZE_DAGGER, 1]], { age: 120 }));
  assert.deepEqual(status.bank, { snapshot: 'b0123456789abcde' });
  assert.deepEqual(f.commands.map(command => command.type), ['apply-game-progress'], 'Bank alone never writes coins: pouch and backpack are unknown');
  assert.deepEqual(f.commands[0].items.map(row => row.taskId), [goal('000dc1'), goal('0002ae')]);
  const seenAt = new Date(f.at - 120000).toISOString();
  assert.equal(f.controller.list(identity).keys[0].bankSeenAt, seenAt);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.deepEqual(saved.players.a.bank, { snapshot: 'b0123456789abcde', seenAt, coins: 1000 });
  assert.equal(saved.players.a.items[YEW_SHORTBOW].name, 'Yew shortbow', 'Bank items take the reviewed name');
  // A held set sent again in full ticks nothing new but moves "bank as of" on; a restart
  // remembers the live bank.
  await f.sendBank(bank(1, 2, [[995, 1000], [YEW_SHORTBOW, 1], [UNKNOWN, 3]], { age: 0 }));
  status = await f.sendBank(bank(2, 2, [[BRONZE_DAGGER, 1]], { age: 0 }));
  assert.deepEqual(status.bank, { snapshot: 'b0123456789abcde' });
  assert.equal(f.commands.length, 1);
  const later = new Date(f.at).toISOString();
  assert.equal(f.controller.list(identity).keys[0].bankSeenAt, later);
  await f.restart();
  status = await f.send(items({ snapshot: '5523456789abcdef' }));
  assert.deepEqual(status.bank, { snapshot: 'b0123456789abcde' });
  assert.equal(f.controller.list(identity).keys[0].bankSeenAt, later);
});

test('coins on hand count pouch and backpack on live worlds, only when the total changes', async t => {
  const f = await fixture(t);
  const coins = () => f.state.members[0].transportFacts?.currencies?.coins;
  const writes = () => f.commands.filter(command => command.type === 'set-transport-facts').length;
  const value = (snapshot, carried, pouch = [[0, 995, 82094, 'Coins'], [1, 54830, 2, 'Coins']]) => ({ ...items({ snapshot, backpack: [[0, 995, carried, 'Coins']] }), pouch });
  await f.send(value('0123456789abcdef', 100), true);
  assert.equal(coins(), undefined, 'Beta never writes coins');
  await f.send(value('1123456789abcdef', 100));
  assert.equal(coins(), 2000082194);
  await f.send(value('1123456789abcdef', 100));
  assert.equal(writes(), 1, 'An unchanged total writes nothing');
  await f.sendBank(bank(1, 1, [[995, 5000]]));
  assert.equal(coins(), 2000082194, 'At most one write a minute');
  f.advance(60000);
  await f.send(value('2223456789abcdef', 100, null));
  assert.equal(coins(), undefined, 'An unreadable pouch invalidates the plugin balance');
  assert.equal(writes(), 2);
  assert.doesNotThrow(() => validateState(f.state));
});

for (const unreadable of ['pouch', 'backpack']) test(`moving carried coins never mixes a fresh container with an unreadable ${unreadable}`, async t => {
  const f = await fixture(t, { durable: true });
  const coins = () => f.state.members[0].transportFacts?.currencies?.coins;
  const stack = [[0, 995, 100, 'Coins']];
  const other = unreadable === 'pouch' ? 'backpack' : 'pouch';
  await f.send({ ...items(), [unreadable]: stack, [other]: [] });
  assert.equal(coins(), 100);
  f.advance(60000);
  await f.send({ ...items({ snapshot: '1123456789abcdef' }), [unreadable]: null, [other]: stack });
  assert.equal(coins(), undefined, 'A partial read cannot support a current balance');
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).state;
  assert.equal(saved.members[0].transportFacts.currencies?.coins, undefined);
  assert.equal(saved.history.filter(row => row.command?.type === 'set-transport-facts').length, 2);
  await f.restart();
  await f.send({ ...items({ snapshot: '2223456789abcdef' }), [unreadable]: null, [other]: stack });
  assert.equal(coins(), undefined, 'Restart keeps the balance unknown');
  await f.send({ ...items({ snapshot: '3323456789abcdef' }), pouch: [], backpack: [] });
  assert.equal(coins(), 0, 'A coherent empty report clears the balance');
});

test('current coins require both carried containers in the same report', async t => {
  const f = await fixture(t);
  const coins = () => f.state.members[0].transportFacts?.currencies?.coins;
  const stack = [[0, 995, 100, 'Coins']];
  await f.send({ ...items(), pouch: stack, backpack: null });
  await f.send({ ...items(), pouch: null, backpack: stack });
  assert.equal(coins(), undefined, 'Two complementary partial reads cannot establish a balance');
  await f.send({ ...items(), pouch: [], backpack: [] });
  assert.equal(coins(), 0);
  f.advance(60000);
  await f.send({ ...items(), pouch: stack, backpack: null });
  await f.send({ ...items(), pouch: null, backpack: stack });
  assert.equal(coins(), undefined, 'Partial reads invalidate the plugin balance');
  await f.send({ ...items(), pouch: null, backpack: null });
  await f.send(items({ backpack: stack }));
  assert.equal(coins(), undefined, 'Null and omitted pouch observations are unreadable');
  await f.send({ ...items({ worn: null, backpack: stack }), pouch: [], toolbelt: null });
  assert.equal(coins(), 100, 'Worn items and toolbelt do not contribute currency');
  f.advance(60000);
  await f.send(items({ backpack: [[0, 995, 200, 'Coins']] }));
  assert.equal(coins(), undefined, 'An omitted pouch invalidates its previously readable count');
});

test('coherent currency saves load and undo on the frozen live release', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  f.advance(60000);
  await f.send({ ...items({ backpack: [[0, 995, 25, 'Coins']] }), pouch: [[0, 995, 50, 'Coins']] });
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  const loaded = loadLiveBackup(document);
  assert.deepEqual(loaded, f.state);
  assert.equal(loaded.members[0].transportFacts.currencies.coins, 75);
  const undone = applyLiveCommand(loaded, { type: 'undo' }, { now: () => new Date(f.at).toISOString() });
  assert.equal(undone.members[0].transportFacts.currencies.coins, 100);
  assert.deepEqual(importBackup(exportLiveBackup(undone)), undone, 'Rollback output still loads on this branch');
  const original = applyLiveCommand(undone, { type: 'undo' }, { now: () => new Date(f.at).toISOString() });
  assert.equal(original.members[0].transportFacts?.currencies?.coins, undefined, 'Old Undo also removes the first currency facts');
});

test('currency corrections are immediate while consecutive History entries coalesce', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  await f.send({ ...items({ snapshot: '1123456789abcdef' }), pouch: [] });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0, 'No minute-long delay for an acknowledged correction');
  assert.equal(f.state.history.filter(row => row.type === 'set-transport-facts').length, 1, 'History coalesces independently of current facts');
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  const old = loadLiveBackup(document);
  const undone = applyLiveCommand(old, { type: 'undo' });
  assert.equal(undone.members[0].transportFacts?.currencies?.coins, undefined, 'Old Undo reverses the whole coalesced group');
  assert.deepEqual(importBackup(exportLiveBackup(undone)), undone);
  f.advance(60000);
  await f.restart();
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0, 'An unchanged inventory need never be sent again');
});

test('unreadable currency removes the plugin fact immediately and durably', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  await f.send({ ...items({ backpack: null }), pouch: null });
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(document.pluginCurrency.facts.a.coins, null, 'Unknown is metadata, never a zero balance');
  assert.deepEqual(loadLiveBackup(document), f.state, 'Invalidation also loads on the old release');
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('durable currency freshness neutralises replay and out-of-order reports after restart', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const original = f.lastReport;
  await f.send({ ...items(), pouch: [] });
  const latest = f.lastReport;
  await f.restart();
  for (const report of [original, { ...original, seq: latest.seq + 1 }, { ...original, sentAt: new Date(f.at + 1000).toISOString() }]) {
    assert.equal((await f.replay(report)).items.snapshot, null, 'Ambiguity requests a new reading');
    await f.restart();
    assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined, 'Historical funds never become current');
  }
  f.advance(61000);
  await f.send({ ...items(), pouch: [] });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0, 'A fresh report recovers after quarantine');
});

test('switching keys invalidates currency until a stable server-time stream recovers', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const original = f.lastReport;
  const { key } = await f.createKey();
  assert.equal((await f.replay({ ...original, items: { ...items(), pouch: [] } }, key)).items.snapshot, null);
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
  f.advance(61000);
  const newer = { ...original, seq: 2, sentAt: new Date(f.at).toISOString(), items: { ...items(), pouch: [] } };
  await f.replay(newer, key);
  await f.restart();
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0);
  await f.replay({ ...original, seq: 3 });
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('currency publication and freshness fence commit together, and manual facts survive unreadable reports', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const before = await readFile(path.join(f.dataDir, 'state.json'), 'utf8');
  f.failing.command = true;
  await assert.rejects(f.send({ ...items(), pouch: [] }), /Synthetic write failure/);
  const failed = f.lastReport;
  assert.equal(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'), before);
  f.failing.command = false;
  await f.restart();
  await f.replay(failed);
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0, 'An uncommitted fence cannot discard the retry');
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 0, tokens: 5 }, conditions: { synthetic: true } } });
  await f.send({ ...items({ backpack: null }), pouch: null });
  assert.deepEqual(f.state.members[0].transportFacts, { currencies: { coins: 0, tokens: 5 }, conditions: { synthetic: true } }, 'An explicit manual fact is preserved even when it matches the previous plugin value');
});

test('Undo and restore never roll back the private currency freshness fence', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const original = f.lastReport;
  await f.send({ ...items(), pouch: [] });
  const before = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency;
  await f.command({ type: 'undo' });
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
  await f.restore();
  await f.restart();
  const after = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency;
  assert.deepEqual(after.keys, before.keys, 'Portable restore preserves ordering fences');
  assert.equal((await f.replay(original)).items.snapshot, null);
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('currency metadata is bounded and malformed watermarks fail closed', () => {
  const keyId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(loadPluginCurrency(undefined), { format: 2, keys: {}, players: {}, facts: {}, origins: [] });
  assert.throws(() => loadPluginCurrency({ format: 1, keys: { [keyId]: -1 }, players: {} }));
  assert.throws(() => loadPluginCurrency({ format: 1, keys: {}, players: { a: {} } }));
  const keys = Object.fromEntries(Array.from({ length: 1001 }, (_, n) => [`${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`, 1]));
  assert.throws(() => loadPluginCurrency({ format: 1, keys, players: {} }), /Invalid plugin currency metadata/);
});

for (const restart of [false, true]) test(`Undo restores manual currency ownership before invalidation (restart ${restart})`, async t => {
  const f = await fixture(t, { durable: true });
  const facts = { currencies: { coins: 100 }, items: { 'synthetic-item': 100 } };
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts });
  await f.send({ ...items(), pouch: [[0, 995, 200, 'Coins']] });
  const historical = f.lastReport;
  await f.command({ type: 'undo' });
  assert.deepEqual(f.state.members[0].transportFacts, facts);
  if (restart) await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  assert.deepEqual(f.state.members[0].transportFacts, facts, 'Unreadable coins cannot erase the restored manual fact or manual items');
  await f.restart();
  assert.equal((await f.replay(historical)).items.snapshot, null, 'Undo never rolls back freshness');
  assert.deepEqual(f.state.members[0].transportFacts, facts);
});

test('coalescing skips non-reversible entries and continues processing items', async t => {
  const f = await fixture(t, { durable: true });
  const report = coins => ({ ...items(), pouch: coins ? [[0, 995, coins, 'Coins']] : [] });
  await f.send(report(0));
  f.advance(60000);
  await f.send(report(100));
  await f.send(report(0));
  assert.equal(f.state.history.at(-1).undo, undefined, 'Returning to the group baseline has no inverse');
  await f.send({ ...report(50), backpack: [[0, YEW_SHORTBOW, 1, 'Synthetic bow']] });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 50);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')), 'Currency coalescing never blocks item processing');
  await f.send(report(75));
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 75, 'Further corrections do not wait for the interval');
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(loadLiveBackup(document), f.state);
});

test('restore treats imported currency as manual while retaining freshness', async t => {
  const f = await fixture(t, { durable: true });
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 }, items: { 'synthetic-item': 100 } } });
  const manual = await f.backup();
  await f.send({ ...items(), pouch: [[0, 995, 200, 'Coins']] });
  const historical = f.lastReport;
  await f.restore(manual);
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 100);
  assert.equal(f.state.members[0].transportFacts.items['synthetic-item'], 100);
  await f.restart();
  assert.equal((await f.replay(historical)).items.snapshot, null);
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 100);
});

test('a reset sequence recovers after restart without trusting it as a newer stream', async t => {
  const f = await fixture(t, { durable: true });
  const base = { v: 1, seq: f.at, sentAt: new Date(f.at).toISOString(), position: { x: 50, z: 50, floor: 0 }, world: { id: 1, beta: false },
    items: { ...items(), pouch: [[0, 995, 100, 'Coins']] } };
  await f.replay(base);
  await f.restart();
  await f.send({ ...items(), pouch: [] });
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined, 'Reset is ambiguous, never the old 100');
  await f.restart();
  f.advance(61000);
  await f.send({ ...items(), pouch: [] });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 0);
  const metadata = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency;
  assert.equal(Object.values(metadata.keys)[0].highSeq, base.seq, 'Reset does not lower the historical high-water mark');
  await f.replay(base);
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined, 'The retired stream cannot resurrect funds');
});

for (const skew of [300000, Date.parse('9999-01-01T00:00:00Z') - Date.parse('2026-10-22T12:00:00Z')]) {
  test(`a skewed different key cannot resurrect funds or establish a durable lockout (${skew})`, async t => {
    const f = await fixture(t, { durable: true });
    await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
    const stale = f.lastReport;
    await f.send({ ...items(), pouch: [] });
    const { key } = await f.createKey();
    await f.replay({ ...stale, sentAt: new Date(f.at + skew).toISOString() }, key);
    assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
    await f.restart();
    const { key: replacement } = await f.createKey();
    const fresh = { ...stale, seq: 1, sentAt: new Date(f.at).toISOString(), items: { ...items(), pouch: [] } };
    await f.replay(fresh, replacement);
    f.advance(61000);
    await f.restart();
    await f.replay({ ...fresh, seq: 2, sentAt: new Date(f.at).toISOString() }, replacement);
    assert.equal(f.state.members[0].transportFacts.currencies.coins, 0, 'A normal clock and stable stream recover');
    const ledger = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency;
    assert.ok(Object.values(ledger.keys).every(row => row.sentAt === null || Date.parse(row.sentAt) <= f.at));
  });
}

test('an unchanged legacy plugin balance acquires provenance without a History revision', async t => {
  const f = await fixture(t, { durable: true, legacyCoins: 100 });
  const revision = f.state.revision;
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  assert.equal(f.state.revision, revision);
  const ledger = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency;
  assert.equal(ledger.players.a.historyRevision, null);
  assert.equal(ledger.facts.a.source, 'plugin');
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

for (const route of ['replace', 'transfer', 'member', 'import', 'mapped']) test(`unchanged legacy ownership survives portable export and ${route}`, async t => {
  const f = await fixture(t, { durable: true, legacyCoins: 100 });
  const revision = f.state.revision, history = structuredClone(f.state.history);
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  assert.equal(f.state.revision, revision, 'Adoption needs no gameplay revision');
  assert.deepEqual(f.state.history, history, 'Adoption needs no fabricated History command');
  const portable = await f.portable();
  assert.deepEqual(portable.state.provenance.pluginCurrencyFacts.a, { coins: 100, source: 'plugin' });
  assert.equal(portable.pluginCurrency, undefined, 'Replay fences stay private');
  // The frozen loader ignores the optional journal envelope; currency and all
  // ordinary saved state must still load identically on both releases.
  assert.deepEqual(loadLiveBackup(portable), importBackup({ ...portable, optionalSidecarEvidence: undefined }));
  assert.deepEqual(importBackup(portable).provenance.pluginItemEvidence.players, portable.optionalSidecarEvidence.entries.pluginItems.players);
  if (route === 'import' || route === 'mapped') {
    const state = route === 'import' ? importBackup(portable) : mapTransferRoster(importBackup(portable),
      [{ id: 'x', name: 'Synthetic destination' }, { id: 'y', name: 'Synthetic partner' }], { a: 'x', b: 'y' });
    const memberId = route === 'import' ? 'a' : 'x', at = new Date(f.at + 1000).toISOString();
    const result = observePluginCurrency(state, undefined, { memberId, keyId: '11111111-1111-4111-8111-111111111111', seq: 1, sentAt: at, coins: null }, { now: () => at });
    assert.equal(result.state.members.find(row => row.id === memberId).transportFacts?.currencies?.coins, undefined);
    assert.deepEqual(loadLiveBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: result.state }), result.state);
  } else {
    if (route === 'replace') await f.restore(portable);
    else if (route === 'transfer') await f.transfer(portable);
    else await f.restoreMember(portable);
    await f.restart();
    await f.send({ ...items({ backpack: null }), pouch: null });
    await f.restart();
    assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
  }
});

test('Undo retains adopted legacy provenance in a portable round trip', async t => {
  const f = await fixture(t, { durable: true, legacyCoins: 100 });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 0 } } });
  const at = new Date(f.at).toISOString();
  const undone = applyLiveCommand(loadLiveBackup(await f.portable()), { type: 'undo' }, { expectedRevision: f.state.revision, now: () => at });
  await f.command({ type: 'undo' });
  for (const portable of [await f.portable(), exportLiveBackup(undone)]) {
    const result = observePluginCurrency(importBackup(portable), undefined, { memberId: 'a', keyId: '11111111-1111-4111-8111-111111111111', seq: 1, sentAt: at, coins: null }, { now: () => at });
    assert.equal(result.state.members[0].transportFacts?.currencies?.coins, undefined);
  }
});

for (const manual of [false, true]) test(`mapped transfer resolves frozen-release Undo ownership before archiving History (manual ${manual})`, async t => {
  const f = await fixture(t, { durable: true });
  if (manual) {
    await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 } } });
    await f.send({ ...items(), pouch: [[0, 995, 200, 'Coins']] });
  } else {
    await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
    await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 0 } } });
  }
  const at = new Date(f.at).toISOString();
  const undone = applyLiveCommand(loadLiveBackup(await f.portable()), { type: 'undo' }, { expectedRevision: f.state.revision, now: () => at });
  assert.equal(undone.members[0].transportFacts.currencies.coins, 100);
  // The frozen writer preserves the stale map: current ownership lives in History.
  assert.equal(undone.provenance.pluginCurrencyFacts.a.coins, manual ? 200 : 0);
  const dataDir = await mkdtemp(path.join(path.dirname(f.dataDir), '.plugin-mapped-test-'));
  let destination = await openStore({ dataDir, initialState: createGroupState([{ id: 'x', name: 'Synthetic X' }, { id: 'y', name: 'Synthetic Y' }]), retention: false, now: () => at });
  t.after(async () => { await destination.close(); await rm(dataDir, { recursive: true, force: true }); });
  const preview = await destination.prepareTransfer(serialize({ backup: exportLiveBackup(undone), rosterMapping: { a: 'x', b: 'y' } }), {
    dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
    world: { chunks: new Map() }, route: '/api/restore/preview' });
  await destination.applyTransfer(preview.ticket, destination.getInfo().revision);
  assert.deepEqual(destination.getState().provenance.pluginCurrencyFacts.x, { coins: 100, source: manual ? 'manual' : 'plugin' });
  await destination.close();
  destination = await openStore({ dataDir, retention: false, now: () => at });
  await destination.observePluginCurrency({ memberId: 'x', keyId: '11111111-1111-4111-8111-111111111111', seq: 1, sentAt: at, coins: null });
  await destination.close();
  destination = await openStore({ dataDir, retention: false, now: () => at });
  assert.equal(destination.getState().members.find(row => row.id === 'x').transportFacts?.currencies?.coins, manual ? 100 : undefined);
  assert.deepEqual(loadLiveBackup(await destination.backup()), destination.getState(), 'The mapped save still loads on the frozen release');
});

test('currency provenance and fences coexist with main storage sidecar serialization', async t => {
  const f = await fixture(t, { durable: true, legacyCoins: 100, externalLegacy: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.ok(disk.storage.fields.legacy, 'The merged fast serializer retains storage references');
  assert.equal(disk.pluginCurrency.facts.a.source, 'plugin', 'The same envelope retains currency metadata');
  assert.equal(f.state.legacy.syntheticPadding.length, 300000);
  const portable = await f.portable();
  assert.deepEqual(loadLiveBackup(portable), importBackup({ ...portable, optionalSidecarEvidence: undefined }));
  assert.deepEqual(importBackup(portable).provenance.pluginItemEvidence.players, portable.optionalSidecarEvidence.entries.pluginItems.players);
  assert.deepEqual(loadLiveBackup(portable).members, f.state.members);
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
  assert.equal(f.state.legacy.syntheticPadding.length, 300000);
});

test('manual zero followed by Undo restores plugin provenance independently of History grouping', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 0 } } });
  await f.command({ type: 'undo' });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 100);
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('manual item ownership survives plugin observations, Undo and unreadable containers', async t => {
  const f = await fixture(t, { durable: true });
  await f.command({ type: 'complete-task', memberId: 'a', taskId: goal('000dc1'), completed: true });
  await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 }, items: { 'synthetic-item': 1 } } });
  await f.send({ ...items({ backpack: [[0, YEW_SHORTBOW, 1, 'Synthetic bow']] }), pouch: [[0, 995, 200, 'Coins']] });
  await f.command({ type: 'undo' });
  await f.restart();
  await f.send({ ...items({ backpack: null, worn: null }), pouch: null });
  const owner = f.state.members[0];
  assert.ok(owner.completedTasks.includes(goal('000dc1')));
  assert.equal(owner.itemProgress?.[goal('000dc1')], undefined, 'A manual tick never acquires plugin provenance');
  assert.deepEqual(owner.transportFacts, { currencies: { coins: 100 }, items: { 'synthetic-item': 1 } });
});

test('format-1 migration discards untrusted clock fences but retains plugin ownership', () => {
  const keyId = '11111111-1111-4111-8111-111111111111', at = '2026-10-22T12:00:00.000Z';
  const old = { format: 1, keys: { [keyId]: 1 }, players: { a: { keyId, seq: 1, sentAt: '9999-01-01T00:00:00Z', coins: 100, historyAt: null, historyRevision: null } } };
  const migrated = loadPluginCurrency(old);
  assert.equal(migrated.keys[keyId].sentAt, null);
  const state = applyCommand(createGroupState([{ id: 'a', name: 'Synthetic player' }]), { type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 } } });
  const result = observePluginCurrency(state, migrated, { memberId: 'a', keyId, seq: 2, sentAt: at, coins: null }, { now: () => at });
  assert.equal(result.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('portable restores preserve plugin provenance without rolling back replay fences', async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const saved = await f.backup();
  await f.send({ ...items(), pouch: [] });
  await f.restore(saved);
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

for (const manual of [false, true]) test(`frozen-release Undo preserves currency provenance after cache eviction (manual ${manual})`, async t => {
  const f = await fixture(t, { durable: true });
  if (manual) {
    await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 } } });
    await f.send({ ...items(), pouch: [[0, 995, 200, 'Coins']] });
  } else {
    await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
    await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 0 } } });
  }
  const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  const at = new Date(f.at + 1000).toISOString();
  const undone = applyLiveCommand(loadLiveBackup(disk), { type: 'undo' }, { expectedRevision: f.state.revision, now: () => at });
  const [keyId, row] = Object.entries(disk.pluginCurrency.keys)[0];
  const result = observePluginCurrency(importBackup(exportLiveBackup(undone)), { ...disk.pluginCurrency, origins: [] },
    { memberId: 'a', keyId, seq: row.seq + 1, sentAt: at, coins: null }, { now: () => at });
  assert.equal(result.state.members[0].transportFacts?.currencies?.coins, manual ? 100 : undefined);
  assert.deepEqual(loadLiveBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: result.state }), result.state);
});

for (const manual of [false, true]) for (const undo of [false, true]) test(`member restore preserves currency ownership even at an unchanged amount (manual ${manual}, undo ${undo})`, async t => {
  const f = await fixture(t, { durable: true });
  await f.command({ type: 'set-runescape-name', memberId: 'a', name: 'FixtureA' });
  if (manual) await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 } } });
  else await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  const saved = await f.backup();
  if (manual) {
    await f.send({ ...items(), pouch: [[0, 995, 200, 'Coins']] });
    await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  } else await f.command({ type: 'set-transport-facts', memberId: 'a', facts: { currencies: { coins: 100 } } });
  await f.command({ type: 'set-runescape-name', memberId: 'a', name: 'FixtureB' });
  const fences = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).pluginCurrency.keys;
  await f.restoreMember(saved);
  if (undo) await f.command({ type: 'undo' });
  const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(disk.pluginCurrency.keys, fences);
  const expectManual = undo ? !manual : manual;
  assert.equal(disk.pluginCurrency.facts.a.source, expectManual ? 'manual' : 'plugin');
  assert.deepEqual(loadLiveBackup(disk), f.state);
  await f.restart();
  await f.send({ ...items({ backpack: null }), pouch: null });
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, expectManual ? 100 : undefined);
});

for (const unknown of [false, true]) test(`an unreadable report invalidates a plugin balance restored by Undo (unknown ${unknown})`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items(), pouch: [[0, 995, 100, 'Coins']] });
  f.advance(60000);
  await f.send({ ...items({ backpack: unknown ? null : [] }), pouch: unknown ? null : [] });
  await f.command({ type: 'undo' });
  assert.equal(f.state.members[0].transportFacts.currencies.coins, 100);
  await f.send({ ...items({ backpack: null }), pouch: null });
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined, 'Undo did not create a manual fact');
  await f.restart();
  assert.equal(f.state.members[0].transportFacts?.currencies?.coins, undefined);
});

test('bank-only reports never publish cached carried coins after the write interval', async t => {
  const f = await fixture(t, { durable: true });
  const coins = () => f.state.members[0].transportFacts?.currencies?.coins;
  await f.send({ ...items(), pouch: [], backpack: [] });
  await f.send({ ...items({ backpack: [[0, 995, 100, 'Coins']] }), pouch: [] });
  assert.equal(coins(), 100, 'The changed carried total is immediate');
  f.advance(60000);
  for (const rows of [[[995, 5000]], []]) {
    await f.sendBank(bank(1, 1, rows));
    assert.equal(coins(), 100, 'Readable or empty bank reports cannot alter the carried observation');
  }
  await f.restart();
  await f.sendBank(bank(1, 1, [[995, 5000]]));
  await f.send({ ...items({ backpack: null }), pouch: [[0, 995, 200, 'Coins']] });
  await f.send({ ...items({ backpack: [[0, 995, 100, 'Coins']] }), pouch: null });
  assert.equal(coins(), undefined, 'Persisted bank evidence and partial reads cannot establish current currency');
  await f.send({ ...items({ backpack: [[0, 995, 100, 'Coins']] }), pouch: [] });
  assert.equal(coins(), 100, 'A new coherent report can publish after restart');
});

for (const age of [0, 3600]) test(`withdrawing the last bank coins never counts the cached stack twice (age ${age})`, async t => {
  const f = await fixture(t, { durable: true });
  const coins = () => f.state.members[0].transportFacts?.currencies?.coins;
  await f.sendBank(bank(1, 1, [[995, 5000]], { age }));
  // The sender cannot distinguish an empty bank from an unreadable one. It
  // retains the previous nonempty snapshot after the final stack is withdrawn.
  await f.send({ ...items({ backpack: [[0, 995, 2000, 'Coins']] }), pouch: [[0, 995, 3000, 'Coins']] });
  assert.equal(coins(), 5000, 'The stale bank cannot add to current carried coins');
  await f.restart();
  await f.send({ ...items({ backpack: [[0, 995, 2000, 'Coins']] }), pouch: [[0, 995, 3000, 'Coins']] });
  assert.equal(coins(), 5000, 'A persisted bank snapshot cannot become spendable on restart');
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.equal(saved.players.a.bank.coins, 5000, 'Historical bank evidence is retained');
});

// Real durable store: a four-field event must never borrow the delivery world's provenance.
for (const mode of ['lost-beta-ack', 'offline-beta', 'rotated-retained-beta', 'unknown-origin', 'delivered-beta-ack', 'transition-clear', 'direct-beta', 'direct-live']) {
  test(`durable journal environment isolation: ${mode}`, async t => {
    const f = await fixture(t, { durable: true });
    const event = [1, CHAINBODY, 'Synthetic worn item', mode === 'unknown-origin' ? 'unknown' : 'beta'];
    const first = await f.send(items());
    assert.deepEqual(first.items.journal, { id: journalId, event: 0 });
    let pending = ['direct-beta', 'direct-live'].includes(mode) ? [] : [event], id = journalId;
    if (mode === 'offline-beta') await f.send(undefined, true);
    else if (mode === 'unknown-origin') await f.send(undefined, null);
    else {
      const ack = await f.send(items({ worn: [[0, CHAINBODY, 1, 'Synthetic worn item']], events: pending }), true);
      assert.equal(ack.items.journal.event, pending.length);
      if (mode === 'delivered-beta-ack' || mode === 'direct-beta') pending = [];
      assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), false);
    }
    if (mode === 'transition-clear') { pending = []; id = 'bbbbbbbbbbbbbbbb'; }
    if (mode === 'rotated-retained-beta') id = 'bbbbbbbbbbbbbbbb';
    const live = mode === 'direct-live';
    const ack = await f.send(items({ id, events: pending, worn: live ? [[0, CHAINBODY, 1, 'Synthetic worn item']] : [] }));
    assert.equal(ack.items.journal.event, mode === 'delivered-beta-ack' ? 1 : pending.length);
    async function inspect() {
      const state = f.state, member = state.members[0];
      const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).state.members[0];
      const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
      assert.equal(Boolean(record.items[CHAINBODY]?.ownedAt), live);
      assert.equal(Boolean(record.items[CHAINBODY]?.wornAt), live);
      assert.equal(member.completedTasks.includes(goal('000597')), live);
      assert.equal(disk.completedTasks.includes(goal('000597')), live);
      assert.equal(member.completedTasks.includes(WEAR_TASK), false);
      assert.equal(disk.completedTasks.includes(WEAR_TASK), false);
      assert.equal(member.itemProgress?.[goal('000597')]?.evidence ?? null, live ? 'owned' : null);
      const history = state.history.filter(row => row.command?.items?.length);
      assert.deepEqual(history.map(row => row.source), live ? ['game-plugin'] : []);
      const rows = f.review().items ?? [];
      assert.equal(rows.filter(row => row.taskId === WEAR_TASK && row.world === 'live').length, live ? 1 : 0);
    }
    await inspect();
    if (pending.length && !live) assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === (mode === 'unknown-origin' ? 'unknown' : 'beta')), 'Non-live evidence stays available for explicit review');
    await f.restart();
    await f.send(items({ id, events: pending }));
    await inspect();
    assert.deepEqual(f.warnings, []);
  });
}

// Legacy senders cannot establish the observation world of queued events.
for (const delivery of [false, true, null]) test(`legacy catch-up journal keeps unknown provenance on delivery world ${delivery}`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const status = await f.send(items({ events: [[1, CHAINBODY, 'Synthetic worn item']] }), delivery);
  assert.equal(status.items.journal.event, 1);
  const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
  assert.equal(record.items[CHAINBODY], undefined);
  assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), false);
  assert.equal(f.state.members[0].completedTasks.includes(WEAR_TASK), false);
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'));
  await f.send(items());
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'), 'Acknowledged catch-up rows retain their provenance');
  await f.restart();
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'), 'Restart restores acknowledged evidence without retransmission');
  await f.send(items());
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'), 'An empty sender queue cannot erase retained evidence');
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic worn item']] }));
  assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), false, 'A replay after restart cannot promote the event to live');
});

// Unqualified historical names cannot replace current container evidence.
for (const delivery of [false, true]) test(`legacy journal names stay separate from tool belt evidence ${delivery ? 'beta' : 'live'}`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send({ ...items({ events: [[1, RUNE_HATCHET, 'Synthetic reported hatchet name']] }), toolbelt: [['HATCHET_LEVEL', 6]] }, delivery);
  const hatchet = (f.review()?.items ?? []).filter(row => row.gameItemId === RUNE_HATCHET);
  if (delivery) {
    assert.ok(hatchet.length > 0);
    for (const row of hatchet) assert.equal(row.gameName, 'Rune hatchet');
  } else {
    for (const row of hatchet) assert.equal(row.gameName, 'Rune hatchet');
    const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
    assert.equal(record.items[RUNE_HATCHET].name, 'Rune hatchet');
  }
});

// Codex review r1, finding 1: an acknowledged qualified beta event the sender has dropped
// keeps its review rows on later item and bank reports until they are handled.
test('acknowledged qualified journal rows stay in review on later reports', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const status = await f.send(items({ events: [[1, CHAINBODY, 'Synthetic beta item', 'beta']] }));
  assert.equal(status.items.journal.event, 1);
  const beta = () => (f.review()?.items ?? []).filter(row => row.world === 'beta').map(row => row.taskId).sort();
  const expected = [goal('000597'), WEAR_TASK].sort();
  assert.deepEqual(beta(), expected);
  await f.send(items());
  assert.deepEqual(beta(), expected, 'Dropping the acknowledged event keeps its rows');
  await f.sendBank(bank(1, 1, [[YEW_SHORTBOW, 1]]));
  assert.deepEqual(beta(), expected, 'A bank report keeps them too');
  assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), false);
  const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
  assert.equal(record.items[CHAINBODY], undefined, 'Beta evidence never reaches the live sidecar');
  await f.restart();
  assert.deepEqual(beta(), expected, 'Acknowledged beta evidence survives restart without replay');
  await f.send(items());
  assert.deepEqual(beta(), expected);
});

// Codex review r1, finding 2: container reports keep main's single memory slot, so an
// unknown-world report replaces beta memory and the next unreadable beta look waits.
test('beta container memory is replaced by an unknown-world report, as before', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(items({ worn: [[0, CHAINBODY, 1, 'Synthetic worn item']] }), true)).items.journal.event, 0);
  assert.equal((await f.send(items(), null)).items.journal.event, 0);
  const third = await f.send(items({ worn: null, events: [[2, YEW_SHORTBOW, 'Synthetic bow']] }), true);
  assert.equal(third.items.journal.event, 0, 'First readable look still needed; nothing new acknowledged');
  assert.equal((f.review()?.items ?? []).some(row => row.taskId === goal('000597')), false, 'Old beta proposals do not resurface');
});

test('journal observation environments are validated independently of the report world', () => {
  const base = { v: 1, seq: 1, sentAt: '2026-10-22T12:00:00.000Z', position: { x: 1, z: 1, floor: 0 } };
  for (const origin of ['live', 'beta', 'unknown']) assert.doesNotThrow(() => validatePluginReport({ ...base,
    items: items({ events: [[1, CHAINBODY, 'Synthetic item', origin]] }) }));
  for (const tail of [[null], [false], [1], [{}], ['LIVE'], [''], ['live', 'extra']]) {
    assert.throws(() => validatePluginReport({ ...base, items: items({ events: [[1, CHAINBODY, 'Synthetic item', ...tail]] }) }), error => error.status === 400);
  }
});

for (const delivery of [false, true, null]) test(`qualified live journal survives delivery world ${delivery} and reopen`, async t => {
  const f = await fixture(t, { durable: true });
  const value = items({ events: [[1, CHAINBODY, 'Synthetic live item', 'live']] });
  const status = await f.send(value, delivery);
  assert.ok(status.accepts.includes('item-journal-world'));
  assert.equal(status.items.journal.event, 1);
  async function inspect() {
    const member = f.state.members[0];
    const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).state.members[0];
    const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
    assert.ok(record.items[CHAINBODY].ownedAt && record.items[CHAINBODY].wornAt);
    assert.equal(member.completedTasks.includes(goal('000597')), true);
    assert.equal(disk.completedTasks.includes(goal('000597')), true);
    assert.equal(member.completedTasks.includes(WEAR_TASK), false);
    assert.equal(disk.completedTasks.includes(WEAR_TASK), false);
    assert.equal(member.itemProgress[goal('000597')].evidence, 'owned');
    assert.deepEqual(f.state.history.filter(row => row.command?.items?.length).map(row => row.source), ['game-plugin']);
    assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [[WEAR_TASK, 'live']]);
  }
  await inspect();
  await f.send(value, delivery); // Lost reply: retransmission is idempotent.
  await inspect();
  await f.restart();
  await f.send(items());
  await inspect();
});

test('mixed-world journal queues keep separate durable scopes and only live facts reach the live sidecar', async t => {
  const f = await fixture(t, { durable: true });
  const events = [[1, CHAINBODY, 'Synthetic beta item', 'beta'], [2, YEW_SHORTBOW, 'Synthetic live item', 'live'],
    [3, BRONZE_DAGGER, 'Synthetic unknown item', 'unknown']];
  for (let n = 0; n < 2; n++) {
    const status = await f.send(items({ events }));
    assert.equal(status.items.journal.event, 3);
    const record = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a;
    assert.deepEqual(Object.keys(record.items), [String(YEW_SHORTBOW)]);
    assert.deepEqual(f.state.members[0].completedTasks, [goal('000dc1')]);
    assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [
      [goal('000597'), 'beta'], [WEAR_TASK, 'beta'], [goal('0002ae'), 'unknown']]);
  }
  await f.restart();
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [
    [goal('000597'), 'beta'], [WEAR_TASK, 'beta'], [goal('0002ae'), 'unknown']]);
  await f.send(items());
  assert.deepEqual(f.state.history.filter(row => row.command?.items?.length).map(row => row.source), ['game-plugin']);
});

test('live inventory wins over unknown journal proposals, including a failed automatic command', async t => {
  const f = await fixture(t);
  f.failing.command = true;
  await f.send(items({ worn: [[0, CHAINBODY, 1, 'Synthetic live item']], events: [[1, CHAINBODY, 'Synthetic old item', 'unknown']] }));
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [[goal('000597'), 'live'], [WEAR_TASK, 'live']]);
  f.failing.command = false;
  await f.send(items());
  assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), true);
});

test('a failed live sidecar write leaves journal evidence unacknowledged for retry', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const file = path.join(f.dataDir, 'plugin-items.json'), backup = path.join(f.dataDir, 'synthetic-held-items.json');
  await rename(file, backup); await mkdir(file);
  const value = items({ events: [[1, CHAINBODY, 'Synthetic live item', 'live']] });
  const failed = await f.send(value, true);
  assert.equal(failed.items.journal.event, 0);
  assert.deepEqual(f.state.members[0].completedTasks, []);
  await rm(file, { recursive: true }); await rename(backup, file);
  const retried = await f.send(value, true);
  assert.equal(retried.items.journal.event, 1);
  assert.equal(f.state.members[0].completedTasks.includes(goal('000597')), true);
  assert.equal(f.warnings.length, 1);
});

for (const origin of ['legacy', 'beta', 'unknown']) test(`failed durable ${origin} journal write leaves the whole prefix re-deliverable`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const scope = origin === 'legacy' ? 'unknown' : origin;
  const file = path.join(f.dataDir, `plugin-item-journal-${scope}.json`);
  await mkdir(file); // Atomic replacement cannot replace a directory.
  const tail = origin === 'legacy' ? [] : [origin];
  const value = items({ events: [[1, YEW_SHORTBOW, 'Synthetic live bow', 'live'], [2, CHAINBODY, 'Synthetic queued item', ...tail]] });
  const failed = await f.send(value);
  assert.deepEqual(failed.items.journal, { id: journalId, event: 0 }, 'No part of a mixed prefix is acknowledged on failure');
  assert.deepEqual(f.state.members[0].completedTasks, [goal('000dc1')], 'A failed non-live write does not block retained live completions');
  await rm(file, { recursive: true });
  await f.restart();
  const retried = await f.send(value);
  assert.equal(retried.items.journal.event, 2);
  assert.deepEqual(f.state.members[0].completedTasks, [goal('000dc1')], 'Qualified live evidence still ticks exactly once');
  await f.restart();
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === scope));
  await f.send(items());
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === scope));
  assert.equal(f.state.history.filter(row => row.command?.items?.length).length, 1);
  assert.equal(f.warnings.length, 1);
});

test('a later scope write failure retains earlier durable scopes and retries the complete prefix', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(file);
  const value = items({ events: [[1, CHAINBODY, 'Synthetic beta item', 'beta'], [2, YEW_SHORTBOW, 'Synthetic live item', 'live'],
    [3, BRONZE_DAGGER, 'Synthetic unknown item', 'unknown']] });
  assert.equal((await f.send(value)).items.journal.event, 0);
  await rm(file, { recursive: true });
  await f.restart();
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'beta'));
  assert.equal((await f.send(value)).items.journal.event, 3);
  await f.restart();
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [
    [goal('000597'), 'beta'], [WEAR_TASK, 'beta'], [goal('0002ae'), 'unknown']]);
});

test('unmapped journal evidence is durable and a full sidecar refuses acknowledgement without eviction', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic known item'], [2, UNKNOWN, 'Synthetic unmapped item']] }));
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const record = saved.players.a;
  assert.ok(record.items[UNKNOWN].wornAt);
  await f.restart();
  assert.deepEqual(f.review().unmappedItems, [{ gameItemId: UNKNOWN, name: 'Synthetic unmapped item' }]);
  // Seed the bound directly rather than sending hundreds of reports.
  for (let id = 900000; Object.keys(record.items).length < 500; id++) record.items[id] = { ...record.items[UNKNOWN] };
  await writeFile(file, `${JSON.stringify(saved)}\n`);
  await f.restart();
  await f.send(items());
  const value = items({ events: [[3, YEW_SHORTBOW, 'Synthetic overflow item']] });
  assert.equal((await f.send(value)).items.journal.event, 2);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved, 'Failure preserves all existing evidence and its watermark');
  assert.equal((await f.send(value)).items.journal.event, 2, 'Sender can retry the same unacknowledged event');
});

test('a delayed prefix after restart cannot borrow a partially written watermark', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(file);
  const live = [1, YEW_SHORTBOW, 'Synthetic live bow', 'live'];
  assert.equal((await f.send(items({ events: [live, [2, CHAINBODY, 'Synthetic legacy item']] }))).items.journal.event, 0);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.a.journal.event, 2);
  await rm(file, { recursive: true });
  await f.restart();
  // Keep the second event's durable write failing, after the receiver has opened.
  await mkdir(file);
  const delayed = await f.send(items({ events: [live] }));
  assert.equal(delayed.items.journal.event, 0, 'The durable pending prefix still requires event 2');
  assert.match(f.review().itemRetentionIssue, /unacknowledged/);
  await rm(file, { recursive: true });
  const recovered = await f.send(items({ events: [live] }));
  assert.equal(recovered.items.journal.event, 2, 'The pending event itself is recovered before acknowledgement');
  const unknown = JSON.parse(await readFile(file)).players.a;
  assert.ok(unknown.items[CHAINBODY].wornAt);
  await f.restart();
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'));
});

test('a conflicting retry cannot reclassify a durable pending legacy observation as live', async t => {
  const f = await fixture(t, { durable: true });
  const blocked = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(blocked);
  const event = [1, YEW_SHORTBOW, 'Synthetic queued bow'];
  assert.equal((await f.send(items({ events: [event] }))).items.journal.event, 0);
  assert.equal((await f.send(items({ events: [[...event, 'live']], backpack: [[0, BRONZE_DAGGER, 1, 'Synthetic current dagger']] }))).items.journal.event, 0);
  assert.equal(f.state.members[0].completedTasks.includes(goal('000dc1')), false);
  assert.ok(f.state.members[0].completedTasks.includes(goal('0002ae')), 'Current live containers still complete independently');
  await rm(blocked, { recursive: true }); await f.restart();
  assert.equal((await f.send(items())).items.journal.event, 1);
  assert.ok(f.review().items.some(row => row.taskId === goal('000dc1') && row.world === 'unknown'));
});

test('a failed intent write cannot turn scope watermarks into acknowledgements after restart', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic retained item']] }));
  const file = path.join(f.dataDir, 'plugin-item-journal-commits.json'), held = file + '.synthetic-held';
  await rename(file, held); await mkdir(file);
  const live = [2, YEW_SHORTBOW, 'Synthetic live bow', 'live'], legacy = [3, BRONZE_DAGGER, 'Synthetic legacy dagger'];
  assert.equal((await f.send(items({ events: [live, legacy] }))).items.journal.event, 1);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')));
  await rm(file, { recursive: true }); await rename(held, file); await f.restart();
  assert.equal((await f.send(items({ events: [live] }))).items.journal.event, 2, 'The omitted event remains re-deliverable');
  assert.equal((await f.send(items({ events: [legacy] }))).items.journal.event, 3);
  assert.ok(f.review().items.some(row => row.taskId === goal('0002ae') && row.world === 'unknown'));
});

test('failure publishing the committed acknowledgement leaves its durable intent retryable', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic retained item']] }));
  const file = path.join(f.dataDir, 'plugin-item-journal-commits.json'), held = file + '.synthetic-held';
  const ledger = JSON.parse(await readFile(file));
  ledger.players.a.journals[0].pending = [[2, YEW_SHORTBOW, 'Synthetic live bow', 'live']];
  await writeFile(file, JSON.stringify(ledger)); await f.restart();
  // The intent already exists durably, so only the final commit needs a write.
  await rename(file, held); await mkdir(file);
  assert.equal((await f.send(items({ events: [[2, YEW_SHORTBOW, 'Synthetic live bow', 'live']] }))).items.journal.event, 1);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')), 'Live progress is independent of acknowledgement storage');
  await rm(file, { recursive: true }); await rename(held, file);
  await f.restart();
  assert.equal((await f.send(items())).items.journal.event, 2, 'The pending intent survives the failed commit without retransmission');
});

test('a full non-live store keeps its queued evidence and never stalls live completion', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic retained item']] }));
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  const saved = JSON.parse(await readFile(file)), record = saved.players.a;
  for (let id = 900000; Object.keys(record.items).length < 500; id++) record.items[id] = { ...record.items[CHAINBODY], name: 'Synthetic unmapped item' };
  record.handled = Array.from({ length: 2000 }, (_, index) => `synthetic-dismissed-${String(index).padStart(4, '0')}`);
  await writeFile(file, `${JSON.stringify(saved)}\n`); await f.restart();
  const value = items({ events: [[2, BRONZE_DAGGER, 'Synthetic queued legacy item'], [3, YEW_SHORTBOW, 'Synthetic live bow', 'live']] });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await f.send(value)).items.journal.event, 1);
    assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')));
    assert.ok(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.a.handled.includes(goal('000dc1')), 'Non-live dismissal capacity cannot block live handled retention');
    assert.match(f.review().itemRetentionIssue, /500 distinct IDs/);
  }
  await f.send({}, false, 'skills');
  assert.match(f.review().itemRetentionIssue, /500 distinct IDs/, 'Other progress reports preserve the retention warning');
  assert.deepEqual(JSON.parse(await readFile(file)), saved, 'Existing acknowledged evidence is not evicted');
  assert.equal(f.state.history.filter(row => row.command?.items?.length).length, 1);
  // The operator reviews/exports existing evidence and makes room; no queued event is removed.
  delete record.items[900000]; await writeFile(file, `${JSON.stringify(saved)}\n`); await f.restart();
  assert.equal((await f.send(items())).items.journal.event, 3, 'Durable pending evidence recovers even without retransmission');
  assert.ok(JSON.parse(await readFile(file)).players.a.items[BRONZE_DAGGER].wornAt);
  assert.equal(f.review().itemRetentionIssue, null);
});

for (const bound of ['pending-events', 'journal-identities']) test(`a full ${bound} ledger drains retained work before accepting the next suffix`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items());
  const journals = bound === 'pending-events'
    ? [{ id: journalId, committed: 0, pending: Array.from({ length: 256 }, (_, index) => [index + 1, CHAINBODY, 'Synthetic retained item', 'unknown']) }]
    : Array.from({ length: 8 }, (_, index) => ({ id: index.toString(16).padStart(16, '0'), committed: 0,
      pending: [[1, CHAINBODY, 'Synthetic retained item', 'unknown']] }));
  await writeFile(path.join(f.dataDir, 'plugin-item-journal-commits.json'), JSON.stringify({ v: 1, players: { a: { journals } } }));
  await f.restart();
  const id = bound === 'pending-events' ? journalId : 'bbbbbbbbbbbbbbbb', event = bound === 'pending-events' ? 257 : 1;
  const value = items({ id, events: [[event, YEW_SHORTBOW, 'Synthetic queued live bow', 'live']],
    backpack: [[0, BRONZE_DAGGER, 1, 'Synthetic current dagger']] });
  const first = (await f.send(value)).items.journal;
  assert.equal(first?.id === id ? first.event : 0, bound === 'pending-events' ? 256 : 0);
  assert.ok(f.state.members[0].completedTasks.includes(goal('0002ae')));
  assert.equal(f.state.members[0].completedTasks.includes(goal('000dc1')), false);
  assert.ok(f.review().itemRetentionIssue);
  assert.equal((await f.send(value)).items.journal.event, event);
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')));
  assert.equal(f.review().itemRetentionIssue, null);
});

const transferOptions = { dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
  world: { chunks: new Map() }, route: '/api/restore/preview' };

function fullJournalBackup(world, owner = 'a') {
  const at = '2026-10-22T12:00:00.000Z';
  const record = { baselineAt: at, items: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [900000 + i,
    { name: `Synthetic journal item ${i}`, ownedAt: at, wornAt: at, first: true }])), handled: [], journal: { id: 'bbbbbbbbbbbbbbbb', event: 500 } };
  return { format: 'rs3-chunk-picker', schemaVersion: 1,
    state: createGroupState([{ id: 'a', name: 'Explorer 1' }, { id: 'b', name: 'Explorer 2' }]),
    optionalSidecarEvidence: { schemaVersion: 1, entries: { pluginItems: { version: 1, players: {
      [owner]: { records: { [world]: record }, commits: { journals: [{ id: 'bbbbbbbbbbbbbbbb', committed: 500, pending: [] }] } },
    } } } } };
}

for (const world of ['beta', 'unknown']) for (const entrypoint of ['restore', 'transfer', 'source-member', 'retained-member', 'import', 'replacement-preview', 'replacement-commit']) {
  test(`late ${world} evidence cannot invalidate ${entrypoint} publication`, async t => {
    const target = await fixture(t, { durable: true });
    const mapped = ['transfer', 'source-member', 'retained-member'].includes(entrypoint);
    const backup = fullJournalBackup(world, mapped ? 'b' : 'a');
    let body = { backup }, options = transferOptions, prepared;
    if (entrypoint === 'transfer') body.rosterMapping = { a: 'b', b: 'a' };
    if (entrypoint.endsWith('member')) {
      body = { backup, memberId: 'a', sourceMemberId: 'b' };
      options = { ...options, route: '/api/member-restore/preview' };
      if (entrypoint === 'retained-member') {
        const backupId = '0000000000000000-3333333333333333.json.gz';
        await writeFile(path.join(target.dataDir, 'backups', backupId), gzipSync(JSON.stringify(backup)));
        body = { backupId, memberId: 'a', sourceMemberId: 'b' };
      }
    }
    if (entrypoint === 'import') {
      await target.store.replace(backup, target.state.revision);
      body = { document: { maps: { synthetic: { chunks: {} } } },
        members: target.state.members.map(({ id, name }) => ({ id, name, mapId: 'synthetic' })) };
      options = { ...options, route: '/api/import/preview', pickerId: 'legacy' };
    }
    if (entrypoint.startsWith('replacement')) await target.store.previewReplacement(backup);
    else prepared = await target.store.prepareTransfer(serialize(body), options);
    const revision = target.state.revision;
    const event = [1, UNKNOWN, 'Synthetic late journal'];
    if (world === 'beta') event.push('beta');
    const acknowledged = (await target.send(items({ events: [event] }), true)).items.journal.event;
    assert.equal(target.state.revision, revision, 'Non-live journals do not invalidate gameplay revisions');
    const before = await readFile(path.join(target.dataDir, 'state.json'));
    if (entrypoint === 'replacement-preview') {
      await target.store.previewReplacement(backup);
      assert.deepEqual(await readFile(path.join(target.dataDir, 'state.json')), before);
    } else if (entrypoint === 'replacement-commit') await target.store.replace(backup, revision);
    else await target.store.applyTransfer(prepared.ticket, revision);
    await target.restart();
    const result = await target.send(items(), true);
    assert.ok(result.items, 'Optional capacity conflicts cannot prevent later reports');
    assert.ok((await target.store.backup()).state, 'Optional late evidence cannot veto export');

  });
}

for (const world of ['beta', 'unknown']) test(`a ${world} report arriving during publication waits and retains its unacknowledged suffix`, async t => {
  const target = await fixture(t, { durable: true });
  const prepared = await target.store.prepareTransfer(serialize({ backup: fullJournalBackup(world) }), transferOptions);
  let entered, release;
  const atCommit = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  target.failing.onCommit = () => { entered(); return gate; };
  const applying = target.store.applyTransfer(prepared.ticket, target.state.revision);
  let reporting;
  try {
    await Promise.race([atCommit, applying.then(() => { throw new Error('Publication did not reach its barrier'); })]);
    const event = [1, UNKNOWN, 'Synthetic concurrent report item'];
    if (world === 'beta') event.push('beta');
    reporting = target.send(items({ events: [event] }), true);
    await new Promise(resolve => setImmediate(resolve));
  } finally { release(); }
  await applying;
  delete target.failing.onCommit;
  assert.equal((await reporting).items.journal.event, 0);
  assert.match(target.review().itemRetentionIssue, /unacknowledged/);
  assert.equal(Object.keys(target.state.provenance.pluginItemEvidence.players.a.records[world].items).length, 500);
  await target.restart();
  assert.equal((await target.send(items(), true)).items.journal.event, 0);
  const evidence = await exportPluginItemEvidence(target.dataDir);
  assert.ok(evidence.players.a.commits.journals.some(row => row.id === journalId && row.pending[0]?.[1] === UNKNOWN));
});

for (const limit of ['items', 'handled', 'pending']) test(`a report prepared before import cannot exceed the inherited ${limit} limit afterward`, async t => {
  const target = await fixture(t, { durable: true }), backup = fullJournalBackup('unknown');
  const evidence = backup.optionalSidecarEvidence.entries.pluginItems.players.a, at = '2026-10-22T12:00:00.000Z';
  const stale = { baselineAt: at, items: {}, handled: [], journal: null };
  if (limit === 'items') stale.items[UNKNOWN] = { name: 'Synthetic late item', ownedAt: at, wornAt: at, first: true };
  else {
    evidence.records.unknown.items = {};
    if (limit === 'handled') {
      evidence.records.unknown.handled = Array.from({ length: 2000 }, (_, i) => `custom:handled-${String(i).padStart(4, '0')}`);
      stale.handled = ['custom:late-handled'];
    } else evidence.commits = { journals: [{ id: journalId, committed: 0,
      pending: Array.from({ length: 256 }, (_, i) => [i + 1, 900000 + i, 'Synthetic pending item', 'unknown']) }] };
  }
  const records = limit === 'pending'
    ? await openPluginJournalCommits({ dataDir: target.dataDir, members: () => target.state.members,
      inherited: player => target.state.provenance?.pluginItemEvidence?.players[player]?.commits })
    : await openPluginItems({ dataDir: target.dataDir, journalWorld: 'unknown', members: () => target.state.members,
      inherited: player => target.state.provenance?.pluginItemEvidence?.players[player]?.records.unknown });
  t.after(() => records.close());
  await target.store.replace(backup, target.state.revision);
  const before = await readFile(path.join(target.dataDir, 'state.json'));
  await assert.rejects(records.put('a', limit === 'pending' ? { journals: [{ id: journalId, committed: 0,
    pending: [[257, UNKNOWN, 'Synthetic late pending item', 'unknown']] }] } : stale), /Invalid plugin item record|Too many pending/);
  assert.deepEqual(await readFile(path.join(target.dataDir, 'state.json')), before);
  assert.doesNotThrow(() => records.get('a'));
  await target.restart();
  assert.doesNotThrow(() => target.review());
});

test('restoring B keeps A\'s container-only beta review', async t => {
  const target = await fixture(t, { durable: true });
  await target.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic beta container item']] }), true);
  const before = target.review();
  assert.ok(before.items.some(row => row.taskId === WEAR_TASK && row.world === 'beta'));
  const prepared = await target.store.prepareTransfer(serialize({ backup: await target.store.backup(), memberId: 'b', sourceMemberId: 'b' }),
    { ...transferOptions, route: '/api/member-restore/preview' });
  await target.store.applyTransfer(prepared.ticket, target.state.revision);
  const after = target.review();
  assert.deepEqual(after.items, before.items);
});

test('unmapped review dismissal retains the identity and evidence across restart and later reports', async t => {
  const target = await fixture(t, { durable: true });
  await target.send(items({ events: [[1, UNKNOWN, 'Synthetic unmapped journal']] }));
  assert.deepEqual(target.review().unmappedItems, [{ gameItemId: UNKNOWN, name: 'Synthetic unmapped journal' }]);
  await target.controller.finish('a');
  assert.deepEqual(target.review(), { preview: null });
  const retained = await exportPluginItemEvidence(target.dataDir);
  assert.ok(retained.players.a.records.unknown.items[UNKNOWN]);
  assert.ok(retained.players.a.records.unknown.handled.includes(`unmapped:${UNKNOWN}`));
  await target.restart();
  await target.send(items());
  assert.deepEqual(target.review(), { preview: null });
});

for (const world of ['unknown', 'beta']) for (const boundary of ['restart', 'restore', 'transfer', 'member']) test(`reviewed ${world} capacity recovery survives ${boundary} without refilling archives`, async t => {
  const target = await fixture(t, { durable: true });
  await target.restore(fullJournalBackup(world));
  await target.controller.close(); await target.store.close();
  const file = path.join(target.dataDir, 'state.json'), saved = JSON.parse(await readFile(file));
  assert.equal(saved.state.provenance.pluginItemEvidenceReconciled, 1);
  assert.ok(saved.state.provenance.restore.incomingProvenance.pluginItemEvidence.players.a.records[world].items[900000]);
  delete saved.state.provenance.pluginItemEvidence.players.a.records[world].items[900000];
  await writeFile(file, JSON.stringify(saved));
  await target.restart();
  if (boundary === 'restore') await target.restore(await target.backup());
  if (boundary === 'transfer') await target.transfer(await target.backup());
  if (boundary === 'member') await target.restoreMember(await target.backup());
  await target.restart();
  const retained = await exportPluginItemEvidence(target.dataDir);
  assert.equal(retained.players.a.records[world].items[900000], undefined);
  assert.equal(Object.keys(retained.players.a.records[world].items).length, 499);
  const event = [501, UNKNOWN, 'Synthetic freed-capacity item'];
  if (world === 'beta') event.push('beta');
  assert.equal((await target.send(items({ id: 'bbbbbbbbbbbbbbbb', events: [event] }))).items.journal.event, 501);
});

test('opening an unsealed imported archive durably seals it before later operator cleanup', async t => {
  const target = await fixture(t, { durable: true });
  await target.restore(fullJournalBackup('unknown'));
  await target.controller.close(); await target.store.close();
  const file = path.join(target.dataDir, 'state.json'), saved = JSON.parse(await readFile(file));
  delete saved.state.provenance.pluginItemEvidenceReconciled;
  await writeFile(file, JSON.stringify(saved));
  const revision = saved.state.revision;
  await target.restart();
  assert.equal(target.state.revision, revision, 'Archive retention is independent of gameplay');
  const sealed = JSON.parse(await readFile(file));
  assert.equal(sealed.state.provenance.pluginItemEvidenceReconciled, 1);
  await target.controller.close(); await target.store.close();
  delete sealed.state.provenance.pluginItemEvidence.players.a.records.unknown.items[900000];
  await writeFile(file, JSON.stringify(sealed));
  await target.restart();
  assert.equal((await exportPluginItemEvidence(target.dataDir)).players.a.records.unknown.items[900000], undefined);
});

for (const world of ['unknown', 'beta']) for (const boundary of ['restart', 'restore', 'transfer', 'member']) test(`retained ${world} journal dismissals survive ${boundary}`, async t => {
  const source = await fixture(t, { durable: true });
  const events = [[1, CHAINBODY, 'Synthetic dismissed journal']];
  if (world === 'beta') for (const event of events) event.push('beta');
  await source.send(items({ events }));
  await source.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic corroborating live item']] }));
  assert.ok(source.review().items.length, 'Open the review before dismissing its shown rows');
  await source.controller.finish('a');
  const target = boundary === 'restart' ? source : await fixture(t, { durable: true });
  if (boundary === 'restore') await target.restore(await source.backup());
  if (boundary === 'transfer') await target.transfer(await source.backup());
  if (boundary === 'member') await target.restoreMember(await source.backup());
  await target.restart();
  assert.deepEqual(target.review(), { preview: null });
  const retained = await exportPluginItemEvidence(target.dataDir);
  assert.ok(retained.players.a.records[world].items[CHAINBODY]);
  assert.ok(retained.players.a.records[world].handled.includes(WEAR_TASK));
});

test('non-live container-only decisions persist without copying facts into live evidence', async t => {
  const source = await fixture(t, { durable: true });
  await source.send(items({ events: [[1, BRONZE_DAGGER, 'Synthetic retained dagger']] }));
  const containers = items({ worn: [[4, CHAINBODY, 1, 'Synthetic container-only item']] });
  await source.send(containers, true);
  assert.ok(source.review().items.some(row => row.taskId === WEAR_TASK));
  await source.controller.finish('a');
  await source.restart();
  await source.send(containers, true);
  assert.deepEqual(source.review(), { preview: null });
  const live = (await exportPluginItemEvidence(source.dataDir)).players.a.records.live;
  assert.equal(live?.items[CHAINBODY], undefined);
  assert.ok((await exportPluginItemEvidence(source.dataDir)).players.a.records.beta.handled.includes(WEAR_TASK));
  assert.equal((await exportPluginItemEvidence(source.dataDir)).players.a.records.unknown.handled.includes(WEAR_TASK), false);
});

for (const action of ['dismiss', 'apply', 'skip']) test(`explicit ${action} handles a displayed live task in every supporting retained world`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic unknown duplicate'], [2, CHAINBODY_NOTED, 'Synthetic beta duplicate', 'beta']] }));
  // The beta noted item supports Obtain; use its worn unnoted counterpart too.
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live duplicate']], events: [[3, CHAINBODY, 'Synthetic beta worn duplicate', 'beta']] }));
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'live'));
  if (action === 'dismiss') await f.controller.finish('a');
  else await f.apply(action === 'apply' ? [WEAR_TASK] : []);
  const retained = await exportPluginItemEvidence(f.dataDir);
  for (const world of ['live', 'beta', 'unknown']) assert.ok(retained.players.a.records[world].handled.includes(WEAR_TASK), world);
  if (action === 'apply') await f.command({ type: 'undo' });
  await f.restart();
  assert.equal(f.review().items?.some(row => row.taskId === WEAR_TASK) ?? false, false, 'A different world cannot re-offer the dismissed task');
});

async function itemEvidenceBytes(dataDir) {
  return Object.fromEntries(await Promise.all(['state.json', 'plugin-items.json', 'plugin-item-journal-beta.json',
    'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json'].map(async name => {
    try { return [name, await readFile(path.join(dataDir, name), 'utf8')]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return [name, null]; }
  })));
}

for (const action of ['dismiss', 'apply']) test(`a full scope refuses explicit ${action} without partially publishing another scope or gameplay`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, BRONZE_DAGGER, 'Synthetic beta dagger', 'beta'], [2, CHAINBODY, 'Synthetic unknown worn item']] }));
  await f.controller.close(); await f.store.close();
  const file = path.join(f.dataDir, 'plugin-item-journal-unknown.json'), unknown = JSON.parse(await readFile(file));
  unknown.players.a.handled = Array.from({ length: 2000 }, (_, index) => `synthetic-${String(index).padStart(4, '0')}`);
  await writeFile(file, JSON.stringify(unknown)); await f.restart();
  const review = f.review(), before = await itemEvidenceBytes(f.dataDir), state = f.state;
  assert.ok(review.items.some(row => row.taskId === goal('0002ae') && row.world === 'beta'));
  const attempt = () => action === 'apply' ? f.apply([goal('0002ae')]) : f.controller.finish('a');
  await assert.rejects(attempt(), error => error.status === 422 && /unknown-world.*2,000 handled IDs/.test(error.message) && /Nothing was applied or dismissed/.test(error.message));
  assert.deepEqual(f.state, state);
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before, 'Refusal leaves the state and every scope byte-for-byte unchanged');
  assert.equal(f.review().previewId, review.previewId, 'The same review remains available');
  await f.restart();
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), review.items.map(row => [row.taskId, row.world]));
});

for (const action of ['dismiss', 'apply']) test(`failed atomic review ${action} keeps every scope and gameplay retryable across restart`, async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, BRONZE_DAGGER, 'Synthetic beta dagger', 'beta'], [2, CHAINBODY, 'Synthetic unknown worn item']] }));
  f.failing.onCommit = ({ operation }) => { if (operation === 'command') throw new Error('Synthetic automatic tick failure'); };
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic corroborating live item']], backpack: [[0, BRONZE_DAGGER, 1, 'Synthetic live dagger']] }));
  f.failing.onCommit = undefined;
  const review = f.review(), before = await itemEvidenceBytes(f.dataDir), state = f.state;
  f.failing.publication = true;
  await assert.rejects(action === 'apply' ? f.apply([goal('0002ae')]) : f.controller.finish('a'), /Synthetic publication failure/);
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before);
  assert.deepEqual(f.state, state);
  assert.equal(f.review().previewId, review.previewId);
  f.failing.publication = false; await f.restart();
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]).sort(), review.items.map(row => [row.taskId, row.world]).sort());
  let publications = 0;
  f.failing.onCommit = () => { publications++; };
  if (action === 'apply') await f.apply([goal('0002ae')]);
  else await f.controller.finish('a');
  assert.equal(publications, 1, 'The decision and any selected gameplay have one publication point');
  await f.restart();
  assert.deepEqual(f.review(), { preview: null });
  const retained = await exportPluginItemEvidence(f.dataDir);
  assert.ok(retained.players.a.records.beta.handled.includes(goal('0002ae')));
  assert.ok(retained.players.a.records.unknown.handled.includes(WEAR_TASK));
  assert.equal(f.state.members[0].completedTasks.includes(goal('0002ae')), action === 'apply');
});

test('a late supporting scope is validated before an explicit decision publishes', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ events: [[1, CHAINBODY, 'Synthetic retained Wear evidence']] }));
  const review = f.review();
  // Another admitted sidecar writer can finish after review preparation without
  // advancing gameplay. The transaction must capture its current bounded union.
  const beta = await openPluginItems({ dataDir: f.dataDir, journalWorld: 'beta', members: () => f.state.members });
  const record = (await exportPluginItemEvidence(f.dataDir)).players.a.records.unknown;
  record.handled = Array.from({ length: 2000 }, (_, index) => `synthetic-${String(index).padStart(4, '0')}`);
  try { await beta.put('a', record); } finally { await beta.close(); }
  const before = await itemEvidenceBytes(f.dataDir);
  await assert.rejects(f.controller.finish('a'), error => error.status === 422 && /beta.*2,000 handled IDs/.test(error.message));
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before);
  assert.equal(f.review().previewId, review.previewId);
});

test('a same-revision dismissal invalidates an import prepared before the decision', async t => {
  const f = await fixture(t, { durable: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live Wear evidence']], events: [[1, CHAINBODY, 'Synthetic retained Wear evidence']] }));
  const prepared = await f.store.prepareTransfer(serialize({ backup: await f.backup() }), transferOptions);
  const revision = f.state.revision;
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK));
  await f.controller.finish('a');
  assert.equal(f.state.revision, revision, 'A dismissal does not invent gameplay');
  const before = await itemEvidenceBytes(f.dataDir);
  await assert.rejects(f.store.applyTransfer(prepared.ticket, revision), error => error.importConflict === true);
  assert.deepEqual(await itemEvidenceBytes(f.dataDir), before);
  await f.restart();
  assert.deepEqual(f.review(), { preview: null });
});

for (const action of ['dismiss', 'apply']) test(`explicit ${action} also handles durable pending journal support before its scope is written`, async t => {
  const f = await fixture(t, { durable: true });
  const blocked = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(blocked);
  const response = await f.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic live worn item']],
    events: [[1, CHAINBODY, 'Synthetic queued unknown item']] }));
  assert.equal(response.items.journal.event, 0);
  assert.ok(f.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'live'));
  await rm(blocked, { recursive: true }); // Repair the failed path without draining the pending event yet.
  if (action === 'apply') await f.apply([WEAR_TASK]);
  else await f.controller.finish('a');
  const retained = await exportPluginItemEvidence(f.dataDir);
  assert.deepEqual(retained.players.a.records.unknown.items, {}, 'A decision does not manufacture its supporting journal fact');
  assert.ok(retained.players.a.records.unknown.handled.includes(WEAR_TASK));
  assert.equal(retained.players.a.commits.journals[0].pending.length, 1);
  if (action === 'apply') await f.command({ type: 'undo' });
  await f.restart();
  assert.equal((await f.send(items())).items.journal.event, 1, 'The retained pending event drains without retransmission');
  await f.restart();
  assert.deepEqual(f.review(), { preview: null });
  assert.ok((await exportPluginItemEvidence(f.dataDir)).players.a.records.unknown.items[CHAINBODY].wornAt);
});

for (const entrypoint of ['portable-restore', 'portable-transfer', 'source-member', 'retained-member']) test(`acknowledged journals survive ${entrypoint} with destination ownership`, async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  await source.send(items({ events: [[1, CHAINBODY, 'Synthetic legacy item'], [2, BRONZE_DAGGER, 'Synthetic beta item', 'beta'],
    [3, YEW_SHORTBOW, 'Synthetic live bow', 'live'], [4, UNKNOWN, 'Synthetic unmapped item']] }));
  const exported = JSON.parse((await source.store.exportBackup()).bytes.toString());
  assert.deepEqual(Object.keys(exported.optionalSidecarEvidence).sort(), ['entries', 'schemaVersion']);
  assert.equal(exported.optionalSidecarEvidence.schemaVersion, 1);
  assert.deepEqual(Object.keys(exported.optionalSidecarEvidence.entries.pluginItems).sort(), ['players', 'version']);
  assert.equal(exported.optionalSidecarEvidence.entries.pluginItems.version, 1);
  assert.equal(exported.optionalSidecarEvidence.entries.pluginItems.players.a.commits.journals[0].committed, 4);
  let owner = 'a';
  if (entrypoint === 'portable-restore') await target.store.replace(exported, target.state.revision);
  else {
    let body, options = transferOptions;
    if (entrypoint === 'portable-transfer') { owner = 'b'; body = { backup: exported, rosterMapping: { a: 'b', b: 'a' } }; }
    else {
      owner = 'b'; options = { ...options, route: '/api/member-restore/preview' };
      body = { backup: exported, memberId: 'b', sourceMemberId: 'a' };
      if (entrypoint === 'retained-member') {
        const id = '0000000000000001-1111111111111111.json.gz';
        await writeFile(path.join(target.dataDir, 'backups', id), gzipSync(JSON.stringify(exported)));
        body = { backupId: id, memberId: 'b', sourceMemberId: 'a' };
      }
    }
    const prepared = await target.store.prepareTransfer(serialize(body), options);
    await target.store.applyTransfer(prepared.ticket, target.state.revision);
  }
  const evidence = target.state.provenance.pluginItemEvidence;
  assert.ok(evidence.players[owner].records.unknown.items[CHAINBODY].wornAt);
  assert.ok(evidence.players[owner].records.beta.items[BRONZE_DAGGER].wornAt);
  if (owner === 'b') assert.equal(evidence.players.a, undefined, 'Source IDs cannot leak into the destination roster');
  const revision = target.state.revision, history = structuredClone(target.state.history);
  const immediate = target.controller.review(identity, owner).items;
  assert.ok(immediate.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'), 'Imported legacy journals are visible without a restart or report');
  assert.ok(immediate.some(row => row.taskId === goal('0002ae') && row.world === 'beta'));
  assert.equal(target.state.revision, revision);
  assert.deepEqual(target.state.history, history, 'Rebuilding retained review never issues completion commands');
  await target.restart();
  const rows = target.controller.review(identity, owner).items;
  assert.ok(rows.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'));
  assert.ok(rows.some(row => row.taskId === goal('0002ae') && row.world === 'beta'));
  const roundTrip = await target.store.backup();
  assert.equal(roundTrip.optionalSidecarEvidence.entries.pluginItems.players[owner].commits.journals[0].committed, 4);
});

for (const retained of [false, true]) test(`restoring only B preserves A's dismissed acknowledged legacy journal (retained ${retained})`, async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  assert.equal((await target.send(items({ events: [[1, CHAINBODY, 'Synthetic dismissed legacy item']] }))).items.journal.event, 1);
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'));
  await target.send(items({ worn: [[4, CHAINBODY, 1, 'Synthetic corroborating live item']] }));
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'live'));
  await target.controller.finish('a');
  assert.deepEqual(target.review(), { preview: null });
  const beforeA = structuredClone(target.state.members.find(row => row.id === 'a'));
  await source.send(items({ events: [[1, BRONZE_DAGGER, 'Synthetic imported legacy item']] }));
  const backup = await source.store.backup();
  let body = { backup, memberId: 'b', sourceMemberId: 'a' };
  if (retained) {
    const backupId = `${String(backup.state.revision).padStart(16, '0')}-2222222222222222.json.gz`;
    await writeFile(path.join(target.dataDir, 'backups', backupId), gzipSync(JSON.stringify(backup)));
    body = { backupId, memberId: 'b', sourceMemberId: 'a' };
  }
  const prepared = await target.store.prepareTransfer(serialize(body), { ...transferOptions, route: '/api/member-restore/preview' });
  await target.store.applyTransfer(prepared.ticket, target.state.revision);
  assert.deepEqual(target.state.members.find(row => row.id === 'a'), beforeA);
  assert.deepEqual(target.review(), { preview: null }, 'Refreshing B must not re-offer A\'s dismissed rows');
  assert.ok(target.controller.review(identity, 'b').items.some(row => row.taskId === goal('0002ae') && row.world === 'unknown'), 'B still receives the imported review immediately');
  assert.equal((await target.send(items())).items.journal.event, 1);
  assert.deepEqual(target.review(), { preview: null }, 'A\'s dismissal also survives subsequent reports');
});

test('portable recovery carries an unresolved prefix and drains it without retransmission', async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  const blocked = path.join(source.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(blocked);
  assert.equal((await source.send(items({ events: [[1, YEW_SHORTBOW, 'Synthetic live bow', 'live'],
    [2, CHAINBODY, 'Synthetic queued legacy item']] }))).items.journal.event, 0);
  await rm(blocked, { recursive: true });
  const backup = await source.store.backup();
  const ledger = backup.optionalSidecarEvidence.entries.pluginItems.players.a.commits.journals[0];
  assert.equal(ledger.committed, 0); assert.equal(ledger.pending.length, 2);
  await target.store.replace(backup, target.state.revision); await target.restart();
  assert.match(target.review().itemRetentionIssue, /unacknowledged/);
  assert.equal((await target.send(items())).items.journal.event, 2);
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === 'unknown'));
  assert.equal(target.review().itemRetentionIssue, null);
});

test('invalid optional evidence permits preview while a failed gameplay publication leaves the destination unchanged', async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  await source.send(items({ events: [[1, CHAINBODY, 'Synthetic journal item']] }));
  const backup = await source.store.backup(), before = await readFile(path.join(target.dataDir, 'state.json'));
  const invalid = structuredClone(backup);
  invalid.optionalSidecarEvidence.entries.pluginItems.players.a.records.unknown.items[CHAINBODY].wornAt = 'invalid';
  assert.ok((await target.store.prepareTransfer(serialize({ backup: invalid }), transferOptions)).ticket);
  for (const field of ['records', 'commits', 'pluginItems']) {
    const malformed = structuredClone(backup);
    if (field === 'pluginItems') malformed.optionalSidecarEvidence.entries.pluginItems = null;
    else if (field === 'records') malformed.optionalSidecarEvidence.entries.pluginItems.players.a.records.unknown = null;
    else malformed.optionalSidecarEvidence.entries.pluginItems.players.a.commits = null;
    const evidence = malformed.optionalSidecarEvidence.entries.pluginItems;
    const state = validateState({ ...source.state, provenance: { pluginItemEvidence: evidence && { v: 1, players: evidence.players } } });
    assert.deepEqual(state.members, source.state.members, 'Optional corruption must not invalidate gameplay');
  }
  const prepared = await target.store.prepareTransfer(serialize({ backup }), transferOptions);
  target.failing.publication = true;
  await assert.rejects(target.store.applyTransfer(prepared.ticket, target.state.revision), /Synthetic publication failure/);
  assert.deepEqual(await readFile(path.join(target.dataDir, 'state.json')), before);
  assert.equal(target.state.provenance?.pluginItemEvidence, undefined);
  assert.deepEqual(target.review(), { preview: null }, 'A failed import cannot publish review projections');
  await assert.rejects(readFile(path.join(target.dataDir, 'plugin-item-journal-unknown.json')), { code: 'ENOENT' });
});

for (const world of ['live', 'beta', 'unknown']) test(`concurrent ${world} journal export retains acknowledged evidence through restore and restart`, async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  await source.send(items());
  const scope = world === 'live' ? 'plugin-items.json' : `plugin-item-journal-${world}.json`;
  if (world !== 'live') await writeFile(path.join(source.dataDir, scope), JSON.stringify({ v: 1, players: {} }));
  await writeFile(path.join(source.dataDir, 'plugin-item-journal-commits.json'), JSON.stringify({ v: 1, players: { a: {
    journals: [{ id: journalId, committed: 0, pending: [[1, CHAINBODY, 'Synthetic concurrent item', world]] }],
  } } }));
  await source.restart();
  const backup = await source.store.backup();
  let interrupted = false, scopeReads = 0;
  backup.optionalSidecarEvidence.entries.pluginItems = { version: 1, players: (await exportPluginItemEvidence(source.dataDir, id => id, undefined, {
    read: async file => {
      const bytes = await readFile(file);
      if (path.basename(file) === scope) {
        scopeReads++;
        if (!interrupted) {
          interrupted = true;
          assert.equal((await source.send(items())).items.journal.event, 1, 'Publish the scope and committed ledger after reading the old scope');
        }
      }
      return bytes;
    },
  })).players };
  assert.ok(scopeReads >= 2, 'A changed generation forces a fresh capture of every scope');
  assert.ok(backup.optionalSidecarEvidence.entries.pluginItems.players.a.records[world].items[CHAINBODY].wornAt);
  await target.store.replace(backup, target.state.revision);
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === world));
  assert.deepEqual(target.state.members[0].completedTasks, [], 'Importing live evidence never completes a task');
  await target.restart();
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === world));
  assert.equal((await target.send(items())).items.journal.event, 1);
  assert.ok(target.review().items.some(row => row.taskId === WEAR_TASK && row.world === world), 'An empty report cannot erase the evidence behind its acknowledgement');
});

for (const storage of ['inline', 'static']) test(`export retries concurrent ${storage} inherited evidence publication instead of using a worker stale state`, async t => {
  const source = await fixture(t, { durable: true }), target = await fixture(t, { durable: true });
  await source.send(items({ events: [[1, CHAINBODY, 'Synthetic inherited item']] }));
  const backup = await source.store.backup();
  if (storage === 'static') backup.state.provenance = { ...backup.state.provenance, syntheticPadding: 'x'.repeat(270000) };
  let imported = false, reads = 0;
  const evidence = await exportPluginItemEvidence(target.dataDir, id => id, target.state.provenance?.pluginItemEvidence, {
    read: async file => {
      const bytes = await readFile(file);
      if (path.basename(file) === 'state.json') {
        reads++;
        if (!imported) { imported = true; await target.store.replace(backup, target.state.revision); }
      }
      return bytes;
    },
  });
  assert.ok(reads >= 2);
  if (storage === 'static') assert.ok(JSON.parse(await readFile(path.join(target.dataDir, 'state.json'))).storage.fields.provenance);
  assert.equal(evidence.players.a.commits.journals[0].committed, 1);
  assert.ok(evidence.players.a.records.unknown.items[CHAINBODY].wornAt);
});
