// Shared exact-input evidence. Deployment references never authorize content reuse.
import path from 'node:path';
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { captureExecutionIdentity, digestValue, readSuccessReceipt, writeSuccessReceipt, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { resolveRetryPolicy, retryPolicyIdentity } from './retry-policy.mjs';

export const gatePolicy = Object.freeze({schema:'rs3-gate-policy-v5-exact-lanes',public:'independent-exact-sha-full',private:'complete-overlay-full',assembly:'companion-check-v3',gallery:'plain-and-framed-with-browser',install:'all-pinned-payloads',history:'all-new-ancestry-noreply',environment:'isolated-home-temp-fixed-path-v2',files:'trace-verified-static-closure-v2',wholeLane:'exact-complete-pair-v1',failedPeers:'complete-named-failure-attempt-v1',flaky:retryPolicyIdentity,early:'gallery-startup-pipeline-previous-v1',receiptMaxAgeMs:7*86400000});
export const gatePolicyDigest = digestValue(gatePolicy);
export function defaultEvidenceDirectory(kit) {
  const parent=path.dirname(path.resolve(kit));
  return path.resolve(path.basename(parent)==='releases'?path.join(parent,'../.local/gate-evidence'):path.join(parent,'gate-evidence'));
}
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(file,'utf8'));
export async function atomicJSON(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,file);
}

/** Use this environment for the real child, not just its identity. PATH/system
 * lookup remain behavior inputs. Owner credentials are excluded by v2 capture. */
export async function laneEnvironment(release,node,overrides={}) {
  const temp=path.join(release,'.local/lane-temp'),home=path.join(release,'.local/lane-home');
  // The child and its receipt use the SAME fixed PATH. Normalizing a hash while
  // executing an inherited PATH would hide a real executable-resolution change.
  const system=process.env.SystemRoot??process.env.SYSTEMROOT??'C:/Windows';
  // PowerShell 7 joins when installed: private tests and operator wrappers call pwsh by name.
  const pwsh=path.join(process.env.ProgramFiles??'C:/Program Files','PowerShell/7');
  const search=process.platform==='win32'?[path.dirname(node),path.join(system,'System32'),system,'C:/Program Files/Git/cmd',path.join(system,'System32/WindowsPowerShell/v1.0'),...(existsSync(path.join(pwsh,'pwsh.exe'))?[pwsh]:[])]:[path.dirname(node),'/usr/bin','/bin'];
  // Lane temp sits deep under the release; git refuses paths over 260 characters
  // without core.longpaths, and the lane HOME hides any global setting.
  const git=process.platform==='win32'?{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.longpaths',GIT_CONFIG_VALUE_0:'true'}:{};
  return sanitizeExecutionEnvironment(process.env,{overrides:{RS3_TEST_RETRY_ONCE_IN_ISOLATION:resolveRetryPolicy()?'1':'0',...overrides,...git,PATH:[...new Set(search)].join(path.delimiter),PATHEXT:'.COM;.EXE;.BAT;.CMD',TEMP:temp,TMP:temp,TMPDIR:temp,HOME:home,USERPROFILE:home,LOCALAPPDATA:path.join(home,'AppData/Local'),APPDATA:path.join(home,'AppData/Roaming'),NODE_COMPILE_CACHE:path.join(release,'.local/compile-cache'),CI:'1',NO_COLOR:'1',FORCE_COLOR:'0',TZ:'UTC',LANG:'C',LC_ALL:'C',LC_CTYPE:'C',NODE_OPTIONS:'--max-old-space-size=1536'}});
}

/** Only declared relocation roots are symbolic. Other args/environment/binaries
 * still count. Persist expanded redacted fields to make misses diagnosable. */
export async function stableExecution({lane,command,node,env,kit,release,args=[]}) {
  const roots=[[path.join(release,'.local/assembly'),'$ASSEMBLY'],[path.join(release,'core'),'$CORE'],[release,'$RELEASE'],[kit,'$KIT']].sort((a,b)=>b[0].length-a[0].length);
  const portable=value=>{let text=String(value).replaceAll('\\','/');for(const [root,alias] of roots){const needle=root.replaceAll('\\','/');const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp('(^|[=;:])'+escaped+'(?=/|$|;)',process.platform==='win32'?'gi':'g'),(_,prefix)=>prefix+alias);}return text;};
  const normalized=Object.fromEntries(Object.entries(env).map(([k,v])=>[k,portable(v)]));
  return captureExecutionIdentity({lane,command,nodeExecutable:node,args:args.map(portable),cwd:path.resolve(path.parse(kit).root,'__relnext__',lane),env:normalized,policy:gatePolicy});
}

