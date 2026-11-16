// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestSave } from '../app/web/guest-save.mjs';

const dataset = { id: 'synthetic', digest: 'a'.repeat(64) };
const fresh = () => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1, revision: 0,
  members: [{ id: 'guest', unlocked: ['12850'] }], provenance: { dataset }, rules: {}, tasks: [], history: [] } });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('browser guest save survives reload, export and import in the existing portable envelope', () => {
  const local = storage(), first = createGuestSave(local, dataset);
  assert.equal(first.load(), null); first.commit(fresh());
  const reloaded = createGuestSave(local, dataset);
  assert.deepEqual(reloaded.load(), fresh());
  const exported = reloaded.exportText();
  const elsewhere = createGuestSave(storage(), dataset); elsewhere.load();
  elsewhere.commit(elsewhere.parseImport(exported));
  assert.equal(elsewhere.exportText(), exported);
  assert.notEqual(createGuestSave(local, { ...dataset, digest: 'b'.repeat(64) }).key, first.key);
});
test('unreadable, unavailable, oversized and failed storage never erase the saved bytes', () => {
  const local = storage(), save = createGuestSave(local, dataset);
  local.setItem(save.key, '{broken');
  assert.throws(() => save.load(), /cannot be read/); assert.equal(save.exportText(), '{broken');
  local.setItem(save.key, JSON.stringify(fresh())); save.load();
  const before = save.exportText();
  for (const incoming of [{}, { ...fresh(), schemaVersion: 2 }, { ...fresh(), state: { ...fresh().state, members: [{ id: 'a' }, { id: 'b' }] } }]) {
    assert.throws(() => save.parseImport(JSON.stringify(incoming)), /solo save/);
  }
  assert.throws(() => save.parseImport('x'.repeat(2 * 1024 ** 2)), /too large/);
  local.setItem = () => { throw new Error('quota'); };
  assert.throws(() => save.commit({ ...fresh(), state: { ...fresh().state, revision: 1 } }), /not saved/);
  assert.equal(save.exportText(), before);
  assert.throws(() => createGuestSave({ getItem() { throw new Error('blocked'); } }, dataset).load(), /unavailable/);
});
test('stale tabs cannot overwrite another tab and only reload adopts the changed base', () => {
  const local = storage(), first = createGuestSave(local, dataset), second = createGuestSave(local, dataset);
  first.load(); first.commit(fresh()); second.load();
  const changed = fresh(); changed.state.revision++;
  first.commit(changed);
  assert.equal(second.changed(), true); assert.throws(() => second.commit(fresh()), /another tab/);
  assert.deepEqual(second.load(), changed); second.commit(changed);
});
