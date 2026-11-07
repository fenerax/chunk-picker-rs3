// Hosted acceptance evidence; mutations exist only in disposable worktrees.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

assert.equal(process.platform, 'linux', 'Run mutation/timing proof on hosted Linux, never the shared PC');
const root = process.cwd(), output = path.resolve(process.argv[2] ?? '.local/backup-file-proof');
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(path.join(tmpdir(), 'backup-file-proof-'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const head = git('rev-parse', 'HEAD'), baseline = '055332ff0951b7a38011243043ae2f5558827ee2';
const entry = 'tests/backup-file-browser.test.mjs';
const proof = { head, baseline, node: process.version, platform: process.platform,
  inputBlobs: Object.fromEntries(['app/open-starter.mjs', 'app/open-starter-data.mjs'].map(file => [file, git('rev-parse', `${head}:${file}`)])),
  baselineSha256: createHash('sha256').update(git('show', `${baseline}:${entry}`)).digest('hex'),
  measurements: [], mutations: [] };
const save = () => writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
const worktrees = new Set();
function checkout(name, sha) {
  const directory = path.join(scratch, name);
  git('worktree', 'add', '--detach', directory, sha); worktrees.add(directory);
  return directory;
}
function remove(directory) { git('worktree', 'remove', '--force', directory); worktrees.delete(directory); }
function run(directory, name, mode) {
  const started = performance.now();
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec',
    ...(mode ? [`--test-name-pattern=\\(${mode}\\)$`] : []), entry], {
    cwd: directory, encoding: 'utf8', timeout: 195000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, RS3_DATASET: 'open-starter', RS3_TEST_RETRY_ONCE_IN_ISOLATION: '0', NODE_DISABLE_COMPILE_CACHE: '1' },
  });
  const wallMs = performance.now() - started, log = result.stdout + result.stderr;
  writeFileSync(path.join(output, `${name}.log`), log);
  console.log(JSON.stringify({ name, status: result.status, wallMs }));
  return { status: result.status, wallMs, log };
}
function replace(directory, relative, before, after) {
  const file = path.join(directory, relative), text = readFileSync(file, 'utf8');
  assert.equal(text.split(before).length, 2, `Unique mutation anchor: ${relative}`);
  writeFileSync(file, text.replace(before, after));
}
try {
  for (const name of ['space', 'bytes', 'preview-write', 'restored-focus']) {
    const directory = checkout(name, head);
    if (name === 'space') replace(directory, 'app/web/screen-dialogs.mjs',
      "const choose = c.button('Choose file…', () => file.click());",
      "const choose = c.button('Choose file…', () => file.click()); choose.addEventListener('keydown', event => { if (event.code === 'Space') event.preventDefault(); });");
    if (name === 'bytes') replace(directory, 'app/web/backup-transfer.mjs',
      'URL.createObjectURL(await response.blob())',
      `URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...gzipSync(JSON.stringify({ format: 'rs3-chunk-picker', state: { revision: -1 } }))])})]))`);
    if (name === 'preview-write') replace(directory, 'app/web/screen-dialogs.mjs',
      'const value = await c.api(`${path}/preview`, payload, controller.signal);',
      "const value = await c.api(`${path}/preview`, payload, controller.signal); await c.command({ type: 'set-preference', memberId: c.memberId, preferenceId: 'hideChecked', value: true });");
    if (name === 'restored-focus') replace(directory, 'app/web/screen-dialogs.mjs',
      'target?.focus({ preventScroll: true });', "c.$('map-hover')?.focus({ preventScroll: true });");
    const result = run(directory, name, name === 'space' ? 'Space' : 'Enter');
    const expected = name === 'space' ? /Missing event: Page.fileChooserOpened/
      : name === 'bytes' ? /Downloaded backup contains the exact saved state/
      : name === 'preview-write' ? /valid: preview must not change revision/
      : /Escape restores focus to the launcher or its visible summary/;
    proof.mutations.push({ name, attempts: 1, status: result.status, caught: result.status === 1 && expected.test(result.log), wallMs: result.wallMs }); save();
    assert.equal(result.status, 1, `${name}: first attempt must fail`);
    assert.match(result.log, expected, `${name}: intended obligation must catch the mutation`);
    remove(directory);
  }
  // Identical product/runtime/inputs and disabled bytecode cache, alternating
  // order. Retain any baseline first failure; never retry it for a timing win.
  const before = checkout('before', head), after = checkout('after', head);
  writeFileSync(path.join(before, entry), git('show', `${baseline}:${entry}`) + '\n');
  let baselineFailed = false;
  for (const pair of [1, 2, 3]) for (const variant of pair % 2 ? ['before', 'after'] : ['after', 'before']) {
    if (variant === 'before' && baselineFailed) continue;
    const result = run(variant === 'before' ? before : after, `${variant}-${pair}`);
    proof.measurements.push({ pair, variant, status: result.status, wallMs: result.wallMs }); save();
    if (variant === 'after') {
      assert.equal(result.status, 0, 'Rebuilt file must pass its first attempt');
    } else if (result.status !== 0) baselineFailed = true;
    if (result.status === 0) { assert.match(result.log, /pass 3/); assert.match(result.log, /skipped 0/); }
  }
} finally { save(); for (const directory of worktrees) remove(directory); }
