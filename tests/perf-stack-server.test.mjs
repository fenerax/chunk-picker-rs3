import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../scripts/perf/profile-stack.mjs';
import { stopChild } from '../scripts/perf/cdp.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const normalize=value=>JSON.parse(JSON.stringify(value,(key,v)=>['cache','timingMs','elapsedMs','evaluationMs'].includes(key)?undefined:v));
test('real server and process calculator retain results with profiling on and off; IDs reach engine',async()=>{
  const results=[];
  for(const mode of ['off','spans','cpu']){
    const enabled=mode!=='off';
    const scratch=await mkdtemp(path.join(tmpdir(),'rs3-profile-server-test-'));let server;
    try{
      server=await startServer({root,profile:enabled,cpu:mode==='cpu'},scratch);
      const origin=new URL(server.inviteUrl).origin,token=new URL(server.inviteUrl).pathname.slice('/join/'.length);
      const get=async(route,id)=>{const response=await fetch(origin+route,{headers:{Authorization:`Bearer ${token}`,'x-rs3-profile':id}});assert.equal(response.status,200);return response.json();};
      if(enabled)await server.rpc('start','test');
      const state=await get('/api/state?view=play-v1','state');
      const tasks=await get('/api/tasks?memberId=player1&view=play-v1','tasks');
      const proofTask=tasks.tasks.find(t=>t.status==='available'&&!t.id.includes('custom'));
      assert.ok(proofTask);
      const proof=await get(`/api/task-how?memberId=player1&revision=0&taskId=${encodeURIComponent(proofTask.id)}`,'proof');
      results.push(normalize({state,tasks,proof}));
      if(enabled){
        await server.rpc('stop','test');
        const rows=(await Promise.all((await readdir(`${scratch}/trace`)).map(f=>readFile(`${scratch}/trace/${f}`,'utf8')))).join('').trim().split('\n').map(JSON.parse);
        assert.ok(rows.some(r=>r.profileId==='tasks'&&r.layer==='engine'&&r.name==='eligibility'));
        assert.ok(rows.some(r=>r.profileId==='proof'&&r.layer==='engine'&&r.name==='howMs'));
        if(mode==='cpu'){
          assert.ok(rows.some(r=>r.kind==='cpu'&&r.layer==='engine'&&r.profile.samples.length));
          assert.ok(rows.some(r=>r.kind==='cpu'&&r.layer==='relay'&&r.profile.samples.length));
        }else assert.equal(rows.some(r=>r.kind==='cpu'),false);
        assert.ok(rows.some(r=>r.kind==='clock'&&Number.isFinite(r.uncertaintyMs)));
        const ids=new Map(rows.filter(r=>r.kind==='span').map(r=>[r.id,r]));
        for(const row of rows.filter(r=>r.kind==='span'&&r.parentId))assert.equal(ids.get(row.parentId)?.profileId,row.profileId);
      }else await assert.rejects(readdir(`${scratch}/trace`),{code:'ENOENT'});
    }finally{if(server){try{await server.rpc('stop-server');}catch{}await stopChild(server.child);}await rm(scratch,{recursive:true,force:true});}
  }
  assert.deepEqual(results[1],results[0]);assert.deepEqual(results[2],results[0]);
});
