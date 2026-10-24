// Reviewed container entrypoint. Importing it never starts a child/app/browser.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {sha,readSmallJSON,verifySource,verifyHarness,parseBridgeArgs,verifyRuntimeIdentity,initAgeMilliseconds,planBudget,verifyResultPolicy,sessionEnvironment,startSession,buildCase,writeCase,resolvePackageRoot,verifyDependencyIdentity,readEvidenceFile} from './container-bridge.mjs';
import {compactEvidence} from './evidence-vectors.mjs';
import {RESULT_CODES} from './container-result.mjs';
import {encodeRttEvidence,projectRttEvidence,verifyRttPolicy,completeRttEvidence} from './rtt-evidence.mjs';
import {captureDiagnostic,projectDiagnostic,evidenceFailureCode,verifyDiagnosticPolicy} from './diagnostic.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export async function main(argv=process.argv.slice(2)){
 const started=performance.now(),identity={};let outcome,result,closure,browserClose,forcedCode,sessionScratch,numericEvidence=compactEvidence(),diagnosticOperation='entry-start',diagnostic,rttEvidence=encodeRttEvidence();
 const stage=name=>{fs.writeSync(3,JSON.stringify({stage:name})+'\n');};
 try{
  const args=parseBridgeArgs(argv),env=process.env;
  const nodeSha256=sha(fs.readFileSync(process.execPath));identity.nodeSha256=nodeSha256;
  const cg=name=>fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim(),cpuset=cg('cpuset.cpus.effective'),affinity=fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s+(.+)$/m)?.[1];
  diagnosticOperation='runtime-identity';verifyRuntimeIdentity({platform:process.platform,arch:process.arch,version:process.version,uid:process.getuid?.(),execPath:process.execPath,nodeSha256,cgroup:fs.readFileSync('/proc/self/cgroup','utf8').trim(),interfaces:fs.readdirSync('/sys/class/net').sort(),cpuMax:cg('cpu.max'),cpuset,affinity,memoryMax:cg('memory.max'),memorySwapMax:cg('memory.swap.max'),pidsMax:cg('pids.max'),env},args['expected-node-sha256']);
  stage('start');
  const sampleStart=performance.now(),hz=Number(execFileSync('/usr/bin/getconf',['CLK_TCK'],{encoding:'utf8',timeout:2000,env:{PATH:'/usr/bin:/bin'}}).trim());
  const raw=fs.readFileSync('/proc/1/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' '),uptime=Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0]);
  const ageMs=initAgeMilliseconds({uptimeSeconds:uptime,startTicks:Number(fields[19]),ticksPerSecond:hz,probeElapsedMs:performance.now()-sampleStart});const sampledAt=performance.now();
  const packageRoot=fs.realpathSync(resolvePackageRoot(HERE));if(packageRoot!=='/harness'&&!packageRoot.startsWith('/harness/'))throw Error('r111-harness-lock');
  diagnosticOperation='source-lock';identity.sourceManifestSha256=verifySource('/source',readSmallJSON(args['source-lock'],2*1024**2));
  diagnosticOperation='harness-lock';identity.harnessManifestSha256=verifyHarness(packageRoot,args['expected-harness-manifest-sha256']);
  diagnosticOperation='policy';const policy=readSmallJSON('/runner/result-policy.json',256*1024);verifyResultPolicy(policy);verifyDiagnosticPolicy(policy);verifyRttPolicy(policy);
  diagnosticOperation='dependencies';verifyDependencyIdentity(readSmallJSON('/deps/node_modules/playwright/package.json'),readSmallJSON('/deps/node_modules/playwright-core/package.json'));
  const scratch=fs.mkdtempSync('/scratch/r111-session-v3-');fs.chmodSync(scratch,0o700);
  sessionScratch=scratch;
  diagnosticOperation='browser-path';const pw=await import(env.PERF_PLAYWRIGHT_MODULE),chromium=fs.realpathSync(pw.chromium.executablePath());if(!chromium.startsWith('/ms-playwright/')||!fs.statSync(chromium).isFile())throw Error('r111-runtime-identity');
  const budget=planBudget({containerAgeMs:ageMs,preflightElapsedMs:performance.now()-sampledAt});
  fs.writeFileSync(path.join(scratch,'bridge-budget.json'),JSON.stringify({...budget,containerAgeMs:ageMs,sourcePin:'6f22fefa782747790e2eaefa01e4e5ea7b557323'})+'\n',{mode:0o600});
  const childEnv=sessionEnvironment(env,{scratch,playwright:env.PERF_PLAYWRIGHT_MODULE,chromium,expectedChromium:args['expected-chromium'],cpuset});childEnv.R111_BUDGET=JSON.stringify(budget);
  diagnosticOperation='session-start';stage('measured-start');outcome=await startSession({entry:path.join(HERE,'session.mjs'),scratch,env:childEnv,budget,stage});
  const directory=path.join(scratch,'results/current30');
  const read=(name,limit)=>{const filename=path.join(directory,name);if(!fs.existsSync(filename))return null;const realParent=fs.realpathSync(path.dirname(filename));if(!realParent.startsWith(scratch+path.sep))throw Error('r111-result-malformed');return readSmallJSON(filename,limit);};
  diagnosticOperation='read-result';diagnostic=projectDiagnostic(read('failure-diagnostic.json',8192));const rtt=read('rtt-evidence.json',8192);if(rtt)rttEvidence=projectRttEvidence(rtt);result=read('result.json',1024*1024);closure=read('session-closure.json',65536);browserClose=read('post-browser-close.json',65536);
 }catch(error){if(!diagnostic||Object.keys(diagnostic).length===0)diagnostic=captureDiagnostic(error,diagnosticOperation);forcedCode=RESULT_CODES.includes(error?.message)?error.message:'r111-runtime-error';}
 if(sessionScratch&&outcome){try{diagnosticOperation='read-evidence';const directory=path.join(sessionScratch,'results/current30');if(!fs.realpathSync(directory).startsWith(sessionScratch+path.sep))throw Error('r111-result-malformed');const samples=readEvidenceFile(path.join(directory,'samples.ndjson')),journeys=readEvidenceFile(path.join(directory,'ledger.ndjson'));numericEvidence=compactEvidence(samples.rows,journeys.rows,{droppedSamples:samples.dropped,droppedJourneys:journeys.dropped});}catch(error){if(!diagnostic||Object.keys(diagnostic).length===0)diagnostic=captureDiagnostic(error,diagnosticOperation);forcedCode??=evidenceFailureCode(outcome,error);}}
 const extra=projectDiagnostic(diagnostic),publicValue=buildCase({outcome,result,closure,browserClose,identity,elapsedMs:performance.now()-started,forcedCode,numericEvidence});
 for(const [key,value]of Object.entries(extra)){if(['r111SourceLine','r111SourceColumn'].includes(key))publicValue.metrics[key]=value;else publicValue[key]=value;}
 if(outcome){for(const [key,value]of [['r111ChildStdoutSha256',outcome.stdoutSha256],['r111ChildStderrSha256',outcome.stderrSha256]])if(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))publicValue[key]=value;for(const [key,value]of [['r111ChildStdoutBytes',outcome.stdoutBytes],['r111ChildStderrBytes',outcome.stderrBytes]])if(Number.isSafeInteger(value)&&value>=0&&value<=1e12)publicValue.metrics[key]=value;}
 publicValue.rttEvidence=projectRttEvidence(rttEvidence);
 if(publicValue.status==='blocked'&&!completeRttEvidence(publicValue.rttEvidence)){publicValue.status='failed';publicValue.code='r111-evidence-incomplete';publicValue.cleanupPassed=false;}
 const {assertCaseBudget}=await import('./evidence-vectors.mjs');assertCaseBudget(publicValue);
 // Runtime identity is fixed before this path is usable. Never follow an arbitrary env target.
 if(process.env.PERF_CASE_RESULT!=='/scratch/case-result.json'||!fs.statSync('/scratch').isDirectory())throw Error('r111-runtime-identity');
 writeCase('/scratch/case-result.json',publicValue);stage(publicValue.status==='failed'?'error':'result');process.exitCode=publicValue.status==='failed'?1:0;return publicValue;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
