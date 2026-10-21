import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverTests, quickTests } from '../scripts/test-selection.mjs';
import { practiceQuickExpectation } from '../scripts/private-companion/practice-inventory.mjs';
import { fileURLToPath } from 'node:url';

// Candidate inventory remains strict and runs in the ordinary candidate lane.
test('quick suite covers small state, presentation and helper models', async () => {
  const files = await discoverTests();
  for (const name of ['state', 'command-state', 'history-text', 'settings', 'settings-panel', 'rules-panel', 'task-filters', 'helper-model', 'test-selection']) {
    assert.ok(files.includes(`${name}.test.mjs`), name);
  }
  // Private-only cases split from a reviewed quick file run in quick beside it.
  const split = files.filter(name => name.endsWith('.private.test.mjs'));
  for (const name of split) assert.ok(quickTests.has(name.replace(/\.private\.test\.mjs$/, '.test.mjs')), name);
  assert.equal(files.length - split.length, await practiceQuickExpectation(fileURLToPath(new URL('../', import.meta.url)), quickTests), 'every reviewed quick file still exists');
  assert.deepEqual(files, [...files].sort());
});
