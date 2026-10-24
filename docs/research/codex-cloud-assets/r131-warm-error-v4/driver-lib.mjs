import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function requirePublicOnly(env = process.env) {
  for (const key of ['RS3_DATASET_PROFILE','RS3_PACKS_DIR','RS3_PACK_SELECTION','RS3_PRIVATE_ADDON','RS3_PERF_STATE','RS3_PERF_COMPANION_ROOT'])
    if (env[key]) throw new Error(`External input selector forbidden: ${key}`);
  if (env.RS3_DATASET && env.RS3_DATASET !== 'duo-legacy') throw new Error('Expected public duo-legacy selection');
}
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b); return sorted[Math.max(0, Math.ceil(p * sorted.length)-1)];
}
export function summary(values) {
  let min=null,max=null; for(const value of values){min=min===null?value:Math.min(min,value);max=max===null?value:Math.max(max,value);}
  return {count:values.length,min,max,p99:percentile(values,.99)};
}
export function serializedState(state, inputKey) {
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length); Buffer.from(stateJSON).set(bytes);
  return { inputKey, stateJSON };
}
export function orderedIndex(index) {
  return { byLocation: [...index.byLocation].map(([key, rows]) => [key,[...rows]]), clues: [...index.clueLocations] };
}
export function authoredDefinitions(scale = 1) {
  const chunks = { '12341': { Object: { Anchor: 1 } }, '12342': { Spawn: { Token: 1 } } };
  for (let i=0;i<scale;i++) chunks[String(20000+i)] = { Object: { Anchor: 1 } };
  const Quest = { 'Present quest': { Chunks: ['12341'], Objects: ['Anchor'] }, 'Future quest': { Chunks: ['12342'] } };
  for (let i=0;i<scale;i++) Quest[`Authored ${i}`] = { Objects: ['Anchor'] };
  return { chunks, walkableChunks: Object.keys(chunks), walkableChunksF2P: Object.keys(chunks), challenges: { Quest }, clues: { easy: { '12341': false } } };
}
