import { createRequestReader, requestError, retryAfterMs } from '../app/web/live-swap-client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { openActionSession, acknowledgeActionSession, inspectActionReceipt, commitActionReceipt } from '../app/storage/action-receipts.mjs';
import { createLiveSwapCommandClient, commandOutboxKey } from '../app/web/live-swap-client.mjs';

const saveAddressSource = (await readFile(new URL('../app/web/save-address.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const answer = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
const command = () => ({ expectedRevision: 7, command: { type: 'roll', memberId: 'a' } });
function client(options) {
  let index = 0;
  return createLiveSwapCommandClient({ uuid: () => ids[index++], sleep: async () => {}, acquireSession: async () => () => {}, ...options, fetch: async (path, init) => {
    if (path === '/api/action-session') return answer(200, { slot: 0, generation: 1, sequence: 0, acknowledged: 0 });
    const response = await options.fetch(path, init);
    return { ...response, json: async () => {
      const value = await response.json();
      return response.ok ? { ...value, receipt: { requestId: JSON.parse(init.body).requestId, revision: value.state?.revision,
        outcome: { type: JSON.parse(init.body).command.type, revision: value.state?.revision } } } : value;
    } };
  } });
}

test('a lost acknowledgement retries the exact stored roll, including its ID and original revision', async () => {
  const outbox = storage(), requests = [], input = command();
  let applied = 0;
  const receipts = new Set();
  const transport = client({ storage: outbox, fetch: async (_path, options) => {
    requests.push(options.body);
    const request = JSON.parse(options.body);
    assert.ok(outbox.getItem(commandOutboxKey), 'persist before sending');
    if (!receipts.has(request.requestId)) { receipts.add(request.requestId); applied++; }
    if (requests.length === 1) {
      input.command.type = 'undo'; input.expectedRevision = 99;
      return { status: 200, ok: true, json: async () => { throw new Error('response body lost after commit'); } };
    }
    return answer(200, { state: { revision: 9 } });
  } });
  const result = await transport.send(input);
  assert.equal(applied, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.deepEqual(JSON.parse(requests[1]), { requestId: 'v2.0.1.1', requestAck: 0, expectedRevision: 7, command: { type: 'roll', memberId: 'a' } });
  assert.equal(result.value.state.revision, 9);
  assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).body, null);
  assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).confirmed, 1);
});

test('network loss and warming responses preserve one request while later commands wait', async () => {
  const requests = [], outbox = storage();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const transport = client({ storage: outbox, sleep: () => waiting, fetch: async (_path, options) => {
    requests.push(options.body);
    if (requests.length === 1) throw new TypeError('connection lost');
    if (requests.length === 2) return answer(503, { code: 'PICKER_WARMING' });
    return answer(200, { state: { revision: requests.length + 5 } });
  } });
  const first = transport.send(command());
  const second = transport.send({ expectedRevision: 8, command: { type: 'set-note', memberId: 'a', note: 'next' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(requests.length, 4);
  assert.equal(requests[0], requests[1]); assert.equal(requests[1], requests[2]);
  assert.equal(JSON.parse(requests[3]).requestId, 'v2.0.1.2');
  assert.equal(JSON.parse(requests[3]).requestAck, 1);
});

test('a re-created tab client recovers the frozen pending request before a new action', async () => {
  const outbox = storage(), abort = new AbortController();
  let original;
  const first = client({ storage: outbox, sleep: async () => { abort.abort(); }, fetch: async (_path, options) => {
    original = options.body; throw new Error('offline');
  } });
  await assert.rejects(first.send(command(), { signal: abort.signal }), { pendingCommand: true });
  const requests = [];
  const restored = client({ storage: outbox, fetch: async (_path, options) => {
    requests.push(options.body); return answer(200, { state: { revision: 8 } });
  } });
  await assert.rejects(restored.send(command()), /Confirm the pending save/);
  assert.equal(requests.length, 0);
  await restored.send(restored.pending());
  assert.equal(requests[0], original);
  assert.equal(restored.pending(), null);
});

test('a definite revision conflict permits explicitly reviewed bytes at the unused sequence', async () => {
  const requests = [], outbox = storage();
  const transport = client({ storage: outbox, fetch: async (_path, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? answer(409, { state: { revision: 8 }, claimOnlyChanges: true }) : answer(200, { state: { revision: 9 } });
  } });
  assert.equal((await transport.send(command())).response.status, 409);
  assert.equal(transport.pending(), null);
  await transport.send({ ...command(), expectedRevision: 8 });
  assert.equal(requests[0].requestId, 'v2.0.1.1'); assert.equal(requests[1].requestId, 'v2.0.1.1');
  assert.notEqual(requests[0].expectedRevision, requests[1].expectedRevision);
});

test('changed access or an ID mismatch retains the request and blocks another action', async () => {
  for (const [status, value] of [[401, { message: 'Access ended' }], [409, { code: 'REQUEST_ID_MISMATCH' }], [403, { code: 'ACTION_SESSION_MISMATCH' }]]) {
    const outbox = storage(); let requests = 0;
    const transport = client({ storage: outbox, fetch: async () => { requests++; return answer(status, value); } });
    await assert.rejects(transport.send(command()), { pendingCommand: true });
    assert.equal(transport.pending().requestId, 'v2.0.1.1');
    await assert.rejects(transport.send(command()), /Confirm the pending save/);
    assert.equal(requests, 1);
  }
});

test('unavailable, full, or corrupt session storage never dispatches a new mutation', async () => {
  const full = storage(); full.setItem = () => { throw new Error('quota'); };
  const corrupt = storage(); corrupt.setItem(commandOutboxKey, '{broken');
  for (const outbox of [null, full, corrupt]) {
    let requests = 0;
    const transport = client({ storage: outbox, fetch: async () => { requests++; return answer(200, { state: { revision: 8 } }); } });
    await assert.rejects(transport.send(command()), { pendingCommand: true });
    assert.equal(requests, 0);
  }
});

test('receipt capacity exhaustion retains the request and stops automatic retries', async () => {
  const outbox = storage(); let requests = 0, retries = 0;
  const transport = client({ storage: outbox, onRetry: () => { retries++; }, fetch: async () => {
    requests++; return answer(507, { code: 'RECEIPT_CAPACITY' });
  } });
  await assert.rejects(transport.send(command()), { pendingCommand: true, code: 'RECEIPT_CAPACITY' });
  assert.equal(requests, 1); assert.equal(retries, 0);
  assert.equal(transport.pending().requestId, 'v2.0.1.1');
});

test('ephemeral original-sync reviews cannot enter the retry outbox', async () => {
  let requests = 0;
  const transport = client({ storage: storage(), fetch: async () => { requests++; } });
  await assert.rejects(transport.send({ expectedRevision: 7, command: { type: 'sync-original', previewId: 'review' } }), TypeError);
  assert.equal(requests, 0);
});

function protocolClient(outbox, fetch, options = {}) {
  return createLiveSwapCommandClient({ storage: outbox, uuid: () => ids[0], sleep: async () => {}, acquireSession: async () => () => {}, fetch, ...options });
}
function committed(init, revision = 8) {
  return answer(200, { state: { revision }, receipt: { requestId: JSON.parse(init.body).requestId, revision: 8, outcome: { type: 'roll', revision: 8 } } });
}
const registered = () => answer(200, { slot: 3, generation: 12, sequence: 0, acknowledged: 0 });

test('client ID, outbox, and confirmed watermark are persisted before their respective network effects', async () => {
  const outbox = storage(), paths = [];
  const transport = protocolClient(outbox, async (path, init) => {
    paths.push(path);
    const stored = JSON.parse(outbox.getItem(commandOutboxKey));
    if (path === '/api/command?view=play-v1') {
      assert.equal(stored.body, init.body);
      assert.equal(stored.confirmed, 0);
      return committed(init);
    }
    const request = JSON.parse(init.body);
    assert.equal(stored.clientId, request.clientId);
    if (!request.acknowledge) { assert.equal(stored.session, null); return registered(); }
    assert.equal(stored.body, null);
    assert.equal(stored.confirmed, 1);
    assert.deepEqual(request.acknowledge, { slot: 3, generation: 12, sequence: 1 });
    return answer(200, {});
  });
  await transport.send(command());
  assert.deepEqual(paths, ['/api/action-session', '/api/command?view=play-v1']);
  await transport.confirm();
  assert.deepEqual(paths, ['/api/action-session', '/api/command?view=play-v1', '/api/action-session']);
});

test('lost registration response retries the same persisted client identity before sending an action', async () => {
  const outbox = storage(), registrations = [], commands = [];
  const transport = protocolClient(outbox, async (path, init) => {
    if (path === '/api/command?view=play-v1') { commands.push(JSON.parse(init.body)); return committed(init); }
    if (JSON.parse(init.body).acknowledge) return answer(200, {});
    registrations.push(init.body);
    if (registrations.length === 1) throw new Error('registration response lost');
    return registered();
  });
  await transport.send(command());
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0], registrations[1]);
  assert.equal(commands[0].requestId, 'v2.3.12.1');
});

test('failure to persist a committed answer never acknowledges its receipt and reload replays exact bytes', async () => {
  const outbox = storage(), write = outbox.setItem, requests = [];
  let failConfirmed = true, acknowledgements = 0;
  outbox.setItem = (key, value) => {
    if (failConfirmed && JSON.parse(value).confirmed === 1) throw new Error('quota after commit');
    write(key, value);
  };
  const fetch = async (path, init) => {
    if (path === '/api/command?view=play-v1') { requests.push(init.body); return committed(init, 10); }
    if (JSON.parse(init.body).acknowledge) { acknowledgements++; return answer(200, {}); }
    return registered();
  };
  await assert.rejects(protocolClient(outbox, fetch).send(command()), { pendingCommand: true });
  assert.equal(acknowledgements, 0);
  assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).confirmed, 0);
  failConfirmed = false;
  const recovered = protocolClient(outbox, fetch);
  const result = await recovered.send(recovered.pending());
  assert.equal(result.value.state.revision, 10);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  await recovered.confirm();
  assert.equal(acknowledgements, 1);
});

