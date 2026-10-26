import { createRequestReader, requestError } from '../app/web/live-swap-client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';

// Actual API function with browser-standard Response/Headers/decompression,
// controlled response bytes and no network, server, worker or gameplay writes.
const apiSource = screenFunctionSource(await readScreenGraph(), 'api');
const payload = () => ({memberId:'reed',stateRevision:7,tasks:[{id:'custom:one',label:'Saved goal'}],metrics:{availableCount:1}});
function harness(response, canWrite = false) {
  const context=createContext({canWrite:()=>canWrite,sandbox:{active:false},state:{revision:8},fetch:async()=>response,
    readRequest:createRequestReader({fetch:async()=>response}),requestError,feedback:{begin:()=>()=>{}},calculationLabel:()=>'',memberId:'reed',duoEnabled:()=>false});
  runInContext(apiSource,context); return context;
}

test('single gzip task JSON decodes completely and header rebinds only its current revision', async () => {
  const original=payload(), compressed=gzipSync(JSON.stringify(original));
  const decoded=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const response=new Response(decoded,{headers:{'X-RS3-State-Revision':'8'}});
  const value=await harness(response).api('/api/tasks?memberId=reed');
  assert.deepEqual(value,{...original,stateRevision:8}); assert.equal(value.tasks.length,1); assert.equal(value.memberId,'reed');
});

test('saved task revision headers support zero and missing body revision', async () => {
  const value=await harness(new Response(JSON.stringify({memberId:'reed',tasks:[]}),{headers:{'x-rs3-state-revision':'0'}})).api('/api/tasks?memberId=reed');
  assert.equal(value.stateRevision,0);
});

test('invalid or older headers never replace a valid task revision', async () => {
  for(const header of ['-1','1.5','9007199254740992','NaN','','08',' 8 ','6']) {
    const response={ok:true,headers:{get:()=>header},json:async()=>payload()};
    assert.equal((await harness(response).api('/api/tasks?memberId=reed')).stateRevision,7,header);
  }
});

test('editor sessions, other read routes and header-free fixture responses keep their JSON metadata', async () => {
  for(const [path,canWrite] of [['/api/tasks?memberId=reed',true],['/api/history',false],['/api/tasksmith',false]]) {
    const response=new Response(JSON.stringify(payload()),{headers:{'X-RS3-State-Revision':'8'}});
    assert.equal((await harness(response,canWrite).api(path)).stateRevision,7);
  }
  assert.equal((await harness({ok:true,json:async()=>payload()}).api('/api/tasks?memberId=reed')).stateRevision,7);
});

test('error responses preserve their status and code without applying revision metadata', async () => {
  const response=new Response(JSON.stringify({message:'Tasks unavailable',code:'TASK_RESULTS_UNAVAILABLE'}),{status:409,headers:{'X-RS3-State-Revision':'8'}});
  await assert.rejects(harness(response).api('/api/tasks?memberId=reed'),{message:'Saved tasks are not ready yet. Wait for a player to calculate them, then try again.',status:409,code:'TASK_RESULTS_UNAVAILABLE'});
});
