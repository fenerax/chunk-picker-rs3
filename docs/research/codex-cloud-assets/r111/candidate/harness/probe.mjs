// R37 observation probe refined: headers, natural body reads and render marks are separate.
// Never clones/reads an otherwise ignored body; no full payload retained.
export function probe(){
 const cap=256,rows=[],marks=[],feedback=[];let local=0,headers=0,bodies=0,mutations=0,overflow=0,lastStatus;
 const bounded=(a,x)=>{a.push(x);if(a.length>cap){a.shift();overflow++;}};
 // Bound shipping marks between samples as well as at sample time. Overflow fails the sampler.
 marks.push=(...events)=>{if(marks.length+events.length>cap){overflow++;return marks.length;}return Array.prototype.push.apply(marks,events);};
 globalThis.__rs3Perf={enabled:true,events:marks};
 const original=globalThis.fetch.bind(globalThis);
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input?.url??String(input),location.href),method=init?.method??input?.method??'GET',id=++local;
  const r=await original(input,init);headers++;
  // Only observe the body's EXISTING JSON consumer for task/state/command responses.
  if(['/api/tasks','/api/state','/api/command'].includes(url.pathname)){
   const json=r.json.bind(r);r.json=async()=>{
    const value=await json();bodies++;let command;try{command=JSON.parse(init?.body??'null');}catch{}
    const event={documentTimeOrigin:performance.timeOrigin,localId:id,url:url.href,path:url.pathname,method,commandId:command?.requestId,request:command?{requestId:command.requestId,expectedRevision:command.expectedRevision,requestAck:command.requestAck,command:command.command}:null,value:{revision:value.stateRevision??value.state?.revision??null,memberId:value.memberId??null,taskCount:value.tasks?.length??null,receipt:value.receipt?{requestId:value.receipt.requestId,revision:value.receipt.revision,outcome:value.receipt.outcome}:null},at:performance.now()};
    bounded(rows,{...event,url:undefined});void globalThis.__r111body?.(event);return value;
   };
  }
  return r;
 };
 new MutationObserver(ms=>{mutations+=ms.length;const badge=document.getElementById('save-status');if(badge&&badge.textContent!==lastStatus){lastStatus=badge.textContent;bounded(feedback,{at:performance.now(),text:lastStatus,revision:badge.title});}}).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
 globalThis.__soak={sample:()=>({observerOverflow:overflow,t:performance.now(),headersObserved:headers,naturalJSONBodies:bodies,mutations,bodyReads:rows.splice(0),feedback:feedback.splice(0),marks:marks.splice(0),focus:document.activeElement?.id??document.activeElement?.tagName,renderGeneration:'not exposed by shipping UI; marks are revision/member scoped'})};
}
