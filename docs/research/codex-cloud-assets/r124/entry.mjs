// Outer runner supplies a raw JSON stage pipe at FD3, never process.send IPC.
import {readFileSync,writeFileSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
const stage=value=>writeSync(3,JSON.stringify({stage:value})+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const result={schema:'r124-engine-api-comparison-v1',mode:'r124-engine-api-v1',status:'failed',passed:false,code:'runtime-error',metrics:{}};
try{
 stage('start');
 await import('./supervisor.mjs');
 const full=JSON.parse(readFileSync('/scratch/r124-full-result.json','utf8'));
 const B=full.arms.baseline.artifact?.results,C=full.arms.candidate.artifact?.results;
 if(B)result.metrics.r124BaselineCompletedCases=B.results.length;
 else if(full.arms.baseline.status==='UNRUN')result.metrics.r124BaselineCompletedCases=0;
 if(C)result.metrics.r124CandidateCompletedCases=C.results.length;
 else if(full.arms.candidate.status==='UNRUN')result.metrics.r124CandidateCompletedCases=0;
 if(B){result.fixtureSha256=B.fixtureSHA256;result.r124BaselineProviderDigest=B.providerDigest;result.r124BaselineVectorsSha256=sha(JSON.stringify(B));}
 if(C){result.r124CandidateProviderDigest=C.providerDigest;result.r124CandidateVectorsSha256=sha(JSON.stringify(C));}
 result.r124PacketManifestSha256=sha(readFileSync(new URL('./manifest.json',import.meta.url)));
 result.calculatorBytesSha256=sha(readFileSync(new URL('./candidate-engine.mjs',import.meta.url)));
 result.sourcePin='6f22fefa782747790e2eaefa01e4e5ea7b557323';
 result.passed=full.status==='complete'&&full.comparison?.status==='matched'&&!process.exitCode;
 if(result.passed){result.status='correct';result.code='r124-full-engine-vectors-match';result.count=8;result.r124ComparisonSha256=sha(JSON.stringify(full.comparison));}
}catch{process.exitCode=1;}
if(!result.passed)process.exitCode=1;
writeFileSync('/scratch/case-result.json',JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
stage(result.passed?'result':'error');
