import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function fixture(t, configuration) {
  const base = path.join(root, '.local', 'helper-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'helper with spaces-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  await mkdir(path.join(directory, 'app'));
  await mkdir(path.join(directory, 'scripts'));
  for (const name of ['Start-Picker.ps1', 'Stop-Picker.ps1', 'Picker-Process.ps1']) {
    await copyFile(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  }
  await copyFile(path.join(root, 'tests', 'fixtures', 'picker-helper-server.mjs'), path.join(directory, 'app', 'server.mjs'));
  await writeFile(path.join(directory, 'helper-test-config.json'), JSON.stringify(configuration));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return { directory, port };
}

export function pickerOperationTest(mode, description, configuration) {
  test(`Windows helpers ${description}`, { skip: process.platform !== 'win32', timeout: 180000 }, async t => {
    const { directory, port } = await fixture(t, configuration);
    let result;
    try {
      result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(root, 'tests', 'picker-helpers.test.ps1'), '-FixtureRoot', directory, '-Mode', mode, '-Port', String(port)],
      { cwd: root, timeout: 170000, windowsHide: true });
    } catch (error) {
      assert.fail(`PowerShell regression failed: ${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
    assert.match(result.stdout, new RegExp(`PASS ${mode}`));
  });
}
