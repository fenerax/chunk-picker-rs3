import { gzipSync } from 'node:zlib';
export function stats(values) {
  if (!values.length) return null;
  const a = [...values].sort((a,b)=>a-b), m = Math.floor(a.length/2);
  return { median: a.length % 2 ? a[m] : (a[m-1]+a[m])/2, min: a[0], max: a.at(-1) };
}
export function reconcile(start, end, spans) {
  const rows=spans.filter(s=>!s.envelope&&s.end>start&&s.start<end&&s.end>s.start).map(s=>({...s,start:Math.max(start,s.start),end:Math.min(end,s.end)}));
  const events=new Map();
  const boundary=t=>{if(!events.has(t))events.set(t,{add:[],remove:[]});return events.get(t);};
  rows.forEach((s,i)=>{boundary(s.start).add.push(i);boundary(s.end).remove.push(i);});boundary(start);boundary(end);
  const points=[...events.keys()].sort((a,b)=>a-b),active=new Set(),phases={},gaps=[];
  const rank=s=>s.layer==='browser'&&s.category==='idle'?5:({engine:0,relay:1,server:2,browser:3,harness:4}[s.layer]??6);
  const harnessRank=s=>s.layer==='harness'&&s.name.startsWith('driver.')&&!s.name.endsWith('.frames')?1:0;
  const compare=(a,b)=>rank(a)-rank(b)||harnessRank(a)-harnessRank(b)||(a.end-a.start)-(b.end-b.start);
  let accounted=0;
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],event=events.get(a);
    for(const n of event.remove)active.delete(n);for(const n of event.add)active.add(n);
    let chosen;for(const n of active){const s=rows[n];if(!chosen||compare(s,chosen)<0)chosen=s;}
    if(chosen){const key=`${chosen.layer}:${chosen.name}`;phases[key]=(phases[key]??0)+b-a;accounted+=b-a;}
    else if(b>a){const last=gaps.at(-1);if(last?.end===a)last.end=b;else gaps.push({start:a,end:b,reason:'No observed application span or explicit harness await'});}
  }
  const unaccounted=gaps.reduce((n,g)=>n+g.end-g.start,0),harnessMs=Object.entries(phases).filter(([n])=>n.startsWith('harness:')).reduce((n,[,ms])=>n+ms,0);
  return{wallMs:end-start,accountedMs:accounted,unaccountedMs:unaccounted,harnessMs,gaps,reconciliationErrorMs:accounted+unaccounted-(end-start),phases};
}
export function interactionWindows(click) {
  const anchors=[{id:click.profileId,start:click.start},...click.spans.filter(s=>s.name==='input.click'&&s.start>=click.start&&s.start<click.end).map(s=>({id:s.profileId,start:s.start}))].sort((a,b)=>a.start-b.start);
  return anchors.map((anchor,index)=>{
    const start=anchor.start,end=anchors[index+1]?.start??click.end,owned=click.spans.filter(s=>s.profileId===anchor.id);
    return {id:anchor.id,parentId:anchor.id===click.profileId?undefined:click.profileId,start,end,
      spans:owned.map(s=>s.id),concurrentSpans:click.spans.filter(s=>s.profileId!==anchor.id&&s.end>start&&s.start<end).map(s=>s.id),
      outsideWindowSpans:owned.filter(s=>s.start<start||s.end>end).map(s=>s.id),summary:reconcile(start,end,click.spans)};
  });
}
export function topFunctions(cpu, spans) {
  const nodes = new Map(cpu.profile.nodes.map(n=>[n.id,n])), totals=new Map(); let t=cpu.profile.startTime/1000+(cpu.clockOffsetMs??0);
  const deltaTotal=(cpu.profile.timeDeltas??[]).reduce((a,b)=>a+b,0)/1000;
  // Inspector timestamps are a different origin. Align by the measured stop
  // duration; report profiler interval slack rather than stretching samples.
  const slackMs=Math.max(0,cpu.end-cpu.start-deltaTotal);
  for(let i=0;i<(cpu.profile.samples??[]).length;i++) {
    const ms=(cpu.profile.timeDeltas?.[i]??0)/1000, midpoint=t+ms/2;t+=ms;
    if (midpoint < (cpu.windowStart??-Infinity) || midpoint > (cpu.windowEnd??Infinity)) continue;
    const node=nodes.get(cpu.profile.samples[i]); if(!node) continue;
    const f=node.callFrame, name=f.functionName||'(anonymous)', file=f.url.split('/').at(-1)||'(V8)';
    const span=spans.filter(s=>(s.processId===cpu.processId || cpu.layer==='browser' && s.layer==='browser')&&!s.envelope&&s.start<=midpoint&&s.end>=midpoint).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    const key=`${name} (${file}:${f.lineNumber+1}) @ ${span?.name??'unattributed'}`;
    totals.set(key,(totals.get(key)??0)+ms);
  }
  return { processId:cpu.processId, layer:cpu.layer, scenario:cpu.scenario, slackMs, gcCount:cpu.gc?.length??0, gcPauseMs:(cpu.gc??[]).reduce((n,g)=>n+g.duration,0), eventLoop:cpu.eventLoop, rssBytes:cpu.rssBytes, functions:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([name,selfMs])=>({name,selfMs})) };
}
export function summarize(clicks) {
  return [...new Set(clicks.map(c=>c.scenario))].map(scenario=>{
    const rows=clicks.filter(c=>c.scenario===scenario), phaseNames=[...new Set(rows.flatMap(c=>Object.keys(c.summary.phases)))];
    const wall=stats(rows.map(c=>c.summary.wallMs));
    const phases=phaseNames.map(name=>({name,...stats(rows.map(c=>c.summary.phases[name]??0))})).sort((a,b)=>b.median-a.median);
    return {scenario,runs:rows.length,wall,phases,unaccounted:stats(rows.map(c=>c.summary.unaccountedMs)),harness:stats(rows.map(c=>c.summary.harnessMs??0)),peakRssBytes:stats(rows.map(c=>c.memory?.peakRssBytes??0)),maxReconciliationErrorMs:Math.max(...rows.map(c=>Math.abs(c.summary.reconciliationErrorMs)))};
  });
}
export function html(report) {
  const compressed=gzipSync(JSON.stringify(report),{level:6}).toString('base64');
  return `<!doctype html><meta charset="utf-8"><title>Picker stack profile</title><style>
  body{font:15px system-ui;background:#111923;color:#e5edf5;margin:30px;max-width:1500px}table{border-collapse:collapse;width:100%;margin:15px 0}td,th{text-align:left;border-bottom:1px solid #405060;padding:7px}summary{cursor:pointer}svg{width:100%;background:#172332}text{fill:#e5edf5;font:11px monospace}.browser{fill:#55b7e5}.server{fill:#efb35c}.engine{fill:#8cd391}.relay{fill:#c9a2ec}.harness{fill:#a4acb7}pre{white-space:pre-wrap}button,select{font:inherit}</style>
  <h1>Picker stack profile</h1><p>Milliseconds; median [min–max]. Each repetition has a fresh synthetic server and Chrome. Reload and actions retain that repetition’s caches.</p>
  <p>Waterfalls show concurrent work. Phase tables partition time with engine → relay → server → browser → harness precedence and the shortest span within a layer. Envelope spans are excluded. This is coverage attribution, not an inferred critical path. Harness spans identify actual driver round trips, frame waits and polling sleeps. Unaccounted is outside their union with observed application spans; trace gaps are never assumed idle.</p>
  <div id="summary"></div><div id="runs"></div><h2>Clock alignment and blind spots</h2><pre id="limits"></pre>
  <script>(async()=>{const compressed=Uint8Array.from(atob('${compressed}'),c=>c.charCodeAt(0));const r=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();const fmt=n=>n.toFixed(2),s=v=>fmt(v.median)+' ['+fmt(v.min)+'–'+fmt(v.max)+']';const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  document.querySelector('#summary').innerHTML='<table><tr><th>Scenario</th><th>Wall ms</th><th>Largest three application phases (share of median wall)</th><th>Harness ms</th><th>Unaccounted ms</th></tr>'+r.summary.map(v=>'<tr><td>'+esc(v.scenario)+'</td><td>'+s(v.wall)+'</td><td>'+v.phases.filter(p=>!p.name.startsWith('harness:')).slice(0,3).map(p=>esc(p.name)+' '+fmt(p.median)+' ('+fmt(p.median/v.wall.median*100)+'%)').join('<br>')+'</td><td>'+s(v.harness)+'</td><td>'+s(v.unaccounted)+'</td></tr>').join('')+'</table>';
  document.querySelector('#limits').textContent=JSON.stringify({clocks:r.clocks,limits:r.limits},null,2);
  for(const c of r.clicks){const d=document.createElement('details');d.innerHTML='<summary>'+esc(c.scenario)+' · repetition '+c.run+' · '+fmt(c.summary.wallMs)+'ms</summary>';document.querySelector('#runs').append(d);d.addEventListener('toggle',()=>{if(!d.open||d.dataset.rendered)return;d.dataset.rendered='1';if(c.revisions)d.innerHTML+='<p>Validated save revision '+c.revisions.before+' → '+c.revisions.after+'</p>';
  const ordered=c.spans.filter(v=>v.end>c.start&&v.start<c.end).sort((a,b)=>a.start-b.start),lanes=[],bars=[];
  for(const v of ordered){const key=v.layer+' '+v.processId;let row=lanes.findIndex(l=>l.key===key&&l.end<=v.start);if(row<0){row=lanes.length;lanes.push({key,end:v.end});}else lanes[row].end=v.end;bars.push({v,row});}
  let svg='<svg viewBox="0 0 1400 '+(lanes.length*18+24)+'">';lanes.forEach((lane,i)=>{svg+='<text x="2" y="'+(i*18+15)+'">'+esc(lane.key)+' #'+i+'</text>';});
  for(const {v,row} of bars){const x=330+Math.max(0,v.start-c.start)/c.summary.wallMs*1030,w=Math.max(.5,(Math.min(c.end,v.end)-Math.max(c.start,v.start))/c.summary.wallMs*1030);svg+='<rect class="'+v.layer+'" x="'+x+'" y="'+(row*18+4)+'" width="'+w+'" height="11"><title>'+esc(v.name)+' '+fmt(v.end-v.start)+'ms; parent '+esc(v.parentId??'click')+'</title></rect>';}
  d.innerHTML+='<p>Intervals are packed into rows per process; hover a bar for its phase and duration. Raw envelopes and concurrent work remain visible.</p>'+svg+'</svg>';
  const group=r.summary.find(v=>v.scenario===c.scenario);d.innerHTML+='<table><tr><th>Phase</th><th>Median [min–max] ms</th></tr>'+group.phases.map(v=>'<tr><td>'+esc(v.name)+'</td><td>'+s(v)+'</td></tr>').join('')+'<tr><td>unaccounted</td><td>'+s(group.unaccounted)+'</td></tr></table><p>Reconciliation error '+fmt(c.summary.reconciliationErrorMs)+'ms</p>';
  for(const interaction of c.interactions??[]){const group=document.createElement('details'),list=c.spans.filter(s=>interaction.spans.includes(s.id)),byId=new Map(list.map(s=>[s.id,s]));
  const depth=(s,seen=new Set())=>{if(!s.parentId||seen.has(s.id)||!byId.has(s.parentId))return 0;seen.add(s.id);return 1+depth(byId.get(s.parentId),seen);};
  group.innerHTML='<summary>Input tree '+esc(interaction.id)+' · input window '+fmt(interaction.summary.wallMs)+'ms</summary><p>Input to next input, or scenario end. Coverage includes all observed work in that window, even when an earlier input caused it. The tree retains this input’s causal spans, including asynchronous work beyond its window. Render causality is temporal, not proven.</p><table><tr><th>Span</th><th>Start / duration ms</th></tr>'+list.sort((a,b)=>a.start-b.start).map(s=>'<tr><td style="padding-left:'+(8+depth(s)*15)+'px">'+esc(s.layer+': '+s.name+(s.module?' · '+s.module:'')+(s.blockingJob?' · behind '+s.blockingJob.type+' #'+s.blockingJob.id:''))+'</td><td>'+fmt(s.start-c.start)+' / '+fmt(s.end-s.start)+'</td></tr>').join('')+'<tr><td>unaccounted</td><td>'+fmt(interaction.summary.unaccountedMs)+'</td></tr></table>';d.append(group);}
  for(const cpu of c.cpu){const p=document.createElement('pre');p.textContent=cpu.processId+' '+cpu.layer+' · profiler slack '+fmt(cpu.slackMs)+'ms · GC '+cpu.gcCount+' / '+fmt(cpu.gcPauseMs)+'ms · event-loop '+JSON.stringify(cpu.eventLoop??{})+'\\n'+cpu.functions.map(f=>fmt(f.selfMs)+'ms '+f.name).join('\\n');d.append(p);} });}
  })().catch(error=>{document.querySelector('#limits').textContent='Report load failed: '+error.message;});</script>`;
}
