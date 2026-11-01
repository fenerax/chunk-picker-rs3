import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { createPickerAdmission, COLD_OPEN_ADMISSION } from '../app/picker-admission.mjs';
import { createPickerLimits } from '../app/security/picker-limits.mjs';
import { withDirectoryBarriers } from '../app/storage/snapshot.mjs';
import { createPickerRouter } from '../app/picker-router.mjs';
const owner = id => ({ accountId: id, pickerId: id });
function fixture(t, bounds = {}, options = {}) {
  const events = [], limits = createPickerLimits(options);
  const admission = createPickerAdmission({ limits, bounds: { ...COLD_OPEN_ADMISSION, ...bounds }, onEvent: e => events.push(e) });
  t.after(() => admission.close()); return { admission, events, limits };
}
const run = (a, id, work = async () => id, signal) => a.run(owner(id), work, signal);
const rejects = (promise, message) => assert.rejects(promise, e => e.status === 503 && e.retryAfter === 1 && e.message.includes(message));

test('quiet accounts rotate ahead of a repeat flooder, with FIFO within accounts and exactly one lease', async t => {
  const { admission: a, events } = fixture(t), gate = Promise.withResolvers(), entered = Promise.withResolvers(), order = [];
  const first = run(a, 'a', async () => { entered.resolve(); await gate.promise; order.push('a1'); }); await entered.promise;
  const repeat = run(a, 'a', async () => order.push('a2'));
  const b = run(a, 'b', async () => order.push('b')), c = run(a, 'c', async () => order.push('c'));
  gate.resolve(); await Promise.all([first,repeat,b,c]); await turn();
  assert.deepEqual(order,['a1','b','c','a2']);
  assert.equal(events.filter(e=>e.event==='released').length,4);
  assert.ok(events.every(e=>e.active<=1 && e.pending<=4));
  assert.equal(events.at(-1).pending,0);
});

test('global pending and account pending caps distinguish refusals without allocating extra work', async t => {
  const { admission: a, events } = fixture(t,{maxPending:3}), gate = Promise.withResolvers();t.after(()=>gate.resolve());
  const first=run(a,'a',()=>gate.promise), repeat=run(a,'a'), b=run(a,'b');
  await rejects(run(a,'a'),'account-full'); await rejects(run(a,'c'),'queue-full');
  gate.resolve(); await Promise.all([first,repeat,b]); await turn();
  assert.equal(events.filter(e=>e.event==='released').length,3);
  assert.equal(await run(a,'c'),'c');
});

test('queued cancellation removes work; retry takes a fresh bounded slot and never resurrects the cancelled callback', async t => {
  const { admission:a }=fixture(t), gate=Promise.withResolvers(), abort=new AbortController();t.after(()=>gate.resolve());
  const first=run(a,'a',()=>gate.promise);let calls=0;
  const pending=run(a,'b',async()=>calls++,abort.signal), rejected=rejects(pending,'cancelled');abort.abort();await rejected;
  const retry=run(a,'b');gate.resolve();await first;assert.equal(await retry,'b');assert.equal(calls,0);
  const already=new AbortController();already.abort();await rejects(run(a,'b',async()=>calls++,already.signal),'cancelled');assert.equal(calls,0);
});

test('active cancellation and deadline keep the real lease and slots until work settles', async t => {
  for(const boundary of ['cancelled','deadline']){
    const {admission:a,limits,events}=fixture(t,{deadlineMs:30,perAccount:1}), gate=Promise.withResolvers(),entered=Promise.withResolvers(),controller=new AbortController();t.after(()=>gate.resolve());
    const first=run(a,'a',async()=>{entered.resolve();await gate.promise;},controller.signal), rejected=rejects(first,boundary);await entered.promise;
    if(boundary==='cancelled')controller.abort();await rejected;
    await rejects(run(a,'a'),'account-full');assert.throws(()=>limits.coldStart(owner('b')),{status:503});
    gate.resolve();await turn();assert.equal(events.filter(e=>e.event==='released').length,1);assert.equal(await run(a,'b'),'b');
  }
});

