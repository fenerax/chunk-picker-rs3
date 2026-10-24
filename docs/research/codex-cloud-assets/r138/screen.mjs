import assert from 'node:assert/strict';
const median = a => { const b=[...a].sort((x,y)=>x-y); assert.ok(b.length>0); return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2; };
const finitePositive = n => typeof n==='number' && Number.isFinite(n) && n>0;
const pairs = [[2,3],[5,4],[6,7]];
export function assessMetrics(raw) {
  const metrics={}, phases={};
  for (const [phase,suffix,optional] of [['first','FirstBodyMs',false],['startup','ReadyMs',false],['warm','WarmBodyMs',true]]) {
    const values=Array.from({length:8},(_,i)=>raw['r138Cell'+i+suffix]);
    if (!optional) values.forEach(n=>assert.ok(finitePositive(n),'complete positive raw timing'));
    else values.forEach(n=>assert.ok(n===undefined||finitePositive(n),'optional timing must stay absent or positive'));
    const controlKnown=finitePositive(values[0])&&finitePositive(values[1]);
    const gains=pairs.map(([a,c],i)=> {
      if (!finitePositive(values[a])||!finitePositive(values[c])) return null;
      const gain=(values[a]-values[c])/values[a];metrics['r138_'+phase+'_pair'+i+'GainFraction']=gain;return gain;
    });
    const known=gains.filter(x=>x!==null), noise=controlKnown?Math.abs(values[0]-values[1])/values[0]:null;
    const threshold=noise===null?null:noise+0.02;
    if (controlKnown) {metrics['r138_'+phase+'_aaNoiseFraction']=noise;metrics['r138_'+phase+'_hurdleFraction']=threshold;}
    if (known.length) metrics['r138_'+phase+'_medianPairedGainFraction']=median(known);
    const complete=controlKnown&&known.length===3;
    // Two of three individually exceed the fresh A/A noise plus two percentage points.
    const recurringRegression=complete?known.filter(gain=>gain < -threshold).length>=2:null;
    phases[phase]={complete,pairCount:known.length,noise,threshold,medianGain:known.length?median(known):null,recurringRegression};
  }
  const primary=phases.first, gainBeyondNoise=primary.complete&&primary.medianGain>primary.threshold;
  const veto=phases.startup.recurringRegression===true||phases.warm.recurringRegression===true;
  const screenStatus=veto?'parked':gainBeyondNoise&&phases.warm.complete?'promising':'inconclusive';
  const controlStatus = phase => !phase.complete?'unobserved':phase.recurringRegression?'recurring-regression':'clear';
  return {fields:{screenStatus,gainBeyondNoise,primaryPairCount:primary.pairCount,warmPairCount:phases.warm.pairCount,
      startupControlStatus:controlStatus(phases.startup),warmControlStatus:controlStatus(phases.warm)},metrics};
}
