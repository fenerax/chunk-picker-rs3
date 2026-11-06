// Diagnostic counterfactual only: collect cold allocation history before the
// first repeated request. Never used by the app or the unprofiled warm cohort.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {calculatorInput,sha} from './calculator-input.mjs';
import {calculator,replyHash} from './projection-warm.mjs';
import {pairedComparison} from './final-projection-ab.mjs';
const {values:args}=parseArgs({options:{'data-dir':{type:'string'},out:{type:'string'}}});
try{
  if(!args.out?.startsWith('/tmp/')||!args['data-dir']?.startsWith('/tmp/'))throw Error('OptionsError');
  const input=await calculatorInput(args['data-dir']);await mkdir(args.out,{recursive:true});
  const report={format:'projection-gc-control-v1',inputs:input.hashes,node:process.version,plan:{mixed:10,preview:10},complete:false,differences:0,trials:[],naturalRepetitions:3,naturalTrials:[],sourceHashes:{}};
  for(const name of ['engine','obligation-cache'])report.sourceHashes[name]=sha(await readFile(new URL('../../app/tasks/'+name+'.mjs',import.meta.url)));
  report.probeSHA256=sha(await readFile(new URL('./projection-gc-probe.mjs',import.meta.url)));
  const save=async()=>{await writeFile(args.out+'/measurements.json.tmp',JSON.stringify(report,null,2)+'\n');await rename(args.out+'/measurements.json.tmp',args.out+'/measurements.json');};
  await save();
  for(let block=0;block<10;block++)for(const population of Object.keys(report.plan)){
    const limit=Number(await readFile('/sys/fs/cgroup/memory.max','utf8')),used=Number(await readFile('/sys/fs/cgroup/memory.current','utf8'));
    if(limit-used<5*1024**3)throw Error('MemoryAdmissionError');
    const jobs=[];
    try{
      for(const mode of block%2?[1,0]:[0,1])jobs.push({mode,calc:await calculator(input,mode,population,{diagnostic:true})});
      await Promise.all(jobs.map(({calc})=>calc.prepare()));
      for(const {mode,calc}of jobs){
        for(let repetition=0;repetition<report.naturalRepetitions;repetition++){
          const before=await calc.worker.getMemoryUsage(),response=await calc.target(),after=await calc.worker.getMemoryUsage();
          const resultHash=replyHash(response.reply);
          report.naturalTrials.push({population,block,mode,repetition,before,after,measurement:response.measurement,resultHash});
          const pair=report.naturalTrials.filter(t=>t.population===population&&t.block===block&&t.repetition===repetition);
          if(pair.length===2&&pair[0].resultHash!==pair[1].resultHash){report.differences++;await save();throw Error('ResultDifference');}
          await save();
        }
        const history=await calc.worker.getMemoryUsage();
        // ProcessWorker exposes GC to its isolated calculator. Both messages
        // precede the memory barrier; collection is outside the target window.
        calc.worker.postMessage({type:'cancel',id:-2,projectionGC:true});
        calc.worker.postMessage({type:'cancel',id:-3,projectionGC:true});
        const before=await calc.worker.getMemoryUsage();
        if(before.workers[0].memoryUsage.gc.majorCount<=history.workers[0].memoryUsage.gc.majorCount)throw Error('ControlGCUnavailable');
        const response=await calc.target(),after=await calc.worker.getMemoryUsage();
        report.trials.push({population,block,mode,history,before,after,measurement:response.measurement,resultHash:replyHash(response.reply)});
        const pair=report.trials.filter(t=>t.population===population&&t.block===block);
        if(pair.length===2&&pair[0].resultHash!==pair[1].resultHash){report.differences++;throw Error('ResultDifference');}
        await save();
      }
    }finally{await Promise.allSettled(jobs.map(({calc})=>calc.worker.terminate()));}
    console.error(JSON.stringify({population,block,completed:report.trials.length}));
  }
  report.metrics=Object.fromEntries(Object.keys(report.plan).map(population=>[population,pairedComparison(Array.from({length:10},(_,block)=>[0,1].map(mode=>report.trials.find(t=>t.population===population&&t.block===block&&t.mode===mode).measurement.wallMs)))]));
  report.naturalMetrics=Object.fromEntries(Object.keys(report.plan).map(population=>[population,Array.from({length:report.naturalRepetitions},(_,repetition)=>pairedComparison(Array.from({length:10},(_,block)=>[0,1].map(mode=>report.naturalTrials.find(t=>t.population===population&&t.block===block&&t.mode===mode&&t.repetition===repetition).measurement.wallMs))))]));
  report.complete=true;await save();
}catch(error){console.error(JSON.stringify({error:error.name,site:[...(error.stack??'').matchAll(/projection-gc-control.mjs:(\d+):(\d+)/g)].map(m=>m.slice(1))}));process.exitCode=1;}
