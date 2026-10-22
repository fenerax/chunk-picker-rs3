import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const available = process.platform === 'win32' && spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;
const pwshAvailable = process.platform === 'win32' && spawnSync('pwsh.exe', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const root = fileURLToPath(new URL('../.local/watchdog-core-tests/', import.meta.url));
const ps = value => `'${value.replaceAll("'", "''")}'`;
async function fixture(run) {
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'case-'));
  try { return await run(dir); }
  finally { assert.equal(dirname(dir), root.replace(/[\\/]+$/, '')); await rm(dir, { recursive: true, force: true }); }
}
async function execute(dir, body, expected = 0, hostShell = shell) {
  const file = join(dir, 'check.ps1');
  await writeFile(file, `$ErrorActionPreference = 'Stop'\n. ${ps(join(scripts, 'Operator-Common.ps1'))}\n. ${ps(join(scripts, 'Task-Common.ps1'))}\n. ${ps(join(scripts, 'Watchdog-Common.ps1'))}\nfunction Get-FixtureHash([string]$Path) { $sha = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() } }\n${body}\n`);
  const result = spawnSync(hostShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', timeout: 25000 });
  assert.equal(result.status, expected, result.stderr || String(result.error));
  return result;
}

async function tick(mode) {
  return fixture(async dir => {
    const config = join(dir, 'candidate.json');
    const runtime = join(dir, 'server-runtime.json');
    const calls = join(dir, 'calls');
    await writeFile(config, '{}');
    if (mode !== 'absent') await writeFile(runtime, JSON.stringify({ pid: 123, processStartedAt: mode === 'starting' ? new Date().toISOString() : '2026-01-01T00:00:00Z', configHash: 'test', state: mode === 'stopping' ? 'stopping' : mode === 'unknown' ? 'unknown' : mode === 'starting' ? 'starting' : 'running' }));
    if (mode === 'paused') await writeFile(join(dir, 'picker-paused'), 'paused');
    await execute(dir, `
$global:mode = ${ps(mode)}
$global:calls = ${ps(calls)}
$global:gets = 0
$global:context = [pscustomobject]@{ localDir = ${ps(dir)}; runtimeFile = ${ps(runtime)}; configHash = 'test'; config = [pscustomobject]@{ host = $(if ($global:mode -eq 'tailscale-wait') { '100.100.100.100' } else { '127.0.0.1' }); port = 19888; loopbackPort = 19889 } }
function Read-OperatorConfig { return $global:context }
function Get-OperatorOwnedProcess { param($Context, $Record); if ($global:mode -eq 'foreign-process') { throw 'private-secret-error' }; return [pscustomobject]@{ ProcessId = 123 } }
function Get-NetTCPConnection { param($State, $LocalPort, $ErrorAction); return [pscustomobject]@{ LocalAddress = '127.0.0.1'; OwningProcess = $(if ($global:mode -eq 'foreign-listener') { 456 } else { 123 }) } }
function Get-NetIPAddress { return @() }
function Assert-OperatorStoreReleased { }
function Get-OperatorToken { Add-Content -LiteralPath $global:calls -Value 'Token'; return ('a' * 43) }
function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $TimeoutSec, $ContentType, $Body)
    if ($Uri -like '*/worker-restart') {
        Add-Content -LiteralPath $global:calls -Value 'WorkerRestart'
        if ($global:mode -eq 'pause-recovery') { Set-Content -LiteralPath (Join-Path $global:context.localDir 'picker-paused') -Value 'paused'; throw 'private-secret-error' }
        return @{}
    }
    Add-Content -LiteralPath $global:calls -Value 'Health'
    $global:gets++
    if ($global:mode -in @('unavailable', 'starting')) { throw 'private-secret-error' }
    return [pscustomobject]@{ worker = [pscustomobject]@{ stuck = ($global:mode -eq 'failed' -or ($global:mode -in @('recover', 'pause-recovery') -and $global:gets -eq 1)); restartRequired = $false; recovering = $false; status = $(if ($global:mode -eq 'sleeping') { 'sleeping' } else { 'ready' }) } }
}
function Invoke-CoreWatchHelper {
    param($Context, $Operation, $Config, $ConfigSha256)
    Add-Content -LiteralPath $global:calls -Value $Operation
    if ($Operation -eq 'Stop') { Remove-Item -LiteralPath $Context.runtimeFile }
}
function Assert-CoreWatchUnoccupied { }
Invoke-CoreWatchTick -Config ${ps(config)} -ConfigSha256 (Get-FixtureHash ${ps(config)}) -HealthRetryDelaySeconds 0 -WorkerRecoveryTimeoutSeconds 1
`);
    return {
      calls: (await readFile(calls, 'utf8').catch(() => '')).trim().split(/\r?\n/).filter(Boolean),
      log: await readFile(join(dir, 'watchdog.log'), 'utf8').catch(() => ''),
      paused: await readFile(join(dir, 'picker-paused'), 'utf8').then(() => true, () => false),
    };
  });
}

test('core watchdog healthy and sleeping checks never wake task workers', { skip: !available }, async () => {
  for (const mode of ['healthy', 'sleeping']) {
    const result = await tick(mode);
    assert.deepEqual(result.calls, ['Token', 'Health']); assert.equal(result.log, '');
  }
});
test('core watchdog pause and absent runtime preserve intended actions', { skip: !available }, async () => {
  const paused = await tick('paused');
  assert.deepEqual(paused.calls, []); assert.equal(paused.paused, true);
  assert.deepEqual((await tick('absent')).calls, ['Start']);
  const during = await tick('pause-recovery');
  assert.deepEqual(during.calls, ['Token', 'Health', 'Token', 'WorkerRestart']); assert.equal(during.paused, true);
});
test('core watchdog recovers worker first and safely restarts failed health or worker', { skip: !available }, async () => {
  const recovered = await tick('recover');
  assert.deepEqual(recovered.calls, ['Token', 'Health', 'Token', 'WorkerRestart', 'Token', 'Health']);
  assert.match(recovered.log, /worker recovered/i);
  for (const mode of ['failed', 'unavailable']) {
    const failed = await tick(mode);
    assert.deepEqual(failed.calls.slice(-2), ['Stop', 'Start']); assert.equal(failed.paused, false);
    assert.doesNotMatch(failed.log, /private-secret-error|a{43}|Bearer|http:/);
  }
});
test('core watchdog refuses foreign processes/listeners and stopping or unknown records before credentials', { skip: !available }, async () => {
  for (const mode of ['foreign-process', 'foreign-listener', 'stopping', 'unknown']) {
    const result = await tick(mode);
    assert.deepEqual(result.calls, []); assert.match(result.log, /refused recovery/);
    assert.doesNotMatch(result.log, /private-secret-error|a{43}/);
  }
});
test('core watchdog retains initial startup grace and waits for pinned Tailscale address', { skip: !available }, async () => {
  const starting = await tick('starting');
  assert.deepEqual(starting.calls, ['Token', 'Health', 'Token', 'Health', 'Token', 'Health']); assert.equal(starting.log, '');
  const waiting = await tick('tailscale-wait');
  assert.deepEqual(waiting.calls, []); assert.match(waiting.log, /Waiting for the pinned private listener address/);
});
test('managed Stop PreservePause retains marker presence and absence', { skip: !available }, async () => {
  await fixture(async dir => {
    await execute(dir, `
$context = [pscustomobject]@{ localDir = ${ps(dir)}; runtimeFile = ${ps(join(dir, 'server-runtime.json'))} }
function Enter-OperatorLock { return [IO.MemoryStream]::new() }
function Get-OperatorOwnedProcess { return $null }
function Assert-OperatorStoreReleased { }
foreach ($paused in @($false, $true)) {
    if ($paused) { Set-Content -LiteralPath (Join-Path $context.localDir 'picker-paused') -Value 'retained' }
    Set-Content -LiteralPath $context.runtimeFile -Value '{}'
    Stop-OperatorCore $context 1 -PreservePause
    if ((Test-Path -LiteralPath (Join-Path $context.localDir 'picker-paused')) -ne $paused) { throw 'Pause state changed' }
}
Remove-Item -LiteralPath (Join-Path $context.localDir 'picker-paused')
Stop-OperatorCore $context 1
if (-not (Test-Path -LiteralPath (Join-Path $context.localDir 'picker-paused'))) { throw 'Deliberate stop did not pause the absent writer' }
`);
    assert.match(await readFile(join(scripts, 'Start-Core.ps1'), 'utf8'), /-PreservePause:\$PreservePause/);
    assert.match(await readFile(join(scripts, 'Operator-Common.ps1'), 'utf8'), /if \(-not \$PreservePause\) \{ Remove-Item/);
  });
});
test('managed Stop waits out a draining writer whose listeners close mid-round', { skip: !available }, async () => {
  await fixture(async dir => {
    await execute(dir, `
$context = [pscustomobject]@{ localDir = ${ps(dir)}; runtimeFile = ${ps(join(dir, 'server-runtime.json'))}; config = [pscustomobject]@{ host = '127.0.0.1'; port = 19888 } }
Set-Content -LiteralPath $context.runtimeFile -Value '{"state":"running"}'
function Enter-OperatorLock { return [IO.MemoryStream]::new() }
function Write-OperatorRuntime { }
function Assert-OperatorStoreReleased { }
function Get-OperatorToken { return ('a' * 43) }
# Round one posts the shutdown; in round two the writer closes its listeners between the checks.
$global:owned = 4; $global:listeners = @($true, $true, $true, $false); $global:checks = 0; $global:posts = 0
function Get-OperatorOwnedProcess { if ($global:owned-- -gt 0) { return [pscustomobject]@{ ProcessId = 123 } }; return $null }
function Test-OperatorListeners { $index = $global:checks++; return ($index -lt $global:listeners.Length -and $global:listeners[$index]) }
function Invoke-RestMethod { $global:posts++; return @{} }
$output = Stop-OperatorCore $context 5 -PreservePause
if ($global:posts -ne 1) { throw "Expected one shutdown post, saw $global:posts" }
if (Test-Path -LiteralPath $context.runtimeFile) { throw 'Runtime record retained' }
if ("$output" -notmatch 'Verified writer stopped') { throw "Unexpected output: $output" }
`);
  });
});

// Boot is pinned at 2026-06-01; "before" times predate it, "after" times follow it.
const bootStub = writer => `
function Get-CimInstance {
    param([Parameter(Position = 0)]$ClassName, $Filter)
    if ($ClassName -eq 'Win32_OperatingSystem') { return [pscustomobject]@{ LastBootUpTime = [DateTimeOffset]::Parse('2026-06-01T00:00:00Z').LocalDateTime } }
    if ($Filter -like '*node.exe*') { return @(${writer ? "[pscustomobject]@{ CommandLine = 'node app/server.mjs --data-dir \"' + $global:dataDir + '\"' }" : ''}) }
    return [pscustomobject]@{ ExecutablePath = 'C:\\other.exe'; CommandLine = 'reused'; CreationDate = [DateTime]::Now }
}`;
test('watchdog moves aside only a complete local storage lock from before the last boot', { skip: !available }, async () => {
  const before = '2026-05-01T00:00:00.000Z', after = '2026-07-01T00:00:00.000Z';
  const lock = (fields = {}) => JSON.stringify({ pid: 4242, startedAt: before, startVerified: true, host: '__HOST__', nonce: 'n', createdAt: before, ...fields });
  const cases = [
    ['pre-boot', lock(), true],
    ['started after boot', lock({ startedAt: after, createdAt: after }), false],
    ['created after boot', lock({ createdAt: after }), false],
    ['foreign host', lock({ host: 'another-computer' }), false],
    ['unverified start', lock({ startVerified: false }), false],
    ['no zone', lock({ startedAt: '2026-05-01T00:00:00', createdAt: '2026-05-01T00:00:00' }), false],
    ['missing host', JSON.stringify({ pid: 4242, startedAt: before, startVerified: true, createdAt: before }), false],
    ['unreadable', '{not json', false],
    ['recovery marker', lock(), false, { recovery: true }],
    ['live writer', lock(), false, { writer: true }],
  ];
  for (const [name, contents, moved, { recovery = false, writer = false } = {}] of cases) {
    await fixture(async dir => {
      const data = join(dir, 'data'); await mkdir(data);
      const result = await execute(dir, `
$global:dataDir = ${ps(data)}
$context = [pscustomobject]@{ localDir = ${ps(dir)}; config = [pscustomobject]@{ dataDir = $global:dataDir; port = 19888; loopbackPort = 19889 } }
${bootStub(writer)}
function Get-NetTCPConnection { return @() }
[IO.File]::WriteAllText((Join-Path $global:dataDir 'store.lock'), ${ps(contents)}.Replace('__HOST__', [Net.Dns]::GetHostName()))
if (${recovery ? '$true' : '$false'}) { Set-Content -LiteralPath (Join-Path $global:dataDir 'store.lock.recovery') -Value '{}' }
try { Assert-CoreWatchUnoccupied $context; 'started' } catch { 'refused' }
@(Get-ChildItem -LiteralPath $global:dataDir -Name) -join ','
`);
      const [outcome, files] = result.stdout.trim().split(/\r?\n/);
      const log = await readFile(join(dir, 'watchdog.log'), 'utf8').catch(() => '');
      if (moved) {
        assert.equal(outcome, 'started', name);
        assert.match(files, /^store\.lock\.restart-\d{8}T\d{6}Z$/, name);
        assert.match(log, /Moved a storage lock left from before the last restart/, name);
      } else {
        assert.equal(outcome, 'refused', name);
        assert.match(files, /(^|,)store\.lock(,|$)/, name);
        assert.doesNotMatch(files, /restart-/, name);
        assert.equal(log, '', name);
      }
    });
  }
});
test('a runtime record from before the last boot no longer owns its reused PID', { skip: !available }, async () => {
  await fixture(async dir => {
    const result = await execute(dir, `
$context = [pscustomobject]@{ configHash = 'h'; config = [pscustomobject]@{ coreRoot = 'C:\\core'; dataDir = 'C:\\data'; host = '127.0.0.1'; port = 19888; nodePath = 'C:\\node.exe' } }
${bootStub(false)}
$old = Get-OperatorOwnedProcess $context ([pscustomobject]@{ pid = 4242; processStartedAt = '2026-05-01T00:00:00.0000000Z'; configHash = 'h' })
"old:$($null -eq $old)"
try { $null = Get-OperatorOwnedProcess $context ([pscustomobject]@{ pid = 4242; processStartedAt = '2026-07-01T00:00:00.0000000Z'; configHash = 'h' }); 'new:accepted' } catch { 'new:refused' }
try { $null = Get-OperatorOwnedProcess $context ([pscustomobject]@{ pid = 4242; processStartedAt = '2026-05-01T00:00:00'; configHash = 'h' }); 'nozone:accepted' } catch { 'nozone:refused' }
`);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['old:True', 'new:refused', 'nozone:refused']);
  });
});

const taskXml = (name, backup = false) => `<?xml version="1.0" encoding="utf-8"?>\n<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n <RegistrationInfo><URI>\\${name}</URI></RegistrationInfo>\n <Principals><Principal id="Author"><UserId>synthetic-user</UserId><LogonType>InteractiveToken</LogonType></Principal></Principals>\n <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT3M</ExecutionTimeLimit></Settings>\n <Triggers><TimeTrigger><StartBoundary>2026-10-15T01:00:00</StartBoundary><Repetition><Interval>PT${backup ? '60' : '5'}M</Interval></Repetition></TimeTrigger></Triggers>\n <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>--headless powershell.exe -NoProfile -File C:\\synthetic\\${backup ? 'Backup' : 'Watch'}-Picker.ps1</Arguments><WorkingDirectory>C:\\synthetic</WorkingDirectory></Exec></Actions>\n</Task>\n`;
async function tasks(run) {
  return fixture(async dir => {
    const mock = join(dir, 'rehearsal'); await mkdir(mock);
    const watchdog = join(dir, 'watchdog.xml'), backup = join(dir, 'backup.xml');
    await writeFile(watchdog, taskXml('M7 rehearsal watchdog'));
    await writeFile(backup, taskXml('M7 rehearsal backup', true));
    await writeFile(join(mock, 'M7 rehearsal watchdog.xml'), await readFile(watchdog));
    await writeFile(join(mock, 'M7 rehearsal backup.xml'), await readFile(backup));
    const config = join(dir, 'candidate.json'); await writeFile(config, '{}');
    const watchScript = join(dir, 'Watch-Core.ps1'); await writeFile(watchScript, await readFile(join(scripts, 'Watch-Core.ps1')));
    return run({ dir, mock, watchdog, backup, config, watchScript, setup: `
function New-Pin([string]$Path) { return @{ path = $Path; sha256 = Get-FixtureHash $Path } }
$planPath = ${ps(join(dir, 'plan.json'))}
$planValue = @{ schemaVersion = 1; watchdog = @{ name = 'M7 rehearsal watchdog'; taskPath = '\\'; xml = New-Pin ${ps(watchdog)} }; backup = @{ name = 'M7 rehearsal backup'; taskPath = '\\'; xml = New-Pin ${ps(backup)} }; config = New-Pin ${ps(config)}; watchScript = New-Pin ${ps(watchScript)}; pwshPath = (Get-Command powershell.exe).Source; workingDirectory = ${ps(dir)}; mockDirectory = ${ps(mock)} }
[IO.File]::WriteAllText($planPath, ($planValue | ConvertTo-Json -Depth 8))
$plan = Read-CoreTaskPlan $planPath
` });
  });
}
test('task dry run reports exact current/desired actions and triggers without mutation', { skip: !available }, async () => {
  await tasks(async ({ dir, mock, watchdog, backup, setup }) => {
    const result = await execute(dir, setup + '\nInvoke-CoreTaskRegistration $plan -DryRun');
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.tasks.length, 2);
    assert.deepEqual(plan.tasks.map(t => t.name), ['M7 rehearsal watchdog', 'M7 rehearsal backup']);
    assert.match(plan.tasks[0].desired.actions, /Watch-Core.ps1/);
    assert.match(plan.tasks[0].desired.actions, /-ConfigSha256 [a-f0-9]{64}/);
    assert.equal(plan.tasks[0].current.triggers, plan.tasks[0].desired.triggers);
    assert.equal(plan.tasks[1].current.actions, plan.tasks[1].desired.actions);
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal watchdog.xml')), await readFile(watchdog));
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal backup.xml')), await readFile(backup));
  });
});
test('mock task registration and restoration preserve non-action subtrees and exact originals', { skip: !available }, async () => {
  await tasks(async ({ dir, mock, watchdog, backup, setup }) => {
    await execute(dir, setup + `
$targets = @(Get-CoreTaskTargets $plan)
$original = Read-CoreTaskXml $targets[0].originalXml
$desired = Read-CoreTaskXml $targets[0].desiredXml
foreach ($name in 'Principals', 'Settings', 'Triggers') {
    $selector = '/*[local-name()="Task"]/*[local-name()="' + $name + '"]'
    if ($original.SelectSingleNode($selector).OuterXml -cne $desired.SelectSingleNode($selector).OuterXml) { throw 'Task subtree changed' }
}
Invoke-CoreTaskRegistration $plan
Invoke-CoreTaskRegistration $plan
Invoke-CoreTaskRestoration $plan
`);
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal watchdog.xml')), await readFile(watchdog));
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal backup.xml')), await readFile(backup));
  });
});
test('task drift refuses every write and partial registration restores both originals', { skip: !available }, async () => {
  await tasks(async ({ dir, mock, watchdog, backup, setup }) => {
    await execute(dir, setup + `
$script:originalSet = \${function:Set-CoreTaskXml}
$script:failOnce = $true
function Set-CoreTaskXml { param($Plan, $Target, $Xml, [switch]$Original)
    & $script:originalSet $Plan $Target $Xml -Original:$Original
    if (-not $Original -and $script:failOnce) { $script:failOnce = $false; throw 'Injected partial failure' }
}
$refused = $false
try { Invoke-CoreTaskRegistration $plan } catch { $refused = $true }
if (-not $refused) { throw 'Partial failure accepted' }
`);
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal watchdog.xml')), await readFile(watchdog));
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal backup.xml')), await readFile(backup));
    const driftPath = join(mock, 'M7 rehearsal backup.xml');
    await writeFile(driftPath, taskXml('M7 rehearsal backup', true).replace('PT60M', 'PT61M'));
    const before = await Promise.all(['M7 rehearsal watchdog.xml', 'M7 rehearsal backup.xml'].map(n => readFile(join(mock, n))));
    await execute(dir, setup + `
$refused = $false
try { Invoke-CoreTaskRegistration $plan } catch { $refused = $true }
if (-not $refused) { throw 'Drift accepted' }
`);
    assert.deepEqual(await Promise.all(['M7 rehearsal watchdog.xml', 'M7 rehearsal backup.xml'].map(n => readFile(join(mock, n)))), before);
  });
});
test('task wrappers reject credential or URL action text without echoing it', { skip: !available }, async () => {
  await tasks(async ({ dir, watchdog, setup }) => {
    const marker = `https://synthetic.invalid/join/${'a'.repeat(43)}`;
    await writeFile(watchdog, taskXml('M7 rehearsal watchdog').replace('powershell.exe -NoProfile', marker));
    await execute(dir, setup.replace('$plan = Read-CoreTaskPlan $planPath', ''));
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', join(scripts, 'Register-CoreTasks.ps1'), '-Plan', join(dir, 'plan.json'), '-DryRun'], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic\.invalid|a{43}/);
  });
});

