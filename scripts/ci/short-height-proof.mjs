// Hosted, isolated first-attempt mutations and matched file-wall measurements.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd(), output = path.resolve(process.argv[2] ?? '.local/short-height-proof');
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(path.join(tmpdir(), 'short-height-proof-'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const head = git('rev-parse', 'HEAD'), baseline = '0162f8102300b2e892cd7a66bd2f4d56039a3840';
const worktrees = [];
function checkout(name, sha) {
  const directory = path.join(scratch, name);
  git('worktree', 'add', '--detach', directory, sha);
  worktrees.push(directory);
  return directory;
}
const proof = { head, baseline, node: process.version, platform: process.platform, measurements: [], mutations: [] };
const save = () => writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
function run(directory, name, args) {
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', timeout: 230000,
    maxBuffer: 4 * 1024 * 1024, env: { ...process.env, RS3_DATASET: 'open-f2p' } });
  const wallMs = performance.now() - start;
  writeFileSync(path.join(output, `${name}.log`), result.stdout + result.stderr);
  console.log(JSON.stringify({ name, status: result.status, wallMs }));
  return { status: result.status, wallMs, stdout: result.stdout, stderr: result.stderr };
}
try {
  for (const mutation of ['original-layout', 'clipping', 'tab-stop']) {
    const directory = checkout(mutation, head);
    const file = path.join(directory, mutation === 'tab-stop' ? 'app/web/index.html' : 'app/web/phone-layout.css');
    const original = readFileSync(file, 'utf8');
    if (mutation === 'original-layout') writeFileSync(file, git('show', `${baseline}:app/web/phone-layout.css`) + '\n');
    else if (mutation === 'clipping') writeFileSync(file, original + '\n.phone-layout #phone-roll-host { height:20px; overflow:hidden; }\n');
    else {
      assert.ok(original.includes('id="pick"'), 'Roll button mutation anchor');
      writeFileSync(file, original.replace('id="pick"', 'id="pick" tabindex="-1"'));
    }
    const result = run(directory, mutation, ['scripts/perf/short-height-browser.mjs', '--font', '16', '--height', '240']);
    const expected = mutation === 'original-layout' ? /native scrollport excludes fixed tabs/
      : mutation === 'clipping' ? /"name":"Roll visible"/ : /Roll visible: #pick unreachable/;
    assert.equal(result.status, 1, `${mutation} must fail on its first attempt`);
    assert.match(result.stderr, expected, `${mutation} must fail for the intended obligation`);
    proof.mutations.push({ name: mutation, attempts: 1, caught: true, wallMs: result.wallMs }); save();
    git('worktree', 'remove', '--force', directory); worktrees.splice(worktrees.indexOf(directory), 1);
  }
  const before = checkout('before', baseline), after = checkout('after', head);
  // Alternate order to avoid attributing runner warmup to the replacement.
  let baselineFailed = false;
  for (let pair = 1; pair <= 3; pair++) for (const variant of pair % 2 ? ['before', 'after'] : ['after', 'before']) {
    if (variant === 'before' && baselineFailed) continue;
    const result = run(variant === 'before' ? before : after, `${variant}-${pair}`,
      ['--test', '--test-concurrency=1', 'tests/short-height-browser.test.mjs']);
    proof.measurements.push({ pair, variant, status: result.status, wallMs: result.wallMs }); save();
    // Preserve an old first failure as evidence; never retry it or count it as
    // a successful timing sample. Candidate failures stop the proof immediately.
    if (variant === 'after') assert.equal(result.status, 0, 'replacement first attempt');
    else if (result.status !== 0) baselineFailed = true;
  }
} finally {
  save();
  for (const directory of worktrees) git('worktree', 'remove', '--force', directory);
}