test('lost receipt acknowledgement survives reload without replaying the confirmed command', async () => {
  const outbox = storage(), requests = [], acknowledgements = [];
  const fetch = async (path, init) => {
    if (path === '/api/command?view=play-v1') { requests.push(JSON.parse(init.body)); return committed(init); }
    if (JSON.parse(init.body).acknowledge) { acknowledgements.push(JSON.parse(init.body)); throw new Error('ack lost'); }
    return registered();
  };
  const first = protocolClient(outbox, fetch);
  await first.send(command()); await first.confirm(); first.close();
  const restored = protocolClient(outbox, fetch);
  assert.equal(restored.pending(), null);
  await restored.confirm();
  assert.equal(requests.length, 1);
  assert.equal(acknowledgements.length, 2);
  await restored.send({ ...command(), expectedRevision: 8 });
  assert.equal(requests[1].requestId, 'v2.3.12.2');
  assert.equal(requests[1].requestAck, 1);
});

test('a slow lazy ACK never delays state adoption and reload preserves the original rolled outcome', async () => {
  const outbox = storage();
  let releaseAck, ackStarted;
  const waiting = new Promise(resolve => { releaseAck = resolve; });
  const started = new Promise(resolve => { ackStarted = resolve; });
  const originalReceipt = { requestId: 'v2.3.12.1', revision: 8, outcome: { type: 'roll', revision: 8, rolled: ['12341', '12342'] } };
  const transport = protocolClient(outbox, async (path, init) => {
    if (path === '/api/command?view=play-v1') return answer(200, { state: { revision: 12 }, receipt: originalReceipt });
    if (!JSON.parse(init.body).acknowledge) return registered();
    const persisted = JSON.parse(outbox.getItem(commandOutboxKey));
    assert.deepEqual(persisted.lastReceipt, originalReceipt);
    assert.equal(persisted.body, null);
    ackStarted(); await waiting;
    return answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  });
  await transport.send(command());
  const confirming = transport.confirm();
  await started;
  transport.close();
  const paths = [];
  const restored = protocolClient(outbox, async (path, init) => {
    paths.push(path);
    return answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  });
  assert.equal(restored.pending(), null);
  assert.deepEqual(restored.lastReceipt(), originalReceipt);
  await restored.confirm();
  assert.deepEqual(paths, ['/api/action-session']);
  assert.deepEqual(restored.lastReceipt().outcome.rolled, ['12341', '12342']);
  releaseAck(); await confirming;
});

test('back-to-back saves piggyback confirmation and batch the final ACK after idle', async () => {
  const outbox = storage(), requests = [];
  let acked;
  const idleAck = new Promise(resolve => { acked = resolve; });
  const transport = protocolClient(outbox, async (path, init) => {
    const body = JSON.parse(init.body); requests.push({ path, body });
    if (path.startsWith('/api/command')) return committed(init);
    if (!body.acknowledge) return registered();
    acked(); return answer(200, { slot: 3, generation: 12, sequence: 2, acknowledged: 2 });
  }, { ackDelayMs: 10 });
  await transport.send(command());
  await transport.confirm({ lazy: true });
  await transport.send({ ...command(), expectedRevision: 8 });
  assert.equal(requests.length, 3, 'registration then one request per save, with no ACK round trip');
  assert.equal(requests[2].body.requestAck, 1);
  await Promise.race([idleAck, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('ACK deadline')), 1000); timer.unref(); })]);
  assert.equal(requests.length, 4);
  assert.equal(requests[3].body.acknowledge.sequence, 2);
  transport.close();
});

