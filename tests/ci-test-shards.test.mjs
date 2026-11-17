import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { balanceTests, assertPartition, shardTests } from '../scripts/ci/test-shards.mjs';
import { timingTable } from '../scripts/ci/update-test-timings.mjs';
import { discoverTests, testRunPolicy } from '../scripts/test-selection.mjs';
import { mergeLinuxReports } from '../scripts/ci/coverage-gate.mjs';

test('deterministic timing-balanced shards cover every discovered full-suite file exactly once', async () => {
  const files = await discoverTests(undefined, 'full');
  const shards = await shardTests(files);
  assertPartition(files, shards);
  assert.deepEqual(await shardTests([...files].reverse()), shards);
  assert.equal(shards.length, 4);
  assert.ok(shards.every(shard => shard.files.length));
  // Leave setup headroom under the 15-minute timeout even at 1.5x slowdown.
  const estimates = shards.map(shard => shard.estimatedMs);
  assert.ok(Math.max(...estimates) * 1.5 + 60_000 < 12 * 60_000, `Predicted slow-runner budget: ${estimates}`);
  assert.ok(Math.max(...estimates) - Math.min(...estimates) < 15_000, `Unbalanced plan: ${estimates}`);
  const timings = JSON.parse(await readFile(new URL('../scripts/ci/test-timings.json', import.meta.url), 'utf8'));
  const weight = file => timings.files[`tests/${file}`] ?? timings.defaultMs;
  const shared = files.filter(file => !testRunPolicy(file).solo);
  const critical = shared.reduce((a, b) => weight(a) >= weight(b) ? a : b);
  const longest = shards.find(shard => shard.files.includes(critical));
  // The runner always executes solo work first. The balancer starts the longest
  // shared file first in its shared phase and includes the solo prefix in cost;
  // it does not promise a solo-free shard for that file.
  assert.equal(longest.files.find(file => !testRunPolicy(file).solo), critical);
  assert.ok(longest.estimatedMs >= longest.soloMs + weight(critical));
  for (const shard of shards) {
    const ordered = shard.files.filter(file => !testRunPolicy(file).solo).map(weight);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => b - a));
  }
  assert.throws(() => assertPartition(files, shards.slice(1)), /incomplete/);
  assert.throws(() => assertPartition(files, [...shards, shards[0]]), /duplicate/);
  const weights = { defaultMs: 10, files: { 'tests/slow.test.mjs': 100 } };
  const sample = balanceTests(['slow.test.mjs', 'new.test.mjs', 'other.test.mjs'], weights, 2);
  assert.equal(sample[0].wallMs, 100);
  assert.equal(sample[1].wallMs, 20);
  assert.throws(() => balanceTests([], weights, 0), /count/);
});

test('estimates include solo prefixes and shared worker tails instead of ideal average throughput', () => {
  // Seven equal shared files need two waves across six workers. The former
  // max(longest, total / 6) formula incorrectly predicted only 116.7ms.
  const files = ['solo.test.mjs', ...Array.from({ length: 7 }, (_, i) => `shared-${i}.test.mjs`)];
  const plan = balanceTests(files, { defaultMs: 100, files: { 'tests/solo.test.mjs': 25 } }, 1,
    file => ({ solo: file === 'solo.test.mjs' }));
  assert.equal(plan[0].soloMs, 25);
  assert.equal(plan[0].sharedMs, 700);
  assert.equal(plan[0].estimatedMs, 225);
  assert.deepEqual(balanceTests([...files].reverse(), { defaultMs: 100, files: { 'tests/solo.test.mjs': 25 } }, 1,
    file => ({ solo: file === 'solo.test.mjs' })), plan);
});

