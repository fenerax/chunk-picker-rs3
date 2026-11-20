// Explicit tiny logic checks, deliberately outside the default CI inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parse, plan, stages, actionAt } from './config.mjs';
import { Histogram, phaseMetrics, gates } from './metrics.mjs';
import { arrivals, dispatch } from '../capacity/scheduler.mjs';
import { schedule, dispatchSchedule } from './schedule.mjs';
import { journalFor, reportPacket, observeAck } from './plugin.mjs';
import { noteEvent, phaseClients, population, switchTarget, pruneAcknowledgementObservers } from './driver.mjs';
import { audit } from './fixture.mjs';
import { scopedCgroup } from './resources.mjs';
import { validatePluginReport } from '../../../app/integrations/game-plugin.mjs';

test('seed, roster, multichar allocation, exact action mix and runtime sweeps', () => {
  const c = parse([]), p = plan(c);
  assert.deepEqual(plan(c), p); assert.notEqual(plan({ ...c, seed: 'other' }).digest, p.digest);
  assert.equal(p.logins, 150); assert.ok(p.seats > p.logins);
  const counts = p.groups.flatMap(g => g.members).reduce((map, m) => map.set(m.login, (map.get(m.login) ?? 0) + 1), new Map());
  assert.ok([...counts.values()].includes(3));
  assert.ok(p.groups.some(g => new Set(g.members.map(m => m.login)).size < g.members.length));
  assert.deepEqual(new Set(p.groups.map(g => g.size)), new Set([1, 2, 3, 4, 5]));
  assert.equal(p.groups.filter(g => g.grown).length, 37);
  const mix = {};
  for (let i = 0; i < 60; i++) { const kind = actionAt(i, c.seed); mix[kind] = (mix[kind] ?? 0) + 1; }
  assert.deepEqual(mix, { ...mix, read: 30, filter: 12, edit: 9, switch: 3, expensive: 5, lifecycle: 1 });
  const changed = parse(['--max-open-contexts', '128', '--streams-global', '512', '--cold-global', '4']);
  assert.equal(changed.limits.streamsGlobal, 512); assert.equal(changed.limits.coldStartsGlobal, 4);
  assert.equal(parse(['--limits-json', '{"maxWaitersPerJob":32}']).limits.maxWaitersPerJob, 32);
  assert.equal(parse(['--admission-json', '{"maxRetries":1200}']).admission.maxRetries, 1200);
  assert.throws(() => parse(['--limits-json', '{"unknown":32}']));
  assert.equal(stages(c, 150).at(-1).actions, 15);
  assert.throws(() => parse(['--phases', 'bogus'])); assert.throws(() => parse(['--snapshots', '1001']));
});
test('soak schedule is lazy, preserves per-login checks and keeps dispatch independent', async () => {
  const c = parse(['--smoke', '--seconds', '86400', '--ramp-seconds', '0']);
  const phases = stages(c, 14), cohort = Array.from({ length: 14 }, (_, login) => ({ login }));
  const stream = schedule(c, phases, [cohort], 10);
  const first = stream.next().value; assert.equal(first.kind, 'phase');
  const firstWindow = [];
  for (let i = 0; i < 200; i++) firstWindow.push(stream.next().value);
  assert.ok(firstWindow.every(event => event.atMs < 30000));
  let clock = 0, drops = 0, release;
  await dispatchSchedule([{ atMs: 0 }, { atMs: 1 }, { atMs: 2 }], () => new Promise(resolve => { release = resolve; }), {
    startAt: 0, maxInFlight: 1, now: () => clock, sleep: async ms => { clock += ms; },
    onDrop: event => { drops++; assert.equal(event.scheduledAt, drops); if (drops === 2) release(); },
  });
  assert.equal(drops, 2);
});
test('every default headroom login has an eligible switch target, including expanded groups', () => {
  const c = parse(['--groups', '50', '--phases', 'headroom']), p = plan(c);
  const fixture = { groups: p.groups, clients: p.groups.flatMap(group => group.members.map((member, i) => ({
    ...member, group: group.index, characterId: `synthetic-character-${group.index}-${i}`,
  }))) };
  // Special control groups must never become product switch targets.
  for (const flag of ['nearLimit', 'lifecycle']) {
    const group = fixture.groups.length;
    fixture.groups.push({ index: group, [flag]: true });
    fixture.clients.push({ login: 0, group, characterId: `synthetic-${flag}` });
  }
  const nominal = phaseClients(fixture, c.groups, 'steady');
  const expanded = phaseClients(fixture, c.groups, 'headroom'), cohort = population(expanded).slice(0, 200);
  assert.equal(cohort.length, 200);
  assert.equal(cohort.filter(client => !nominal.some(m => m.login === client.login)).length, 35);
  for (const client of cohort) {
    const choices = expanded.filter(m => m.login === client.login);
    for (let ordinal = 0; ordinal <= choices.length; ordinal++) {
      const selected = switchTarget(fixture, c.groups, 'headroom', client, ordinal);
      assert.ok(selected.characterId); assert.equal(selected.login, client.login);
      assert.equal(selected, choices[ordinal % choices.length]);
      assert.ok(!fixture.groups[selected.group].nearLimit && !fixture.groups[selected.group].lifecycle);
    }
  }
  for (const client of population(nominal)) assert.ok(switchTarget(fixture, c.groups, 'steady', client, 100).group < c.groups);
});
test('resource capacity clamps affinity and every ancestor quota using injected readers', async () => {
  const base = '/sys/fs/cgroup/synthetic/trial', files = new Map([
    ['/proc/self/cgroup', ['0', '', '/synthetic/trial'].join(':') + '\n'],
    [`${base}/cpu.max`, '600000 100000'], ['/sys/fs/cgroup/synthetic/cpu.max', '400000 100000'],
    ['/sys/fs/cgroup/cpu.max', 'max 100000'],
    [`${base}/memory.max`, '8000'], ['/sys/fs/cgroup/synthetic/memory.max', '6000'], ['/sys/fs/cgroup/memory.max', 'max'],
  ]);
  const read = async file => { if (!files.has(file)) throw new Error('Missing synthetic cgroup file.'); return files.get(file); };
  const options = { platform: 'linux', read, parallelism: () => 2, logicalCpus: () => 16, memory: () => 16000 };
  const limited = await scopedCgroup(options);
  assert.equal(limited.affinityCpuCores, 2); assert.equal(limited.effectiveCpuCores, 2);
  assert.equal(limited.effectiveMemoryBytes, 6000);
  assert.equal((await scopedCgroup({ ...options, parallelism: () => 8 })).effectiveCpuCores, 4);
  files.set('/sys/fs/cgroup/cpu.max', '150000 100000');
  assert.equal((await scopedCgroup(options)).effectiveCpuCores, 1.5);
});
test('percentile bounds and incomplete evidence never claims acceptance', () => {
  const h = new Histogram(); for (let i = 1; i <= 100; i++) h.add(i);
  assert.equal(h.json().count, 100); assert.ok(h.json().p95Ms >= 95 && h.json().p95Ms < 96);
  const g = gates({ steady: phaseMetrics() }, [], { passed: true }, 0, { logicalCpus: 1, physicalRAMBytes: 1e9 }, parse([]));
  assert.equal(g.phases.steady.resourceHeadroom, 'unmeasured'); assert.equal(g.acceptance, 'unproven');
});
test('failed cold readiness reads fail the cold gate even when quick', () => {
  const row = phaseMetrics(), fast = new Histogram(); fast.add(100); row.operations['cold:readiness'] = fast;
  const hardware = { logicalCpus: 1, physicalRAMBytes: 1e9 };
  assert.equal(gates({ cold: row }, [], { passed: true }, 0, hardware, parse([])).phases.cold.cold, 'pass');
  row.coldReadinessFailures = 50;
  assert.equal(gates({ cold: row }, [], { passed: true }, 0, hardware, parse([])).phases.cold.cold, 'fail');
});
test('shrinking headroom or extra-tab cohorts cannot turn undelivered acknowledgements into a pass', () => {
  for (const [phase, removed] of [['headroom', 'expanded:0'], ['extra-tabs', 'observer:1']]) {
    const metrics = { [phase]: phaseMetrics(), steady: phaseMetrics() }, acknowledgements = new Map([
      ['synthetic-picker:1', { at: 10, phase, receivers: [removed] }],
      ['synthetic-picker:2', { at: 10, phase, receivers: [removed, 'observer:0'] }],
    ]);
    pruneAcknowledgementObservers(acknowledgements, new Set(['observer:0']), metrics);
    assert.equal(acknowledgements.has('synthetic-picker:1'), false);
    assert.deepEqual(acknowledgements.get('synthetic-picker:2').receivers, ['observer:0']);
    assert.equal(metrics[phase].unobservedAcknowledgements, 1);
    assert.equal(metrics[phase].propagation.count, 0);
    noteEvent({ client: { pickerId: 'synthetic-picker', characterId: 'observer' }, id: 'revision',
      value: { revision: 2, _trialOrigin: 'synthetic-picker' }, receivedAt: 20, phase: 'steady',
      isolation: [], seenEvents: new Map(), acknowledgements, metrics, maxSeenEvents: 8 });
    assert.equal(acknowledgements.size, 0); assert.equal(metrics[phase].propagation.count, 1);
    assert.equal(gates(metrics, [], { passed: true, acknowledgedWrites: 2 }, 0, {}, parse([])).isolationAndDurability, 'fail');
  }
});
test('overload verdict requires delivered scheduled traffic and rejects generator drops', () => {
  const verdict = row => gates({ overload: row }, [], { passed: true }, 0, {}, parse([])).phases.overload.overloadRefusals;
  const row = Object.assign(phaseMetrics(), { offered: 100, drops: 100 });
  assert.equal(verdict(row), 'fail');
  Object.assign(row, { dispatched: 99, completed: 99, drops: 1, requests: 125 });
  assert.equal(verdict(row), 'fail');
  row.drops = 0;
  assert.equal(verdict(row), 'unmeasured');
  Object.assign(row, { dispatched: 100, completed: 99 });
  assert.equal(verdict(row), 'unmeasured');
  row.completed = 100; row.refusals = 25;
  assert.equal(verdict(row), 'pass'); // Bounded HTTP refusals with Retry-After are allowed.
  row.missingRetryAfter = 1; assert.equal(verdict(row), 'fail');
  row.missingRetryAfter = 0; row.requests = 0; assert.equal(verdict(row), 'unmeasured');
  assert.equal(verdict(phaseMetrics()), 'unmeasured');
});
test('audit fails missing or inactive fixture groups while exempting separately deleted lifecycle groups', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'beta-audit-self-check-'));
  const registry = path.join(root, 'registry', 'registry.json'), ledger = path.join(root, 'ledger', 'ledger.json');
  await mkdir(path.dirname(registry)); await mkdir(path.dirname(ledger));
  const deletedCharacter = 'synthetic-deleted-character', deletedPicker = 'synthetic-deleted-picker';
  const fixture = { groups: [{ pickerId: 'synthetic-normal' }], retiredPickerIds: [] };
  const writes = [{ pickerId: 'synthetic-normal', count: 1, revision: 7, tokens: [1], memberId: 'member', chunkId: 'chunk' }];
  const journals = [{ pickerId: 'synthetic-normal', memberId: 'member', id: 'journal', acknowledged: 2 }];
  try {
    await writeFile(ledger, JSON.stringify({ pickers: [{ pickerId: deletedPicker, lifecycle: 'deleted' }],
      deletions: [{ completedAt: '2026-01-01T00:00:00Z', targets: [{ characterId: deletedCharacter }] }] }));
    for (const lifecycle of [undefined, 'retired', 'deleted']) {
      await writeFile(registry, JSON.stringify({ pickers: [{ id: deletedPicker, lifecycle: 'deleted' },
        ...(lifecycle ? [{ id: 'synthetic-normal', lifecycle }] : [])], characters: [] }));
      const result = await audit(root, fixture, writes, [deletedCharacter], journals, [deletedPicker], { 'synthetic-normal': [7] });
      assert.equal(result.passed, false);
      assert.deepEqual(result.findings, [{ kind: lifecycle ? 'inactive-fixture-group' : 'missing-fixture-group', pickerId: 'synthetic-normal' }]);
      assert.equal(result.acknowledgedWrites, 1); assert.equal(result.pluginAcknowledgedEvents, 2);
      const controls = await audit(root, { ...fixture, groups: [] }, [], [deletedCharacter], [], [deletedPicker]);
      assert.equal(controls.passed, true); assert.deepEqual(controls.findings, []);
    }
  } finally {
    await unlink(registry); await unlink(ledger);
    await rmdir(path.dirname(registry)); await rmdir(path.dirname(ledger)); await rmdir(root);
  }
});
test('unverified SSE cannot satisfy or precede an acknowledgement and fails isolation', () => {
  const client = { pickerId: 'synthetic-picker', characterId: 'observer' }, isolation = [], seenEvents = new Map();
  const acknowledgements = new Map(), metrics = { steady: phaseMetrics() }, key = 'synthetic-picker:1';
  const emit = value => noteEvent({ client, id: 'revision', value, receivedAt: 20, phase: 'steady',
    isolation, seenEvents, acknowledgements, metrics, maxSeenEvents: 8 });
  assert.equal(emit({ revision: 1 }), 'untagged'); assert.equal(seenEvents.size, 0);
  acknowledgements.set(key, { at: 10, phase: 'steady', receivers: ['observer:0'] });
  assert.equal(emit({ revision: 1 }), 'untagged');
  assert.equal(emit({ revision: 1, _trialOrigin: 'another-picker' }), 'foreign');
  assert.equal(acknowledgements.size, 1); assert.equal(seenEvents.size, 0); assert.equal(metrics.steady.propagation.count, 0);
  assert.equal(emit({ revision: 1, _trialOrigin: client.pickerId }), 'verified');
  assert.equal(acknowledgements.size, 0); assert.equal(metrics.steady.propagation.count, 1);
  const result = gates(metrics, isolation, { passed: true, acknowledgedWrites: 1 }, 0, {}, parse([]));
  assert.equal(result.isolationAndDurability, 'fail');
  assert.deepEqual(isolation.map(row => row.kind), ['untagged-event', 'untagged-event', 'foreign-event']);
});
test('fractional arrivals retain phase-wide counts and ordinals across thirty-second windows', () => {
  const c = parse(['--smoke', '--sync-per-minute', '1']);
  const phases = [120, 95].map(seconds => ({ seconds, actions: .125, plugins: .75 }));
  const events = [...schedule(c, phases, [[], []], 10)];
  assert.deepEqual(events, [...schedule(c, phases, [[], []], 10)]);
  assert.ok(events.every((event, i) => !i || event.atMs >= events[i - 1].atMs));
  let offset = 0;
  for (const [stage, phase] of phases.entries()) {
    for (const [kind, rate] of Object.entries({ product: .125, pluginReport: .3, pluginStatus: .3, pluginTasks: .15, sync: 1 / 60, isolation: .1 })) {
      const arrivals = events.filter(event => event.stage === stage && event.kind === kind);
      assert.equal(arrivals.length, Math.floor(rate * phase.seconds), `${stage}:${kind}`);
      assert.deepEqual(arrivals.map(event => event.ordinal), Array.from({ length: arrivals.length }, (_, i) => i));
      assert.ok(arrivals.every(event => event.atMs >= offset && event.atMs < offset + phase.seconds * 1000));
    }
    offset += phase.seconds * 1000;
  }
  assert.equal(events.filter(event => event.kind === 'sync' && event.stage === 0).length, 2);
});
test('real plugin wire validator accepts multipart packets and bounded journal replay', () => {
  const client = { group: 1, memberId: 'owner', pickerId: 'synthetic-picker', characterId: 'synthetic-character' }, journal = journalFor(client, 'seed');
  validatePluginReport(reportPacket(journal, client, 'seed', true));
  observeAck(journal, { items: { journal: { id: journal.id, event: 0 } } });
  validatePluginReport(reportPacket(journal, client, 'seed', false));
  for (let i = 0; i < 40; i++) validatePluginReport(reportPacket(journal, client, 'seed', true));
  assert.equal(journal.pending.length, 32);
  observeAck(journal, { items: { journal: { id: journal.id, event: 32 } } }); assert.equal(journal.pending.length, 0);
  assert.equal(observeAck(journal, { items: { journal: { id: journal.id, event: 31 } } }, 0), true);
  assert.equal(journal.acknowledged, 32); assert.equal(journal.pending.length, 0);
  validatePluginReport(reportPacket(journal, client, 'seed', true));
  assert.equal(journal.pending[0][0], 33);
  assert.throws(() => observeAck(journal, { items: { journal: { id: journal.id, event: 31 } } }));
  assert.throws(() => observeAck(journal, { items: { journal: { id: journal.id, event: 34 } } }, 0));
  assert.equal(journal.acknowledged, 32); assert.equal(journal.pending.length, 1);
});
test('scheduled arrivals stay independent of completions and count generator drops', async () => {
  const list = arrivals([{ seconds: 1 }], 'seed', () => ({ product: 10 }));
  assert.equal(list.length, 10); assert.deepEqual(list, arrivals([{ seconds: 1 }], 'seed', () => ({ product: 10 })));
  let drops = 0, offered = 0; const pending = [];
  await dispatch(list, event => { offered++; assert.equal(event.scheduledAt, event.atMs - 2000);
    return new Promise(resolve => pending.push(resolve)); }, { now: () => 0, startAt: -2000, maxInFlight: 2,
    onDrop: () => { drops++; if (drops === 8) for (const resolve of pending) resolve(); } });
  assert.equal(offered, 2); assert.equal(drops, 8);
});
