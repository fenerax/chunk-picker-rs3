// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker, MessageChannel } from 'node:worker_threads';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonical, hash } from '../tools/calc-check/compare.mjs';
import { resultValue, compareValues } from '../scripts/experiments/q2-diff-engine/inputs.mjs';
import { requestsFor } from '../scripts/experiments/y03-fuzz-ci/generator.mjs';
import { createEligibilityCache, createEligibilityBudget, eligibilityInputKey } from '../app/tasks/eligibility-cache.mjs';
import { createWorkerCacheBudget, DEFAULT_CACHE_BYTES } from '../app/tasks/snapshot-cache.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { openLiveTimings, noteTiming } from '../app/live-timings.mjs';
import { previewProofFixture } from '../scripts/perf/preview-proof-fixture.mjs';
import { proofWorker } from './helpers/preview-proof-worker.mjs';
import { manualClock } from './helpers/process-lifecycle.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { ELIGIBILITY_CHUNK_BYTES, ELIGIBILITY_HANDOFF_BYTES, releaseEligibilityChunk } from '../app/tasks/eligibility-transfer.mjs';
import { serialize, deserialize } from 'node:v8';
import { encodeProcessMessage, decodeReceivedProcessMessage } from '../app/tasks/process-worker-transport.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const normalized = value => canonical(JSON.parse(JSON.stringify(value)));
const equal = (a, b, label) => assert.deepEqual(normalized(a), normalized(b), label);
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const inputFor = state => JSON.stringify([state.revision, state.rules, state.members.map(m => m.unlocked)]);
const evaluate = (client, state, memberId, extra = {}) => client.send({ pickerId: A, state, memberId, input: inputFor(state), type: 'evaluate', ...extra });
const predict = (client, state, memberId, chunkId, extra = {}) => evaluate(client, state, memberId, { type: 'predict', chunkId, seedEligibility: true, predictionProgress: true, previewProgress: true, ...extra });
const seededTelemetry = reply => reply.progress.at(-1)?.eligibilitySeeded === true;
const exportFrom = source => async proof => (await source.send({ type: 'eligibility-proof-export', pickerId: A, chunkId: proof })).result;
const probeURL = new URL('./fixtures/preview-proof-probe.mjs', import.meta.url);
class ProbedWorker extends Worker {
  constructor(workerData) { super(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData, execArgv: ['--import', probeURL.href] }); }
}
async function inspectProof(worker) {
  const { port1, port2 } = new MessageChannel();
  try {
    const reply = once(port1, 'message');
    worker.postMessage({ type: 'cancel', id: -999, proofProbePort: port2 }, [port2]);
    return (await reply)[0];
  } finally { port1.close(); port2.close(); }
}

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
              assert.equal(seededTelemetry(preview), true, `${shared}/${owner.id}/${chunkId}: seeded first baseline`);
              assert.ok(seeded.exports.length >= 1);
              assert.equal(seeded.exports[0].offset, 0);
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

  await t.test('native and legacy final predict envelopes match the unchanged differential; telemetry is progress only', async () => {
    assert.equal(hash('eligibilitySeeded'), '292d00f75f77a0bf280daf538cfcd26c6fdde0fed571cd2cf15ac45183f4415f');
    const { state, workerData, definitions } = previewProofFixture({ taskCount: 32 });
    const source = await proofWorker(workerData), cold = await proofWorker(workerData);
    let seeded;
    try {
      await evaluate(source, state, 'one');
      seeded = await proofWorker(workerData, { broker: exportFrom(source) });
      const legacyReply = await predict(cold, state, 'one', '12598', { seedEligibility: false, predictionProgress: false, previewProgress: false });
      // Use the actual request generator consumed by the PR differential. It
      // sets predictionProgress even though it does not opt into proof seeding.
      const ciRequest = requestsFor(state, definitions, 0).find(request => request.type === 'predict');
      assert.equal(ciRequest.predictionProgress, true);
      const ciReply = await evaluate(cold, state, ciRequest.memberId, ciRequest);
      const unseededReply = await predict(cold, state, 'one', '12598', { seedEligibility: false });
      const seededReply = await predict(seeded, state, 'one', '12598');
      const seedOnlyReply = await predict(seeded, state, 'one', '12598', { predictionProgress: false, previewProgress: false });
      assert.deepEqual(legacyReply.progress, []);
      for (const [reply, expected] of [[ciReply, false], [unseededReply, false], [seededReply, true], [seedOnlyReply, false]]) {
        assert.equal(seededTelemetry(reply), expected);
        assert.equal(reply.progress.length > 0, expected, 'a missing notification means false');
        for (const packet of reply.progress) {
          assert.deepEqual(Object.keys(packet), ['id', 'type', 'eligibilitySeeded']);
          assert.equal(packet.id, reply.id); assert.equal(packet.type, 'progress'); assert.equal(packet.eligibilitySeeded, expected);
        }
      }
      for (const reply of [legacyReply, ciReply, unseededReply, seededReply, seedOnlyReply]) {
        const raw = reply.raw;
        const mainShape = { result: raw.result, unlockReuse: raw.unlockReuse, partnerUnlockReuse: raw.partnerUnlockReuse };
        assert.deepEqual(compareValues(resultValue(raw, 'predict'), mainShape), [], 'all final reply fields checked with unchanged differential, including CI native opt-ins');
        assert.deepEqual(compareValues(resultValue({ ...raw, eligibilitySeeded: false }, 'predict'), mainShape).map(row => row.path),
          ['/@sha256:' + hash('eligibilitySeeded')], 'an unconditional final metadata field remains a detected regression');
      }
      const cancellation = new SharedArrayBuffer(4); Atomics.store(new Int32Array(cancellation), 0, 1);
      const nativeCancelled = await predict(cold, state, 'one', '12598', { cancellation, seedEligibility: false });
      const legacyCancelled = await predict(cold, state, 'one', '12598', { cancellation, seedEligibility: false, predictionProgress: false, previewProgress: false });
      assert.deepEqual(nativeCancelled.result, { cancelled: true }); assert.equal(seededTelemetry(nativeCancelled), false);
      assert.deepEqual(nativeCancelled.progress, []);
      assert.deepEqual(legacyCancelled.result, { cancelled: true }); assert.equal(Object.hasOwn(legacyCancelled, 'eligibilitySeeded'), false);
      assert.deepEqual(legacyCancelled.progress, []);
      const nativeFailed = await predict(cold, state, 'one', '12598', { seedEligibility: false, snapshotKey: 42 }).catch(error => error);
      assert.equal(nativeFailed.name, 'TypeError'); assert.equal(nativeFailed.message, 'Worker snapshotKey must be a string.');
      assert.equal(seededTelemetry(nativeFailed), false); assert.deepEqual(nativeFailed.progress, []);
      for (const reply of [legacyReply, ciReply, unseededReply, seededReply, seedOnlyReply, nativeCancelled, legacyCancelled, { ...nativeFailed, prepared: [] }]) {
        for (const packet of [reply.raw, ...reply.prepared]) {
          assert.equal(Object.hasOwn(packet, 'eligibilitySeeded'), false, 'no flag on any final or prepared reply');
          if (packet.timingMs) {
            assert.equal(Object.hasOwn(packet.timingMs, 'eligibilitySeeded'), false);
            for (const value of Object.values(packet.timingMs)) assert.equal(typeof value, 'number');
          }
        }
        if (reply.raw.result) assert.equal(Object.hasOwn(reply.raw.result, 'eligibilitySeeded'), false, 'telemetry never changes the predict result');
      }
      assert.deepEqual(resultValue(nativeCancelled.raw, 'predict'), { result: { cancelled: true } });
      assert.deepEqual(resultValue(nativeFailed.raw, 'predict'), { error: { name: 'TypeError', message: 'Worker snapshotKey must be a string.' } });
      equal(seededReply.result, unseededReply.result, 'complete delta/coverage/metrics');
    } finally { await source.close(); await cold.close(); await seeded?.close(); }
  });

  await t.test('resident-planning instrumentation starts with the current evaluateFull signature', async () => {
    const { state, workerData } = previewProofFixture({ taskCount: 32 });
    class ResidentWorker extends Worker {
      constructor(data) { super(new URL('../app/tasks/worker.mjs', import.meta.url), {
        workerData: data, execArgv: ['--import', new URL('./fixtures/resident-planning-probe.mjs', import.meta.url).href],
      }); }
    }
    const client = await proofWorker(workerData, { WorkerClass: ResidentWorker });
    try { assert.ok((await evaluate(client, state, 'one')).probe.evaluateFull > 0); }
    finally { await client.close(); }
  });

  await t.test('calculator startup computes the semantic namespace once', async () => {
    const { workerData } = previewProofFixture({ taskCount: 32 });
    const directory = await mkdtemp(path.join(tmpdir(), 'preview-proof-namespace-'));
    const client = await proofWorker({ ...workerData, warmStoreDirectory: directory }, { WorkerClass: ProbedWorker });
    try { assert.equal((await inspectProof(client.worker)).namespaces, 1); }
    finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
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
    const streamed = createEligibilityCache(), first = sender.exportProofChunk(key, 100000);
    const writer = streamed.beginImport(key, first);
    assert.ok(writer.append(first)); first.bytes.fill(0);
    assert.equal(writer.finish(), true);
    const privateResult = streamed.evaluate(state, 'one', options, () => assert.fail('stream must decode'));
    privateResult.map.get('typed')[0] = 88;
    assert.equal(sender.evaluate(state, 'one', options, result).map.get('typed')[0], 1);
    assert.equal(streamed.evaluate(state, 'one', options, result).map.get('typed')[0], 1);
    assert.equal(streamed.evaluate(state, 'one', { eligibilityScope: B }, result).metrics.eligibilityCacheHit, false);
    assert.equal(sender.exportProofChunk(key, 100000, 1, 'wrong-source'), undefined, 'chunks cannot splice a replacement proof');
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
    assert.equal(budget.reserveHandoff(), undefined, 'one handoff per receiving ledger');
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
    const empty = createWorkerCacheBudget(), maximum = empty.reserveHandoff();
    assert.equal(maximum.maxBytes, 128 * 1024 * 1024 - ELIGIBILITY_HANDOFF_BYTES);
    assert.equal(empty.bytes, ELIGIBILITY_HANDOFF_BYTES);
    maximum.release(); assert.equal(empty.bytes, 0); assert.equal(empty.size, 0);
  });

  await t.test('chunk transport owns detachable bytes and partial imports release their ledger charge', () => {
    const original = new Uint8Array([1, 2, 3]);
    const packet = { type: 'eligibility-seed', proof: { proof: { bytes: original, offset: 0 } } };
    const received = decodeReceivedProcessMessage(deserialize(serialize(encodeProcessMessage(packet))));
    assert.deepEqual([...received.proof.proof.bytes], [1, 2, 3]);
    releaseEligibilityChunk(received);
    assert.equal(received.proof.proof.bytes.byteLength, 0);
    assert.deepEqual([...original], [1, 2, 3], 'IPC receiver cannot detach sender storage');
    const budget = createWorkerCacheBudget(), cache = createEligibilityCache({ budget });
    const reservation = budget.reserveHandoff();
    const proof = { key: 'synthetic', totalBytes: ELIGIBILITY_CHUNK_BYTES + 1, proofId: 'source', compressed: false,
      offset: 0, bytes: new Uint8Array(ELIGIBILITY_CHUNK_BYTES) };
    const writer = cache.beginImport('synthetic', proof);
    assert.ok(writer.append(proof));
    assert.equal(budget.bytes, ELIGIBILITY_HANDOFF_BYTES + proof.totalBytes);
    assert.equal(writer.append({ ...proof, offset: proof.bytes.byteLength, bytes: new Uint8Array(1), proofId: 'replacement' }), false);
    assert.equal(writer.finish(), false, 'partial proof never becomes eligible');
    assert.equal(cache.size, 0); assert.equal(budget.bytes, ELIGIBILITY_HANDOFF_BYTES);
    reservation.release(); assert.equal(budget.bytes, 0); assert.equal(budget.size, 0);
  });

  await t.test('source preemption retains the receiver reservation until acknowledged reply or confirmed exit', async () => {
    for (const mode of ['reply', 'exit']) {
      const { state, workerData } = previewProofFixture({ taskCount: 32 });
      const clock = manualClock(), exported = deferred(), cancelled = deferred(), terminating = deferred(), exit = deferred();
      let source, receiver, held, foreground;
      const scheduler = await createTaskScheduler({ workerData, idleClock: clock, deadlineClock: clock, maxRestarts: 0,
        workerFactory() {
          source = new EventEmitter();
          source.postMessage = message => {
            if (message.type === 'eligibility-proof-export') { held = message; exported.resolve(); }
            else if (message.type === 'cancel') cancelled.resolve();
            else if (message.type === 'evaluate') queueMicrotask(() => source.emit('message', { id: message.id, result: {} }));
          };
          source.terminate = () => { terminating.resolve(); return exit.promise; };
          queueMicrotask(() => source.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'eligibility-proof-export'] }));
          return source;
        },
        predictionWorkerFactory(data) { receiver = new ProbedWorker(data); return receiver; },
      });
      const scope = scheduler.forPicker(A);
      try {
        await scope.evaluate(state, 'one', 'evaluate', undefined, 'baseline', 'same');
        const preview = scope.evaluate(state, 'one', 'predict', '12598', undefined, 'same');
        await exported.promise;
        assert.ok((await inspectProof(receiver)).ledger.some(row => row.cost === ELIGIBILITY_HANDOFF_BYTES));
        foreground = scope.evaluate(state, 'one', 'evaluate', undefined, 'next', 'same').catch(error => error);
        await cancelled.promise;
        assert.ok((await inspectProof(receiver)).ledger.some(row => row.cost === ELIGIBILITY_HANDOFF_BYTES), 'rejected source waiter still owns in-flight bytes');
        if (mode === 'reply') {
          const bytes = new Uint8Array(ELIGIBILITY_CHUNK_BYTES);
          source.emit('message', { id: held.id, result: { proof: { offset: 0, bytes } } });
          assert.equal(bytes.byteLength, 0, 'discarded late bytes released before source drain acknowledgement');
        } else {
          await clock.advance(25); await terminating.promise;
          assert.ok((await inspectProof(receiver)).ledger.some(row => row.cost === ELIGIBILITY_HANDOFF_BYTES), 'termination requested is not confirmed exit');
          exit.resolve();
        }
        const result = await preview;
        assert.equal(result.eligibilitySeeded, false);
        assert.equal((await inspectProof(receiver)).ledger.some(row => row.cost === ELIGIBILITY_HANDOFF_BYTES), false);
        await foreground;
      } finally { exit.resolve(); await scheduler.close(); }
    }
  });

  await t.test('worker keys reject different member, picker, own-item options, gameplay and semantic namespace', async () => {
    const { state, workerData, definitions } = previewProofFixture({ taskCount: 32 });
    const source = await proofWorker(workerData);
    try {
      await evaluate(source, state, 'one');
      const request = deferred(), receiver = await proofWorker(workerData, { broker: async proof => { request.resolve(proof); return exportFrom(source)(proof); } });
      try {
        assert.equal(seededTelemetry(await predict(receiver, state, 'one', '12598')), true);
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
        try { assert.equal(seededTelemetry(await predict(receiver, scenario.state, scenario.memberId, '12598', { pickerId: scenario.pickerId ?? A })), false); }
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
          if (message.type === 'eligibility-seed') queueMicrotask(() => {
            worker.emit('message', { id: message.id, type: 'progress', eligibilitySeeded: !!message.proof?.proof });
            worker.emit('message', { id: message.id, result: { delta: { tasksAdded: [] } }, timingMs: {} });
          });
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
    let first = true;
    const receiver = await proofWorker(workerData, { broker: async proof => {
      const packet = await exportFrom(source)(proof);
      if (!first) return packet;
      first = false; requested.resolve(packet); return gate.promise;
    } });
    try {
      const pending = predict(receiver, state, 'one', '12598');
      const packet = await requested.promise; assert.ok(packet.proof.bytes.byteLength);
      receiver.worker.postMessage({ type: 'cancel', id: 1, pickerId: A });
      gate.resolve(packet);
      const cancelled = await pending;
      assert.equal(cancelled.result.cancelled, true); assert.equal(seededTelemetry(cancelled), false);
      assert.equal(Object.hasOwn(cancelled.raw, 'eligibilitySeeded'), false);
      assert.equal(Object.hasOwn(cancelled.timingMs, 'eligibilitySeeded'), false);
      const next = await predict(receiver, state, 'one', '12599');
      assert.equal(seededTelemetry(next), true); assert.equal(next.result.cancelled, undefined);
    } finally { gate.resolve(undefined); await receiver.close(); await source.close(); }
  });

  await t.test('native process transport seeds a proof above 27 MiB under default budgets', async t => {
    const { state, workerData } = previewProofFixture({ taskCount: 32 });
    const chunks = [], natives = [], partner = deferred();
    const scheduler = await createTaskScheduler({ workerData: { ...workerData, proofPaddingBytes: 27 * 1024 * 1024 }, maxCalculators: 2, shareSnapshots: true,
      workerFactory(data) {
        const worker = new ProcessWorker(data, { probeImport: probeURL.href });
        natives.push(worker);
        worker.on('message', message => {
          const proof = message.result?.proof;
          if (proof?.offset !== undefined) chunks.push({ offset: proof.offset, size: proof.bytes.byteLength, total: proof.totalBytes });
        });
        return worker;
      },
      timings: { record(action, ms, fields) { if (action === 'preview-partner') partner.resolve(fields); } },
    });
    const reference = await proofWorker(workerData);
    try {
      const input = inputFor(state);
      await scheduler.evaluate(state, 'one', 'evaluate', undefined, 'baseline', input);
      const first = await scheduler.evaluate(state, 'one', 'predict', '12598', undefined, input);
      assert.equal(first.eligibilitySeeded, true);
      assert.equal(Object.keys(first).includes('eligibilitySeeded'), false, 'scheduler telemetry stays non-enumerable');
      equal(first.result, (await predict(reference, state, 'one', '12598', { seedEligibility: false })).result, 'large native seeded result is complete and equivalent');
      assert.ok(chunks[0].total >= 27 * 1024 * 1024);
      assert.equal(chunks.length, Math.ceil(chunks[0].total / ELIGIBILITY_CHUNK_BYTES));
      let offset = 0;
      for (const chunk of chunks) { assert.equal(chunk.offset, offset); assert.ok(chunk.size <= ELIGIBILITY_CHUNK_BYTES); offset += chunk.size; }
      assert.equal(offset, chunks[0].total);
      assert.equal((await partner.promise).eligibilitySeeded, true, 'actual Live timings partner event sees seed flag');
      const receiverMemory = (await natives[1].getMemoryUsage()).workers[0].memoryUsage;
      assert.equal(receiverMemory.namespaces, 1);
      assert.equal(receiverMemory.proofLedger.some(row => row.cost === ELIGIBILITY_HANDOFF_BYTES), false, 'completed handoff releases transient reservation');
      assert.ok(receiverMemory.proofLedger.reduce((sum, row) => sum + row.cost, 0) <= DEFAULT_CACHE_BYTES);
      assert.ok(receiverMemory.proofLedger.filter(row => row.owner === 'eligibility').reduce((sum, row) => sum + row.cost, 0) <= 128 * 1024 * 1024);
      assert.ok(receiverMemory.proofLedger.length <= 512);
      const exports = chunks.length;
      // Wait for the deterministic partner-ready notification by asking for
      // the next candidate: it queues behind that producer, without a sleep.
      const next = await scheduler.evaluate(state, 'one', 'predict', '12599', undefined, input);
      assert.equal(next.eligibilitySeeded, false);
      assert.equal(chunks.length, exports, 'advisory baseline hit requests no more bytes');
      assert.equal(scheduler.getDiagnostics().calculators.peak, 2);
      t.diagnostic(`Seeded native proof: ${offset} bytes; one acknowledged chunk <= ${ELIGIBILITY_CHUNK_BYTES}; default empty-ledger ceiling ${128 * 1024 * 1024 - ELIGIBILITY_HANDOFF_BYTES} bytes.`);
    } finally { await scheduler.close(); await reference.close(); }
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
