// R37 child adapter, normal current shipping startServer path. RUNTIME ONLY.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const {root,scratch,fixture,go}=JSON.parse(process.argv[2]);
if(go!=='R111-current30')throw Error('runtime GO required before provider import');
for(const k of Object.keys(process.env))if(k.startsWith('RS3_'))delete process.env[k];
for(const name of ['packs','map','game','images'])await mkdir(scratch+'/empty/'+name,{recursive:true});
const f=JSON.parse(await readFile(fixture));
await writeFile(scratch+'/defaults.json',JSON.stringify({members:f.members.map(({id,name})=>({id,name})),masterLabel:f.members[0].name}));
Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_GAME_DEFAULTS_FILE:scratch+'/defaults.json',RS3_PACKS_DIR:scratch+'/empty/packs',RS3_PACK_SELECTION:scratch+'/empty/selection.json',RS3_MAP_ASSETS_DIR:scratch+'/empty/map',RS3_GAME_DATA_DIR:scratch+'/empty/game'});
const {selectedDataset:dataset}=await import(pathToFileURL(root+'/app/dataset-runtime.mjs'));
if(dataset.datasetId!=='duo-legacy')throw Error('wrong public provider');
const {startServer}=await import(pathToFileURL(root+'/app/server.mjs'));
let app;const streams=new Set();
async function start(initialState){
 const handle=await startServer({dataset,privateAddonOptions:{},worldImagesRoot:scratch+'/empty/images',dataDir:scratch+'/store',initialState,host:'127.0.0.1',port:0,loopbackPort:undefined,publicOrigin:undefined});app=await handle.ready;
 return {origin:`http://127.0.0.1:${app.address().port}`,token:app.store.getAccessToken()};
}
try{
 const {createGroupState}=await import(pathToFileURL(root+'/app/core/state.mjs'));let state;
 try{await readFile(scratch+'/store/state.json');}catch{state=createGroupState(f.members.map(({taskStatus,...m})=>m));state.tasks=structuredClone(dataset.gameDefaults.tasks);state.members.forEach((m,i)=>m.taskStatus=f.members[i].taskStatus);state.groupGoals=f.groupGoals;state.rules=f.rules;}
 const info=await start(state);process.send({type:'ready',...info});
 process.on('message',async msg=>{try{
  if(msg.type==='snapshot')process.send({type:'snapshot',id:msg.id,state:app.store.getState()});
  if(msg.type==='metrics')process.send({type:'metrics',id:msg.id,revision:app.store.getInfo().revision,heap:process.memoryUsage(),streams:'not sampled server-side; use strict CDP ledger',workerMode:process.env.RS3_TASK_WORKER_MODE??'shipping-default'});
  if(msg.type==='restart'){await app.close();const next=await start();process.send({type:'restarted',id:msg.id,...next,state:app.store.getState()});}
  if(msg.type==='stop'){await app.close();process.exitCode=0;process.disconnect();}
 }catch(e){process.send({type:'failed',id:msg.id,message:e.message});}});
 process.once('disconnect',async()=>{await app.close();});
}catch(e){process.send({type:'failed',message:e.message});await app?.close();process.exitCode=1;}
