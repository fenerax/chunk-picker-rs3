import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { taskId } from '../app/tasks/engine.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = JSON.parse(await readFile(new URL('./fixtures/runemetrics/examplegimab-profile.json', import.meta.url), 'utf8'));
const quests = JSON.parse(await readFile(new URL('./fixtures/runemetrics/examplegimab-quests.json', import.meta.url), 'utf8'));
const privateError = JSON.parse(await readFile(new URL('./fixtures/runemetrics/errors.json', import.meta.url), 'utf8')).private;
const brokenId = taskId('Quest', '~|Broken Home|~ Complete the quest');
const stepId = taskId('Quest', '~|Broken Home|~ 1');
const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: { Quest: {
  '~|Broken Home|~ 1': {BaseQuest:'Broken Home'}, '~|Broken Home|~ Complete the quest': {BaseQuest:'Broken Home',QuestPoints:1}, 'Necromancy!': {QuestPoints:1},
} } };
function response(url) { return new Response(JSON.stringify(url.pathname.endsWith('/quests') ? quests : profile), {headers:{'Content-Type':'application/json'}}); }
async function fixture(t, {fetchImpl = async url => response(url), timeoutMs, initialState} = {}) {
  await mkdir(path.join(root,'.local'),{recursive:true});
  const directory = await mkdtemp(path.join(root,'.local','runemetrics-test-'));
  assert.ok(!path.relative(root,directory).startsWith('..'));
  const options = { dataDir:path.join(directory,'data'), definitions, taskMap:{}, port:0, shutdownDeadlineMs:500, runeMetrics:{fetchImpl,...(timeoutMs?{timeoutMs}:{})} };
  const applications=[];
  let app;
  t.after(async()=>{
    try {
      for(const application of applications) await application.close();
    } finally {
      applications.length=0;
      app=undefined;
      try { assert.ok(!path.relative(root,directory).startsWith('..')); }
      finally { await rm(directory,{recursive:true,force:true}); }
    }
  });
  app=await createServer({ dataset: fixtureDataset,...options,initialState}); applications.push(app); await app.listen();
  const origin=`http://127.0.0.1:${app.address().port}`;
  const headers={Authorization:`Bearer ${app.store.getAccessToken()}`};
  const api=(route,body,extra={})=>fetch(`${origin}${route}`,{headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...extra},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  return {app,api,origin,async reopen(){await app.close();app=undefined;app=await createServer({ dataset: fixtureDataset, ...options });applications.push(app);return app;}};
}

test('RuneMetrics preview/apply is authenticated, server-bound, personal, durable and one undoable command',async t=>{
  const initialState=createGroupState([{id:'player1',name:'Player 1'},{id:'player2',name:'Player 2'}]);
  initialState.tasks=[{id:brokenId,label:'Broken Home Complete the quest',category:'Quest'}];
  initialState.members[0].taskStatus={[brokenId]:{challengeCompleted:false,favorite:true}};
  initialState.members[0].passiveLevels={Mining:5}; initialState.members[0].maxLevels={Mining:30};
  let calls=0;
  const {api,origin,reopen}=await fixture(t,{initialState,fetchImpl:async url=>{calls++;return response(url);}});
  assert.equal((await fetch(`${origin}/api/runemetrics/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"memberId":"player1"}'})).status,401);
  assert.equal((await api('/api/runemetrics/preview',{memberId:'player1'},{Origin:'https://foreign.example'})).status,403);
  assert.equal((await api('/api/runemetrics/preview',{memberId:'player1',user:'Someone'})).status,400);
  assert.equal((await api('/api/runemetrics/preview',{memberId:'missing'})).status,400); assert.equal(calls,0);
  const before=(await (await api('/api/state')).json()).state;
  const forged=await api('/api/command',{expectedRevision:before.revision,command:{type:'apply-runemetrics',memberId:'player1',runescapeName:'exampleGIMab',fetchedAt:'2026-10-07T12:00:00Z',skills:[],quests:[{taskId:stepId,title:'Broken Home'}]}});
  assert.equal(forged.status,400); assert.match((await forged.json()).message,/RuneMetrics sync preview/);
  const previewResponse=await api('/api/runemetrics/preview',{memberId:'player1'}); assert.equal(previewResponse.status,200);
  const preview=await previewResponse.json();
  assert.equal(preview.skills.length,29); assert.equal(preview.quests.length,2); assert.equal(preview.stateRevision,before.revision);
  assert.equal(preview.unmatched.quests.length,11); assert.equal(preview.runescapeName,'exampleGIMab');
  assert.deepEqual((await (await api('/api/state')).json()).state,before);
  assert.equal((await api('/api/runemetrics/apply',{previewId:preview.previewId,expectedRevision:preview.stateRevision,skills:[]})).status,400);
  const appliedResponse=await api('/api/runemetrics/apply',{previewId:preview.previewId,expectedRevision:preview.stateRevision}); assert.equal(appliedResponse.status,200);
  const applied=(await appliedResponse.json()).state, owner=applied.members[0];
  assert.equal(applied.revision,before.revision+1); assert.equal(applied.history.length,before.history.length+1);
  assert.equal(owner.skillProgress.Necromancy.level,20); assert.equal(owner.skillProgress.Necromancy.xp,4470);
  assert.equal(owner.skillProgress.Necromancy.source,'runemetrics'); assert.equal(owner.skillProgress.Necromancy.fetchedAt,preview.fetchedAt);
  assert.equal(owner.questProgress[brokenId].fetchedAt,preview.fetchedAt);
  assert.ok(owner.completedTasks.includes(brokenId)); assert.ok(!owner.completedTasks.includes(stepId));
  assert.deepEqual(owner.taskStatus,before.members[0].taskStatus); assert.deepEqual(owner.passiveLevels,before.members[0].passiveLevels); assert.deepEqual(owner.maxLevels,before.members[0].maxLevels);
  assert.deepEqual(applied.members[1],before.members[1]); assert.deepEqual(applied.rules,before.rules);
  assert.equal((await api('/api/runemetrics/apply',{previewId:preview.previewId,expectedRevision:applied.revision})).status,410);
  assert.deepEqual((await (await api('/api/backup')).json()).state.members,applied.members);
  const undone=(await (await api('/api/command',{expectedRevision:applied.revision,command:{type:'undo'}})).json()).state;
  assert.deepEqual(undone.members,before.members);
  const secondPreview=await (await api('/api/runemetrics/preview',{memberId:'player1'})).json(); assert.equal(secondPreview.cached,true); assert.equal(secondPreview.quests.length,2); assert.equal(calls,2);
  const reapplied=(await (await api('/api/runemetrics/apply',{previewId:secondPreview.previewId,expectedRevision:secondPreview.stateRevision})).json()).state;
  const restarted=await reopen(); assert.deepEqual(restarted.store.getState().members,reapplied.members);
});

test('stale reviews reject changed shared revisions, even with a substituted current revision',async t=>{
  const {api}=await fixture(t);
  const preview=await (await api('/api/runemetrics/preview',{memberId:'player1'})).json();
  const edited=(await (await api('/api/command',{expectedRevision:preview.stateRevision,command:{type:'set-note',memberId:'player2',chunkId:'12341',note:'A concurrent save'}})).json()).state;
  for(const expectedRevision of [preview.stateRevision,edited.revision]) {
    const rejected=await api('/api/runemetrics/apply',{previewId:preview.previewId,expectedRevision}); assert.equal(rejected.status,409);
    assert.equal((await rejected.json()).state.revision,edited.revision);
    assert.deepEqual((await (await api('/api/state')).json()).state.members,edited.members);
  }
  const refreshed=await (await api('/api/runemetrics/preview',{memberId:'player1'})).json();
  assert.equal(refreshed.cached,true); assert.equal(refreshed.stateRevision,edited.revision);
  assert.equal((await api('/api/runemetrics/apply',{previewId:refreshed.previewId,expectedRevision:refreshed.stateRevision})).status,200);
});

test('a pending upstream fetch leaves health and saves responsive and previews the latest state',async t=>{
  let release,started; const gate=new Promise(resolve=>{release=resolve;}), fetching=new Promise(resolve=>{started=resolve;});
  const {api}=await fixture(t,{fetchImpl:async url=>{started();await gate;return response(url);}});
  const request=api('/api/runemetrics/preview',{memberId:'player1'}); await fetching;
  const before=(await (await api('/api/state')).json()).state;
  const health=await api('/api/health'); assert.equal(health.status,200);
  const edited=(await (await api('/api/command',{expectedRevision:before.revision,command:{type:'set-note',memberId:'player2',chunkId:'12341',note:'Server stays responsive'}})).json()).state;
  release(); const preview=await (await request).json(); assert.equal(preview.stateRevision,edited.revision);
  assert.deepEqual((await (await api('/api/state')).json()).state.members,edited.members);
});

test('a binding changed during fetching invalidates the old account result',async t=>{
  let release,started; const gate=new Promise(resolve=>{release=resolve;}), fetching=new Promise(resolve=>{started=resolve;});
  const {api}=await fixture(t,{fetchImpl:async url=>{started();await gate;return response(url);}});
  const before=(await (await api('/api/state')).json()).state;
  const request=api('/api/runemetrics/preview',{memberId:'player1'}); await fetching;
  await api('/api/command',{expectedRevision:before.revision,command:{type:'set-runescape-name',memberId:'player1',name:'Someone'}});
  release(); const result=await request; assert.equal(result.status,409); assert.match((await result.json()).message,/name changed/);
  assert.equal((await (await api('/api/state')).json()).state.members[0].skillProgress,undefined);
});

test('private profile and timeout return actionable API errors without changing state',async t=>{
  for(const scenario of ['private','timeout']) {
    const {api}=await fixture(t,{timeoutMs:20,fetchImpl:scenario==='private'?async()=>new Response(JSON.stringify(privateError.body),{status:privateError.status}):async()=>new Promise(()=>{})});
    const before=(await (await api('/api/state')).json()).state;
    const error=await api('/api/runemetrics/preview',{memberId:'player1'}); assert.equal(error.status,scenario==='private'?422:504);
    const body=await error.json(); assert.equal(body.code,scenario==='private'?'PROFILE_PRIVATE':'TIMEOUT'); assert.match(body.message,/private|too long/);
    assert.deepEqual((await (await api('/api/state')).json()).state,before);
  }
});

test('new browser modules are authenticated static assets',async t=>{
  const {api,origin}=await fixture(t);
  for(const route of ['/runemetrics.mjs','/core/game-progress.mjs']){
    assert.equal((await fetch(`${origin}${route}`)).status,401);
    assert.equal((await api(route)).status,200);
  }
});
