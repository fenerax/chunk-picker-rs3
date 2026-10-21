// Disposable native journal/ownership contracts. No listeners or scheduler calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bindingBytes, checkPackTransition, assertStableIdentities, assertPreserved } from '../scripts/private-companion/release-pack-check.mjs';
const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const q = value => `'${value.replaceAll("'", "''")}'`;
const put = async (file, value) => { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)); };
const pin = async file => ({path:file,sha256:hash(await readFile(file))});
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'pack-upgrade-v2-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  return root;
}
async function run(root, body, expectedCode = 0) {
  const file=path.join(root,'fixture.ps1'); await put(file,body);
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.once('error',reject);child.once('exit',code=>code===expectedCode?resolve(output):reject(new Error(output || `Unexpected fixture exit ${code}`)));
  });
}
const interruptionPoints=['before-journal','after-journal','after-binding','after-pointer','during-start'];
// A refusal at journal intent restores the previous ready journal, so only a
// crash (covered above) can leave that intent pending for a reverse.
const cases=[...interruptionPoints,'unknown-binding','uncertain-owner','failed-verification'].map(point=>({point,crash:false})).concat(interruptionPoints.map(point=>({point,crash:true})),interruptionPoints.slice(2).map(point=>({point:'pending-'+point,crash:false})));
for (const rollback of [false,true]) for (const {point,crash} of cases) {
  const pending=point.startsWith('pending-');
  if(pending&&!rollback) continue;
  const firstRollback=rollback&&!pending, effectivePoint=pending?point.slice('pending-'.length):point;
  test(`${rollback?'rollback':'upgrade'} ${crash?'process-exit':'interruption'} ${point}: reconcile under ownership, preserve current save`, {skip:process.platform!=='win32',timeout:30000},async t=>{
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
. ${q(path.join(scripts,'Operator-Common.ps1'))}
. ${q(path.join(scripts,'ReleaseV2-Common.ps1'))}
$global:local=${q(local)}
function Read-OperatorConfig([string]$Path,[switch]$ForStop) {
 $id=(Read-OperatorJson $Path).id;$root=Split-Path -Parent $Path
 return [pscustomobject]@{localDir=$global:local;runtimeFile=(Join-Path $global:local 'runtime');configHash=$id;origin='synthetic';config=[pscustomobject]@{
 coreRoot=(Join-Path $root 'core');nodePath=${q(process.execPath)};dataDir=(Join-Path $global:local 'data');host='127.0.0.1';port=0;loopbackPort=$null;publicOriginFile='synthetic';packsDir=(Join-Path $root 'packs');selection=@{path=(Join-Path $root 'selection');sha256=($(if($id -eq 'old'){'a'}else{'b'})*64)};packs=@{data=@{path='synthetic';sha256=($(if($id -eq 'old'){'a'}else{'b'})*64)};rulesText=@{path='synthetic';sha256=('c'*64)};art=@{path='synthetic';sha256=('d'*64)}}}}
}
function Assert-FixtureOwnership($Context,$LockOwner) {
 Assert-OperatorLockOwner $Context $LockOwner
 $blocked=$false;try{$other=Enter-OperatorLock $Context;$other.Dispose()}catch{$blocked=$true};if(-not $blocked){throw 'Helper owner missing'}
 $blocked=$false;try{$other=[IO.File]::Open((Join-Path $global:local 'watchdog-tick.lock'),'OpenOrCreate','ReadWrite','None');$other.Dispose()}catch{$blocked=$true};if(-not $blocked){throw 'Tick owner missing'}
}
function Stop-OperatorCore($Context,$TimeoutSeconds,[switch]$PreservePause,[IO.FileStream]$LockOwner) {
 Assert-FixtureOwnership $Context $LockOwner
 if(Test-Path -LiteralPath $Context.runtimeFile){if([IO.File]::ReadAllText($Context.runtimeFile) -cne $Context.configHash){throw 'Uncertain runtime owner'};Remove-Item -LiteralPath $Context.runtimeFile}
}
function Assert-OperatorStoreReleased { }
$global:point=${q(effectivePoint==='uncertain-owner'?'during-start':['unknown-binding','failed-verification'].includes(effectivePoint)?'after-journal':effectivePoint)};$global:failedOnce=${crash?`(Test-Path -LiteralPath ${q(path.join(root,'crash-marker'))})`:'$false'}
function Fail-Once([string]$At){if($global:point -eq $At -and -not $global:failedOnce){$global:failedOnce=$true;${crash?`[IO.File]::WriteAllText(${q(path.join(root,'crash-marker'))},'interrupted');[Environment]::Exit(75)`:`throw 'Injected interruption'`}}}
function Invoke-ReleaseV2PackCheck($Context,$Tool,$From,$To,$Transition,$Output) {
 if(-not(Test-Path -LiteralPath (Join-Path $global:local 'picker-paused'))){throw 'Compatibility ran without pause'}
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
$failed=$false
if(${crash?`(Test-Path -LiteralPath ${q(path.join(root,'crash-marker'))})`:'$false'}){$failed=$true}else{try{Invoke-ReleaseV2Managed @args}catch{$failed=$true}}
if(-not $failed -or -not $global:failedOnce){Get-ChildItem -LiteralPath ${q(path.join(kit,'.local'))} -Filter '*.failure.txt'|ForEach-Object{Get-Content -LiteralPath $_.FullName};throw 'Interruption not reached'}
if(-not(Test-Path -LiteralPath (Join-Path $global:local 'picker-paused'))){throw 'Failure did not retain pause'}
if(${q(effectivePoint)} -in @('before-journal','after-journal','unknown-binding','failed-verification')) {
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?newB:oldB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'new':'old')}){throw 'Original pair changed too early'}
}elseif(${q(effectivePoint)} -eq 'after-binding'){
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?oldB:newB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'new':'old')}){throw 'Wrong partial pair'}
}else{
 if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(firstRollback?oldB:newB))} -or (Read-ReleaseV2Pointer ${q(current)} -ForStop).pointer.releaseId -cne ${q(firstRollback?'old':'new')}){throw 'Wrong promoted pair'}
}
$journalPath=Join-Path $global:local 'release-pack-transition.json'
if(Test-Path -LiteralPath $journalPath){
 $context=(Read-ReleaseV2Pointer ${q(current)} -ForStop).context
 $failed=$false;try{Assert-OperatorPackJournal $context}catch{$failed=$true};if(-not $failed){throw 'Ordinary Start admitted a pending pair'}
 if(${q(point)} -in @('unknown-binding','uncertain-owner','failed-verification')) {
  $savedBinding=[IO.File]::ReadAllBytes(${q(binding)})
  if(${q(point)} -eq 'unknown-binding'){[IO.File]::WriteAllText(${q(binding)},'foreign binding')}
  if(${q(point)} -eq 'uncertain-owner'){[IO.File]::WriteAllText((Join-Path $global:local 'runtime'),'foreign owner')}
  if(${q(point)} -eq 'failed-verification'){[IO.File]::WriteAllText(${q(path.join(kit,'tools/verify-install.mjs'))},'process.exit(1);')}
  $failed=$false;try{Invoke-ReleaseV2Managed @args -Recover}catch{$failed=$true}
  if(-not $failed -or -not(Test-Path -LiteralPath (Join-Path $global:local 'picker-paused'))){throw 'Uncertain recovery did not stay paused'}
  if(${q(point)} -eq 'unknown-binding'){[IO.File]::WriteAllBytes(${q(binding)},$savedBinding)}
  if(${q(point)} -eq 'uncertain-owner'){if([IO.File]::ReadAllText((Join-Path $global:local 'runtime')) -cne 'foreign owner'){throw 'Foreign owner was modified'};[IO.File]::WriteAllText((Join-Path $global:local 'runtime'),${q(rollback?'old':'new')})}
  if(${q(point)} -eq 'failed-verification'){[IO.File]::WriteAllText(${q(path.join(kit,'tools/verify-install.mjs'))},'process.exit(0);')}
 }
 if($${pending}) {
  $args.CandidatePointer=${q(path.join(old,'pointer.json'))};$args.ReleaseRoot=${q(old)};$args.Receipt=${q(path.join(old,'companion.json'))};$args.Rollback=$true
  $global:point='after-journal';$global:failedOnce=$false
  $failed=$false;try{Invoke-ReleaseV2Managed @args}catch{$failed=$true}
  $reverse=Read-OperatorJson $journalPath
  if(-not $failed -or -not $global:failedOnce -or -not $reverse.rollback -or -not $reverse.allowInversePartial -or $reverse.state -cne 'journaled'){throw 'Reverse intent was not durably journaled'}
 }
 Invoke-ReleaseV2Managed @args -Recover
 if((Read-OperatorJson $journalPath).state -cne 'ready'){throw 'Recovery did not commit readiness'}
}else{Invoke-ReleaseV2Managed @args}
if(Test-Path -LiteralPath (Join-Path $global:local 'picker-paused')){throw 'Successful readiness left pause'}
if((Read-ReleaseV2Pointer ${q(current)}).pointer.releaseId -cne ${q(rollback?'old':'new')}){throw 'Wrong pointer'}
if((Get-ReleaseV2Hash ${q(binding)}) -cne ${q(hash(rollback?oldB:newB))}){throw 'Wrong binding'}
`;
    if(crash) await run(root,body,75);
    await run(root,body);
    assert.deepEqual(JSON.parse(await readFile(save)),{revision:41,completedTasks:['kept-current-progress']});
    assert.equal(await readFile(path.join(local,'runtime'),'utf8'),rollback?'old':'new');
  });
}

test('compatibility uses separate packed startup processes, checks latest save both ways and refuses changed identity/binding', {timeout:30000},async t=>{
  const root=await fixture(t),data=path.join(root,'data');
  await put(path.join(data,'state.json'),{revision:9});
  const descriptors=[],configs=[];
  for(const [name,digit] of [['old','1'],['new','2']]) {
    const core=path.join(root,name),packs=path.join(core,'packs');
    await put(path.join(core,'app/tasks/identity.mjs'),`export const authoredIdentityRegistry=()=>({entries:{'rs3:quest:1':{}},aliases:{legacy:'rs3:quest:1'}});export const resolveIdentity=id=>({status:'resolved',id});`);
    await put(path.join(core,'app/dataset-bootstrap.mjs'),'export const loadDatasetInputs=async()=>({definitionBytes:Buffer.from(JSON.stringify({challenges:{}}))});');
    await put(path.join(core,'app/dataset-pipeline.mjs'),'export const prepareTaskDefinitions=x=>x;');
    await put(path.join(core,'app/server.mjs'),`import http from 'node:http';import {readFile,writeFile} from 'node:fs/promises';export async function createServer({dataDir,port}){const saved=JSON.parse(await readFile(dataDir+'/state.json'));if(saved.revision!==9)throw Error('save');if(!process.env.RS3_PACK_SELECTION.includes(${JSON.stringify(name)}))throw Error('selection');const server=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({tasks:[{id:'rs3:quest:1'}]}));});return {dataset:{},store:{getState:()=>({members:[{id:'one',completedTasks:[],taskStatus:{}}],tasks:[{id:'rs3:quest:1'}]}),backup:async()=>({})},listen:()=>new Promise(ok=>server.listen(port,'127.0.0.1',ok)),get inviteUrl(){return 'http://127.0.0.1:'+port+'/join/synthetic';},close:()=>new Promise(ok=>server.close(ok))};}`);
    const descriptor={datasetId:'duo-legacy',datasetContractVersion:1,digest:digit.repeat(64)};
    const bytes=bindingBytes(descriptor);descriptors.push({...descriptor,bindingSha256:hash(bytes)});
    await put(path.join(packs,'pack.json'),{requires:descriptor,datasetDigest:descriptor.digest,ruleContractHash:'a'.repeat(64)});
    await put(path.join(core,'profile.json'),{datasetId:descriptor.datasetId,datasetDigest:descriptor.digest,ruleContractHash:'a'.repeat(64)});
    await put(path.join(packs,'selection.json'),{});await put(path.join(core,'addon.json'),{});
    const config=path.join(core,'config.json');configs.push(config);
    await put(config,{coreRoot:core,dataDir:data,nodePath:process.execPath,packsDir:packs,selection:await pin(path.join(packs,'selection.json')),profile:await pin(path.join(core,'profile.json')),addons:await pin(path.join(core,'addon.json')),packs:{data:await pin(path.join(packs,'pack.json'))}});
  }
  await put(data+'.dataset.json',bindingBytes(descriptors[0]));
  const plan={schemaVersion:1,old:descriptors[0],new:descriptors[1],oldConfig:await pin(configs[0]),newConfig:await pin(configs[1]),oldBindingBase64:bindingBytes(descriptors[0]).toString('base64'),newBindingBase64:bindingBytes(descriptors[1]).toString('base64')};
  const before=await readFile(path.join(data,'state.json'));
  assert.equal((await checkPackTransition({fromConfig:configs[0],toConfig:configs[1],transition:plan})).bothDirections,true);
  await put(data+'.dataset.json',bindingBytes(descriptors[1]));
  await put(path.join(root,'new/app/server.mjs'),`export async function createServer(){throw Error('failed new startup');}`);
  assert.equal((await checkPackTransition({fromConfig:configs[1],toConfig:configs[0],transition:plan})).rollbackTargetOpened,true);
  await assert.rejects(checkPackTransition({fromConfig:configs[0],toConfig:configs[1],transition:{...plan,new:{...plan.new,digest:'3'.repeat(64)}}}),/descriptor/);
  await put(data+'.dataset.json','unknown binding');
  await assert.rejects(checkPackTransition({fromConfig:configs[0],toConfig:configs[1],transition:plan}),/binding differs/);
  assert.throws(()=>assertStableIdentities({authored:{id:1},saved:{}},{authored:{id:2},saved:{}}),/identities/);
  assert.deepEqual(await readFile(path.join(data,'state.json')),before);
});

test('declared saved identity additions are exact and newly dataset-authored', () => {
  const resolution = id => ({status:'resolved',id,candidates:[id]});
  const a = {authored:{ids:['old'],aliases:{}}, saved:{old:resolution('old')}, datasetAuthored:{old:'old'}};
  const b = {...a,saved:{...a.saved,new:resolution('new'),alias:resolution('new')},datasetAuthored:{old:'old',new:'new',alias:'new'}};
  const additions = [{key:'new',target:'new'},{key:'alias',target:'new'}];
  assert.doesNotThrow(()=>assertStableIdentities(a,b,additions));
  assert.throws(()=>assertStableIdentities(a,b),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,extra:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{old:a.saved.old,new:b.saved.new}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,old:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{new:b.saved.new,alias:b.saved.alias}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,authored:{ids:['changed'],aliases:{}}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,b,[...additions,additions[0]]),/addition/);
  assert.throws(()=>assertStableIdentities(a,{...b,datasetAuthored:a.datasetAuthored},additions),/addition/);
  assert.throws(()=>assertStableIdentities({...a,datasetAuthored:b.datasetAuthored},b,additions),/addition/);
  const authored={ids:['old','new'],aliases:{}};
  assert.throws(()=>assertStableIdentities({...a,authored},{...b,authored},additions),/addition/);
});

test('saved progress preservation allows only appended catalogue bookkeeping and retains every existing event', () => {
  const a={taskIds:['kept'],progressDigest:'same',progressFields:{members:'same'},historyEvents:['old'],historyTypes:['command'],migrationArchives:['archive'],migrationConversions:[],migrationConflicts:[]};
  const b={...a,taskIds:['kept','new'],historyEvents:['old','refresh'],historyTypes:['command','catalogue-refresh'],migrationArchives:['archive','new-archive']};
  assert.doesNotThrow(()=>assertPreserved(a,b));
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['changed','refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyTypes:['command','command']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,migrationArchives:[]}),/archive/);
  assert.throws(()=>assertPreserved(a,{...b,taskIds:['new']}),/progress/);
  assert.throws(()=>assertPreserved(a,{...b,progressDigest:'changed',progressFields:{members:'changed'}}),/progress/);
});
