import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

// Establish the isolated destination before importing any application module.
// Every store below receives this fixture and an explicit synthetic seed.
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'rs3-receipt-quarantine-'));
after(() => rm(fixtureRoot, { recursive: true, force: true }));
process.env.RS3_DATASET = 'open-f2p';
const { openStore } = await import('../app/storage/store.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const requestId = session => `v3.${session.scope}.${session.slot}.${session.generation}.${session.sequence + 1}`;
const retiredWithoutProof = error => error.code === 'ACTION_SESSION_RETIRED' && error.safeToRetry !== true;

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
  const first = await open(); await first.close();
  return { dataDir, open, file: path.join(dataDir, 'state.json') };
}

async function corrupt(file, ledger) {
  const document = JSON.parse(await readFile(file)); document.actionReceipts = ledger;
  const bytes = `  ${JSON.stringify(document, null, 2)}\n`;
  await writeFile(file, bytes); return bytes;
}

test('invalid private ledgers leave valid gameplay and startup bytes intact', async t => {
  for (const ledger of [null, [], 'damaged', { format: 2, slots: [{}] }, { format: 99, slots: [] }]) {
    await t.test(JSON.stringify(ledger), async t => {
      const f = await fixture(t), bytes = await corrupt(f.file, ledger), before = await stat(f.file);
      const store = await f.open();
      assert.equal(store.getState().revision, 0);
      assert.equal((await store.backup()).state.members[0].name, 'Synthetic One');
      assert.equal(await readFile(f.file, 'utf8'), bytes);
      assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs);
      assert.ok(!(await readdir(f.dataDir)).includes('receipt-quarantine'));
      const checkpoint = await store.freeze();
      assert.equal(checkpoint.sha256, createHash('sha256').update(bytes).digest('hex'));
    });
  }
});

test('the next explicit mutation retains rejected evidence before replacing the ledger', async t => {
  const f = await fixture(t), damaged = { format: 2, slots: [{ sequence: -1, note: 'synthetic evidence' }] };
  await corrupt(f.file, damaged);
  let store = await f.open();
  await assert.rejects(() => store.command(command, 0, { requestId: 'v2.0.1.1' }), retiredWithoutProof);
  await store.command(command, 0);
  assert.equal(store.getState().revision, 1);
  const document = JSON.parse(await readFile(f.file));
  assert.equal(document.actionReceipts, undefined);
  const quarantineDir = path.join(f.dataDir, 'receipt-quarantine'), names = await readdir(quarantineDir);
  assert.equal(names.length, 1);
  const evidenceBytes = await readFile(path.join(quarantineDir, names[0]));
  assert.equal(names[0], `${createHash('sha256').update(evidenceBytes).digest('hex')}.json`);
  const evidence = JSON.parse(evidenceBytes);
  assert.deepEqual(evidence.actionReceipts, damaged); assert.equal(evidence.revision, 0);
  assert.match(evidence.reason, /Invalid/);
  assert.equal((await store.backup()).actionReceipts, undefined);
  await store.close(); store = await f.open();
  await store.command({ ...command, value: true }, 1);
  assert.deepEqual(await readdir(quarantineDir), names);
  assert.deepEqual(await readFile(path.join(quarantineDir, names[0])), evidenceBytes);
});

test('failed state replacement preserves both the original document and quarantine evidence', async t => {
  const f = await fixture(t), bytes = await corrupt(f.file, { format: 2, slots: [{}] });
  let fail = true;
  const store = await f.open({ beforeCommit() { if (fail) throw new Error('Synthetic commit failure'); } });
  await assert.rejects(() => store.command(command, 0), /Synthetic commit failure/);
  assert.equal(store.getState().revision, 0); assert.equal(await readFile(f.file, 'utf8'), bytes);
  assert.equal((await readdir(path.join(f.dataDir, 'receipt-quarantine'))).length, 1);
  fail = false; await store.command(command, 0);
  assert.equal(store.getState().revision, 1);
  assert.equal((await readdir(path.join(f.dataDir, 'receipt-quarantine'))).length, 1);
});

