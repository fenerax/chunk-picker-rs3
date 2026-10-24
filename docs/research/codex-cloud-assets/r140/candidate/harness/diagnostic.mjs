// Closed error evidence only. Import-safe; no app/provider/browser imports.
import crypto from 'node:crypto';
export const OPERATIONS=Object.freeze(['entry-start','runtime-identity','source-lock','harness-lock','policy','dependencies','browser-path','session-start','read-result','read-evidence','session-setup','server-launch','rtt-direct','rtt-proxy','invites','initial-catalogue','overlay-create','browser-launch','browser-version','browser-contexts','network-setup','page-navigation','overlay-ready','visible-catalogue','initial-state','rtt-browser','initial-validation','controller-start','sample','journey','finalization','cleanup','rtt-proxy-assert','rtt-browser-fetch','rtt-browser-save','rtt-browser-assert','server-parse-args','server-environment','server-fixture','server-provider-import','server-provider-admit','server-module-import','server-state-import','server-fixture-state','server-start-handle','server-ready','server-address','server-snapshot','server-metrics','server-restart','server-close','unknown']);
export const ERROR_NAMES=Object.freeze(['Error','AssertionError','TypeError','RangeError','SyntaxError','TimeoutError','unknown']);
export const ERROR_CODES=Object.freeze(['none','other','ERR_ASSERTION','ENOENT','EACCES','EPERM','EPIPE','ECONNRESET','ECONNREFUSED','ERR_MODULE_NOT_FOUND','ERR_IPC_CHANNEL_CLOSED','ETIMEDOUT','ENOTFOUND']);
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');

export const PUBLIC_SOURCE_LIMITS=Object.freeze({"app/core/state.mjs":2258,"app/server.mjs":2360,"app/datasets.mjs":410,"app/dataset-runtime.mjs":119,"app/storage/store.mjs":1302,"app/game-defaults.mjs":10,"app/legacy-game-defaults.mjs":61,"docs/research/codex-cloud-assets/r140/candidate/harness/server.mjs":58});
export function publicSourceFrame(stack){
 if(typeof stack!=='string')return{};
 for(const line of stack.slice(0,65536).split('\n').slice(1,33)){
  const match=line.match(/^\s+at (?:[^()\r\n]{1,160} \()?(?:file:\/\/)?\/(source|harness)\/([A-Za-z0-9_./-]+\.mjs):(\d{1,6}):(\d{1,6})\)?$/);
  if(!match)continue;const module=match[2],lineNumber=Number(match[3]),column=Number(match[4]);
  if(!Object.hasOwn(PUBLIC_SOURCE_LIMITS,module)||lineNumber<1||lineNumber>PUBLIC_SOURCE_LIMITS[module]||column<1||column>100000)continue;
  if(match[1]==='source'&&!module.startsWith('app/'))continue;
  if(match[1]==='harness'&&!module.startsWith('docs/research/codex-cloud-assets/r140/'))continue;
  return{r140SourceModule:module,r140SourceLine:lineNumber,r140SourceColumn:column};
 }return{};
}
export function forwardedDiagnostic(error,operation){
 const original=projectDiagnostic(error?.r140BootstrapDiagnostic);
 return ['r140Operation','r140ErrorName','r140ErrorCode'].every(key=>Object.hasOwn(original,key))?original:captureDiagnostic(error,operation);
}

export function captureDiagnostic(error,operation){
 let name,code,stack;try{name=error?.name;code=error?.code;stack=error?.stack;}catch{}
 const value={r140Operation:OPERATIONS.includes(operation)?operation:'unknown',r140ErrorName:ERROR_NAMES.includes(name)?name:'unknown',r140ErrorCode:code==null?'none':ERROR_CODES.includes(code)?code:'other'};
 if(typeof stack==='string')value.r140ErrorStackSha256=digest(stack.slice(0,65536));
 return{...value,...publicSourceFrame(stack)};
}
export function projectDiagnostic(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 const out={};for(const [key,values]of [['r140Operation',OPERATIONS],['r140ErrorName',ERROR_NAMES],['r140ErrorCode',ERROR_CODES]])if(values.includes(value[key]))out[key]=value[key];
 if(typeof value.r140ErrorStackSha256==='string'&&/^[a-f0-9]{64}$/.test(value.r140ErrorStackSha256))out.r140ErrorStackSha256=value.r140ErrorStackSha256;
 if(Object.hasOwn(PUBLIC_SOURCE_LIMITS,value.r140SourceModule)&&Number.isSafeInteger(value.r140SourceLine)&&value.r140SourceLine>=1&&value.r140SourceLine<=PUBLIC_SOURCE_LIMITS[value.r140SourceModule]&&Number.isSafeInteger(value.r140SourceColumn)&&value.r140SourceColumn>=1&&value.r140SourceColumn<=100000){out.r140SourceModule=value.r140SourceModule;out.r140SourceLine=value.r140SourceLine;out.r140SourceColumn=value.r140SourceColumn;}
 return out;
}
export function evidenceFailureCode(outcome,error){
 // Absent sample files are expected after a failed setup. They are not the cause.
 if(outcome?.exitConfirmed===true&&(outcome.code!==0||outcome.signal||outcome.deadline||outcome.ipcFailure))return undefined;
 return 'r140-result-malformed';
}
export function verifyDiagnosticPolicy(policy){
 const expected={r140Operation:OPERATIONS,r140ErrorName:ERROR_NAMES,r140ErrorCode:ERROR_CODES,r140SourceModule:Object.keys(PUBLIC_SOURCE_LIMITS)};
 if(!Object.entries(expected).every(([key,values])=>values.every(value=>policy?.enums?.[key]?.includes(value)))||!['r140ErrorStackSha256','r140ChildStdoutSha256','r140ChildStderrSha256'].every(key=>policy.hashKeys?.includes(key))||!['r140ChildStdoutBytes','r140ChildStderrBytes','r140SourceLine','r140SourceColumn'].every(key=>policy.metricKeys?.includes(key)))throw Error('r140-runtime-identity');
}
