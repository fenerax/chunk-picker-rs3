import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise harness helpers without importing its CLI entrypoint or starting a
// server/browser. No gameplay fixtures or private stores are read.
const source = await readFile(new URL('../scripts/perf/page-load.mjs', import.meta.url), 'utf8');
function parsing(args) {
  const start = source.indexOf('const options =');
  const end = source.indexOf('\nfunction inside(');
  const context = vm.createContext({ console: { log() {} }, path: { resolve: value => value }, args });
  vm.runInContext(source.slice(start, end) + '\nparse(args); globalThis.options = options;', context);
  return context.options;
}

test('locked-panel dwell is opt-in and keeps existing task/member controls', () => {
  assert.equal(parsing([]).unlockDwellMs, 0);
  const options = parsing(['--unlock-dwell-ms', '3000', '--unlock-member', 'player2', '--group-view', 'on', '--settlement', 'tasks']);
  assert.equal(options.unlockDwellMs, 3000);
  assert.equal(options.unlockMember, 'player2');
  assert.equal(options.taskMilestone, 'duo');
  assert.equal(options.settlement, 'tasks');
  for (const value of ['-1', '0.5', 'NaN', '60001']) {
    assert.throws(() => parsing(['--unlock-dwell-ms', value]), /integer from 0 through 60000/);
  }
  assert.equal(parsing(['--unlock-dwell-ms', '60000']).unlockDwellMs, 60000);
});

test('positive dwell remains separate from prepared and unprepared assertions', () => {
  for (const pick of ['prepared', 'unprepared']) {
    assert.throws(() => parsing(['--unlock-dwell-ms', '3000', '--unlock-pick', pick]), /requires --unlock-pick any/);
    assert.equal(parsing(['--unlock-pick', pick]).unlockPick, pick);
  }
  assert.throws(() => parsing(['--unlock-dwell-ms', '3000', '--unlock-preview', 'on']), /--unlock-preview off/);
});

test('explicit unlock chunk accepts matching prepared and unprepared workflows', () => {
  assert.equal(parsing([]).unlockChunk, undefined);
  for (const pick of ['prepared', 'unprepared']) {
    const parsed = parsing(['--unlock-chunk', '7463', '--unlock-pick', pick, '--group-view', 'on']);
    assert.equal(parsed.unlockChunk, '7463');
    assert.equal(parsed.unlockPick, pick);
    assert.equal(parsed.taskMilestone, 'duo');
  }
  for (const value of ['0', '-1', '7463.5', '07463', 'NaN', '../7463']) {
    assert.throws(() => parsing(['--unlock-chunk', value]), /numeric surface chunk ID/);
  }
});

test('explicit unprepared chunk must be locked surface and outside every warm candidate', async () => {
  const start = source.indexOf("const chunk = await browser.evaluate(`fetch('/api/state'");
  const end = source.indexOf('\n        if (!chunk)', start);
  const choose = source.slice(start, end).replace('const chunk =', 'globalThis.chunk =');
  const evaluate = async ({ unlocked = [], selected = [], pendingRoll = [], pool = [], surface = ['7463'], pick = 'unprepared' } = {}) => {
    const context = vm.createContext({ member: 'player1', options: { unlockPick: pick, unlockChunk: '7463' },
      browser: { evaluate: expression => vm.runInNewContext(expression, { fetch: async route => ({ json: async () => route === '/api/state'
        ? { state: { members: [{ id: 'player1', unlocked, selected, pendingRoll }] }, pools: { player1: { eligible: pool.map(id => ({ id })) } } }
        : { surface } }) }) } });
    await vm.runInContext(`(async()=>{${choose};return chunk;})()`, context);
    return context.chunk;
  };
  assert.equal(await evaluate(), '7463');
  assert.equal(await evaluate({ selected: ['7463'], pick: 'prepared' }), '7463');
  for (const field of ['unlocked', 'pendingRoll']) await assert.rejects(evaluate({ [field]: ['7463'] }), /not a locked surface/);
  await assert.rejects(evaluate({ surface: [] }), /not a locked surface/);
  for (const field of ['selected', 'pool']) await assert.rejects(evaluate({ [field]: ['7463'] }), /in the warm pool/);
});

test('dwell follows locked-panel readiness and records observed wait outside Unlock', async () => {
  const fn = source.slice(source.indexOf('async function prepareUnlockUI('), source.indexOf('\nasync function captureViews('));
  let now = 100, panelReady = false, closed = false;
  const calls = [];
  const context = vm.createContext({
    options: { unlockDwellMs: 3000, unlockPick: 'any', unlockPreview: 'off', settlement: 'tasks', timeout: 1000 },
    performance: { now: () => now }, snapshotExpression: 'snapshot',
    loadedViewport: () => ({ time: 100, visible: 1 }),
    networkCollector: () => ({ requests: new Map(), idle: () => false, close: () => { closed = true; } }),
    until: async callback => { assert.ok(await callback()); },
    sleep: async ms => { assert.ok(panelReady); calls.push(ms); now += ms + 2; },
  });
  vm.runInContext(fn + '\nglobalThis.prepare = prepareUnlockUI;', context);
  const browser = { evaluate: async expression => {
    if (expression === 'performance.now()') return now;
    if (expression.includes("textContent==='Unlock'")) panelReady = true;
    if (expression.includes("textContent==='Preview'")) assert.fail('Dwell must not click Preview');
    return true;
  } };
  const result = await context.prepare(browser, '11575');
  assert.deepEqual(calls, [3000]);
  assert.equal(result.dwellRequestedMs, 3000);
  assert.equal(result.dwellElapsedMs, 3002);
  assert.equal(closed, true);
});

test('reuse diagnostics whitelist raw and compressed sizes and represent unavailable counters', async () => {
  const fn = source.slice(source.indexOf('async function workerResidency('), source.indexOf('\nasync function sampleIdle('));
  const context = vm.createContext({});
  vm.runInContext(fn + '\nglobalThis.residency = workerResidency;', context);
  const diagnostic = { unlockReuse: { entries: 2, bytes: 1000, rawBytes: 900, compressedBytes: 123, hits: 1, secret: 'private' } };
  const browser = { evaluate: expression => vm.runInNewContext(expression, {
    fetch: async () => ({ ok: true, json: async () => diagnostic }),
  }) };
  const result = await context.residency(browser);
  assert.equal(result.unlockReuse.rawBytes, 900);
  assert.equal(result.unlockReuse.compressedBytes, 123);
  assert.equal(result.unlockReuse.byteLimit, null);
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  delete diagnostic.unlockReuse.rawBytes;
  assert.equal((await context.residency(browser)).unlockReuse.rawBytes, null);
  delete diagnostic.unlockReuse;
  assert.equal((await context.residency(browser)).unlockReuse, null);
});
