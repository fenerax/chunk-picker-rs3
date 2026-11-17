// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestSave } from '../app/web/guest-save.mjs';
import { createGuestTransport } from '../app/web/guest-transport.mjs';

const dataset = { id: 'synthetic', digest: 'a'.repeat(64) };
const fresh = () => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1, revision: 0,
  members: [{ id: 'guest', unlocked: ['12850'] }], provenance: { dataset }, rules: {}, tasks: [], history: [] } });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('shared picker adapter keeps commands browser-owned and shares task reads without authenticated requests', async () => {
  const local = storage(), requests = [];
  const network = async (route, options) => {
    assert.match(route, /^\/guest\//);
    assert.equal(options.credentials, 'omit');
    if (route === '/guest/api/session') return Response.json({ token: 'synthetic', dataset });
    const body = JSON.parse(options.body); requests.push(body.operation);
    if (body.operation === 'new' || body.operation === 'load') return Response.json({ backup: body.backup ?? fresh(), pool: { eligible: [] }, bootstrap: { definitions: {}, world: {}, rules: {} } });
    if (body.operation === 'tasks') return Response.json({ result: { memberId: 'guest', stateRevision: body.backup.state.revision, tasks: [] } });
    if (body.operation === 'command') return Response.json({ backup: { ...body.backup, state: { ...body.backup.state, revision: body.backup.state.revision + 1 } }, pool: { eligible: [] } });
    throw new Error('Unexpected operation');
  };
  let lockCount = 0;
  const options = { fetch: network, storage: local, tabStorage: storage(), locks: { request: async (key, write) => { lockCount++; return write(); } } };
  const guest = await createGuestTransport(options);
  const [one, two] = await Promise.all([guest.api('/api/tasks?view=play-v1'), guest.api('/api/tasks')]);
  assert.equal(one, two); assert.equal(requests.filter(value => value === 'tasks').length, 1);
  await guest.commandClient.send({ command: { type: 'set-note' }, expectedRevision: 0 });
  assert.equal(guest.backup.state.revision, 1); assert.equal(lockCount, 2);
  const reloaded = await createGuestTransport(options);
  assert.equal(reloaded.backup.state.revision, 1);
  const oldSave = JSON.stringify(fresh());
  await reloaded.importText(oldSave);
  const restored = await createGuestTransport(options);
  assert.equal(restored.backup.state.revision, 0, 'Replacement starts from the imported revision after reload');
  await restored.commandClient.send({ command: { type: 'set-note' }, expectedRevision: 0 });
  assert.equal(restored.backup.state.revision, 1, 'Commands work immediately after an older import reloads');
  const synchronized = await createGuestTransport(options);
  await guest.commandClient.send({ command: { type: 'set-note' }, expectedRevision: 1 });
  await assert.rejects(synchronized.commandClient.send({ command: { type: 'set-note' }, expectedRevision: 1 }), /another tab/);
  await assert.rejects(guest.api('/api/invites', {}), /Sign in/);
  assert.equal(guest.commandClient.pending(), null, 'Guest commands never enter the authenticated outbox');
});

test('guest adapter distinguishes compact Why from full Why not? selectors', async () => {
  const requests = [];
  const guest = await createGuestTransport({ storage: storage(), tabStorage: storage(), locks: { request: async (_, work) => work() },
    fetch: async (route, options) => {
      if (route.endsWith('/session')) return Response.json({ token: 'synthetic', dataset });
      const body = JSON.parse(options.body); requests.push(body);
      if (body.operation === 'new') return Response.json({ backup: fresh(), pool: {}, bootstrap: {} });
      if (body.operation === 'why') return Response.json({ why: { format: 'task-why-display-v1', task: { id: body.taskId }, memberId: 'guest', stateRevision: 0 } });
      if (body.operation === 'why-chain') return Response.json({ chain: { root: { label: 'Synthetic requirement' }, memberId: 'guest', stateRevision: 0 } });
      throw new Error('Unexpected guest operation');
    } });
  assert.equal((await guest.api('/api/task-why?view=display-v1&taskId=example')).task.id, 'example');
  assert.equal((await guest.api('/api/task-why?taskId=example')).root.label, 'Synthetic requirement');
  assert.deepEqual(requests.at(-1).selector, { taskId: 'example' });
  await guest.api('/api/task-why?master=Example&assignment=Target');
  assert.deepEqual(requests.at(-1).selector, { master: 'Example', assignment: 'Target' });
});

test('shared picker adapter refuses failed browser commits before acknowledging a new revision', async () => {
  const local = storage(), initial = fresh();
  const saved = createGuestSave(local, dataset); saved.load(); saved.commit(initial);
  const guest = await createGuestTransport({ storage: local, tabStorage: storage(), locks: { request: async (_, work) => work() },
    fetch: async (route, options) => {
      if (route.endsWith('/session')) return Response.json({ token: 'synthetic', dataset });
      const body = JSON.parse(options.body);
      return Response.json({ backup: body.operation === 'command' ? { ...initial, state: { ...initial.state, revision: 1 } } : initial, pool: {}, bootstrap: {} });
    } });
  local.setItem = () => { throw new Error('quota'); };
  await assert.rejects(guest.commandClient.send({ command: { type: 'set-note' } }), /not saved/);
  assert.equal(guest.backup.state.revision, 0);
  assert.equal(JSON.parse(guest.save.exportText()).state.revision, 0);
});
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
