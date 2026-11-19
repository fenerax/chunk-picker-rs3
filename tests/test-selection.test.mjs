import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTest, discoverTests, quickTests, testRunPolicy } from '../scripts/test-selection.mjs';

// Required quick coverage and its derived inventory run in the candidate lane.
test('quick suite covers small state, presentation and helper models', async () => {
  const files = await discoverTests();
  for (const name of ['state', 'command-state', 'history-text', 'settings', 'settings-panel', 'rules-panel', 'task-filters', 'helper-model', 'test-selection', 'platform-api']) {
    assert.ok(files.includes(`${name}.test.mjs`), name);
  }
  const inherited = files.filter(name => !quickTests.has(name));
  for (const name of inherited) {
    assert.match(name, /\.private\.test\.mjs$/);
    assert.equal(classifyTest(name.replace(/\.private\.test\.mjs$/, '.test.mjs')), 'quick');
  }
  assert.deepEqual(new Set(files.filter(name => !inherited.includes(name))), quickTests, 'direct quick inventory is derived from the files');
  assert.deepEqual(files, [...files].sort());
});

test('default suite retains fast incremental unlock coverage and excludes the full-game proof', async () => {
  const files = await discoverTests(undefined, 'full');
  assert.ok(files.includes('incremental-unlock.test.mjs'));
  assert.ok(!files.some(name => name.includes('incremental-unlock-full')));
});

test('viewer HTTP regressions stay quick and the Chrome journey stays full-only', async () => {
  const quick = await discoverTests(), full = await discoverTests(undefined, 'full');
  assert.ok(quick.includes('picker-routing.test.mjs'));
  assert.ok(!quick.includes('viewer-map-access-browser.test.mjs'));
  assert.ok(full.includes('viewer-map-access-browser.test.mjs'));
  assert.equal(classifyTest('viewer-map-access-browser.test.mjs'), 'full-only');
  assert.equal(testRunPolicy('viewer-map-access-browser.test.mjs').env.RS3_DATASET, 'open-f2p');
});