test('task XML refuses a bare scratch credential in actions or triggers before summaries', { skip: !available }, async () => {
  await tasks(async ({ dir, setup }) => {
    await execute(dir, setup + `
foreach ($xml in @(
    $plan.watchdog.xml.path,
    $plan.backup.xml.path
)) {
    $doc = Read-CoreTaskXml ([IO.File]::ReadAllText($xml))
    foreach ($section in @('Actions','Triggers')) {
        $changed = $doc.Clone()
        $node = $changed.SelectSingleNode('/*[local-name()="Task"]/*[local-name()="' + $section + '"]')
        $node.InnerText = ('z' * 43)
        $refused = $false
        try { $null = Get-CoreTaskXmlSummary $changed.OuterXml } catch { $refused = $true }
        if (-not $refused) { throw 'Bare credential summary accepted' }
    }
}
`);
  });
});
test('task restore uses retained originals when candidate config or watch script is missing', { skip: !available }, async () => {
  await tasks(async ({ dir, mock, watchdog, backup, config, watchScript, setup }) => {
    await execute(dir, setup + '\nInvoke-CoreTaskRegistration $plan');
    await rm(config); await rm(watchScript);
    const restored = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', join(scripts, 'Restore-CoreTasks.ps1'), '-Plan', join(dir, 'plan.json')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal watchdog.xml')), await readFile(watchdog));
    assert.deepEqual(await readFile(join(mock, 'M7 rehearsal backup.xml')), await readFile(backup));
    const refused = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', join(scripts, 'Register-CoreTasks.ps1'), '-Plan', join(dir, 'plan.json'), '-DryRun'], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(refused.status, 0);
  });
});

