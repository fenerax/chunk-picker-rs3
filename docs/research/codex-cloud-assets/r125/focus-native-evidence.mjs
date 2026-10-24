// Closed child observations. This never starts/imports a native fixture or app.
import { DIAGNOSTIC_OPERATIONS, DIAGNOSTIC_NAMES, DIAGNOSTIC_CODES, DIAGNOSTIC_MODULES, projectRecord } from './tests/task-focus-native.diagnostic.mjs';
export const NATIVE_SIGNALS = Object.freeze(['none','SIGTERM','SIGKILL','SIGABRT','SIGSEGV','SIGINT','SIGHUP','SIGPIPE','SIGBUS','SIGILL','unknown']);
export const NATIVE_FLAGS = Object.freeze(['focusNativeExitObserved','focusNativeSummaryObserved','focusNativeDiagnosticObserved','focusNativeOutputComplete']);
export const NATIVE_METRICS = Object.freeze(['focusNativeExitCode','focusNativeOutputBytes','focusNativeTestCount','focusNativePassCount','focusNativeFailCount',
  'focusNativeCancelledCount','focusNativeSkippedCount','focusNativeCaseStartCount','focusNativeCaseEndCount','focusNativeDiagnosticCount',
  'focusNativeMalformedDiagnosticCount','focusNativeWitnessCount','focusNativeCommandProofCount','focusNativeFixtureDrainCount',
  'focusNativeFailureLine','focusNativeFailureColumn','focusNativeOperationCount']);
export const NATIVE_ENUMS = Object.freeze({focusNativeSignal:NATIVE_SIGNALS,focusNativeFailureKind:['failure','fixture-failure'],
  focusNativeFailureOperation:DIAGNOSTIC_OPERATIONS,focusNativeFailureName:DIAGNOSTIC_NAMES,
  focusNativeFailureCode:DIAGNOSTIC_CODES,focusNativeFailureModule:DIAGNOSTIC_MODULES});
export function projectNativeDiagnostic(value={}) {
  const out={},metrics={};
  for(const key of NATIVE_FLAGS)if(typeof value[key]==='boolean')out[key]=value[key];
  for(const [key,values]of Object.entries(NATIVE_ENUMS))if(values.includes(value[key]))out[key]=value[key];
  for(const key of NATIVE_METRICS)if(Number.isSafeInteger(value.metrics?.[key])&&value.metrics[key]>=0&&value.metrics[key]<=1048576)metrics[key]=value.metrics[key];
  if(Object.keys(metrics).length)out.metrics=metrics;
  return out;
}
export function nativeExecutionDiagnostic(raw,code,signal) {
  const complete=typeof raw==='string'&&Buffer.byteLength(raw)<=1048576;
  const knownSignal=NATIVE_SIGNALS.includes(signal)&&!['none','unknown'].includes(signal);
  const out={focusNativeExitObserved:(Number.isInteger(code)&&code>=0&&code<=255)||(code===null&&knownSignal),
    focusNativeSignal:signal===null?'none':NATIVE_SIGNALS.includes(signal)?signal:'unknown',focusNativeOutputComplete:complete,
    focusNativeSummaryObserved:false,focusNativeDiagnosticObserved:false,metrics:{}};
  if(Number.isInteger(code)&&code>=0&&code<=255)out.metrics.focusNativeExitCode=code;
  if(!complete)return out;
  out.metrics.focusNativeOutputBytes=Buffer.byteLength(raw);
  const text=raw.replace(/\x1b\[[0-9;]*m/g,''),lines=text.split('\n');
  const names=[['tests','focusNativeTestCount'],['pass','focusNativePassCount'],['fail','focusNativeFailCount'],['cancelled','focusNativeCancelledCount'],['skipped','focusNativeSkippedCount']];
  for(const [label,key]of names){const matches=[...text.matchAll(new RegExp('^ℹ '+label+' (\\d+)\\s*$','gm'))];if(matches.length===1&&Number(matches[0][1])<=10000)out.metrics[key]=Number(matches[0][1]);}
  out.focusNativeSummaryObserved=names.every(([,key])=>Object.hasOwn(out.metrics,key));
  const records=[];let malformed=0;
  const tagged=lines.filter(line=>line.startsWith('r125-native-diagnostic '));
  for(const line of tagged.slice(0,64)){
    if(Buffer.byteLength(line)>16384){malformed++;continue;}
    try{const record=projectRecord(JSON.parse(line.slice('r125-native-diagnostic '.length)));if(record)records.push(record);else malformed++;}catch{malformed++;}
  }
  malformed+=Math.max(0,tagged.length-64);
  out.metrics.focusNativeDiagnosticCount=records.length;out.metrics.focusNativeMalformedDiagnosticCount=Math.min(1048576,malformed);
  out.metrics.focusNativeCaseStartCount=records.filter(record=>record.kind==='case-start').length;
  out.metrics.focusNativeCaseEndCount=records.filter(record=>record.kind==='case-end').length;
  out.focusNativeDiagnosticObserved=records.length>0;
  for(const [tag,key]of [['r109-native-witness','focusNativeWitnessCount'],['r109-command-proof','focusNativeCommandProofCount'],['r109-fixture-drain','focusNativeFixtureDrainCount']])
    out.metrics[key]=Math.min(1048576,lines.filter(line=>line.startsWith(tag+' ')).length);
  const first=records.find(record=>record.kind==='failure'||record.kind==='fixture-failure');
  if(first){Object.assign(out,{focusNativeFailureKind:first.kind,focusNativeFailureOperation:first.operation,focusNativeFailureName:first.errorName,
    focusNativeFailureCode:first.errorCode,focusNativeFailureModule:first.module});
    out.metrics.focusNativeFailureLine=first.line;out.metrics.focusNativeFailureColumn=first.column;out.metrics.focusNativeOperationCount=first.operationCount;
  }
  return projectNativeDiagnostic(out);
}
