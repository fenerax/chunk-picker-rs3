import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayOptions, reconnectDelay, revisionParser, renderOverlay, startOverlay } from '../app/web/overlay-client.mjs';

class Node {
  constructor(tag) { this.tagName = tag; this.textContent = ''; this.children = []; this.dataset = {}; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}
function fixture() {
  const host = new Node('main'), status = new Node('p'), body = new Node('body');
  const document = { body, createElement: tag => new Node(tag), getElementById: id => id === 'overlay' ? host : status };
  let id = 0;
  const pending = new Map();
  const timers = { setTimeout(fn, delay) { pending.set(++id, { fn, delay }); return id; }, clearTimeout(id) { pending.delete(id); } };
  const location = { pathname: '/overlay/count', search: '?player=duo&variant=compact&size=small', hash: '#key=' + 'a'.repeat(43) };
  return { document, host, status, body, pending, timers, location };
}
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const data = revision => ({ widget: 'count', heading: 'Duo chunks', unlocked: 7, total: 10, revision });
const json = value => ({ ok: true, status: 200, json: async () => value });

test('overlay options constrain presentation and reconnect delays are bounded', () => {
  assert.deepEqual(overlayOptions({ pathname: '/overlay/roll', search: '?player=reed&variant=compact&size=large' }), { widget: 'roll', player: 'reed', variant: 'compact', size: 'large' });
  assert.deepEqual(overlayOptions({ pathname: '/overlay/unknown', search: '?variant=unknown&size=unknown' }), { widget: 'goals', player: 'duo', variant: 'full', size: 'medium', goals: 'personal' });
  for (const goals of ['personal', 'group', 'both']) assert.equal(overlayOptions({ pathname: '/overlay/goals', search: `?goals=${goals}` }).goals, goals);
  assert.equal(overlayOptions({ pathname: '/overlay/goals', search: '?goals=unknown' }).goals, 'personal');
  assert.deepEqual([-2, 0, 1, 2, 5, 100].map(reconnectDelay), [2000, 2000, 4000, 8000, 60000, 60000]);
});

test('revision parser retains partial records and ignores comments, malformed data and other events', () => {
  const revisions = [], parse = revisionParser(value => revisions.push(value));
  parse(': keepalive\n\nevent: worker\ndata: {"revision":9}\n\nevent: revi');
  parse('sion\ndata: {"revision":'); parse('2}\n'); parse('\nevent: revision\ndata: broken\n\n');
  parse('event: revision\ndata: {"revision":2.5}\n\nevent: revision\ndata: {"revision":3}\n\n');
  assert.deepEqual(revisions, [2, 3]);
});

test('revision parser accepts CRLF split across network chunks', () => {
  const revisions = [], parse = revisionParser(value => revisions.push(value));
  parse('event: revision\r'); parse('\ndata: {"revision":4}\r'); parse('\n\r'); parse('\n');
  assert.deepEqual(revisions, [4]);
});

test('rendering uses text-only nodes for goals, rolls and counts', () => {
  const f = fixture();
  renderOverlay(f.document, f.host, { widget: 'goals', heading: 'Goals', players: [{ name: 'Player', goals: [{ label: '<img onerror=alert(1)>' }] }, { name: 'Reed', goals: [] }] });
  assert.ok(text(f.host).includes('<img onerror=alert(1)>'));
  assert.ok(text(f.host).includes('No pinned goals'));
  renderOverlay(f.document, f.host, { widget: 'roll', heading: 'Last roll', roll: { player: 'Reed', phase: 'offered', chunks: [{ name: 'Lumbridge', id: '12345' }] } });
  assert.ok(text(f.host).includes('Chunk 12345'));
  assert.ok(text(f.host).includes('Choose your chunk'));
  renderOverlay(f.document, f.host, { widget: 'roll', heading: 'Last roll', roll: null });
  assert.ok(text(f.host).includes('No rolls yet'));
  renderOverlay(f.document, f.host, data(0));
  assert.ok(text(f.host).includes('7 / 10'));
});

test('shared goals render plain text, read-only player ticks and an explicit empty state', () => {
  const f = fixture();
  renderOverlay(f.document, f.host, { widget: 'goals', heading: 'Current goals', groupGoals: [
    { label: '<img onerror=alert(1)>' },
    { label: 'Both get a pickaxe', players: [{ name: 'Player', done: true }, { name: 'Reed', done: false }] },
  ] });
  assert.match(text(f.host), /Group goals/); assert.match(text(f.host), /<img onerror=alert\(1\)>/);
  assert.match(text(f.host), /☑ Player/); assert.match(text(f.host), /☐ Reed/);
  const all = node => [node, ...node.children.flatMap(all)];
  assert.equal(all(f.host).some(node => ['input', 'button', 'a', 'img'].includes(node.tagName)), false);
  assert.deepEqual(all(f.host).filter(node => node.attributes['aria-label']).map(node => node.attributes['aria-label']), ['Player: done', 'Reed: not done']);
  renderOverlay(f.document, f.host, { widget: 'goals', heading: 'Current goals', groupGoals: [], players: [{ name: 'Player', goals: [{ label: 'Personal pin' }] }] });
  assert.match(text(f.host), /No open group goals/); assert.match(text(f.host), /Personal pin/);
});

test('shared goals refresh through the existing revision stream with the selected source', async () => {
  const f = fixture(), calls = []; f.location.pathname = '/overlay/goals'; f.location.search = '?goals=both&player=duo';
  let enqueue, reads = 0;
  const body = new ReadableStream({ start(controller) { enqueue = value => controller.enqueue(new TextEncoder().encode(value)); } });
  const controller = startOverlay({ ...f, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/overlay/events?')) return { ok: true, status: 200, body };
    return json({ revision: reads, widget: 'goals', heading: 'Current goals', players: [], groupGoals: [
      { label: reads++ ? 'Updated shared plan' : 'Initial shared plan', players: [{ name: 'Reed', done: reads > 1 }] },
    ] });
  } });
  await flush(); assert.match(text(f.host), /Initial shared plan/); assert.match(text(f.host), /☐ Reed/);
  enqueue('event: revision\ndata: {"revision":1}\n\n'); await flush();
  assert.match(text(f.host), /Updated shared plan/); assert.match(text(f.host), /☑ Reed/);
  assert.equal(reads, 2); assert.ok(calls.every(call => new URL(call.url, 'http://fixture.invalid').searchParams.get('goals') === 'both'));
  controller.stop(); assert.equal(f.pending.size, 0);
});

