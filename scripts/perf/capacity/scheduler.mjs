// Arrival times depend only on the profile and seed, never on completions.
import { random } from './model.mjs';
export function arrivals(stages, seed, streams) {
  const rng=random(seed), events=[]; let base=0;
  for(const [stageIndex,stage] of stages.entries()) {
    if (!Number.isFinite(stage.seconds) || stage.seconds <= 0) throw new TypeError('Invalid stage duration.');
    for(const [kind,rate] of Object.entries(streams(stage))) {
      if (!Number.isFinite(rate) || rate<0) throw new TypeError('Invalid arrival rate.');
      if(!rate) continue;
      // Stratified jitter: the long-term rate remains exact, without bursts on a second boundary.
      for(let i=0;i<Math.floor(stage.seconds*rate);i++) events.push({atMs:base+(i+rng())*1000/rate,kind,stage:stageIndex,ordinal:i});
    }
    base+=stage.seconds*1000;
  }
  return events.sort((a,b)=>a.atMs-b.atMs);
}
// A resource window is eligible only when it lies wholly inside one stage.
export function stageWindow(stages, start, from, to=from) {
  let boundary=start;
  for(const [stage,s] of stages.entries()) {
    const end=boundary+s.seconds*1000;
    if(to>=boundary && to<end) return {stage,classification:s.classification,measured:!!s.measured && from>=boundary};
    boundary=end;
  }
  return {stage:null,classification:null,measured:false};
}
export async function dispatch(events, run, { now=()=>performance.now(), startAt=now(), timer=setTimeout, maxInFlight=10000, onDrop=()=>{} }={}) {
  const start=startAt, pending=new Set(); let index=0;
  while(index<events.length) {
    const wait=events[index].atMs-(now()-start);
    if(wait>0) { await new Promise(resolve=>timer(resolve,Math.min(wait,1000))); continue; }
    do {
      const event={...events[index++],scheduledAt:start+events[index-1].atMs};
      if(pending.size>=maxInFlight) onDrop(event);
      else {
        let job;
        try { job=Promise.resolve(run(event)); } catch(error) { job=Promise.reject(error); }
        pending.add(job);
        job.then(()=>pending.delete(job),()=>pending.delete(job));
      }
    } while(index<events.length && events[index].atMs<=now()-start);
  }
  await Promise.allSettled(pending);
}
