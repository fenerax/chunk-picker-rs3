import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildExpected,normalizeView,validateClosedWitness,choosePlanningBody,publicCloseProof,
 capabilitySurvey,codeOf,FAILURE_OPERATIONS,HARNESS_ERROR_MESSAGES} from './run-frozen-browser.mjs';
import {ownedPath,parseArgs,classifyObservedWrites,sanitizePath} from './harness-utils.mjs';
import {createWitnessJournal} from './server-driver.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const goodClose=()=>({closeCompleted:true,ownershipStable:true,ownershipAfterClose:{present:false},journal:[],captureErrors:[],
 witnesses:[{tokenSha256:sha('case'),valid:true,provisional:false}],finalSnapshot:{calculation:{sha256:'a'.repeat(64)},fullState:{sha256:'b'.repeat(64)}}});
test('normal close needs an acknowledged complete finalized witness',()=>assert.equal(validateClosedWitness(goodClose(),'case','a'.repeat(64),'b'.repeat(64)).valid,true));
test('retained close proof keeps authoritative hashes while dropping private paths and owner values',()=>{
 const receipt=goodClose();receipt.closedStore={path:'/scratch/private-store',stateFile:{sha256:'c'.repeat(64),bytes:100}};
 receipt.ownershipBeforeClose={present:true,sameProcess:true,ownerRecordSha256:'d'.repeat(64),nonce:'SECRET',hostname:'PRIVATE'};
 const proof=publicCloseProof({graceful:true,exit:{code:0},final:receipt}),text=JSON.stringify(proof);
 assert.equal(proof.closedStateFile.sha256,'c'.repeat(64));assert.ok(!text.includes('private-store'));assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('PRIVATE'));
});
for(const [name,change,code] of [
 ['missing close receipt',()=>null,'close-receipt-incomplete'],
 ['owner lock remains',x=>{x.ownershipAfterClose.present=true;return x;},'close-receipt-incomplete'],
 ['delayed commit array',x=>{x.journal.push({revision:2});return x;},'store-commit-or-capture-error-at-close'],
 ['close capture exception',x=>{x.captureErrors.push({stage:'failed'});return x;},'store-commit-or-capture-error-at-close'],
 ['missing finalized witness',x=>{x.witnesses=[];return x;},'finalized-witness-invalid'],
 ['still provisional',x=>{x.witnesses[0].provisional=true;return x;},'finalized-witness-invalid'],
 ['changed close bytes',x=>{x.finalSnapshot.calculation.sha256='c'.repeat(64);return x;},'input-changed-during-close'],
])test(name,()=>assert.equal(validateClosedWitness(change(goodClose()),'case','a'.repeat(64),'b'.repeat(64)).code,code));
test('only explicit one-case CLI is accepted and output cannot escape scratch',()=>{
 assert.equal(parseArgs(['--source','/source','--scratch','/scratch','--out','/scratch/result.json']).member,'explorer-1');
 assert.throws(()=>parseArgs(['--source','/source','--scratch','/scratch','--out','/elsewhere/result.json']),/PATH_NOT_OWNED/);
 assert.throws(()=>parseArgs(['--source','/source','--scratch','/scratch','--out','/scratch/result.json','--group','true']),/UNSUPPORTED_ONE_CASE/);
 assert.throws(()=>ownedPath('/scratch','/scratch/../source'),/PATH_NOT_OWNED/);
});
test('only observed source-proven receipt metadata is classified',()=>{
 const input=[{method:'POST',path:'/api/action-session',bodyKeys:['clientId'],status:200},
 {method:'POST',path:'/api/action-session',bodyKeys:['clientId','command'],status:200},
 {method:'POST',path:'/api/command',bodyKeys:[],status:200},{method:'POST',path:'/api/usage',status:200}];
 const r=classifyObservedWrites(input);assert.equal(r.observedMetadataWrites.length,1);assert.equal(r.semanticWriteAttempts.length,1);assert.equal(r.unclassifiedWrites.length,2);
 assert.equal(classifyObservedWrites([]).observedMetadataWrites.length,0);
});
test('token paths and queries never enter network path ledger',()=>{
 assert.equal(sanitizePath('http://127.0.0.1/join/SECRET?token=SECRET'),'/join/[redacted]');
 assert.equal(sanitizePath('http://127.0.0.1/overlay/SECRET?token=SECRET'),'/overlay/[redacted]');
 assert.equal(sanitizePath('http://127.0.0.1/api/tasks?auth=SECRET'),'/api/tasks');
});
test('view endpoint uses callback observation clock and exact pagination',()=>{
 const expected=buildExpected({rows:[{task:{id:'b',label:'B',category:'Mining',status:'blocked',blockers:[{detail:'Need level'}]}},{task:{id:'a',label:'A',category:'Mining',status:'available'}}]});
 assert.equal(expected.contrasting,'blocked');assert.deepEqual(expected.rows.map(r=>r.id),['a','b']);assert.equal(expected.contrastingRows[0].id,'b');
 const s=normalizeView({selectedFilter:'All 2',at:10,capturedAt:12,counts:{shown:2,matching:2,total:2},pageRows:[]});
 assert.equal(s.at,12);assert.equal(s.filter,'all');assert.equal(s.total,2);
});
test('initial DOM may use an earlier complete body but never a later body',()=>{
 const scope={memberId:'explorer-1',chunkId:'12850'},base={path:'/api/chunk-planning',complete:true,...scope};
 const early={...base,parsedAt:20},late={...base,parsedAt:50};
 assert.equal(choosePlanningBody([early,late],scope,30),early);assert.equal(choosePlanningBody([late],scope,30),null);
});
function fakeStore(){
 let state={revision:1,rules:{},members:[{id:'explorer-1'}],tasks:[]},listener,broken=false;
 return {getInfo:()=>({revision:state.revision}),getState:()=>{if(broken)throw Error('saved secret must not escape');return structuredClone(state);},
 getCalculationSnapshot:()=>({revision:state.revision,stateJSON:Buffer.from(JSON.stringify(state)),inputKey:'a'.repeat(64),taskInputKey:'b'.repeat(64)}),
 subscribe:callback=>{listener=callback;return()=>{listener=null;};},change:next=>{state=next;listener?.({revision:next.revision});},state:()=>structuredClone(state),break:()=>{broken=true;}};
}
function finishJournal(j){j.snapshot('before');j.snapshot('before-all');j.snapshot('after-frames');return j.finish('case');}
test('store witness remains subscribed through normal close',()=>{
 const j=createWitnessJournal(fakeStore());j.begin('case');assert.equal(finishJournal(j).valid,true);const final=j.finalize();assert.equal(final.witnesses[0].valid,true);assert.equal(final.witnesses[0].provisional,false);
});
test('change then revert cannot pass equal endpoint hashes',()=>{
 const store=fakeStore(),original=store.state(),j=createWitnessJournal(store);j.begin('case');store.change({...original,revision:2});store.change(original);finishJournal(j);const final=j.finalize();assert.equal(final.journal.length,2);assert.equal(final.witnesses[0].valid,false);
});
test('commit after finish invalidates authoritative closed witness',()=>{
 const store=fakeStore(),j=createWitnessJournal(store);j.begin('case');assert.equal(finishJournal(j).valid,true);store.change({...store.state(),revision:2});assert.equal(j.finalize().witnesses[0].valid,false);
});
test('capture failure is retained without saved error values',()=>{
 const store=fakeStore(),j=createWitnessJournal(store);j.begin('case');store.break();finishJournal(j);const result=j.finalize();assert.ok(result.captureErrors.length);assert.equal(result.witnesses[0].valid,false);assert.ok(!JSON.stringify(result).includes('saved secret'));
});
test('public case error code accepts only authored codes, never arbitrary uppercase exception text',()=>{
 assert.equal(codeOf(Error('REFERENCE_MAP_SCOPE_INVALID')),'reference-map-scope-invalid');
 assert.equal(codeOf(Error('HTTP_503')),'http-error');
 for(const text of ['SECRET','PRIVATE_BASE32_TOKEN','Bearer SECRET','https://example.invalid/SECRET'])assert.equal(codeOf(Error(text)),'runtime-error');
 assert.equal(codeOf({get message(){throw Error('SECRET');}}),'runtime-error');
 assert.equal(HARNESS_ERROR_MESSAGES.length,new Set(HARNESS_ERROR_MESSAGES).size);
 assert.equal(FAILURE_OPERATIONS.length,new Set(FAILURE_OPERATIONS).size);
});
test('post-failure survey keeps only fixed capability counts and ready-state enum',async()=>{
 const output=await capabilitySurvey({isClosed:()=>false,evaluate:async()=>({documentReadyState:'complete',tasksTabCount:1,tasksTabVisibleCount:1,possibleSummaryCount:0,url:'https://SECRET',text:'SECRET'})},2);
 assert.deepEqual(output,{surveyStatus:'observed',documentReadyState:'complete',tasksTabCount:1,tasksTabVisibleCount:1,possibleSummaryCount:0,pageErrorCount:2});
 assert.ok(!JSON.stringify(output).includes('SECRET'));
});
test('absent or closed page survey states unavailable with null counts rather than fake zero',async()=>{
 for(const page of [undefined,{isClosed:()=>true}])assert.deepEqual(await capabilitySurvey(page,0),{
  surveyStatus:'unavailable',documentReadyState:'unknown',tasksTabCount:null,tasksTabVisibleCount:null,possibleSummaryCount:null,pageErrorCount:0});
});
test('survey rejection never publishes exception fields or produces observed zeros',async()=>{
 const output=await capabilitySurvey({isClosed:()=>false,evaluate:async()=>{throw Error('https://SECRET');}},3);
 assert.equal(output.surveyStatus,'unavailable');assert.equal(output.tasksTabCount,null);assert.equal(output.pageErrorCount,3);
 assert.ok(!JSON.stringify(output).includes('SECRET'));
});
test('survey timeout remains bounded and explicitly unavailable',async()=>{
 const started=performance.now(),output=await capabilitySurvey({isClosed:()=>false,evaluate:()=>new Promise(()=>{})},1,15);
 assert.equal(output.surveyStatus,'timed-out');assert.equal(output.tasksTabCount,null);assert.ok(performance.now()-started<1000);
});
test('survey rejects unexpected strings, negative counts and noninteger counts',async()=>{
 const output=await capabilitySurvey({isClosed:()=>false,evaluate:async()=>({documentReadyState:'SECRET',tasksTabCount:'SECRET',tasksTabVisibleCount:-1,possibleSummaryCount:1.5})},-1);
 assert.deepEqual(output,{surveyStatus:'observed',documentReadyState:'unknown',tasksTabCount:null,tasksTabVisibleCount:null,possibleSummaryCount:null,pageErrorCount:null});
});
test('rejected CLI entry emits raw enum-only FD3 stages and closed diagnostics without starting the app',()=>{
 const sentinel='PRIVATE_CLI_SENTINEL',entry=fileURLToPath(new URL('./run-frozen-browser.mjs',import.meta.url));
 const child=spawnSync(process.execPath,[entry,'--unknown',sentinel],{env:{...process.env,PERF_STAGE_FD:'3'},
  stdio:['ignore','pipe','pipe','pipe'],encoding:'utf8',timeout:3000});
 assert.equal(child.status,1);assert.equal(child.stdout,'');
 const rows=child.output[3].trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows,[{stage:'error'},{stage:'result'}]);
 const summary=JSON.parse(child.stderr);assert.equal(summary.code,'unknown-argument');assert.equal(summary.failureOperation,'entry-setup');
 assert.match(summary.errorStackSha256,/^[a-f0-9]{64}$/);assert.ok(!child.stderr.includes(sentinel));
});
