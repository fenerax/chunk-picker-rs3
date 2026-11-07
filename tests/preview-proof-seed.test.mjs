// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonical } from '../tools/calc-check/compare.mjs';
import { createEligibilityCache, createEligibilityBudget, eligibilityInputKey } from '../app/tasks/eligibility-cache.mjs';
import { createWorkerCacheBudget, DEFAULT_CACHE_BYTES } from '../app/tasks/snapshot-cache.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { openLiveTimings, noteTiming } from '../app/live-timings.mjs';
import { previewProofFixture } from '../scripts/perf/preview-proof-fixture.mjs';
import { proofWorker } from './helpers/preview-proof-worker.mjs';
import { manualClock } from './helpers/process-lifecycle.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const normalized = value => canonical(JSON.parse(JSON.stringify(value)));
const equal = (a, b, label) => assert.deepEqual(normalized(a), normalized(b), label);
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const inputFor = state => JSON.stringify([state.revision, state.rules, state.members.map(m => m.unlocked)]);
const evaluate = (client, state, memberId, extra = {}) => client.send({ pickerId: A, state, memberId, input: inputFor(state), type: 'evaluate', ...extra });
const predict = (client, state, memberId, chunkId, extra = {}) => evaluate(client, state, memberId, { type: 'predict', chunkId, seedEligibility: true, predictionProgress: true, previewProgress: true, ...extra });
const exportFrom = source => async proof => (await source.send({ type: 'eligibility-proof-export', pickerId: A, chunkId: proof })).result;

