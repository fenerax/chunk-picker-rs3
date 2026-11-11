// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { registerOwnedCalculatorBase, ownedCalculatorInput, createOwnedCalculatorReceiver } from '../app/tasks/owned-transport.mjs';
import { createResidentState } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool, partnerConnections } from '../app/core/rules.mjs';
import { withIdentityDictionaryCallCountsForTests } from '../app/tasks/identity-dictionary.mjs';
import { fixture, options, now, world, first } from './helpers/owned-format2-fixture.mjs';

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

for (const kind of ['candidates', 'exclude', 'both']) test(`owned custom ${kind} hooks match format 1 through cache keys, snapshots and calculations`, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'owned-custom-rules-')), stores = [], calls = new Set();
  // The fixture's invented chunk IDs are its complete synthetic surface;
  // command validation must not inherit the real dataset's surface catalogue.
  const hookWorld = { ...world, surface: new Set(world.chunks.keys()) };
  t.after(async () => { for (const store of stores) await store.close(); await rm(directory, { recursive: true, force: true }); });
  const inspect = ({ state, member }, hook) => {
    calls.add(hook);
    assert.equal(member, state.members.find(row => row.id === member.id));
    assert.equal(Object.getPrototypeOf(state.identityRegistry.entries), Object.prototype);
    assert.equal(Object.getPrototypeOf(state.identityRegistry.aliases), Object.prototype);
    assert.equal(state.identityRegistry.entries[first].label, 'Synthetic first');
    assert.equal(state.identityRegistry.aliases['first-alias'], first);
    assert.ok(Object.isFrozen(state.identityRegistry.entries[first]));
    assert.ok(Object.isFrozen(state.identityRegistry.aliases));
    assert.throws(() => { state.identityRegistry.entries[first].label = 'Changed by hook'; }, TypeError);
    assert.throws(() => member.selected.push('102'), TypeError);
    assert.equal(JSON.parse(JSON.stringify(state)).identityRegistry.entries[first].label, 'Synthetic first');
  };
  const registry = createRuleRegistry([
    ...(kind === 'exclude' ? [] : [{ id: 'house.candidates', type: 'boolean', default: true, candidates(context) {
      inspect(context, 'candidates');
      return [{ id: '101', detail: `${context.state.identityRegistry.entries[first].label}: ${context.member.notes?.['100'] ?? 'initial'}` }];
    } }]),
    ...(kind === 'candidates' ? [] : [{ id: 'house.exclude', type: 'boolean', default: true, exclude(context) {
      inspect(context, 'exclude');
      return context.candidateId === '101' && context.member.notes?.['100'] !== 'allow' ? 'Synthetic custom exclusion.' : null;
    } }]),
  ]);
  const state = fixture().state;
  state.members[0].selected = ['100', '101'];
  for (const owned of [false, true]) {
    const store = await openStore({ dataDir: path.join(directory, owned ? 'owned' : 'flat'), initialState: state,
      world: hookWorld, registry, now, retention: false, completionCodec: false,
      ownedFormat2: owned ? options(path.join(directory, 'catalogue')) : false });
    stores.push(store);
  }
  const [flat, owned] = stores, memberId = 'member-1';
  const parity = async () => {
    // The capture is a separate path from the response pool cache. Its complete
    // custom-rule input must also be portable despite resident dictionaries.
    assert.deepEqual(JSON.parse(owned.getCalculationSnapshot().rollInputKey), JSON.parse(flat.getCalculationSnapshot().rollInputKey));
    for (const view of [undefined, 'play-v1']) {
      const one = await flat.getStateSnapshot({ view }), two = await owned.getStateSnapshot({ view });
      assert.deepEqual(two.pools, one.pools);
      assert.deepEqual(JSON.parse(two.stateJSON), JSON.parse(one.stateJSON));
    }
    // Callers of getCalculationState retain the resident path. The rules
    // boundary must cover direct evaluation and partner travel evidence too.
    assert.deepEqual(evaluateRollPool(hookWorld, owned.getCalculationState(), memberId, registry),
      evaluateRollPool(hookWorld, flat.getCalculationState(), memberId, registry));
    assert.deepEqual(partnerConnections(hookWorld, owned.getCalculationState(), memberId, registry),
      partnerConnections(hookWorld, flat.getCalculationState(), memberId, registry));
  };
  await parity();
  const before = owned.getCalculationSnapshot().rollInputKey;
  if (kind !== 'candidates') assert.ok(owned.getStateSnapshot().pools[memberId].excluded.some(row => row.id === '101'));
  const command = { type: 'set-note', memberId, chunkId: '100', note: 'allow' };
  const one = await flat.commandSerialized(command, 0, { view: 'play-v1' });
  const two = await owned.commandSerialized(command, 0, { view: 'play-v1' });
  assert.deepEqual(two.pools, one.pools);
  assert.deepEqual(JSON.parse(two.stateJSON), JSON.parse(one.stateJSON));
  assert.notEqual(owned.getCalculationSnapshot().rollInputKey, before, 'custom hooks can read notes, so note edits invalidate their input');
  await parity();
  assert.ok(owned.getStateSnapshot().pools[memberId].eligible.some(row => row.id === '101'));
  assert.deepEqual([...calls].sort(), kind === 'both' ? ['candidates', 'exclude'] : [kind]);
});