test('timing generation uses passing completed attempts and a conservative new-file default', () => {
  const ledger = (duration, outcome = 'pass') => [
    { schema: 'rs3-file-ledger-v1', lane: 'test', sha: 'a'.repeat(40), runId: '1', runAttempt: 1, files: ['tests/one.test.mjs'] },
    { type: 'admitted', file: 'tests/one.test.mjs', attempt: 1, value: { outcome: 'interrupted' } },
    { type: 'completed', file: 'tests/one.test.mjs', attempt: 1, value: { outcome, processWallMs: duration } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
  assert.deepEqual(timingTable([ledger(10), ledger(20), ledger(999, 'fail')]).files, { 'tests/one.test.mjs': 20 });
  assert.equal(timingTable([ledger(20)]).defaultMs, 20);
  assert.throws(() => timingTable([ledger(10, 'fail')]), /No completed/);
});

const report = file => {
  const name = ['synthetic pass'], occurrence = 1;
  return { schema: 'rs3-test-coverage-v1', lane: 'test', passed: true, files: [file], completedFiles: [file],
    tests: [{ file, name, occurrence, key: JSON.stringify([file, name, occurrence]), kind: 'test', status: 'pass' }],
    fileResults: [{ file, passed: true, recordCount: 1, counts: { tests: 1, suites: 0, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } }] };
};
test('coverage aggregation refuses missing, overlapping, misassigned and failed shard evidence', () => {
  const a = report('tests/a.test.mjs'), b = report('tests/b.test.mjs'), inventories = [a.files, b.files];
  assert.deepEqual(mergeLinuxReports([a, b], inventories).files, [...a.files, ...b.files]);
  assert.throws(() => mergeLinuxReports([a], inventories), /Missing/);
  assert.throws(() => mergeLinuxReports([a, a], [a.files, a.files]), /Duplicate/);
  assert.throws(() => mergeLinuxReports([b, a], inventories), /Incomplete/);
  assert.throws(() => mergeLinuxReports([a, { ...b, passed: false }], inventories), /failed/);
  assert.throws(() => mergeLinuxReports([a, { ...b, completedFiles: [] }], inventories), /Incomplete/);
});

test('workflow runs four fail-fast bounded shards and requires all reports', async () => {
  const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: \[gate, inputs\]/);
  assert.match(workflow, /fail-fast: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /npm test -- --shard=\$\{\{ matrix.shard \}\}\/4\s*$/m);
  assert.match(workflow, /test "\$TEST_RESULT" = success/);
  assert.match(workflow, /RS3_COVERAGE_SHARDS: 4/);
  assert.match(workflow, /test-shard-\$\{\{ matrix.shard \}\}-coverage/);
  for (const use of workflow.matchAll(/uses: (actions\/[^@\s]+)@([^\s]+)/g)) assert.match(use[2], /^[a-f0-9]{40}$/);
});

test('test workflows install verified cached restic offline and bound cold downloads', async () => {
  for (const name of ['test.yml', 'stability.yml']) {
    const workflow = await readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
    const steps = workflow.split(/^      - /m);
    const step = title => {
      const found = steps.find(text => text.startsWith('name: ' + title + '\n'));
      assert.ok(found, `${name}: ${title}`);
      return found;
    };
    assert.doesNotMatch(workflow, /apt-get\s+(?:update|install)/);
    const identify = step('Identify restic archive');
    assert.match(identify, /'key=restic-linux-' \+ cpu \+ '-' \+ resticPin.version \+ '-' \+ pin.archive/);
    assert.ok(identify.includes('https://github.com/restic/restic/releases/download/v'));
    for (const title of ['Restore restic archive', 'Restore required restic archive', 'Save restic archive']) {
      const cache = step(title);
      assert.match(cache, /uses: actions\/cache\/(?:restore|save)@[a-f0-9]{40}/);
      assert.match(cache, /timeout-minutes: 3/);
      assert.match(cache, /path: \$\{\{ runner.temp \}\}\/restic-archive.bz2/);
      assert.match(cache, /key: \$\{\{ (?:steps.restic|needs.(?:inputs|plan)).outputs.(?:key|restic-key) \}\}/);
      assert.doesNotMatch(cache, /restore-keys:/);
      if (title.startsWith('Restore')) assert.match(cache, /SEGMENT_DOWNLOAD_TIMEOUT_MINS: 2/);
    }
    assert.match(step('Restore required restic archive'), /fail-on-cache-miss: true/);
    const download = step('Download and verify restic archive');
    assert.match(download, /if: .*steps.resticcache.outputs.cache-hit != 'true'/);
    assert.match(download, /timeout-minutes: 3/);
    assert.match(download, /curl --silent --fail --location --connect-timeout 30 --max-time 120/);
    assert.match(download, /"\$RESTIC_URL" 2>\/dev\/null; then\n.*::error::Restic release download failed.*\n\s+exit 1/);
    assert.match(download, /if ! printf .*sha256sum --check --status; then\n.*checksum mismatch.*\n\s+exit 1/);
    assert.doesNotMatch(download, /--retry|--show-error/);
    assert.match(step('Save restic archive'), /if: .*steps.resticcache.outputs.cache-hit != 'true'/);
    const install = step('Install checksum-pinned restic for the local encrypted restore test');
    assert.match(install, /for tool in bzip2 prlimit/);
    assert.match(install, /command -v "\$tool".*exit 1/);
    assert.match(install, /scripts\/ops\/install-restic.mjs --archive-file "\$\{\{ runner.temp \}\}\/restic-archive.bz2"/);
    assert.doesNotMatch(install, /curl|wget|https?:/);
  }
});
