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

test('shared queued cancellation starts the surviving waiter callback under one cold lease', async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers(), abort = new AbortController(), calls = [];
  const admission = createPickerAdmission({ limits: createPickerLimits(),
    clock: { setTimeout: () => Symbol(), clearTimeout() {} } });
  t.after(async () => { gate.resolve(); await admission.close(); });
  const busy = run(admission, 'busy', () => { entered.resolve(); return gate.promise; }); await entered.promise;
  const first = admission.run(owner('first'), () => calls.push('cancelled'), abort.signal, { sharedKey: 'picker' });
  const rejected = rejects(first, 'cancelled');
  const survivor = admission.run(owner('survivor'), () => { calls.push('survivor'); return 'ready'; }, undefined, { sharedKey: 'picker' });
  abort.abort(); await rejected; gate.resolve(); await busy;
  assert.equal(await survivor, 'ready'); assert.deepEqual(calls, ['survivor']);
});

test('a newly enqueued shared generation cannot attach to a completed operation awaiting permit release', async t => {
  const admission = createPickerAdmission({ limits: createPickerLimits(),
    clock: { setTimeout: () => Symbol(), clearTimeout() {} } });
  t.after(() => admission.close());
  const first = admission.run(owner('a'), () => 'first', undefined, { sharedKey: 'picker' });
  assert.equal(await first, 'first');
  const next = admission.run(owner('b'), () => 'next', undefined, { sharedKey: 'picker' });
  assert.equal(await next, 'next');
});

for (const boundary of ['deadline', 'cancelled', 'shutdown']) test(`${boundary} still bounds each final pin after the shared cold permit is released`, async t => {
  const factory = Promise.withResolvers(), pin = Promise.withResolvers(), entered = Promise.withResolvers();
  const firstReleased = Promise.withResolvers(), secondReleased = Promise.withResolvers(), abort = new AbortController();
  const timers = new Map(), events = []; let sequence = 0, calls = 0;
  const limits = createPickerLimits(), admission = createPickerAdmission({ limits, bounds: { ...COLD_OPEN_ADMISSION, perAccount: 1 },
    clock: { setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
    onEvent(row) {
      events.push(row);
      if (row.event === 'released') (row.admissionId === 1 ? firstReleased : secondReleased).resolve(row);
    } });
  t.after(async () => { factory.resolve('ready'); pin.resolve(); await admission.close(); });
  const first = admission.run(owner('synthetic-first'), () => { calls++; return factory.promise; }, abort.signal,
    { sharedKey: 'synthetic-picker', finish: async (value, signal) => {
      entered.resolve(signal); await pin.promise; signal.throwIfAborted(); return value;
    } });
  const second = admission.run(owner('synthetic-second'), () => assert.fail('one shared factory'), undefined,
    { sharedKey: 'synthetic-picker', finish: value => value });
  factory.resolve('ready');
  assert.equal(await second, 'ready'); const signal = await entered.promise;
  const released = await secondReleased.promise;
  assert.equal(calls, 1); assert.equal(released.active, 0); assert.equal(released.pending, 1);
  assert.equal(timers.size, 1, 'only the unfinished pin retains its deadline');
  const release = limits.coldStart(owner('synthetic-probe')); release();
  await rejects(admission.run(owner('synthetic-first'), () => assert.fail('pending quota must remain charged')), 'account-full');
  const rejected = rejects(first, boundary);
  let closing;
  if (boundary === 'deadline') { const expire = timers.get(1); assert.ok(expire); expire(); }
  else if (boundary === 'cancelled') abort.abort();
  else closing = admission.close();
  await rejected;
  assert.equal(signal.aborted, true, 'the waiter signal fences a late pin');
  assert.equal(events.some(row => row.admissionId === 1 && row.event === 'completed'), false);
  assert.equal(events.some(row => row.admissionId === 1 && row.event === 'released'), false, 'the accepted final pin still drains');
  pin.resolve(); assert.equal((await firstReleased.promise).pending, 0); await closing;
  assert.equal(events.some(row => row.admissionId === 1 && row.event === 'completed'), false);
});

test('factory rejection cannot pin and finalizer rejection cannot discard a value already accepted atomically', async t => {
  const events = [], releases = [Promise.withResolvers(), Promise.withResolvers()];
  const admission = createPickerAdmission({ limits: createPickerLimits(),
    clock: { setTimeout: () => Symbol(), clearTimeout() {} }, onEvent(row) {
      events.push(row); if (row.event === 'released') releases[row.admissionId - 1].resolve(row);
    } });
  t.after(() => admission.close());
  await assert.rejects(admission.run(owner('synthetic-failed'), () => { throw new Error('Synthetic factory failure'); }, undefined,
    { finish: () => assert.fail('a failed factory cannot allocate a pin') }), /Synthetic factory failure/);
  await releases[0].promise;
  let pins = 0, handled = 0, released = 0;
  const entry = {}, abort = new AbortController();
  const acquired = await admission.run(owner('synthetic-accepted'), () => entry, abort.signal,
    { finish(value, signal, accept) {
      signal.throwIfAborted(); pins++; accept(value);
      queueMicrotask(() => abort.abort());
      throw new Error('Synthetic failure after pin acceptance');
    } });
  try { assert.equal(acquired, entry); handled++; } finally { released++; }
  assert.equal((await releases[1].promise).pending, 0);
  assert.deepEqual({ pins, handled, released }, { pins: 1, handled: 1, released: 1 });
  assert.equal(events.filter(row => row.admissionId === 2 && row.event === 'completed').length, 1);
  assert.equal(events.some(row => row.admissionId === 2 && ['error', 'cancelled'].includes(row.event)), false);
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
