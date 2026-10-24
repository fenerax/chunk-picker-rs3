import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {configureOutput} from './oracle-portable.mjs';
import {configureComparison} from './case-comparison.mjs';
const arm=process.argv[2],scratch='/scratch',sha=x=>createHash('sha256').update(x).digest('hex');
const packet=dirname(fileURLToPath(import.meta.url));
const emit=(stage,detail={})=>new Promise((ok,no)=>process.send({schema:'r124-stage-v1',arm,stage,...detail},e=>e?no(e):ok()));
let dir,originalLog=console.log;
try {
 assert.ok(['baseline','candidate'].includes(arm));assert.equal(typeof process.send,'function');assert.equal(process.channel?.fd,3,'IPC must be fd3 from own supervisor');
 assert.equal(process.versions.node,'24.19.0');assert.equal(sha(readFileSync(process.execPath)),'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12');
 for(const k of Object.keys(process.env))if(k.startsWith('RS3_')||k.startsWith('R67_')||k.startsWith('NODE_TEST_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_DEBUG','NODE_DEBUG_NATIVE'].includes(k))delete process.env[k];
 Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_GAME_DEFAULTS_FILE:resolve(packet,'defaults.json'),RS3_PACKS_DIR:'/scratch/absent/packs',RS3_PACK_SELECTION:'/scratch/absent/selection.json',RS3_GAME_DATA_DIR:'/scratch/absent/game',RS3_MAP_ASSETS_DIR:'/scratch/absent/map'});
 for(const p of ['/scratch/absent/packs','/scratch/absent/selection.json','/scratch/absent/game','/scratch/absent/map'])assert.equal(existsSync(p),false);
 const memory=readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),cpu=readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\s+/);
 assert.equal(memory,'6442450944','hard envelope must expose exact 6GiB');assert.notEqual(cpu[0],'max');assert.ok(Number(cpu[0])/Number(cpu[1])<=2 && Number(cpu[0])>0);
 const affinity=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];assert.equal(affinity,'0-1','root must provide CPUs 0,1');
 dir=resolve(scratch,arm);mkdirSync(dir,{recursive:false});
 await emit('scope-gates',{memoryMax:memory,cpuMax:cpu.join(' '),affinity});
 let expected=null;
 if(arm==='candidate'){
  const pending=new Promise((ok,no)=>{
   const disconnected=()=>no(Error('supervisor disconnected before baseline expectations'));
   process.once('disconnect',disconnected);
   process.once('message',message=>{
    process.removeListener('disconnect',disconnected);
    try{assert.equal(message?.schema,'r124-baseline-expected-v1');assert.equal(message.arm,'candidate');ok(message.expected);}catch(error){no(error);}
   });
  });
  await emit('awaiting-baseline');expected=await pending;
 }
 configureComparison(arm,expected);
 const manifest=JSON.parse(readFileSync(new URL('./public-tree.json',import.meta.url)));assert.equal(manifest.pin,'6f22fefa782747790e2eaefa01e4e5ea7b557323');
 let tree='/source';if(arm==='candidate'){tree='/scratch/candidate-source';mkdirSync(tree);}
 for(const [file,expected] of Object.entries(manifest.files)){
  assert.ok(!file.startsWith('/')&&!file.split('/').includes('..'));
  const source=resolve('/source',file);assert.ok(lstatSync(source).isFile()&&!lstatSync(source).isSymbolicLink());assert.ok(realpathSync(source).startsWith('/source/'));
  assert.equal(sha(readFileSync(source)),expected,file);
  if(arm==='candidate'){const target=resolve(tree,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
 }
 if(arm==='candidate')copyFileSync(new URL('./candidate-engine.mjs',import.meta.url),resolve(tree,'app/tasks/engine.mjs'));
 assert.equal(sha(readFileSync(resolve(tree,'app/tasks/engine.mjs'))),arm==='baseline'?'3d6e7e1d177b1bfa35c102911f119d1fe6af7d7e01dab758af41840a8a544a20':'4b89f61b6f3e9ccab48d140bb2d43f10b4cc4a62283002110b4f3571a65247a0');
 configureOutput(dir);console.log=(...args)=>{originalLog(...args);process.send({schema:'r124-stage-v1',arm,stage:'driver-progress',message:args.map(String)});};
 process.argv=[process.execPath,resolve(packet,'driver-portable.mjs'),tree,dir,arm];await emit('before-app-import');
 await import('./driver-portable.mjs');
 const result=JSON.parse(readFileSync(resolve(dir,'results.json')));assert.equal(result.results.length,8);
 for(let i=0;i<8;i++)assert.equal(sha(readFileSync(resolve(dir,`full-result-${String(i).padStart(2,'0')}.tokens.ndjson`))),result.results[i].semanticHash);
 writeFileSync(resolve(dir,'case-result.json'),JSON.stringify({schema:'r124-case-result-v1',status:'complete',arm,results:result},null,2)+'\n');
 await emit('case-complete',{cases:8});process.disconnect();
} catch(error){
 console.log=originalLog;const result={schema:'r124-case-result-v1',status:'failed',arm,error:{name:error.name,message:error.message,stack:error.stack}};
 if(dir)writeFileSync(resolve(dir,'case-result.json'),JSON.stringify(result,null,2)+'\n');
 if(process.connected)try{await emit('case-failed',{error:result.error});}catch{}
 console.error(error.stack);process.exitCode=1;if(process.connected)process.disconnect();
}