test('retained outcome validation rejects corrupt and oversized receipt records before networking', async () => {
  const outbox = storage();
  await protocolClient(outbox, async (path, init) => path === '/api/action-session' ? registered() : committed(init)).send(command());
  const original = JSON.parse(outbox.getItem(commandOutboxKey));
  for (const receipt of [{ ...original.lastReceipt, requestId: 'v2.3.12.2' },
    { ...original.lastReceipt, outcome: { type: 'roll', revision: 7 } },
    { ...original.lastReceipt, outcome: { type: 'roll', revision: 8, rolled: ['x'.repeat(3000)] } }]) {
    outbox.setItem(commandOutboxKey, JSON.stringify({ ...original, lastReceipt: receipt }));
    let requests = 0;
    const restored = protocolClient(outbox, async () => { requests++; });
    assert.throws(() => restored.lastReceipt(), { pendingCommand: true });
    await assert.rejects(restored.send(command()), { pendingCommand: true });
    assert.equal(requests, 0);
  }
});

test('a retired generation preserves pending bytes and never registers a fresh identity for that action', async () => {
  const outbox = storage(), controller = new AbortController();
  const first = protocolClient(outbox, async (path) => {
    if (path === '/api/action-session') return registered();
    controller.abort(); throw new Error('ambiguous old action');
  });
  await assert.rejects(first.send(command(), { signal: controller.signal }), { pendingCommand: true });
  const original = first.pending(), paths = [];
  const stale = protocolClient(outbox, async path => { paths.push(path); return answer(409, { code: 'ACTION_SESSION_RETIRED' }); });
  await assert.rejects(stale.send(original), { pendingCommand: true, code: 'ACTION_SESSION_RETIRED' });
  assert.deepEqual(stale.pending(), original);
  assert.deepEqual(paths, ['/api/command?view=play-v1']);
});

test('33 tabs retire the least used confirmed session and its open tab renews without reloading', async () => {
  let ledger, revision = 7, actions = 0;
  const requests = [], actor = { kind: 'master' };
  const fetch = async (path, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    try {
      if (path === '/api/action-session') {
        const result = body.acknowledge ? acknowledgeActionSession(ledger, body.clientId, body.acknowledge, actor)
          : openActionSession(ledger, body.clientId, actor);
        ledger = result.ledger; return answer(200, result.session);
      }
      const action = inspectActionReceipt(ledger, body.command, actor, body.requestId, body.requestAck);
      if (action.replay) return answer(200, { state: { revision }, receipt: action.result });
      assert.equal(body.expectedRevision, revision);
      revision++; actions++;
      const result = commitActionReceipt(ledger, action, { revision, history: [{ revision, type: 'roll', command: { rolled: ['1-1'] } }] });
      ledger = result.ledger; return answer(200, { state: { revision }, receipt: result.result });
    } catch (error) { return answer(error.status ?? 500, { code: error.code, safeToRetry: error.safeToRetry }); }
  };
  const tabs = Array.from({ length: 33 }, () => protocolClient(storage(), fetch, { uuid: randomUUID }));
  for (const tab of tabs.slice(0, 32)) { await tab.send({ ...command(), expectedRevision: revision }); await tab.confirm(); }
  ledger.slots.forEach((row, index) => { row.lastUsed = index; });
  await tabs[0].send({ ...command(), expectedRevision: revision });
  const oldScope = ledger.slots[1].scope;
  await tabs[32].send({ ...command(), expectedRevision: revision });
  assert.notEqual(ledger.slots[1].scope, oldScope);
  assert.equal(ledger.slots[0].generation, 1, 'recently active first tab survives');
  await tabs[1].send({ ...command(), expectedRevision: revision });
  assert.equal(actions, 35);
  assert.equal(tabs[1].pending(), null);
  assert.equal(ledger.slots.length, 32);
  assert.ok(requests.some(body => body.requestId?.startsWith('v3.')));
});

test('a definitively rejected new command renews after ledger loss, but an ambiguous retry stays pending', async () => {
  for (const ambiguous of [false, true]) {
    const outbox = registeredStorage(); let commands = 0, registrations = 0, uuidCalls = 0;
    const transport = protocolClient(outbox, async (path, init) => {
      if (path === '/api/action-session') {
        if (JSON.parse(init.body).acknowledge) return answer(200, {});
        registrations++; return answer(200, { slot: 0, generation: 1, sequence: 0, acknowledged: 0, scope: ids[1] });
      }
      commands++;
      if (ambiguous && commands === 1) throw new Error('possibly committed');
      if (commands === (ambiguous ? 2 : 1)) return answer(409, { code: 'ACTION_SESSION_RETIRED' });
      return committed(init);
    }, { uuid: () => { uuidCalls++; return ids[1]; } });
    if (ambiguous) {
      await assert.rejects(transport.send(command()), { code: 'ACTION_SESSION_RETIRED', pendingCommand: true });
      assert.ok(transport.pending()); assert.equal(registrations, 0);
    } else {
      await transport.send(command());
      assert.equal(transport.pending(), null); assert.equal(registrations, 1); assert.equal(uuidCalls, 1);
    }
  }
});

test('session capacity and legacy pending records fail closed without dispatching an action', async () => {
  const outbox = storage(), paths = [];
  const full = protocolClient(outbox, async path => { paths.push(path); return answer(507, { code: 'ACTION_SESSION_CAPACITY' }); });
  await assert.rejects(full.send(command()), { pendingCommand: true, code: 'ACTION_SESSION_CAPACITY' });
  assert.deepEqual(paths, ['/api/action-session']);
  outbox.setItem('picker.commandOutbox.v1', '{"version":1,"body":"old request"}');
  await assert.rejects(full.send(command()), /older pending save/);
  assert.equal(paths.length, 1);
});

test('an unrelated or missing receipt cannot clear a successfully applied pending action', async () => {
  for (const receipt of [undefined, { requestId: 'v2.3.12.999', revision: 8 }, { requestId: 'v2.3.12.1', revision: 9 }]) {
    const outbox = storage(), controller = new AbortController();
    let retries = 0;
    const transport = protocolClient(outbox, async (path, init) => {
      if (path === '/api/action-session') return registered();
      return answer(200, { state: { revision: 8 }, receipt });
    }, { onRetry: () => { retries++; controller.abort(); } });
    await assert.rejects(transport.send(command(), { signal: controller.signal }), { pendingCommand: true });
    assert.equal(retries, 1);
    assert.equal(transport.pending().requestId, 'v2.3.12.1');
  }
});

test('an outbox write failure after registration prevents the command request', async () => {
  const outbox = storage(), write = outbox.setItem, paths = [];
  outbox.setItem = (key, value) => { if (JSON.parse(value).body) throw new Error('quota'); write(key, value); };
  const transport = protocolClient(outbox, async path => { paths.push(path); return registered(); });
  await assert.rejects(transport.send(command()), { pendingCommand: true });
  assert.deepEqual(paths, ['/api/action-session']);
});

