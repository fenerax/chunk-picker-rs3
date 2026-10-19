import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'rs3-action-acknowledgements-'));
after(() => rm(fixtureRoot, { recursive: true, force: true }));
process.env.RS3_DATASET = 'open-f2p';
const { openStore } = await import('../app/storage/store.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { ACTION_CLIENT_SLOTS } = await import('../app/storage/action-receipts.mjs');
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const requestId = (session, sequence = session.sequence + 1) => session.scope
  ? `v3.${session.scope}.${session.slot}.${session.generation}.${sequence}`
  : `v2.${session.slot}.${session.generation}.${sequence}`;
const ack = (session, sequence = session.sequence + 1) => ({ slot: session.slot, generation: session.generation,
  sequence, ...(session.scope ? { scope: session.scope } : {}) });

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(fixtureRoot, 'fixture-')), stores = [];
  t.after(async () => {
    for (const store of stores.reverse()) await store.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const open = async (options = {}) => {
    const store = await openStore({ dataDir, retention: false, liveSwapStrict: true,
      world: { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() },
      initialState: createGroupState([{ id: 'one', name: 'Synthetic One' }]), ...options });
    stores.push(store); return store;
  };
  return { dataDir, open, file: path.join(dataDir, 'state.json'), sidecar: path.join(dataDir, 'action-acknowledgements.json') };
}

async function pending(f, options) {
  const store = await f.open(options), clientId = randomUUID(), session = await store.openActionSession(clientId);
  const id = requestId(session); await store.command(command, 0, { requestId: id });
  return { store, clientId, session, id };
}

test('standalone ACK synchronizes only a bounded sidecar and keeps exact state bytes and mtime', async t => {
  const f = await fixture(t), { store, clientId, session, id } = await pending(f);
  const bytes = await readFile(f.file);
  await utimes(f.file, new Date('2001-01-01'), new Date('2001-01-01'));
  const before = await stat(f.file);
  const confirmed = await store.acknowledgeActionSession(clientId, ack(session));
  assert.equal(confirmed.acknowledged, 1);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs);
  assert.ok(JSON.parse(bytes).actionReceipts.slots[0].receipt, 'Original action receipt remains atomically in state.json.');
  await assert.rejects(() => store.command(command, 1, { requestId: id }), { code: 'REQUEST_ACKNOWLEDGED' });
  const sidecar = await readFile(f.sidecar), document = JSON.parse(sidecar);
  assert.equal(document.entries.length, 1); assert.equal(document.entries[0].scope, session.scope);
  assert.equal(document.entries[0].requestId, id); assert.ok(sidecar.length < 1024);
  const sidecarBefore = await stat(f.sidecar);
  await store.acknowledgeActionSession(clientId, ack(session));
  assert.equal((await stat(f.sidecar)).mtimeMs, sidecarBefore.mtimeMs);
  assert.deepEqual(await readFile(f.sidecar), sidecar);
});

test('restart merges matching ACKs without rewriting state or the sidecar', async t => {
  const f = await fixture(t), { store, clientId, session, id } = await pending(f);
  await store.acknowledgeActionSession(clientId, ack(session)); await store.close();
  const bytes = await readFile(f.file), sidecar = await readFile(f.sidecar), before = await stat(f.sidecar);
  const reopened = await f.open();
  await assert.rejects(() => reopened.command(command, 1, { requestId: id }), { code: 'REQUEST_ACKNOWLEDGED' });
  assert.deepEqual(await readFile(f.file), bytes); assert.deepEqual(await readFile(f.sidecar), sidecar);
  assert.equal((await stat(f.sidecar)).mtimeMs, before.mtimeMs);
  assert.equal(reopened.getState().revision, 1);
});

test('the next command embeds the ACK and action together without another sidecar write', async t => {
  const f = await fixture(t); let commits = 0;
  const { store, clientId, session } = await pending(f, { beforeCommit() { commits++; } });
  await store.acknowledgeActionSession(clientId, ack(session));
  const sidecar = await readFile(f.sidecar), before = await stat(f.sidecar);
  await store.command({ ...command, value: true }, 1, { requestId: requestId(session, 2), requestAck: 1 });
  assert.equal(commits, 2, 'Exactly one state replacement per command.');
  const row = JSON.parse(await readFile(f.file)).actionReceipts.slots[0];
  assert.equal(row.acknowledged, 1); assert.equal(row.sequence, 2); assert.equal(row.receipt.revision, 2);
  assert.deepEqual(await readFile(f.sidecar), sidecar); assert.equal((await stat(f.sidecar)).mtimeMs, before.mtimeMs);
  await store.close(); const reopened = await f.open();
  const replay = await reopened.commandSerialized({ ...command, value: true }, 2, { requestId: requestId(session, 2) });
  assert.equal(replay.receipt.revision, 2);
});

test('ACK write failure retains the replayable outcome in memory and on disk', async t => {
  const f = await fixture(t), { store, clientId, session, id } = await pending(f);
  const bytes = await readFile(f.file); await mkdir(f.sidecar);
  await assert.rejects(() => store.acknowledgeActionSession(clientId, ack(session)));
  const replay = await store.commandSerialized(command, 1, { requestId: id });
  assert.equal(replay.receipt.revision, 1); assert.deepEqual(await readFile(f.file), bytes);
  await store.close(); const reopened = await f.open();
  assert.equal((await reopened.commandSerialized(command, 1, { requestId: id })).receipt.revision, 1);
  await rm(f.sidecar, { recursive: true });
  await reopened.acknowledgeActionSession(clientId, ack(session));
});

