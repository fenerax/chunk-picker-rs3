import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
process.env.RS3_DATASET='open-f2p';
for(const key of ['RS3_DATASET_PROFILE','RS3_DATASET_PROFILE_SHA256','RS3_PACKS_DIR','RS3_PACK_SELECTION'])delete process.env[key];
const [root,fixturePath]=process.argv.slice(2),bytes=fs.readFileSync(fixturePath),fixture=JSON.parse(bytes);
const {selectDuoTasks}=await import(pathToFileURL(path.join(root,'app/web/duo-tasks.mjs')));
const registry={resolve:rules=>({'tasks.completion':'any',...rules})};
const select=()=>selectDuoTasks({state:fixture.state,results:fixture.results,registry,selectedMemberId:'alpha',personalFilter:'not-done'});
for(let i=0;i<3;i++)select();
const cpuMs=[],wallMs=[],outputs=[];
for(let i=0;i<3;i++){
 globalThis.gc?.();const cpu=process.cpuUsage(),start=performance.now(),result=select(),wall=performance.now()-start,used=process.cpuUsage(cpu);
 cpuMs.push((used.user+used.system)/1000);wallMs.push(wall);
 const text=JSON.stringify(result);outputs.push({sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text),counts:result.counts});
}
console.log(JSON.stringify({node:process.version,inputSha256:createHash('sha256').update(bytes).digest('hex'),cpuMs,wallMs,outputs}));
