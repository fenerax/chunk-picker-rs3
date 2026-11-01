import { stats } from './report.mjs';
// Percentile bootstrap of the median of paired differences, not a bootstrap
// of the two independent arms. Deterministic resampling makes it inspectable.
export function bootstrapPaired(differences, { samples = 20000, seed = 1729 } = {}) {
  if (!differences.length || differences.some(n=>!Number.isFinite(n))) throw new TypeError('Finite paired differences required');
  let state=seed>>>0;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const medians=[];
  for(let i=0;i<samples;i++)medians.push(stats(differences.map(()=>differences[Math.floor(random()*differences.length)])).median);
  medians.sort((a,b)=>a-b);
  const quantile=p=>{const position=(medians.length-1)*p,a=Math.floor(position),f=position-a;return medians[a]*(1-f)+medians[Math.min(a+1,medians.length-1)]*f;};
  return { pairedCount:differences.length, median:stats(differences).median, min:Math.min(...differences),max:Math.max(...differences),
    confidence:0.95,interval:[quantile(.025),quantile(.975)],method:'paired percentile bootstrap of median',samples,seed };
}