export function gateContract(lane,inputs,execution) {
  const inputDigest=digestValue({schema:'rs3-gate-input-v3',lane,inputs,gatePolicyDigest});
  const executionDigest=execution.digest;
  const key=digestValue({schema:'rs3-lane-key-v2',inputDigest,executionDigest});
  return {lane,inputs,execution,key,inputDigest,executionDigest};
}
const expectation=c=>({key:c.key,inputDigest:c.inputDigest,executionDigest:c.executionDigest});
export async function lookupEvidence(directory,contract) {
  const filename=path.join(directory,contract.lane+'-'+contract.key+'.json');
  const record=await readSuccessReceipt(filename,expectation(contract),{maxAgeMs:gatePolicy.receiptMaxAgeMs});
  if(!record)return null;
  try {
    const expanded=await json(filename+'.identity.json');
    if(digestValue(expanded)!==digestValue(contract))return null;
  }catch{return null;}
  return {filename,record,contract,reused:true};
}
export async function publishEvidence(directory,contract,{startedAt,assemblyDigest}={}) {
  await mkdir(directory,{recursive:true});
  const filename=path.join(directory,contract.lane+'-'+contract.key+'.json');
  const previous=await lookupEvidence(directory,contract);if(previous)return previous;
  // Failed/stale/corrupt same-key evidence does not block a genuine rerun. Keep
  // it for diagnosis; never silently overwrite an old observation.
  for(const file of [filename,filename+'.identity.json'])try {
    const st=await lstat(file);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1)throw Error('Evidence path refused.');
    await rename(file,file+'.rejected-'+randomUUID());
  }catch(e){if(e.code!=='ENOENT')throw e;}
  await atomicJSON(filename+'.identity.json',contract);
  const record=await writeSuccessReceipt(filename,{...expectation(contract),startedAt,assemblyDigest,exitCode:0,cleanupVerified:true});
  return {filename,record,contract,reused:false};
}
export async function localEvidence(item,directory) {
  await mkdir(directory,{recursive:true});
  const filename=path.join(directory,item.contract.lane+'-'+item.contract.key+'.json');
  // The candidate holds its own frozen observation; the shared store is only
  // a lookup surface. Existing accepted candidates never change on expiry.
  await atomicJSON(filename,item.record);
  await atomicJSON(filename+'.identity.json',item.contract);
  return {filename,record:item.record,contract:item.contract,reused:item.reused};
}
export async function verifyLocalEvidence(item,contract,{retained=false}={}) {
  if(!item||digestValue(item.contract)!==digestValue(contract))throw Error('Gate dependency identity changed.');
  const record=await readSuccessReceipt(item.filename,expectation(contract),retained?{}:{maxAgeMs:gatePolicy.receiptMaxAgeMs});
  if(!record||digestValue(record)!==digestValue(item.record))throw Error('Exact gate receipt missing, stale or changed.');
  const expanded=await json(item.filename+'.identity.json');
  if(digestValue(expanded)!==digestValue(contract))throw Error('Expanded gate identity changed.');
  return record;
}
export async function hashFile(file){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Gate file refused.');return sha(await readFile(file));}