test('evidence storage failure refuses the mutation without losing the corrupt source', async t => {
  const f = await fixture(t), bytes = await corrupt(f.file, { format: 2, slots: [{}] });
  await writeFile(path.join(f.dataDir, 'receipt-quarantine'), 'Synthetic obstruction');
  const store = await f.open();
  await assert.rejects(() => store.command(command, 0), error => ['EEXIST', 'ENOTDIR'].includes(error.code));
  assert.equal(store.getState().revision, 0); assert.equal(await readFile(f.file, 'utf8'), bytes);
});

test('corrupt committed outcomes retire old IDs even after the same client registers again', async t => {
  const f = await fixture(t), clientId = randomUUID();
  let store = await f.open(), session = await store.openActionSession(clientId), oldId = requestId(session);
  await store.command(command, 0, { requestId: oldId }); await store.close();
  const damaged = JSON.parse(await readFile(f.file)).actionReceipts;
  damaged.slots[0].receipt.revision = 2;
  const bytes = await corrupt(f.file, damaged);
  store = await f.open();
  await assert.rejects(() => store.command(command, 1, { requestId: oldId }), retiredWithoutProof);
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  session = await store.openActionSession(clientId);
  assert.notEqual(requestId(session), oldId);
  await assert.rejects(() => store.command(command, 1, { requestId: oldId }), retiredWithoutProof);
  assert.equal(store.getState().revision, 1); assert.equal(store.getState().history.length, 1);
  await store.command({ ...command, value: true }, 1, { requestId: requestId(session) });
  assert.equal(store.getState().revision, 2);
});

test('older-release receipt loss cannot recreate a committed request ID', async t => {
  const f = await fixture(t), clientId = randomUUID();
  let store = await f.open(), session = await store.openActionSession(clientId), oldId = requestId(session);
  await store.command(command, 0, { requestId: oldId }); await store.close();
  // Older releases preserve gameplay while dropping unrecognized private data.
  const document = JSON.parse(await readFile(f.file)); delete document.actionReceipts;
  const bytes = JSON.stringify(document); await writeFile(f.file, bytes);
  store = await f.open();
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  await assert.rejects(() => store.command(command, 1, { requestId: oldId }), retiredWithoutProof);
  session = await store.openActionSession(clientId);
  assert.notEqual(requestId(session), oldId);
  await assert.rejects(() => store.command(command, 1, { requestId: oldId }), retiredWithoutProof);
  assert.equal(store.getState().revision, 1); assert.equal(store.getState().history.length, 1);
  assert.ok(!(await readdir(f.dataDir)).includes('receipt-quarantine'));
});

test('valid ledgers retain exact replay behavior without quarantine or startup rewrites', async t => {
  const f = await fixture(t);
  let store = await f.open();
  const session = await store.openActionSession(randomUUID()), id = requestId(session);
  const first = await store.commandSerialized(command, 0, { requestId: id }); await store.close();
  const bytes = await readFile(f.file), before = await stat(f.file);
  store = await f.open();
  const replay = await store.commandSerialized(command, 0, { requestId: id });
  assert.deepEqual(replay.receipt, first.receipt); assert.equal(store.getState().revision, 1);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs);
  assert.ok(!(await readdir(f.dataDir)).includes('receipt-quarantine'));
});

test('standby and strict activation keep the exact corrupt-ledger checkpoint until mutation', async t => {
  const f = await fixture(t), bytes = await corrupt(f.file, { format: 2, slots: [{}] });
  const writer = await f.open(), standby = await f.open({ readOnly: true });
  const names = await readdir(f.dataDir);
  await assert.rejects(() => standby.command(command, 0), { code: 'PICKER_UPDATING' });
  assert.deepEqual(await readdir(f.dataDir), names); assert.equal(await readFile(f.file, 'utf8'), bytes);
  const checkpoint = await writer.freeze(); await writer.close();
  await assert.rejects(() => standby.activate({ ...checkpoint, sha256: '0'.repeat(64) }), /checkpoint changed/);
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  await standby.activate(checkpoint);
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  assert.ok(!(await readdir(f.dataDir)).includes('receipt-quarantine'));
  await standby.command(command, 0);
  assert.equal((await readdir(path.join(f.dataDir, 'receipt-quarantine'))).length, 1);
  assert.equal(standby.getState().revision, 1);
});
