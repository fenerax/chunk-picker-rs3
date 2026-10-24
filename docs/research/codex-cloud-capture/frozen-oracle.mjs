// Ignored, data-only companion to R79. No product/provider/browser imports.
// This audits retained evidence; the child/adapter must capture that evidence.
import {createHash} from 'node:crypto';
import {projectPlanningTask} from './strict-oracle.mjs';

export const FROZEN_MODE = 'r116-frozen-input-v1';
export const OPEN_GATES = Object.freeze(['mutation-safety','fault-recovery','latest-generation',
  'other-inputs','group-on','physical-paint','independent-engine-correctness']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const stop = (status,code,extra={}) => ({mode:FROZEN_MODE,status,code,openGates:[...OPEN_GATES],...extra});
const key = row => JSON.stringify([row.label,row.meta,row.blocked]);
const semantic = row => {
  const task = row.task;
  const projection = projectPlanningTask(task);
  return {...projection,firstBlocker:task.blockers?.[0]?.detail ?? null};
};
export function parseBody(record) {
  if (record?.complete !== true || typeof record.bodyText !== 'string' ||
      !hex(record.bodySha256) || sha(record.bodyText) !== record.bodySha256) return null;
  try {
    const body=JSON.parse(record.bodyText);
    if(body.format!=='chunk-planning-v1'||!Array.isArray(body.rows))return null;
    const rows=body.rows.map(semantic);
    if(new Set(rows.map(row=>row.id)).size!==rows.length)return null;
    return {body,rows};
  } catch {return null;}
}
export function pageRowsMatch(actual,expected,counts) {
  if(!Array.isArray(actual)||actual.length!==expected.length)return 'page-row-count';
  for(let i=0;i<expected.length;i++) {
    const got=actual[i],want=expected[i];
    if(!got||got.label!==want.label||got.meta!==want.meta||got.blocked!==want.blocked||
       (Object.hasOwn(got,'status')&&got.status!==want.status))return 'page-row-order-status-or-reason';
    if(got.id!=null) {if(got.id!==want.id)return 'page-task-id';}
    else if(counts.get(key(want))!==1)return 'ambiguous-page-identity';
  }
  return null;
}
export function scopeMatches(view,scope) {
  return view?.memberId===scope.memberId&&view.nativeMemberValue===scope.memberId&&
    String(view.chunkId)===String(scope.chunkId)&&view.revision===scope.revision&&
    view.group===false&&view.paneVisible===true;
}
// reference: independently persisted complete baseline body + fixed input identity.
// witness: child-owned interval journal, not fields copied from the page or response.
export function auditFrozenInputs({reference,witness}={}) {
  if(reference?.schema!=='r116-frozen-reference-v1'||witness?.schema!=='r116-frozen-witness-v1')
    return stop('blocked','missing-versioned-reference-or-witness');
  if(reference.origin!=='separate-untouched-baseline-instance'||
     !reference.instanceId||!witness.instanceId||reference.instanceId===witness.instanceId)
    return stop('blocked','reference-not-independent-instance');
  for(const arm of [reference,witness])
    if(!hex(arm.sourceBundleSha256)||arm.sourceBundleSha256!==arm.expectedSourceManifestSha256)
      return stop('blocked','declared-arm-source-mismatch');
  for(const field of ['staticEnvelopeSha256','datasetDigest','fixtureSha256','calculatorBytesSha256'])
    if(!hex(reference[field])||reference[field]!==witness[field])return stop('blocked','fixed-input-identity-mismatch',{field});
  if(witness.ownership?.isolatedSave!==true||witness.ownership?.writerLeaseHeld!==true||
     witness.ownership?.sourceVerified!==true||witness.ownership?.noOtherWriter!==true)
    return stop('blocked','writer-or-source-ownership-unproven');
  const journal=witness.journal;
  if(journal?.installedBeforeBegin!==true||!Number.isInteger(journal.beginSequence)||
     journal.endSequence!==journal.beginSequence||!Array.isArray(journal.events)||journal.events.length||
     !Array.isArray(journal.captureErrors)||journal.captureErrors.length)
    return stop('blocked','input-interval-not-frozen');
  if(!Array.isArray(witness.semanticWriteAttempts)||witness.semanticWriteAttempts.length||
     !Array.isArray(witness.unclassifiedWrites)||witness.unclassifiedWrites.length)
    return stop('blocked','meaningful-or-unclassified-write');
  if(!Array.isArray(witness.snapshots)||witness.snapshots.length!==3||
     !eq(witness.snapshots.map(s=>s.phase),['before','before-all','after-frames'])||
     witness.snapshots.some(s=>s.calculatorBytesSha256!==reference.calculatorBytesSha256)||
     !hex(witness.snapshots[0].fullStateSha256)||
     witness.snapshots.some(s=>s.fullStateSha256!==witness.snapshots[0].fullStateSha256))
    return stop('blocked','missing-or-changed-complete-calculator-snapshot');
  return {mode:FROZEN_MODE,status:'valid',code:'frozen-inputs-verified'};
}
export function auditFrozenPlanning({reference,response,witness,native,before,dom,frames=[]}={}) {
  const input=auditFrozenInputs({reference,witness});if(input.status!=='valid')return input;
  if(!native?.token||native.token!==witness.beginToken||native.token!==witness.endToken||
     witness.beginAcknowledgedBeforeDispatch!==true||witness.endRequestedAfterFrames!==true)
    return stop('blocked','unbracketed-native-episode');
  const ref=parseBody(reference),observed=parseBody(response);
  if(!ref||!observed)return stop('blocked','incomplete-or-malformed-body');
  const scope=reference.scope;
  if(scope?.group!==false||scope.filter!=='all'||typeof scope.memberId!=='string'||scope.chunkId==null||
     !Number.isInteger(scope.revision))
    return stop('blocked','unsupported-fixed-scope');
  for(const body of [ref.body,observed.body])
    if(body.memberId!==scope.memberId||String(body.chunkId)!==String(scope.chunkId)||body.stateRevision!==scope.revision)
      return stop('incorrect','body-owner-or-chunk-mismatch');
  if(!eq(ref.rows,observed.rows))return stop('incorrect','complete-body-reference-mismatch');
  const ordered=[...ref.rows.filter(r=>!r.blocked),...ref.rows.filter(r=>r.blocked)];
  if(!ordered.length)return stop('blocked','empty-reference-cannot-prove-transition');
  const counts=new Map();for(const row of ref.rows)counts.set(key(row),(counts.get(key(row))??0)+1);
  const preFilter=ref.rows.some(row=>!row.blocked)?'blocked':'doable';
  const pre=ordered.filter(row=>preFilter==='blocked'?row.blocked:!row.blocked).slice(0,60);
  const expected=ordered.slice(0,60);
  if(!before?.token||!scopeMatches(before,scope)||before.filter!==preFilter||before.allSelected!==false||
     pageRowsMatch(before.rows,pre,counts)||eq(pre.map(key),expected.map(key)))
    return stop('blocked','contrasting-native-precondition-unproven');
  if(native.trusted!==true||native.targetIsExactAllChip!==true||!Number.isFinite(native.capturedAt)||
     native.label!==`All ${ordered.length}`||native.preconditionToken!==before.token)
    return stop('blocked','trusted-all-transition-unproven');
  const checkView=view=>{
    if(!scopeMatches(view,scope)||view.filter!=='all'||view.allSelected!==true||
       view.token!==native.token||view.samePaneAndList!==true||view.searchValue!=='')return 'view-scope';
    if(view.shown!==expected.length||view.matching!==ordered.length||view.total!==ordered.length||
       view.showMoreHidden!==(ordered.length<=60))return 'page-total-or-pagination';
    return pageRowsMatch(view.rows,expected,counts);
  };
  if(dom?.observedExactListMutation!==true||!Number.isFinite(dom.at)||dom.at<native.capturedAt)
    return stop('blocked','view-specific-completion-unproven');
  const domError=checkView(dom);if(domError)return stop(domError==='ambiguous-page-identity'?'blocked':'incorrect',domError);
  if(!Number.isFinite(response.consumedAt)||!Number.isFinite(response.parsedAt)||
     response.consumedAt>response.parsedAt||response.parsedAt>dom.at)
    return stop('blocked','body-not-consumed-before-dom');
  if(frames.length!==2||frames.some((f,i)=>!Number.isFinite(f.at)||f.at<(i?frames[i-1].at:dom.at)||checkView(f)))
    return stop('blocked','later-frame-opportunity-unproven');
  return stop('correct','matching-frozen-input-all-page',{
    scope:'fixed-workload-ui-projection',total:ordered.length,shown:expected.length,
    trustedCaptureToCorrectDOMMs:dom.at-native.capturedAt,
    trustedCaptureToLaterFrameOpportunityMs:frames[1].at-native.capturedAt,
    physicalPaint:'unobserved',wireInputKey:'not-required-in-this-fixed-input-mode',
    strictR79Result:'unchanged; evaluate and retain separately'});
}
