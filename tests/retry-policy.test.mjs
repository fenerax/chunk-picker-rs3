import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolveRetryPolicy, retryPolicyIdentity } from '../scripts/private-companion/retry-policy.mjs';
import { parseArgs } from '../scripts/private-companion/release-v2.mjs';
import { practiceLaneOptions } from '../scripts/private-companion/release-practice.mjs';
import { executionFor } from '../scripts/private-companion/post-merge-private.mjs';
import { gatePolicy, gateContract, laneEnvironment, stableExecution } from '../scripts/private-companion/release-evidence.mjs';

test('retry policy defaults on and explicit diagnostic off overrides manifest defaults', async () => {
  assert.equal(resolveRetryPolicy(), true);
  assert.equal(resolveRetryPolicy({}, { retryOnceInIsolation: false }), false);
  assert.equal(resolveRetryPolicy({ 'retry-once-in-isolation': true }, { retryOnceInIsolation: false }), true);
  assert.equal(resolveRetryPolicy({ 'no-retry-once-in-isolation': true }), false);
  assert.equal(resolveRetryPolicy({ retryOnceInIsolation: false }), false);
  assert.equal(gatePolicy.flaky, retryPolicyIdentity);
  assert.equal((await parseArgs([]))['retry-once-in-isolation'], true);
  assert.equal((await parseArgs(['--retry-once-in-isolation']))['retry-once-in-isolation'], true);
  assert.equal((await parseArgs(['--no-retry-once-in-isolation']))['retry-once-in-isolation'], false);
  await assert.rejects(parseArgs(['--retry-once-in-isolation', '--no-retry-once-in-isolation']), /Conflicting/);
  assert.throws(() => resolveRetryPolicy({ retryOnceInIsolation: 'false' }), /boolean/);
  assert.throws(() => resolveRetryPolicy({ retryOnceInIsolation: false, 'retry-once-in-isolation': true }), /Conflicting/);
});

test('CLI reads kit retry policy and explicit switches override its persisted diagnostic mode', async t => {
  const kit = await mkdtemp(path.join(os.tmpdir(), 'retry-policy-kit-'));
  t.after(() => rm(kit, { recursive: true, force: true }));
  await writeFile(path.join(kit, 'kit.json'), JSON.stringify({ retryOnceInIsolation: false }));
  assert.equal((await parseArgs(['--kit', kit]))['retry-once-in-isolation'], false);
  assert.equal(resolveRetryPolicy(await practiceLaneOptions({}, { retryOnceInIsolation: false })), false);
  assert.equal((await parseArgs(['--kit', kit, '--retry-once-in-isolation']))['retry-once-in-isolation'], true);
  await writeFile(path.join(kit, 'kit.json'), JSON.stringify({ retryOnceInIsolation: true }));
  assert.equal((await parseArgs(['--kit', kit, '--no-retry-once-in-isolation']))['retry-once-in-isolation'], false);
  await writeFile(path.join(kit, 'kit.json'), '{}');
  assert.equal((await parseArgs(['--kit', kit]))['retry-once-in-isolation'], true);
});

test('release CLI, postmerge and practice share execution keys and policy flips change lane and file identities', async () => {
  const kit = path.resolve('retry-policy-kit'), release = path.join(kit, 'releases/candidate');
  const config = { nodePath: process.execPath, concurrency: 2 };
  for (const lane of ['public-full', 'private-full']) {
    const executions = [];
    for (const args of [[], ['--no-retry-once-in-isolation']]) {
      const options = await parseArgs(args), enabled = resolveRetryPolicy(options);
      const worker = await executionFor({ ...config, ...(args.length ? { retryOnceInIsolation: enabled } : {}) }, kit, release, lane);
      const env = await laneEnvironment(release, config.nodePath, {
        RS3_TEST_CONCURRENCY: '2', RS3_TEST_RETRY_ONCE_IN_ISOLATION: enabled ? '1' : '0',
        ...(lane === 'public-full' ? { RS3_DATASET: 'open-f2p' } : {
          RS3_GAME_DATA_DIR: path.join(release, '.local/assembly/.local/game-data'),
          RS3_MAP_ASSETS_DIR: path.join(release, '.local/assembly/.local/map-assets'),
          RS3_PUBLIC_BROWSER_SCREEN_HARNESS: path.join(release, 'core/tests/browser-screen-harness.mjs'),
        }),
      });
      const execution = await stableExecution({ lane, command: config.nodePath, node: config.nodePath, args: ['scripts/test.mjs', 'full'], env, kit, release });
      assert.equal(worker.execution.digest, execution.digest);
      const practiceOptions = await practiceLaneOptions(args.length ? options : {}, { ...config });
      assert.equal(resolveRetryPolicy(practiceOptions), enabled);
      const practice = await executionFor({ ...config, retryOnceInIsolation: resolveRetryPolicy(practiceOptions) }, kit, release, lane);
      assert.equal(practice.execution.digest, execution.digest);
      executions.push(execution);
    }
    assert.notEqual(executions[0].digest, executions[1].digest);
    for (const name of [lane, 'file-' + lane]) {
      assert.notEqual(gateContract(name, { input: 'unchanged' }, executions[0]).key, gateContract(name, { input: 'unchanged' }, executions[1]).key);
    }
  }
});
