// Data-only seam. No imports into the application/provider graph.
export const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const phases=Object.freeze([{name:'active',start:0,end:480000},{name:'idle',start:480000,end:1200000},{name:'resumed',start:1200000,end:1800000}]);
export function selectTasks(catalogues){
 if(catalogues.length!==2||catalogues.some(c=>!Array.isArray(c.tasks)))throw Error('two real catalogues required');
 const eligible=catalogues[0].tasks.filter(t=>t.status==='available'&&!t.hidden&&t.obligation!==false&&typeof t.id==='string'&&typeof t.label==='string'&&catalogues[1].tasks.some(x=>x.id===t.id&&x.label===t.label&&x.status==='available'&&!x.hidden&&x.obligation!==false));
 const unique=[...new Map(eligible.map(t=>[t.id,t])).values()].sort((a,b)=>a.id.localeCompare(b.id));
 if(unique.length<2)throw Error('two shared current-catalogue task rows unavailable');return unique.slice(0,2).map(({id,label})=>({id,label}));
}
export function receiptMatches({actor,owner,expectedRevision,commandId,generation},e){
 return actor===owner&&e.owner===owner&&e.generation===generation&&e.receipt?.requestId===commandId&&e.receipt?.revision===expectedRevision&&e.receipt?.outcome?.revision===expectedRevision;
}
export function activeNetworkClassification(r){return r.terminal==='finished'?'network-complete':r.terminal==='failed'?'network-failed':r.positiveSSE===true?'expected-live-stream':'unresolved';}