test('standby activation reloads ACKs committed after its initial read', async t => {
  const f = await fixture(t), { store, clientId, session, id } = await pending(f);
  const standby = await f.open({ readOnly: true }), names = await readdir(f.dataDir), bytes = await readFile(f.file);
  await assert.rejects(() => standby.acknowledgeActionSession(clientId, ack(session)), { code: 'PICKER_UPDATING' });
  assert.deepEqual(await readdir(f.dataDir), names);
  await store.acknowledgeActionSession(clientId, ack(session));
  const sidecar = await readFile(f.sidecar), before = await stat(f.sidecar);
  const checkpoint = await store.freeze(); await store.close(); await standby.activate(checkpoint);
  await assert.rejects(() => standby.command(command, 1, { requestId: id }), { code: 'REQUEST_ACKNOWLEDGED' });
  assert.deepEqual(await readFile(f.file), bytes); assert.deepEqual(await readFile(f.sidecar), sidecar);
  assert.equal((await stat(f.sidecar)).mtimeMs, before.mtimeMs);
});

test('stale ACK identities cannot prune a different durable receipt', async t => {
  for (const field of ['clientId', 'generation', 'principal', 'scope', 'sequence', 'requestId', 'fingerprint', 'revision']) {
    await t.test(field, async t => {
      const f = await fixture(t), { store, clientId, session, id } = await pending(f);
      await store.acknowledgeActionSession(clientId, ack(session)); await store.close();
      const document = JSON.parse(await readFile(f.sidecar)), entry = document.entries[0];
      entry[field] = typeof entry[field] === 'number' ? entry[field] + 1 : `${entry[field]}-stale`;
      await writeFile(f.sidecar, JSON.stringify(document));
      const reopened = await f.open();
      assert.equal((await reopened.commandSerialized(command, 1, { requestId: id })).receipt.revision, 1);
    });
  }
});

test('receipt loss and same-client re-registration reject both the old sidecar and delayed ACK', async t => {
  const f = await fixture(t), { store, clientId, session } = await pending(f);
  await store.acknowledgeActionSession(clientId, ack(session)); await store.close();
  const document = JSON.parse(await readFile(f.file)); delete document.actionReceipts;
  await writeFile(f.file, JSON.stringify(document));
  const reopened = await f.open(), next = await reopened.openActionSession(clientId), id = requestId(next);
  assert.notEqual(next.scope, session.scope);
  await reopened.command({ ...command, value: true }, 1, { requestId: id });
  await assert.rejects(() => reopened.acknowledgeActionSession(clientId, ack(session)), { code: 'ACTION_SESSION_RETIRED' });
  assert.equal((await reopened.commandSerialized({ ...command, value: true }, 2, { requestId: id })).receipt.revision, 2);
  await reopened.close(); const latest = await f.open();
  assert.equal((await latest.commandSerialized({ ...command, value: true }, 2, { requestId: id })).receipt.revision, 2);
});

test('malformed or excessive ACK sidecars conservatively retain pending outcomes', async t => {
  for (const bytes of ['{broken', 'null', JSON.stringify({ schemaVersion: 1, entries: Array(33).fill({ slot: 0 }) }), ' '.repeat(65537)]) {
    await t.test(`sidecar ${bytes.length} bytes`, async t => {
      const f = await fixture(t), { store, id } = await pending(f); await store.close();
      await writeFile(f.sidecar, bytes); const reopened = await f.open();
      assert.equal((await reopened.commandSerialized(command, 1, { requestId: id })).receipt.revision, 1);
      assert.equal(await readFile(f.sidecar, 'utf8'), bytes);
    });
  }
});

test('ACK records remain bounded across slot reuse without pruning an unacknowledged new outcome', async t => {
  const f = await fixture(t), store = await f.open();
  for (let revision = 0; revision < ACTION_CLIENT_SLOTS + 3; revision++) {
    const clientId = randomUUID(), session = await store.openActionSession(clientId);
    const nextCommand = { ...command, value: revision % 2 === 1 };
    await store.command(nextCommand, revision, { requestId: requestId(session) });
    await store.acknowledgeActionSession(clientId, ack(session));
  }
  const sidecar = await readFile(f.sidecar), records = JSON.parse(sidecar).entries;
  assert.equal(records.length, ACTION_CLIENT_SLOTS); assert.equal(new Set(records.map(row => row.slot)).size, ACTION_CLIENT_SLOTS);
  assert.ok(sidecar.length < 32 * 1024);
  const next = await store.openActionSession(randomUUID()), id = requestId(next), revision = store.getState().revision;
  const nextCommand = { ...command, value: true };
  await store.command(nextCommand, revision, { requestId: id }); await store.close();
  const reopened = await f.open();
  assert.equal((await reopened.commandSerialized(nextCommand, revision + 1, { requestId: id })).receipt.revision, revision + 1);
});

test('legacy unscoped bridge rows require the exact retained receipt identity', async t => {
  const f = await fixture(t), { store, clientId, session } = await pending(f); await store.close();
  const document = JSON.parse(await readFile(f.file)), row = document.actionReceipts.slots[0];
  delete row.scope; const legacySession = { ...session }; delete legacySession.scope;
  row.receipt.requestId = requestId(legacySession); await writeFile(f.file, JSON.stringify(document));
  const reopened = await f.open(); await reopened.acknowledgeActionSession(clientId, ack(legacySession)); await reopened.close();
  const latest = await f.open();
  await assert.rejects(() => latest.command(command, 1, { requestId: requestId(legacySession) }), { code: 'REQUEST_ACKNOWLEDGED' });
});
