import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const windows = process.platform === 'win32';
const quote = value => `'${value.replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'release-v2-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}
async function run(root, body, timeout = 90000) {
  const script = path.join(root, `fixture-${Math.random().toString(16).slice(2)}.ps1`);
  await writeFile(script, `$ErrorActionPreference='Stop'\n${['Operator-Common.ps1', 'ReleaseV2-Common.ps1', 'Watchdog-Common.ps1', 'Task-Common.ps1', 'InstallV2-Common.ps1'].map(file => `. ${quote(path.join(scripts, file))}`).join('\n')}\n${body}`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', timeout });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
async function references(root) {
  const local = path.join(root, 'local'); await mkdir(local);
  const previous = path.join(root, 'previous'); const candidate = path.join(root, 'candidate');
  for (const directory of [previous, candidate]) await mkdir(path.join(directory, 'core'), { recursive: true });
  const oldConfig = path.join(previous, 'config.json'), config = path.join(candidate, 'config.json');
  await writeFile(oldConfig, '{"name":"old"}'); await writeFile(config, '{"name":"new"}');
  const current = path.join(root, 'current.json'), next = path.join(candidate, 'pointer.json');
  for (const [pointer, file, releaseId] of [[current, oldConfig, 'old'], [next, config, 'new']]) {
    await writeFile(pointer, JSON.stringify({ schemaVersion: 2, releaseId, config: { path: file, sha256: hash(await readFile(file)) } }));
  }
  const common = `
$global:local = ${quote(local)}
function Read-OperatorConfig([string]$Path, [switch]$ForStop) {
 $root=Split-Path -Parent $Path
 return [pscustomobject]@{ localDir=$global:local; runtimeFile=(Join-Path $global:local 'server-runtime.json'); configHash=(Get-ReleaseV2Hash $Path); origin='synthetic'; config=[pscustomobject]@{
 coreRoot=(Join-Path $root 'core'); nodePath=${quote(process.execPath)}; dataDir=(Join-Path $global:local 'data'); host='127.0.0.1'; port=0; loopbackPort=$null;
 publicOriginFile=(Join-Path $global:local 'public-origin'); packsDir=(Join-Path $global:local 'packs'); selection=@{path='fixed';sha256=('a'*64)};
 packs=@{data=@{path='data';sha256=('b'*64)};rulesText=@{path='rules';sha256=('c'*64)};art=@{path='art';sha256=('d'*64)}} } }
}
`;
  return { root, local, previous, candidate, oldConfig, config, current, next, common };
}

test('release runtime PowerShell sources parse without invoking entrypoints', { skip: !windows }, async t => {
  const root = await fixture(t);
  await run(root, `
foreach ($file in Get-ChildItem -LiteralPath ${quote(scripts)} -Filter '*.ps1') {
 $errors=$null; $tokens=$null; $null=[Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 if ($errors.Count) { throw ('Parse failed: '+$file.Name) }
}
`);
});

test('native detached launch releases redirected foreground pipes while synthetic child stays alive', { skip: !windows }, async t => {
  const root = await fixture(t), server = path.join(root, 'child.mjs'), pidFile = path.join(root, 'child.pid');
  await writeFile(server, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2], String(process.pid)); console.log('synthetic stdout'); console.error('synthetic stderr'); process.stdin.on('end',()=>fs.writeFileSync(process.argv[2]+'.stdin','closed')); process.stdin.resume(); setTimeout(()=>{},30000);`);
  let childPid;
  try {
    const start = Date.now();
    const output = await run(root, `
$child=Start-OperatorDetached -Executable ${quote(process.execPath)} -Arguments ${quote(`"${server}" "${pidFile}"`)} -WorkingDirectory ${quote(root)} -StandardOutput ${quote(path.join(root, 'stdout.log'))} -StandardError ${quote(path.join(root, 'stderr.log'))}
$until=[DateTime]::UtcNow.AddSeconds(3); while (-not (Test-Path -LiteralPath ${quote(pidFile)}) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 25 }
if ($child.HasExited) { throw 'Synthetic detached child exited early' }; Write-Output $child.Id; $child.Dispose()
`, 12000);
    childPid = Number(output.trim());
    assert.ok(Date.now() - start < 10000, 'foreground pipes must close before the child lifetime');
    process.kill(childPid, 0);
    assert.equal(Number(await readFile(pidFile, 'utf8')), childPid);
    assert.equal((await readFile(path.join(root, 'stdout.log'), 'utf8')).trim(), 'synthetic stdout');
    assert.equal((await readFile(path.join(root, 'stderr.log'), 'utf8')).trim(), 'synthetic stderr');
    assert.equal(await readFile(pidFile + '.stdin', 'utf8'), 'closed');
  } finally {
    childPid ??= Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    if (childPid > 0) { try { process.kill(childPid); } catch {} }
  }
});

