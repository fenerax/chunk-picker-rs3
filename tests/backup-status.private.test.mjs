import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readBackupStatus } from '../app/storage/backup-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const now = Date.parse('2026-10-11T12:00:00Z');
const success = { lastRunAt: '2026-10-11T10:00:00.000Z', result: 'success', byteSize: 125,
  lastSuccessAt: '2026-10-11T10:00:00.000Z' };

async function fixture(t) {
  await mkdir(local, { recursive: true });
  const dir = await mkdtemp(path.join(local, 'backup-test-'));
  const dataDir = path.join(dir, '.local', 'duo');
  await mkdir(dataDir, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(dir), local);
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, dataDir, metadata: path.dirname(dataDir),
    async write(name, value) { await writeFile(path.join(path.dirname(dataDir), name), typeof value === 'string' ? value : JSON.stringify(value)); } };
}

test('PowerShell backup records success, preserves it after redacted failure and cleans local staging', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const scripts = path.join(f.dir, 'scripts');
  const destination = path.join(f.metadata, 'destination');
  await mkdir(scripts);
  await mkdir(destination);
  await writeFile(path.join(destination, 'rs3-chunk-picker-2000-01-01.zip'), 'old backup');
  await writeFile(path.join(destination, 'rs3-chunk-picker-2000-01-02.zip'), 'old backup');
  await writeFile(path.join(destination, 'rs3-chunk-picker-custom.zip'), 'unrelated');
  await mkdir(path.join(destination, 'rs3-chunk-picker-2000-01-03.zip'));
  await copyFile(path.join(root, 'scripts', 'Backup-Picker.ps1'), path.join(scripts, 'Backup-Picker.ps1'));
  await f.write('backup-destination', destination);
  await f.write('server-runtime.json', { hostAddress: '127.0.0.1', port: 12345 });
  await writeFile(path.join(f.dataDir, 'access-token'), 'synthetic-secret');
  await writeFile(path.join(f.dataDir, 'feedback.json'), '{"messages":[]}');
  const runner = path.join(scripts, 'fixture.ps1');
  await writeFile(runner, `param([switch]$Fail)\nfunction Invoke-WebRequest { param($Uri, $Headers, $OutFile, $TimeoutSec)\nif ($Fail) { throw 'failed synthetic-secret Bearer other-secret ?token=query-secret' }\nSet-Content -LiteralPath $OutFile -Value '{"format":"rs3-chunk-picker","state":{"members":{"a":{},"b":{}},"revision":42}}'\n}\n& "$PSScriptRoot/Backup-Picker.ps1" -Keep 1\n$archive = Get-ChildItem -LiteralPath "$PSScriptRoot/../.local/destination" -File | Where-Object Name -Match '^rs3-chunk-picker-\\d{4}-\\d{2}-\\d{2}\\.zip$' | Select-Object -First 1\n$zip = [IO.Compression.ZipFile]::OpenRead($archive.FullName)\ntry { ConvertTo-Json -InputObject @($zip.Entries.FullName) | Set-Content -LiteralPath "$PSScriptRoot/../.local/archive-manifest.json" } finally { $zip.Dispose() }\n`);
  const run = (...args) => spawnSync('pwsh', ['-NoProfile', '-File', runner, ...args], { encoding: 'utf8', timeout: 30000 });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  const status = JSON.parse(await readFile(path.join(f.metadata, 'backup-status.json'), 'utf8'));
  assert.equal(status.result, 'success');
  assert.equal(status.revision, 42);
  assert.ok(status.byteSize > 0);
  assert.equal(status.lastRunAt, status.lastSuccessAt);
  assert.match(status.fileName, /^rs3-chunk-picker-\d{4}-\d\d-\d\d\.zip$/);
  assert.deepEqual((await readdir(destination)).sort(), [
    'rs3-chunk-picker-2000-01-03.zip', 'rs3-chunk-picker-custom.zip', status.fileName].sort());
  const manifest = JSON.parse(await readFile(path.join(f.metadata, 'archive-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.sort(), [status.fileName.replace('.zip', '.json'), status.fileName.replace('.zip', '-feedback.json')].sort());
  const failed = run('-Fail');
  assert.notEqual(failed.status, 0);
  const after = JSON.parse(await readFile(path.join(f.metadata, 'backup-status.json'), 'utf8'));
  assert.equal(after.result, 'failed');
  assert.equal(Date.parse(after.lastSuccessAt), Date.parse(status.lastSuccessAt));
  const log = await readFile(path.join(f.metadata, 'backup.log'), 'utf8');
  assert.ok(!/synthetic-secret|other-secret|query-secret/.test(log + failed.stderr));
  assert.ok(!/backup-run-|backup-status-.*\.tmp/.test((await readdir(f.metadata)).join('\n')));
  await rm(path.join(f.metadata, 'backup-destination'));
  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.equal(JSON.parse(await readFile(path.join(f.metadata, 'backup-status.json'), 'utf8')).result, 'failed');
});
