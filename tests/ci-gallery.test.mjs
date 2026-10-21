import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeCandidates, findChrome, httpFailure, judgeSample, judgeMode, requestAllowed, originalFixtureFetch } from '../scripts/ci/gallery-support.mjs';
import { runMode, saveProbe } from '../scripts/ci/gallery-check.mjs';

test('Chrome discovery searches Linux PATH and conventional installation paths', async () => {
  const candidates = chromeCandidates({ platform: 'linux', env: { PATH: '/fixture/bin:/fixture/tools' } });
  assert(candidates.includes('/fixture/bin/google-chrome'));
  assert(candidates.includes('/fixture/tools/chromium-browser'));
  assert(candidates.includes('/usr/bin/google-chrome'));
  const seen = [];
  assert.equal(await findChrome({ platform: 'linux', env: { PATH: '/fixture/bin' }, canExecute: async value => {
    seen.push(value); return value === '/fixture/bin/chromium';
  } }), '/fixture/bin/chromium');
  assert.deepEqual(seen, ['/fixture/bin/google-chrome', '/fixture/bin/google-chrome-stable', '/fixture/bin/chromium']);
});

test('Chrome discovery uses Windows PATH separators, quoting and install locations', async () => {
  const options = { platform: 'win32', env: { Path: '"Z:\\fixture bin";Z:\\tools', PROGRAMFILES: 'Z:\\programs',
    'PROGRAMFILES(X86)': 'Z:\\programs-x86', LOCALAPPDATA: 'Z:\\local' } };
  const candidates = chromeCandidates(options);
  assert(candidates.includes('Z:\\fixture bin\\chrome.exe'));
  assert(candidates.includes('Z:\\tools\\google-chrome.exe'));
  for (const directory of ['programs', 'programs-x86', 'local']) assert(candidates.includes(`Z:\\${directory}\\Google\\Chrome\\Application\\chrome.exe`));
  assert.equal(await findChrome({ ...options, canExecute: async value => value === 'Z:\\tools\\chrome.exe' }), 'Z:\\tools\\chrome.exe');
});

test('explicit Chrome selection never falls back when unavailable', async () => {
  const seen = [];
  await assert.rejects(findChrome({ executable: '/fixture/missing-chrome', platform: 'linux',
    env: { CHROME_PATH: '/fixture/other-chrome', PATH: '/fixture/bin' },
    canExecute: async value => { seen.push(value); return value !== '/fixture/missing-chrome'; } }), /CHROME_UNAVAILABLE/);
  assert.deepEqual(seen, ['/fixture/missing-chrome']);
  assert.deepEqual(chromeCandidates({ platform: 'linux', env: { CHROME_PATH: '/fixture/preferred', CHROME_BIN: '/fixture/second', PATH: '' } }).slice(0, 2), ['/fixture/preferred', '/fixture/second']);
});

const sample = () => ({ ready: 'true', error: false, pathname: '/gallery/preview', entry: 'sample', visible: true, busy: false, brokenImages: 0 });
test('sample judgement requires exact ready state, identity, visible content and settled assets', () => {
  assert.deepEqual(judgeSample(sample(), 'sample'), []);
  for (const [change, code] of [[{ ready: true }, 'NOT_READY'], [{ error: true }, 'GALLERY_ERROR'],
    [{ pathname: '/gallery' }, 'WRONG_SAMPLE'], [{ entry: 'previous' }, 'WRONG_SAMPLE'],
    [{ visible: false }, 'EMPTY_SAMPLE'], [{ busy: true }, 'SAMPLE_BUSY'], [{ brokenImages: 1 }, 'BROKEN_IMAGE']]) {
    assert(judgeSample({ ...sample(), ...change }, 'sample').includes(code));
  }
  assert.deepEqual(judgeSample(undefined, 'sample'), ['NOT_READY', 'WRONG_SAMPLE', 'EMPTY_SAMPLE', 'SAMPLE_BUSY', 'BROKEN_IMAGE']);
});

const events = () => ({ consoleErrors: 0, exceptions: 0, blockedRequests: 0, failedRequests: 0, httpErrors: 0 });
const rows = () => [{ id: 'first', ready: true, failures: [] }, { id: 'second', ready: true, failures: [] }];
test('mode judgement requires complete ordered unique entries and every error counter', () => {
  const ids = ['first', 'second'];
  assert.equal(judgeMode(rows(), ids, events()), true);
  assert.equal(judgeMode([], [], events()), false);
  assert.equal(judgeMode(rows().slice(0, 1), ids, events()), false);
  assert.equal(judgeMode(rows(), ['first', 'first'], events()), false);
  assert.equal(judgeMode(rows().reverse(), ids, events()), false);
  assert.equal(judgeMode([{ id: 'first', ready: true, failures: ['GALLERY_ERROR'] }, rows()[1]], ids, events()), false);
  for (const key of Object.keys(events())) assert.equal(judgeMode(rows(), ids, { ...events(), [key]: 1 }), false);
  assert.equal(judgeMode(rows(), ids, {}), false);
});

