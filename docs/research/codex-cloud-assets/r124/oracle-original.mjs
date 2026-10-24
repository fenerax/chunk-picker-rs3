import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
function comparable(result) {
  // Exact sole exception: root result.metrics.elapsedMs. Preserve descriptors,
  // ordinary enumerable values/order; named hidden fields are asserted separately.
  const metrics = Object.create(Object.getPrototypeOf(result.metrics), Object.getOwnPropertyDescriptors(result.metrics));
  delete metrics.elapsedMs;
  const copy = Object.create(Object.getPrototypeOf(result), Object.getOwnPropertyDescriptors(result));
  copy.metrics = metrics;
  return copy;
}
const hiddenMetricNames = ['processingAccessEvaluations', 'processingBaseCollections',
  'processingFinalizations', 'processingIncrementalPasses', 'processingFallbacks',
  'processingRawAccessEvaluations', 'processingPasses'];
function assertHidden(left, right, key, label) {
  const a = Object.getOwnPropertyDescriptor(left, key), b = Object.getOwnPropertyDescriptor(right, key);
  assert.ok(a && b, `${label}.${key}: own property required on both results`);
  for (const descriptor of [a, b]) {
    assert.ok(Object.hasOwn(descriptor, 'value'), `${label}.${key}: data property required`);
    assert.equal(descriptor.enumerable, false, `${label}.${key}: must remain hidden`);
    assert.equal(descriptor.writable, false, `${label}.${key}: must remain read-only`);
  }
  assert.equal(a.configurable, b.configurable, `${label}.${key}: configurable flag`);
  assert.deepStrictEqual(a.value, b.value, `${label}.${key}: published value`);
}
function assertEquivalent(candidate, baseline, label) {
  assert.deepStrictEqual(comparable(candidate), comparable(baseline), label);
  assertHidden(candidate, baseline, 'processing', label);
  for (const key of hiddenMetricNames) assertHidden(candidate.metrics, baseline.metrics, key, `${label}.metrics`);
  assert.equal(candidate.tasks.length, baseline.tasks.length, `${label}.tasks length`);
  candidate.tasks.forEach((row, i) => assertHidden(row, baseline.tasks[i], 'processingPrimary', `${label}.tasks[${i}]`));
}


export function negativeControls(){
  // Authored tiny results; no engine import, fixture provider or copied dependency algorithm.
  const toy = ({ processing = 1, primary = true, counter = 1, elapsed = 1,
    omitCounter = false, configurable = false, nestedElapsed = 1 } = {}) => {
    const result = { tasks: [{}], metrics: { elapsedMs: elapsed } };
    Object.defineProperty(result, 'processing', { value: { value: processing, elapsedMs: nestedElapsed }, configurable });
    Object.defineProperty(result.tasks[0], 'processingPrimary', { value: primary });
    for (const key of hiddenMetricNames) if (!(omitCounter && key === 'processingAccessEvaluations')) {
      Object.defineProperty(result.metrics, key, { value: counter });
    }
    return result;
  };
  const baseline = toy();
  assert.doesNotThrow(() => assertEquivalent(toy({ elapsed: 999 }), baseline, 'root elapsed only'));
  for (const [name, change] of Object.entries({ processing: { processing: 2 }, primary: { primary: false },
    counter: { counter: 2 }, presence: { omitCounter: true }, flags: { configurable: true },
    nestedElapsed: { nestedElapsed: 2 } })) {
    assert.throws(() => assertEquivalent(toy(change), baseline, name), { name: 'AssertionError' }, name);
  }

return true; }
export {assertEquivalent};
export function fingerprint(value, omitRootElapsed = false) {
 const h=createHash('sha256'), seen=new Map();
 const put=v=>h.update(JSON.stringify(v)+'\n');
 function visit(v,path) {
  if(v===null){put(['null']);return;}
  const t=typeof v;
  if(t==='undefined'||t==='boolean'||t==='string'||t==='bigint'){put([t,t==='bigint'?String(v):v]);return;}
  if(t==='number'){put(['number',Number.isNaN(v)?'NaN':Object.is(v,-0)?'-0':String(v)]);return;}
  if(t!=='object')throw Error('unsupported '+t+' at '+path);
  if(seen.has(v)){put(['ref',seen.get(v)]);return;}seen.set(v,seen.size);
  const p=Object.getPrototypeOf(v);let tag=p===null?'null':p===Object.prototype?'Object':p===Array.prototype?'Array':p===Map.prototype?'Map':p===Set.prototype?'Set':null;
  if(!tag)throw Error('unsupported prototype at '+path);put(['object',tag,seen.get(v)]);
  if(tag==='Map')for(const [k,x] of v){visit(k,path+'<key>');visit(x,path+'<value>');}
  if(tag==='Set')for(const x of v)visit(x,path+'<set>');
  for(const key of Reflect.ownKeys(v)){
   if(typeof key!=='string')throw Error('unsupported symbol key at '+path);
   if(omitRootElapsed&&path==='$.metrics'&&key==='elapsedMs')continue;
   const d=Object.getOwnPropertyDescriptor(v,key);if(!Object.hasOwn(d,'value'))throw Error('unsupported accessor at '+path+'.'+key);
   put(['key',key,d.enumerable,d.writable,d.configurable]);visit(d.value,path+'.'+key);
  }put(['end']);
 }visit(value,'$');return h.digest('hex');
}
