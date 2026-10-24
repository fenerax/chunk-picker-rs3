// Closed tab-action observations only; never starts or imports the native test/app.
import { TAB_PHASES,TAB_ACTIONS,ACTIVE_KINDS,projectTabRecord } from './tests/task-focus-native.tab-diagnostic.mjs';
export const TAB_FLAGS = Object.freeze(['focusTabObserved','focusTabBPresent','focusTabBVisible','focusTabBEnabled','focusTabDocumentFocused',
  'focusTabHideCompleted','focusTabShowBlocked','focusTabShowAll','focusTabGroup','focusTabFilterEmpty','focusTabOwnerMatches',
  'focusTabScopeSame','focusTabLiveObserved','focusTabAfterPendingScopeSame']);
export const TAB_METRICS = Object.freeze(['focusTabIndex','focusTabACount','focusTabBCount','focusTabActiveCheckboxCount','focusTabMoreCount',
  'focusTabRequestGeneration','focusTabRenderGeneration','focusTabRecordCount','focusTabMalformedRecordCount','focusTabBeforeBCount','focusTabAfterPendingBCount']);
export const TAB_ENUMS = Object.freeze({focusTabPhase:TAB_PHASES,focusTabAction:TAB_ACTIONS,focusTabActiveKind:ACTIVE_KINDS});
const flags={bPresent:'focusTabBPresent',bVisible:'focusTabBVisible',bEnabled:'focusTabBEnabled',documentFocused:'focusTabDocumentFocused',
  hideCompleted:'focusTabHideCompleted',showBlocked:'focusTabShowBlocked',showAll:'focusTabShowAll',group:'focusTabGroup',filterEmpty:'focusTabFilterEmpty',
  ownerMatches:'focusTabOwnerMatches',scopeSame:'focusTabScopeSame',liveObserved:'focusTabLiveObserved'};
const counts={index:'focusTabIndex',aCount:'focusTabACount',bCount:'focusTabBCount',activeCheckboxCount:'focusTabActiveCheckboxCount',moreCount:'focusTabMoreCount',
  requestGeneration:'focusTabRequestGeneration',renderGeneration:'focusTabRenderGeneration'};
export function projectTabDiagnostic(value={}) {
  const out={},metrics={};
  for(const key of TAB_FLAGS)if(typeof value[key]==='boolean')out[key]=value[key];
  for(const [key,values]of Object.entries(TAB_ENUMS))if(values.includes(value[key]))out[key]=value[key];
  for(const key of TAB_METRICS)if(Number.isSafeInteger(value.metrics?.[key])&&value.metrics[key]>=0&&value.metrics[key]<=1000000)metrics[key]=value.metrics[key];
  if(Object.keys(metrics).length)out.metrics=metrics;
  return out;
}
export function tabExecutionDiagnostic(raw) {
  const out={focusTabObserved:false,metrics:{}};
  if(typeof raw!=='string'||Buffer.byteLength(raw)>1048576)return out;
  const lines=raw.split('\n').filter(line=>line.startsWith('r125-tab-diagnostic '));
  const records=[];let malformed=Math.max(0,lines.length-64);
  for(const line of lines.slice(0,64)){
    if(Buffer.byteLength(line)>8192){malformed++;continue;}
    try{const value=projectTabRecord(JSON.parse(line.slice('r125-tab-diagnostic '.length)));if(value)records.push(value);else malformed++;}catch{malformed++;}
  }
  out.metrics.focusTabRecordCount=records.length;out.metrics.focusTabMalformedRecordCount=Math.min(1000000,malformed);
  out.focusTabObserved=records.length>0;
  const before=records.find(record=>record.phase==='before-command'),after=records.find(record=>record.phase==='after-pending');
  if(Number.isSafeInteger(before?.bCount))out.metrics.focusTabBeforeBCount=before.bCount;
  if(Number.isSafeInteger(after?.bCount))out.metrics.focusTabAfterPendingBCount=after.bCount;
  if(typeof after?.scopeSame==='boolean')out.focusTabAfterPendingScopeSame=after.scopeSame;
  const last=records.findLast(record=>record.phase==='failure')??records.at(-1);
  if(last){out.focusTabPhase=last.phase;out.focusTabAction=last.action;if(last.activeKind)out.focusTabActiveKind=last.activeKind;
    for(const [key,name]of Object.entries(flags))if(typeof last[key]==='boolean')out[name]=last[key];
    for(const [key,name]of Object.entries(counts))if(Number.isSafeInteger(last[key]))out.metrics[name]=last[key];
  }
  return projectTabDiagnostic(out);
}
