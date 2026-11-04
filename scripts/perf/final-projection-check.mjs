// Forced-reference differential on ordinary process calculators. Numeric/hash
// output only; states/results never leave memory and no storage is opened.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { calculatorInput, sha, sharedJSON } from './calculator-input.mjs';
import { acceptCalculatorRoll } from './calculator-sequences.mjs';
import { canonical } from '../../tools/calc-check/compare.mjs';
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(p => url.endsWith(p))) throw Error('ForbiddenImport');
  return next(url, context);
} });
const { values: args } = parseArgs({ options: { 'data-dir': { type: 'string' }, out: { type: 'string' },
  parallel: { type: 'boolean' }, 'candidate-default': { type: 'boolean' }, sequences: { type: 'string', default: '3' }, depth: { type: 'string', default: '3' } } });
const report = { format: 'final-projection-check-v1', complete: false, differences: 0, pairs: 0, counts: {} };
let output;
async function main() {
  const target = path.resolve(args.out);
  const parent = await realpath(path.dirname(target));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw Error('OutputLocationError');
  await writeFile(target, JSON.stringify(report), { flag: 'wx' });
  output = target;
  const sequences = Number(args.sequences), depth = Number(args.depth);
  if (!Number.isSafeInteger(sequences) || sequences < 3 || !Number.isSafeInteger(depth) || depth < 3) throw Error('SequenceCountError');
  const input = await calculatorInput(args['data-dir']);
  const [{ ProcessWorker }, { prepareChunkPrediction }, { buildWhyChain }] = await Promise.all([
    import('../../app/tasks/process-worker.mjs'), import('../../app/core/planning.mjs'), import('../../app/tasks/why-chain.mjs'),
  ]);
  report.inputs = input.hashes; report.node = process.version;
  report.candidateDefault = !!args['candidate-default'];
  report.sourceHashes = Object.fromEntries(await Promise.all(['engine','obligation-cache'].map(async name =>
    [name,sha(await readFile(new URL('../../app/tasks/'+name+'.mjs',import.meta.url)))])));
  const expected = [], actual = [], totals = [], initialPools = [[],[]], workers = new Set();
  let fatal;
  const dummy = { evaluate: () => ({ tasks: [], items: [], access: {} }) };
  const predictState = prepareChunkPrediction(input.state, input.registry);
  const decode = value => {
    if (value instanceof SharedArrayBuffer || value instanceof ArrayBuffer || Buffer.isBuffer(value)) return JSON.parse(Buffer.from(value));
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,decode(v)]));
    return value;
  };
  const previous = process.env.RS3_FINAL_PROJECTION;
  const runMode = async mode => {
      if (mode === '1' && args['candidate-default']) delete process.env.RS3_FINAL_PROJECTION;
      else process.env.RS3_FINAL_PROJECTION = mode;
      const worker = new ProcessWorker(input.workerData); workers.add(worker);
      let requestId = 0, snapshot, pair = 0, pickerId = 'self-check-pool';
      const aggregate = createHash('sha256'), counts = { members: input.state.members.length, candidates: 0, sequences: 0, accepted: 0, responses: 0, why: 0, how: 0 };
      const check = (kind, value) => {
        const hash = sha(JSON.stringify(canonical(value)));
        aggregate.update(kind).update(hash);
        if (fatal) throw Error('PeerFailure');
        (mode === '0' ? expected : actual)[pair] = hash;
        if (expected[pair] !== undefined && actual[pair] !== undefined) {
          report.pairs++;
          if (expected[pair] !== actual[pair]) {
            report.differences++;
            report.firstDifference = { pair, referenceHash: expected[pair], candidateHash: actual[pair] };
            throw Error('CheckDifference');
          }
        }
        pair++;
      };
      const request = async (state, memberId, type, extra = {}) => {
        if (fatal) throw Error('PeerFailure');
        const id = ++requestId, key = sha(JSON.stringify(state));
        let transfer = {};
        if (key !== snapshot && ['predict','death-estimates'].includes(type)) transfer = { state };
        else if (key !== snapshot) {
          const stateJSON = sharedJSON(state);
          transfer = { stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: stateJSON.byteLength,
            stateRevision: state.revision, stateMemberIds: state.members.map(m => m.id) };
        }
        const reply = await new Promise((resolve, reject) => {
          const prepared = [], timer = setTimeout(() => { cleanup(); reject(Error('TimeoutError')); }, 120000);
          function cleanup() { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); }
          function fail() { cleanup(); reject(Error('WorkerError')); }
          const body = message => Object.fromEntries(['result','resultJSON','playJSON','duoJSON','duoSidebarJSON','unlockReuse','partnerUnlockReuse']
            .filter(k => message[k] !== undefined).map(k => [k,decode(message[k])]));
          function receive(message) {
            if (message.id !== id || message.type === 'progress') return;
            if (message.type === 'prediction-prepared') { prepared.push(body(message)); return; }
            cleanup(); if (message.error) { report.failedRequest={mode:Number(mode),id,type}; reject(Error('RequestError')); } else resolve({ value: body(message), prepared });
          }
          worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
          worker.postMessage({ id, pickerId, type, memberId, input: key, snapshotKey: JSON.stringify([state.revision,key]), ...transfer, ...extra });
        });
        snapshot = key; counts.responses++; check(type, reply);
        return reply.value.result ?? reply.value.resultJSON;
      };
      const inspect = async state => {
        for (const member of state.members) {
          const result = await request(state, member.id, 'evaluate', { resultTransport: 'json-shared-v1', resultView: 'full' });
          const rows = result.tasks.filter(row => !row.hidden && row.obligation !== false);
          const indices = [...new Set([0,Math.floor(rows.length/2),rows.length-1])].filter(i => i >= 0 && rows[i]);
          for (const index of indices) {
            const taskId = rows[index].id;
            check('why', buildWhyChain(result, input.definitions, { taskId })); counts.why++;
            await request(state, member.id, 'how-task', { chunkId: taskId }); counts.how++;
          }
          await request(state, member.id, 'roll-pool');
        }
      };
      try {
        await new Promise((resolve,reject) => { worker.once('message', m => m.type==='ready'?resolve():reject(Error('ReadyError'))); worker.once('error',reject); worker.once('exit',()=>reject(Error('ReadyExit'))); });
        await inspect(input.state);
        for(let sequence=0;sequence<sequences;sequence++) {
          let state = input.state; pickerId = `self-check-sequence-${sequence}`; snapshot = undefined;
          for(let step=0;step<depth;step++) {
            const member = state.members[(sequence+step)%state.members.length];
            const epoch = Date.UTC(2030,0,1)+(sequence*depth+step)*4000;
            if(member.pendingRoll.length)state=input.core.applyCommand(state,{type:'cancel-roll',memberId:member.id},{world:input.world,registry:input.registry,now:new Date(epoch)});
            const pool = await request(state,member.id,'roll-pool'), rows = pool.pool.eligible;
            if(!rows.length) throw Error('EmptySequencePool');
            const accepted = acceptCalculatorRoll(input,state,member.id,pool,(sequence*3+step)%rows.length,epoch+1000);
            await request(accepted.previewState,member.id,'predict',{chunkId:accepted.chunkId,predictionProgress:true,previewProgress:true});
            state=accepted.state;
            await inspect(state); counts.accepted++;
          }
          counts.sequences++; console.error(JSON.stringify({mode:Number(mode),sequences:counts.sequences}));
        }
        pickerId = 'self-check-pool'; snapshot = undefined;
        for (const [memberIndex, member] of input.state.members.entries()) {
          const pool = await request(input.state,member.id,'roll-pool');
          const candidates = pool.pool.eligible.map(row => row.id);
          initialPools[Number(mode)][memberIndex] = candidates;
          for(const chunkId of candidates) {
            await request(input.state,member.id,'predict',{chunkId,predictionProgress:true,previewProgress:true});
            const hypothetical = predictState(member.id,chunkId,{world:input.world,engine:dummy}).state;
            await inspect(hypothetical); counts.candidates++;
            console.error(JSON.stringify({mode:Number(mode),candidates:counts.candidates}));
          }
        }
        totals[Number(mode)] = { hash: aggregate.digest('hex'), pairs: pair, counts };
      } catch(error) {
        fatal ??= error;
        await Promise.allSettled([...workers].map(value => value.terminate()));
        throw error;
      } finally { await worker.terminate(); workers.delete(worker); }
  };
  try {
    if (args.parallel) {
      const memory = await readFile('/proc/meminfo', 'utf8');
      const available = Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]) * 1024;
      const limit = (await readFile('/sys/fs/cgroup/memory.max','utf8')).trim();
      const used = Number(await readFile('/sys/fs/cgroup/memory.current','utf8'));
      const spare = limit === 'max' ? available : Number(limit)-used;
      const required = 10*1024**3;
      report.memoryAdmission = { availableBytes: available, cgroupSpareBytes: spare, requiredBytes: required };
      if (!(available >= required && spare >= required)) throw Error('ParallelMemoryError');
      const runs = await Promise.allSettled(['0','1'].map(runMode));
      if (runs.some(run => run.status === 'rejected')) throw fatal ?? Error('ParallelCheckError');
    } else for (const mode of ['0','1']) await runMode(mode);
  } finally { if(previous===undefined)delete process.env.RS3_FINAL_PROJECTION;else process.env.RS3_FINAL_PROJECTION=previous; }
  if(totals[0].pairs!==totals[1].pairs||totals[0].hash!==totals[1].hash)throw Error('CoverageDifference');
  report.reference=totals[0];report.candidate=totals[1];
  if(JSON.stringify(initialPools[0])!==JSON.stringify(initialPools[1]))throw Error('PoolDifference');
  report.counts.poolCandidates=initialPools[0].map(rows=>rows.length); report.complete=true;
}
try { const start=performance.now(); await main();report.durationMs=performance.now()-start; }
catch(error) { report.error=error.name; const site=/final-projection-check.mjs:(\d+):(\d+)/.exec(error.stack??''); if(site)report.failureSite=site.slice(1).map(Number);process.exitCode=1; }
finally { if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report)); }
