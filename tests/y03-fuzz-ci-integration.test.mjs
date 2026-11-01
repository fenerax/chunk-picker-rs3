import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { Client, Failure } from '../scripts/experiments/y03-fuzz-ci/client.mjs';
import { EXIT, hash } from '../scripts/experiments/y03-fuzz-ci/semantic.mjs';
import { validateReport } from '../scripts/experiments/y03-fuzz-ci/validate-report.mjs';
import { killGroup } from '../scripts/experiments/y03-fuzz-ci/supervise.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const gitAt = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_')));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
async function liveGroup(group) {
  const live = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const fields = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1].split(' ');
      if (Number(fields[2]) === group && fields[0] !== 'Z') live.push(Number(pid));
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  return live;
}

test('RSS breach after a final reply or at retirement cannot pass', { skip: process.platform !== 'linux' }, async () => {
  const fake = () => Object.assign(Object.create(Client.prototype), {
    child: { pid: process.pid, kill() {} }, limits: { rssBytes: 1 }, peakRSSBytes: 0, currentRSSBytes: 0,
    durations: [], send: async () => ({ response: { result: 'synthetic' } }), closed: Promise.resolve(),
  });
  await assert.rejects(fake().request({}, {}, performance.now() + 1000), error => error.kind === 'memory' && error.code === 13);
  assert.equal((await fake().close()).kind, 'memory');
});

test('failure arriving during retirement is returned to the campaign', async () => {
  const client = Object.assign(Object.create(Client.prototype), {
    sample() {}, child: { kill() {} }, currentRSSBytes: 1,
  });
  client.closed = Promise.resolve().then(() => { client.failure = new Failure('crash'); });
  assert.equal((await client.close()).code, EXIT.crash);
  assert.equal(client.currentRSSBytes, 0);
});

