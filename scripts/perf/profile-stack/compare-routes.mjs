#!/usr/bin/env node
// Equivalent synthetic route observer for paired START/off measurements.
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../profile-stack.mjs';
import {stopChild} from '../cdp.mjs';
import {stats} from './report.mjs';
import {bootstrapPaired} from './bootstrap-stats.mjs';
const [baseline,out]=process.argv.slice(2);
if(!baseline||!out)throw Error('Usage: compare-routes.mjs START_WORKTREE OUTPUT_DIRECTORY');
const pairs=Number(process.argv[4]??20);if(!Number.isInteger(pairs)||pairs<20)throw Error('At least 20 pairs required');
const branch=fileURLToPath(new URL('../../../',import.meta.url)),rows=[];
async function sample(root){
 const scratch=await mkdtemp('/tmp/rs3-stack-route-');let server;
 try{
  const startupStarted=performance.now();server=await startServer({root,profile:false},scratch);const startupMs=performance.now()-startupStarted;const url=new URL(server.inviteUrl),token=url.pathname.slice('/join/'.length);
  const metrics=[{name:'startup',ms:startupMs}];
  async function request(name,route){const at=performance.now();const r=await fetch(url.origin+route,{headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'gzip'}});await r.arrayBuffer();if(!r.ok)throw Error('Route failed');if(name)metrics.push({name,ms:performance.now()-at});}
  await request('cold-tasks','/api/tasks?memberId=player1&view=play-v1');
  for(let i=0;i<30;i++){await request(null,'/api/state?view=play-v1');await request(null,'/api/tasks?memberId=player1&view=play-v1');}
  for(let i=0;i<100;i++){
   await request('warm-state','/api/state?view=play-v1');
   await request('warm-tasks','/api/tasks?memberId=player1&view=play-v1');
  }
  const memory=await server.rpc('sample');
  return{metrics,rssBytes:memory.rssBytes};
 }finally{if(server){try{await server.rpc('stop-server');}catch{}await stopChild(server.child);}await rm(scratch,{recursive:true,force:true});}
}
await mkdir(out,{recursive:true});
for(let pair=0;pair<pairs;pair++){
 const order=pair%2?['branch','START']:['START','branch'];
 for(const variant of order){console.log(`Route pair ${pair+1}/${pairs} ${variant}`);rows.push({pair,variant,...await sample(variant==='START'?path.resolve(baseline):branch)});await writeFile(path.join(out,'routes.json'),JSON.stringify({rows}));}
}
const summary=['START','branch'].map(variant=>({variant,phases:['startup','cold-tasks','warm-state','warm-tasks'].map(name=>({name,...stats(rows.filter(r=>r.variant===variant).map(r=>stats(r.metrics.filter(m=>m.name===name).map(m=>m.ms)).median))})),rssBytes:stats(rows.filter(r=>r.variant===variant).map(r=>r.rssBytes))}));
const paired=['startup','cold-tasks','warm-state','warm-tasks'].map(name=>{const median=r=>stats(r.metrics.filter(m=>m.name===name).map(m=>m.ms)).median;const differences=Array.from({length:pairs},(_,pair)=>median(rows.find(r=>r.pair===pair&&r.variant==='branch'))-median(rows.find(r=>r.pair===pair&&r.variant==='START')));return{name,...bootstrapPaired(differences)};});
await writeFile(path.join(out,'routes.json'),JSON.stringify({node:process.version,pairs,warmup:30,samplesPerProcess:100,rows,summary,paired},null,2));console.log(JSON.stringify({summary,paired}));
