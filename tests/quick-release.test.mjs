import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { evaluateChecks, treeEntries, verifyExport } from '../scripts/release/pc/quick-build.mjs';

const run = (name, conclusion, id = 1, status = 'completed') => ({ id, name, status, conclusion, app: { slug: 'github-actions' }, completed_at: '2026-10-21T12:00:00Z' });

test('GitHub checks pass only when every required job is green', () => {
  assert.equal(evaluateChecks([run('test', 'success'), run('windows', 'success'), run('secrets', 'success')]).ok, true);
  const missing = evaluateChecks([run('test', 'success'), run('secrets', 'success')]);
  assert.deepEqual([missing.ok, missing.missing], [false, ['windows']]);
  const failing = evaluateChecks([run('test', 'failure'), run('windows', 'success'), run('secrets', 'success')]);
  assert.deepEqual([failing.ok, failing.failing], [false, ['test']]);
  const pending = evaluateChecks([run('test', null, 1, 'in_progress'), run('windows', 'success'), run('secrets', 'success')]);
  assert.deepEqual([pending.ok, pending.pending], [false, ['test']]);
  // A required job may not be skipped; an extra workflow's job may.
  assert.equal(evaluateChecks([run('test', 'skipped'), run('windows', 'success'), run('secrets', 'success')]).ok, false);
  assert.equal(evaluateChecks([run('test', 'success'), run('windows', 'success'), run('secrets', 'success'), run('extra', 'skipped')]).ok, true);
  // Other apps' checks are not ours to judge.
  assert.equal(evaluateChecks([run('test', 'success'), run('windows', 'success'), run('secrets', 'success'), { ...run('lint', 'failure'), app: { slug: 'other' } }]).ok, true);
});

test('a rerun replaces its earlier attempt, in either direction', () => {
  const base = [run('windows', 'success', 5), run('secrets', 'success', 6)];
  assert.equal(evaluateChecks([...base, run('test', 'failure', 1), run('test', 'success', 9)]).ok, true);
  assert.equal(evaluateChecks([...base, run('test', 'success', 1), run('test', 'failure', 9)]).ok, false);
});

test('the exported core must equal its commit exactly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-test-'));
  try {
    const repo = path.join(root, 'repo'), out = path.join(root, 'out');
    await mkdir(path.join(repo, 'app'), { recursive: true });
    await writeFile(path.join(repo, 'app', 'server.mjs'), 'export {};\r\n');
    await writeFile(path.join(repo, 'README.md'), 'hello\n');
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'fixture');
    const entries = treeEntries(repo, 'HEAD');
    assert.deepEqual(entries.map(entry => entry.path).sort(), ['README.md', 'app/server.mjs']);
    await mkdir(path.join(out, 'app'), { recursive: true });
    await writeFile(path.join(out, 'app', 'server.mjs'), 'export {};\r\n');
    await writeFile(path.join(out, 'README.md'), 'hello\n');
    await verifyExport(out, entries);
    await writeFile(path.join(out, 'README.md'), 'hello\r\n');
    await assert.rejects(verifyExport(out, entries), /differs from its commit/);
    await writeFile(path.join(out, 'README.md'), 'hello\n');
    await writeFile(path.join(out, 'extra.txt'), 'x');
    await assert.rejects(verifyExport(out, entries), /differs from its commit/);
    await rm(path.join(out, 'extra.txt'));
    await rm(path.join(out, 'README.md'));
    await assert.rejects(verifyExport(out, entries), /missing files/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