test('missing credentials do not make requests', async () => {
  const f = fixture(); f.location.hash = '';
  let calls = 0;
  const controller = startOverlay({ ...f, fetch: async () => { calls++; } });
  await flush();
  assert.equal(calls, 0);
  assert.equal(f.pending.size, 0);
  assert.ok(f.status.textContent.includes('Open an overlay link'));
  controller.stop();
});

test('stopping an in-flight request aborts it and prevents subsequent rendering or connection', async () => {
  const f = fixture();
  let resolveRequest, signal, calls = 0;
  const controller = startOverlay({ ...f, fetch: async (_url, options) => {
    calls++; signal = options.signal;
    return new Promise(resolve => { resolveRequest = resolve; });
  } });
  assert.equal(calls, 1);
  controller.stop();
  assert.equal(signal.aborted, true);
  resolveRequest(json(data(0))); await flush();
  assert.equal(calls, 1);
  assert.equal(f.host.children.length, 0);
  assert.equal(f.pending.size, 0);
});

test('controller isolates credentials, updates from SSE and clears display on revoked data access', async () => {
  const f = fixture(), calls = [];
  let enqueue, dataRequests = 0;
  const body = new ReadableStream({ start(controller) { enqueue = value => controller.enqueue(new TextEncoder().encode(value)); } });
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/overlay/events?')) return { ok: true, status: 200, body };
    dataRequests++;
    return dataRequests === 3 ? { ok: false, status: 401 } : json(data(dataRequests - 1));
  };
  const controller = startOverlay({ ...f, fetch, random: () => 0 });
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(f.body.dataset.variant, 'compact');
  assert.equal(f.body.dataset.size, 'small');
  assert.ok(text(f.host).includes('7 / 10'));
  enqueue('event: revision\ndata: {"revision":1}\n\n'); await flush();
  assert.equal(dataRequests, 2);
  enqueue('event: revision\ndata: {"revision":2}\n\n'); await flush();
  assert.equal(dataRequests, 3);
  assert.equal(f.host.children.length, 0);
  assert.ok(f.status.textContent.includes('Overlay access ended'));
  assert.equal(f.pending.size, 0);
  assert.ok(calls.every(call => call.url.startsWith('/overlay/')));
  assert.ok(calls.every(call => !call.url.includes('a'.repeat(43))));
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer ' + 'a'.repeat(43)));
  assert.ok(calls.every(call => call.options.credentials === 'omit' && call.options.cache === 'no-store'));
  assert.ok(!text(f.host).includes('a'.repeat(43)));
  controller.stop();
});

test('failed connections retain displayed content and schedule bounded retries that stop cancels', async () => {
  const f = fixture();
  let failures = 0;
  const fetch = async url => { if (url.startsWith('/overlay/data?')) return json(data(0)); failures++; throw new Error('offline'); };
  const controller = startOverlay({ ...f, fetch, random: () => 0 });
  await flush();
  assert.ok(text(f.host).includes('7 / 10'));
  assert.equal(f.status.textContent, 'Reconnecting…');
  for (const expected of [2000, 4000, 8000]) {
    assert.equal(f.pending.size, 1);
    const [id, retry] = [...f.pending][0];
    assert.equal(retry.delay, expected);
    f.pending.delete(id); retry.fn(); await flush();
  }
  assert.equal(failures, 4);
  controller.stop();
  assert.equal(f.pending.size, 0);
});

test('revoked event access ends the controller and removes previously rendered data', async () => {
  const f = fixture();
  const controller = startOverlay({ ...f, fetch: async url => url.startsWith('/overlay/data?') ? json(data(0)) : { ok: false, status: 403 } });
  await flush();
  assert.equal(f.host.children.length, 0);
  assert.equal(f.pending.size, 0);
  assert.ok(f.status.textContent.includes('Overlay access ended'));
  controller.stop();
});

test('stale data after a newer event permits one followup then reconnects instead of looping', async () => {
  const f = fixture();
  let dataRequests = 0, enqueue;
  const fetch = async (url, options) => {
    if (url.startsWith('/overlay/data?')) { dataRequests++; return json(data(0)); }
    const body = new ReadableStream({ start(stream) {
      enqueue = value => stream.enqueue(new TextEncoder().encode(value));
      options.signal.addEventListener('abort', () => stream.error(new Error('aborted')), { once: true });
    } });
    return { ok: true, status: 200, body };
  };
  const controller = startOverlay({ ...f, fetch, random: () => 0 });
  await flush();
  enqueue('event: revision\ndata: {"revision":3}\n\n'); await flush();
  assert.equal(dataRequests, 3, 'initial data plus event refresh and one immediate followup');
  assert.equal(f.status.textContent, 'Reconnecting…');
  assert.equal(f.pending.size, 1);
  assert.equal([...f.pending.values()][0].delay, 2000);
  assert.ok(text(f.host).includes('7 / 10'));
  controller.stop();
});
