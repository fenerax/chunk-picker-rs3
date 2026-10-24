import {createHash} from 'node:crypto';
export const OPS=Object.freeze(['unknown','entry-admission','manifest-check','source-install','cell-launch','cell-wait','cell-import-fixture','cell-import-projection','cell-mode-admission','app-import-process','app-import-scheduler','app-import-state','app-import-world','app-import-dataset','fixture-definition','fixture-scheduler-start','fixture-warm','fixture-planning','phase-proof','reference-comparison','intent-body','intent-cleanup','cell-complete','child-error','child-exit','cell-timeout']);
export const INTENTS=Object.freeze(['none','initial','declaration','task','classification','negative-control']);
export const CODES=Object.freeze(['none','other','ERR_ASSERTION','ERR_MODULE_NOT_FOUND','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ENOENT','EACCES','DATASET_PACK_INVALID','ERR_WORKER_OUT_OF_MEMORY','ERR_WORKER_INIT_FAILED','ERR_WORKER_UNSUPPORTED_OPERATION','ERR_UNHANDLED_ERROR']);
export const NAMES=Object.freeze(['none','other','Error','AssertionError','TypeError','RangeError','SyntaxError','AbortError']);
const sha=value=>createHash('sha256').update(value).digest('hex');let context={intent:'none',mode:'none'},operation='unknown';
export function setDiagnosticContext(intent,mode){context={intent:INTENTS.includes(intent)?intent:'none',mode:['thread','process'].includes(mode)?mode:'none'};}
export function diagnostic(op,error,outcome='progress'){
 operation=OPS.includes(op)?op:'unknown';return {type:'r131-diagnostic-v2',operation,intent:context.intent,mode:context.mode,outcome:['progress','failed','complete'].includes(outcome)?outcome:'failed',errorCode:error?(CODES.includes(error.code)?error.code:'other'):'none',errorName:error?(NAMES.includes(error.name)?error.name:'other'):'none',errorSha256:error?sha(String(error.stack??error.message??error)):'0'.repeat(64)};
}
export function note(op,error,outcome='progress'){const event=diagnostic(op,error,outcome);process.send?.(event);return event;}
export function currentOperation(){return operation;}
export function checkedDiagnostic(event){
 if(event?.type!=='r131-diagnostic-v2'||!OPS.includes(event.operation)||!INTENTS.includes(event.intent)||!['none','thread','process'].includes(event.mode)||!['progress','failed','complete'].includes(event.outcome)||!CODES.includes(event.errorCode)||!NAMES.includes(event.errorName)||!/^[0-9a-f]{64}$/.test(event.errorSha256??''))return null;
 return {type:event.type,operation:event.operation,intent:event.intent,mode:event.mode,outcome:event.outcome,errorCode:event.errorCode,errorName:event.errorName,errorSha256:event.errorSha256};
}
export function diagnosticProjection(events,records){
 const safe=events.map(checkedDiagnostic).filter(Boolean),chosen=safe.find(e=>e.outcome==='failed')??safe.at(-1)??diagnostic('unknown');let observed=0,passed=0;
 for(const cell of records??[])for(const row of cell.records??[])if(['PASS','FAIL'].includes(row.status)){observed++;if(row.status==='PASS')passed++;}
 return {r131DiagnosticOperation:chosen.operation,r131DiagnosticIntent:chosen.intent,r131DiagnosticMode:chosen.mode,r131DiagnosticOutcome:chosen.outcome,r131DiagnosticErrorCode:chosen.errorCode,r131DiagnosticErrorName:chosen.errorName,r131DiagnosticErrorSha256:chosen.errorSha256,r131DiagnosticEventsSha256:sha(JSON.stringify(safe)),metrics:{r131ObservedEpisodeCount:observed,r131PassedEpisodeCount:passed}};
}
