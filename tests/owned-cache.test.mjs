// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { registerOwnedCalculatorBase, ownedCalculatorInput, createOwnedCalculatorReceiver } from '../app/tasks/owned-transport.mjs';
import { createResidentState } from '../app/core/state.mjs';
import { withIdentityDictionaryCallCountsForTests } from '../app/tasks/identity-dictionary.mjs';
import { fixture, options, now, world } from './helpers/owned-format2-fixture.mjs';

test('ordinary owned plugin currency observations and coalescing share the base', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'owned-cache-'));
  let store;
  t.after(async () => { await store?.close(); await rm(directory, { recursive: true, force: true }); });
  store = await openStore({ dataDir: path.join(directory, 'group'), initialState: fixture().state, world, now,
    completionCodec: false, retention: false, ownedFormat2: options(path.join(directory, 'catalogue')) });
  const report = { memberId: 'member-1', keyId: '11111111-1111-1111-1111-111111111111', sentAt: now() };
  await withIdentityDictionaryCallCountsForTests(async counts => {
    await store.observePluginCurrency({ ...report, seq: 1, coins: 100 });
    await store.observePluginCurrency({ ...report, seq: 2, coins: 200 });
    assert.equal(counts.materializations, 0); assert.equal(counts.fullCopies, 0);
  });
  assert.equal(store.getState().members[0].transportFacts.currencies.coins, 200);
  assert.equal(store.getState().history.filter(event => event.type === 'set-transport-facts').length, 1);
});

test('an installed digest still refuses contradictory release metadata', () => {
  const f = fixture(); registerOwnedCalculatorBase(f.base, f.pin);
  const input = ownedCalculatorInput(createResidentState(f.state, f.base)), receive = createOwnedCalculatorReceiver(f.pin.dataset.digest);
  receive(structuredClone(input));
  for (const change of [{ dataset: { ...f.pin.dataset, id: 'different-synthetic' } },
    { dataset: { ...f.pin.dataset, contractVersion: 2 } }, { generatorVersion: 2 }]) {
    assert.throws(() => receive({ ...input, installation: { ...input.installation, pin: { ...f.pin, ...change } } }), { code: 'OWNED_CALCULATOR_BASE_REFUSED' });
  }
  assert.equal(receive({ document: structuredClone(input.document) }).tasks[0].id, f.state.tasks[0].id);
});
