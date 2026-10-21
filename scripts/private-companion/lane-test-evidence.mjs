// Whole-input observations complement (and never relax) the static file model.
import path from 'node:path';
import os from 'node:os';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { digestValue, hashTree } from './release-identity.mjs';
import { gateContract, gatePolicy, atomicJSON, hashFile } from './release-evidence.mjs';
import { regularInput, verifyFilePass } from './file-test-evidence.mjs';

export const laneEvidencePolicy = Object.freeze({schema:'rs3-whole-lane-policy-v1',maxAgeMs:7*86400000,peers:'completed-full-named-failures-only',browser:'conservative-all-full-lanes'});
// Seven days matches existing gate/file observations. It bounds environmental
// drift without changing the indefinite authority of a retained rollback copy.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = () => ({release:os.release(),version:os.version(),platform:process.platform,arch:process.arch,nodeVersion:process.version});
const validLane = lane => {if(!['public-full','private-full'].includes(lane))throw Error('Unknown whole test lane.');};
const relative = name => {if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||/[:\x00-\x1f]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Pack path refused.');return name;};

/** Hash actual bytes, not manifest claims or commit labels. No source root path
 * enters the key. Broad private/packs pins intentionally also invalidate public
 * observations: full-lane reuse makes no per-file independence assertion. */
export async function planLaneEvidence({kit,release,lane,execution,plans,runtimeOS,retainedBrowser,retainedWrapper}) {
  validLane(lane);
  const companion=JSON.parse(await regularInput(path.join(release,'companion.json')));
  const kitManifest=JSON.parse(await regularInput(path.join(kit,'kit.json')));
  const core=await hashTree(path.join(release,'core'));
  const privateSource=await hashTree(path.join(kit,'checks/private-source'));
  const packsRoot=companion.packsDir??path.join(kit,'packs');
  const packs=await hashTree(packsRoot);
  const selection=JSON.parse(await regularInput(path.join(packsRoot,'selection.json')));
  const payloads=[];
  for(const kind of ['data','rulesText','art']) {
    const choice=selection[kind];
    const root=path.join(packsRoot,relative(choice.id),relative(choice.version));
    const bytes=await regularInput(path.join(root,'pack.json'));
    if(sha(bytes)!==choice.sha256)throw Error('Whole lane pack manifest changed.');
    for(const file of JSON.parse(bytes).files) {
      const bytes=await regularInput(path.join(root,relative(file.path)));
      if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Whole lane pack payload changed.');
      payloads.push({kind,path:file.path,bytes:bytes.length,sha256:sha(bytes)});
    }
  }
  const text=[];
  for(const input of companion.textOverrides??[]) {
    if(!['app/data/changelog.json','app/data/roadmap.json'].includes(input.path))throw Error('Whole lane text path refused.');
    const bytes=await regularInput(input.source);
    if(sha(bytes)!==input.sha256)throw Error('Whole lane release text changed.');
    text.push({path:input.path,sha256:sha(bytes)});
  }
  const tooling={};
  tooling.tree=(await hashTree(path.join(kit,'tools'))).digest;
  tooling.operatorTree=(await hashTree(path.join(kit,'operator'))).digest;
  tooling.heavyWrapper=retainedWrapper??await hashFile(kitManifest.locks?.heavy?.path??path.join(kit,'operator/with-heavy.ps1'));
  if(!retainedWrapper&&kitManifest.locks?.heavy?.sha256&&tooling.heavyWrapper!==kitManifest.locks.heavy.sha256)throw Error('Whole lane heavy wrapper changed.');
  for(const name of ['file-test-evidence.mjs','file-test-lane.mjs','lane-test-evidence.mjs','release-identity.mjs','release-evidence.mjs','companion-check.mjs'])tooling[name]=await hashFile(path.join(kit,'tools',name));
  tooling.adaptive=await hashFile(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'));
  // All current files can be opaque. Until a reviewed browser-independent lane
  // exists, both full lanes may launch Chrome through arbitrary test helpers.
  tooling.chrome=retainedBrowser??await hashFile(kitManifest.browser?.path??'C:/Program Files/Google/Chrome/Application/chrome.exe');
  const files=plans?.map(p=>p.file).sort()??[...new Set([...core.files,...(lane==='private-full'?privateSource.files:[])].map(f=>f.path).filter(f=>/^tests\/[^/]+\.test\.mjs$/.test(f)))].sort();
  if(!files.length)throw Error('Empty whole lane inventory refused.');
  return gateContract(lane,{schema:'rs3-whole-lane-input-v1',core:core.digest,privateSource:privateSource.digest,packs:packs.digest,payloads,text:text.sort((a,b)=>a.path.localeCompare(b.path)),tooling,files,os:runtimeOS??runtime(),policy:laneEvidencePolicy,gatePolicy},execution);
}
export const laneEvidenceFilename = (directory,contract) => path.join(directory,'lanes',contract.lane+'-'+contract.key+'.json');
const inside = (directory,filename) => {const rel=path.relative(directory,filename??'');return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};

export async function verifyLaneEvidence(filename,contract,{retained=false}={}) {
  validLane(contract.lane);
  const record=JSON.parse(await regularInput(filename));
  const {digest,...body}=record;
  const started=Date.parse(record.startedAt),completed=Date.parse(record.completedAt),now=Date.now();
  if(record.schema!=='rs3-whole-lane-observation-v1'||digest!==digestValue(body)||digestValue(record.contract)!==digestValue(contract)
    ||record.completed!==true||record.cleanupVerified!==true||!['passed','failed'].includes(record.status)
    ||!Array.isArray(record.files)||!Array.isArray(record.failures)||!record.runId||!record.command
    ||record.cleanup?.runId!==record.runId||record.cleanup?.verified!==true||record.cleanup?.completedAt!==record.completedAt||!record.cleanup?.command
    ||!Number.isFinite(started)||!Number.isFinite(completed)||completed<started||completed>now||!retained&&now-completed>laneEvidencePolicy.maxAgeMs)throw Error('Whole lane observation missing, stale or changed.');
  const names=record.files.map(f=>f.file).sort(),failures=record.files.filter(f=>f.passed===false).map(f=>f.file).sort();
  if(digestValue(names)!==digestValue(contract.inputs.files)||new Set(names).size!==names.length
    ||record.files.some(f=>typeof f.passed!=='boolean'||!f.runId||!f.completedAt||!f.command)
    ||digestValue(failures)!==digestValue(record.failures)||record.status!==(failures.length?'failed':'passed'))throw Error('Whole lane completion inventory changed.');
  // Each reusable peer must also retain its original, independently verified
  // file proof. A lane record alone cannot manufacture a passing file result.
  for(const file of record.files.filter(f=>f.passed)) {
    const plan=file.plan;
    if(!plan||plan.file!==file.file||plan.contract?.inputs?.file!==file.file||plan.contract?.lane!=='file-'+contract.lane
      ||plan.contract.executionDigest!==contract.executionDigest
      ||digestValue(plan.contract)!==digestValue(gateContract('file-'+contract.lane,plan.contract.inputs,contract.execution))
      ||plan.contract.inputs.os?.release!==contract.inputs.os.release||plan.contract.inputs.os?.version!==contract.inputs.os.version
      ||plan.contract.inputs.runnerPins?.chrome!==contract.inputs.tooling.chrome
      ||plan.contract.inputs.runnerPins?.lane!==contract.inputs.tooling['file-test-lane.mjs']
      ||plan.contract.inputs.runnerPins?.evidence!==contract.inputs.tooling['file-test-evidence.mjs']
      ||plan.contract.inputs.runnerPins?.runner!==contract.inputs.tooling.adaptive)throw Error('Whole lane recorded file plan changed.');
    if(!file.proof||!inside(path.dirname(filename),file.proof.filename))throw Error('Whole lane file proof containment refused.');
    const proof=await verifyFilePass(file.proof.filename,file.plan,{retained,allowAlways:true});
    if(file.file!==file.plan.file||digestValue(proof.record)!==digestValue(file.proof.record))throw Error('Whole lane file proof changed.');
  }
  return {filename,record,reused:true};
}
export async function lookupLaneEvidence(directory,contract,options={}) {
  const filename=laneEvidenceFilename(directory,contract);
  let pending;
  try {
    pending=JSON.parse(await regularInput(filename+'.pending.json'));
    if(pending.schema!=='rs3-whole-lane-pending-v1'||pending.key!==contract.key||!pending.runId||!pending.command||!Number.isFinite(Date.parse(pending.startedAt)))return {item:null,reason:'whole-lane-pending-invalid'};
  }catch(error){if(error.code!=='ENOENT')return {item:null,reason:'whole-lane-pending-invalid'};}
  try{
    const item=await verifyLaneEvidence(filename,contract,options);
    if(pending&&Date.parse(pending.startedAt)>=Date.parse(item.record.startedAt))return {item:null,reason:'whole-lane-pending'};
    return {item,reason:null};
  }
  catch(error){return {item:null,reason:pending?'whole-lane-pending':error.code==='ENOENT'?'whole-lane-missing':'whole-lane-invalid: '+error.message};}
}
export async function readLaneEvidence(directory,contract,options) {return (await lookupLaneEvidence(directory,contract,options)).item;}
export async function beginLaneAttempt(directory,contract,{runId,startedAt,command}) {
  await atomicJSON(laneEvidenceFilename(directory,contract)+'.pending.json',{schema:'rs3-whole-lane-pending-v1',key:contract.key,runId,startedAt,command});
}
export async function finishLaneAttempt(directory,contract,runId) {
  const filename=laneEvidenceFilename(directory,contract)+'.pending.json';
  try{const pending=JSON.parse(await regularInput(filename));if(pending.runId===runId)await unlink(filename);}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function publishLaneEvidence(directory,contract,{startedAt,runId,command,files,failures}) {
  const filename=laneEvidenceFilename(directory,contract),proofDirectory=path.join(path.dirname(filename),'files');
  await mkdir(proofDirectory,{recursive:true});
  const retained=[];
  for(const file of files) {
    if(!file.passed){retained.push(file);continue;}
    const proof={...file.proof,filename:path.join(proofDirectory,path.basename(file.proof.filename))};
    await atomicJSON(proof.filename,proof.record);
    retained.push({...file,proof});
  }
  const completedAt=new Date().toISOString();
  const cleanup={runId,completedAt,command:{operation:'execute-selection-finally',roots:['assembly','home','temp','compile-cache']},verified:true};
  const body={schema:'rs3-whole-lane-observation-v1',contract,completed:true,cleanupVerified:true,cleanup,status:failures.length?'failed':'passed',failures:[...failures].sort(),files:retained.sort((a,b)=>a.file.localeCompare(b.file)),startedAt,completedAt,runId,command};
  const record={...body,digest:digestValue(body)};
  try{await regularInput(filename);await rename(filename,filename+'.rejected-'+randomUUID());}catch(error){if(error.code!=='ENOENT')throw error;}
  await atomicJSON(filename,record);
  return {...await verifyLaneEvidence(filename,contract),reused:false};
}
export async function retainLaneEvidence(item,directory) {
  const filename=path.join(directory,path.basename(item.filename)),files=[];
  for(const file of item.record.files) {
    if(!file.passed){files.push(file);continue;}
    const proof={...file.proof,filename:path.join(directory,'files',path.basename(file.proof.filename))};
    await atomicJSON(proof.filename,proof.record);files.push({...file,proof});
  }
  const {digest,...old}=item.record,body={...old,files},record={...body,digest:digestValue(body)};
  await atomicJSON(filename,record);
  return {filename,record,reused:item.reused};
}
