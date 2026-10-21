import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const token = 'a'.repeat(43);
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const shellAvailable = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0;
const ps = value => `'${value.replaceAll("'", "''")}'`;
const fixtureRoot = fileURLToPath(new URL('../.local/watchdog-script-tests/', import.meta.url));

async function tick(mode) {
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(join(fixtureRoot, 'picker-watchdog-'));
  const scripts = join(root, 'scripts');
  const local = join(root, '.local');
  await mkdir(scripts); await mkdir(local);
  try {
    await copyFile(new URL('../scripts/Watch-Picker.ps1', import.meta.url), join(scripts, 'Watch-Picker.ps1'));
    await writeFile(join(scripts, 'Picker-Process.ps1'), `
$global:fixtureMode = ${ps(mode)}
$global:fixtureCalls = ${ps(join(root, 'calls'))}
$global:fixtureGets = 0
function Read-PickerRuntime {
    if ($fixtureMode -eq 'absent') { return $null }
    if ($fixtureMode -eq 'stop-threw' -and (Test-Path -LiteralPath "$fixtureCalls.stopped")) { return $null }
    return [pscustomobject]@{ pid = 123; processStartedAt = '2026-01-01T00:00:00Z'; startedAt = $(if ($fixtureMode -eq 'starting') { [DateTime]::UtcNow.ToString('o') } else { '2026-01-01T00:00:00Z' }); executable = 'node'; hostAddress = '127.0.0.1'; port = 19888; state = $(if ($fixtureMode -eq 'starting') { 'starting' } else { 'running' }) }
}
function Get-PickerRecordedProcess { param($Record); if ($Record) { return [pscustomobject]@{ ProcessId = 123 } } }
function Test-PickerProcessOwnership { return ($fixtureMode -ne 'alien') }
function Get-PickerAccessToken { return '${token}' }
function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $TimeoutSec, $ContentType, $Body)
    if ($Headers.Authorization -ne 'Bearer ${token}') { throw 'Missing admin credential' }
    if ($Uri -notmatch '^http://127[.]0[.]0[.]1:19888/api/(health|worker-restart)$') { throw 'Unexpected endpoint or listener' }
    if (($Method -eq 'Get' -and $TimeoutSec -ne 10) -or ($Method -eq 'Post' -and $TimeoutSec -ne 30)) { throw 'Unexpected request deadline' }
    Add-Content -LiteralPath $fixtureCalls -Value "$Method $($Uri.Split('/')[-1])"
    if ($Method -eq 'Post') {
        if ($fixtureMode -eq 'pause-during-recovery') {
            Set-Content -LiteralPath (Join-Path $PSScriptRoot '../.local/picker-paused') -Value 'paused'
            throw 'Deliberate stop during recovery'
        }
        if ($fixtureMode -in @('failed', 'uncertain-post')) { throw 'replacement response timed out' }
        return @{ restarted = @('foreground'); worker = @{ status = 'starting' } }
    }
    $global:fixtureGets++
    if ($fixtureMode -in @('down', 'starting', 'stop-failed', 'stop-threw')) { throw 'HTTP unavailable' }
    $stuck = $fixtureMode -eq 'failed' -or ($fixtureMode -in @('recover', 'timeout', 'recovering', 'pause-during-recovery', 'uncertain-post') -and $fixtureGets -eq 1)
    $recovering = $fixtureMode -eq 'timeout' -or ($fixtureMode -eq 'recovering' -and $fixtureGets -eq 2)
    return @{ savesReady = $true; worker = @{ status = $(if ($fixtureMode -eq 'sleeping') { 'sleeping' } else { 'ready' }); stuck = $stuck; restartRequired = ($fixtureMode -eq 'exhausted' -and $fixtureGets -eq 1); recovering = $recovering } }
}
`);
    await writeFile(join(scripts, 'Start-Picker.ps1'), `param($HostAddress, $Port)
if ($HostAddress -ne '127.0.0.1' -or $Port -ne 19888) { throw 'Wrong restart listener' }
Add-Content -LiteralPath $fixtureCalls -Value 'Start'
Remove-Item -LiteralPath (Join-Path $PSScriptRoot '../.local/picker-paused') -ErrorAction SilentlyContinue
Write-Output 'Open http://127.0.0.1/join/private-invite Bearer private-bearer raw ${token}'
`);
    await writeFile(join(scripts, 'Stop-Picker.ps1'), `Add-Content -LiteralPath $fixtureCalls -Value 'Stop'
Set-Content -LiteralPath (Join-Path $PSScriptRoot '../.local/picker-paused') -Value 'paused'
if ($fixtureMode -eq 'stop-failed') { throw 'Stop refused' }
if ($fixtureMode -eq 'stop-threw') { Set-Content -LiteralPath "$fixtureCalls.stopped" -Value 'gone'; throw 'No process is on the other end of the pipe.' }
Write-Output 'Picker stopped; saves drained.'
`);
    if (mode === 'paused') await writeFile(join(local, 'picker-paused'), 'paused');
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(scripts, 'Watch-Picker.ps1'), '-HostAddress', '127.0.0.1', '-Port', '19888', '-WorkerRecoveryTimeoutSeconds', mode === 'recovering' ? '5' : '1', '-HealthRetryDelaySeconds', '0'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const calls = await readFile(join(root, 'calls'), 'utf8').catch(() => '');
    const log = await readFile(join(local, 'watchdog.log'), 'utf8').catch(() => '');
    const paused = await access(join(local, 'picker-paused')).then(() => true, () => false);
    return { calls: calls.trim().split(/\r?\n/).filter(Boolean), log, paused, stdout: result.stdout };
  } finally { assert.equal(dirname(root), fixtureRoot.replace(/[\\/]+$/, '')); await rm(root, { recursive: true, force: true }); }
}

