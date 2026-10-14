import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, applyValidatedCommand, createGroupState, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';

const invite = { kind: 'invite', inviteId: 'invite_reed', label: 'Reed' };
const master = { kind: 'master', label: 'Player' };
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const now = () => '2026-10-08T12:00:00.000Z';
const world = { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
const initial = () => createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'bbb' }, { id: 'reed', name: 'Reed', sourceMapId: 'aaa' }]);

async function directory(t) {
  const root = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'invite-attribution-'));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(root) + path.sep));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('only trusted caller options attribute commands and actors remain detached snapshots', () => {
  for (const apply of [applyCommand, applyValidatedCommand]) {
    const actor = { ...invite };
    const before = initial();
    const state = apply(before, command, { actor, now });
    actor.label = 'Changed later';
    assert.deepEqual(state.history[0].actor, invite);
    assert.ok(!Object.hasOwn(state.history[0].command, 'actor'));
    assert.deepEqual(before.history, []);
    assert.throws(() => apply(before, { ...command, actor: master }, { actor: invite }), /Unknown command field: actor/);
    assert.ok(!Object.hasOwn(apply(before, command).history[0], 'actor'), 'legacy callers have no inferred actor');
    assert.deepEqual(importBackup(exportBackup(state)), state);
  }
});


test('actor schema rejects credentials, unsafe identifiers and unbounded labels in active and preserved history', () => {
  const state = applyCommand(initial(), command, { actor: invite, now });
  const invalid = [null, { ...invite, token: 'secret' }, { ...invite, tokenHash: 'secret' }, { ...invite, accessToken: 'secret' },
    { ...invite, label: 'x'.repeat(81) }, { ...invite, label: 'Reed\n' }, { ...invite, label: ' Reed' },
    { ...invite, inviteId: '../private' }, { ...invite, inviteId: 'x'.repeat(129) }, { ...master, inviteId: 'unexpected' },
    { ...invite, kind: 'member' }];
  for (const actor of invalid) {
    assert.throws(() => applyCommand(initial(), command, { actor }), /actor/i);
    const malformed = structuredClone(state);
    malformed.history[0].actor = actor;
    assert.throws(() => validateState(malformed), /actor/i);
    for (const field of ['incomingHistory', 'previousHistory', 'migrationHistory']) {
      const archived = initial();
      const events = [{ ...state.history[0], actor }];
      archived.provenance = field === 'migrationHistory' ? { taskIdentityMigration: { archives: [{ history: events }] } }
        : { restore: { [field]: events } };
      assert.throws(() => importBackup({ ...exportBackup(initial()), state: archived }), /actor/i);
    }
  }
});

test('store keeps attribution through queued saves, serialized responses, archives, restore and restart', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir, initialState: initial(), world, now, retention: { historyEntries: 2 } });
  t.after(() => store.close());
  const actor = { ...invite };
  const pending = store.command(command, 0, { actor });
  actor.label = 'Caller mutation';
  await pending;
  const incoming = await store.backup();
  const serialized = await store.commandSerialized({ ...command, value: true }, 1, { actor: master, omitUnchanged: true });
  assert.deepEqual(JSON.parse(serialized.stateJSON).history.map(event => event.actor), [invite, master]);
  for (let revision = 2; revision < 7; revision++) await store.command({ ...command, value: Boolean(revision % 2) }, revision, { actor: invite });
  assert.ok(store.getState().provenance.historyArchive.length > 0);
  const complete = await store.backup();
  assert.equal(complete.state.history.length, 7);
  assert.deepEqual(complete.state.history.map(event => event.actor), [invite, master, invite, invite, invite, invite, invite]);
  await store.command({ type: 'undo' }, 7, { actor: master });
  const beforeRestore = await store.backup();
  assert.deepEqual(beforeRestore.state.history.at(-1).actor, master);
  const preview = await store.previewReplacement(incoming, { actor: master });
  assert.deepEqual(preview.state.history[0].actor, master);
  assert.equal(store.getState().revision, 8);
  const restored = await store.replace(incoming, 8, { actor: master });
  assert.deepEqual(restored.history[0].actor, master);
  assert.deepEqual(restored.provenance.restore.incomingHistory, incoming.state.history);
  assert.deepEqual(restored.provenance.restore.previousHistory, beforeRestore.state.history);
  const pinned = (await store.listBackups()).find(item => item.revision === 8);
  assert.deepEqual(await store.readBackup(pinned.id), beforeRestore);
  const exported = await store.backup();
  assert.deepEqual(importBackup(exported), restored);
  await store.close();
  const restarted = await openStore({ dataDir, now });
  t.after(() => restarted.close());
  assert.deepEqual(restarted.getState(), restored);
  await restarted.command(command, 9);
  assert.ok(!Object.hasOwn(restarted.getState().history.at(-1), 'actor'));
  await assert.rejects(async () => restarted.command({ ...command, actor: invite }, 10, { actor: master }), /Unknown command field: actor/);
  await assert.rejects(async () => restarted.replace(exported, 10, { actor: { ...invite, token: 'secret' } }), /actor/i);
  assert.equal(restarted.getState().revision, 10);
});
