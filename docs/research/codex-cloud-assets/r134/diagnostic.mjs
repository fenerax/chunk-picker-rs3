import {createHash} from 'node:crypto';

export const operations=Object.freeze(['entry-admission','packet-verification','scope-admission','candidate-source-stage','arm-spawn','arm-admission','provider-setup','engine-construction','catalogue-migration-setup','identity-check','case-clone','case-evaluate','case-input-immutability','case-definition-immutability','case-descriptor-oracle','case-cache-evidence','case-fingerprint','case-persist','case-compare','arm-summary','arm-ipc','arm-timeout','arm-exit','screen-deadline','screen-assessment','result-projection','unknown-operation']);
export const errorNames=Object.freeze(['AssertionError','Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','AggregateError','UnknownError']);
export const errorCodes=Object.freeze(['ERR_ASSERTION','ENOENT','EACCES','EPERM','EEXIST','EPIPE','ERR_IPC_CHANNEL_CLOSED','ERR_IPC_DISCONNECTED','ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION','child-timeout','child-ipc-protocol','child-exit-failed','screen-deadline','unknown-code']);
export const failureKeys=Object.freeze(['r134FailureOperation','r134FailureErrorName','r134FailureErrorCode','r134FailureStackSha256','r134FailureProcessOrdinal','r134FailureCellOrdinal']);
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
export function safeFailure(error,{operation,caseOrdinal,processOrdinal}={}){
 const out={r134FailureOperation:operations.includes(operation)?operation:'unknown-operation',r134FailureErrorName:errorNames.includes(error?.name)?error.name:'UnknownError',r134FailureErrorCode:errorCodes.includes(error?.code)?error.code:'unknown-code'};
 if(typeof error?.stack==='string'&&error.stack.length)out.r134FailureStackSha256=createHash('sha256').update(error.stack).digest('hex');
 if(integer(processOrdinal,11)){out.r134FailureProcessOrdinal=processOrdinal;if(integer(caseOrdinal,3))out.r134FailureCellOrdinal=processOrdinal*4+caseOrdinal;}
 return out;
}
export function validFailure(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!failureKeys.includes(k)))return false;
 if(!operations.includes(value.r134FailureOperation)||!errorNames.includes(value.r134FailureErrorName)||!errorCodes.includes(value.r134FailureErrorCode))return false;
 if(Object.hasOwn(value,'r134FailureStackSha256')&&!/^[a-f0-9]{64}$/.test(value.r134FailureStackSha256))return false;
 if(Object.hasOwn(value,'r134FailureProcessOrdinal')&&!integer(value.r134FailureProcessOrdinal,11))return false;
 if(Object.hasOwn(value,'r134FailureCellOrdinal')&&(!integer(value.r134FailureCellOrdinal,47)||Math.floor(value.r134FailureCellOrdinal/4)!==value.r134FailureProcessOrdinal))return false;
 return true;
}
export function firstFailure(previous,next){if(previous)return previous;if(!validFailure(next))throw Error('invalid closed diagnostic');return Object.freeze({...next});}
export function bindChildFailure(value,processOrdinal,caseOrdinal){
 if(!validFailure(value)||!integer(processOrdinal,11)||(caseOrdinal!==undefined&&!integer(caseOrdinal,3)))throw Error('invalid child diagnostic');
 const out={r134FailureOperation:value.r134FailureOperation,r134FailureErrorName:value.r134FailureErrorName,r134FailureErrorCode:value.r134FailureErrorCode,r134FailureProcessOrdinal:processOrdinal};
 if(value.r134FailureStackSha256!==undefined)out.r134FailureStackSha256=value.r134FailureStackSha256;
 if(caseOrdinal!==undefined)out.r134FailureCellOrdinal=processOrdinal*4+caseOrdinal;
 return out;
}
export function createDiagnostic(emit=()=>{}){
 let operation='unknown-operation',caseOrdinal,timedSamples,verifiedSamples;
 return Object.freeze({
  mark(next,ordinal){if(!operations.includes(next))throw Error('unknown diagnostic operation');operation=next;caseOrdinal=integer(ordinal,3)?ordinal:undefined;emit({stage:'operation',operation,...(caseOrdinal===undefined?{}:{caseOrdinal})});},
  timed(){timedSamples=(timedSamples??0)+1;emit({stage:'sample-timed',count:timedSamples});},
  verified(){verifiedSamples=(verifiedSamples??0)+1;},
  failure(error,processOrdinal){return safeFailure(error,{operation,caseOrdinal,processOrdinal});},
  counts(){return {...(timedSamples===undefined?{}:{timedSamples}),...(verifiedSamples===undefined?{}:{verifiedSamples})};},
  context(){return {operation,...(caseOrdinal===undefined?{}:{caseOrdinal})};},
 });
}
const emit=event=>{if(typeof process.send==='function'&&process.connected)try{process.send({schema:'r134-child-v1',...event},()=>{});}catch{}};
export const diagnostic=createDiagnostic(emit);
