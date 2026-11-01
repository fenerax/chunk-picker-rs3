#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stats,summarize,html} from './report.mjs';
const output=path.resolve(process.argv[2]??'.local/profile-stack-comparison');await mkdir(output,{recursive:true});
const reports={off:[],spans:[],full:[]},orders=[];
for(let pair=0;pair<5;pair++){
 const order=pair%2?['full','spans','off']:['off','spans','full'];orders.push(order);
 for(const mode of order){
  const out=path.join(output,`${pair+1}-${mode}`),log=await open(path.join(output,`${pair+1}-${mode}.log`),'w');
  console.log(`Browser pair ${pair+1}/5 ${mode}`);
  try{
   const child=spawn(process.execPath,[fileURLToPath(new URL('../profile-stack.mjs',import.meta.url)),'--scenario','all','--runs','1','--profile',mode==='off'?'off':'on',...(mode==='full'?['--cpu','--trace']:[]),'--out',out],{stdio:['ignore',log.fd,log.fd]});
   const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw Error(`Browser pair ${pair+1} ${mode} failed; see its log`);
  }finally{await log.close();}
  const original=JSON.parse(await readFile(path.join(out,'profile.json')));
  const report=JSON.parse(JSON.stringify(original,(key,value)=>['id','profileId','parentId','scenario'].includes(key)&&typeof value==='string'&&value.startsWith('r1.')?`r${pair+1}.`+value.slice(3):value));
  for(const c of report.clicks){c.run=pair+1;for(const i of c.interactions)i.spans=i.spans.map(id=>id.startsWith('r1.')?`r${pair+1}.`+id.slice(3):id);}
  for(const clock of report.clocks)clock.run=pair+1;
  for(const event of report.startupEvents??[])event.run=pair+1;
  reports[mode].push(report);
 }
}
for(const mode of ['off','spans','full']){
 const report={...reports[mode][0],clicks:reports[mode].flatMap(r=>r.clicks),clocks:reports[mode].flatMap(r=>r.clocks),runDurationsMs:reports[mode].flatMap(r=>r.runDurationsMs),startupEvents:reports[mode].flatMap(r=>r.startupEvents??[])};report.summary=summarize(report.clicks);report.comparisonOrder=orders;
 const dir=path.join(output,mode);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'profile.json'),JSON.stringify(report));
 await writeFile(path.join(dir,'report.html'),html({...report,clicks:report.clicks.map(c=>({...c,cpu:c.cpu.map(v=>v.top),traceEvents:undefined}))}));
}
const summary=reports.full[0].summary.map(s=>{
 const values=mode=>reports[mode].map(r=>r.clicks.find(c=>c.scenario===s.scenario).summary.wallMs);
 const off=stats(values('off')),spans=stats(values('spans')),full=stats(values('full'));
 return {scenario:s.scenario,off,spans,full,spansVsOffPercent:(spans.median/off.median-1)*100,fullVsSpansPercent:(full.median/spans.median-1)*100,
   fullMinusSpansMs:stats(values('full').map((v,i)=>v-values('spans')[i]))};
});
const totalRunMs=Object.fromEntries(['off','spans','full'].map(mode=>[mode,stats(reports[mode].flatMap(r=>r.runDurationsMs))]));
await writeFile(path.join(output,'comparison.json'),JSON.stringify({orders,summary,totalRunMs},null,2));console.log(JSON.stringify({summary,totalRunMs}));
