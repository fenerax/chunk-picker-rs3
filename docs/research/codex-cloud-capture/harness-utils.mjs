import fs from 'node:fs/promises';
import {fsyncSync,openSync,closeSync,writeSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const FIXTURE_SHA='380ffb698ea594ccb1d375321708a4369f50da82fdc796fd91a4a8c8038b8022';
export const STAGES=new Set(['start','reference-start','reference-ready','reference-result','reference-close',
  'measured-start','measured-ready','browser-ready','overlay-ready','episode-start','episode-end',
  'calibration-start','calibration-end','cleanup-start','cleanup-end','result','error']);
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function ownedPath(root,target){
  const base=path.resolve(root),absolute=path.resolve(target),relative=path.relative(base,absolute);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('PATH_NOT_OWNED');
  return absolute;
}
export function parseArgs(args,env=process.env){
  const options={};
  for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]==null||args[i+1].startsWith('--'))throw Error('INVALID_ARGUMENTS');options[args[i].slice(2)]=args[i+1];}
  const allowed=new Set(['source','scratch','deps','member','group','chunk','startup','out','expected-source-pin','source-lock','expected-chromium']);
  if(Object.keys(options).some(key=>!allowed.has(key)))throw Error('UNKNOWN_ARGUMENT');
  options.source??=env.PERF_SOURCE_ROOT;options.scratch??=env.PERF_OUTPUT_ROOT;options.deps??='/deps';
  options.member??='explorer-1';options.group??='false';options.chunk??='12850';options.startup??='immediate';
  options.out??=env.PERF_CASE_RESULT;options['expected-source-pin']??=PIN;options['expected-chromium']??='151.0.7922.34';
  if(!options.source||!options.scratch||!options.out||options.member!=='explorer-1'||options.group!=='false'||options.chunk!=='12850'||options.startup!=='immediate')throw Error('UNSUPPORTED_ONE_CASE');
  if(!/^[a-f0-9]{40}$/.test(options['expected-source-pin']))throw Error('INVALID_EXPECTED_SOURCE_PIN');
  options.out=ownedPath(options.scratch,options.out);
  return options;
}
export function checkpoints(filename,stageFd=process.env.PERF_STAGE_FD){
  const fd=openSync(filename,'a',0o600);let sequence=0,closed=false;
  const emit=(stage,fields={})=>{
    if(!STAGES.has(stage))throw Error('UNKNOWN_STAGE');
    const row={sequence:++sequence,stage,utc:new Date().toISOString(),nodeMonotonicMs:performance.now(),...fields};
    writeSync(fd,JSON.stringify(row)+'\n');fsyncSync(fd);
    if(stageFd==='3')writeSync(3,JSON.stringify({stage})+'\n');
  };
  emit.close=()=>{if(!closed){closed=true;closeSync(fd);}};return emit;
}
export async function bounded(promise,ms,code){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}
  finally{clearTimeout(timer);}
}
export async function until(fn,ms=30000,code='PREDICATE_TIMEOUT'){
  const end=performance.now()+ms;while(performance.now()<end){const value=await fn();if(value)return value;await sleep(20);}throw Error(code);
}
export async function treeManifest(root,{exclude=new Set(['.git'])}={}){
  const files=[];
  async function visit(directory,relative=''){
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      if(exclude.has(entry.name)&&!relative)continue;
      const name=relative?relative+'/'+entry.name:entry.name,target=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw Error('SOURCE_SYMLINK_UNSUPPORTED');
      if(entry.isDirectory())await visit(target,name);
      else if(entry.isFile()){const bytes=await fs.readFile(target);files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
      else throw Error('SOURCE_SPECIAL_FILE_UNSUPPORTED');
    }
  }
  await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {files,sha256:sha(JSON.stringify(files))};
}
export async function verifySource(root,expectedPin,lockFile){
  const actual=await treeManifest(root);
  let origin;
  if(lockFile){
    const lock=JSON.parse(await fs.readFile(lockFile,'utf8'));
    if(lock.sourceCommit!==expectedPin||lock.manifestSha256!==actual.sha256)throw Error('SOURCE_LOCK_MISMATCH');
    origin='independent-source-lock';
  }else{
    const git=argv=>spawnSync('git',['-c',`safe.directory=${root}`,'-C',root,...argv],{encoding:'utf8',timeout:15000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
    const head=git(['rev-parse','HEAD']);if(head.status!==0||head.stdout.trim()!==expectedPin)throw Error('EXPECTED_GIT_SOURCE_REQUIRED');
    if(git(['diff','--no-ext-diff','--quiet','HEAD','--']).status!==0)throw Error('SOURCE_TRACKED_CHANGE');
    for(const flags of [['--others','--exclude-standard'],['--others','--ignored','--exclude-standard']]){
      const extra=git(['ls-files',...flags]);if(extra.status!==0||extra.stdout.trim())throw Error('SOURCE_UNTRACKED_CHANGE');
    }
    origin='expected-clean-git-commit';
  }
  const criticalNames=['app/server.mjs','app/storage/store.mjs','app/datasets.mjs','app/dataset-runtime.mjs','app/core/state.mjs','app/private-addon.mjs'];
  const criticalFiles=Object.fromEntries(criticalNames.map(name=>{const found=actual.files.find(f=>f.path===name);if(!found)throw Error('SOURCE_ANCHOR_MISSING');return [name,found.sha256];}));
  return {schemaVersion:1,sourceCommit:expectedPin,manifestSha256:actual.sha256,criticalFiles,files:actual.files,verification:origin};
}
export async function verifyHarness(root){
  const bytes=await fs.readFile(path.join(root,'harness-manifest.json'));
  const lock=JSON.parse(bytes);
  if(lock.schemaVersion!==1||!Array.isArray(lock.files))throw Error('HARNESS_LOCK_REQUIRED');
  for(const file of lock.files){const target=ownedPath(root,path.join(root,file.path));if(sha(await fs.readFile(target))!==file.sha256)throw Error('HARNESS_HASH_MISMATCH');}
  return sha(bytes);
}
export function sanitizePath(url){
  try{const u=new URL(url);if(/^\/join\//.test(u.pathname))return '/join/[redacted]';if(/^\/overlay\//.test(u.pathname))return '/overlay/[redacted]';return u.pathname.replace(/([A-Za-z0-9_-]{32,})/g,'[redacted]');}catch{return '[invalid-url]';}
}
export function classifyObservedWrites(requests){
  const semanticWriteAttempts=[],unclassifiedWrites=[],observedMetadataWrites=[];
  for(const request of requests){
    if(['GET','HEAD','OPTIONS'].includes(request.method))continue;
    if(request.method==='POST'&&request.path==='/api/action-session'&&request.bodyKeys?.length&&
       request.bodyKeys.includes('clientId')&&request.bodyKeys.every(k=>['clientId','acknowledge'].includes(k))&&
       request.status>=200&&request.status<300){
      observedMetadataWrites.push({...request,classification:'source-proven-action-receipt-only',source:'app/server.mjs:1644;app/storage/store.mjs:1170'});continue;
    }
    if(['/api/command','/api/import','/api/restore','/api/member-restore','/api/runemetrics/apply','/api/game-plugin/apply','/api/worker-restart','/api/shutdown'].includes(request.path))semanticWriteAttempts.push(request);
    else unclassifiedWrites.push(request);
  }
  return {semanticWriteAttempts,unclassifiedWrites,observedMetadataWrites};
}