test('watchdog helper returns on foreground exit while an inert redirected child is alive in PS5 and PS7', { skip: !available || !pwshAvailable }, async () => {
  for (const hostShell of [shell, 'pwsh.exe']) await fixture(async dir => {
    const operator = join(dir, 'operator'); await mkdir(operator);
    await copyFile(join(scripts, 'Operator-Common.ps1'), join(operator, 'Operator-Common.ps1'));
    await copyFile(join(scripts, 'Watchdog-Common.ps1'), join(operator, 'Watchdog-Common.ps1'));
    const config = join(dir, 'candidate.json'); await writeFile(config, '{}');
    await writeFile(join(dir, 'holder.mjs'), `import fs from 'node:fs';\nfs.writeFileSync(process.argv[2], String(process.pid));\nprocess.stdout.write('inert stdout\\n');\nprocess.stderr.write('inert stderr\\n');\nsetTimeout(() => process.exit(0), 9000);\n`);
    await writeFile(join(operator, 'Start-Core.ps1'), `param([string]$Config, [switch]$PreservePause)
$ErrorActionPreference = 'Stop'
if (-not $PreservePause) { throw 'PreservePause missing' }
$fixtureNode = ${ps(process.execPath)}
$child = Start-Process -FilePath $fixtureNode -ArgumentList @(('"' + ${ps(join(dir, 'holder.mjs'))} + '"'), ('"' + ${ps(join(dir, 'holder-ready'))} + '"')) -WorkingDirectory ${ps(dir)} -WindowStyle Hidden -RedirectStandardOutput ${ps(join(dir, 'holder.log'))} -RedirectStandardError ${ps(join(dir, 'holder-error.log'))} -PassThru
$child.Handle | Out-Null
[IO.File]::WriteAllText(${ps(join(dir, 'holder-owner.json'))}, (@{pid=$child.Id; startedAt=$child.StartTime.ToUniversalTime().ToString('o'); executable=$fixtureNode} | ConvertTo-Json))
Write-Output 'fixture helper stdout must be discarded'
[Console]::Error.WriteLine('fixture helper stderr must be discarded')
`);
    const result = await execute(dir, `
. ${ps(join(operator, 'Operator-Common.ps1'))}
. ${ps(join(operator, 'Watchdog-Common.ps1'))}
$context = [pscustomobject]@{localDir=${ps(dir)}}
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
    Invoke-CoreWatchHelper $context 'Start' ${ps(config)} (Get-FixtureHash ${ps(config)}) -TimeoutSeconds 15
    $watch.Stop()
    $owner = [IO.File]::ReadAllText(${ps(join(dir, 'holder-owner.json'))}) | ConvertFrom-Json
    $holder = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
    if (-not $holder) { throw 'Foreground helper waited for its background child' }
    if ($watch.ElapsedMilliseconds -ge 6000) { throw 'Foreground helper waited for pipe EOF' }
    [pscustomobject]@{returnedWhileHolderAlive=$true; elapsedMs=$watch.ElapsedMilliseconds; stdoutRedirected=(Test-Path -LiteralPath ${ps(join(dir, 'holder.log'))}); stderrRedirected=(Test-Path -LiteralPath ${ps(join(dir, 'holder-error.log'))})} | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath ${ps(join(dir, 'holder-owner.json'))}) {
        $owner = [IO.File]::ReadAllText(${ps(join(dir, 'holder-owner.json'))}) | ConvertFrom-Json
        $holder = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
        if ($holder) {
            $started = if ($owner.startedAt -is [DateTime]) { $owner.startedAt.ToUniversalTime() } else { [DateTime]::Parse($owner.startedAt).ToUniversalTime() }
            if ($holder.Path -ine $owner.executable -or $holder.StartTime.ToUniversalTime().Ticks -ne $started.Ticks) { throw 'Inert holder cleanup ownership refused' }
            $holder.Kill()
            if (-not $holder.WaitForExit(5000)) { throw 'Inert holder cleanup timed out' }
        }
    }
}
`, 0, hostShell);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.returnedWhileHolderAlive, true);
    assert.equal(summary.stdoutRedirected, true); assert.equal(summary.stderrRedirected, true);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture helper (stdout|stderr)/);
  });
});