function sessionLocks() {
  const held = new Set();
  return async id => {
    if (held.has(id)) return null;
    held.add(id);
    return () => held.delete(id);
  };
}
function registeredStorage() {
  const outbox = storage();
  outbox.setItem(commandOutboxKey, JSON.stringify({ version: 2, clientId: ids[0], session: { slot: 3, generation: 12, sequence: 0 }, confirmed: 0, lastReceipt: null, body: null }));
  return outbox;
}
function copiedStorage(source) {
  const outbox = storage();
  outbox.setItem(commandOutboxKey, source.getItem(commandOutboxKey));
  return outbox;
}

test('copied sessionStorage tabs cannot collapse two identical intentional commands into one receipt', async () => {
  const originalStorage = registeredStorage(), cloneStorage = copiedStorage(originalStorage), acquireSession = sessionLocks(), requests = [];
  const fetch = async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body) });
    return path.startsWith('/api/command') ? committed(init) : answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  };
  const original = protocolClient(originalStorage, fetch, { acquireSession });
  const clone = protocolClient(cloneStorage, fetch, { acquireSession });
  await original.send(command());
  const count = requests.length;
  await assert.rejects(clone.send(command()), /Another tab owns this copied saving session/);
  assert.equal(requests.length, count, 'the second intention never reaches the server with the first action ID');
  assert.equal(clone.pending(), null, 'ownership is checked before persisting a new outbox action');
  original.close(); clone.close();
});

test('a copied tab cannot replay or ACK while the original owns its session; closing releases pending recovery', async () => {
  const outbox = registeredStorage(), acquireSession = sessionLocks(), abort = new AbortController();
  let originalBytes;
  const original = protocolClient(outbox, async (path, init) => {
    originalBytes = init.body; abort.abort(); throw new Error('lost postcommit response');
  }, { acquireSession });
  await assert.rejects(original.send(command(), { signal: abort.signal }), { pendingCommand: true });
  const cloneStorage = copiedStorage(outbox), paths = [];
  const clone = protocolClient(cloneStorage, async (path, init) => {
    paths.push(path);
    if (path.startsWith('/api/command')) { assert.equal(init.body, originalBytes); return committed(init); }
    return answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  }, { acquireSession });
  await assert.rejects(clone.send(clone.pending()), /Another tab owns this copied saving session/);
  assert.deepEqual(paths, []);
  original.close();
  await clone.send(clone.pending());
  await clone.confirm();
  assert.deepEqual(paths, ['/api/command?view=play-v1', '/api/action-session']);
  const confirmedCloneStorage = copiedStorage(cloneStorage), ackPaths = [];
  const copiedConfirmed = protocolClient(confirmedCloneStorage, async path => { ackPaths.push(path); return registered(); }, { acquireSession });
  await assert.rejects(copiedConfirmed.confirm(), /Another tab owns this copied saving session/);
  assert.deepEqual(ackPaths, [], 'a copied confirmed watermark cannot prune the owner receipt');
  clone.close(); copiedConfirmed.close();
});

test('closing a page during an in-flight response retains the outcome without acknowledging after ownership release', async () => {
  const outbox = registeredStorage(), acquireSession = sessionLocks();
  let respond, started;
  const waiting = new Promise(resolve => { respond = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const paths = [];
  const original = protocolClient(outbox, async (path, init) => { paths.push(path); started(); await waiting; return committed(init); }, { acquireSession });
  const saving = original.send(command());
  await requested;
  original.close(); respond();
  await assert.rejects(saving, { pendingCommand: true });
  assert.deepEqual(paths, ['/api/command?view=play-v1']);
  assert.equal(original.lastReceipt().requestId, 'v2.3.12.1');
  const restoredPaths = [];
  const restored = protocolClient(outbox, async path => { restoredPaths.push(path); return answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 }); }, { acquireSession });
  await restored.confirm();
  assert.deepEqual(restoredPaths, ['/api/action-session']);
  restored.close();
});

test('missing Web Locks support fails closed before registration, dispatch or acknowledgement', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8');
  const scope = { navigator: {} };
  Object.assign(scope, { retryAfterMs, requestError });
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  let requests = 0;
  const transport = scope.create({ storage: storage(), uuid: () => ids[0], fetch: async () => { requests++; } });
  await assert.rejects(transport.send(command()), error => error.pendingCommand === true
    && /secure connection/.test(error.message) && /current browser/.test(error.message)
    && /HTTPS or a trusted localhost/.test(error.message) && /check History/.test(error.message)
    && !/Web Locks|crypto\.randomUUID/.test(error.message));
  assert.equal(requests, 0);
});

test('missing crypto.randomUUID gives secure-connection guidance before registration or ownership acquisition', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8');
  let requests = 0, ownership = 0;
  const scope = { crypto: {}, navigator: { locks: { request() { ownership++; } } } };
  Object.assign(scope, { retryAfterMs, requestError });
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  const outbox = storage();
  const transport = scope.create({ storage: outbox, fetch: async () => { requests++; } });
  await assert.rejects(transport.send(command()), error => error.pendingCommand === true
    && /secure connection/.test(error.message) && /current browser/.test(error.message)
    && /HTTPS or a trusted localhost/.test(error.message) && /check History/.test(error.message)
    && !/Web Locks|crypto\.randomUUID/.test(error.message));
  assert.equal(requests, 0);
  assert.equal(ownership, 0);
  assert.equal(outbox.getItem(commandOutboxKey), null);
});

test('plain HTTP refuses new and restored sessions clearly even if secure APIs are present', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8');
  let uuids = 0, owners = 0, requests = 0;
  const scope = { clearTimeout, isSecureContext: false, crypto: { randomUUID: () => { uuids++; return ids[0]; } },
    navigator: { locks: { request() { owners++; } } } };
  Object.assign(scope, { retryAfterMs, requestError });
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  for (const outbox of [storage(), registeredStorage()]) {
    const before = outbox.getItem(commandOutboxKey);
    const transport = scope.create({ storage: outbox, fetch: async () => { requests++; } });
    await assert.rejects(transport.send(command()), error => error.insecureConnection === true
      && error.message === 'This address cannot save safely. Open the HTTPS link or localhost.');
    assert.equal(outbox.getItem(commandOutboxKey), before);
    transport.close();
  }
  assert.equal(uuids, 0); assert.equal(owners, 0); assert.equal(requests, 0);
});

test('the default Web Locks adapter holds exclusive ownership until document closure', async () => {
  const outbox = registeredStorage(), cloneStorage = copiedStorage(outbox), paths = [];
  const fetch = async (path, init) => {
    paths.push(path);
    return path.startsWith('/api/command') ? committed(init) : answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  };
  const original = createLiveSwapCommandClient({ storage: outbox, fetch });
  const clone = createLiveSwapCommandClient({ storage: cloneStorage, fetch });
  try {
    await original.send(command());
    await original.confirm();
    await assert.rejects(clone.send(command()), /Another tab owns this copied saving session/);
    assert.deepEqual(paths, ['/api/command?view=play-v1', '/api/action-session']);
  } finally { original.close(); clone.close(); }
});

