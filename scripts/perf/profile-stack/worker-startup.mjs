// Expand only observed spawn-to-ready waits, using numeric lifecycle records.
export function workerStartupSpans(spans, records) {
  return spans.flatMap(span=>{
    if(span.name!=='worker.startup.wait')return [span];
    const prefix=`${span.workerPid}-`;
    const observations=records.filter(r=>r.kind==='startup'&&r.processId.startsWith(prefix)
      &&(span.workerThreadId===undefined||r.processId===`${span.workerPid}-${span.workerThreadId}`)
      &&r.end>span.start&&r.start<span.end);
    const points=[...new Set([span.start,span.end,Math.max(span.start,Math.min(span.end,span.spawnedAt??span.start)),
      ...observations.flatMap(r=>[Math.max(span.start,r.start),Math.min(span.end,r.end)])])].sort((a,b)=>a-b);
    const result=[];
    for(let i=1;i<points.length;i++){
      const start=points[i-1],end=points[i];if(end<=start)continue;
      const priority=r=>r.phase==='dataset.evaluate'?0:r.phase==='module.load'?1:r.phase==='calculator.initialize'?2:3;
      const observed=observations.filter(r=>r.start<=start&&r.end>=end).sort((a,b)=>priority(a)-priority(b)||(a.end-a.start)-(b.end-b.start))[0];
      const phase=observed?.phase??(end<=(span.spawnedAt??span.start)?'spawn':'runtime/relay');
      const name=`worker.startup.${phase}`;
      const previous=result.at(-1);
      if(previous?.name===name&&previous.end===start&&previous.module===observed?.module)previous.end=end;
      else result.push({...span,id:`${span.id}:startup:${result.length}`,name,start,end,module:observed?.module,processId:observed?.processId??span.processId,layer:observed?(observed.processId.endsWith('-0')?'relay':'engine'):span.layer,
        observation:observed?'recorded-phase':'spawn/ready lifecycle; finer runtime work unobserved'});
    }
    return result;
  });
}
