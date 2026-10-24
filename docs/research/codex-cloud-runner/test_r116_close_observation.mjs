import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {accepted} from './accept_r116_close.mjs';
import {PHASES,COUNTS} from '../codex-cloud-capture/close-observation.mjs';
const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323',sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(){
 const files=[{path:'app/server.mjs',bytes:186000,sha256:'5edc544473fe98ba1bdf42deaf8cceccbea9db5fa9f42d51daa111f3eb9ceb25'},{path:'app/storage/store.mjs',bytes:80000,sha256:'bcdd2a3fa7d07403ad76ac34f44e0754ef31ee8f6f204fd29ea0e0231d4b0f06'},...Array.from({length:1926},(_,i)=>({path:`fixture/file-${i}`,bytes:1,sha256:'a'.repeat(64)}))];
 const lock={schemaVersion:1,sourceCommit:PIN,verification:'host-verified-public-git-archive',files,manifestSha256:sha(files)};
 const transformed=files.map(row=>row.path==='app/server.mjs'?{path:row.path,bytes:189119,sha256:'b593b897e46ec1a0b283d3137dfc69d87088e7b8abd8f2e022f0df4800e47807'}:row.path==='app/storage/store.mjs'?{path:row.path,bytes:81807,sha256:'cab7a58f5abcb2a11d661697da3ffe242ac20023a3c3661b424b53e6eb7f49c7'}:row);
 const identity={mode:'scratch-source-close-phases-v1',timingEligibility:'diagnostic-only',fileCount:1928,originalManifestSha256:lock.manifestSha256,observedManifestSha256:sha(transformed),originalServerSha256:files[0].sha256,observedServerSha256:transformed[0].sha256,originalStoreSha256:files[1].sha256,observedStoreSha256:transformed[1].sha256};
 const phases={lastPhase:'serverStore',events:46,dropped:0,states:Object.fromEntries(PHASES.map(p=>[p,'fulfilled'])),firstMs:Object.fromEntries(PHASES.map(p=>[p,0])),lastMs:Object.fromEntries(PHASES.map(p=>[p,10])),counts:Object.fromEntries(COUNTS.map(p=>[p,null]))};
 for(const p of ['serverEnter','storeEnter'])phases.states[p]='entered';phases.states.serverActivation='unobserved';phases.firstMs.serverActivation=null;phases.lastMs.serverActivation=null;
 const close={attemptStatus:'complete',stopRpcStatus:'acknowledged',stopErrorCode:'none',exitWaitStatus:'normal-exit',exitWaitErrorCode:'none',witnessCode:'closed-witness-verified',receiptStatus:'present',elapsedMs:10,exitCode:0,exitSignal:'none',stoppedMessageCount:1,pendingRpcCount:0,closeCompleted:'yes',ownershipStable:'yes',ownerLockPresent:'no',journalCount:0,captureErrorCount:0,witnessCount:1,validWitnessCount:1,driverStage:'complete'};
 const c={schema:'r116-app-close-diagnostic-v1',mode:'r116-close-phases-observation-v1',status:'blocked',code:'r116-close-observation-complete',passed:false,acceptance:false,cleanupStatus:'complete',caseExitCode:0,sourcePin:PIN,harnessManifestSha256:'df34c38e28cae4bcdd6eb52c2f89c5059dd8a7621d52afff67a583fb8f2c4bd2',fixtureSha256:'380ffb698ea594ccb1d375321708a4369f50da82fdc796fd91a4a8c8038b8022',nodeVersion:'v24.19.0',chromiumVersion:'151.0.7922.34',sourceManifestSha256:lock.manifestSha256,closeObservationIdentity:identity,referenceCloseDiagnostic:close,closePhaseDiagnostic:phases};
 const final={schema:'docker-envelope-final-v1',envelope:'docker-hard-2cpu-6g-v1',sourceCommit:PIN,mode:'browser',control:'none',passed:true,cleanupPassed:true,baseline:{node:'v24.19.0',playwright:'1.62.1',chromium:'151.0.7922.34',chromiumRevision:'1234',platform:'linux/amd64',image:'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac'},containerCleanup:{running:false,pid:0,removed:true,exitCode:0,oomKilled:false},result:{passed:true,control:'none',intentionalNegative:false,orphanReaped:true,caseResult:c}};
 return{final,lock};
}
test('R116 accepts only complete diagnostic observation without old UI or RTT acceptance',()=>{const {final,lock}=fixture();assert.ok(accepted(final,lock));assert.equal(final.result.caseResult.passed,false);assert.equal(final.result.caseResult.acceptance,false);});
test('R116 binds actual source lock and both exact transformed modules',()=>{
 for(const key of ['originalManifestSha256','observedManifestSha256','originalServerSha256','observedServerSha256','originalStoreSha256','observedStoreSha256']){const {final,lock}=fixture();final.result.caseResult.closeObservationIdentity[key]='b'.repeat(64);assert.equal(accepted(final,lock),false,key);}
 const {final,lock}=fixture();lock.files[9].sha256='c'.repeat(64);assert.equal(accepted(final,lock),false);
});
test('R116 rejects phase drops pending rejection missing terminal marker and malformed timing',()=>{
 for(const kind of ['drops','pending','rejected','missing','bool','reversed']){const {final,lock}=fixture(),p=final.result.caseResult.closePhaseDiagnostic;if(kind==='drops')p.dropped=1;else if(kind==='missing')p.states.storeReleaseGuard='unobserved';else if(kind==='bool')p.events=true;else if(kind==='reversed')p.firstMs.serverAll=100;else p.states.serverStore=kind;assert.equal(accepted(final,lock),false,kind);}
});
test('R116 rejects initiating close failure forced kill bad witness and outer cleanup failure',()=>{
 for(const [key,value]of [['stopRpcStatus','rejected'],['exitWaitStatus','timed-out-kill-attempted'],['witnessCode','close-receipt-incomplete'],['captureErrorCount',1],['journalCount',1],['ownerLockPresent','yes']]){const {final,lock}=fixture();final.result.caseResult.referenceCloseDiagnostic[key]=value;assert.equal(accepted(final,lock),false,key);}
 for(const [key,value]of [['status','failed'],['passed',true],['acceptance',true],['schema','r116-frozen-browser-v1'],['cleanupStatus','incomplete']]){const {final,lock}=fixture();final.result.caseResult[key]=value;assert.equal(accepted(final,lock),false,key);}
 const {final,lock}=fixture();final.cleanupPassed=false;assert.equal(accepted(final,lock),false);
});
