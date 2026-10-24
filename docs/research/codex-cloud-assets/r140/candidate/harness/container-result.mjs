// Closed public result adapter. Internal stores/URLs/messages never cross this boundary.
import {compactEvidence,projectNumericEvidence,assertCaseBudget,completeNumericObservation} from './evidence-vectors.mjs';
export const SOURCE_PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const FIXTURE_SHA='a672a1f9b5de6a699a18c26c5fad6fe477a5e37d05c75f115f425a8a3f789b09';
export const OPEN_GATES=Object.freeze(['fault-recovery','latest-generation','physical-paint','independent-engine-correctness','full-legacy-coverage','memory-nonaccumulation','statistical-performance']);
export const RESULT_CODES=Object.freeze(['r140-unshaped-source-slice-observed','r140-runtime-identity','r140-source-lock','r140-harness-lock','r140-budget-insufficient','r140-child-nonzero','r140-child-signal','r140-child-deadline','r140-child-ipc','r140-result-missing','r140-result-malformed','r140-result-partial','r140-network-undrained','r140-close-incomplete','r140-evidence-incomplete','r140-runtime-error','r140-health-evidence-incomplete']);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const cleanClosure=c=>c?.complete===true&&c.browserClosed===true&&c.proxyClosed===true&&c.lockRemoved===true&&Array.isArray(c.servers)&&c.servers.length===2&&c.servers.every(s=>s.closed===true&&s.exitCode===0&&s.signal===null);
export function validateSessionEvidence({outcome,result,closure,browserClose,stages=[]}={}){
 if(outcome?.deadline===true)return{ok:false,code:'r140-child-deadline'};
 if(outcome?.exitConfirmed!==true)return{ok:false,code:'r140-close-incomplete'};
 if(outcome?.signal)return{ok:false,code:'r140-child-signal'};
 if(outcome?.code!==0)return{ok:false,code:'r140-child-nonzero'};
 if(!result)return{ok:false,code:'r140-result-missing'};
 if(result.schema!=='r140-session-internal-v1'||result.profile!=='UNSHAPED_0_ADDED_LATENCY'||result.observerMode!=='CURRENT_SYNC_CHECKPOINTS'||result.source!==SOURCE_PIN||result.mode!=='primary')return{ok:false,code:'r140-result-malformed'};
 if(!Number.isFinite(outcome.observedTimedMs)||outcome.observedTimedMs<1800000||outcome.observedTimedMs>1815000)return{ok:false,code:'r140-result-partial'};
 if(result.failure!==null||result.targetDurationMs!==1800000||!Number.isFinite(result.timedDurationMs)||result.timedDurationMs<1800000||result.timedDurationMs>1810000||result.operations!==54||result.revisions!==45||result.restartEquivalent!==true||result.scopedSemanticPass!==true||result.acceptance!==false)return{ok:false,code:'r140-result-partial'};
 if(!Array.isArray(result.network?.pending)||result.network.pending.length||!Array.isArray(result.network.faults)||result.network.faults.length||browserClose?.networkPending!==0||!Array.isArray(browserClose.networkFaults)||browserClose.networkFaults.length)return{ok:false,code:'r140-network-undrained'};
 if(!cleanClosure(closure)||browserClose?.browserCloseResolved!==true||browserClose.browserDisconnectedObserved!==true||JSON.stringify(browserClose.closedPages)!=='[0,1,2]'||browserClose.pendingCDPCommands!==0||browserClose.listenerDisposal?.removed!==browserClose.listenerDisposal?.installed||!integer(browserClose.listenerDisposal?.installed)||browserClose.listenerDisposal?.pendingWrites!==0)return{ok:false,code:'r140-close-incomplete'};
 if(!['measured-ready','cleanup-end'].every(stage=>stages.includes(stage))||stages.filter(stage=>stage==='episode-start').length!==54||stages.filter(stage=>stage==='episode-end').length!==54)return{ok:false,code:'r140-result-partial'};
 return{ok:true,code:'r140-unshaped-source-slice-observed'};
}
export function publicResult({evidence,identity={},elapsedMs=0,forcedCode,numericEvidence=compactEvidence()}={}){
 let verdict=forcedCode?{ok:false,code:RESULT_CODES.includes(forcedCode)?forcedCode:'r140-runtime-error'}:validateSessionEvidence(evidence);const safeEvidence=projectNumericEvidence(numericEvidence.sampleVectors,numericEvidence.journeyLatencies);if(verdict.ok&&!completeNumericObservation(safeEvidence))verdict={ok:false,code:'r140-evidence-incomplete'};
 const out={schema:'r140-unshaped-session-v1',mode:'r140-public-duo-unshaped-v1',profile:'UNSHAPED_0_ADDED_LATENCY',observerMode:'CURRENT_SYNC_CHECKPOINTS',allFinalGates:'OPEN',status:verdict.ok?'blocked':'failed',code:verdict.code,passed:false,acceptance:false,cleanupPassed:verdict.ok,
  sourcePin:SOURCE_PIN,fixtureSha256:FIXTURE_SHA,scope:{dataset:'duo-legacy',fixtureBaseline:'r37-authored-711-v2',players:2,overlays:1,memberUnlockedChunks:1,taskCoverage:'fixture-member-catalogue',sessionMinutes:30},
  openGates:[...OPEN_GATES],metrics:{artificialDelayMs:0,targetDurationMs:1800000,elapsedMs:Number.isFinite(elapsedMs)&&elapsedMs>=0?Math.min(elapsedMs,2000000):0}};
 for(const key of ['sourceManifestSha256','harnessManifestSha256','nodeSha256'])if(sha(identity[key]))out[key]=identity[key];
 if(verdict.ok){out.metrics.timedDurationMs=evidence.result.timedDurationMs;out.metrics.observedTimedDurationMs=evidence.outcome.observedTimedMs;out.metrics.operations=54;out.metrics.mutations=45;out.metrics.closedPages=3;out.metrics.networkPending=0;}
 return assertCaseBudget({...out,...safeEvidence});
}