test('watchdog helper deadline stops only its launched foreground helper', { skip: !available || !pwshAvailable }, async () => {
  await fixture(async dir => {
    const operator = join(dir, 'operator'); await mkdir(operator);
    await copyFile(join(scripts, 'Operator-Common.ps1'), join(operator, 'Operator-Common.ps1'));
    await copyFile(join(scripts, 'Watchdog-Common.ps1'), join(operator, 'Watchdog-Common.ps1'));
    const config = join(dir, 'candidate.json'); await writeFile(config, '{}');
    await writeFile(join(operator, 'Start-Core.ps1'), `param([string]$Config, [switch]$PreservePause)
$self = Get-Process -Id $PID
[IO.File]::WriteAllText(${ps(join(dir, 'helper-owner.json'))}, (@{pid=$PID; startedAt=$self.StartTime.ToUniversalTime().ToString('o'); executable=$self.Path} | ConvertTo-Json))
Start-Sleep -Seconds 10
`);
    await execute(dir, `
. ${ps(join(operator, 'Operator-Common.ps1'))}
. ${ps(join(operator, 'Watchdog-Common.ps1'))}
$context = [pscustomobject]@{localDir=${ps(dir)}}
$refused = $false
try {
    try { Invoke-CoreWatchHelper $context 'Start' ${ps(config)} (Get-FixtureHash ${ps(config)}) -TimeoutSeconds 1 }
    catch { $refused = $_.Exception.Message -eq 'Foreground operator helper exceeded its deadline.' }
    if (-not $refused) { throw 'Helper deadline was not enforced' }
    $owner = [IO.File]::ReadAllText(${ps(join(dir, 'helper-owner.json'))}) | ConvertFrom-Json
    if (Get-Process -Id $owner.pid -ErrorAction SilentlyContinue) { throw 'Foreground helper survived deadline' }
} finally {
    if (Test-Path -LiteralPath ${ps(join(dir, 'helper-owner.json'))}) {
        $owner = [IO.File]::ReadAllText(${ps(join(dir, 'helper-owner.json'))}) | ConvertFrom-Json
        $helper = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
        if ($helper) {
            $started = if ($owner.startedAt -is [DateTime]) { $owner.startedAt.ToUniversalTime() } else { [DateTime]::Parse($owner.startedAt).ToUniversalTime() }
            if ($helper.Path -ine $owner.executable -or $helper.StartTime.ToUniversalTime().Ticks -ne $started.Ticks) { throw 'Foreground fixture cleanup ownership refused' }
            $helper.Kill(); $null = $helper.WaitForExit(5000)
        }
    }
}
`, 0, 'pwsh.exe');
  });
});