test('queue deadline, factory error and shutdown release once, drain active work and fence new retries', async t => {
  const {admission:a,events}=fixture(t,{deadlineMs:30}),gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const active=run(a,'a',async()=>{entered.resolve();await gate.promise;}),rejected=rejects(active,'deadline');await entered.promise;
  await rejects(run(a,'b'),'deadline');await rejected;
  const closing=a.close();let closed=false;closing.then(()=>closed=true);await turn();assert.equal(closed,false);
  await rejects(run(a,'b'),'shutdown');gate.resolve();await closing;
  assert.equal(events.filter(e=>e.event==='released').length,1);
  const f=fixture(t);await assert.rejects(run(f.admission,'a',async()=>{throw Error('factory');}),/factory/);await turn();assert.equal(await run(f.admission,'a'),'a');
});

test('independent account quotas and existing global cold concurrency remain enforced', async t => {
  const {admission:a,events}=fixture(t,{}, {coldStartsGlobal:2,coldStartsPerAccount:1}),gate=Promise.withResolvers(),started=[];t.after(()=>gate.resolve());
  const jobs=['a','a','b','c'].map(id=>run(a,id,async()=>{started.push(id);await gate.promise;}));await turn();
  assert.deepEqual(started,['a','b']);gate.resolve();await Promise.all(jobs);await turn();assert.ok(events.every(e=>e.active<=2));
  assert.equal(events.at(-1).pending,0);
});

function routerFixture(t,{openGate,handleGate,maxOpenContexts=3}={}){
  const calls=[],closed=[],handled=[],events=[],limits=createPickerLimits();
  const registry={getPicker:()=>({lifecycle:'active',provisioning:'ready'}),pickerDirectory:id=>`/synthetic-admission/${id}`};
  const router=createPickerRouter({registry,pickerLimits:limits,maxOpenContexts,onAdmission:e=>events.push(e),
    legacy:{authenticate:req=>({kind:'account',accountId:req.headers.account,pickerId:req.headers.picker})},
    openContext:async id=>{calls.push(id);await openGate?.(id);return {close:async()=>{closed.push(id);},handle:async(req,res)=>{handled.push(id);await handleGate?.(id);res.writeHead(200);res.end('{}');}};}});
  t.after(()=>router.close());
  function send(id,account=id){
    const request=Readable.from([]);Object.assign(request,{headers:{host:'localhost',picker:id,account},method:'GET',url:'/api/state',complete:true,socket:{remoteAddress:'127.0.0.1'}});
    const chunks=[],headers=new Map(),response=new Writable({write(chunk,_enc,done){chunks.push(Buffer.from(chunk));done();}});
    response.setHeader=(k,v)=>headers.set(k.toLowerCase(),v);response.getHeader=k=>headers.get(k.toLowerCase());response.writeHead=status=>{response.statusCode=status;response.headersSent=true;};
    const done=router.handle(request,response,{host:'127.0.0.1'}).then(()=>({status:response.statusCode,headers,text:Buffer.concat(chunks).toString()}));
    return {request,response,done,disconnect:()=>{request.aborted=true;request.emit('aborted');response.destroy();}};
  }
  return {router,send,calls,closed,handled,events};
}
const id=n=>'p_'+n.toString(16).padStart(32,'0');
test('twenty cold pickers progress through six owned slots, retaining isolation and the residency bound',async t=>{
  let peak=0;
  // Seven open contexts leave six owned slots, the bound the assertion checks.
  const f=routerFixture(t,{maxOpenContexts:7,openGate:async()=>{peak=Math.max(peak,f.calls.length-f.closed.length);}});
  // Count actual close boundaries using the fixture's closed list.
  const outcomes=[];
  for(let round=0;round<3;round++){
    outcomes.push(...await Promise.all(Array.from({length:20},(_,n)=>f.send(id(n+1)).done)));
  }
  assert.ok(outcomes.every(x=>x.status===200));assert.ok(peak<=6);assert.equal(f.handled.length,60);
  await f.router.close();assert.equal(f.calls.length,f.closed.length);
});

test('disconnect during a queued open removes it, active disconnect closes late context, and retry is fresh',async t=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t,{openGate:async()=>{entered.resolve();await gate.promise;}});
  const first=f.send(id(1));await entered.promise;const cancelled=f.send(id(2));await turn();cancelled.disconnect();await cancelled.done;
  first.disconnect();await first.done;assert.deepEqual(f.calls,[id(1)]);
  gate.resolve();await turn();await turn();assert.deepEqual(f.closed,[id(1)]);assert.deepEqual(f.handled,[]);
  assert.equal((await f.send(id(2)).done).status,200);assert.deepEqual(f.calls,[id(1),id(2)]);
});

