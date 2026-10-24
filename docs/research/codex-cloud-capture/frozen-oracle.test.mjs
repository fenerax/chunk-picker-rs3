import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditFrozenPlanning,OPEN_GATES} from './frozen-oracle.mjs';
import {projectPlanningTask,auditPlanning} from './strict-oracle.mjs';
const sha = s=>createHash('sha256').update(s).digest('hex');
function bodyRecord(body) {const bodyText=JSON.stringify(body);return {complete:true,bodyText,bodySha256:sha(bodyText)};}
function fixture() {
  const rows=Array.from({length:65},(_,i)=>({task:{id:`task:${i}`,label:`Task ${i}`,category:'Mining',
    status:i%2?'blocked':'available',blockers:i%2?[{detail:`Reason ${i}`}]:[]}}));
  const body={format:'chunk-planning-v1',memberId:'explorer-1',chunkId:'12850',stateRevision:1,rows};
  const identity={sourceBundleSha256:'a'.repeat(64),expectedSourceManifestSha256:'a'.repeat(64),staticEnvelopeSha256:'b'.repeat(64),datasetDigest:'c'.repeat(64),
    fixtureSha256:'d'.repeat(64),calculatorBytesSha256:'e'.repeat(64)};
  const scope={memberId:'explorer-1',chunkId:'12850',revision:1,group:false,filter:'all'};
  const reference={schema:'r116-frozen-reference-v1',origin:'separate-untouched-baseline-instance',instanceId:'reference',
    ...identity,scope,...bodyRecord(body)};
  const projected=rows.map(r=>projectPlanningTask(r.task));
  const ordered=[...projected.filter(r=>!r.blocked),...projected.filter(r=>r.blocked)];
  const witness={schema:'r116-frozen-witness-v1',instanceId:'measured',...identity,
    ownership:{isolatedSave:true,writerLeaseHeld:true,sourceVerified:true,noOtherWriter:true},
    journal:{installedBeforeBegin:true,beginSequence:3,endSequence:3,events:[],captureErrors:[]},
    snapshots:['before','before-all','after-frames'].map(phase=>({phase,calculatorBytesSha256:identity.calculatorBytesSha256,fullStateSha256:'f'.repeat(64)})),
    semanticWriteAttempts:[],unclassifiedWrites:[],beginToken:'all:1',endToken:'all:1',
    beginAcknowledgedBeforeDispatch:true,endRequestedAfterFrames:true};
  const common={memberId:'explorer-1',nativeMemberValue:'explorer-1',chunkId:'12850',revision:1,group:false,paneVisible:true};
  const before={...common,filter:'blocked',allSelected:false,token:'pre:1',rows:ordered.filter(r=>r.blocked).slice(0,60)};
  const native={token:'all:1',preconditionToken:'pre:1',trusted:true,targetIsExactAllChip:true,capturedAt:20,label:'All 65'};
  const dom={...common,filter:'all',allSelected:true,token:'all:1',samePaneAndList:true,observedExactListMutation:true,
    at:22,shown:60,matching:65,total:65,showMoreHidden:false,searchValue:'',rows:ordered.slice(0,60)};
  const frames=[{...dom,at:30},{...dom,at:45}];
  const response={...bodyRecord(body),consumedAt:10,parsedAt:11};
  return {reference,response,witness,before,native,dom,frames};
}
test('complete independent fixed workload can pass without a wire input key',()=>{
 const r=auditFrozenPlanning(fixture());assert.equal(r.status,'correct');assert.equal(r.trustedCaptureToCorrectDOMMs,2);
 assert.deepEqual(r.openGates,[...OPEN_GATES]);assert.equal(r.strictR79Result,'unchanged; evaluate and retain separately');
});
test('existing strict oracle still blocks the absent wire key',()=>{
 const r=auditPlanning({request:{memberId:'explorer-1',revision:1,inputKey:null,generation:1,chunkId:'12850'}});
 assert.equal(r.status,'blocked');assert.equal(r.code,'unobservable-request-input-key-or-generation');
});
test('separately declared arm code may differ while fixed data stays identical',()=>{
 const x=fixture();x.witness.sourceBundleSha256='0'.repeat(64);x.witness.expectedSourceManifestSha256='0'.repeat(64);assert.equal(auditFrozenPlanning(x).status,'correct');
});
test('undeclared arm source change blocks output acceptance',()=>{
 const x=fixture();x.witness.sourceBundleSha256='0'.repeat(64);assert.equal(auditFrozenPlanning(x).code,'declared-arm-source-mismatch');
});
const controls=[
 ['reference copied from measured instance',x=>x.reference.instanceId=x.witness.instanceId,'reference-not-independent-instance'],
 ['static provider envelope changed',x=>x.witness.staticEnvelopeSha256='0'.repeat(64),'fixed-input-identity-mismatch'],
 ['complete calculator bytes changed',x=>x.witness.snapshots[1].calculatorBytesSha256='0'.repeat(64),'missing-or-changed-complete-calculator-snapshot'],
 ['input changed then reverted',x=>{x.witness.journal.events=[{sequence:4,kind:'changed'},{sequence:5,kind:'reverted'}];x.witness.journal.endSequence=5;},'input-interval-not-frozen'],
 ['journal callback failed',x=>x.witness.journal.captureErrors.push('capture failed'),'input-interval-not-frozen'],
 ['unclassified sidecar write',x=>x.witness.unclassifiedWrites.push({path:'/api/unknown',method:'POST'}),'meaningful-or-unclassified-write'],
 ['semantic command attempted',x=>x.witness.semanticWriteAttempts.push('/api/command'),'meaningful-or-unclassified-write'],
 ['full saved state changed silently',x=>x.witness.snapshots[2].fullStateSha256='0'.repeat(64),'missing-or-changed-complete-calculator-snapshot'],
 ['native action not bracketed',x=>x.witness.endRequestedAfterFrames=false,'unbracketed-native-episode'],
 ['partial reference retained',x=>x.reference.complete=false,'incomplete-or-malformed-body'],
 ['mismatch beyond initial first60',x=>{const b=JSON.parse(x.response.bodyText);b.rows[64].task.status='complete';Object.assign(x.response,bodyRecord(b));},'complete-body-reference-mismatch'],
 ['before pane was already All',x=>{x.before.filter='all';x.before.allSelected=true;},'contrasting-native-precondition-unproven'],
 ['wrong native chip',x=>x.native.targetIsExactAllChip=false,'trusted-all-transition-unproven'],
 ['wrong owner on page',x=>x.dom.memberId='explorer-2','view-scope'],
 ['wrong chunk on page',x=>x.dom.chunkId='12594','view-scope'],
 ['unexpected Group on',x=>x.dom.group=true,'view-scope'],
 ['inner page search retained',x=>x.dom.searchValue='Task 1','view-scope'],
 ['first blocker reason differs',x=>x.dom.rows[35]={...x.dom.rows[35],meta:'Mining · changed reason'},'page-row-order-status-or-reason'],
 ['missing exact list mutation',x=>x.dom.observedExactListMutation=false,'view-specific-completion-unproven'],
 ['headers only',x=>x.response.complete=false,'incomplete-or-malformed-body'],
 ['body arrives after DOM observation',x=>x.response.parsedAt=23,'body-not-consumed-before-dom'],
 ['later frame became stale',x=>x.frames[1].token='all:2','later-frame-opportunity-unproven'],
 ['incomplete total despite matching visible prefix',x=>x.dom.total=64,'page-total-or-pagination'],
];
for(const [name,mutate,code] of controls)test(name,()=>{const x=fixture();mutate(x);const r=auditFrozenPlanning(x);assert.notEqual(r.status,'correct');assert.equal(r.code,code);});
test('missing IDs require uniqueness across the complete reference, including beyond first60',()=>{
 const x=fixture();const b=JSON.parse(x.reference.bodyText);
 b.rows[64].task={...b.rows[0].task,id:'task:64'};
 Object.assign(x.reference,bodyRecord(b));Object.assign(x.response,bodyRecord(b));
 for(const view of [x.dom,...x.frames])view.rows=view.rows.map(({id,...r})=>r);
 assert.equal(auditFrozenPlanning(x).code,'ambiguous-page-identity');
});
