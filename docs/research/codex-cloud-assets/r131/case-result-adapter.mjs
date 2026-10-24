import crypto from 'node:crypto';import {cancelProof,PIN} from './protocol.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const INTENTS=['initial full borrow conformance','declaration cancellation and independent fallback equality','task cancellation and independent fallback equality','cold/member/input/revision classification','original reachable cache-warm negative control'];
export function publicCaseResult(report,reportBytes){
 let accepted=false,completed=0,modes=0,declarations=0,tasks=0,fallbacks=0,cleanup=false;
 try{
  if(report.correct!==true||report.failed!==false||report.native!=='PASS'||report.records.length!==2)throw Error('strict verdict');
  const seen=new Set();for(const cell of report.records){if(!['thread','process'].includes(cell.mode)||seen.has(cell.mode)||cell.correct!==true||cell.failed!==false||cell.exitObserved!==true)throw Error('mode verdict');seen.add(cell.mode);modes++;
   const episodes=cell.records.filter(r=>Object.hasOwn(r,'status'));if(episodes.length!==5||episodes.some(r=>r.status!=='PASS'||r.cleanupPassed!==true)||JSON.stringify(episodes.map(r=>r.name).sort())!==JSON.stringify([...INTENTS].sort()))throw Error('all intents and cleanup required');completed+=episodes.length;
   for(const phase of ['declaration','task']){const rows=cell.records.filter(r=>r.phase===phase&&r.proof);if(rows.length!==1)throw Error('phase cardinality');const row=rows[0];if(row.proof.sourceURL!=='file:///scratch/candidate/app/tasks/chunk-planning-index.mjs')throw Error('exact candidate source URL');cancelProof(row.events,phase,row.proof.sourceURL);if(row.proof.yielded!==true||row.references?.length!==2||row.fallbacks?.length!==2)throw Error('phase/fallback proof');if(phase==='declaration'&&(row.warmRows<1||row.warmEligibleBadgeCount!==0||!row.baseline))throw Error('cold/warm admission');
    const owners=[];for(let i=0;i<2;i++){if(sha(JSON.stringify(row.fallbacks[i]))!==row.references[i].sha256||!row.references[i].identities?.length)throw Error('complete fallback equality');owners.push(JSON.stringify(row.references[i].identities));fallbacks++;}if(owners[0]===owners[1])throw Error('independent reference dispatches');if(phase==='declaration')declarations++;else tasks++;
   }
  }cleanup=true;accepted=completed===10&&modes===2&&declarations===2&&tasks===2&&fallbacks===8;
 }catch{}
 const hashes={r131NativeReportSha256:sha(reportBytes)};for(const [key,value] of [['r131RuntimeManifestSha256',report.runtimeManifest?.sha256],['r131CandidatePatchSha256',report.install?.patchSHA256]])if(/^[a-f0-9]{64}$/.test(value??''))hashes[key]=value;
 if(Object.keys(hashes).length!==3||report.install?.patchSHA256!=='f338823b045747b9e0a052bcb04d4db632b83eb5400a370a9b7ff3637a8c4ee1')accepted=false;
 const out={schema:'r131-borrow-native-v1',status:accepted?'correct':'failed',passed:accepted,code:accepted?'r131-native-correct':'r131-native-failed',count:completed,cleanupPassed:cleanup,nativeAssertionsPassed:accepted,sourceCommit:PIN,...hashes,metrics:{r131CompletedIntentCount:completed,r131ModeCount:modes,r131DeclarationProofCount:declarations,r131TaskProofCount:tasks,r131IndependentFallbackCount:fallbacks}};
 if(Buffer.byteLength(JSON.stringify(out))>32768)throw Error('compact result bound');return out;
}
