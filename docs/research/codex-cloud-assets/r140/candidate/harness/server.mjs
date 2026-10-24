// Public-source server child. Imports are inert until explicit runtime GO.
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {captureDiagnostic,projectDiagnostic} from './diagnostic.mjs';

// Matches shipping app/server.mjs's absent-default-task handling. Pure seam.
export function initialFixtureState(createGroupState,dataset,fixture){
 const state=createGroupState(fixture.members.map(({taskStatus,...member})=>member));
 state.tasks=structuredClone(dataset.gameDefaults.tasks??[]);
 state.members.forEach((member,index)=>member.taskStatus=fixture.members[index].taskStatus);
 state.groupGoals=fixture.groupGoals;state.rules=fixture.rules;return state;
}
const send=(message,channel=process)=>new Promise((resolve,reject)=>{
 if(channel.connected===false||typeof channel.send!=='function')return reject(Error('r140-child-ipc'));
 let timer,settled=false;const done=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(Error('r140-child-ipc')):resolve();};
 timer=setTimeout(()=>done(Error('timeout')),5000);try{channel.send(message,done);}catch{done(Error('send'));}
});
export async function main(argv=process.argv.slice(2)){
 let app,early,operation='server-parse-args';
 const failed=async(error,id)=>{
  const diagnostic=projectDiagnostic(captureDiagnostic(error,operation));
  // No raw message/stack is forwarded. The session preserves this closed object.
  await send({type:'failed',...(id===undefined?{}:{id}),diagnostic});
 };
 try{
  const {root,scratch,fixture,go}=JSON.parse(argv[0]);
  if(go!=='R140-unshaped30'||root!=='/source'||typeof scratch!=='string'||!scratch.startsWith('/scratch/r140-session-unshaped-v1-')||!path.isAbsolute(fixture))throw Error('r140-runtime-identity');
  operation='server-environment';
  for(const key of Object.keys(process.env))if(key.startsWith('RS3_'))delete process.env[key];
  for(const name of ['packs','map','game','images'])await mkdir(scratch+'/empty/'+name,{recursive:true});
  operation='server-fixture';const f=JSON.parse(await readFile(fixture));
  await writeFile(scratch+'/defaults.json',JSON.stringify({members:f.members.map(({id,name})=>({id,name})),masterLabel:f.members[0].name}));
  Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_GAME_DEFAULTS_FILE:scratch+'/defaults.json',RS3_PACKS_DIR:scratch+'/empty/packs',RS3_PACK_SELECTION:scratch+'/empty/selection.json',RS3_MAP_ASSETS_DIR:scratch+'/empty/map',RS3_GAME_DATA_DIR:scratch+'/empty/game'});
  operation='server-provider-import';const {selectedDataset:dataset}=await import(pathToFileURL(root+'/app/dataset-runtime.mjs'));
  operation='server-provider-admit';if(dataset.datasetId!=='duo-legacy')throw Error('wrong public provider');
  operation='server-module-import';const {startServer}=await import(pathToFileURL(root+'/app/server.mjs'));
  operation='server-state-import';const {createGroupState}=await import(pathToFileURL(root+'/app/core/state.mjs'));
  async function start(initialState){
   operation='server-start-handle';early=await startServer({dataset,privateAddonOptions:{},worldImagesRoot:scratch+'/empty/images',dataDir:scratch+'/store',initialState,host:'127.0.0.1',port:0,loopbackPort:undefined,publicOrigin:undefined});
   operation='server-ready';app=await early.ready;
   operation='server-address';return{origin:`http://127.0.0.1:${app.address().port}`,token:app.store.getAccessToken()};
  }
  operation='server-fixture-state';let state;
  try{await readFile(scratch+'/store/state.json');}catch{state=initialFixtureState(createGroupState,dataset,f);}
  const info=await start(state);await send({type:'ready',...info});
  process.on('message',async msg=>{try{
   if(msg.type==='snapshot'){operation='server-snapshot';await send({type:'snapshot',id:msg.id,state:app.store.getState()});}
   if(msg.type==='metrics'){operation='server-metrics';await send({type:'metrics',id:msg.id,revision:app.store.getInfo().revision,heap:process.memoryUsage(),streams:'not sampled server-side; use strict CDP ledger',workerMode:process.env.RS3_TASK_WORKER_MODE??'shipping-default'});}
   if(msg.type==='restart'){operation='server-restart';await app.close();const next=await start();await send({type:'restarted',id:msg.id,...next,state:app.store.getState()});}
   if(msg.type==='stop'){operation='server-close';await app.close();process.exitCode=0;process.disconnect();}
  }catch(error){await failed(error,msg.id);}});
  process.once('disconnect',async()=>{await app.close();});
 }catch(error){
  process.exitCode=1;try{await failed(error);}finally{try{await(app??early)?.close();}finally{if(process.connected)process.disconnect();}}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
