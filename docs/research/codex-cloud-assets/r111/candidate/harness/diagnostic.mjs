// Closed error evidence only. Import-safe; no app/provider/browser imports.
import crypto from 'node:crypto';
export const OPERATIONS=Object.freeze(['entry-start','runtime-identity','source-lock','harness-lock','policy','dependencies','browser-path','session-start','read-result','read-evidence','session-setup','server-launch','rtt-direct','rtt-proxy','invites','initial-catalogue','overlay-create','browser-launch','browser-version','browser-contexts','network-setup','page-navigation','overlay-ready','visible-catalogue','initial-state','rtt-browser','initial-validation','controller-start','sample','journey','finalization','cleanup','unknown']);
export const ERROR_NAMES=Object.freeze(['Error','AssertionError','TypeError','RangeError','SyntaxError','TimeoutError','unknown']);
export const ERROR_CODES=Object.freeze(['none','other','ERR_ASSERTION','ENOENT','EACCES','EPERM','EPIPE','ECONNRESET','ECONNREFUSED','ERR_MODULE_NOT_FOUND','ERR_IPC_CHANNEL_CLOSED','ETIMEDOUT','ENOTFOUND']);
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
export function captureDiagnostic(error,operation){
 let name,code,stack;try{name=error?.name;code=error?.code;stack=error?.stack;}catch{}
 const value={r111Operation:OPERATIONS.includes(operation)?operation:'unknown',r111ErrorName:ERROR_NAMES.includes(name)?name:'unknown',r111ErrorCode:code==null?'none':ERROR_CODES.includes(code)?code:'other'};
 if(typeof stack==='string')value.r111ErrorStackSha256=digest(stack.slice(0,65536));
 return value;
}
export function projectDiagnostic(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 const out={};for(const [key,values]of [['r111Operation',OPERATIONS],['r111ErrorName',ERROR_NAMES],['r111ErrorCode',ERROR_CODES]])if(values.includes(value[key]))out[key]=value[key];
 if(typeof value.r111ErrorStackSha256==='string'&&/^[a-f0-9]{64}$/.test(value.r111ErrorStackSha256))out.r111ErrorStackSha256=value.r111ErrorStackSha256;
 return out;
}
export function evidenceFailureCode(outcome,error){
 // Absent sample files are expected after a failed setup. They are not the cause.
 if(outcome?.exitConfirmed===true&&(outcome.code!==0||outcome.signal||outcome.deadline||outcome.ipcFailure))return undefined;
 return 'r111-result-malformed';
}
export function verifyDiagnosticPolicy(policy){
 const expected={r111Operation:OPERATIONS,r111ErrorName:ERROR_NAMES,r111ErrorCode:ERROR_CODES};
 if(!Object.entries(expected).every(([key,values])=>values.every(value=>policy?.enums?.[key]?.includes(value)))||!['r111ErrorStackSha256','r111ChildStdoutSha256','r111ChildStderrSha256'].every(key=>policy.hashKeys?.includes(key))||!['r111ChildStdoutBytes','r111ChildStderrBytes'].every(key=>policy.metricKeys?.includes(key)))throw Error('r111-runtime-identity');
}
