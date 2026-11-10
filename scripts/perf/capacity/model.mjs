import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function random(seed) {
  let n = Number.parseInt(digest(String(seed)).slice(0, 8), 16);
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function integer(n, min, max, name) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new TypeError(`Invalid ${name}.`);
  return n;
}
export function loopback(value, { assigned = false } = {}) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || !url.port || [8788,8789].includes(Number(url.port)) || (!assigned && (Number(url.port) < 8900 || Number(url.port) > 8999))
    || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Use an HTTP loopback origin on ports 8900–8999.');
  return url.origin;
}
export function planFixture(profile) {
  const { fixture: f, seed } = profile, rng = random(seed);
  integer(f.groups, 1, 2000, 'groups');
  if (!Array.isArray(f.rosterMix) || f.rosterMix.length !== 5 || f.rosterMix.some(n => !Number.isFinite(n) || n < 0) || !f.rosterMix.some(n => n > 0)) throw new TypeError('rosterMix needs five nonnegative weights.');
  if (!Number.isFinite(f.freshFraction) || f.freshFraction < 0 || f.freshFraction > 1) throw new TypeError('Invalid freshFraction.');
  // Largest remainder gives exact reproducible population counts, then shuffle.
  const sum = f.rosterMix.reduce((a,b) => a+b, 0), raw = f.rosterMix.map(n => n / sum * f.groups), counts = raw.map(Math.floor);
  for (const i of raw.map((n,i) => ({ i, remainder: n-counts[i] })).sort((a,b) => b.remainder-a.remainder || a.i-b.i).slice(0, f.groups-counts.reduce((a,b) => a+b,0))) counts[i.i]++;
  const sizes = counts.flatMap((count,i) => Array(count).fill(i+1));
  for (let i=sizes.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [sizes[i],sizes[j]]=[sizes[j],sizes[i]]; }
  return sizes.map((size,index) => ({ index, size, grown: index >= Math.round(f.groups*f.freshFraction), variant: Math.floor(rng()*4),
    members: Array.from({length:size}, (_,i) => ({ id:i ? `member${i+1}` : 'owner', name:`Synthetic ${index+1}-${i+1}`, runescapeName:`S${index+1}M${i+1}` })) }));
}
export function catalogue(shape) {
  const count=integer(shape.chunks,2,10000,'chunks'), tasks=integer(shape.tasks,1,200000,'tasks');
  const depth=integer(shape.dependencyDepth,1,32,'dependencyDepth'), links=integer(shape.crossLinks,1,8,'crossLinks');
  const ids=Array.from({length:count},(_,i)=>String((20+Math.floor(i/100))*256+20+i%100));
  const data={chunks:{},sections:{},walkableChunks:ids,walkableChunksF2P:ids,challenges:{Extra:{}},codeItems:{},equipment:{}};
  for(const [i,id] of ids.entries()) {
    data.chunks[id]={Name:`Synthetic chunk ${i}`,Spawn:{[`Synthetic item ${i}`]:1}};
    data.sections[id]={'0':[ids[i-1],ids[i+1]].filter(Boolean)};
  }
  for(let i=0;i<tasks;i++) data.challenges.Extra[`Synthetic task ${i}`]={Chunks:[ids[i%count]],
    ...(shape.aliases?{PickerId:`rs3:task:capacity-${i}`} : {}),
    Skills:{Mining:1+i%90}, ...(i%depth ? {Items:Array.from({length:links},(_,j)=>`Synthetic item ${((i-j)%count+count)%count}`)} : {}),
    ...(i%depth ? {Tasks:Object.fromEntries(Array.from({length:Math.min(links,i%depth)},(_,j)=>[`Synthetic task ${i-1-j}`,'Extra']))} : {})};
  return data;
}

// Existing custom-world injection keeps the synthetic surface independent of
// the bundled dataset's small geographic crop. The calculator receives this
// complete topology through createServer's existing world option.
export function syntheticWorld(data, buildWorld) {
  const world=buildWorld(data);
  world.surface=new Set(Object.keys(data.chunks));
  world.neighbors=new Map(Object.entries(data.sections).map(([id,sections])=>[id,[...sections['0']]]));
  return world;
}

export const knownGaps = [
  'No durable character entity, multiple-character login, authorized picker switch, group invitation/move/leave/handover or Past maps API. These offered actions are unsupported, never replaced by cheap reads.',
  'Offline registry provisioning represents one login per roster slot without extra default pickers. It does not model first-sign-in consolidation or invitation acceptance.',
  'go-members and bank-start commands require duos; rosters 1–5 are installed with reserveTransferMembers and createGroupState, not new product lifecycle.',
  'Default registry account/picker ceilings cannot hold every target layout. Profiles explicitly use proposed entity caps (3000/3500); runtime traffic/residency/deadline limits stay unchanged.',
  'Stored keys are issued offline through existing key/index APIs, bypassing setup rate/key admission. Runtime admission is unchanged and may reject the target.',
  'Every real durable command retains a preimage. A pinned replacement followed by 1000 History commands and 300 extra snapshots retains at least 1301 snapshots, rather than exactly 300; retention is not disabled or hand-edited.',
  'Initial grown unlocks use one real replace-member command per member. Gameplay matches individual set-chunk commands, but initial History/Undo records batch map replacement rather than a separate action per chunk. All requested durable History/snapshot writes still run independently.',
  'Nominal/step-up/churn target 23939 ordinary task rows, about 91000 identity aliases and 15.4 MB serialized state. Synthetic historical label lengths match volume, not real alias semantics. Dependency depth/cross-links, 4096 chunks, roster mix, grown history and snapshot distribution are assumptions, not calibrated production distributions. Browser rendering, backup overlap, recovery/fault injection, near-import-limit state and multi-trial/soak acceptance need separate experiments.'
];
