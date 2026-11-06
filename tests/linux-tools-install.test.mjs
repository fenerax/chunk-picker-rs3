import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Linux root installer upgrades and rolls back the exact #128 package, recovering cross-contract process kills',
  { skip: process.platform !== 'linux' ? 'Linux package contract/root ownership' : false, timeout: 300000 }, () => {
    const script = fileURLToPath(new URL('./helpers/tools-install-contracts.mjs', import.meta.url));
    const args = process.getuid() === 0 ? [script] : ['-n', '--', process.execPath, script];
    const output = execFileSync(process.getuid() === 0 ? process.execPath : 'sudo', args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 295000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.equal(output.trim(), 'tools-contracts-ok');
  });

test('Linux root installer exchanges a real directory, verifies, rolls back, and fences failures without writer control',
  { skip: process.platform !== 'linux' ? 'Linux renameat2/root ownership contract' : false, timeout: 300000 }, () => {
    const script = fileURLToPath(new URL('./helpers/tools-install.mjs', import.meta.url));
    const args = process.getuid() === 0 ? [script] : ['-n', '--', process.execPath, script];
    const output = execFileSync(process.getuid() === 0 ? process.execPath : 'sudo', args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 295000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.equal(output.trim(), 'tools-install-ok');
  });

test('Linux root installer retries and recovers real process kills outside the journal, retaining live locks',
  { skip: process.platform !== 'linux' ? 'Linux process identity/root ownership contract' : false, timeout: 300000 }, () => {
    const script = fileURLToPath(new URL('./helpers/tools-install-crashes.mjs', import.meta.url));
    const args = process.getuid() === 0 ? [script] : ['-n', '--', process.execPath, script];
    const output = execFileSync(process.getuid() === 0 ? process.execPath : 'sudo', args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 295000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.equal(output.trim(), 'tools-crashes-ok');
  });
