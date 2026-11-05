import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digestValue } from './release-identity.mjs';
import { hashFile, publishEvidence, localEvidence, atomicJSON } from './release-evidence.mjs';
import { fileProject, filePlan, readFilePass, verifyFilePass, publishFilePass, retainFilePass, traceVerdict } from './file-test-evidence.mjs';
import { planLaneEvidence, lookupLaneEvidence, publishLaneEvidence, retainLaneEvidence, verifyLaneEvidence, beginLaneAttempt, finishLaneAttempt } from './lane-test-evidence.mjs';
export { planLaneEvidence, lookupLaneEvidence, readLaneEvidence } from './lane-test-evidence.mjs';

export const candidateLine = (manifest,base=manifest.base) => digestValue({ schema:'rs3-candidate-line-v1', project:'rs3-picker', base });
export const failureFile = (directory, manifest) => path.join(directory,'failures',candidateLine(manifest)+'.json');
export async function previousFailures(directory, manifest) {
  const lanes={};
  // A base line survives worktree relocation. The candidate SHA also joins a
  // post-merge failure journal, whose test-only baseline is that SHA itself.
  for(const line of new Set([candidateLine(manifest),candidateLine(manifest,manifest.revision)]))try{
    const value=JSON.parse(await readFile(path.join(directory,'failures',line+'.json'),'utf8'));
    if(value.schema!=='rs3-previous-failures-v1'||value.line!==line)throw Error('Failure line changed.');
    for(const [lane,files]of Object.entries(value.lanes))lanes[lane]=[...new Set([...(lanes[lane]??[]),...files])].sort();
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return lanes;
}
export async function rememberFailures(directory,manifest,lane,files) {
  const lanes=await previousFailures(directory,manifest);lanes[lane]=[...new Set(files)].sort();
  for(const line of new Set([candidateLine(manifest),candidateLine(manifest,manifest.revision)]))await atomicJSON(path.join(directory,'failures',line+'.json'),{schema:'rs3-previous-failures-v1',line,lanes,updatedAt:new Date().toISOString()});
}
export async function planLane({kit,release,lane,execution,runtimeOS,retainedBrowser}) {
  const companion=JSON.parse(await readFile(path.join(release,'companion.json'),'utf8'));
  const project=await fileProject({coreRoot:path.join(release,'core'),...(lane==='private-full'?{privateRoot:path.join(kit,'checks/private-source'),packsDir:companion.packsDir,textOverrides:companion.textOverrides}: {})});
  const runnerPins={};
  const kitManifest=JSON.parse(await readFile(path.join(kit,'kit.json'),'utf8'));
  // Pin Chrome conservatively for every file. Even an opaque browser file's
  // earned observation then records the browser bytes it was executed beside.
  runnerPins.chrome=retainedBrowser??await hashFile(kitManifest.browser?.path??'C:/Program Files/Google/Chrome/Application/chrome.exe');
  for(const [name,file] of Object.entries({evidence:path.join(kit,'tools/file-test-evidence.mjs'),lane:path.join(kit,'tools/file-test-lane.mjs'),runner:path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'),scanner:path.join(kit,'tools/module-scan.mjs')}))runnerPins[name]=await hashFile(file);
  // The tracer decides what a pass observed; the recipe decides what else the assembly holds.
  runnerPins.tracer=await hashFile(path.join(kit,'checks/private-source/scripts/test-trace.mjs')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(lane==='private-full')runnerPins.assembly=await hashFile(path.join(kit,'tools/companion-check.mjs'));
  for(const name of ['scripts/test-selection.mjs','scripts/test.mjs','scripts/test-run-environment.mjs','scripts/test-port-check.mjs']){
    const input=project.entries.get(name);if(input)runnerPins[name]=input.sha256;
  }
  let declarations={};
  const declaration=project.entries.get('scripts/test-inputs.json');
  if(declaration){declarations=JSON.parse(await readFile(declaration.source,'utf8'));runnerPins.declarations=declaration.sha256;}
  const plans=await filePlan({project,lane,execution,runnerPins,declarations,runtimeOS});
  if(!plans.length)throw Error('Empty full test inventory refused.');
  return plans;
}

/** execute owns assembly, runner, isolated home/temp and cleanup. A failed peer
 * does not discard successful file proofs, but no suite proof is published. */
export async function runFileLane({kit,release,manifest,lane,execution,contract,directory,timings,execute,only,force=false,runId,earned=[],phase='full',lookupOnly=false,planFiles=planLane,neutral=null}) {
  // A complete whole-input observation already carries independently verified
  // file plans. Consult it before rebuilding the conservative static closures.
  const fastWhole=await planLaneEvidence({kit,release,lane,execution});
  const fastLookup=await lookupLaneEvidence(directory,fastWhole);
  const fastHit=fastLookup.item?.record.status==='passed';
  const all=fastHit?fastLookup.item.record.files.map(file=>file.plan):await planFiles({kit,release,lane,execution});
  const whole=fastHit?fastWhole:await planLaneEvidence({kit,release,lane,execution,plans:all});
  const lookup=fastHit?fastLookup:await lookupLaneEvidence(directory,whole);
  const completePass=lookup.item?.record.status==='passed';
  const source=lookup.item;
  runId??=randomUUID();
  const command={program:'node',module:'$KIT/checks/private-source/scripts/adaptive-test-runner.mjs',method:'runAdaptive',lane,executionDigest:execution.digest};
  let selected=only?all.filter(p=>only.includes(p.file)):all;
  if(only&&selected.length!==new Set(only).size)throw Error('A previously failed test disappeared from the inventory.');
  let retained=[],fresh=[];
  for(const plan of selected){
    const laneFile=source?.record.files.find(f=>f.file===plan.file&&f.passed);
    let pass=laneFile&&(completePass||!force)?await verifyFilePass(laneFile.proof.filename,plan,{allowAlways:true}).catch(()=>null):null;
    const current=earned.find(p=>p.file===plan.file&&p.record?.runId===runId&&runId&&p.wholeLaneKey===whole.key);
    pass??=current?await verifyFilePass(current.filename,plan,{allowAlways:true}).catch(()=>null):null;
    pass??=force?null:await readFilePass(path.join(directory,'files'),plan);
    if(pass)retained.push({plan,pass,source:laneFile?'whole-lane':current?'same-round':'file-pass'});else fresh.push(plan);
  }
  // Phase B hook: neutral(all,due) may return {files,receipt}, a freshly verified Actions
  // run standing in for files that were due to run fresh here. Skipped when the whole
  // lane already passed here. due names this release's PC files for the witness rule.
  const split=neutral&&!only&&!completePass&&fresh.length?await neutral(all,{fresh:fresh.map(p=>p.file),ranHere:retained.filter(r=>r.source==='same-round').map(r=>r.plan.file)}):null;
  const remote=split?fresh.filter(p=>split.files.includes(p.file)):[];
  if(split&&remote.length!==new Set(split.files).size)throw Error('Neutral file was not due to run fresh here.');
  selected=selected.filter(p=>!remote.includes(p));fresh=fresh.filter(p=>!remote.includes(p));
  command.files=fresh.map(p=>p.file);
  if(fastHit&&fresh.length)throw Error('Whole lane file proof changed during lookup.');
  const startedAt=new Date().toISOString();let result={passed:true,files:[]};
  if(fresh.length){
    if(lookupOnly)throw Object.assign(Error('Fresh file execution requires admission.'),{needsAdmission:true});
    if(!only)await beginLaneAttempt(directory,whole,{runId,startedAt,command});
    result=await execute(fresh.map(p=>p.file),{inventory:all.map(p=>p.file)});
  }
  // Re-read effective closure after cleanup, including byte-pinned declarations.
  let after;
  if(!fastHit){
    after=await planFiles({kit,release,lane,execution});
    const wholeAfter=await planLaneEvidence({kit,release,lane,execution,plans:after});
    if(digestValue(after.map(p=>p.contract))!==digestValue(all.map(p=>p.contract))||digestValue(wholeAfter)!==digestValue(whole))throw Error('Test inputs changed during execution.');
  }
  const observed=result.files??[];
  // A pass is reusable only when its trace shows it read nothing its contract leaves out.
  const verdicts=new Map(fresh.map(plan=>{const metrics=observed.find(f=>f.file===plan.file),current=after?.find(p=>p.file===plan.file);return [plan.file,metrics?.passed===true?{...traceVerdict(current,metrics.trace,{flaky:metrics.flaky===true}),...traceCounts(metrics.trace)}:{verified:false,reasons:['not passed']}];}));
  const lean=metrics=>{if(!metrics)return metrics;const {trace,attempts,...rest}=metrics;return {...rest,...(attempts?{attempts:attempts.map(({observation,...attempt})=>({...attempt,observation:observation&&(({trace,...o})=>o)(observation)}))}:{}),...(verdicts.has(metrics.file)?{trace:verdicts.get(metrics.file)}:{})};};
  const complete=result.aborted!==true&&typeof result.passed==='boolean'&&observed.length===fresh.length&&new Set(observed.map(f=>f.file)).size===fresh.length&&fresh.every(p=>observed.some(f=>f.file===p.file&&typeof f.passed==='boolean'))&&result.passed===observed.every(f=>f.passed);
  if(!complete)throw Object.assign(Error('Incomplete test attempt cannot preserve passing peers.'),{failedFiles:fresh.map(p=>p.file)});
  const failures=[];
  for(const plan of fresh){
    const metrics=lean(result.files.find(f=>f.file===plan.file));
    if(!metrics||metrics.passed!==true){failures.push(plan.file);continue;}
    const pass=await publishFilePass(path.join(directory,'files'),plan,{kit,coreSHA:manifest.revision,startedAt,metrics:{...metrics,provenance:{runId,startedAt,completedAt:new Date().toISOString(),command,cleanup:{runId,completedAt:new Date().toISOString(),command:{operation:'execute-selection-finally',roots:['assembly','home','temp','compile-cache']},verified:true}},flaky:metrics.flaky??false},cleanupVerified:true,runId});
    retained.push({plan,pass,source:'fresh'});
  }
  // Previously failed files stay listed until they actually pass in the early lane.
  if(!only||failures.length)await rememberFailures(directory,manifest,lane,failures);
  else{const previous=(await previousFailures(directory,manifest))[lane]??[];await rememberFailures(directory,manifest,lane,previous.filter(f=>!only.includes(f)));}
  const files=[];
  for(const {plan,pass,source} of retained){const item=await retainFilePass(pass,path.join(release,'release-gate/files'));files.push({file:plan.file,alwaysRun:plan.alwaysRun,wholeLaneKey:whole.key,...item,provenance:{phaseRunId:runId,sourceRunId:pass.record.runId,source,command:pass.record.metrics?.provenance?.command??command,phaseCommand:command,observedAt:pass.record.completedAt,flaky:pass.record.metrics?.flaky??false,missReason:source==='fresh'?(lookup.reason??'completed-attempt-file-failed'):null}});}
  files.sort((a,b)=>a.file.localeCompare(b.file));
  let laneEvidence;
  // A split lane has no whole-lane observation; verifyFileLane checks both sources.
  if(!only&&!remote.length){
    if(!fresh.length&&completePass)laneEvidence=source;
    else laneEvidence=await publishLaneEvidence(directory,whole,{startedAt,runId,command,failures,files:all.map(plan=>{
      const pass=retained.find(r=>r.plan.file===plan.file)?.pass,metrics=observed.find(f=>f.file===plan.file);
      return {file:plan.file,passed:!!pass,plan,runId:pass?.record.runId??runId,completedAt:pass?.record.completedAt??new Date().toISOString(),command:pass?.record.metrics?.provenance?.command??command,metrics:lean(metrics)??pass?.record.metrics??{},...(pass?{proof:pass}: {})};
    })});
    if(fresh.length)await finishLaneAttempt(directory,whole,runId);
    laneEvidence=await retainLaneEvidence(laneEvidence,path.join(release,'release-gate/lanes'));
  }
  const fileDetails=selected.map(plan=>{const file=files.find(f=>f.file===plan.file);return {file:plan.file,disposition:fresh.some(p=>p.file===plan.file)?'fresh':'reused',sourceRunId:file?.provenance.sourceRunId??runId,reason:file?.provenance.missReason??(failures.includes(plan.file)?'test-failed':file?.provenance.source??null),flaky:file?.provenance.flaky??false};});
  const summary={stage:only?'early-'+(phase==='full'?'previous':phase)+'-'+lane:lane,passed:result.passed&&failures.length===0,fresh:fresh.length,reused:retained.filter(r=>r.pass.reused).length,alwaysRun:fresh.filter(p=>p.alwaysRun).length,seconds:(Date.now()-Date.parse(startedAt))/1000,failures,runId,status:fresh.length?(retained.some(r=>r.pass.reused)?'mixed':'fresh'):'reused',wholeLaneReused:!!completePass&&!fresh.length,neutral:remote.length,sourceRunIds:[...new Set(fileDetails.map(f=>f.sourceRunId))],missReason:fresh.length?(lookup.reason??'completed-attempt-file-failed'):null,fileDetails};
  timings.push(summary);
  if(!summary.passed)throw Object.assign(Error('Test files failed: '+failures.join(', ')),{failedFiles:failures,fileSummary:summary});
  if(only){
    if(fastHit&&digestValue(await planLaneEvidence({kit,release,lane,execution}))!==digestValue(whole))throw Error('Test inputs changed while retaining whole lane evidence.');
    return {files,summary};
  }
  const aggregate=await publishEvidence(directory,contract,{startedAt});
  const local=await localEvidence(aggregate,path.join(release,'release-gate'));
  if(fastHit&&digestValue(await planLaneEvidence({kit,release,lane,execution}))!==digestValue(whole))throw Error('Test inputs changed while retaining whole lane evidence.');
  return {...local,aggregateReused:aggregate.reused,reused:fresh.length===0,files,fileSchema:'rs3-test-file-pass-v1',laneEvidence,summary,...(remote.length?{neutral:{files:remote.map(p=>p.file),receipt:split.receipt}}:{})};
}
const traceCounts=trace=>trace?{observed:['read','list','stat','tree'].reduce((sum,kind)=>sum+(trace[kind]?.length??0),0),processes:trace.processes??0}:{};
export async function verifyFileLane({kit,release,lane,execution,item,retained=false,planFiles=planLane,verifyNeutral}) {
  if(item?.fileSchema!=='rs3-test-file-pass-v1'||!Array.isArray(item.files))throw Error('Per-file full lane evidence required.');
  if(item.neutral)return verifySplitLane({kit,release,lane,execution,item,retained,planFiles,verifyNeutral});
  const runtimeOS=retained?item.files[0]?.record?.contract?.inputs?.os:undefined;
  if(retained&&(!runtimeOS||typeof runtimeOS.release!=='string'||typeof runtimeOS.version!=='string'))throw Error('Retained runtime pins missing.');
  const retainedBrowser=retained?item.files[0]?.record?.contract?.inputs?.runnerPins?.chrome:undefined;
  if(retained&&!/^[a-f0-9]{64}$/.test(retainedBrowser??''))throw Error('Retained browser pin missing.');
  if(!item.laneEvidence)throw Error('Complete whole lane evidence required.');
  const retainedWrapper=retained?item.laneEvidence.record.contract.inputs.tooling?.heavyWrapper:undefined;
  if(retained&&!/^[a-f0-9]{64}$/.test(retainedWrapper??''))throw Error('Retained wrapper pin missing.');
  const options={kit,release,lane,execution,runtimeOS:retained?item.laneEvidence.record.contract.inputs.os:undefined,retainedBrowser,retainedWrapper};
  const fastWhole=await planLaneEvidence(options);
  const fastHit=digestValue(fastWhole)===digestValue(item.laneEvidence.record.contract);
  const plans=fastHit?item.laneEvidence.record.files.map(file=>file.plan):await planFiles({kit,release,lane,execution,runtimeOS,retainedBrowser});
  const whole=fastHit?fastWhole:await planLaneEvidence({...options,plans});
  const laneRelative=path.relative(path.join(release,'release-gate/lanes'),item.laneEvidence.filename??'');
  if(!laneRelative||laneRelative.startsWith('..')||path.isAbsolute(laneRelative))throw Error('Lane proof containment refused.');
  const wholeProof=await verifyLaneEvidence(item.laneEvidence.filename,whole,{retained});
  if(wholeProof.record.status!=='passed'||digestValue(wholeProof.record)!==digestValue(item.laneEvidence.record))throw Error('Complete whole lane proof changed.');
  if(plans.length!==item.files.length||new Set(item.files.map(f=>f.file)).size!==plans.length)throw Error('Full file evidence inventory changed.');
  for(const plan of plans){
    const file=item.files.find(f=>f.file===plan.file);
    const relative=path.relative(path.join(release,'release-gate/files'),file?.filename??'');
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('File proof containment refused.');
    const proof=await verifyFilePass(file.filename,plan,{retained,allowAlways:true});
    if(digestValue(proof.record)!==digestValue(file.record))throw Error('Retained file proof changed.');
  }
  if(digestValue(await planLaneEvidence({...options,...(fastHit?{}:{plans})}))!==digestValue(whole))throw Error('Test inputs changed during lane proof verification.');
}
const neutralIdentity=receipt=>({source:receipt?.source,policy:receipt?.policy,key:receipt?.key,packs:receipt?.packs,node:receipt?.node,recordDigest:receipt?.recordDigest});
/** Phase B split lane: a local proof for every file run here plus a fresh
 * re-verification of the Actions import; together exactly the full inventory. */
async function verifySplitLane({kit,release,lane,execution,item,retained,planFiles,verifyNeutral}) {
  if(lane!=='private-full'||typeof verifyNeutral!=='function')throw Error('Neutral lane evidence needs its fresh verifier.');
  const remote=item.neutral.files,local=item.files.map(f=>f.file);
  if(!Array.isArray(remote)||!remote.length||new Set(remote).size!==remote.length||new Set(local).size!==local.length||local.some(f=>remote.includes(f)))throw Error('Split lane sources overlap or repeat.');
  const runtimeOS=retained?item.files[0]?.record?.contract?.inputs?.os:undefined;
  if(retained&&(!runtimeOS||typeof runtimeOS.release!=='string'||typeof runtimeOS.version!=='string'))throw Error('Retained runtime pins missing.');
  const retainedBrowser=retained?item.files[0]?.record?.contract?.inputs?.runnerPins?.chrome:undefined;
  if(retained&&!/^[a-f0-9]{64}$/.test(retainedBrowser??''))throw Error('Retained browser pin missing.');
  const plans=await planFiles({kit,release,lane,execution,runtimeOS,retainedBrowser});
  if(plans.length!==local.length+remote.length||!plans.every(p=>local.includes(p.file)||remote.includes(p.file)))throw Error('Full file evidence inventory changed.');
  for(const plan of plans.filter(p=>local.includes(p.file))){
    const file=item.files.find(f=>f.file===plan.file);
    const relative=path.relative(path.join(release,'release-gate/files'),file?.filename??'');
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('File proof containment refused.');
    const proof=await verifyFilePass(file.filename,plan,{retained,allowAlways:true});
    if(digestValue(proof.record)!==digestValue(file.record))throw Error('Retained file proof changed.');
  }
  // Witnesses: local files whose verified proof comes from this release's own run.
  const phaseRunId=item.summary?.runId;
  if(typeof phaseRunId!=='string'||!phaseRunId)throw Error('Split lane run id missing.');
  const ranHere=item.files.filter(f=>f.record?.runId===phaseRunId).map(f=>f.file);
  const fresh=await verifyNeutral(item.neutral,{retained,inventory:plans.map(p=>p.file),ranHere});
  if(!fresh||digestValue(neutralIdentity(fresh.receipt))!==digestValue(neutralIdentity(item.neutral.receipt))||digestValue([...fresh.files].sort())!==digestValue([...remote].sort()))throw Error('Neutral lane identity changed.');
  if(digestValue((await planFiles({kit,release,lane,execution,runtimeOS,retainedBrowser})).map(p=>p.contract))!==digestValue(plans.map(p=>p.contract)))throw Error('Test inputs changed during lane proof verification.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help'))console.log('File lane library: release and post-merge use identical per-file contracts.');
  else {console.error('Import from release-v2.');process.exitCode=1;}
}
