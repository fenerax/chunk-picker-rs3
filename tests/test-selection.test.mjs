import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTest, discoverTests, quickTests } from '../scripts/test-selection.mjs';

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