test('busy residency waits outside the coordinator and wakes after the resident request drains',async t=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t,{maxOpenContexts:2,handleGate:async value=>{if(value===id(1)){entered.resolve();await gate.promise;}}});
  const first=f.send(id(1));await entered.promise;const second=f.send(id(2));await delay(40);assert.deepEqual(f.calls,[id(1)]);
  gate.resolve();assert.equal((await first.done).status,200);assert.equal((await second.done).status,200);assert.deepEqual(f.closed,[id(1)]);
});

test('shutdown rejects queued and in-progress admission, drains the late factory, and never handles late work',async t=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t,{openGate:async()=>{entered.resolve();await gate.promise;}});
  const first=f.send(id(1));await entered.promise;const second=f.send(id(2));await turn();const closing=f.router.close();
  assert.equal((await first.done).status,503);assert.equal((await second.done).status,503);gate.resolve();await closing;
  assert.deepEqual(f.calls,[id(1)]);assert.deepEqual(f.closed,[id(1)]);assert.deepEqual(f.handled,[]);
});

test('two independent flooders cannot alternate forever ahead of an already queued quiet account', async t => {
  const { admission:a }=fixture(t), gate=Promise.withResolvers(),entered=Promise.withResolvers(),order=[];t.after(()=>gate.resolve());
  const first=run(a,'a',async()=>{entered.resolve();await gate.promise;order.push('a1');});await entered.promise;
  const work=(account,label)=>run(a,account,async()=>order.push(label));
  const jobs=[first,work('a','a2'),work('b','b1'),work('b','b2'),work('quiet','quiet')];
  gate.resolve();await Promise.all(jobs);assert.deepEqual(order,['a1','b1','quiet','a2','b2']);
});

test('router deadline answers before a stalled factory settles, and closes its late result without reuse', async t => {
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t,{openGate:async()=>{entered.resolve();await gate.promise;}});
  const first=f.send(id(1));await entered.promise;
  const result=await first.done;assert.equal(result.status,503);assert.match(result.text,/admission deadline/);assert.equal(result.headers.get('retry-after'),1);
  assert.deepEqual(f.handled,[]);assert.deepEqual(f.closed,[]);gate.resolve();await turn();await turn();
  assert.deepEqual(f.closed,[id(1)]);assert.equal((await f.send(id(1)).done).status,200);assert.equal(f.calls.length,2);
});

test('diagnostic observer exceptions never interrupt completion, release or the next account', async () => {
  const limits=createPickerLimits(),a=createPickerAdmission({limits,onEvent(){throw Error('diagnostic');}});
  assert.equal(await run(a,'a'),'a');assert.equal(await run(a,'b'),'b');await a.close();
  const release=limits.coldStart(owner('c'));release();
});

test('a warm quiet picker progresses while another account holds a stalled cold factory', async t => {
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t,{openGate:async value=>{if(value===id(2)){entered.resolve();await gate.promise;}}});
  assert.equal((await f.send(id(1),'quiet').done).status,200);
  const cold=f.send(id(2),'noisy');await entered.promise;
  let finished=false;const warm=f.send(id(1),'quiet').done.then(r=>{finished=true;return r;});
  await turn();const progressed=finished;
  gate.resolve();assert.equal((await cold.done).status,200);assert.equal((await warm).status,200);
  assert.equal(progressed,true,'An unrelated cold factory must not hold warm acquisition');
});


test('warm acquisition still waits for its own checkpoint while another warm picker progresses', async t => {
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();t.after(()=>gate.resolve());
  const f=routerFixture(t);for(const n of [1,2])assert.equal((await f.send(id(n)).done).status,200);
  const checkpoint=withDirectoryBarriers([`/synthetic-admission/${id(1)}`],async()=>{entered.resolve();await gate.promise;});
  await entered.promise;let finished=false;const held=f.send(id(1)).done.then(r=>{finished=true;return r;});
  assert.equal((await f.send(id(2)).done).status,200);await turn();const wasHeld=!finished;
  gate.resolve();await checkpoint;assert.equal((await held).status,200);assert.equal(wasHeld,true);
});