test('pagehide releases ownership and pageshow requires reacquisition before another save', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8'), lifecycle = new Map();
  const scope = { TextEncoder, AbortController, setTimeout, clearTimeout, addEventListener: (type, fn) => lifecycle.set(type, fn) };
  Object.assign(scope, { retryAfterMs, requestError });
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  const outbox = registeredStorage(), acquireSession = sessionLocks(), paths = [], keepalives = [];
  const fetch = async (path, init) => {
    paths.push(path);
    if (init.keepalive) keepalives.push(init);
    return path.startsWith('/api/command') ? committed(init) : answer(200, { slot: 3, generation: 12, sequence: 1, acknowledged: 1 });
  };
  const original = scope.create({ storage: outbox, fetch, acquireSession });
  await original.send(command());
  lifecycle.get('pagehide')();
  assert.equal(keepalives.length, 1);
  assert.equal(JSON.parse(keepalives[0].body).acknowledge.sequence, 1);
  const successor = protocolClient(copiedStorage(outbox), fetch, { acquireSession });
  await successor.confirm();
  const count = paths.length;
  await assert.rejects(original.send(command()), /closed or suspended/);
  lifecycle.get('pageshow')();
  await assert.rejects(original.send(command()), /Another tab owns this copied saving session/);
  assert.equal(paths.length, count);
  successor.close();
  await original.send(command());
  assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).confirmed, 2);
  original.close();
});

async function screen(fetch, { outbox = storage(), clientOptions = {}, context = {}, clientFactory = client } = {}) {
  const source = await readFile(new URL('../app/web/screen-commands.mjs', import.meta.url), 'utf8');
  const recovery = await readFile(new URL('../app/web/screen-save-recovery.mjs', import.meta.url), 'utf8');
  const scope = { document: { activeElement: null }, fetch, confirm: context.confirm ?? (() => true), createLiveSwapCommandClient: options => clientFactory({ ...options, storage: outbox, fetch, ...clientOptions }),
    createRequestReader, requestError, createCalculationFeedback: () => ({ begin: () => () => {} }), calculationLabel: () => '',
    groupGoalCommandTypes: [], reviewedNoteRevision: (state, _payload, revision) => revision ?? state.revision };
  runInNewContext(recovery.replace('export function createSaveRecovery', 'function createSaveRecovery') + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace('export function createScreenCommands', 'function createScreenCommands')
    + '\nglobalThis.install = createScreenCommands;', scope);
  const c = { queue: Promise.resolve(), canWrite: () => true, sandbox: { active: false }, state: { revision: 7, history: [] },
    memberId: 'a', sessionMember: 'a', sessionAdmin: false, sessionReadOnly: false,
    $: () => undefined, saved() {}, showError() {}, renderTasks() {}, rememberUnchangedTaskRevisions() {}, ...context };
  scope.install(c);
  c.adopt = state => { c.state = state; };
  return c;
}

test('the shipped command queue preserves an ordinary revision conflict for user review', async () => {
  const requests = [];
  const c = await screen(async (_path, options) => {
    requests.push(JSON.parse(options.body));
    return answer(409, { format: 'play-v1', state: { revision: 8, history: [] } });
  });
  await assert.rejects(c.command({ type: 'roll', memberId: 'a' }), { status: 409 });
  await c.queue;
  assert.equal(requests.length, 1);
  assert.equal(c.state.revision, 8);
  assert.equal(c.hasPendingCommand(), false);
});

test('the shipped claim-only conflict guard rebases only after definitive rejection', async () => {
  const requests = [];
  const c = await screen(async (_path, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? answer(409, { format: 'play-v1', state: { revision: 8, history: [] }, claimOnlyChanges: true })
      : answer(200, { format: 'play-v1', state: { revision: 9, history: [] } });
  });
  await c.command({ type: 'set-preference', memberId: 'a', name: 'x', value: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].expectedRevision, 7); assert.equal(requests[1].expectedRevision, 8);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(c.state.revision, 9);
});

test('noncommand mutation and ephemeral original-sync failures are sent once without entering the outbox', async () => {
  for (const [path, body] of [['/api/runemetrics/apply', { previewId: 'review', expectedRevision: 7 }],
    ['/api/command', { expectedRevision: 7, command: { type: 'sync-original', previewId: 'review' } }]]) {
    let requests = 0;
    const c = await screen(async () => { requests++; throw new Error('ambiguous noncommand response'); });
    await assert.rejects(c.api(path, body), /Check History before repeating the change/);
    assert.equal(requests, 1);
    assert.equal(c.hasPendingCommand(), false);
  }
});

test('SSE open and revision reconciliation cannot acknowledge an unresolved action or reload its editors', async () => {
  const source = await readFile(new URL('../app/web/screen-live.mjs', import.meta.url), 'utf8'), listeners = new Map(), statuses = [];
  let pending = true, adopted = 0;
  const scope = { EventSource: class { addEventListener(name, handler) { listeners.set(name, handler); } } };
  runInNewContext(source.replace('export function createScreenLive', 'function createScreenLive') + '\nglobalThis.install = createScreenLive;', scope);
  const c = { queue: Promise.resolve(), state: { revision: 7 }, hasPendingCommand: () => pending,
    recoverPendingCommand: async () => { throw Object.assign(new Error('account changed'), { pendingCommand: true }); },
    saved: text => statuses.push(text), showError() {}, primeSavedTasks() {},
    api: async () => ({ state: { revision: 8 } }), adopt: state => { adopted++; c.state = state; } };
  const unsentEditor = { value: 'unsent draft' };
  scope.install(c); c.connectEvents(); await c.queue;
  listeners.get('open')();
  await listeners.get('revision')({ data: JSON.stringify({ revision: 8 }) });
  assert.equal(adopted, 1);
  assert.equal(statuses.includes('Saved'), false);
  assert.equal(unsentEditor.value, 'unsent draft');
  assert.equal(/location\.(?:reload|replace|assign)/.test(source), false);
  pending = false;
  await listeners.get('revision')({ data: JSON.stringify({ revision: 8 }) });
  assert.equal(statuses.at(-1), 'Saved');
});

