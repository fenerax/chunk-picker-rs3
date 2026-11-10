// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { applyResidentCommand, createResidentState, materializeResidentState, validateState } from '../app/core/state.mjs';
import { fixture, first, second, custom, commands, taskCatalogue, world, now } from './helpers/owned-format2-fixture.mjs';
const json = JSON.stringify;
function roundtrip(state, built = fixture()) {
  const codec = ownedCodec(built.base, built.pin), resident = createResidentState(state, built.base);
  const encoded = JSON.parse(json(codec.encode(resident))), decoded = codec.decode(encoded).state;
  assert.equal(json(decoded), json(materializeResidentState(resident)));
  assert.equal(json(validateState(decoded)), json(validateState(state)));
  assert(!Object.hasOwn(encoded.state, 'tasks')); assert(!Object.hasOwn(encoded.state, 'identityRegistry'));
  return encoded;
}
test('owned codec preserves exact task JSON, slots, overrides, omissions and dictionary order', () => {
  const built = fixture(), { state } = built;
  state.tasks = [state.tasks[2], { category: 'Synthetic', id: first, label: 'Synthetic first' }, state.tasks[1]];
  state.identityRegistry.entries = Object.fromEntries(Object.entries(state.identityRegistry.entries).reverse());
  state.identityRegistry.aliases = { 'first-alias': first, collision: [second, first], 'synthetic-extra': first };
  const encoded = roundtrip(state, built);
  assert.deepEqual(encoded.storage.delta.tasks.recipe, [[1, 1], first, custom]);
  assert.deepEqual(encoded.storage.delta.identityRegistry.entries.order, Object.keys(state.identityRegistry.entries));
  state.tasks = [state.tasks[2]];
  delete state.identityRegistry.entries[second]; delete state.identityRegistry.aliases.collision;
  roundtrip(state, built);
});
test('default base span and absent versus empty registry survive without base copies on disk', () => {
  const built = fixture(), { state } = built;
  state.tasks = built.base.tasks;
  const encoded = roundtrip(state, built);
  assert.deepEqual(encoded.storage.delta.tasks, { replacements: {}, recipe: [[0, 2]] });
  assert.deepEqual(encoded.storage.delta.identityRegistry.entries, { replacements: {}, deleted: [] });
  delete state.identityRegistry;
  assert.deepEqual(roundtrip(state, built).storage.delta.identityRegistry, { present: false });
  state.identityRegistry = { unresolved: [], aliases: {}, entries: {}, schemaVersion: 1 };
  roundtrip(state, built);
});
test('malformed recipes, dictionary order, presence, pins and unknown metadata fail closed', () => {
  const built = fixture(), codec = ownedCodec(built.base, built.pin);
  const mutations = [
    doc => { doc.storage.schemaVersion = 3; },
    doc => { doc.storage.extra = true; },
    doc => { doc.storage.base.sha256 = 'a'.repeat(64); },
    doc => { doc.storage.delta.tasks.recipe = [[0, 3]]; },
    doc => { doc.storage.delta.tasks.recipe = [[0, 1], [0, 1]]; },
    doc => { doc.storage.delta.tasks.recipe = [[0, -1]]; },
    doc => { doc.storage.delta.tasks.recipe = ['missing']; },
    doc => { doc.storage.delta.tasks.replacements[custom].id = first; },
    doc => { doc.storage.delta.keys.push('tasks'); },
    doc => { doc.storage.delta.identityRegistry.present = 'true'; },
    doc => { doc.storage.delta.identityRegistry.entries.order = [first, first, first]; },
    doc => { doc.storage.delta.identityRegistry.aliases.deleted = ['missing']; },
  ];
  for (const mutate of mutations) {
    const document = JSON.parse(json(codec.encode(createResidentState(built.state, built.base))));
    mutate(document); assert.throws(() => codec.decode(document), TypeError);
  }
});
test('generated registration from an absent registry encodes over the release base without adding unrelated identities', () => {
  const built = fixture(); delete built.state.identityRegistry;
  const resident = applyResidentCommand(createResidentState(built.state, built.base), commands[0], { world, taskCatalogue, now });
  const codec = ownedCodec(built.base, built.pin), document = JSON.parse(json(codec.encode(resident)));
  assert.equal(json(codec.decode(document).state), json(materializeResidentState(resident)));
  assert(!Object.hasOwn(codec.decode(document).state.identityRegistry.entries, first));
});
