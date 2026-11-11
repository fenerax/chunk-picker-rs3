// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';

// Replaces the former picker-context disconnect case. Request admission, server
// close and route completion are explicit events; no compression spy or deadline.
test('one and all oversized HTTP waiter disconnects settle and permit the same revision to retry', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'picker-disconnect-'));
  const previous = process.env.RS3_FULL_STATE_GZIP_PARTS;
  process.env.RS3_FULL_STATE_GZIP_PARTS = '1';
  t.after(() => { if (previous === undefined) delete process.env.RS3_FULL_STATE_GZIP_PARTS; else process.env.RS3_FULL_STATE_GZIP_PARTS = previous; });
  let handler, app, sequence = 0;
  const requests = new Map(), gates = [];
  const server = http.createServer((request, response) => {
    const row = requests.get(request.headers['x-synthetic-request']);
    response.once('close', () => row.closed.resolve());
    const once = response.once;
    response.once = function(event, listener) {
      const result = once.call(this, event, listener);
      // sendState registers disconnect immediately before synchronously joining
      // the shared build. Resolve after that synchronous admission has finished.
      if (event === 'close' && listener.name === 'disconnect') queueMicrotask(row.admitted.resolve);
      return result;
    };
    Promise.resolve(handler(request, response)).then(row.done.resolve, row.done.reject);
  });
  t.after(async () => {
    for (const gate of gates) gate.release.resolve();
    for (const row of requests.values()) row.client.destroy();
    await app?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const definitions = { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
    challenges: {}, drops: {}, equipment: {}, codeItems: {} };
  app = await createServer({ dataDir: directory, dataset: fixtureDataset, definitions,
    initialState: createGroupState([{ id: 'synthetic-member', name: 'Synthetic Player', unlocked: ['12850'] }]),
    predictionPrewarm: false, port: 0, httpServer: server, onRequestHandler(value) { handler = value; } });
  await app.listen();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const advance = () => app.store.command({ type: 'set-note', memberId: 'synthetic-member', chunkId: '12850', note: String(sequence) }, app.store.getInfo().revision);
  await advance(); // Discard startup's prepared response before the snapshot seam.
  const snapshot = app.store.getStateSnapshot.bind(app.store), payload = 'Z'.repeat(49 * 1024 ** 2);
  let captures = 0;
  app.store.getStateSnapshot = async options => {
    const gate = gates[captures++];
    if (gate) { gate.entered.resolve(); await gate.release.promise; }
    try {
      const saved = await snapshot(options);
      return { revision: saved.revision, pools: saved.pools,
        stateJSONParts: [...saved.stateJSONParts.slice(0, -1), ',"payload":"', payload, '"}'] };
    } finally { gate?.exited.resolve(); }
  };
  function gate() {
    const value = { entered: Promise.withResolvers(), release: Promise.withResolvers(), exited: Promise.withResolvers() };
    gates.push(value); return value;
  }
  function call() {
    const id = String(++sequence), row = { admitted: Promise.withResolvers(), closed: Promise.withResolvers(), done: Promise.withResolvers() };
    requests.set(id, row);
    row.result = new Promise((resolve, reject) => {
      row.client = http.get(origin + '/api/state', { agent: false, headers: {
        authorization: `Bearer ${app.store.getAccessToken()}`, 'accept-encoding': 'gzip, identity;q=0', 'x-synthetic-request': id,
      } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, state: JSON.parse(gunzipSync(Buffer.concat(chunks))).state }));
      });
      row.client.on('error', reject);
    });
    // Disconnected calls intentionally reject. Consume that rejection eagerly.
    void row.result.catch(() => {});
    return row;
  }
  const firstGate = gate(), first = call(), second = call();
  await Promise.all([first.admitted.promise, second.admitted.promise, firstGate.entered.promise]);
  first.client.destroy(); await first.closed.promise; await first.done.promise;
  firstGate.release.resolve();
  const survivor = await second.result;
  assert.equal(survivor.status, 200); assert.equal(survivor.state.revision, 1);
  assert.equal(captures, 1, 'one disconnected waiter does not cancel its peer');

  await advance();
  const allGate = gate(), third = call(), fourth = call();
  await Promise.all([third.admitted.promise, fourth.admitted.promise, allGate.entered.promise]);
  third.client.destroy(); fourth.client.destroy();
  await Promise.all([third.closed.promise, fourth.closed.promise, third.done.promise, fourth.done.promise]);
  allGate.release.resolve(); await allGate.exited.promise;
  // A fresh socket request arrives after the aborted build's microtasks settle.
  const retried = await call().result;
  assert.equal(retried.status, 200); assert.equal(retried.state.revision, 2);
  assert.equal(captures, 3, 'all disconnected waiters release the abandoned build');
});
