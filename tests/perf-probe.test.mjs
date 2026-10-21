import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { probeSource } from '../scripts/perf/probe.mjs';

function probe() {
  let clock = 0;
  class Response {
    constructor(url, value) { this.url = url; this.value = value; this.reads = 0; }
    async json() { this.reads++; if (this.value instanceof Error) throw this.value; return this.value; }
  }
  const context = { window: {}, Response, URL, location: { href: 'http://127.0.0.1/' },
    performance: { now: () => ++clock },
    CanvasRenderingContext2D: class { drawImage() {} },
    MutationObserver: class { observe() {} }, document: {} };
  vm.runInNewContext(probeSource, context);
  return { Response, records: context.window.__perfProbe.taskResponses };
}

test('perf probe observes the app task response once and retains only scalar metadata', async () => {
  const { Response, records } = probe();
  const value = { stateRevision: 5, memberId: 'player2', tasks: [{ label: 'private-task' }],
    cache: { hit: true, unlockPredictionHit: true, evaluationMs: 0, requestMs: 3,
      secret: 'private-cache', timingMs: { engineMs: 0, extra: 'private-stage' } } };
  const response = new Response('http://127.0.0.1/api/tasks?token=private-token', value);
  assert.equal(await response.json(), value);
  assert.equal(response.reads, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].cache.unlockPredictionHit, true);
  assert.equal(records[0].memberId, 'player2');
  assert.equal(records[0].endMs - records[0].startMs, 1);
  assert.doesNotMatch(JSON.stringify(records), /private-|tasks|token|secret|extra/);
});

test('perf probe leaves other JSON responses and JSON errors intact', async () => {
  const { Response, records } = probe();
  const value = { state: { private: true } };
  const response = new Response('http://127.0.0.1/api/state', value);
  assert.equal(await response.json(), value);
  const failure = new Error('Invalid JSON');
  await assert.rejects(new Response('http://127.0.0.1/api/tasks', failure).json(), error => error === failure);
  assert.equal(records.length, 0);
});
