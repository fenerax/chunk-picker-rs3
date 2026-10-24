import assert from 'node:assert/strict';
export const OUTPUTS={'app/server.mjs':'77e37222c77bb3eeaf56e0b93f5b3d34d8fb48deef3e93aa331dcfc1b1603329','app/tasks/worker.mjs':'ac1c2603ea7ec759d0dd1a64abfe60c32c9f6bf69de21996cdcbe14c060f1e66'};
export function schedule(){return ['A','A','A','C','C','A','A','C'].map((arm,index)=>({index,arm,group:index<2?'AA-control':'pair-'+Math.floor((index-2)/2),fresh:true}));}
export function checkProvider(files,baseline,arm){
 assert.equal(files.length,94);assert.equal(files.filter(x=>x.kind==='input').length,61);assert.equal(files.filter(x=>x.kind==='evidence').length,33);
 assert.equal(new Set(files.map(x=>x.path)).size,94);
 for(const f of files){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(f.bytes)&&f.bytes>0);}
 if(!baseline){assert.equal(arm,'A');return;}
 const map=new Map(files.map(x=>[x.path,x]));let changed=0;
 for(const old of baseline){const now=map.get(old.path);assert.ok(now);assert.equal(now.kind,old.kind);
  if(arm==='C'&&Object.hasOwn(OUTPUTS,old.path)){assert.equal(now.sha256,OUTPUTS[old.path]);assert.notEqual(now.sha256,old.sha256);changed++;}
  else{assert.equal(now.sha256,old.sha256);assert.equal(now.bytes,old.bytes);}
 }
 assert.equal(changed,arm==='C'?2:0);
}
