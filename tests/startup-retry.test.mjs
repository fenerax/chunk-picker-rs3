import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { readStartupJSON, retryStartupRead, withStartupTimeout, showStartupError, showStartupRetry } from '../app/startup-read.mjs';

const runtime = await readFile(new URL('../app/dataset-runtime.mjs', import.meta.url), 'utf8');
const payload = { dataset: { datasetId: 'synthetic', digest: 'synthetic' }, capabilities: {},
  gameDefaults: { members: [{ id: 'player1', name: 'Player 1' }] }, values: {} };
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('browser dataset bootstrap recovers through an updating proxy without reloading', { timeout: 10000 }, async t => {
  const upstream = await listen(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); });
  let calls = 0;
  const proxy = await listen(t, (req, res) => {
    if (++calls === 1) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
      return res.end(JSON.stringify({ message: 'The picker is updating. Try again in a moment.', code: 'PICKER_UPDATING' }));
    }
    const forwarded = request(new URL(req.url, upstream), response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    forwarded.on('error', () => res.destroy()); req.pipe(forwarded);
  });
  const source = runtime.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', "'file:///synthetic/dataset-runtime.mjs'");
  const loaded = await runInNewContext(`(async () => { ${source}\nreturn selectedDataset; })()`, {
    fetch: (path, options) => fetch(new URL(path, proxy), options), URL, Map, Set,
    readStartupJSON: (path, options) => readStartupJSON(path, { ...options, fetch: (path, init) => fetch(new URL(path, proxy), init) }), showStartupError,
  });
  assert.equal(loaded.gameDefaults.members[0].name, 'Player 1');
  assert.equal(calls, 2, 'same document retries bootstrap after the proxy recovers');
});

test('startup keeps retrying network, gateway and updating failures beyond the old retry budget', async () => {
  const failures = [new TypeError('offline'), ...[502, 504, 503, 429].map(status => Object.assign(new Error('unavailable'), { status })),
    ...Array.from({ length: 32 }, () => Object.assign(new Error('updating'), { status: 503, code: 'PICKER_UPDATING' }))];
  const delays = [], notices = [];
  let calls = 0;
  const result = await retryStartupRead(async () => { if (calls < failures.length) throw failures[calls++]; calls++; return 'ready'; }, {
    sleep: async delay => { delays.push(delay); }, onRetry: error => notices.push(error),
  });
  assert.equal(result, 'ready'); assert.equal(calls, 38);
  assert.deepEqual(delays.slice(0, 7), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.ok(delays.every(delay => delay >= 1000 && delay <= 30000));
  assert.equal(notices.length, failures.length);
});

test('startup honours Retry-After seconds and dates even beyond the normal backoff ceiling', async () => {
  for (const header of ['60', new Date(Date.now() + 62000).toUTCString()]) {
    const delays = []; let calls = 0;
    const value = await readStartupJSON('/synthetic', { fetch: async () => ++calls === 1
      ? new Response(JSON.stringify({ code: 'PICKER_UPDATING' }), { status: 503, headers: { 'Retry-After': header } })
      : Response.json(payload), sleep: async delay => { delays.push(delay); }, onRetry() {} });
    assert.equal(value.dataset.datasetId, 'synthetic'); assert.equal(calls, 2);
    assert.ok(delays[0] >= 59000 && delays[0] <= 62000, String(delays[0]));
  }
});

test('startup times out hung headers and bodies, aborts them, and recovers without late publication', async () => {
  for (const phase of ['headers', 'body']) {
    let calls = 0, firstSignal, deadline;
    const delays = [];
    const loading = readStartupJSON('/synthetic', {
      fetch: async (_path, { signal }) => {
        if (++calls > 1) return Response.json(payload);
        firstSignal = signal;
        if (phase === 'headers') return new Promise(() => {}); // even a transport ignoring abort is bounded
        return { ok: true, headers: new Headers(), json: () => new Promise(() => {}) };
      }, setTimer: callback => { deadline = callback; return 1; }, clearTimer() {},
      sleep: async delay => { delays.push(delay); }, onRetry() {},
    });
    await new Promise(resolve => setImmediate(resolve));
    deadline();
    const value = await loading;
    assert.equal(value.dataset.datasetId, 'synthetic'); assert.equal(firstSignal.aborted, true);
    assert.deepEqual(delays, [1000]);
  }
});

test('startup 401/403 stop retries and provide sign-in plus invitation recovery', async () => {
  class Node {
    constructor() { this.children = []; this.dataset = {}; }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    addEventListener() {}
  }
  const nodes = new Map([['startup-error', new Node()], ['save-status', new Node()]]);
  const document = { getElementById: id => nodes.get(id), createElement: () => new Node() };
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(readStartupJSON('/synthetic', {
      fetch: async () => { calls++; return Response.json({ message: 'Access ended.' }, { status }); },
      sleep: async () => assert.fail('authentication must not retry'),
    }), error => { showStartupError(error, document); return error.status === status; });
    assert.equal(calls, 1);
    assert.equal(nodes.get('save-status').textContent, 'Sign-in required');
    const panel = nodes.get('startup-error'); assert.equal(panel.hidden, false);
    assert.ok(panel.children.some(node => node.href === '/auth/signin'));
    assert.ok(panel.children.some(node => /invitation link/.test(node.textContent)));
  }
});

test('a stopped startup aborts an unsettled request and never schedules another', async () => {
  const stop = new AbortController(); let signal;
  const loading = retryStartupRead(value => { signal = value; return new Promise(() => {}); }, {
    signal: stop.signal, onRetry: () => assert.fail('cancelled startup must stay stopped'),
  });
  await Promise.resolve(); stop.abort();
  await assert.rejects(loading, { name: 'AbortError' }); assert.equal(signal.aborted, true);
});
