// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile), MiB = 1024 ** 2;
const cap = (ledger, unit = 'chargeBytes') => ledger.dimensions.find(d => d.unit === unit).cap;
const owner = (result, id) => result.workerLedgers.find(row => row.id === id);

async function effective(profile) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_')));
  env.RS3_DATASET = 'open-f2p';
  if (profile) env.RS3_MEMORY_PROFILE = profile;
  const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('./helpers/memory-profile-caps.mjs', import.meta.url))], { env, windowsHide: true });
  return JSON.parse(stdout);
}

test('default effective caps preserve the origin/main cache policy', async () => {
  // Pinned review baseline; tests need no network or mutable Git refs.
  const baseline = JSON.parse(await readFile(new URL('./fixtures/cache-caps-origin-main.json', import.meta.url)));
  const result = await effective();
  assert.equal(result.profile.profile, 'default');
  assert.equal(result.hasStartupBudget, false, 'default startup data keeps the existing descriptor shape');
  assert.equal(result.startupBudget, null);
  assert.equal(result.profile.totalBytes, null); assert.equal(result.profile.allocatedBytes, null);
  assert.equal(cap(owner(result, 'worker-cache')), baseline.workerBytes);
  assert.equal(cap(owner(result, 'worker-cache'), 'entries'), baseline.workerEntries);
  assert.deepEqual(owner(result, 'worker-cache').partitions, { snapshotBytes: 0, ...baseline.workerPartitions });
  assert.equal(cap(owner(result, 'hot-graph')), baseline.hotBytes);
  assert.equal(cap(owner(result, 'hot-graph'), 'entries'), 1);
  assert.deepEqual(result.scheduler.partitions, baseline.schedulerPartitions);
  assert.equal(cap(result.scheduler), 320 * MiB);
  assert.equal(result.foreground.byteLimit, baseline.schedulerPartitions.foregroundBytes);
  assert.equal(result.foreground.limit, 8);
  for (const [name, limits] of Object.entries(baseline.responses)) {
    assert.equal(cap(result.responses[name]), limits.bytes, name);
    assert.equal(cap(result.responses[name], 'entries'), limits.entries, name);
  }
  assert.equal(cap(result.response), null); assert.equal(cap(result.response, 'entries'), null);
  assert.equal(result.response.complete, false);
  assert.equal(result.response.dimensions[1].used, 192 * MiB);
  assert.deepEqual(result.residentGroups, [1, 1, 1, 1], 'default aggregate cannot evict locally eligible results');
  for (const [id, entries] of [['engine', 16], ['state-inputs', 2], ['installed-bases', null]]) {
    const ledger = owner(result, id);
    assert.equal(cap(ledger, 'entries'), entries); assert.equal(cap(ledger), null);
    assert.equal(ledger.dimensions[1].enforced, false); assert.equal(ledger.complete, false);
    assert(Number.isSafeInteger(ledger.dimensions[1].used));
  }
});

test('budget-672 effective caps enforce the original service allocation across four calculators', async () => {
  const result = await effective('budget-672');
  assert.equal(result.hasStartupBudget, true);
  assert.deepEqual(result.startupBudget, result.profile, 'enabled profiles send the scheduler calculator shares exactly');
  assert.equal(result.profile.allocatedBytes, 672 * MiB);
  assert.equal(cap(result.response), 128 * MiB); assert.equal(cap(result.response, 'entries'), 4096);
  assert.equal(result.response.complete, true); assert.equal(result.response.dimensions[1].used, 96 * MiB);
  assert.deepEqual(result.residentGroups, [0, 0, 1, 1]);
  assert.deepEqual(result.scheduler.partitions, { foregroundBytes: 48 * MiB, advisoryBytes: 48 * MiB,
    duoBytes: 16 * MiB, predictionBytes: 8 * MiB, unlockBytes: 8 * MiB });
  assert.equal(cap(result.scheduler), 128 * MiB);
  assert.equal(cap(owner(result, 'worker-cache')), 64 * MiB);
  assert.equal(owner(result, 'engine').parsedByteLimit, 32 * MiB);
  assert.equal(cap(owner(result, 'state-inputs')), 4 * MiB);
  assert.equal(cap(owner(result, 'installed-bases')), 4 * MiB);
  assert.equal(cap(owner(result, 'installed-bases'), 'entries'), 2);
  for (const ledger of result.workerLedgers) {
    assert.equal(ledger.complete, true);
    for (const dimension of ledger.dimensions) assert.equal(dimension.enforced, true);
  }
});
