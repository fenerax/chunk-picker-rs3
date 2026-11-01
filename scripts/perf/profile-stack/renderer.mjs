// Reconstruct complete duration and B/E events, restricted to CrRendererMain.
// Empty trace intervals are not presumed idle. Idle must be an observed task.
export function durations(events) {
  const result = [], stacks = new Map();
  for (const e of [...events].sort((a,b)=>(a.ts??0)-(b.ts??0))) {
    const key = `${e.pid}:${e.tid}`;
    if (e.ph === 'X' && e.dur >= 0) result.push(e);
    else if (e.ph === 'B') { const stack=stacks.get(key)??[];stack.push(e);stacks.set(key,stack); }
    else if (e.ph === 'E') { const begin=stacks.get(key)?.pop();if(begin)result.push({...begin,ph:'X',dur:e.ts-begin.ts}); }
  }
  return result;
}
export function rendererSpans(events, { start, end, offset = 0, profileId, inputs = [] }) {
  const threads = new Set(events.filter(e=>e.ph==='M'&&e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>`${e.pid}:${e.tid}`));
  if (!threads.size) return { spans: [], status: 'Renderer main thread metadata absent; no inferred coverage' };
  const rows = durations(events).filter(e=>threads.has(`${e.pid}:${e.tid}`)&&e.dur>0).map(e=>({...e,start:e.ts/1000+offset,end:(e.ts+e.dur)/1000+offset})).filter(e=>e.end>start&&e.start<end);
  const taskName = /^(?:RunTask|ThreadControllerImpl::RunTask|TaskQueueManager::ProcessTaskFromWorkQueue)$/;
  const tasks = rows.filter(e=>taskName.test(e.name));
  const classify=e=>{
    if(/(?:MajorGC|MinorGC|GCEvent|V8\.GC|GarbageCollect)/i.test(e.name))return 'gc';
    if(/(?:RecalculateStyles|UpdateLayoutTree)/.test(e.name))return 'style';
    if(e.name==='Layout')return 'layout';
    if(/(?:Paint|Raster|CompositeLayers|Commit)/.test(e.name))return 'paint';
    if(/IdleTask|IdleCallback/.test(e.name))return 'idle';
    if(/FunctionCall|EvaluateScript|RunMicrotasks|V8.Execute|ParseHTML|CompileScript/.test(e.name))return 'script';
  };
  const spans=[];let sequence=0;
  for(const task of tasks) {
    const a=Math.max(start,task.start),b=Math.min(end,task.end);
    const nested=rows.filter(e=>e.start>=task.start&&e.end<=task.end&&classify(e));
    const points=[...new Set([a,b,...inputs.filter(s=>s.start>a&&s.start<b).map(s=>s.start),...nested.flatMap(e=>[Math.max(a,e.start),Math.min(b,e.end)]).filter(t=>t>=a&&t<=b)])].sort((x,y)=>x-y);
    for(let i=1;i<points.length;i++) {
      const x=points[i-1],y=points[i];if(y<=x)continue;
      const rank=e=>classify(e)==='gc'?0:['style','layout','paint'].includes(classify(e))?1:2;
      const containing=nested.filter(e=>e.start<=x&&e.end>=y);
      let event=containing.sort((p,q)=>rank(p)-rank(q)||(p.end-p.start)-(q.end-q.start))[0];
      if(event&&classify(event)==='script')event=containing.filter(e=>classify(e)==='script').sort((p,q)=>(q.end-q.start)-(p.end-p.start))[0];
      const category=event?classify(event):'other',data=event?.args?.data??{};
      const source=data.url||data.scriptName;let script=source;try{if(source)script=new URL(source).pathname;}catch{}
      const label=category==='script'?(data.functionName||script||event.name):category==='other'?task.name:category;
      const owner=[...inputs].filter(s=>s.start<=x).sort((p,q)=>q.start-p.start)[0]?.profileId??profileId;
      const previous=spans.at(-1),name=`main.${category}${category==='script'||category==='other'?':'+label:''}`;
      if(previous?.name===name&&previous.end===x&&previous.profileId===owner)previous.end=y;
      else spans.push({kind:'span',id:`${profileId}:renderer:${++sequence}`,profileId:owner,layer:'browser',processId:`chrome:${task.pid}:${task.tid}`,name,start:x,end:y,category,traceCategory:task.cat,topLevelTask:task.name,attribution:'observed-renderer-task/latest-input'});
    }
  }
  return { spans, status: `${threads.size} renderer main thread(s); ${tasks.length} observed top-level tasks` };
}
