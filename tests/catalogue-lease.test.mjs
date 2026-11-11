// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueLease } from '../app/storage/catalogue-lease.mjs';
const gate = () => Promise.withResolvers();

test('catalogue admission ordering and interruption', { timeout: 60000 }, async t => {
  await t.test('shared holders overlap; queued exclusives drain readers and precede every new reader', async () => {
    const events = [], a = gate(), b = gate(), e = gate(), f = gate();
    let guards = 0;
    const lease = createCatalogueLease(async () => { guards++; return async () => { guards--; }; });
    const enteredA = gate(), enteredB = gate(), enteredE = gate(), enteredF = gate();
    const first = lease(async () => { events.push('A'); enteredA.resolve(); await a.promise; }, { mode: 'shared' });
    await enteredA.promise;
    const second = lease(async () => { events.push('B'); enteredB.resolve(); await b.promise; }, { mode: 'shared' });
    await enteredB.promise; assert.equal(guards, 1);
    const exclusive = lease(async () => { events.push('E'); enteredE.resolve(); await e.promise; });
    const late = lease(() => { events.push('C'); }, { mode: 'shared' });
    const nextExclusive = lease(async () => { events.push('F'); enteredF.resolve(); await f.promise; });
    assert.deepEqual(events, ['A', 'B']);
    a.resolve(); await first; assert.deepEqual(events, ['A', 'B']);
    b.resolve(); await enteredE.promise; assert.deepEqual(events, ['A', 'B', 'E']);
    e.resolve(); await enteredF.promise; assert.deepEqual(events, ['A', 'B', 'E', 'F']);
    f.resolve(); await Promise.all([second, exclusive, nextExclusive, late]);
    assert.deepEqual(events, ['A', 'B', 'E', 'F', 'C']); assert.equal(guards, 0);
  });
  await t.test('aborting a queued exclusive removes its reader fence without cancelling active work', async () => {
    const lease = createCatalogueLease(async () => async () => {}), held = gate(), entered = gate();
    const first = lease(async () => { entered.resolve(); await held.promise; }, { mode: 'shared' }); await entered.promise;
    const controller = new AbortController();
    const writer = assert.rejects(lease(() => assert.fail('aborted writer entered'), { signal: controller.signal }), { name: 'AbortError' });
    const secondEntered = gate();
    const second = lease(() => secondEntered.resolve(), { mode: 'shared' });
    controller.abort(); await secondEntered.promise; await writer;
    held.resolve(); await Promise.all([first, second]);
  });
  await t.test('nested modes reject upgrades; detached async context cannot reuse a released lease', async () => {
    const lease = createCatalogueLease(async () => async () => {}), trigger = gate(), writerHeld = gate(), writerEntered = gate(), queued = gate();
    let detached;
    await lease(async () => {
      await lease(() => {}, { mode: 'shared' });
      await assert.rejects(lease(() => assert.fail('upgrade entered')), /Cannot upgrade/);
      detached = (async () => { await trigger.promise; return lease(() => 'fresh', { mode: 'shared', onQueued: () => queued.resolve() }); })();
    }, { mode: 'shared' });
    const exclusive = lease(async () => { writerEntered.resolve(); await writerHeld.promise; }); await writerEntered.promise;
    trigger.resolve(); await queued.promise;
    writerHeld.resolve(); await exclusive; assert.equal(await detached, 'fresh');
  });
  await t.test('guard acquisition and work failures release admission charges', async () => {
    let refuse = true, guards = 0;
    const lease = createCatalogueLease(async () => {
      if (refuse) throw Error('synthetic guard refusal');
      guards++; return async () => { guards--; };
    });
    await assert.rejects(lease(() => {}), /guard refusal/); refuse = false;
    await assert.rejects(lease(() => { throw Error('synthetic work failure'); }), /work failure/);
    assert.equal(guards, 0); await lease(() => {}); assert.equal(guards, 0);
  });
  await t.test('a writer fences readers queued during guard acquisition; aborted acquisition waiters never enter', async () => {
    const acquiring = gate(), acquired = gate(), writerEntered = gate(), finish = gate();
    const events = [], controller = new AbortController();
    const lease = createCatalogueLease(async () => { acquiring.resolve(); await acquired.promise; return async () => {}; });
    const aborted = assert.rejects(lease(() => assert.fail('aborted reader entered'), { mode: 'shared', signal: controller.signal }), { name: 'AbortError' });
    await acquiring.promise;
    const reader = lease(() => { events.push('reader'); }, { mode: 'shared' });
    const writer = lease(async () => { events.push('writer'); writerEntered.resolve(); await finish.promise; });
    controller.abort(); await aborted; acquired.resolve(); await writerEntered.promise;
    assert.deepEqual(events, ['writer']); finish.resolve(); await Promise.all([reader, writer]);
    assert.deepEqual(events, ['writer', 'reader']);
  });
  await t.test('an uncertain guard release fails closed for queued and future work', async () => {
    const releasing = gate(), finish = gate(), queued = gate();
    const failure = Error('synthetic release failure'); let acquisitions = 0;
    const lease = createCatalogueLease(async () => {
      acquisitions++; return async () => { releasing.resolve(); await finish.promise; throw failure; };
    });
    const first = assert.rejects(lease(() => {}), failure); await releasing.promise;
    const second = assert.rejects(lease(() => assert.fail('entered after uncertain release'), { mode: 'shared', onQueued: () => queued.resolve() }), failure);
    await queued.promise; finish.resolve(); await Promise.all([first, second]);
    await assert.rejects(lease(() => assert.fail('reacquired after uncertain release')), failure);
    assert.equal(acquisitions, 1);
  });
  await t.test('detached work that already entered keeps the parent guard until it drains', async () => {
    const lease = createCatalogueLease(async () => async () => {}), entered = gate(), finish = gate(), parentBodyDone = gate(), exclusiveEntered = gate();
    let child;
    const parent = lease(() => {
      child = lease(async () => { entered.resolve(); await finish.promise; }, { mode: 'shared' });
      parentBodyDone.resolve();
    }, { mode: 'shared' });
    await parentBodyDone.promise; await entered.promise;
    let exclusiveRan = false;
    const exclusive = lease(() => { exclusiveRan = true; exclusiveEntered.resolve(); });
    assert.equal(exclusiveRan, false);
    finish.resolve(); await exclusiveEntered.promise; await Promise.all([parent, child, exclusive]);
  });
});
