import assert from 'node:assert/strict';
export const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function eligibleBadgeCount(result){
 const tasks=Array.isArray(result?.tasks)?result.tasks:[], byId=new Map(tasks.map(t=>[t.id,t])), candidates=new Map();
 for(const ref of result?.presentation?.tasks??[]){const t=byId.get(typeof ref==='string'?ref:ref?.id);if(t)candidates.set(t.id,t);}
 for(const t of tasks)if(t.id?.startsWith('custom:')||t.id?.startsWith('rs3:task:custom:'))candidates.set(t.id,t);
 return [...candidates.values()].filter(t=>t.status==='available'&&t.obligation!==false&&!t.hidden&&!t.record?.NeverShow&&!t.neverShow).length;
}
export function qualifies(stack,sourceURL,phase){
 return typeof stack==='string'&&stack.split('\n').some(line=>line.includes(sourceURL+':')&&line.includes(phase==='declaration'?'declarationIndex':'chunkPlanningIndexSteps'));
}
export function cancelProof(events,phase,sourceURL){
 const send=events.find(e=>e.direction==='send'&&e.type==='idle-planning'); assert.ok(send,'planning send required');
 const matched=e=>e.id===send.id&&same(e.identity,send.identity);
 const stage=events.find(e=>e.direction==='receive'&&e.type==='r131-phase'&&matched(e)&&e.phase===phase&&e.sourceURL===sourceURL&&qualifies(e.caller,sourceURL,phase));assert.ok(stage,'actual qualified phase required');
 const cancel=events.find(e=>e.direction==='send'&&e.type==='cancel'&&matched(e));assert.ok(cancel,'matching cancel required');
 const ack=events.find(e=>e.direction==='receive'&&e.type==='idle-planning-ack'&&matched(e));assert.ok(ack,'matching ACK required');assert.equal(ack.resultUndefined,true,'undefined cancellation result required');
 const ordinary=events.find(e=>e.direction==='send'&&e.type==='evaluate'&&same(e.identity,send.identity)&&e.atParentMs>cancel.atParentMs);assert.ok(ordinary,'same-generation ordinary required');
 const yielded=events.find(e=>e.type==='r131-yield'&&matched(e)&&e.phase===phase&&e.sourceURL===sourceURL);assert.ok(yielded,'actual budgeted yield coverage required');
 assert.ok(send.atParentMs<=stage.atParentMs&&stage.atParentMs<=cancel.atParentMs&&cancel.atParentMs<=ack.atParentMs&&ack.atParentMs<=ordinary.atParentMs,'phase/cancel/ACK/ordinary ordering');
 return {requestID:send.id,identity:send.identity,phase,sourceURL,caller:stage.caller,yielded:true};
}