test('pointer resolution binds exact config bytes and origin hash; transition permits distinct roots only with stable pins', { skip: !windows }, async t => {
  const root = await fixture(t), f = await references(root);
  await run(root, f.common + `
$old=Read-ReleaseV2Pointer ${quote(f.current)} -ForStop; $new=Read-ReleaseV2Pointer ${quote(f.next)}
Assert-ReleaseV2CandidateLayout $new; Assert-ReleaseV2Transition $new.context $old.context
foreach ($field in 'dataDir','host','port','loopbackPort','nodePath','publicOriginFile','packsDir') {
 $copy=$new.context | ConvertTo-Json -Depth 10 | ConvertFrom-Json; $copy.config.$field='changed'
 $refused=$false; try { Assert-ReleaseV2Transition $copy $old.context } catch { $refused=$true }; if (-not $refused) { throw 'Changed boundary accepted' }
}
$copy=$new.context | ConvertTo-Json -Depth 10 | ConvertFrom-Json; $copy.config.packs.data.sha256=('e'*64)
$refused=$false; try { Assert-ReleaseV2Transition $copy $old.context } catch { $refused=$true }; if (-not $refused) { throw 'Changed pack accepted' }
[IO.File]::AppendAllText(${quote(f.config)},' ')
$refused=$false; try { Read-ReleaseV2Pointer ${quote(f.next)} } catch { $refused=$true }; if (-not $refused) { throw 'Config mutation accepted' }
`);
});

test('atomic pointer update retains byte-exact history and accepts explicit reverse transition', { skip: !windows }, async t => {
  const root = await fixture(t), f = await references(root);
  const original = await readFile(f.current);
  await run(root, f.common + `
$old=Read-ReleaseV2Pointer ${quote(f.current)} -ForStop; $new=Read-ReleaseV2Pointer ${quote(f.next)}
Set-ReleaseV2Pointer $old $new
$committed=Read-ReleaseV2Pointer ${quote(f.current)}
if ($committed.pointer.releaseId -cne 'new') { throw 'Commit failed' }
$history=@(Get-ChildItem -LiteralPath ${quote(root)} -Filter '*.previous')
if ($history.Count -ne 1) { throw 'History missing' }
$prior=Read-ReleaseV2Pointer $history[0].FullName
Assert-ReleaseV2Transition $prior.context $committed.context
Set-ReleaseV2Pointer $committed $prior
`);
  assert.deepEqual(await readFile(f.current), original);
});

