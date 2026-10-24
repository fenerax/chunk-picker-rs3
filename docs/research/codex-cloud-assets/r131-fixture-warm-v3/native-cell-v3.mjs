import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
import {cancelProof,eligibleBadgeCount} from './protocol.mjs';
import {sha256,serializedState} from './driver-lib.mjs';
import {note,currentOperation,setDiagnosticContext,warmAssertion as assertWarm} from './diagnostics.mjs';
const diagnosticMode=process.argv.find(a=>a.startsWith('--mode='))?.slice(7);setDiagnosticContext('none',diagnosticMode);process.on('uncaughtExceptionMonitor',error=>note(currentOperation(),error,'failed'));
// FD3 belongs to this process's IPC channel, never the wrapper stage pipe.
assert.equal(process.env.PERF_STAGE_FD,undefined);
note('cell-import-fixture');
const {fixture,schedulerFixture}=await import('./scheduler-fixture-v3.mjs');
note('cell-import-projection');
const {projectMapTaskLocations}=await import(pathToFileURL(process.env.R131_CANDIDATE_ROOT+'/app/tasks/map-task-locations.mjs').href);
note('cell-mode-admission');
const mode=process.argv.find(a=>a.startsWith('--mode='))?.slice(7);assert.ok(['thread','process'].includes(mode));
const records=[],sourceURL=pathToFileURL(process.env.R131_CANDIDATE_ROOT+'/app/tasks/chunk-planning-index.mjs').href;
async function episode(name,body){const intent=name.startsWith('initial')?'initial':name.startsWith('declaration')?'declaration':name.startsWith('task')?'task':name.startsWith('cold/')?'classification':'negative-control';setDiagnosticContext(intent,mode);const cleanup=[];const t={after:f=>cleanup.push(f)};let error,cleanupPassed=true;note('intent-body');try{await body(t);}catch(e){note(currentOperation(),e,'failed');error=e;}finally{note('intent-cleanup');for(const close of cleanup.reverse())try{await close();}catch(e){note('intent-cleanup',e,'failed');cleanupPassed=false;error??=e;}}records.push({name,status:error?'FAIL':'PASS',cleanupPassed,error:error?.stack});if(error)throw error;}
try{
 await episode('initial full borrow conformance',async t=>{const data=fixture(1),a=await schedulerFixture(t,mode,data,true);await a.warm('a');const got=await a.planning();const b=await schedulerFixture(t,mode,data,false),expected=await b.planning();assert.deepEqual(got.result,expected.result);assert.equal(a.workers.length,1);assert.ok(a.events.some(e=>e.privateBaseline));assert.ok(a.events.some(e=>e.type==='idle-planning'&&e.direction==='send'));records.push({events:a.events});});
 for(const phase of ['declaration','task'])await episode(phase+' cancellation and independent fallback equality',async t=>{
  const data=fixture(256,phase==='declaration'),f=await schedulerFixture(t,mode,data,true,phase);records.push({diagnostic:'live events retained even if phase/cancel/yield coverage fails',phase,events:f.events});const warm=await f.warm('a');
  const input=sha256(JSON.stringify([data.state.rules,data.state.taskRules,data.state.members]));
  assertWarm('warm-row-count',1,warm.result.tasks.length,()=>assert.ok(warm.result.tasks.length>0,'real warm response must retain planning rows'));
  const baseline=f.events.find(e=>e.privateBaseline)?.baseline;
  assertWarm('baseline-receipt-present',1,Number(Boolean(baseline)),()=>assert.ok(baseline,'real resident baseline receipt required'));
  assertWarm('baseline-input-match',1,Number(baseline.input===input),()=>assert.equal(baseline.input,input));
  assertWarm('baseline-member-match',1,Number(baseline.memberId==='a'),()=>assert.equal(baseline.memberId,'a'));
  assertWarm('baseline-revision',data.state.revision,baseline.revision,()=>assert.equal(baseline.revision,data.state.revision));
  assertWarm('baseline-key-string',1,Number(typeof baseline.baselineKey==='string'),()=>assert.equal(typeof baseline.baselineKey,'string'));
  if(phase==='declaration'){
   const eligible=eligibleBadgeCount(warm.result);assertWarm('eligible-badge-count',0,eligible,()=>assert.equal(eligible,0));
   const projection=projectMapTaskLocations(data.definitions,warm.result,data.workerData.world);assertWarm('projection-key-count',0,Object.keys(projection).length,()=>assert.deepEqual(projection,{}));
   const prewarm=f.events.filter(e=>e.type==='r131-phase'&&e.phase==='declaration').length;assertWarm('prewarm-declaration-count',0,prewarm,()=>assert.equal(prewarm,0,'ordinary warm must leave declarations cold'));
  }
  let ordinary,observed=false;f.setPhaseAction(()=>{if(!observed){observed=true;ordinary=f.warm('b');}});
  const results=await Promise.all([f.planning(),f.planning()]);if(ordinary)await ordinary;
  const proof=cancelProof(f.events,phase,sourceURL);assert.ok(observed);
  // Two independent ordinary dispatches in separate disabled schedulers.
  const references=[];for(const result of results){const reference=await schedulerFixture(t,mode,data,false),expected=await reference.planning();assert.deepEqual(result.result,expected.result);references.push({sha256:sha256(JSON.stringify(expected.result)),identities:reference.workers.map(w=>w.identity)});}
  assert.equal(f.events.filter(e=>e.type==='chunk-planning'&&e.direction==='send').length,1);assert.equal(f.scheduler.getHealth().failures,0);assert.equal(f.events.filter(e=>e.direction==='exit').length,0);
  records.push({phase,proof,events:f.events,references,warmEligibleBadgeCount:eligibleBadgeCount(warm.result),warmRows:warm.result.tasks.length,baseline,capture:{member:'a',chunk:'12341',revision:data.state.revision,input,fixtureSHA256:sha256(JSON.stringify(data.definitions)),stateSHA256:sha256(JSON.stringify(data.state))},fallbacks:results.map(r=>r.result)});
 });
 await episode('cold/member/input/revision classification',async t=>{const data=fixture(1),f=await schedulerFixture(t,mode,data,true),borrows=()=>f.events.filter(e=>e.type==='idle-planning'&&e.direction==='send').length;await f.planning();assert.equal(borrows(),0);await f.warm('a');data.state.revision++;f.scheduler.supersedeDisplay(data.state.revision);await f.planning();assert.equal(borrows(),1);data.state.rules['content.f2p']=true;await f.planning();assert.equal(borrows(),1);const stale=structuredClone(data.state);data.state.revision++;f.scheduler.setRevision(data.state.revision,'new-gameplay');await assert.rejects(f.scheduler.evaluate(stale,'a','chunk-planning','12341','stale','old'),e=>e.status===409);const input=sha256(JSON.stringify([data.state.rules,data.state.taskRules,data.state.members]));await f.scheduler.evaluate(data.state,'b','chunk-planning','12341','member-b',input,undefined,[],'full',serializedState(data.state,input));assert.equal(borrows(),1);records.push({events:f.events});});
 await episode('original reachable cache-warm negative control',async t=>{const data=fixture(256),f=await schedulerFixture(t,mode,data,true,'declaration');await f.warm('a');await f.planning();assert.equal(f.events.filter(e=>e.type==='r131-phase'&&e.phase==='declaration'&&e.armed).length,0);assert.ok(f.events.some(e=>e.type==='r131-phase'&&e.phase==='task'&&e.armed));records.push({events:f.events});});
 note('cell-complete',undefined,'complete');process.send?.({type:'result',mode,correct:true,failed:false,records});
}catch(error){note(currentOperation(),error,'failed');process.send?.({type:'result',mode,correct:false,failed:true,error:error.stack,records,remaining:'UNRUN'});process.exitCode=1;}
finally{process.disconnect?.();}
