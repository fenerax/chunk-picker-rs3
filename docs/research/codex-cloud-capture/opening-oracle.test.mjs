import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initialExpectations,auditOpeningProjection} from './opening-oracle.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const body={format:'chunk-planning-v1',memberId:'explorer-1',chunkId:'12850',stateRevision:1,rows:[
  {task:{id:'low',label:'Low',category:'Mining',level:1,status:'available'}},
  {task:{id:'high',label:'High',category:'Mining',level:50,status:'available'}},
  {task:{id:'blocked',label:'Blocked',category:'Mining',level:70,status:'blocked',blockers:[{detail:'Need level 70'}]}}]};
 const bodyText=JSON.stringify(body),record={complete:true,bodyText,bodySha256:sha(bodyText)},same='a'.repeat(64);
 const identity={sourceBundleSha256:same,expectedSourceManifestSha256:same,staticEnvelopeSha256:same,datasetDigest:same,fixtureSha256:same,calculatorBytesSha256:same};
 const reference={schema:'r116-frozen-reference-v1',origin:'separate-untouched-baseline-instance',instanceId:'reference',...identity,...record,
  scope:{memberId:'explorer-1',chunkId:'12850',revision:1,group:false,filter:'all'}};
 const witness={schema:'r116-frozen-witness-v1',instanceId:'measured',...identity,ownership:{isolatedSave:true,writerLeaseHeld:true,sourceVerified:true,noOtherWriter:true},
  journal:{installedBeforeBegin:true,beginSequence:0,endSequence:0,events:[],captureErrors:[]},semanticWriteAttempts:[],unclassifiedWrites:[],
  snapshots:['before','before-all','after-frames'].map(phase=>({phase,calculatorBytesSha256:same,fullStateSha256:same})),openingToken:'opening',beginAcknowledgedBeforeOpening:true};
 const expectedByFilter=initialExpectations(body,['high']),expected=expectedByFilter.map;
 const dom={memberId:'explorer-1',nativeMemberValue:'explorer-1',chunkId:'12850',revision:1,group:false,paneVisible:true,token:'opening',
  samePaneAndList:true,observedChunkContentMutation:true,searchValue:'',selectedFilterKey:'map',shown:1,matching:1,total:1,showMoreHidden:true,
  rows:expected.rows,at:30};
 const transition={token:'opening',before:{paneCount:0},nativeTasks:{trusted:true,targetIsExactTasksTab:true,capturedAt:10},
  nativeExpansion:{trusted:true,targetIsExactPossibleTasksSummary:true,capturedAt:15},dom,frames:[{...dom,at:40},{...dom,at:50}]};
 return {reference,response:{...record,consumedAt:20,parsedAt:21},witness,transition,expectedByFilter,body};
}
test('initial subset uses independent map IDs and exact highest-level semantics',()=>{
 const x=fixture();assert.deepEqual(x.expectedByFilter.map.rows.map(r=>r.id),['high']);
 assert.deepEqual(x.expectedByFilter.highest.rows.map(r=>r.id),['high']);assert.equal(x.expectedByFilter.doable.totalExpected,2);
 assert.equal(x.expectedByFilter.blocked.rows[0].meta,'Mining · Need level 70');
});
test('opening timing retains Tasks and separate expansion intervals',()=>{
 const r=auditOpeningProjection(fixture());assert.equal(r.status,'correct');assert.equal(r.tasksCaptureToCorrectDOMMs,20);
 assert.equal(r.expansionCaptureToCorrectDOMMs,15);assert.equal(r.tasksCaptureToLaterFrameOpportunityMs,40);
});
for(const [name,change,code] of [
 ['missing Tasks native witness',x=>x.transition.nativeTasks.trusted=false,'opening-native-trigger-unproven'],
 ['already-open pane is not first opening',x=>x.transition.before.paneCount=1,'opening-native-trigger-unproven'],
 ['initial subset swapped to All',x=>x.transition.dom.rows=x.expectedByFilter.all.rows,'page-row-count'],
 ['unreferenced initial filter',x=>x.transition.dom.selectedFilterKey='unknown','opening-initial-filter-reference-unavailable'],
 ['missing actual opening mutation',x=>x.transition.dom.observedChunkContentMutation=false,'opening-dom-completion-unobserved'],
 ['wrong reason in initial blocked filter',x=>{const v={...x.transition.dom,selectedFilterKey:'blocked',rows:[{...x.expectedByFilter.blocked.rows[0],meta:'Mining · wrong'}]};x.transition.dom=v;},'page-row-order-status-or-reason'],
 ['later initial frame has stale owner',x=>x.transition.frames[1].memberId='explorer-2','opening-later-frame-opportunity-unproven'],
])test(name,()=>{const x=fixture();change(x);assert.equal(auditOpeningProjection(x).code,code);});
test('empty source projection keeps absent counter state explicit',()=>{
 const body={rows:[{task:{id:'blocked',label:'Blocked',category:'Mining',status:'blocked'}}]};
 const expected=initialExpectations(body,[]);assert.equal(expected.doable.totalExpected,0);assert.deepEqual(expected.doable.counts,{shown:null,matching:null,total:null});
});