// One generous file guard, with deterministic message/deferred controls below.
test('exact Preview eligibility proof handoff', { timeout: 600000 }, async t => {
  await t.test('all normal-size duo pool candidates preserve complete results and ordered evidence', async () => {
    const fixture = previewProofFixture();
    assert.ok(fixture.engine.catalogue.length >= 2048);
    assert.equal(Object.keys(fixture.definitions.chunks).length, 64);
    // Exercise every semantic family in the fixture, including its complete
    // dependency and cycle controls, rather than only the first few rows.
    const evidenceLabels = ['Gather 0', 'Burn 0', 'Make 0', 'Use 0', 'First permit', 'Cycle left', 'Cycle right', 'Prepare', 'Finish'];
    const evidenceIds = evidenceLabels.map(label => {
      const task = fixture.engine.catalogue.find(row => row.label === label);
      assert.ok(task, label); return task.id;
    });
    const evidenceEqual = async (fast, cold, input, memberId) => {
      for (const taskId of evidenceIds) for (const type of ['how-task', 'why-task']) equal(
        (await evaluate(fast, input, memberId, { type, chunkId: taskId })).result,
        (await evaluate(cold, input, memberId, { type, chunkId: taskId })).result,
        `${type}/${taskId}: complete ordered evidence`);
    };
    let candidates = 0;
    for (const shared of [false, true]) {
      const state = structuredClone(fixture.state); state.rules['access.shared'] = shared;
      const saved = JSON.stringify(state), source = await proofWorker(fixture.workerData), reference = await proofWorker(fixture.workerData);
      try {
        for (const owner of state.members) {
          const before = await evaluate(source, state, owner.id);
          equal(before.result, (await evaluate(reference, state, owner.id)).result, 'complete cold baseline');
          const pool = (await evaluate(reference, state, owner.id, { type: 'roll-pool' })).result;
          assert.ok(pool.pool.eligible.length > 0, 'nonempty normal roll pool');
          for (const candidate of pool.pool.eligible) {
            const chunkId = typeof candidate === 'string' ? candidate : candidate.id ?? candidate.chunkId;
            assert.equal(typeof chunkId, 'string'); candidates++;
            const seeded = await proofWorker(fixture.workerData, { broker: exportFrom(source) });
            try {
              const coldPreview = await predict(reference, state, owner.id, chunkId, { seedEligibility: false });
              const preview = await predict(seeded, state, owner.id, chunkId);
              assert.equal(preview.eligibilitySeeded, true, `${shared}/${owner.id}/${chunkId}: seeded first baseline`);
              assert.equal(seeded.exports.length, 1);
              equal(preview.result, coldPreview.result, 'entire Preview delta, coverage and public metrics');
              equal((await evaluate(seeded, state, owner.id)).result, before.result, 'entire seeded baseline with full views');
              equal((await evaluate(seeded, state, owner.id, { type: 'roll-pool' })).result, pool, 'baseline pools and partner connections');
              await evidenceEqual(seeded, source, state, owner.id);
              // Like unlock-equivalence, compare both members after every pool
              // candidate, including the exact compact bytes and both sidebars.
              const after = structuredClone(state); after.revision++;
              after.members.find(m => m.id === owner.id).unlocked.push(chunkId);
              for (const member of after.members) {
                const transport = { resultTransport: 'json-shared-v1', resultView: 'full', duoProjection: true, duoSidebarProjection: true };
                const cold = await evaluate(reference, after, member.id, transport), fast = await evaluate(seeded, after, member.id, transport);
                equal(json(fast.resultJSON), json(cold.resultJSON), 'full post-unlock result');
                equal(json(fast.playJSON), json(cold.playJSON), 'compact play projection with map locations');
                // Sidebar bytes require compact transport; compare the exact
                // same worker projections used by reusable owner/partner pairs.
                const compact = { ...transport, resultView: 'play-v1' };
                const coldCompact = await evaluate(reference, after, member.id, compact), fastCompact = await evaluate(seeded, after, member.id, compact);
                for (const name of ['playJSON', 'duoJSON', 'duoSidebarJSON']) equal(json(fastCompact[name]), json(coldCompact[name]), name);
                equal((await evaluate(seeded, after, member.id, { type: 'roll-pool' })).result,
                  (await evaluate(reference, after, member.id, { type: 'roll-pool' })).result, 'post-unlock pools');
                await evidenceEqual(seeded, reference, after, member.id);
              }
              for (const name of ['unlockReuse', 'partnerUnlockReuse']) {
                assert.ok(preview[name]);
                for (const projection of ['playJSON', 'duoJSON', 'duoSidebarJSON']) equal(json(preview[name][projection]), json(coldPreview[name][projection]), `${name}/${projection}`);
              }
            } finally { await seeded.close(); }
          }
        }
        assert.equal(JSON.stringify(state), saved, 'Preview leaves the entire input byte-identical');
      } finally { await source.close(); await reference.close(); }
    }
    assert.ok(candidates >= 20, 'every candidate for both owners and Group modes was covered');
    t.diagnostic(`Complete canonical equivalence: ${candidates} pool candidates, both owners after each, Group off/on; no new exclusions.`);
  });

  await t.test('cache exports only retained bytes; private imports isolate typed data, overlays and pickers', () => {
    const state = { members: [{ id: 'one', name: 'Explorer', unlocked: ['12336'], completedTasks: [] }], rules: {} };
    const result = () => ({ tasks: [{ id: 'task', sources: [{ order: ['first', 'second'] }] }], metrics: {},
      map: new Map([['typed', new Uint8Array([1, 2, 3])]]), view: new DataView(Uint8Array.from([4, 5]).buffer) });
    const sender = createEligibilityCache({ limit: 2 }), receiver = createEligibilityCache({ limit: 2 });
    const options = { eligibilityScope: A }, key = eligibilityInputKey(state, 'one', options);
    assert.equal(sender.exportProof(key, 100000), undefined, 'miss performs no compute');
    sender.evaluate(state, 'one', options, result);
    const packet = sender.exportProof(key, 100000);
    assert.ok(packet); assert.equal(sender.exportProof(key, 1), undefined, 'oversized export misses');
    assert.equal(receiver.importProof(key, packet), true);
    packet.bytes = new Uint8Array(packet.bytes); // native message ownership
    packet.bytes.fill(0);
    const imported = receiver.evaluate(state, 'one', options, () => assert.fail('must decode the import'));
    imported.map.get('typed')[0] = 90; imported.view.setUint8(0, 90); imported.tasks[0].sources[0].order.reverse();
    imported.tasks[0].challengeSatisfied = true;
    const original = sender.evaluate(state, 'one', options, () => assert.fail('sender proof changed'));
    assert.equal(original.map.get('typed')[0], 1); assert.equal(original.view.getUint8(0), 4);
    assert.deepEqual(original.tasks[0].sources[0].order, ['first', 'second']);
    assert.equal(original.tasks[0].challengeSatisfied, false);
    assert.equal(receiver.evaluate(state, 'one', { eligibilityScope: B }, result).metrics.eligibilityCacheHit, false);
    assert.equal(receiver.evaluate(state, 'one', options, result).map.get('typed')[0], 1);
    for (const changed of [{ ...options, ownItemQueries: ['Other'] }, { ...options, eligibilityScope: B }])
      assert.equal(sender.exportProof(eligibilityInputKey(state, 'one', changed), 100000), undefined);
    const gameplay = structuredClone(state); gameplay.members[0].unlocked.push('12337');
    assert.equal(sender.exportProof(eligibilityInputKey(gameplay, 'one', options), 100000), undefined);
    sender.evaluate(state, 'one', { ...options, other: 1 }, result);
    sender.evaluate(state, 'one', { ...options, other: 2 }, result);
    assert.equal(sender.exportProof(key, 100000), undefined, 'evicted proof cannot be exported');
    const broken = createEligibilityCache();
    assert.equal(broken.importProof(key, { key, bytes: Uint8Array.from([0]), compressed: false }), true);
    assert.equal(broken.evaluate(state, 'one', options, result).metrics.eligibilityCacheHit, false, 'decoder failure takes the cold path');
  });

  await t.test('handoff copies use unchanged ledger partitions without evicting snapshots', () => {
    const budget = createWorkerCacheBudget();
    assert.equal(budget.byteLimit, DEFAULT_CACHE_BYTES); assert.equal(budget.entryLimit, 512);
    assert.equal(budget.eligibilityByteLimit, 128 * 1024 * 1024); assert.equal(budget.ownerByteLimit, 192 * 1024 * 1024);
    const visible = Buffer.alloc(1); let evicted = false;
    assert.equal(budget.admit(visible, () => { evicted = true; }, { owner: 'picker:a', cost: 192 * 1024 * 1024 }), true);
    const handoff = budget.reserveHandoff(); assert.ok(handoff);
    assert.equal(budget.size, 2); assert.ok(budget.bytes > 192 * 1024 * 1024);
    handoff.release(); assert.equal(budget.size, 1); assert.equal(budget.bytes, 192 * 1024 * 1024);
    assert.equal(evicted, false); assert.equal(budget.touch(visible), true);
    assert.equal(budget.canAdmit({ owner: 'picker:b', cost: 65 * 1024 * 1024, preserve: [visible] }), false, 'snapshot partition stays at 256 MiB');
    const tight = createEligibilityBudget({ byteLimit: 64, eligibilityByteLimit: 64, entryLimit: 2 });
    tight.admit(Buffer.alloc(32), () => assert.fail('must preserve current entry'));
    assert.equal(tight.reserveHandoff(), undefined);
    const full = createEligibilityBudget({ byteLimit: 1000000, entryLimit: 1 });
    full.admit(Buffer.alloc(1), () => assert.fail('entry limit must preserve the snapshot'));
    assert.equal(full.reserveHandoff(), undefined);
  });

  await t.test('worker keys reject different member, picker, own-item options, gameplay and semantic namespace', async () => {
    const { state, workerData, definitions } = previewProofFixture({ taskCount: 32 });
    const source = await proofWorker(workerData);
    try {
      await evaluate(source, state, 'one');
      const request = deferred(), receiver = await proofWorker(workerData, { broker: async proof => { request.resolve(proof); return exportFrom(source)(proof); } });
      try {
        assert.equal((await predict(receiver, state, 'one', '12598')).eligibilitySeeded, true);
        const proof = await request.promise;
        for (const altered of [
          { ...proof, namespace: '0'.repeat(64) },
          { ...proof, maxBytes: 1 },
          { ...proof, key: JSON.stringify([B, ...JSON.parse(proof.key).slice(1)]) },
        ]) assert.equal((await source.send({ type: 'eligibility-proof-export', pickerId: A, chunkId: altered })).result, undefined);
        assert.equal((await source.send({ type: 'eligibility-proof-export', pickerId: B, chunkId: proof })).result, undefined);
      } finally { await receiver.close(); }
      const changed = structuredClone(state); changed.members[0].unlocked.push('12598');
      const otherDefinitions = structuredClone(definitions); otherDefinitions.challenges.Extra.Different = { Chunks: ['12598'] };
      for (const scenario of [
        { state, memberId: 'two' }, { state, memberId: 'one', pickerId: B }, { state: changed, memberId: 'one' },
        { state, memberId: 'one', data: { ...workerData, definitions: otherDefinitions } },
        { state, memberId: 'one', mutate: proof => ({ ...proof, namespace: '0'.repeat(64) }) },
        { state, memberId: 'one', mutate: () => undefined },
      ]) {
        const receiver = await proofWorker(scenario.data ?? workerData, { broker: async proof => {
          const answer = await exportFrom(source)(proof); return scenario.mutate ? scenario.mutate(answer) : answer;
        } });
        try { assert.equal((await predict(receiver, scenario.state, scenario.memberId, '12598', { pickerId: scenario.pickerId ?? A })).eligibilitySeeded, false); }
        finally { await receiver.close(); }
      }
      // Task-fact projection and own-item queries are part of the actual key.
      const engine = createTaskEngine(definitions, workerData.datasetOptions);
      engine.evaluate(state, 'one', { ownItemQueries: [] });
      const ownKey = engine.eligibilityProofKey(state, 'one', { ownItemQueries: [] });
      const otherKey = engine.eligibilityProofKey(state, 'one', { ownItemQueries: ['Fixture item'] });
      assert.ok(engine.exportEligibilityProof(ownKey, 1000000));
      assert.notEqual(ownKey, otherKey); assert.equal(engine.exportEligibilityProof(otherKey, 1000000), undefined);
    } finally { await source.close(); }
  });

  await t.test('scheduler never wakes or queues a source; misses and failed transfers keep the ordinary path', async () => {
    for (const scenario of ['ready', 'busy', 'queued', 'sleeping', 'unsupported', 'miss', 'source-failure', 'clone-failure']) {
      const clock = manualClock(), sources = [], predictions = [];
      const create = advisory => () => {
        const worker = new EventEmitter(); worker.messages = [];
        worker.finish = (result = {}, id = worker.messages.at(-1).id) => queueMicrotask(() => worker.emit('message', { id, result }));
        worker.postMessage = message => {
          if (scenario === 'source-failure' && message.type === 'eligibility-proof-export') throw new Error('Synthetic send failure');
          if (scenario === 'clone-failure' && message.type === 'eligibility-seed' && message.proof) throw new Error('Synthetic clone failure');
          worker.messages.push(message);
          if (message.type === 'predict') queueMicrotask(() => worker.emit('message', { id: message.id, type: 'progress', eligibilitySeedRequest: { namespace: 'fixture', key: 'exact', maxBytes: 100 } }));
          if (message.type === 'eligibility-proof-export') worker.finish(scenario === 'miss' ? undefined : { proof: { bytes: new Uint8Array(1) } });
          if (message.type === 'eligibility-seed') queueMicrotask(() => worker.emit('message', { id: message.id, result: { delta: { tasksAdded: [] } }, eligibilitySeeded: !!message.proof?.proof }));
        };
        worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
        (advisory ? predictions : sources).push(worker);
        queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: scenario === 'unsupported' && !advisory ? [] : ['evaluate', 'predict', 'eligibility-proof-export'] }));
        return worker;
      };
      const scheduler = await createTaskScheduler({ workerFactory: create(false), predictionWorkerFactory: create(true), idleClock: clock, idleMs: 100, maxRestarts: 0 });
      try {
        const state = { revision: 0, members: [{ id: 'one', unlocked: [], selected: [], pendingRoll: [] }], rules: {} };
        const baseline = scheduler.evaluate(state, 'one', 'evaluate', undefined, 'baseline', 'same');
        let queued;
        if (scenario === 'queued') queued = scheduler.evaluate(state, 'one', 'evaluate', undefined, 'queued', 'other');
        if (!['busy', 'queued'].includes(scenario)) { sources[0].finish(); await baseline; }
        if (scenario === 'sleeping') { await clock.advance(101); assert.equal(sources[0].terminated, true); }
        const preview = await scheduler.evaluate(state, 'one', 'predict', '12598', undefined, 'same');
        assert.equal(preview.eligibilitySeeded, scenario === 'ready', scenario);
        const exports = sources.flatMap(worker => worker.messages.filter(message => message.type === 'eligibility-proof-export'));
        assert.equal(exports.length, ['ready', 'miss', 'clone-failure'].includes(scenario) ? 1 : 0, scenario);
        assert.equal(sources.length, 1, `${scenario}: export cannot wake a source`);
        if (scenario === 'busy' || scenario === 'queued') {
          sources[0].finish(); await baseline;
          if (queued) { sources[0].finish(); await queued; }
        }
        assert.equal(sources[0].messages.filter(message => message.type === 'evaluate').length, scenario === 'queued' ? 2 : 1, 'no baseline just to export');
      } finally { await scheduler.close(); }
    }
  });

  await t.test('cancellation releases the reservation before importing a late transfer', async () => {
    const { state, workerData } = previewProofFixture({ taskCount: 32 });
    const source = await proofWorker(workerData); await evaluate(source, state, 'one');
    const gate = deferred(), requested = deferred();
    const receiver = await proofWorker(workerData, { broker: async proof => { requested.resolve(await exportFrom(source)(proof)); return gate.promise; } });
    try {
      const pending = predict(receiver, state, 'one', '12598');
      const packet = await requested.promise; assert.ok(packet.proof.bytes.byteLength);
      receiver.worker.postMessage({ type: 'cancel', id: 1, pickerId: A });
      gate.resolve(packet);
      const cancelled = await pending;
      assert.equal(cancelled.result.cancelled, true); assert.equal(cancelled.eligibilitySeeded, false);
      const next = await predict(receiver, state, 'one', '12599');
      assert.equal(next.eligibilitySeeded, true); assert.equal(next.result.cancelled, undefined);
    } finally { gate.resolve(undefined); await receiver.close(); await source.close(); }
  });

  await t.test('native process transport seeds the scheduler and a warm advisory baseline skips export', async () => {
    const { state, workerData } = previewProofFixture({ taskCount: 32 });
    const scheduler = await createTaskScheduler({ workerData, maxCalculators: 2, shareSnapshots: true });
    try {
      const input = inputFor(state);
      await scheduler.evaluate(state, 'one', 'evaluate', undefined, 'baseline', input);
      const first = await scheduler.evaluate(state, 'one', 'predict', '12598', undefined, input);
      assert.equal(first.eligibilitySeeded, true);
      // Wait for the deterministic partner-ready notification by asking for
      // the next candidate: it queues behind that producer, without a sleep.
      const next = await scheduler.evaluate(state, 'one', 'predict', '12599', undefined, input);
      assert.equal(next.eligibilitySeeded, false);
      assert.equal(scheduler.getDiagnostics().calculators.peak, 2);
    } finally { await scheduler.close(); }
  });

  await t.test('Live timings persist one fixed boolean, never proof keys or identifiers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'preview-proof-timing-'));
    try {
      let collector = await openLiveTimings(dir);
      const response = new EventEmitter(); Object.assign(response, { statusCode: 200, writableFinished: true });
      await collector.request({ url: '/api/predict' }, response, async () => {
        noteTiming({ eligibilitySeeded: true, key: 'private-proof-key', pickerId: A }); response.emit('finish');
      });
      collector.record('preview-partner', 1, { eligibilitySeeded: true, key: 'private-proof-key' });
      await collector.close();
      const saved = await readFile(path.join(dir, 'live-timings.json'), 'utf8');
      assert.ok(!saved.includes('private-proof-key')); assert.ok(!saved.includes(A));
      assert.equal(JSON.parse(saved).recent[0].eligibilitySeeded, true);
      collector = await openLiveTimings(dir);
      assert.equal(collector.summary().windows['24h'].find(row => row.action === 'preview-first').eligibilitySeeded, 1);
      await collector.close();
      const old = JSON.parse(saved); for (const [, row] of old.hours) for (const value of Object.values(row)) delete value.eligibilitySeeded;
      await writeFile(path.join(dir, 'live-timings.json'), JSON.stringify(old));
      collector = await openLiveTimings(dir);
      assert.equal(collector.summary().windows['24h'].find(row => row.action === 'preview-first').eligibilitySeeded, 0);
      await collector.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
