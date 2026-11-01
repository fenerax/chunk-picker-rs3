// Optional checker diagnostics. Never log bodies, member IDs, labels or paths.
// Preload with node --import and set RS3_CACHE_CHECK_TRACE to an external log.
import { Calculator } from '../../tools/calc-check/client.mjs';
import { appendFileSync } from 'node:fs';
const output = process.env.RS3_CACHE_CHECK_TRACE;
if (output && !output.startsWith('/tmp/')) throw new Error('Trace location must be temporary.');
if (output) {
  let next = 0;
  const ids = new WeakMap();
  const id = value => { if (!ids.has(value)) ids.set(value, ++next); return ids.get(value); };
  const log = (value, event, extra = {}) => appendFileSync(output, JSON.stringify({ calculator: id(value), event, atMs: performance.now(), ...extra }) + '\n');
  for (const name of ['init','close']) {
    const original = Calculator.prototype[name];
    Calculator.prototype[name] = async function(...args) {
      log(this, name + '-start', name === 'init' ? { datasetHash: args[0].datasetDigest, tasks: Object.values(args[0].definitions.challenges ?? {}).reduce((n,rows) => n + Object.keys(rows).length, 0) } : {});
      try { const value = await original.apply(this,args); log(this,name + '-end'); return value; }
      catch (error) { log(this,name + '-error'); throw error; }
    };
  }
  const request = Calculator.prototype.request;
  Calculator.prototype.request = function(header,state) {
    const result = request.call(this,header,state);
    log(this,'request-start',{ request: result.id, type: header.type });
    result.promise = result.promise.then(value => { log(this,'request-end',{request:result.id}); return value; }, error => { log(this,'request-error',{request:result.id}); throw error; });
    return result;
  };
  const sample = Calculator.prototype.sampleMemory;
  Calculator.prototype.sampleMemory = async function() {
    if (this.samplingMemory) return sample.call(this);
    const began = performance.now();
    try { return await sample.call(this); }
    finally { const ms = performance.now() - began; if (ms > 250) log(this,'memory-sample',{durationMs:ms,pids:this.memoryPids?.length??0}); }
  };
}
