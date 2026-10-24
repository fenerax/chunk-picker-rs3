import {readFile} from 'node:fs/promises';
export function sampleOwned(root){
 const samples=[],errors=[];let pending=Promise.resolve(),stopped=false;
 async function visit(pid,seen=new Set()){
  if(seen.has(pid))return;seen.add(pid);
  try{
   const [stat,status,kids]=await Promise.all([readFile('/proc/'+pid+'/stat','utf8'),readFile('/proc/'+pid+'/status','utf8'),readFile('/proc/'+pid+'/task/'+pid+'/children','utf8')]);
   const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
   samples.push({atMs:performance.now(),pid,state:fields[0],ppid:Number(fields[1]),utimeTicks:Number(fields[11]),stimeTicks:Number(fields[12]),startTicks:fields[19],rssPages:Number(fields[21]),vmRSSKiB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0),threads:Number(status.match(/^Threads:\s+(\d+)/m)?.[1]??0)});
   for(const child of kids.trim().split(/\s+/).filter(Boolean))await visit(Number(child),seen);
  }catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')errors.push({pid,code:e.code??'unknown'});}
 }
 const timer=setInterval(()=>{if(!stopped)pending=pending.then(()=>visit(root));},500);
 return async()=>{stopped=true;clearInterval(timer);await pending;return {samples,errors,scope:'owned fork subtree; sampled nonatomic /proc CPU ticks and RSS; races excluded, shared pages may doublecount'};};
}