test('persistent server, network and malformed responses exhaust finite retries and retain exact bytes', async () => {
  for (const failure of ['server', 'network', 'json', 'receipt']) {
    const outbox = registeredStorage(), requests = [], statuses = [];
    const transport = protocolClient(outbox, async (_path, init) => {
      requests.push(init.body);
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'json') return { status: 200, ok: true, json: async () => { throw new SyntaxError('bad JSON'); } };
      return failure === 'server' ? answer(500, {}) : answer(200, { state: { revision: 8 } });
    }, { onRetry: event => statuses.push(event.status) });
    await assert.rejects(transport.send(command()), { pendingCommand: true, retryPaused: true });
    assert.equal(requests.length, 12);
    assert.equal(new Set(requests).size, 1);
    assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).paused, true);
    assert.equal(JSON.stringify(transport.pending()), requests[0]);
    assert.equal(statuses.at(-1), 'paused');
    await assert.rejects(transport.send(transport.pending()), { retryPaused: true });
    assert.equal(requests.length, 12, 'ordinary recovery never restarts an exhausted request');
    transport.close();
  }
});

test('reload stays paused until explicit retry sends the same issued ID and body', async () => {
  const outbox = registeredStorage(), requests = [];
  const first = protocolClient(outbox, async (_path, init) => { requests.push(init.body); return answer(500, {}); }, { maxAttempts: 2 });
  await assert.rejects(first.send(command()), { retryPaused: true });
  first.close();
  const restored = protocolClient(outbox, async (_path, init) => { requests.push(init.body); return committed(init); }, { maxAttempts: 2 });
  await assert.rejects(restored.send(restored.pending()), { retryPaused: true });
  assert.equal(requests.length, 2);
  await restored.send(restored.pending(), { retry: true });
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests).size, 1);
  assert.equal(restored.pending(), null);
  assert.equal(restored.paused(), false);
  restored.close();
});

test('registration exhaustion preserves the original unsent intention across reload and explicit retry', async () => {
  const outbox = storage(), input = command(), registrations = [];
  const first = protocolClient(outbox, async (path, init) => {
    assert.equal(path, '/api/action-session'); registrations.push(init.body);
    input.command.type = 'undo'; input.expectedRevision = 99;
    throw new Error('offline before registration');
  }, { maxAttempts: 2 });
  await assert.rejects(first.send(input), { retryPaused: true });
  assert.deepEqual(first.pending(), command());
  assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).body, null);
  first.close();
  const requests = [];
  const restored = protocolClient(outbox, async (path, init) => {
    requests.push({ path, bytes: init.body });
    return path === '/api/action-session' ? registered() : committed(init);
  });
  await assert.rejects(restored.send(restored.pending()), { retryPaused: true });
  assert.equal(requests.length, 0);
  await restored.send(restored.pending(), { retry: true });
  assert.equal(requests[0].bytes, registrations[0]);
  assert.equal(new Set(registrations).size, 1);
  assert.deepEqual(JSON.parse(requests[1].bytes), { requestId: 'v2.3.12.1', requestAck: 0, ...command() });
  assert.equal(restored.pending(), null);
  restored.close();
});

test('the total retry deadline includes sleep and hanging fetch or JSON readers are bounded and aborted', async () => {
  let elapsed = 0, attempts = 0;
  const budgeted = protocolClient(registeredStorage(), async () => { attempts++; return answer(503, {}); }, {
    maxRetryMs: 1000, now: () => elapsed, sleep: async delay => { elapsed += delay; },
  });
  await assert.rejects(budgeted.send(command()), { retryPaused: true });
  assert.equal(elapsed, 1000);
  assert.equal(attempts, 3);
  budgeted.close();
  for (const reader of [false, true]) {
    const signals = [];
    const transport = protocolClient(registeredStorage(), async (_path, init) => {
      signals.push(init.signal);
      const hanging = new Promise(() => {});
      return reader ? { status: 200, ok: true, json: () => hanging } : hanging;
    }, { timeoutMs: 1000, maxRetryMs: 15 });
    await assert.rejects(transport.send(command()), { retryPaused: true });
    assert.ok(signals.length >= 1 && signals.length <= 12);
    assert.ok(signals.every(signal => signal.aborted));
    transport.close();
  }
});

test('an in-flight idle or explicit ACK cannot delay a later save or advance its watermark', async () => {
  for (const lazy of [false, true]) {
    let releaseAck, startedAck, commands = 0;
    const waiting = new Promise(resolve => { releaseAck = resolve; });
    const started = new Promise(resolve => { startedAck = resolve; });
    const acks = [], outbox = registeredStorage();
    const transport = protocolClient(outbox, async (path, init) => {
      const body = JSON.parse(init.body);
      if (path.startsWith('/api/command')) { commands++; return committed(init); }
      acks.push(body.acknowledge.sequence);
      if (acks.length === 1) { startedAck(); await waiting; }
      return answer(200, { slot: 3, generation: 12, sequence: body.acknowledge.sequence, acknowledged: body.acknowledge.sequence });
    }, { ackDelayMs: 1 });
    await transport.send(command());
    const confirming = transport.confirm({ lazy });
    await started;
    // Give the second save only one event-loop turn; the first ACK is still held.
    const second = transport.send(command());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(commands, 2);
    await second;
    await transport.confirm();
    releaseAck(); await confirming;
    await new Promise(resolve => setImmediate(resolve));
    const count = acks.length;
    await transport.confirm();
    assert.equal(acks.length, count, 'the late old ACK cannot replace the newer confirmed watermark');
    assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).confirmed, 2);
    transport.close();
  }
});

test('startup confirmation and saving share ownership acquisition while stale ACKs cannot confirm a renewed session', async () => {
  const outbox = registeredStorage();
  const setup = protocolClient(outbox, async (_path, init) => committed(init));
  await setup.send(command()); setup.close();
  let acquisitions = 0, releaseAck, startedAck, retired = false;
  const waiting = new Promise(resolve => { releaseAck = resolve; });
  const started = new Promise(resolve => { startedAck = resolve; });
  const acks = [];
  const transport = protocolClient(outbox, async (path, init) => {
    const body = JSON.parse(init.body);
    if (body.acknowledge) {
      acks.push(body);
      if (acks.length === 1) { startedAck(); await waiting; }
      return answer(200, { ...body.acknowledge, acknowledged: body.acknowledge.sequence });
    }
    if (path === '/api/action-session') return answer(200, { slot: 3, generation: 12, sequence: 0, acknowledged: 0, scope: ids[1] });
    if (!retired) { retired = true; return answer(409, { code: 'ACTION_SESSION_RETIRED', safeToRetry: true }); }
    return committed(init);
  }, { uuid: () => ids[1], acquireSession: async () => { acquisitions++; return () => {}; } });
  const confirming = transport.confirm(), saving = transport.send(command());
  await started;
  await saving;
  assert.equal(acquisitions, 2, 'one shared acquisition for the old identity, then one for renewal');
  releaseAck(); await confirming;
  await transport.confirm();
  assert.equal(acks.length, 2, 'the old identity ACK cannot suppress the new identity ACK');
  assert.equal(acks[0].clientId, ids[0]);
  assert.equal(acks[1].clientId, ids[1]);
  assert.equal(acks[1].acknowledge.scope, ids[1]);
  transport.close();
});

