import {createHash} from 'node:crypto';
export const OPS=Object.freeze(['unknown','entry-admission','manifest-check','source-install','cell-launch','cell-wait','cell-import-fixture','cell-import-projection','cell-mode-admission','app-import-process','app-import-scheduler','app-import-state','app-import-world','app-import-dataset','fixture-definition','fixture-scheduler-start','fixture-warm','fixture-warm-assert','fixture-planning','phase-proof','reference-comparison','intent-body','intent-cleanup','cell-complete','child-error','child-exit','cell-timeout']);
export const INTENTS=Object.freeze(['none','initial','declaration','task','classification','negative-control']);
export const CODES=Object.freeze(['none','other','ERR_ASSERTION','ERR_MODULE_NOT_FOUND','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ENOENT','EACCES','DATASET_PACK_INVALID','ERR_WORKER_OUT_OF_MEMORY','ERR_WORKER_INIT_FAILED','ERR_WORKER_UNSUPPORTED_OPERATION','ERR_UNHANDLED_ERROR']);
export const NAMES=Object.freeze(['none','other','Error','AssertionError','TypeError','RangeError','SyntaxError','AbortError']);
export const WARM_FIELDS=Object.freeze(['none','warm-row-count','baseline-receipt-present','baseline-input-match','baseline-member-match','baseline-revision','baseline-key-string','eligible-badge-count','projection-key-count','prewarm-declaration-count']);
const sha=value=>createHash('sha256').update(value).digest('hex');let context={intent:'none',mode:'none'},operation='unknown',warm={field:'none',expected:-1,actual:-1};
export function setDiagnosticContext(intent,mode){context={intent:INTENTS.includes(intent)?intent:'none',mode:['thread','process'].includes(mode)?mode:'none'};}
export function diagnostic(op,error,outcome='progress'){
 operation=OPS.includes(op)?op:'unknown';return {type:'r131-diagnostic-v2',operation,intent:context.intent,mode:context.mode,outcome:['progress','failed','complete'].includes(outcome)?outcome:'failed',errorCode:error?(CODES.includes(error.code)?error.code:'other'):'none',errorName:error?(NAMES.includes(error.name)?error.name:'other'):'none',errorSha256:error?sha(String(error.stack??error.message??error)):'0'.repeat(64),warmField:operation==='fixture-warm-assert'?warm.field:'none',warmExpected:operation==='fixture-warm-assert'?warm.expected:-1,warmActual:operation==='fixture-warm-assert'?warm.actual:-1};
}
export function note(op,error,outcome='progress'){const event=diagnostic(op,error,outcome);process.send?.(event);return event;}
export function currentOperation(){return operation;}
export function warmAssertion(field,expected,actual,assertion){
 if(!WARM_FIELDS.includes(field)||field==='none'||!Number.isSafeInteger(expected)||expected<0||expected>1e9)throw Error('invalid fixed warm assertion metadata');warm={field,expected,actual:Number.isSafeInteger(actual)&&actual>=0&&actual<=1e9?actual:-1};note('fixture-warm-assert');try{return assertion();}catch(error){note('fixture-warm-assert',error,'failed');throw error;}
}
export function checkedDiagnostic(event){
 if(event?.type!=='r131-diagnostic-v2'||!OPS.includes(event.operation)||!INTENTS.includes(event.intent)||!['none','thread','process'].includes(event.mode)||!['progress','failed','complete'].includes(event.outcome)||!CODES.includes(event.errorCode)||!NAMES.includes(event.errorName)||!/^[0-9a-f]{64}$/.test(event.errorSha256??'')||!WARM_FIELDS.includes(event.warmField)||![event.warmExpected,event.warmActual].every(n=>Number.isSafeInteger(n)&&n>=-1&&n<=1e9))return null;
 return {type:event.type,operation:event.operation,intent:event.intent,mode:event.mode,outcome:event.outcome,errorCode:event.errorCode,errorName:event.errorName,errorSha256:event.errorSha256,warmField:event.warmField,warmExpected:event.warmExpected,warmActual:event.warmActual};
}
export function diagnosticProjection(events,records){
 const safe=events.map(checkedDiagnostic).filter(Boolean),chosen=safe.find(e=>e.outcome==='failed')??safe.at(-1)??diagnostic('unknown');let observed=0,passed=0;
 for(const cell of records??[])for(const row of cell.records??[])if(['PASS','FAIL'].includes(row.status)){observed++;if(row.status==='PASS')passed++;}
 return {r131DiagnosticOperation:chosen.operation,r131DiagnosticIntent:chosen.intent,r131DiagnosticMode:chosen.mode,r131DiagnosticOutcome:chosen.outcome,r131DiagnosticErrorCode:chosen.errorCode,r131DiagnosticErrorName:chosen.errorName,r131DiagnosticErrorSha256:chosen.errorSha256,r131DiagnosticEventsSha256:sha(JSON.stringify(safe)),r131WarmAssertionField:chosen.warmField,metrics:{r131ObservedEpisodeCount:observed,r131PassedEpisodeCount:passed,r131WarmExpected:chosen.warmExpected,r131WarmActual:chosen.warmActual}};
}