test('mode judgement fails closed for malformed rows or event payloads', () => {
  for (const badRows of [[null], [{ id: 'first', ready: true }], [{ id: 'first', ready: 'true', failures: [] }]]) {
    assert.equal(judgeMode(badRows, ['first'], events()), false);
  }
  assert.equal(judgeMode(rows(), ['first', 'second'], undefined), false);
});

test('request policy permits same-origin reads and rejects APIs, writes and external requests', () => {
  const origin = 'http://gallery.invalid';
  for (const method of ['GET', 'HEAD']) assert.equal(requestAllowed(origin + '/assets/sample.png', method, origin), true);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal(requestAllowed(origin + '/assets/sample.png', method, origin), false);
  for (const url of [origin + '/api/state', origin + '/api/usage', origin + '/data/../api/state',
    'https://external.invalid/asset.png', 'http://gallery.invalid:1234/asset.png', '/asset.png', 'invalid']) {
    assert.equal(requestAllowed(url, 'GET', origin), false, url);
  }
});

test('HTTP failure diagnostics retain status and icon classification without retaining URLs', () => {
  assert.deepEqual(httpFailure(404, 'http://gallery.invalid/favicon.ico'), { status: 404, resource: 'browser-favicon' });
  assert.deepEqual(httpFailure(500, 'http://gallery.invalid/fixture-sensitive?fixture=placeholder'), { status: 500, resource: 'gallery-resource' });
  assert.deepEqual(httpFailure(404, 'invalid'), { status: 404, resource: 'gallery-resource' });
});

const capture = () => ({ metadata: { sourceOrigin: 'https://source.invalid', sourceFields: ['chunks', 'notes'], sourceVersion: { revision: 4 } },
  maps: { qxa: { chunks: ['12341'], notes: null }, qxb: { chunks: ['12342'] } } });
test('original fixture fetch preserves version and both map contracts without network access', async () => {
  const fixture = capture(), fetchFixture = originalFixtureFetch(fixture);
  for (const [route, value] of [['/version.json', { revision: 4 }], ['/maps/qxa/chunks.json', ['12341']],
    ['/maps/qxb/chunks.json', ['12342']], ['/maps/qxb/notes.json', null]]) {
    const response = await fetchFixture('https://source.invalid' + route, { method: 'GET' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), value);
  }
  assert.equal(await (await originalFixtureFetch({ ...fixture, metadata: { ...fixture.metadata, sourceVersion: undefined } })('https://source.invalid/version.json', { method: 'GET' })).json(), null);
});

test('original fixture fetch rejects requests outside the old allowlist', async () => {
  const fetchFixture = originalFixtureFetch(capture());
  for (const [url, request] of [
    ['https://other.invalid/version.json', { method: 'GET' }],
    ['https://source.invalid/version.json?extra=1', { method: 'GET' }],
    ['https://source.invalid/version.json#extra', { method: 'GET' }],
    ['https://source.invalid/maps/qxc/chunks.json', { method: 'GET' }],
    ['https://source.invalid/maps/qxa/private.json', { method: 'GET' }],
    ['https://source.invalid/unlisted.json', { method: 'GET' }],
    ['https://source.invalid/version.json', { method: 'POST' }],
    ['https://source.invalid/version.json', undefined],
  ]) await assert.rejects(fetchFixture(url, request), /ORIGINAL_FIXTURE_REQUEST/);
});

test('save probe requires the enabled control to invoke the safety guard', async t => {
  const note = { textContent: 'Not saved: gallery' };
  const checkbox = { checked: false, disabled: false, click() {} };
  const document = { querySelector: selector => selector.startsWith('.task-row') ? checkbox
    : selector === '.gallery-safety-note' ? note : null };
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  t.after(() => { delete globalThis.document; });
  assert.equal(await saveProbe(false), false, 'an inert control must not pass using the pre-existing note');
  checkbox.click = () => { note.textContent = 'Not saved: gallery'; };
  assert.equal(await saveProbe(false), true);
  checkbox.disabled = true;
  assert.equal(await saveProbe(false), false);
});

test('console errors arriving while interception shuts down still fail the mode', async () => {
  const browser = { listeners: new Set(), evaluate: async () => ({ ...sample(), entry: 'sample' }),
    async send(method) {
      if (method === 'Fetch.disable') for (const listener of browser.listeners) listener({
        method: 'Runtime.consoleAPICalled', params: { type: 'error' },
      });
      return {};
    } };
  const result = await runMode({ mode: 'plain', browser, server: { origin: 'http://gallery.invalid' },
    ids: ['sample'], output: '/fixture/unused-output', isInterrupted: () => false });
  assert.equal(result.passed, false);
  assert.equal(result.events.consoleErrors, 1);
  assert.equal(browser.listeners.size, 0);
});
