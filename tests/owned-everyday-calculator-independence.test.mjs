// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { deferredTaskInput } from '../app/tasks/deferred-input.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import { fixture, options, first, generated, now, world as fixtureWorld, taskCatalogue } from './helpers/owned-format2-fixture.mjs';
const world = { ...fixtureWorld, surface: new Set(fixtureWorld.chunks.keys()) };

// The calculator is released by the test only AFTER both command streams finish.
// This outer guard detects a deadlock; application clocks never advance.
test('everyday saves and replies finish while a calculator owns the only lane', { timeout: 60000 }, async t => {
  const finalStates = [], replies = [];
  for (const mode of ['format1', 'format2']) await t.test(mode, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rs3-everyday-independent-'));
    const stores = [], messages = [], clock = createManualClock();
    let scheduler, endpoint, releaseStarted;
    const started = new Promise(resolve => { releaseStarted = resolve; });
    try {
      for (let index = 0; index < 3; index++) stores.push(await openStore({
        dataDir: path.join(root, `group-${index}`), initialState: fixture().state,
        now, world, taskCatalogue, retention: false, completionCodec: false,
        ownedFormat2: mode === 'format2' ? options(path.join(root, 'catalogue')) : false,
      }));
      scheduler = await createTaskScheduler({ maxCalculators: 1, maxRestarts: 0,
        idleClock: clock, deadlineClock: clock, workerFactory() {
          endpoint = new EventEmitter();
          endpoint.terminate = async () => endpoint.emit('exit', 0);
          endpoint.postMessage = message => {
            if (!message.id || ['cancel', 'supersede'].includes(message.type)) return;
            messages.push(message); releaseStarted();
          };
          queueMicrotask(() => endpoint.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'] }));
          return endpoint;
        } });
      const capture = stores[2].getCalculationSnapshot(), inputKey = capture.taskInputKey;
      const input = deferredTaskInput(stores[2], inputKey);
      let loads = 0, calculationSettled = false;
      const heavy = scheduler.forPicker('p_' + 'a'.repeat(32)).evaluate(
        { revision: capture.revision, members: capture.members }, 'member-1', 'evaluate', undefined,
        'held-calculator', inputKey, undefined, [], 'full', { ...input, load(revision) { loads++; return input.load(revision); } });
      // Attach both handlers immediately so a failure still tears down cleanly.
      heavy.then(() => { calculationSettled = true; }, () => { calculationSettled = true; });
      await started;
      const streams = await Promise.all(stores.slice(0, 2).map(async store => {
        const responses = [];
        for (const command of [
          { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first, generated] },
          { type: 'set-note', memberId: 'member-2', chunkId: '100', note: 'Synthetic concurrent note' },
          { type: 'undo' },
        ]) {
          const response = await store.commandSerialized(command, store.getInfo().revision, { view: 'play-v1' });
          responses.push({ state: JSON.parse(response.stateJSON), pools: response.pools, revision: response.revision });
        }
        return responses;
      }));
      assert.equal(calculationSettled, false, 'both streams finish before the calculator is released');
      assert.equal(loads, 1, 'commands never ask the calculator to load another input');
      assert.deepEqual(messages.map(message => message.type), ['evaluate']);
      const saved = [];
      for (let index = 0; index < 2; index++) {
        const document = JSON.parse(await readFile(path.join(root, `group-${index}`, 'state.json'), 'utf8'));
        const built = fixture();
        const state = mode === 'format2' ? ownedCodec(built.base, built.pin).decode(document).state : document.state;
        assert.deepEqual(state, stores[index].getState(), 'the reply does not precede its durable save');
        saved.push(state);
      }
      finalStates.push(saved); replies.push(streams);
      endpoint.emit('message', { id: messages[0].id, result: { revision: capture.revision }, evaluationMs: 0 });
      assert.equal((await heavy).result.revision, capture.revision);
    } finally {
      await scheduler?.close(); for (const store of stores) await store.close();
      // Only this mkdtemp-owned synthetic directory, outside every checkout.
      await rm(root, { recursive: true, force: true });
    }
  });
  assert.deepEqual(finalStates[1], finalStates[0], 'both storage formats save identical logical state');
  assert.deepEqual(replies[1], replies[0], 'both formats reply with identical state and roll pools');
});
