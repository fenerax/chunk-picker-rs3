import {projectPlanningTask} from './strict-oracle.mjs';
import {auditFrozenInputs,parseBody,pageRowsMatch,scopeMatches,FROZEN_MODE,OPEN_GATES} from './frozen-oracle.mjs';
const skills=new Set(['Agility','Archaeology','Attack','Constitution','Construction','Cooking','Crafting','Defence','Divination','Dungeoneering','Farming','Firemaking','Fishing','Fletching','Herblore','Hunter','Invention','Magic','Mining','Necromancy','Prayer','Ranged','Runecrafting','Slayer','Smithing','Strength','Summoning','Thieving','Woodcutting']);
const stop=(status,code,extra={})=>({mode:FROZEN_MODE,status,code,openGates:[...OPEN_GATES],...extra});
const key=row=>JSON.stringify([row.label,row.meta,row.blocked]);
export function initialExpectations(body,mapTaskIds){
  const rows=[...body.rows.filter(row=>row.task.status==='available'),...body.rows.filter(row=>row.task.status!=='available')];
  const top=new Map();
  for(const row of rows)if(row.task.status==='available'&&skills.has(row.task.category)&&Number.isFinite(Number(row.task.level))){
    const best=top.get(row.task.category);if(!best||Number(row.task.level)>Number(best.task.level))top.set(row.task.category,row);
  }
  const ids=Array.isArray(mapTaskIds)?new Set(mapTaskIds):null;
  const filters={all:rows,doable:rows.filter(row=>row.task.status==='available'),blocked:rows.filter(row=>row.task.status!=='available'),
    highest:rows.filter(row=>row.task.status==='available'&&(skills.has(row.task.category)?top.get(row.task.category)===row:true)),
    ...(ids?{map:rows.filter(row=>ids.has(row.task.id))}:{})};
  return Object.fromEntries(Object.entries(filters).map(([filter,values])=>[filter,{rows:values.slice(0,60).map(row=>projectPlanningTask(row.task)),
    counts:values.length?{shown:Math.min(60,values.length),matching:values.length,total:values.length}:{shown:null,matching:null,total:null},
    totalExpected:values.length,showMoreHidden:values.length?values.length<=60:null,searchValue:''}]));
}
export function auditOpeningProjection({reference,response,witness,transition,expectedByFilter}={}){
  const fixed=auditFrozenInputs({reference,witness});if(fixed.status!=='valid')return fixed;
  const ref=parseBody(reference),observed=parseBody(response);
  if(!ref||!observed)return stop('blocked','opening-complete-body-unobserved');
  if(JSON.stringify(ref.rows)!==JSON.stringify(observed.rows))return stop('incorrect','opening-complete-reference-mismatch');
  const scope=reference.scope;
  for(const body of [ref.body,observed.body])if(body.memberId!==scope.memberId||String(body.chunkId)!==String(scope.chunkId)||body.stateRevision!==scope.revision)
    return stop('incorrect','opening-body-scope-mismatch');
  const native=transition?.nativeTasks??transition?.native;
  if(!transition?.token||transition.token!==witness.openingToken||witness.beginAcknowledgedBeforeOpening!==true||
     native?.trusted!==true||native.targetIsExactTasksTab!==true||!Number.isFinite(native.capturedAt)||
     transition.before?.paneCount!==0)return stop('blocked','opening-native-trigger-unproven');
  const dom=transition.dom,frames=transition.frames??[];
  const filter=dom?.selectedFilterKey??dom?.filter,expected=expectedByFilter?.[filter];
  if(!expected)return stop('blocked','opening-initial-filter-reference-unavailable');
  const counts=new Map();for(const row of ref.rows)counts.set(key(row),(counts.get(key(row))??0)+1);
  const check=view=>{
    if(!scopeMatches(view,scope)||view.token!==transition.token||view.samePaneAndList!==true||view.searchValue!==''||
       (view.selectedFilterKey??view.filter)!==filter)return 'opening-view-scope';
    for(const field of ['shown','matching','total'])if(view[field]!==expected.counts[field])return 'opening-pagination-count';
    if(view.showMoreHidden!==expected.showMoreHidden)return 'opening-show-more-state';
    return pageRowsMatch(view.rows,expected.rows,counts);
  };
  if(!dom||dom.observedChunkContentMutation!==true||!Number.isFinite(dom.at)||dom.at<native.capturedAt)return stop('blocked','opening-dom-completion-unobserved');
  const error=check(dom);if(error)return stop(error==='ambiguous-page-identity'?'blocked':'incorrect',error);
  if(!Number.isFinite(response.consumedAt)||!Number.isFinite(response.parsedAt)||response.consumedAt>response.parsedAt||response.parsedAt>dom.at)
    return stop('blocked','opening-body-consumption-unproven');
  if(frames.length!==2||frames.some((frame,i)=>!Number.isFinite(frame.at)||frame.at<(i?frames[i-1].at:dom.at)||check(frame)))
    return stop('blocked','opening-later-frame-opportunity-unproven');
  const expansion=transition.nativeExpansion;
  return stop('correct','matching-frozen-input-initial-page',{initialFilter:filter,total:expected.totalExpected,shown:expected.rows.length,
    tasksCaptureToCorrectDOMMs:dom.at-native.capturedAt,tasksCaptureToLaterFrameOpportunityMs:frames[1].at-native.capturedAt,
    ...(Number.isFinite(expansion?.capturedAt)?{expansionCaptureToCorrectDOMMs:dom.at-expansion.capturedAt,
      expansionCaptureToLaterFrameOpportunityMs:frames[1].at-expansion.capturedAt}:{}),
    trigger:'tasks-tab-with-expansion-recorded-separately',physicalPaint:'unobserved'});
}
