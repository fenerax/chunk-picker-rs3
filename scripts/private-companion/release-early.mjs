// Ordered early checks; failure collection never starts a full lane.
import path from 'node:path';
import { cp, mkdir, rm, readFile, writeFile, lstat } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { digestValue } from './release-identity.mjs';

export const pipelineTests = ['release-pipeline-v2.test.mjs','release-runtime-v2.test.mjs','release-pack-upgrade-v2.test.mjs','release-identity-v2.test.mjs','release-admission-v2.test.mjs','release-text-v2.test.mjs','release-legacy-rollback.test.mjs','release-freeze.test.mjs','operator-frozen-bundle.test.mjs'];
// The target is five minutes; the cap is wider because, cold on the release PC
// (practice, 2026-10-19), gallery took 261-296 s, copied startup 73 s and the
// pipeline stage over 14 min with private assembly. early.json keeps each check's seconds.
export const earlyBudgetMs=30*60000;
export async function orderedEarly({ gallery, startup, pipeline, previous, budgetMs=earlyBudgetMs, now=Date.now }) {
  const start=now(),checks=[];
  for(const [name,action] of [['chrome-gallery',gallery],['copied-synthetic-startup',startup],['pipeline-integration',pipeline],['previous-failures',previous]]){
    const began=now(),remaining=budgetMs-(began-start);
    if(remaining<=0){checks.push({stage:name,passed:false,reason:'early-budget-exhausted',seconds:0});continue;}
    try{await action(remaining);checks.push({stage:name,passed:true,seconds:(now()-began)/1000});}
    catch(error){checks.push({stage:name,passed:false,seconds:(now()-began)/1000,reason:String(error.message).replace(/https?:\/\/\S+/g,'[address redacted]')});}
  }
  const result={schema:'rs3-early-v1',passed:checks.every(c=>c.passed),seconds:(now()-start)/1000,checks};
  if(!result.passed)throw Object.assign(Error('Early release checks failed: '+checks.filter(c=>!c.passed).map(c=>c.stage).join(', ')),{earlyResult:result});
  return result;
}

// Only candidate code is imported, after every persistent path is redirected.
// Generate a synthetic save, close it, copy it, then reopen the copy. No live
// save path or token is an argument or an output of this command.
export async function syntheticStartup({core,receipt,scratch}){
  if(![core,receipt,scratch].every(p=>typeof p==='string'&&path.isAbsolute(p)))throw Error('Absolute startup inputs required.');
  try{await lstat(scratch);throw Error('Startup scratch must be absent.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(scratch,{recursive:true});let app;
  try{
    const selected=JSON.parse(await readFile(receipt,'utf8'));
    if(path.resolve(selected.coreRoot)!==path.resolve(core))throw Error('Startup core differs.');
    Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_PACKS_DIR:selected.packsDir,RS3_PACK_SELECTION:path.join(selected.packsDir,'selection.json'),RS3_DATASET_PROFILE:selected.profile.path,RS3_DATASET_PROFILE_SHA256:selected.profile.sha256,RS3_PRIVATE_ADDON:selected.addons.path,RS3_PRIVATE_ADDON_SHA256:selected.addons.sha256,RS3_GAME_DATA_DIR:path.join(scratch,'game-data'),RS3_MAP_ASSETS_DIR:path.join(scratch,'map-assets'),RS3_WORKER_IDLE_MS:'20000'});
    const {createServer}=await import(pathToFileURL(path.join(core,'app/server.mjs')));
    const options={host:'127.0.0.1',port:0,loopbackPort:undefined,predictionPrewarm:false,shutdownDeadlineMs:1000,publicOrigin:undefined,privateAddonOptions:{addonPath:selected.addons.path,addonSha256:selected.addons.sha256},definitions:{chunks:{12341:{},12342:{}},challenges:{},walkableChunks:['12341','12342'],walkableChunksF2P:['12341','12342']},taskMap:{}};
    app=await createServer({...options,dataDir:path.join(scratch,'seed')});
    const before=app.store.getState();await app.close();app=null;
    await cp(path.join(scratch,'seed'),path.join(scratch,'copy'),{recursive:true,errorOnExist:true,force:false});
    app=await createServer({...options,dataDir:path.join(scratch,'copy')});
    if(digestValue(app.store.getState())!==digestValue(before))throw Error('Synthetic save changed on copied startup.');
    await app.close();app=null;
    return {schema:'rs3-copied-startup-v1',passed:true,cleanupVerified:true};
  }finally{
    try{if(app)await app.close();}finally{await rm(scratch,{recursive:true,force:true});}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help'))console.log('Usage: release-early.mjs startup --core ABS --receipt ABS --scratch ABS');
  else{
    // Do not print candidate startup diagnostics (invite URLs may be present).
    const output=process.stdout.write.bind(process.stdout);console.log=console.info=console.warn=console.error=()=>{};
    const args=process.argv.slice(3),options={};
    for(let i=0;i<args.length;i+=2){if(!['--core','--receipt','--scratch'].includes(args[i])||!args[i+1])throw Error('Startup arguments refused.');options[args[i].slice(2)]=args[i+1];}
    try{if(process.argv[2]!=='startup')throw Error('Command refused.');output(JSON.stringify(await syntheticStartup(options))+'\n');}
    catch{output(JSON.stringify({passed:false,reason:'copied-synthetic-startup-refused'})+'\n');process.exitCode=1;}
  }
}
