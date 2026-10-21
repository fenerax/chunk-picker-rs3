import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runLiveBaseCheck, assertLifecycleProof, assertScratchPorts, lifecycleStages, liveBaseScope, claimLiveBaseAttempt, recoverDeadLiveBaseAttempt, runLifecycleWithCleanup, boundedLifecycleScripts, assertCompatibilityOutputPaths } from '../scripts/private-companion/live-base-compatibility.mjs';

const identity = { digest: 'a'.repeat(64), livePayloadDigest: 'b'.repeat(64), revision: 'c'.repeat(40) };
const proof = () => ({ schema: 'rs3-bounded-lifecycle-v1', scope: liveBaseScope, passed: true, cleanupVerified: true,
  stages: [...lifecycleStages], starts: ['baseline', 'candidate', 'baseline'].map((slot, index) => ({ slot, pid: 1000 + index,
    processStartedAt: new Date(1700000000000 + index).toISOString(), authenticatedReady: true })),
  pointerBefore: 'd'.repeat(64), pointerAfter: 'd'.repeat(64), candidatePointer: 'e'.repeat(64), syntheticStateUnchanged: true });
function adapters(overrides = {}) {
  return { 'exact-live-payload': async () => ({ passed: true }), 'retained-release-proof': async () => ({ passed: true }),
    'private-drift': async () => ({ passed: true }), 'scratch-lifecycle': async () => proof(), ...overrides };
}
test('bounded check binds live pair and tooling and requires observed lifecycle', async () => {
  const result = await runLiveBaseCheck({ toolingDigest: 'f'.repeat(64), identity: async () => identity, steps: adapters() });
  assert.equal(result.passed, true); assert.equal(result.livePairDigest, identity.digest); assert.equal(result.toolingDigest, 'f'.repeat(64));
  assert.equal(result.scope, liveBaseScope); assert.equal(result.checks.length, 4);
  await assert.rejects(runLiveBaseCheck({ toolingDigest: 'f'.repeat(64), identity: async () => identity,
    steps: adapters({ 'scratch-lifecycle': async () => ({ passed: true, dryRun: true, stages: [...lifecycleStages] }) }) }), /lifecycle proof/);
});
test('live identity is rechecked on success and on failed compatibility', async () => {
  for (const steps of [adapters(), adapters({ 'private-drift': async () => ({ passed: false }) })]) {
    let calls = 0;
    await assert.rejects(runLiveBaseCheck({ toolingDigest: 'f'.repeat(64), identity: async () => ++calls === 1 ? identity : { ...identity, digest: '0'.repeat(64) }, steps }), /Live pair changed/);
    assert.equal(calls, 2);
  }
});
test('failed retained proof prevents scratch lifecycle and never earns acceptance', async () => {
  let launched = false;
  await assert.rejects(runLiveBaseCheck({ toolingDigest: 'f'.repeat(64), identity: async () => identity,
    steps: adapters({ 'retained-release-proof': async () => ({ passed: false }), 'scratch-lifecycle': async () => { launched = true; return proof(); } }) }), /retained-release-proof/);
  assert.equal(launched, false);
});
test('lifecycle acceptance refuses missing cleanup, wrong rollback, unauthenticated starts and partial phases', () => {
  for (const change of [p => { p.cleanupVerified = false; }, p => { p.pointerAfter = p.candidatePointer; },
    p => { p.starts[1].authenticatedReady = false; }, p => { p.starts[0].processStartedAt = 'invalid'; },
    p => { p.stages.splice(2, 1); }, p => { p.syntheticStateUnchanged = false; }]) {
    const value = proof(); change(value); assert.throws(() => assertLifecycleProof(value), /incomplete/);
  }
  assert.equal(assertLifecycleProof(proof()).passed, true);
});
test('only isolated scratch listeners are accepted', () => {
  // Guard inputs only; these fixtures never bind a listener.
  const scratchStart = 89 * 100;
  assert.deepEqual(assertScratchPorts(), { host: '127.0.0.1', port: scratchStart + 60, loopbackPort: scratchStart + 61 });
  for (const options of [{ host: '100.64.0.1' }, { host: '0.0.0.0' }, { port: Number('87' + '88') }, { port: scratchStart, loopbackPort: scratchStart }, { loopbackPort: 90 * 100 }]) {
    assert.throws(() => assertScratchPorts(options), /scratch ports/);
  }
});
test('concurrent attempts cannot replace or clear the active barrier; live owner recovery refuses', async t => {
  const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? path.join(os.tmpdir(), 'rs3-test-scratch');
  assert.ok(path.isAbsolute(scratch ?? ''), 'explicit job scratch required'); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'live-claim-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(scratch)); await rm(root, { recursive: true, force: true }); });
  const pending = path.join(root, 'exact.pending.json'), inputs = { toolingDigest: 'a'.repeat(64), livePayloadDigest: 'b'.repeat(64) };
  const results = await Promise.allSettled([claimLiveBaseAttempt(pending, inputs), claimLiveBaseAttempt(pending, inputs)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected').length, 1);
  const retained = await readFile(pending, 'utf8');
  await assert.rejects(recoverDeadLiveBaseAttempt(pending), /still alive/);
  assert.equal(await readFile(pending, 'utf8'), retained);
  await assert.rejects(claimLiveBaseAttempt(pending, inputs), /active, failed or interrupted/);
  assert.equal(await readFile(pending, 'utf8'), retained);
  const deadPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { windowsHide: true, encoding: 'utf8' }));
  await writeFile(pending, JSON.stringify({ ...JSON.parse(retained), ownerPid: deadPid }));
  assert.equal((await recoverDeadLiveBaseAttempt(pending)).recovered, true);
  const blocked = pending.replace(/\.pending\.json$/, '.blocked.json');
  assert.equal(JSON.parse(await readFile(blocked, 'utf8')).schema, 'rs3-live-base-blocked-v1');
  await claimLiveBaseAttempt(pending, inputs);
  assert.equal(JSON.parse(await readFile(blocked, 'utf8')).schema, 'rs3-live-base-blocked-v1', 'recovery/new claim cannot revive older success');
});
test('native failure/timeout reconciliation always runs and cleanup failure refuses success', async () => {
  const observed = [];
  await assert.rejects(runLifecycleWithCleanup(async () => { observed.push('start'); throw Error('helper timed out'); }, async () => { observed.push('owned-stop'); }), /timed out/);
  assert.deepEqual(observed, ['start', 'owned-stop']);
  await assert.rejects(runLifecycleWithCleanup(async () => ({ passed: true }), async () => { throw Error('owned cleanup uncertain'); }), /cleanup uncertain/);
});
test('native lifecycle and independent reconciliation scripts parse under Windows PowerShell', { skip: process.platform !== 'win32' }, () => {
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const source of Object.values(boundedLifecycleScripts())) {
    execFileSync(ps, ['-NoProfile', '-Command', '$tokens=$null;$issues=$null;[Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$tokens,[ref]$issues)|Out-Null;if($issues.Count){$issues|ForEach-Object {$_.Message};exit 1}'],
      { input: source, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
  }
});
test('owned job siblings can share the runtime parent while live storage and sidecars stay protected', () => {
  const root = path.resolve('synthetic-path-fixture'), release = path.join(root, 'live-kit/releases/live');
  const live = { release, current: path.join(root, 'runtime/current.json'), configFile: path.join(release, 'config.json'),
    config: { dataDir: path.join(root, 'runtime/data'), publicOriginFile: path.join(root, 'runtime/public-origin'), packsDir: path.join(root, 'live-kit/packs'),
      coreRoot: path.join(release, 'core'), addons: { path: path.join(release, 'addons/addon.json') } } };
  const inputs = { kit: path.join(root, 'branch-kit'), output: path.join(root, 'runtime/audits/demo'), evidenceDir: path.join(root, 'runtime/audits/evidence'), live };
  assert.doesNotThrow(() => assertCompatibilityOutputPaths(inputs));
  for (const output of [live.config.dataDir, path.join(live.config.dataDir, 'scratch'), live.config.publicOriginFile, live.current, path.join(root, 'runtime'), path.join(release, 'scratch')]) {
    assert.throws(() => assertCompatibilityOutputPaths({ ...inputs, output }), /overlaps protected/);
  }
});