test('Retry save survives reload and SSE, preserves drafts and clears only after an explicit successful retry', async () => {
  const adjacent = [], statuses = [], notices = [], outbox = registeredStorage(), requests = [];
  const node = (tag, text) => ({ tag, textContent: text, children: [], setAttribute() {}, contains() { return false; }, get isConnected() { return adjacent.includes(this); }, append(...items) { this.children.push(...items); },
    remove() { const index = adjacent.indexOf(this); if (index >= 0) adjacent.splice(index, 1); } });
  const status = { after: item => adjacent.push(item) };
  const context = { $: id => id === 'save-status' ? status : undefined, el: node,
    button: (text, action) => ({ textContent: text, click: action }), saved: text => statuses.push(text), notice: text => notices.push(text), primeSavedTasks() {} };
  const first = await screen(async (_path, init) => { requests.push(init.body); return answer(500, {}); }, {
    outbox, clientOptions: { maxAttempts: 2 }, context,
  });
  const draft = { value: 'still editing this note' };
  await assert.rejects(first.command({ type: 'set-note', memberId: 'a', note: 'sent note' }), { retryPaused: true });
  await first.queue;
  assert.equal(adjacent.length, 1);
  assert.equal(adjacent[0].children[1].textContent, 'Retry save');
  assert.equal(adjacent[0].children[1].id, 'pending-save-retry');
  assert.equal(statuses.at(-1), 'Save not confirmed');
  await assert.rejects(first.command({ type: 'roll', memberId: 'a' }), { retryPaused: true });
  await first.queue;
  assert.equal(requests.length, 2, 'another command cannot silently resume the pending save');
  adjacent.length = 0;
  const restored = await screen(async (_path, init) => { requests.push(init.body); return answer(200, { state: { revision: 8, history: [] } }); }, { outbox, context });
  const source = await readFile(new URL('../app/web/screen-live.mjs', import.meta.url), 'utf8'), listeners = new Map();
  const scope = { EventSource: class { addEventListener(name, handler) { listeners.set(name, handler); } } };
  runInNewContext(source.replace('export function createScreenLive', 'function createScreenLive') + '\nglobalThis.install = createScreenLive;', scope);
  scope.install(restored); restored.connectEvents(); await restored.queue;
  listeners.get('open')();
  assert.equal(statuses.at(-1), 'Save not confirmed');
  listeners.get('error')();
  assert.equal(statuses.at(-1), 'Save not confirmed');
  await listeners.get('revision')({ data: JSON.stringify({ revision: 7 }) });
  assert.equal(statuses.at(-1), 'Save not confirmed');
  assert.equal(requests.length, 2);
  assert.equal(adjacent.length, 1);
  await adjacent[0].children[1].click();
  await restored.queue;
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests).size, 1);
  assert.equal(adjacent.length, 0);
  assert.equal(restored.hasPendingCommand(), false);
  assert.equal(statuses.at(-1), 'Saved');
  assert.equal(notices.at(-1), 'Saved. Your pending change is confirmed.');
  assert.equal(draft.value, 'still editing this note');
});

test('an invited player refusal clears its pending Undo and permits the next save before or after reload', async () => {
  for (const reload of [false, true]) {
    const outbox = storage(), requests = [];
    const fetch = async (_path, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      return body.command.type === 'undo' ? answer(403, { message: 'You can only undo your own changes.' })
        : answer(200, { state: { revision: 8, history: [] } });
    };
    let c = await screen(fetch, { outbox });
    await assert.rejects(c.command({ type: 'undo' }), error => error.status === 403
      && error.message === 'You can only undo your own changes.' && !error.pendingCommand);
    await c.queue;
    assert.equal(c.hasPendingCommand(), false);
    assert.equal(JSON.parse(outbox.getItem(commandOutboxKey)).body, null);
    if (reload) c = await screen(fetch, { outbox });
    await c.command({ type: 'set-note', memberId: 'a', note: 'allowed' });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].requestId, requests[0].requestId, 'rejected Undo consumed no sequence');
    assert.equal(c.state.revision, 8);
  }
});

test('discard removes current and legacy outboxes, releases ownership and saves in a fresh session', async () => {
  const outbox = registeredStorage(), requests = [], acquireSession = sessionLocks();
  const transport = protocolClient(outbox, async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body) });
    return path === '/api/action-session' ? registered() : committed(init);
  }, { acquireSession, uuid: () => ids[1] });
  await transport.send(command());
  outbox.setItem('picker.commandOutbox.v1', 'damaged old pending request');
  await transport.discard();
  assert.equal(outbox.getItem(commandOutboxKey), null);
  assert.equal(outbox.getItem('picker.commandOutbox.v1'), null);
  assert.equal(transport.pending(), null);
  await transport.send(command());
  assert.equal(requests[1].path, '/api/action-session');
  assert.equal(requests[1].body.clientId, ids[1]);
  assert.equal(requests[2].body.requestAck, 0);
  transport.close();
});

test('Discard pending save asks to check History, honors cancel, clears storage and allows a new save', async () => {
  const adjacent = [], outbox = registeredStorage(), prompts = [], requests = [];
  let accepted = false, fail = true, historyFocused = false;
  const node = (tag, text) => ({ tag, textContent: text, children: [], setAttribute() {}, contains() { return false; }, get isConnected() { return adjacent.includes(this); }, append(...items) { this.children.push(...items); },
    remove() { adjacent.splice(adjacent.indexOf(this), 1); } });
  const context = { $: id => id === 'save-status' ? { after: item => adjacent.push(item) } : id === 'history-open' ? { focus() { historyFocused = true; } } : undefined,
    el: node, button: (text, action) => ({ tag: 'button', textContent: text, click: action }),
    confirm: text => { prompts.push(text); return accepted; } };
  const c = await screen(async (path, init) => {
    if (path === '/api/state?view=play-v1') return answer(200, { state: { revision: 7, history: [] } });
    requests.push(init.body);
    return fail ? answer(500, {}) : answer(200, { state: { revision: 8, history: [] } });
  }, { outbox, context, clientOptions: { maxAttempts: 2 } });
  await assert.rejects(c.command({ type: 'roll', memberId: 'a' }), { retryPaused: true }); await c.queue;
  const discard = adjacent[0].children[2];
  assert.equal(discard.textContent, 'Discard pending save'); assert.equal(discard.id, 'pending-save-discard');
  discard.click(); assert.match(prompts[0], /Check History first/); assert.equal(c.hasPendingCommand(), true);
  accepted = true; await discard.click();
  assert.equal(outbox.getItem(commandOutboxKey), null); assert.equal(adjacent.length, 0); assert.equal(historyFocused, true);
  fail = false; await c.command({ type: 'set-note', memberId: 'a', note: 'new change' });
  assert.equal(requests.length, 3); assert.notEqual(JSON.parse(requests[0]).command.type, JSON.parse(requests[2]).command.type);
  assert.equal(c.hasPendingCommand(), false);
});

