import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const helper = fileURLToPath(new URL('../scripts/private-companion/Resource-Admission.ps1', import.meta.url));
const windows = process.platform === 'win32';
const quote = value => `'${value.replaceAll("'", "''")}'`;
async function fixture(t, body, free = 20) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-admission-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'fixture.ps1');
  await writeFile(script, `$ErrorActionPreference = 'Stop'\n. ${quote(helper)}\n$context = @{ Root = ${quote(path.join(root, 'admission'))}; HeavyLock = ${quote(path.join(root, 'heavy.lock'))}; LightLock = ${quote(path.join(root, 'light.lock'))}; FreeMemoryGiB = { ${free} } }\n${body}\n`);
  return { root, script };
}
function run(script, ...args) {
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

test('admission budgets leave 3 GiB after every outstanding reservation', { skip: !windows }, async t => {
  const f = await fixture(t, `
$context.FreeMemoryGiB = { 6.99 }
if (New-ResourceReservation heavy $context) { throw 'Heavy admitted below 7 GiB.' }
$context.FreeMemoryGiB = { 7 }
$heavy = New-ResourceReservation heavy $context
if (-not $heavy -or $heavy.gib -ne 4) { throw 'Heavy threshold failed.' }
if (New-ResourceReservation light $context) { throw 'Reservations oversubscribed.' }
$context.FreeMemoryGiB = { 8 }
$light = New-ResourceReservation light $context
if (-not $light -or $light.gib -ne 1) { throw 'Light coexistence threshold failed.' }
Remove-ResourceReservation $context $light
Remove-ResourceReservation $context $heavy
$context.FreeMemoryGiB = { 3.99 }
if (New-ResourceReservation light $context) { throw 'Light admitted below 4 GiB.' }
$context.FreeMemoryGiB = { 4 }
$light = New-ResourceReservation light $context
Remove-ResourceReservation $context $light
if ((Read-ResourceAdmissionState $context).reservations.Count -ne 0) { throw 'Leaked reservation.' }
'ok'`);
  assert.equal(run(f.script), 'ok');
});

test('legacy lane ownership waits, stale ownership fails closed without removal', { skip: !windows }, async t => {
  const f = await fixture(t, `
$null = New-Item -ItemType Directory -Path $context.LightLock
Set-Content -LiteralPath (Join-Path $context.LightLock 'owner') -Value "light pid=$PID fixture"
if (New-ResourceReservation heavy $context) { throw 'Unknown legacy budget ignored.' }
Set-Content -LiteralPath (Join-Path $context.LightLock 'owner') -Value 'light pid=2147483647 fixture'
$refused = $false
try { $null = New-ResourceReservation heavy $context } catch { $refused = $true }
if (-not $refused -or -not (Test-Path -LiteralPath $context.LightLock)) { throw 'Stale legacy lock changed.' }
'ok'`);
  assert.equal(run(f.script), 'ok');
});

test('changed lane owner or process identity prevents cleanup and future admission', { skip: !windows }, async t => {
  const f = await fixture(t, `
$heavy = New-ResourceReservation heavy $context
Set-Content -LiteralPath (Join-Path $context.HeavyLock 'owner') -Value 'changed owner'
$refused = $false
try { Remove-ResourceReservation $context $heavy } catch { $refused = $true }
if (-not $refused -or -not (Test-Path -LiteralPath $context.HeavyLock)) { throw 'Foreign lane removed.' }
Set-Content -LiteralPath (Join-Path $context.HeavyLock 'owner') -Value $heavy.owner
$state = Read-ResourceAdmissionState $context
$state.reservations[0].processStartedAt = '2000-01-01T00:00:00.0000000Z'
Write-ResourceAdmissionState $context $state
$refused = $false
try { $null = New-ResourceReservation light $context } catch { $refused = $true }
if (-not $refused -or -not (Test-Path -LiteralPath $context.HeavyLock)) { throw 'Stale reservation ignored.' }
'ok'`);
  assert.equal(run(f.script), 'ok');
});

test('command failure releases its verified reservation and restores environment', { skip: !windows }, async t => {
  const f = await fixture(t, `
$env:RS3_HEAVY_LOCK_TOKEN = 'prior-value'
$env:RS3_GAME_DATA_DIR = 'prior-data'
$command = ${quote(process.execPath)}
$code = 'const fs=require("node:fs"),p=require("node:path"),e=process.env,m=JSON.parse(fs.readFileSync(p.join(e.RS3_HEAVY_LOCK_PATH,"owner.json"),"utf8").replace(/^\\uFEFF/,""));process.exit(m.token===e.RS3_HEAVY_LOCK_TOKEN&&String(m.pid)===e.RS3_HEAVY_LOCK_PID&&m.token!=="prior-value"?9:8)'
$refused = $false
try { Invoke-ResourceAdmittedCommand heavy $command @('-e', $code) $context } catch {
  if ($_.Exception.Message -ne 'Admitted command failed with exit code 9.') { throw }
  $refused = $true
}
if (-not $refused) { throw 'Command failure was not propagated.' }
if ($env:RS3_HEAVY_LOCK_TOKEN -ne 'prior-value' -or $env:RS3_GAME_DATA_DIR -ne 'prior-data') { throw 'Environment restoration failed.' }
if (Test-Path -LiteralPath $context.HeavyLock) { throw 'Heavy lane leaked.' }
if ((Read-ResourceAdmissionState $context).reservations.Count -ne 0) { throw 'Reservation leaked.' }
'ok'`);
  assert.equal(run(f.script), 'ok');
});

test('exclusive gate and atomic reservation state prevent parallel oversubscription', { skip: !windows }, async t => {
  const f = await fixture(t, `
$lane = $args[0]
$reservation = New-ResourceReservation $lane $context
$result = Join-Path (Split-Path $context.Root) ($lane + '.json')
[IO.File]::WriteAllText($result, ([bool]$reservation | ConvertTo-Json))
if ($reservation) {
  # Keep the admitted process alive until both attempted reservations are visible.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ((-not (Test-Path -LiteralPath (Join-Path (Split-Path $context.Root) 'heavy.json')) -or -not (Test-Path -LiteralPath (Join-Path (Split-Path $context.Root) 'light.json'))) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }
  Remove-ResourceReservation $context $reservation
}`, 7);
  const start = lane => new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', f.script, lane], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([start('heavy'), start('light')]);
  const outcomes = await Promise.all(['heavy', 'light'].map(async lane => JSON.parse(await readFile(path.join(f.root, `${lane}.json`), 'utf8'))));
  assert.equal(outcomes.filter(Boolean).length, 1);
  const state = JSON.parse(await readFile(path.join(f.root, 'admission/state.json'), 'utf8'));
  assert.deepEqual(state.reservations, []);
});

test('public wrappers retain flag forwarding and expose no fixture overrides', async () => {
  const heavy = await readFile(new URL('../scripts/private-companion/with-heavy.ps1', import.meta.url), 'utf8');
  const light = await readFile(new URL('../scripts/private-companion/with-light.ps1', import.meta.url), 'utf8');
  for (const source of [heavy, light]) {
    assert.match(source, /\$args\[0\]/);
    assert.match(source, /Select-Object -Skip 1/);
    assert.doesNotMatch(source, /\bparam\s*\(|-Context|RS3_ADMISSION_/i);
  }
});