test('managed transition keeps one helper owner through verification and readiness, failure leaves pause', { skip: !windows }, async t => {
  for (const failure of ['none', 'identity-before', 'verify', 'identity-after-stop', 'identity-before-start', 'start', 'rollback']) {
    const root = await fixture(t), f = await references(root);
    const tools = path.join(root, 'tools'); await mkdir(tools);
    await writeFile(path.join(tools, 'verify-install.mjs'), `process.exit(${failure === 'verify' ? 1 : 0});`);
    const counter = path.join(root, 'identity-count');
    const failAt = { 'identity-before': 1, 'identity-after-stop': 2, 'identity-before-start': 3 }[failure] ?? 0;
    await writeFile(path.join(tools, 'release-v2.mjs'), `import fs from 'node:fs'; const file=${JSON.stringify(counter)}; const n=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1; fs.writeFileSync(file,String(n)); if (${JSON.stringify(failure)}==='rollback' && !process.argv.includes('--rollback')) process.exit(2); process.exit(n===${failAt}?1:0);`);
    const receipt = path.join(root, 'companion.json'); await writeFile(receipt, '{}');
    await run(root, f.common + `
$global:calls=@()
function Assert-FixtureLock($Context, $LockOwner) {
 Assert-OperatorLockOwner $Context $LockOwner
 $blocked=$false; try { $other=Enter-OperatorLock $Context; $other.Dispose() } catch { $blocked=$true }
 if (-not $blocked) { throw 'Managed helper lock was released' }
}
function Stop-OperatorCore($Context,$TimeoutSeconds,[switch]$PreservePause,[IO.FileStream]$LockOwner) { Assert-FixtureLock $Context $LockOwner; $global:calls+='Stop' }
function Assert-OperatorStoreReleased { }
function Start-OperatorCore($Context,$TimeoutSeconds,[switch]$PreservePause,[IO.FileStream]$LockOwner) {
 Assert-FixtureLock $Context $LockOwner; $global:calls+='Start'
 if (${quote(failure)} -eq 'start') { throw 'synthetic readiness failure' }
}
$failed=$false
try { Invoke-ReleaseV2Managed -CurrentRelease ${quote(f.current)} -CandidatePointer ${quote(f.next)} -CompanionRoot ${quote(root)} -Receipt ${quote(receipt)} -ReleaseRoot ${quote(f.candidate)} -Rollback:(${quote(failure)} -eq 'rollback') } catch { $failed=$true }
if ($failed -ne (${quote(failure)} -notin @('none','rollback'))) { throw 'Wrong result' }
if ((Test-Path -LiteralPath (Join-Path $global:local 'picker-paused')) -ne $failed) { throw 'Wrong pause state' }
$expected=if (${quote(failure)} -in @('identity-before','verify','identity-after-stop')) {'old'} else {'new'}
if ((Read-ReleaseV2Pointer ${quote(f.current)}).pointer.releaseId -cne $expected) { throw 'Wrong current pointer' }
if (${quote(failure)} -eq 'identity-before') { if ($global:calls -contains 'Stop') { throw 'Stop ran despite rejected preflight identity' } }
else {
 if ($global:calls[0] -cne 'Stop') { throw 'Wrong managed call order' }
 if (${quote(failure)} -in @('none','start','rollback') -and $global:calls[-1] -cne 'Start') { throw 'Start not called' }
 # A refusal before storage changes restarts only the previous writer; after the pointer commit no writer is substituted.
 if (${quote(failure)} -in @('verify','identity-after-stop') -and ($global:calls -join ',') -cne 'Stop,Start') { throw 'Previous writer was not restored after a pre-storage refusal' }
 if (${quote(failure)} -eq 'identity-before-start' -and $global:calls.Count -ne 1) { throw 'Start ran despite rejected evidence' }
}
`);
    if (failure === 'rollback') assert.equal(await readFile(counter, 'utf8'), '3', 'all three rollback identity checks must retain rollback mode');
  }
});

test('watchdog follows current pointer after promotion and keeps mismatched runtime ownership fail closed', { skip: !windows }, async t => {
  const root = await fixture(t), f = await references(root);
  await run(root, f.common + `
$old=Read-ReleaseV2Pointer ${quote(f.current)} -ForStop; $new=Read-ReleaseV2Pointer ${quote(f.next)}; Set-ReleaseV2Pointer $old $new
$global:called=''
function Assert-CoreWatchUnoccupied { }
function Invoke-CoreWatchHelper($Context,$Operation,$Config,$ConfigSha256) { $global:called=$Config; Assert-OperatorPin ([pscustomobject]@{path=$Config;sha256=$ConfigSha256}) }
Invoke-CoreWatchTick -CurrentRelease ${quote(f.current)} -HealthRetryDelaySeconds 0
if ($global:called -ine ${quote(f.config)}) { throw 'Watchdog did not resolve promoted configuration' }
$global:called=''; [IO.File]::WriteAllText((Join-Path $global:local 'server-runtime.json'), '{"pid":123,"processStartedAt":"2026-01-01T00:00:00Z","configHash":"wrong","state":"running"}')
Invoke-CoreWatchTick -CurrentRelease ${quote(f.current)} -HealthRetryDelaySeconds 0
if ($global:called) { throw 'Mismatched ownership authorized helper' }
`);
});

