import {diagnostic} from './diagnostic.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {configureExpected} from './screen-core.mjs';
const [arm,tree,out,expectedPath]=process.argv.slice(2),packet=dirname(fileURLToPath(import.meta.url));
try{
 diagnostic.mark('arm-admission');
 mkdirSync(out);
 assert.equal(process.channel?.fd,3);assert.equal(process.versions.node,'24.19.0');
 assert.equal(createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12');
 for(const k of Object.keys(process.env))if(k.startsWith('RS3_')||k.startsWith('R67_')||k.startsWith('NODE_TEST_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','PERF_STAGE_FD'].includes(k))delete process.env[k];
 Object.assign(process.env,{RS3_DATASET:'duo-legacy',RS3_GAME_DEFAULTS_FILE:resolve(packet,'defaults.json'),RS3_PACKS_DIR:'/scratch/absent/packs',RS3_PACK_SELECTION:'/scratch/absent/selection.json',RS3_GAME_DATA_DIR:'/scratch/absent/game',RS3_MAP_ASSETS_DIR:'/scratch/absent/map'});
 configureExpected(expectedPath==='none'?null:JSON.parse(readFileSync(expectedPath)));
 process.argv=[process.execPath,resolve(packet,'driver.mjs'),tree,out,arm];await import('./driver.mjs');
 diagnostic.mark('arm-summary');
 const result=JSON.parse(readFileSync(resolve(out,'results.json')));assert.equal(result.results.length,4);
 diagnostic.mark('arm-ipc');
 await new Promise((ok,no)=>process.send({schema:'r134-child-v1',stage:'complete',result},e=>e?no(e):ok()));process.disconnect();
}catch(error){const context=diagnostic.context(),failure=diagnostic.failure(error),counts=diagnostic.counts();const payload={schema:'r134-child-v1',stage:'failure',failure,...(context.caseOrdinal===undefined?{}:{caseOrdinal:context.caseOrdinal}),counts};try{writeFileSync(resolve(out,'diagnostic.json'),JSON.stringify(payload)+'\n');}catch{}if(process.connected)try{await new Promise(ok=>process.send(payload,()=>ok()));}catch{}process.exitCode=1;if(process.connected)process.disconnect();}