test('public controls, detector faults, committed refs, replay and independent cleanup', { skip: process.platform !== 'linux', timeout: 300000 }, async t => {
  const temporary = await mkdtemp(path.join(process.env.Y03_TEST_ARTIFACTS ?? tmpdir(), 'y03-detectors-'));
  let source;
  t.after(async () => {
    if (source) gitAt(ROOT, 'worktree', 'remove', '--force', source);
    if (!process.env.Y03_TEST_ARTIFACTS) await rm(temporary, { recursive: true, force: true });
  });
  const sha = gitAt(ROOT, 'rev-parse', 'HEAD');
  let serial = 0;
  async function run(args, root = ROOT) {
    const out = path.join(temporary, String(serial++));
    const child = spawn(process.execPath, ['scripts/experiments/y03-fuzz-ci/run.mjs', '--reference-ref', sha, '--candidate-ref', sha,
      '--cases', '1', '--shrink-attempts', '0', '--out', out, ...args], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stdout.resume(); child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => killGroup(child.pid), 110000);
    const [code] = await once(child, 'close'); clearTimeout(timer); killGroup(child.pid);
    assert.notEqual(code, null, stderr);
    const report = await json(path.join(out, 'report.json'));
    assert.equal(report.exitCode, code);
    return { code, out, report };
  }
  const mismatch = await run(['--fault', 'mismatch', '--shrink-attempts', '2']);
  assert.equal(mismatch.code, EXIT.mismatch); assert.equal(mismatch.report.faultControlPairs, 1);
  assert.equal(mismatch.report.failures[0].kind, 'mismatch'); assert(mismatch.report.differences > 0);
  assert(mismatch.report.shrink.reducedBytes < mismatch.report.shrink.originalBytes);
  assert.equal(mismatch.report.shrink.censored, true);
  const replay = await run(['--replay', path.join(mismatch.out, 'reduced.json')]);
  assert.equal(replay.code, EXIT.mismatch);
  const control = await run(['--replay', path.join(mismatch.out, 'failure.json'), '--fault', 'none']);
  assert.equal(control.code, EXIT.pass); assert.equal(control.report.differences, 0);
  assert.equal(control.report.nondeterministicFields, 0); assert.equal(control.report.replayPairs, 2);
  for (const fault of ['crash', 'timeout']) {
    const result = await run(['--fault', fault]);
    assert.equal(result.code, EXIT[fault]); assert.equal(result.report.faultControlPairs, 1);
    assert.equal(result.report.failures[0].side, 1);
  }
  assert.equal((await run(['--rss-mib', '1'])).code, EXIT.memory);
  assert.equal((await run(['--wall-ms', '100'])).code, EXIT.budget);
  // Isolated committed implementation change. The main checkout's calculator is
  // untouched; this detached worktree is owned by the test and removed below.
  source = path.join(temporary, 'source');
  gitAt(ROOT, 'worktree', 'add', '--detach', source, sha);
  const workerFile = path.join(source, 'app/tasks/worker.mjs');
  const worker = await readFile(workerFile, 'utf8');
  assert(worker.includes('const playResult ='));
  await writeFile(workerFile, worker.replace('const playResult =', "if (type === 'evaluate') result.metrics.publicDifferentialProbe = 1;\n    const playResult ="));
  const commit = message => {
    gitAt(source, 'add', '-A');
    gitAt(source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Public detector test', '-c', 'user.email=noreply@github.com', 'commit', '-m', message);
    return gitAt(source, 'rev-parse', 'HEAD');
  };
  const changedSHA = commit('Synthetic committed calculator detector control');
  const changed = await run(['--candidate-ref', changedSHA], source);
  assert.equal(changed.code, EXIT.mismatch); assert.deepEqual(changed.report.commits, [sha, changedSHA]);
  assert(changed.report.failures[0].paths.includes('/full/metrics/publicDifferentialProbe'));
  const doc = path.join(source, 'scripts/experiments/y03-fuzz-ci/README.md');
  await writeFile(doc, await readFile(doc, 'utf8') + '\nSynthetic harness-only replay checkpoint.\n');
  const laterSHA = commit('Synthetic harness-only replay checkpoint');
  // Do not pass ref flags: recorded calculator commits must survive HEAD drift.
  const replayOut = path.join(temporary, String(serial++));
  const child = spawn(process.execPath, ['scripts/experiments/y03-fuzz-ci/run.mjs', '--replay', path.join(changed.out, 'failure.json'),
    '--shrink-attempts', '0', '--out', replayOut], { cwd: source, env, detached: true, stdio: 'ignore' });
  const timer = setTimeout(() => killGroup(child.pid), 110000);
  const [replayCode] = await once(child, 'close'); clearTimeout(timer); killGroup(child.pid);
  assert.equal(replayCode, EXIT.mismatch);
  const later = await json(path.join(replayOut, 'report.json'));
  assert.equal(later.harnessCommit, laterSHA); assert.deepEqual(later.commits, [sha, changedSHA]);
  t.diagnostic(JSON.stringify({ calculatorControlSHA: sha, changedSHA, laterHarnessSHA: laterSHA, artifacts: temporary }));
  // Outer timeout retains its partial public report/log and retires all live
  // group members. Zombies may remain on systems whose PID 1 does not reap.
  for (const signal of ['deadline', 'SIGTERM']) {
    const out = path.join(temporary, 'outer-' + signal);
    const supervisor = spawn(process.execPath, ['scripts/experiments/y03-fuzz-ci/supervise.mjs', '--out', out,
      '--reference-ref', sha, '--candidate-ref', sha, '--outer-ms', signal === 'deadline' ? '1500' : '90000',
      ...(signal === 'SIGTERM' ? ['--fault', 'mismatch'] : [])], { cwd: ROOT, env, stdio: 'ignore' });
    const closed = once(supervisor, 'close');
    if (signal === 'SIGTERM') {
      const until = performance.now() + 40000;
      while (true) {
        try { await access(path.join(out, 'campaign/failure.json')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        assert(performance.now() < until, 'Fault prefix was not checkpointed'); await pause();
      }
      supervisor.kill('SIGTERM');
    }
    const [code] = await closed;
    assert.equal(code, signal === 'deadline' ? 124 : 143);
    const record = await json(path.join(out, 'supervisor.json'));
    assert.equal(record.complete, false);
    assert.equal((await json(path.join(out, 'campaign/report.json'))).complete, false);
    await access(path.join(out, 'campaign.log'));
    if (signal === 'SIGTERM') await access(path.join(out, 'campaign/failure.json'));
    const until = performance.now() + 2000;
    while ((await liveGroup(record.processGroup)).length && performance.now() < until) await pause();
    assert.deepEqual(await liveGroup(record.processGroup), []);
    await assert.rejects(access(path.join(out, 'campaign/owned')), { code: 'ENOENT' });
  }
});
