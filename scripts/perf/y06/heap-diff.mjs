// Synthetic heap snapshots only. Emit numeric summaries and public code labels;
// never emit arbitrary snapshot strings, object contents, or environment values.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {requireNode} from './runtime.mjs';
requireNode();
const arg=n=>process.argv[process.argv.indexOf(n)+1];
const constructors=new Set(['Object','Array','Map','Set','WeakMap','WeakSet','Promise','AbortController','AbortSignal','SharedArrayBuffer','ArrayBuffer','Uint8Array','Buffer','Timeout','EventEmitter','Socket','Server','Endpoint','system / Context','system / JSArrayBufferData','system / Map']);
const functions=new Set(['createPickerAdmission','createPickerContext','createTaskScheduler','createWorkerLane','createPickerRouter','prepare','open','work','remove','cancel','pump','settle','sleep','clearCancelledGrace','stateRepresentation','openSidecars','track','close','release','serverChild','createTrace','run','measure','job','metrics','get result','get stateJSON','anonymous','']);
const labels=new Set([...constructors,...functions]);
// Paths expose property identifiers from public source only. Unknown labels
// (including strings and dynamic IDs) are represented by their node type.
const properties=new Set(['global','context','system','native_context','admission','factory','acquisitions','foreground','advisory','records','hosts','events','tracing','transport','subscribers','listeners','requests','jobs','previous','slots','entries','queue','active','pending','groups','work','owner','signal','controller','timer','entry','cancelledGrace','state','stateInput','input','result','value','bytes','cache','pickers','store','readinessPrepared','responseCache','tasks','members','rules','catalogue','dynamicCatalogue','onEvaluation','onAdmission','startupTimingMs','forecasts','__proto__','prototype','constructor','closure','shared','script_or_debug_info','boilerplate','properties','elements','table','buffer','backing_store','data','map']);
const safeName=(s,type)=>labels.has(s)?s:type;
async function load(file){
 const bytes=await readFile(file),h=JSON.parse(bytes),nf=h.snapshot.meta.node_fields,ef=h.snapshot.meta.edge_fields,nn=nf.length,en=ef.length,nt=h.snapshot.meta.node_types[0],et=h.snapshot.meta.edge_types[0];
 const N=h.nodes.length/nn,ix=Object.fromEntries(nf.map((x,i)=>[x,i])),ei=Object.fromEntries(ef.map((x,i)=>[x,i])),offset=new Uint32Array(N+1),summary={};
 for(let n=0;n<N;n++){
  const at=n*nn,type=nt[h.nodes[at+ix.type]],name=h.strings[h.nodes[at+ix.name]],size=h.nodes[at+ix.self_size],label=safeName(name,type),key=type+':'+label;
  const row=summary[key]??={count:0,bytes:0};row.count++;row.bytes+=size;offset[n+1]=offset[n]+h.nodes[at+ix.edge_count]*en;
 }
 const parent=new Int32Array(N).fill(-1),edge=new Int32Array(N).fill(-1),todo=new Uint32Array(N);let head=0,tail=1;todo[0]=0;parent[0]=0;
 while(head<tail){const n=todo[head++];for(let k=offset[n];k<offset[n+1];k+=en){if(et[h.edges[k+ei.type]]==='weak')continue;const to=h.edges[k+ei.to_node]/nn;if(parent[to]!==-1)continue;parent[to]=n;edge[to]=k;todo[tail++]=to;}}
 const path=n=>{const parts=[];for(let depth=0;n&&depth<18;depth++){
  const at=n*nn,type=nt[h.nodes[at+ix.type]],name=h.strings[h.nodes[at+ix.name]],k=edge[n],edgeType=k<0?'root':et[h.edges[k+ei.type]],raw=k<0?'':h.strings[h.edges[k+ei.name_or_index]],field=properties.has(raw)?raw:edgeType;
  parts.push({node:safeName(name,type),edge:field});n=parent[n];if(n<0)break;
 }return parts.reverse();};
 const large=[];for(let n=0;n<N;n++){const at=n*nn,size=h.nodes[at+ix.self_size];if(size<65536)continue;large.push({bytes:size,type:nt[h.nodes[at+ix.type]],path:path(n)});}
 large.sort((a,b)=>b.bytes-a.bytes);
 const bindings=[];const variables=new Set(['groups','active','pending','drained','cancelledGrace','readinessPrepared','responseCache','pickers','closedPickers','admission','records','events','hosts','factory','acquisitions','foreground','advisory']);
 for(let n=0;n<N;n++){const at=n*nn;if(h.strings[h.nodes[at+ix.name]]!=='system / Context')continue;for(let k=offset[n];k<offset[n+1];k+=en){if(et[h.edges[k+ei.type]]!=='context')continue;const variable=h.strings[h.edges[k+ei.name_or_index]];if(!variables.has(variable))continue;const to=h.edges[k+ei.to_node]/nn,ta=to*nn,type=nt[h.nodes[ta+ix.type]],name=h.strings[h.nodes[ta+ix.name]];let elementEdges=0,elementShallowBytes=0;for(let e=offset[to];e<offset[to+1];e+=en)if(et[h.edges[e+ei.type]]==='element'){elementEdges++;elementShallowBytes+=h.nodes[h.edges[e+ei.to_node]+ix.self_size];}bindings.push({variable,elementEdges,elementShallowBytes,target:safeName(name,type),type,bytes:h.nodes[ta+ix.self_size],edges:h.nodes[ta+ix.edge_count],path:path(n)});}}
 return {bindings,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,nodes:N,edges:h.edges.length/en,summary,largest:large.slice(0,30)};
}
const before=await load(arg('--before')),after=await load(arg('--after'));
const differences=Object.keys({...before.summary,...after.summary}).map(key=>({key,before:before.summary[key]??{count:0,bytes:0},after:after.summary[key]??{count:0,bytes:0}})).map(x=>({...x,countDifference:x.after.count-x.before.count,byteDifference:x.after.bytes-x.before.bytes})).sort((a,b)=>b.byteDifference-a.byteDifference);
assert.ok(differences.every(r=>Number.isFinite(r.byteDifference)));
const report={schema:1,before,after,differences};await writeFile(arg('--out'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({before:{bytes:before.bytes,nodes:before.nodes},after:{bytes:after.bytes,nodes:after.nodes},differences:differences.slice(0,15)}));
