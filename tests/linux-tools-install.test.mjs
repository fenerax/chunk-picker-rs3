import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Linux root installer exchanges a real directory, verifies, rolls back, and fences failures without writer control',
  { skip: process.platform !== 'linux' ? 'Linux renameat2/root ownership contract' : false, timeout: 120000 }, () => {
    const script = fileURLToPath(new URL('./helpers/tools-install.mjs', import.meta.url));
    const args = process.getuid() === 0 ? [script] : ['-n', '--', process.execPath, script];
    const output = execFileSync(process.getuid() === 0 ? process.execPath : 'sudo', args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 115000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.equal(output.trim(), 'tools-install-ok');
  });
