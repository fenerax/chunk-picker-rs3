import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ACTION_CLIENT_SLOTS, openActionSession, acknowledgeActionSession, inspectActionReceipt, commitActionReceipt, loadActionReceipts, actionFingerprint } from '../app/storage/action-receipts.mjs';

const requestId = (ledger, sequence = 1, slot = 0) => { const row = ledger.slots[slot]; return row.scope ? `v3.${row.scope}.${slot}.${row.generation}.${sequence}` : `v2.${slot}.${row.generation}.${sequence}`; };

const actor = { kind: 'master', label: 'Synthetic operator' };
const command = { type: 'roll', memberId: 'one', count: 2 };
const state = revision => ({ revision, history: [{ revision, type: 'roll', command: { ...command, rolled: ['1-1', '1-2'] } }] });
test('watermarks stay bounded over 20,000 actions and preserve the pending roll outcome', () => {
  const client = randomUUID();
  let { ledger } = openActionSession(undefined, client, actor);
  let original;
  for (let sequence = 1; sequence <= 20000; sequence++) {
    const receipt = inspectActionReceipt(ledger, command, actor, requestId(ledger, sequence), sequence - 1);
    const committed = commitActionReceipt(ledger, receipt, state(sequence));
    ledger = committed.ledger; original = committed.result;
  }
  assert.equal(ledger.slots.length, 1);
  assert.ok(JSON.stringify(ledger).length < 800);
  assert.deepEqual(inspectActionReceipt(ledger, command, actor, requestId(ledger, 20000), 19999).result, original);
  assert.deepEqual(original.outcome.rolled, ['1-1', '1-2']);
  assert.throws(() => inspectActionReceipt(ledger, command, actor, requestId(ledger)), { code: 'REQUEST_ACKNOWLEDGED' });
  assert.equal(loadActionReceipts(JSON.parse(JSON.stringify(ledger)), 20000).slots[0].sequence, 20000);
});
test('more than 32 never-ACK tabs can save while evicted committed requests stay fenced', () => {
  let ledger, firstId, firstClient;
  for (let index = 0; index < ACTION_CLIENT_SLOTS + 8; index++) {
    const clientId = randomUUID();
    const opened = openActionSession(ledger, clientId, actor, index + 1);
    const id = requestId(opened.ledger, 1, opened.session.slot);
    if (!index) { firstId = id; firstClient = clientId; }
    ledger = commitActionReceipt(opened.ledger, inspectActionReceipt(opened.ledger, command, actor, id), state(index + 1)).ledger;
    // Controlled LRU times; commits normally use the real clock.
    ledger.slots[opened.session.slot].lastUsed = index + 1;
    assert.equal(ledger.slots.length, Math.min(index + 1, ACTION_CLIENT_SLOTS));
  }
  ledger = loadActionReceipts(JSON.parse(JSON.stringify(ledger)), 40);
  assert.throws(() => inspectActionReceipt(ledger, command, actor, firstId, 0), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
  assert.throws(() => acknowledgeActionSession(ledger, firstClient, { slot: 0, generation: 1, sequence: 1, scope: firstId.split('.')[1] }, actor), { code: 'ACTION_SESSION_RETIRED' });
  assert.equal(ledger.slots[0].retired.sequence, 1);
});
test('sequence gaps, unconfirmed predecessors, principal changes and payload changes fail closed', () => {
  const { ledger } = openActionSession(undefined, randomUUID(), actor);
  assert.throws(() => inspectActionReceipt(ledger, command, actor, requestId(ledger, 2), 0), { code: 'REQUEST_SEQUENCE' });
  const saved = commitActionReceipt(ledger, inspectActionReceipt(ledger, command, actor, requestId(ledger)), state(1)).ledger;
  assert.throws(() => inspectActionReceipt(saved, command, actor, requestId(ledger, 2), 0), { code: 'REQUEST_SEQUENCE' });
  assert.throws(() => inspectActionReceipt(saved, { ...command, count: 1 }, actor, requestId(ledger)), { code: 'REQUEST_ID_MISMATCH' });
  assert.throws(() => inspectActionReceipt(saved, command, { kind: 'invite', inviteId: randomUUID() }, requestId(ledger)), { code: 'ACTION_SESSION_MISMATCH' });
  assert.equal(inspectActionReceipt(saved, command, { ...actor, label: 'Changed label' }, requestId(ledger)).replay, true);
});
test('prototype ledger migration preserves every replay and rejects new unsequenced actions', () => {
  const id = randomUUID(), old = { [id]: { fingerprint: actionFingerprint(command, actor), revision: 1 } };
  const ledger = loadActionReceipts(old, 2);
  assert.equal(inspectActionReceipt(ledger, command, actor, id).result.revision, 1);
  assert.throws(() => inspectActionReceipt(ledger, command, actor, randomUUID()), { code: 'ACTION_SESSION_REQUIRED' });
  assert.deepEqual(ledger.legacy, old);
});

test('confirmed sessions use LRU while commits protect active tabs and pending tabs never evict', () => {
  const clients = Array.from({ length: ACTION_CLIENT_SLOTS + 2 }, () => randomUUID());
  let ledger;
  for (let index = 0; index < ACTION_CLIENT_SLOTS; index++) {
    ledger = openActionSession(ledger, clients[index], actor, index + 1).ledger;
  }
  const firstScope = ledger.slots[0].scope;
  const committed = commitActionReceipt(ledger, inspectActionReceipt(ledger, command, actor, requestId(ledger)), state(1));
  ledger = acknowledgeActionSession(committed.ledger, clients[0], { slot: 0, generation: 1, sequence: 1, scope: committed.ledger.slots[0].scope }, actor).ledger;
  // Make the ACK's timestamp old again: the following commit must itself touch
  // this confirmed session even though no explicit reopen occurs.
  ledger.slots[0].lastUsed = 0;
  ledger = commitActionReceipt(ledger, inspectActionReceipt(ledger, command, actor, requestId(ledger, 2), 1), state(2)).ledger;
  assert.ok(ledger.slots[0].lastUsed > ACTION_CLIENT_SLOTS);
  ledger = openActionSession(ledger, clients[32], actor, 100).ledger;
  assert.equal(ledger.slots[1].clientId, clients[32]);
  assert.equal(ledger.slots[0].scope, firstScope);
  assert.equal(ledger.slots[0].receipt.revision, 2);
  ledger = acknowledgeActionSession(ledger, clients[0], { slot: 0, generation: 1, sequence: 2, scope: ledger.slots[0].scope }, actor).ledger;
  ledger = openActionSession(ledger, clients[33], actor, 101).ledger;
  assert.equal(ledger.slots[2].clientId, clients[33]);
  assert.equal(ledger.slots[0].scope, firstScope);
  assert.equal(ledger.slots.length, ACTION_CLIENT_SLOTS);
  assert.equal(loadActionReceipts(JSON.parse(JSON.stringify(ledger)), 2).slots.length, ACTION_CLIENT_SLOTS);
});

test('retirement permits retry only for the next uncommitted scoped sequence and same actor', () => {
  const client = randomUUID();
  let { ledger } = openActionSession(undefined, client, actor, 1);
  const committedId = requestId(ledger), nextId = requestId(ledger, 2);
  ledger = commitActionReceipt(ledger, inspectActionReceipt(ledger, command, actor, committedId), state(1)).ledger;
  ledger = acknowledgeActionSession(ledger, client, { slot: 0, generation: 1, sequence: 1, scope: ledger.slots[0].scope }, actor).ledger;
  ledger = openActionSession(ledger, client, actor, 1).ledger;
  for (let index = 1; index <= ACTION_CLIENT_SLOTS; index++) ledger = openActionSession(ledger, randomUUID(), actor, index + 1).ledger;
  const row = ledger.slots[0];
  assert.deepEqual(row.retired, { scope: committedId.split('.')[1], generation: 1, sequence: 1, principal: row.principal });
  assert.throws(() => inspectActionReceipt(ledger, command, actor, nextId, 1), { code: 'ACTION_SESSION_RETIRED', safeToRetry: true });
  for (const [id, ack] of [[committedId, 0], [committedId, 1], [nextId, 0], [nextId.replace(/\.2$/, '.3'), 1]]) {
    assert.throws(() => inspectActionReceipt(ledger, command, actor, id, ack), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
  }
  assert.throws(() => inspectActionReceipt(ledger, command, { kind: 'invite', inviteId: randomUUID() }, nextId, 1), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
});

test('lost ledgers cannot reuse a scoped ID even when the same client registers again', () => {
  const client = randomUUID(), first = openActionSession(undefined, client, actor, 1);
  const second = openActionSession(undefined, client, actor, 2);
  assert.notEqual(first.session.scope, second.session.scope);
  assert.throws(() => inspectActionReceipt(second.ledger, command, actor, requestId(first.ledger), 0), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
});

test('only the latest scoped retirement can certify an uncommitted action', () => {
  let { ledger } = openActionSession(undefined, randomUUID(), actor, 1);
  const oldestId = requestId(ledger);
  for (let index = 1; index <= ACTION_CLIENT_SLOTS; index++) ledger = openActionSession(ledger, randomUUID(), actor, index + 1).ledger;
  const previousId = requestId(ledger);
  for (let index = ACTION_CLIENT_SLOTS + 1; index <= ACTION_CLIENT_SLOTS * 2; index++) ledger = openActionSession(ledger, randomUUID(), actor, index + 1).ledger;
  assert.equal(ledger.slots[0].generation, 3);
  assert.equal(ledger.slots[0].retired.generation, 2);
  assert.equal(Object.hasOwn(ledger.slots[0].retired, 'retired'), false);
  assert.throws(() => inspectActionReceipt(ledger, command, actor, oldestId, 0), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
  assert.throws(() => inspectActionReceipt(ledger, command, actor, previousId, 0), { code: 'ACTION_SESSION_RETIRED', safeToRetry: true });
  const unscoped = openActionSession(undefined, randomUUID(), actor, 1).ledger;
  delete unscoped.slots[0].scope;
  let legacy = unscoped;
  for (let index = 1; index <= ACTION_CLIENT_SLOTS; index++) legacy = openActionSession(legacy, randomUUID(), actor, index + 1).ledger;
  assert.throws(() => inspectActionReceipt(legacy, command, actor, 'v2.0.1.1', 0), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
});

test('legacy format 2 rows without scope remain readable and retain v2 replay', () => {
  const client = randomUUID(), created = openActionSession(undefined, client, actor, 1);
  const legacy = structuredClone(created.ledger);
  delete legacy.slots[0].scope; delete legacy.slots[0].lastUsed;
  const bytes = JSON.stringify(legacy);
  assert.equal(JSON.stringify(loadActionReceipts(legacy, 0)), bytes);
  const reopened = openActionSession(legacy, client, actor, 2);
  assert.equal(reopened.session.scope, undefined);
  assert.equal(reopened.ledger.slots[0].scope, undefined);
  assert.equal(JSON.stringify(legacy), bytes);
  const saved = commitActionReceipt(reopened.ledger, inspectActionReceipt(reopened.ledger, command, actor, 'v2.0.1.1'), state(1));
  assert.deepEqual(inspectActionReceipt(loadActionReceipts(saved.ledger, 1), command, actor, 'v2.0.1.1').result, saved.result);
});
test('corrupt watermark and outcome documents refuse to open', () => {
  const initial = openActionSession(undefined, randomUUID(), actor).ledger;
  for (const change of [row => row.acknowledged = 2, row => row.sequence = -1, row => row.generation = Number.MAX_SAFE_INTEGER + 1]) {
    const ledger = structuredClone(initial); change(ledger.slots[0]);
    assert.throws(() => loadActionReceipts(ledger, 1), /Invalid/);
  }
  const saved = commitActionReceipt(initial, inspectActionReceipt(initial, command, actor, requestId(initial)), state(1)).ledger;
  saved.slots[0].receipt.revision = 2;
  assert.throws(() => loadActionReceipts(saved, 1), /Invalid/);
});
test('all random command result fields survive replay independently of current state', () => {
  const { ledger } = openActionSession(undefined, randomUUID(), actor);
  for (const details of [{ type: 'pick-for-me', chunkId: '1-2' }, { type: 'unpick', unpicked: '1-1' },
    { type: 'go-members', starts: [{ memberId: 'one', chunkId: '1-1' }, { memberId: 'two', chunkId: '1-2' }], bankVersion: 'synthetic-v1' }]) {
    const receipt = inspectActionReceipt(ledger, details, actor, requestId(ledger));
    const saved = commitActionReceipt(ledger, receipt, { revision: 1, history: [{ revision: 1, type: details.type, command: details }] });
    assert.deepEqual(inspectActionReceipt(saved.ledger, details, actor, requestId(ledger)).result.outcome, { ...details, revision: 1 });
  }
});