test('watchdog healthy and sleeping ticks stay quiet and never wake workers', { skip: !shellAvailable }, async () => {
  for (const mode of ['healthy', 'sleeping']) {
    const result = await tick(mode);
    assert.deepEqual(result.calls, ['Get health']);
    assert.equal(result.log, ''); assert.equal(result.stdout, '');
  }
});
test('watchdog preserves explicit pause and refuses alien process ownership', { skip: !shellAvailable }, async () => {
  const paused = await tick('paused');
  assert.deepEqual(paused.calls, []); assert.equal(paused.log, ''); assert.equal(paused.paused, true);
  const alien = await tick('alien');
  assert.deepEqual(alien.calls, []); assert.match(alien.log, /no longer belongs/);
  const duringRecovery = await tick('pause-during-recovery');
  assert.deepEqual(duringRecovery.calls, ['Get health', 'Post worker-restart']);
  assert.equal(duringRecovery.paused, true);
});
test('watchdog replaces stuck or exhausted worker before considering server restart', { skip: !shellAvailable }, async () => {
  for (const mode of ['recover', 'exhausted']) {
    const result = await tick(mode);
    assert.deepEqual(result.calls, ['Get health', 'Post worker-restart', 'Get health']);
    assert.match(result.log, /worker recovered/);
  }
  const recovering = await tick('recovering');
  assert.deepEqual(recovering.calls, ['Get health', 'Post worker-restart', 'Get health', 'Get health']);
});
test('watchdog falls back to safe Stop then Start after failed or unverified worker replacement', { skip: !shellAvailable }, async () => {
  for (const mode of ['failed', 'timeout']) {
    const result = await tick(mode);
    assert.deepEqual(result.calls.slice(0, 2), ['Get health', 'Post worker-restart']);
    assert.deepEqual(result.calls.slice(-2), ['Stop', 'Start']);
    assert.equal(result.paused, false);
    assert.doesNotMatch(result.log, /private-invite|private-bearer|a{43}/);
    assert.match(result.log, /\/join\/<token>/); assert.match(result.log, /Bearer <token>/);
  }
});
test('watchdog polls after an uncertain POST timeout and keeps a recovered server running', { skip: !shellAvailable }, async () => {
  const result = await tick('uncertain-post');
  assert.deepEqual(result.calls, ['Get health', 'Post worker-restart', 'Get health']);
  assert.match(result.log, /Checking health before fallback/);
  assert.match(result.log, /worker recovered/);
  assert.equal(result.paused, false);
});
test('watchdog repairs unavailable HTTP even with a live owned PID, allowing initial startup grace', { skip: !shellAvailable }, async () => {
  assert.deepEqual((await tick('down')).calls, ['Get health', 'Get health', 'Get health', 'Stop', 'Start']);
  const refused = await tick('stop-failed');
  assert.deepEqual(refused.calls, ['Get health', 'Get health', 'Get health', 'Stop']); assert.equal(refused.paused, true);
  assert.match(refused.log, /Stop refused/);
  const starting = await tick('starting');
  assert.deepEqual(starting.calls, ['Get health', 'Get health', 'Get health']); assert.equal(starting.log, '');
  const absent = await tick('absent');
  assert.deepEqual(absent.calls, ['Start']);
  assert.doesNotMatch(absent.log, /private-invite|private-bearer|a{43}/);
});
test('watchdog still starts the picker when a finished stop throws while reporting', { skip: !shellAvailable }, async () => {
  const result = await tick('stop-threw');
  assert.deepEqual(result.calls, ['Get health', 'Get health', 'Get health', 'Stop', 'Start']);
  assert.match(result.log, /Stop reported: No process is on the other end of the pipe/);
  assert.equal(result.paused, false);
});
