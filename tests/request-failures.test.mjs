import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenCommands } from '../app/web/screen-commands.mjs';
import { createRequestReader, retryAfterMs } from '../app/web/live-swap-client.mjs';

// Synthetic transport only: the real shared API helper, no server or saved data.
const response = (status, value = { message: 'Error: ECONNRESET\n at internal (/private/file:3)' }, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const routes = ['tasks', 'predict', 'area-check', 'teleports', 'helper-drops', 'training-plan', 'death-estimates', 'chunk-planning', 'sandbox/evaluate', 'prediction-intent', 'pool-ranking-intent', 'profile/preview'];
function screen() {
  const c = { canWrite: () => true, sandbox: { active: false }, state: { revision: 7, members: [{ id: 'a', name: 'Player' }] }, memberId: 'a', $: () => null };
  createScreenCommands(c); return c;
}

for (const [failure, message] of [[429, /Too many requests/], [503, /busy or restarting/], [409, /saved map changed/], [413, /too large/], ['offline', /Check your internet/], ['ECONNRESET', /Check your internet/], ['html503', /busy or restarting/]]) {
  test(`shared API: ${failure} is plain, single dispatch, and every calculation route can retry`, async t => {
    let failed = true, calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (!failed) return response(200, { ready: true });
      if (typeof failure === 'number') return response(failure);
      if (failure === 'html503') return new Response('<html>Internal server error</html>', { status: 503 });
      throw new TypeError(failure);
    });
    const c = screen();
    for (const route of routes) {
      failed = true; const before = calls;
      await assert.rejects(c.api(`/api/${route}?memberId=a`), error => message.test(error.message) && !/ECONN|Error:|internal|private|<html>/.test(error.message));
      assert.equal(calls, before + 1, 'reads are never automatically replayed');
      failed = false; assert.deepEqual(await c.api(`/api/${route}?memberId=a`), { ready: true });
    }
  });
}

test('Retry-After seconds and HTTP dates hold the route across query changes; other routes stay usable', async () => {
  for (const status of [429, 503]) for (const header of ['5', new Date(15000).toUTCString()]) {
    let clock = 10000, calls = 0;
    const read = createRequestReader({ now: () => clock, fetch: async () => ++calls === 1 ? response(status, {}, { 'Retry-After': header }) : response(200, { ready: true }) });
    await read('/api/tasks?memberId=a');
    await assert.rejects(read('/api/tasks?memberId=b'), { status, retryAfterMs: 5000 });
    assert.equal(calls, 1);
    await read('/api/teleports'); assert.equal(calls, 2);
    clock += 4001;
    await assert.rejects(read('/api/tasks'), /1 seconds/);
    clock = 15000;
    assert.equal((await read('/api/tasks')).value.ready, true); assert.equal(calls, 3);
  }
  for (const value of ['', '-1', 'garbage', '1e400']) assert.equal(retryAfterMs(response(429, {}, { 'Retry-After': value }), 2000000000000), 0);
});

test('an aborted read stays silent and an unreadable success gives recovery guidance', async () => {
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  const read = createRequestReader({ fetch: async () => { calls++; return new Response('truncated'); } });
  await assert.rejects(read('/api/tasks', { signal: aborted.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
  await assert.rejects(read('/api/tasks'), /interrupted or unreadable/);
});
