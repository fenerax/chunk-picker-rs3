import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Copied-save modes started the server on a private copy, which can copy or
// create credentials. They must stop before touching the supplied directory.
const root = fileURLToPath(new URL('..', import.meta.url));
for (const [script, flag] of [['starting-bank-pools.mjs', '--data-dir'], ['roll-pool-equivalence.mjs', '--store']]) {
  test(`${script} ${flag} stops with PRIVATE_DISABLED before reading the save`, async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'perf-guard-'));
    try {
      const save = path.join(scratch, 'game'), out = path.join(scratch, 'out.json');
      await mkdir(save);
      await writeFile(path.join(save, 'state.json'), JSON.stringify({ schemaVersion: 1, members: [{ id: 'a', name: 'Player x' }] }));
      const run = spawnSync(process.execPath, [path.join(root, 'scripts/perf', script), flag, save, '--out', out],
        { cwd: root, encoding: 'utf8', timeout: 60_000 });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /Private mode is disabled/);
      assert.equal(existsSync(out), false);
      assert.deepEqual(await readdir(save), ['state.json'], 'the supplied save directory is untouched');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
}