test('insecure page load explains the address once and chunk failure never claims an unstored request', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8');
  const scope = { isSecureContext: false };
  Object.assign(scope, { retryAfterMs, requestError });
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  const outbox = storage(), notices = [], statuses = [];
  let requests = 0;
  const c = await screen(async () => { requests++; }, { outbox, clientFactory: scope.create,
    context: { notice: text => notices.push(text), saved: text => statuses.push(text), pendingChunkChanges: [], renderMapState() {} } });
  await c.recoverPendingCommand(); await c.recoverPendingCommand();
  assert.equal(notices.length, 1);
  assert.equal(notices[0], 'This address cannot save safely. Open the HTTPS link or localhost.');
  assert.equal(statuses.at(-1), 'This address cannot save');
  await assert.rejects(c.command({ type: 'set-chunk', chunkId: '1-1' }, undefined, undefined, undefined, {}), error =>
    error.insecureConnection === true && !/retained|confirmation/.test(error.message));
  await c.queue;
  assert.equal(outbox.getItem(commandOutboxKey), null); assert.equal(requests, 0);
  assert.equal(statuses.at(-1), 'This address cannot save');
});

test('a live stream the browser closed after an update reopens with growing waits', async () => {
  const source = await readFile(new URL('../app/web/screen-live.mjs', import.meta.url), 'utf8'), streams = [], timers = [], statuses = [];
  const scope = { Math: { min: Math.min, floor: Math.floor, random: () => 0 }, setTimeout: (action, delay) => timers.push({ action, delay }),
    EventSource: class { constructor() { this.readyState = 0; this.listeners = new Map(); streams.push(this); } addEventListener(name, handler) { this.listeners.set(name, handler); } } };
  runInNewContext(source.replace('export function createScreenLive', 'function createScreenLive') + '\nglobalThis.install = createScreenLive;', scope);
  const c = { queue: Promise.resolve(), state: { revision: 7 }, hasPendingCommand: () => false, recoverPendingCommand: async () => {}, saved: text => statuses.push(text), showError() {} };
  scope.install(c); c.connectEvents(); await c.queue;
  // A dropped connection is the browser's own retry; nothing extra is scheduled.
  streams[0].listeners.get('error')();
  assert.deepEqual(timers, []);
  assert.equal(statuses.at(-1), 'Reconnecting…');
  // An error response during the restart closes the stream for good.
  for (const delay of [1000, 2000]) {
    streams.at(-1).readyState = 2; streams.at(-1).listeners.get('error')();
    assert.equal(timers.at(-1).delay, delay);
    timers.at(-1).action();
  }
  assert.equal(streams.length, 3);
  streams[2].listeners.get('open')();
  assert.equal(statuses.at(-1), 'Syncing…');
  streams[2].readyState = 2; streams[2].listeners.get('error')();
  assert.equal(timers.at(-1).delay, 1000);
});


for (const status of [429, 503]) test(`HTTP ${status} honors Retry-After while recovering a lost save acknowledgement exactly once`, async () => {
  const outbox = registeredStorage(), bytes = [], receipts = new Set(), sleeps = [];
  let clock = 10000, applied = 0, retryAt;
  const transport = protocolClient(outbox, async (_path, init) => {
    bytes.push(init.body); const request = JSON.parse(init.body);
    if (bytes.length === 1) { receipts.add(request.requestId); applied++; throw new TypeError('ECONNRESET after commit'); }
    if (bytes.length === 2) { retryAt = Date.parse(new Date(clock + 5000).toUTCString()); return { ...answer(status, {}), headers: { get: () => new Date(retryAt).toUTCString() } }; }
    assert.ok(clock >= retryAt, 'no dispatch before the HTTP date');
    assert.ok(receipts.has(request.requestId)); return committed(init);
  }, { now: () => clock, sleep: async delay => { sleeps.push(delay); clock += delay; } });
  await transport.send(command());
  assert.equal(applied, 1); assert.equal(new Set(bytes).size, 1); assert.equal(bytes.length, 3);
  assert.ok(sleeps.length >= 2); assert.equal(transport.pending(), null);
  transport.close();
});

test('a Retry-After beyond the save retry budget pauses, survives recreation, and prevents an early manual dispatch', async () => {
  const outbox = registeredStorage(); let clock = 0, calls = 0;
  const options = { now: () => clock, maxRetryMs: 1000, sleep: async delay => { clock += delay; } };
  const first = protocolClient(outbox, async () => { calls++; return { ...answer(429, {}), headers: { get: () => '10' } }; }, options);
  await assert.rejects(first.send(command()), { retryPaused: true });
  const frozen = first.pending(); first.close();
  const restored = protocolClient(outbox, async (_path, init) => { calls++; return committed(init); }, options);
  await assert.rejects(restored.send(frozen, { retry: true }), { retryPaused: true }); assert.equal(calls, 1);
  clock = 10000; await restored.send(restored.pending(), { retry: true });
  assert.equal(calls, 2); assert.equal(restored.pending(), null); restored.close();
});

test('a non-JSON rate limit still honors Retry-After and retains the save bytes', async () => {
  const outbox = registeredStorage(); let clock = 0, calls = 0;
  const transport = protocolClient(outbox, async (_path, init) => {
    calls++;
    return calls === 1 ? new Response('<html>Too many requests</html>', { status: 429, headers: { 'Retry-After': '10' } }) : committed(init);
  }, { now: () => clock, maxRetryMs: 1000, sleep: async delay => { clock += delay; } });
  await assert.rejects(transport.send(command()), error => error.retryPaused && error.retryAfterMs > 0 && /Retry save in/.test(error.message));
  assert.equal(calls, 1); assert.ok(transport.pending()); transport.close();
});


test('Tailscale HTTP registers and saves using random bytes and exclusive HTTP ownership', async () => {
  const source = await readFile(new URL('../app/web/live-swap-client.mjs', import.meta.url), 'utf8');
  const paths = []; let ownership = 0, released = 0;
  const scope = { TextEncoder, AbortController, setTimeout, clearTimeout, isSecureContext: false,
    location: { protocol: 'http:', hostname: [100, 64, 0, 1].join('.') }, navigator: {}, indexedDB: {},
    crypto: { getRandomValues: bytes => { bytes.fill(17); return bytes; } },
    acquireHttpSession: async () => { ownership++; return () => released++; } };
  runInNewContext(saveAddressSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.create = createLiveSwapCommandClient;', scope);
  const transport = scope.create({ storage: storage(), fetch: async (path, init) => {
    paths.push(path);
    return path === '/api/action-session' ? registered() : committed(init);
  } });
  assert.equal(transport.connectionMessage(), null);
  await transport.send(command()); transport.close();
  assert.equal(ownership, 1); assert.equal(released, 1);
  assert.deepEqual(paths, ['/api/action-session', '/api/command?view=play-v1']);
});
