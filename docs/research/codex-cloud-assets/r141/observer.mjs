// Installed only into owned diagnostic scratch; no native IPC/profiler/GC hooks.
import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isMainThread} from 'node:worker_threads';
import {validateRecord,payloadFacts} from './r141-trace-contract.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const proofStarted=performance.now(),directory=process.env.R141_TRACE_DIR,endpoint=process.env.R141_ENDPOINT_ID??'root';
assert.match(directory??'',/^\/scratch\/r141\/cell-[01]\/trace$/);assert.match(endpoint,/^(root|[0-3])$/);
const clock=endpoint==='root'?'root-main':'endpoint-'+endpoint+(isMainThread?'-host':'-worker');
assert.ok(endpoint!=='root'||isMainThread);
const proofBytes=readFileSync(new URL('./r141-proof.json',import.meta.url));assert.equal(hash(proofBytes),process.env.R141_PROOF_SHA);
const proof=JSON.parse(proofBytes);assert.ok(['A','C'].includes(process.env.R141_ARM));assert.equal(proof.arm,process.env.R141_ARM);
const observerSha=hash(readFileSync(import.meta.url.startsWith('file:')?new URL(import.meta.url):import.meta.url));
const contractSha=hash(readFileSync(new URL('./r141-trace-contract.mjs',import.meta.url)));
assert.equal(observerSha,proof.observerSha);assert.equal(contractSha,proof.contractSha);
let sequence=0,observerMs=0,spanReads=0,bytes=0,nextEndpoint=0,peek=()=>{throw new Error('R141 residency peek unavailable');};
const endpoints=new WeakMap();
export const r141Now=()=>{spanReads++;return performance.now();};
export function r141Emit(event,fields={}){
 const began=performance.now(),record={event,clock,seq:sequence+1,atMs:performance.now(),priorObserverMs:observerMs,priorWrites:sequence,spanClockReads:spanReads,...fields};
 validateRecord(record);const line=JSON.stringify(record)+'\n';bytes+=Buffer.byteLength(line);assert.ok(bytes<=65536&&sequence<96,'R141 trace bound');
 appendFileSync(directory+'/'+clock+'.jsonl',line,{encoding:'utf8',mode:0o600});sequence++;observerMs+=performance.now()-began;
}
export function r141Module(url,moduleCode){const began=r141Now(),sha=hash(readFileSync(new URL(url)));assert.equal(sha,proof.modules[moduleCode].sha256);r141Emit('module-proof',{moduleCode,sha,proofMs:r141Now()-began});}
export function r141Bind(endpointObject){assert.equal(clock,'root-main');const id=nextEndpoint++;assert.ok(id<4);endpoints.set(endpointObject,id);return id;}
export function r141Endpoint(endpointObject){const id=endpoints.get(endpointObject);assert.ok(Number.isInteger(id));return id;}
export function r141SetPeek(callback){assert.equal(clock,'root-main');peek=callback;}
export const r141Peek=()=>peek();
export {payloadFacts};
r141Emit('self-proof',{observerSha,contractSha,proofMs:performance.now()-proofStarted});
