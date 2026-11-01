import { appendFileSync, mkdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { isMainThread, threadId } from 'node:worker_threads';
import path from 'node:path';
const enabled=process.env.RS3_PROFILE==='1',directory=process.env.RS3_PROFILE_DIR;
if(enabled&&directory) {
  const clock=()=>Number(process.hrtime.bigint())/1e6,processId=`${process.pid}-${threadId}`;
  const emit=(phase,start,end,extra={})=>{
    try{mkdirSync(directory,{recursive:true});appendFileSync(path.join(directory,`${processId}.jsonl`),JSON.stringify({kind:'startup',processId,phase,start,end,...extra})+'\n');}catch{}
  };
  globalThis[Symbol.for('rs3.profile.startup')]=emit;
  emit('preload',clock(),clock(),{main:isMainThread});
  registerHooks({load(url,context,next){
    if(!url.includes('/app/')||!url.endsWith('.mjs'))return next(url,context);
    const start=clock(),result=next(url,context);emit('module.load',start,clock(),{module:url.slice(url.lastIndexOf('/app/')+1)});
    const source=String(result.source),module=url.slice(url.lastIndexOf('/app/')+1);
    const phase=url.endsWith('/app/dataset-runtime.mjs')?'dataset.evaluate':'module.evaluate';
    // The loader's sync callback measures source loading; these two in-memory
    // statements measure evaluation (including TLA). They never inspect data.
    const prefix=`const __rs3ModuleProfileStart=Number(process.hrtime.bigint())/1e6;\n`;
    const suffix=`\nglobalThis[Symbol.for('rs3.profile.startup')]?.(${JSON.stringify(phase)},__rs3ModuleProfileStart,Number(process.hrtime.bigint())/1e6,{module:${JSON.stringify(module)}});\n`;
    return {...result,source:prefix+source.replace(/^#![^\n]*\n/,'')+suffix};
  }});
}