test('one-time installer synthetic task backend preserves triggers/backups, snapshots exact originals, and restores reversibly', { skip: !windows }, async t => {
  const root = await fixture(t), f = await references(root);
  const kit = path.join(root, 'kit'), sourceOperator = path.join(kit, 'operator'); await mkdir(sourceOperator, { recursive: true });
  for (const file of ['Operator-Common.ps1', 'Watchdog-Common.ps1', 'ReleaseV2-Common.ps1', 'Task-Common.ps1', 'Start-Core.ps1', 'Stop-Core.ps1', 'Watch-Core.ps1', 'Managed-ReleaseV2.ps1', 'Install-ReleaseV2.ps1', 'InstallV2-Common.ps1']) {
    await writeFile(path.join(sourceOperator, file), await readFile(path.join(scripts, file)));
  }
  const xml = name => `<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Principals><Principal id="User"><UserId>synthetic</UserId></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger><TimeTrigger><StartBoundary>2026-01-01T00:00:00</StartBoundary></TimeTrigger></Triggers><Actions><Exec><Command>powershell.exe</Command><Arguments>-File C:\\synthetic\\${name}.ps1</Arguments><WorkingDirectory>C:\\synthetic</WorkingDirectory></Exec></Actions></Task>`;
  const originalWatch = xml('watch'), originalBackup = xml('backup');
  // Real schema-1 config and schema-2 pointer, with disposable storage only.
  const dataDir=path.join(f.local,'data'),packsDir=path.join(f.local,'packs');await mkdir(dataDir);await mkdir(packsDir);
  await writeFile(path.join(dataDir,'state.json'),'{}');await writeFile(path.join(dataDir,'access-token'),'synthetic-test-credential');
  await writeFile(dataDir+'.dataset.json','{}');await writeFile(path.join(f.local,'public-origin'),'http://127.0.0.1:19876');
  await writeFile(path.join(f.previous,'core/app-server-placeholder'),'synthetic');await mkdir(path.join(f.previous,'core/app'));await writeFile(path.join(f.previous,'core/app/server.mjs'),'// synthetic');
  const selection={schemaVersion:1},packs={};
  for(const [kind,id] of [['data','duo-data'],['rulesText','duo-rules-text'],['art','duo-art']]){
    const file=path.join(packsDir,id,kind==='art'?'1.0.0':'1.0.3','pack.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'{}');
    packs[kind]={path:file,sha256:hash(await readFile(file))};selection[kind]={id,version:kind==='art'?'1.0.0':'1.0.3',sha256:packs[kind].sha256};
  }
  const selectionPath=path.join(packsDir,'selection.json');await writeFile(selectionPath,JSON.stringify(selection));
  const configValue={schemaVersion:1,coreRoot:path.join(f.previous,'core'),dataDir,nodePath:process.execPath,host:'127.0.0.1',port:19876,loopbackPort:19877,publicOriginFile:path.join(f.local,'public-origin'),packsDir,selection:{path:selectionPath,sha256:hash(await readFile(selectionPath))},packs,profile:null,addons:null,runtimeOptions:{taskWorkerMode:'process',workerIdleMs:20000,backupDays:7,historyEntries:500}};
  await writeFile(f.oldConfig,JSON.stringify(configValue));await writeFile(f.current,JSON.stringify({schemaVersion:2,releaseId:'rel2-555b85b',config:{path:f.oldConfig,sha256:hash(await readFile(f.oldConfig))}}));
  const watchFile = path.join(root, 'watch.xml'), backupFile = path.join(root, 'backup.xml'), install = path.join(root, 'installed');
  await writeFile(watchFile, originalWatch); await writeFile(backupFile, originalBackup);
  const stdout = await run(root, `$global:local=${quote(f.local)}\n` + `
# These functions are a file-only task backend. Scheduler cmdlets are forbidden.
function Register-ScheduledTask { throw 'Real scheduler forbidden in fixture' }
function Get-ScheduledTask { throw 'Real scheduler forbidden in fixture' }
function Get-FixtureTaskFile([string]$Name) { if ($Name -ceq 'Synthetic watchdog') { return ${quote(watchFile)} }; if ($Name -ceq 'Synthetic backup') { return ${quote(backupFile)} }; throw 'Unknown synthetic task' }
function Get-ReleaseV2ExistingTask([string]$Name) { return [IO.File]::ReadAllText((Get-FixtureTaskFile $Name)) }
function Get-CoreTaskCurrentXml($Plan,$Target) { return Get-ReleaseV2ExistingTask $Target.name }
function Set-CoreTaskXml($Plan,$Target,[string]$Xml,[switch]$Original) { [IO.File]::WriteAllText((Get-FixtureTaskFile $Target.name),$Xml) }
Invoke-ReleaseV2Installation -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -InitialPointer ${quote(f.current)} -WatchdogTaskName 'Synthetic watchdog' -BackupTaskName 'Synthetic backup' -DryRun
if (Test-Path -LiteralPath ${quote(install)}) { throw 'Dry run wrote files' }
Invoke-ReleaseV2Installation -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -InitialPointer ${quote(f.current)} -WatchdogTaskName 'Synthetic watchdog' -BackupTaskName 'Synthetic backup'
$plan=Read-CoreTaskPlan ${quote(path.join(install, 'task-plan.json'))}; $targets=@(Get-CoreTaskTargets $plan)
$current=Get-ReleaseV2ExistingTask 'Synthetic watchdog'
if ($current -notmatch '-CurrentRelease' -or $current -match '-ConfigSha256') { throw 'Task did not use stable pointer' }
$before=Read-CoreTaskXml $targets[0].originalXml; $after=Read-CoreTaskXml $current
foreach ($name in 'Principals','Settings','Triggers') {
 $query='/*[local-name()="Task"]/*[local-name()="'+$name+'"]'
 if ($before.SelectSingleNode($query).OuterXml -cne $after.SelectSingleNode($query).OuterXml) { throw 'Non-action task content changed' }
}
if ((Get-ReleaseV2ExistingTask 'Synthetic backup') -cne $targets[1].originalXml) { throw 'Backup task changed' }
# Pin a new kit payload, then deploy and restore under both real exclusive locks.
[IO.File]::AppendAllText(${quote(path.join(sourceOperator,'Watch-Core.ps1'))},'` + "`n# refreshed helper fixture" + `')
$files=@(Get-ReleaseV2InstallFiles ${quote(kit)})
[IO.File]::WriteAllText(${quote(path.join(kit,'kit.json'))},(@{schemaVersion=2;operatorFiles=@($files|ForEach-Object {@{name=$_.name;sha256=$_.sha256}})}|ConvertTo-Json -Depth 8))
$before=@(Get-ChildItem -LiteralPath ${quote(install)} -Recurse -File | ForEach-Object { $_.FullName+':'+(Get-ReleaseV2Hash $_.FullName) })
Invoke-ReleaseV2HelperUpdate -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -UpdateHelpers -DryRun
$after=@(Get-ChildItem -LiteralPath ${quote(install)} -Recurse -File | ForEach-Object { $_.FullName+':'+(Get-ReleaseV2Hash $_.FullName) })
if (($before -join '|') -cne ($after -join '|')) { throw 'Helper dry run wrote files' }
$global:ownerChecks=0
function Assert-OperatorLockOwner($Context,[IO.FileStream]$Owner) {
 if (-not $Owner.CanWrite) {throw 'No owner'}
 foreach ($name in 'helper.lock','watchdog-tick.lock') {
  $blocked=$false;try {$other=[IO.File]::Open((Join-Path $Context.localDir $name),'OpenOrCreate','ReadWrite','None');$other.Dispose()} catch {$blocked=$true}
  if (-not $blocked) {throw 'Ownership lost'}
 };$global:ownerChecks++
}
function Start-OperatorCore {throw 'Restart forbidden'};function Stop-OperatorCore {throw 'Stop forbidden'}
$held=Enter-OperatorLock (Read-ReleaseV2Pointer ${quote(path.join(install,'current.json'))} -ForStop).context
$refused=$false;try {Invoke-ReleaseV2HelperUpdate -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -UpdateHelpers} catch {$refused=$true} finally {$held.Dispose()}
if (-not $refused) {throw 'Competing owner accepted'}
Invoke-ReleaseV2HelperUpdate -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -UpdateHelpers
if ($global:ownerChecks -lt 20) {throw 'Copies lacked ownership'}
# Load refreshed helper bytes and resolve the currently live rel2 schema/config.
. ${quote(path.join(install,'operator/Operator-Common.ps1'))}
. ${quote(path.join(install,'operator/ReleaseV2-Common.ps1'))}
$rel2=Read-ReleaseV2Pointer ${quote(path.join(install,'current.json'))}
if ($rel2.pointer.releaseId -cne 'rel2-555b85b') {throw 'Rel2 pointer unsupported'}
[IO.File]::WriteAllText((Join-Path $global:local 'picker-paused'),'synthetic pause')
. ${quote(path.join(install,'operator/Watchdog-Common.ps1'))}
Invoke-CoreWatchTick -CurrentRelease ${quote(path.join(install,'current.json'))}
Remove-Item -LiteralPath (Join-Path $global:local 'picker-paused')
Invoke-ReleaseV2HelperUpdate -InstallRoot ${quote(install)} -RestoreHelpers -DryRun
# Installed drift is refused, including restore. Source drift is refused on update.
$watch=${quote(path.join(install,'operator/Watch-Core.ps1'))};$good=[IO.File]::ReadAllBytes($watch);[IO.File]::AppendAllText($watch,'drift')
$refused=$false;try {Invoke-ReleaseV2HelperUpdate -InstallRoot ${quote(install)} -RestoreHelpers} catch {$refused=$true};if (-not $refused) {throw 'Installed drift accepted'}
[IO.File]::WriteAllBytes($watch,$good)
Invoke-ReleaseV2HelperUpdate -InstallRoot ${quote(install)} -RestoreHelpers
Assert-ReleaseV2InstalledFiles (Read-OperatorJson ${quote(path.join(install,'installation.json'))}) ${quote(install)}
if ((Get-ReleaseV2ExistingTask 'Synthetic watchdog') -cne $current) {throw 'Helper update changed watchdog action/triggers'}
$sourceWatch=${quote(path.join(sourceOperator,'Watch-Core.ps1'))};[IO.File]::AppendAllText($sourceWatch,'source drift')
$refused=$false;try {Invoke-ReleaseV2HelperUpdate -SourceRoot ${quote(kit)} -InstallRoot ${quote(install)} -UpdateHelpers -DryRun} catch {$refused=$true};if (-not $refused) {throw 'Source drift accepted'}
[IO.File]::AppendAllText(${quote(path.join(install, 'operator', 'Watch-Core.ps1'))},'synthetic corrupt new operator')
Invoke-ReleaseV2Installation -InstallRoot ${quote(install)} -Restore
if ((Get-ReleaseV2ExistingTask 'Synthetic watchdog') -cne $targets[0].originalXml) { throw 'Original action did not restore' }
if (-not (Test-Path -LiteralPath (Join-Path $global:local 'picker-paused'))) { throw 'Restore must pause potentially stale original task recovery' }
if (-not (Test-Path -LiteralPath ${quote(path.join(install, 'installation.json'))})) { throw 'Snapshots were removed' }
`);
  assert.match(stdout, /restoreSupported/);
  assert.equal(await readFile(watchFile, 'utf8'), originalWatch);
  assert.equal(await readFile(backupFile, 'utf8'), originalBackup);
});
