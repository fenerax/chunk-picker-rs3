// Explicit diagnostic only. Bound numeric GC events and request heap snapshots;
// no result/state data and no forced collection unless the caller asks for it.
import { PerformanceObserver, performance, constants } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { isMainThread, parentPort } from 'node:worker_threads';
import { registerHooks } from 'node:module';
const events=[];
const observer=new PerformanceObserver(list=>{for(const event of list.getEntries())events.push({start:event.startTime,duration:event.duration,kind:event.detail.kind});while(events.length>8192)events.shift();});
observer.observe({entryTypes:['gc']});
const totals=values=>({count:values.length,pauseMs:values.reduce((n,v)=>n+v.duration,0),majorCount:values.filter(v=>v.kind===constants.NODE_PERFORMANCE_GC_MAJOR).length,majorPauseMs:values.filter(v=>v.kind===constants.NODE_PERFORMANCE_GC_MAJOR).reduce((n,v)=>n+v.duration,0)});
if(isMainThread){
  const memory=process.memoryUsage;
  const measured=()=>({...memory(),projectionGC:totals(events)});
  measured.rss=()=>memory.rss();process.memoryUsage=measured;
}else{
  const marks=new Map();let passes=0;
  registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/app/tasks/engine.mjs'))return result;
    const source=String(result.source),anchor='    const member = state.members.find(value => value.id === memberId);';
    if(source.split(anchor).length!==2)throw Error('GCProbeAnchorError');
    return {...result,source:source.replace(anchor,'    globalThis[Symbol.for(\'rs3.projectionGCPass\')]();\n'+anchor)};
  }});
  globalThis[Symbol.for('rs3.projectionGCPass')]=()=>{passes++;};
  const heap=()=>{const h=getHeapStatistics();return{used:h.used_heap_size,total:h.total_heap_size,physical:h.total_physical_size,external:h.external_memory};};
  const send=parentPort.postMessage.bind(parentPort);
  parentPort.postMessage=function(message,...rest){
    const mark=marks.get(message?.id);
    const final=mark&&!['progress','prediction-prepared'].includes(message.type);
    const value=send(message,...rest);
    // Include the synchronous structured clone in the request GC window.
    if(final){mark.end=performance.now();mark.heapAfter=heap();mark.passesAfter=passes;}
    return value;
  };
  parentPort.on('message',async message=>{
    if(message?.type==='cancel'&&message.projectionGC){globalThis.gc?.();return;}
    if(message?.type==='cancel'&&message.id===-1&&message.memoryPort){
      await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
      const requests=[...marks.values()].filter(m=>m.end!==undefined).slice(-4).map(m=>({...m,gc:totals(events.filter(e=>e.start<m.end&&e.start+e.duration>m.start))}));
      message.memoryPort.postMessage({memoryUsage:{heap:heap(),gc:totals(events),requests}});return;
    }
    if(message?.id===undefined||message.type==='cancel')return;
    marks.set(message.id,{id:message.id,start:performance.now(),heapBefore:heap(),passesBefore:passes});while(marks.size>64)marks.delete(marks.keys().next().value);
  });
}
