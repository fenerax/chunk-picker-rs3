// Controlled stage executor: faults occur at named product writes/start calls,
// never after a scheduling delay. Native exit cases keep a real process boundary.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { bindingBytes } from '../../scripts/private-companion/release-pack-check.mjs';
import { fixture, put, pin, hash, runStage } from './release-pack-fixture.mjs';
const q=value=>`'${value.replaceAll("'","''")}'`;
const interruptionPoints=['before-journal','after-journal','after-binding','after-pointer','during-start'];
// A refusal at journal intent restores the previous ready journal, so only a
// crash (covered above) can leave that intent pending for a reverse.
export const stageCases=[...interruptionPoints,'unknown-binding','uncertain-owner','failed-verification'].map(point=>({point,crash:false})).concat(interruptionPoints.map(point=>({point,crash:true})),interruptionPoints.slice(2).map(point=>({point:'pending-'+point,crash:false})));

export async function assertStageRecovery(t,{rollback,point,crash}) {
  const pending=point.startsWith('pending-');
  const firstRollback=rollback&&!pending, effectivePoint=pending?point.slice('pending-'.length):point;
    const root=await fixture(t), local=path.join(root,'local'), kit=path.join(root,'kit');
    const old=path.join(kit,'releases/old'), next=path.join(kit,'releases/new');
    const current=path.join(root,'current.json'), binding=path.join(local,'data.dataset.json');
    const oldD={datasetId:'duo-legacy',datasetContractVersion:1,digest:'1'.repeat(64)};
    const newD={...oldD,digest:'2'.repeat(64)};
    const oldB=bindingBytes(oldD),newB=bindingBytes(newD);
    for(const [dir,id] of [[old,'old'],[next,'new']]) {
      await mkdir(path.join(dir,'core'),{recursive:true}); await put(path.join(dir,'config.json'),{id});
      await put(path.join(dir,'pointer.json'),{schemaVersion:2,releaseId:id,config:await pin(path.join(dir,'config.json'))});
      await put(path.join(dir,'companion.json'),{});
    }
    const transition={schemaVersion:1,old:{...oldD,bindingSha256:hash(oldB)},new:{...newD,bindingSha256:hash(newB)},oldBindingBase64:oldB.toString('base64'),newBindingBase64:newB.toString('base64'),oldConfig:await pin(path.join(old,'config.json')),newConfig:await pin(path.join(next,'config.json'))};
    await put(path.join(next,'pack-transition.json'),transition);
    await put(current,await readFile(path.join(firstRollback?next:old,'pointer.json')));
    await put(binding,firstRollback?newB:oldB);
    const save=path.join(local,'data/state.json'); await put(save,{revision:41,completedTasks:['kept-current-progress']});
    for(const name of ['release-v2.mjs','verify-install.mjs']) await put(path.join(kit,'tools',name),'process.exit(0);');
    await put(path.join(kit,'tools/release-pack-check.mjs'),'// synthetic check overridden in fixture');
    const target=firstRollback?old:next;
    const body=`$ErrorActionPreference='Stop'
Write-FixtureStep 'fixture-overrides:start'
$script:fixturePhase=(Get-Item Function:Set-ReleaseV2Phase).ScriptBlock
function Set-ReleaseV2Phase($Clock,$Name) {
 [Console]::Error.WriteLine(('Fixture phase: '+$Name+' at '+[DateTime]::UtcNow.ToString('o')))
 & $script:fixturePhase $Clock $Name
}
$script:fixtureLock=(Get-Item Function:Enter-OperatorLock).ScriptBlock
function Enter-OperatorLock($Context) {
 Write-FixtureStep 'helper-lock:start'
 try {$owner=& $script:fixtureLock $Context;Write-FixtureStep 'helper-lock:acquired';return $owner}
 catch {Write-FixtureStep 'helper-lock:refused';throw}
}
$script:local=${q(local)}
function Read-OperatorConfig([string]$Path,[switch]$ForStop) {
 $id=(Read-OperatorJson $Path).id;$root=Split-Path -Parent $Path
 return [pscustomobject]@{localDir=$script:local;runtimeFile=(Join-Path $script:local 'runtime');configHash=$id;origin='synthetic';config=[pscustomobject]@{
 coreRoot=(Join-Path $root 'core');nodePath=${q(process.execPath)};dataDir=(Join-Path $script:local 'data');host='127.0.0.1';port=0;loopbackPort=$null;publicOriginFile='synthetic';packsDir=(Join-Path $root 'packs');selection=@{path=(Join-Path $root 'selection');sha256=($(if($id -eq 'old'){'a'}else{'b'})*64)};packs=@{data=@{path='synthetic';sha256=($(if($id -eq 'old'){'a'}else{'b'})*64)};rulesText=@{path='synthetic';sha256=('c'*64)};art=@{path='synthetic';sha256=('d'*64)}}}}
}
function Assert-FixtureOwnership($Context,$LockOwner) {
 Assert-OperatorLockOwner $Context $LockOwner
 $blocked=$false;try{$other=Enter-OperatorLock $Context;$other.Dispose()}catch{$blocked=$true};if(-not $blocked){throw 'Helper owner missing'}
 $blocked=$false;try{$other=[IO.File]::Open((Join-Path $script:local 'watchdog-tick.lock'),'OpenOrCreate','ReadWrite','None');$other.Dispose()}catch{$blocked=$true};if(-not $blocked){throw 'Tick owner missing'}
}
function Stop-OperatorCore($Context,$TimeoutSeconds,[switch]$PreservePause,[IO.FileStream]$LockOwner) {
 Assert-FixtureOwnership $Context $LockOwner
 if(Test-Path -LiteralPath $Context.runtimeFile){if([IO.File]::ReadAllText($Context.runtimeFile) -cne $Context.configHash){throw 'Uncertain runtime owner'};Remove-Item -LiteralPath $Context.runtimeFile}
}
function Assert-OperatorStoreReleased { }
$script:point=${q(effectivePoint==='uncertain-owner'?'during-start':['unknown-binding','failed-verification'].includes(effectivePoint)?'after-journal':effectivePoint)};$script:failedOnce=${crash?`(Test-Path -LiteralPath ${q(path.join(root,'crash-marker'))})`:'$false'}
function Fail-Once([string]$At){if($script:point -eq $At -and -not $script:failedOnce){$script:failedOnce=$true;${crash?`[IO.File]::WriteAllText(${q(path.join(root,'crash-marker'))},'interrupted');[System.Diagnostics.Process]::GetCurrentProcess().Kill()`:`throw 'Injected interruption'`}}}
function Invoke-ReleaseV2PackCheck($Context,$Tool,$From,$To,$Transition,$Output) {
 if(-not(Test-Path -LiteralPath (Join-Path $script:local 'picker-paused'))){throw 'Compatibility ran without pause'}
 Fail-Once 'before-journal';[IO.File]::WriteAllText($Output,'{"passed":true,"bothDirections":true}')
}
$script:realJournal=(Get-Item Function:Write-ReleaseV2Journal).ScriptBlock
function Write-ReleaseV2Journal($Path,$Journal){ & $script:realJournal $Path $Journal;if($Journal.state -eq 'journaled'){Fail-Once 'after-journal'} }
$script:realBinding=(Get-Item Function:Set-ReleaseV2Binding).ScriptBlock
function Set-ReleaseV2Binding($Path,$Expected,$Bytes,$Target){ & $script:realBinding $Path $Expected $Bytes $Target;Fail-Once 'after-binding' }
$script:realPointer=(Get-Item Function:Set-ReleaseV2Pointer).ScriptBlock
function Set-ReleaseV2Pointer($Previous,$Candidate){ & $script:realPointer $Previous $Candidate;Fail-Once 'after-pointer' }
function Start-OperatorCore($Context,$TimeoutSeconds,[switch]$PreservePause,[IO.FileStream]$LockOwner,[switch]$PackTransitionReady) {
 Assert-FixtureOwnership $Context $LockOwner
 Assert-OperatorPackJournal $Context -PackTransitionReady:$PackTransitionReady -LockOwner $LockOwner
 [IO.File]::WriteAllText($Context.runtimeFile,$Context.configHash);Fail-Once 'during-start'
}
$args=@{CurrentRelease=${q(current)};CandidatePointer=${q(path.join(target,'pointer.json'))};CompanionRoot=${q(kit)};Receipt=${q(path.join(target,'companion.json'))};ReleaseRoot=${q(target)};Rollback=$${firstRollback}}
Write-FixtureStep 'fixture-overrides:end'
$failed=$false
if(${crash?`(Test-Path -LiteralPath ${q(path.join(root,'crash-marker'))})`:'$false'}){$failed=$true}else{try{Invoke-ReleaseV2Managed @args}catch{$failed=$true}}
if(-not $failed -or -not $script:failedOnce){Get-ChildItem -LiteralPath ${q(path.join(kit,'.local'))} -Filter '*.failure.txt'|ForEach-Object{Get-Content -LiteralPath $_.FullName};throw 'Interruption not reached'}
if(-not(Test-Path -LiteralPath (Join-Path $script:local 'picker-paused'))){throw 'Failure did not retain pause'}
if(${q(effectivePoint)} -in @('before-journal','after-journal','unknown-binding','failed-verification')) {
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?newB:oldB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'new':'old')}){throw 'Original pair changed too early'}
}elseif(${q(effectivePoint)} -eq 'after-binding'){
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?oldB:newB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'new':'old')}){throw 'Wrong partial pair'}
}else{
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?oldB:newB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'old':'new')}){throw 'Wrong promoted pair'}
}
$journalPath=Join-Path $script:local 'release-pack-transition.json'
if(Test-Path -LiteralPath $journalPath){
 $context=(Read-ReleaseV2Pointer ${q(current)} -ForStop).context
 $failed=$false;try{Assert-OperatorPackJournal $context}catch{$failed=$true};if(-not $failed){throw 'Ordinary Start admitted a pending pair'}
 if(${q(point)} -in @('unknown-binding','uncertain-owner','failed-verification')) {
  $savedBinding=[IO.File]::ReadAllBytes(${q(binding)})
  if(${q(point)} -eq 'unknown-binding'){[IO.File]::WriteAllText(${q(binding)},'foreign binding')}
  if(${q(point)} -eq 'uncertain-owner'){[IO.File]::WriteAllText((Join-Path $script:local 'runtime'),'foreign owner')}
  if(${q(point)} -eq 'failed-verification'){[IO.File]::WriteAllText(${q(path.join(kit,'tools/verify-install.mjs'))},'process.exit(1);')}
  $failed=$false;try{Invoke-ReleaseV2Managed @args -Recover}catch{$failed=$true}
  if(-not $failed -or -not(Test-Path -LiteralPath (Join-Path $script:local 'picker-paused'))){throw 'Uncertain recovery did not stay paused'}
  if(${q(point)} -eq 'unknown-binding'){[IO.File]::WriteAllBytes(${q(binding)},$savedBinding)}
  if(${q(point)} -eq 'uncertain-owner'){if([IO.File]::ReadAllText((Join-Path $script:local 'runtime')) -cne 'foreign owner'){throw 'Foreign owner was modified'};[IO.File]::WriteAllText((Join-Path $script:local 'runtime'),${q(rollback?'old':'new')})}
  if(${q(point)} -eq 'failed-verification'){[IO.File]::WriteAllText(${q(path.join(kit,'tools/verify-install.mjs'))},'process.exit(0);')}
 }
 if($${pending}) {
  $args.CandidatePointer=${q(path.join(old,'pointer.json'))};$args.ReleaseRoot=${q(old)};$args.Receipt=${q(path.join(old,'companion.json'))};$args.Rollback=$true
  $script:point='after-journal';$script:failedOnce=$false
  $failed=$false;try{Invoke-ReleaseV2Managed @args}catch{$failed=$true}
  $reverse=Read-OperatorJson $journalPath
  if(-not $failed -or -not $script:failedOnce -or -not $reverse.rollback -or -not $reverse.allowInversePartial -or $reverse.state -cne 'journaled'){throw 'Reverse intent was not durably journaled'}
 }
 Invoke-ReleaseV2Managed @args -Recover
 if((Read-OperatorJson $journalPath).state -cne 'ready'){throw 'Recovery did not commit readiness'}
}else{Invoke-ReleaseV2Managed @args}
if(Test-Path -LiteralPath (Join-Path $script:local 'picker-paused')){throw 'Successful readiness left pause'}
if((Read-ReleaseV2Pointer ${q(current)}).pointer.releaseId -cne ${q(rollback?'old':'new')}){throw 'Wrong pointer'}
if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(rollback?oldB:newB))}){throw 'Wrong binding'}
`;
    const children=[];
    const options={signal:t.signal,stageName:`${rollback?'rollback':'upgrade'} ${point}`};
    if(crash) {
      // Environment.Exit can deadlock PowerShell 5.1's pipeline thread with
      // redirected stdio. Hard-kill after the durable marker, without finally.
      children.push(await runStage(root,body,code=>Number.isInteger(code)&&code!==0,{...options,loadLibrary:true,stageName:options.stageName+' crash'}));
      assert.equal(await readFile(path.join(root,'crash-marker'),'utf8'),'interrupted','hard termination must reach the injected crash point');
    }
    children.push(await runStage(root,body,0,{...options,hosted:true,stageName:options.stageName+' recovery'}));
    t.diagnostic(JSON.stringify({stage:{rollback,point,crash},children:children.map(child=>({
      pid:child.pid,wallMs:(child.completedAt??child.closedAt)-child.startedAt,exitToCloseMs:child.closedAt-child.exitedAt,
      scriptEntryMs:Date.parse(child.stderrTail.match(/Fixture script entered: ([^\r\n]+)/)?.[1])-child.startedAt,
      phases:[...child.stderrTail.matchAll(/Fixture (?:phase|step): (\S+) at ([^\r\n]+)/g)].map(([,phase,at])=>({phase,elapsedMs:Date.parse(at)-child.startedAt}))
    }))}));
    assert.deepEqual(JSON.parse(await readFile(save)),{revision:41,completedTasks:['kept-current-progress']});
    assert.equal(await readFile(path.join(local,'runtime'),'utf8'),rollback?'old':'new');

}
