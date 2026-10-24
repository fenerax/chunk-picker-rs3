import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const modes=Object.freeze(['cold','original-hit','unlocked-miss','unlocked-hit']);
export const schedule=Object.freeze([{kind:'aa',rep:0,arms:['A','A']},{kind:'ac',rep:0,arms:['A','C']},{kind:'ac',rep:1,arms:['C','A']},{kind:'aa',rep:1,arms:['A','A']},{kind:'aa',rep:2,arms:['A','A']},{kind:'ac',rep:2,arms:['A','C']}]);
let expected=null,index=0,failed=false;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function configureExpected(value){expected=value?freeze(structuredClone(value)):null;if(expected)assert.equal(expected.results.length,4);}
export function checkIdentities(summary){if(expected)for(const key of ['fixtureSHA256','definitionsHash','stateHash','migration','catalogueCounts'])assert.deepStrictEqual(summary[key],expected[key],`identity mismatch ${key}`);}
export function runTimedCase(call,clock=()=>performance.now()) {const start=clock();const result=call();const end=clock();return {result,callMs:end-start};}
export function checkProvider(dataset,arm){
 const proof=JSON.parse(readFileSync(new URL('./provider-proof.json',import.meta.url)));
 assert.equal(dataset.digest,arm==='baseline'?proof.baselineDigest:proof.candidateDigest);
 const records=dataset.files.map(({path,bytes,sha256,kind})=>({path,bytes,sha256,kind})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const wanted=structuredClone(arm==='baseline'?proof.baselineRecords:proof.candidateRecords).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 assert.deepStrictEqual(records,wanted,'complete provider metadata vector');assert.deepStrictEqual(dataset.capabilities,proof.capabilities);
}
export async function finishArm(summary,row){
 assert.equal(failed,false);try{
  assert.equal(row.label,modes[index]);assert.ok(Number.isFinite(row.callMs)&&row.callMs>0);
  if(expected)for(const key of ['owner','label','inputHash','semanticHash','rows','statuses','metrics','eligibilityCacheHit'])assert.deepStrictEqual(row[key],expected.results[index][key],`case ${index} mismatch ${key}`);
  index++;if(process.send)await new Promise((ok,no)=>process.send({schema:'r134-child-v1',stage:'case-verified',index},e=>e?no(e):ok()));
 }catch(e){failed=true;throw e;}
}
export function assess(pairs){
 assert.equal(pairs.length,6);const metrics={},log={},classifications={};let gain=false,regression=false;
 for(const mode of [...modes,'providerSetupMs','constructionMs','migrationCatalogueMs']){
  const setup=!modes.includes(mode);
  const aa=[],ac=[],aaFraction=[],acFraction=[];for(const pair of pairs){const x=setup?{callMs:pair.processes[0].setupMetrics[mode]}:pair.rows[0].find(r=>r.label===mode),y=setup?{callMs:pair.processes[1].setupMetrics[mode]}:pair.rows[1].find(r=>r.label===mode);assert.ok(x&&y);assert.ok(x.callMs>0&&y.callMs>0);
   if(pair.kind==='aa'){aa.push(Math.abs(Math.log(x.callMs/y.callMs)));aaFraction.push(Math.abs((x.callMs-y.callMs)/x.callMs));}
   else{const a=pair.arms[0]==='A'?x:y,c=pair.arms[0]==='C'?x:y;ac.push(Math.log(a.callMs/c.callMs));acFraction.push((a.callMs-c.callMs)/a.callMs);}
  }
  assert.equal(aa.length,3);assert.equal(ac.length,3);const noise=Math.max(...aa),minimum=Math.min(...ac),worst=Math.max(...ac.map(v=>-v));
  log[mode]={aaAbsLogRatios:aa,acLogGains:ac,noise,maxRegression:worst,minGain:minimum};
  metrics[`r134_${mode.replaceAll('-','_')}_aaNoiseLogMax`]=noise;
  metrics[`r134_${mode.replaceAll('-','_')}_acGainLogMin`]=minimum;
  metrics[`r134_${mode.replaceAll('-','_')}_acRegressionLogMax`]=worst;
  const noiseFraction=Math.max(...aaFraction),medianGainFraction=[...acFraction].sort((a,b)=>a-b)[1],worstRegressionFraction=Math.max(...acFraction.map(v=>-v));
  const meaningfulGain=medianGainFraction>noiseFraction+0.02,meaningfulRegression=worstRegressionFraction>noiseFraction+0.02;
  Object.assign(log[mode],{aaAbsoluteBaselineFractions:aaFraction,acBaselineGainFractions:acFraction,noiseFraction,medianGainFraction,worstRegressionFraction,classification:meaningfulRegression?'regression-observed':meaningfulGain?'gain-observed':'within-noise'});
  metrics[`r134_${mode.replaceAll('-','_')}_aaNoiseBaselineFraction`]=noiseFraction;
  metrics[`r134_${mode.replaceAll('-','_')}_acGainMedianBaselineFraction`]=medianGainFraction;
  metrics[`r134_${mode.replaceAll('-','_')}_acRegressionMaxBaselineFraction`]=worstRegressionFraction;
  classifications[`r134_${mode.replaceAll('-','_')}_classification`]=log[mode].classification;
  if(mode==='unlocked-miss')gain=meaningfulGain;regression||=meaningfulRegression;
 }
 return {gainBeyondNoise:gain&&!regression,screenStatus:regression?'parked':gain?'promising':'inconclusive',metrics,rawLogRatios:log,...classifications};
}
