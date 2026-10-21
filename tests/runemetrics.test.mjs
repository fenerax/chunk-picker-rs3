import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGroupState } from '../app/core/state.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { RUNE_METRICS_SKILLS, createQuestMapping, normalizeQuestTitle, previewRuneMetrics, createRuneMetricsClient } from '../app/integrations/runemetrics.mjs';

const fixture = name => readFile(new URL(`./fixtures/runemetrics/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const [player1Profile, player1Quests, player2Profile, player2Quests, errors, definitions] = await Promise.all([
  fixture('examplegimab-profile'), fixture('examplegimab-quests'), fixture('twosamplegim-profile'), fixture('twosamplegim-quests'), fixture('errors'),
  readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8').then(JSON.parse),
]);
const questMapping = createQuestMapping(definitions), fetchedAt = '2026-10-07T20:30:43.744Z';
function group(mapping = questMapping) {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  state.tasks = [...mapping.values()].flat().map(({taskId: id,label}) => ({id,label,category:'Quest'}));
  return state;
}
const snapshot = (profile = player1Profile, quests = player1Quests) => ({profile,quests,fetchedAt,cached:false});
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function fetchFixtures(url) {
  const name = url.searchParams.get('user').toLowerCase();
  return Promise.resolve(json(url.pathname.endsWith('/quests') ? name === 'twosamplegim' ? player2Quests : player1Quests : name === 'twosamplegim' ? player2Profile : player1Profile));
}

test('recorded skill IDs cover all 29 skills including Archaeology 27 and Necromancy 28, with XP in tenths', () => {
  assert.deepEqual(RUNE_METRICS_SKILLS, ['Attack','Defence','Strength','Constitution','Ranged','Prayer','Magic','Cooking','Woodcutting','Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer','Farming','Runecrafting','Hunter','Construction','Summoning','Dungeoneering','Divination','Invention','Archaeology','Necromancy']);
  for (const [id, profile, quests] of [['player1',player1Profile,player1Quests],['player2',player2Profile,player2Quests]]) {
    const {preview,command} = previewRuneMetrics(group(), id, snapshot(profile,quests), questMapping);
    assert.equal(preview.skills.length, 29); assert.deepEqual(preview.unmatched.skills, []);
    for (const row of profile.skillvalues) assert.deepEqual(command.skills.find(value => value.skill === RUNE_METRICS_SKILLS[row.id]), {skill:RUNE_METRICS_SKILLS[row.id],level:row.level,xp:row.xp/10});
    assert.equal(command.skills.find(row => row.skill === 'Necromancy').level, 20);
    assert.equal(command.skills.find(row => row.skill === 'Necromancy').xp, 4470);
  }
});

test('recorded completed quests map only whole completion tasks: Player 1 12/13, Player 2 36/37', () => {
  for (const [id,profile,quests,matched] of [['player1',player1Profile,player1Quests,12],['player2',player2Profile,player2Quests,36]]) {
    const state = group(), before = structuredClone(state);
    const {preview,command} = previewRuneMetrics(state,id,snapshot(profile,quests),questMapping);
    assert.deepEqual(preview.counts,{completedQuests:matched+1,matchedQuests:matched,unmatchedQuests:1});
    assert.deepEqual(preview.unmatched.quests.map(row=>row.title),['Unstable Foundations']);
    assert.equal(preview.quests.length,matched); assert.equal(command.quests.length,matched);
    // Task IDs are opaque permanent IDs; check the mapped catalogue labels instead.
    const labels = new Map(state.tasks.map(task => [task.id, task.label]));
    assert.ok(command.quests.every(row=>/ Complete the (quest|miniquest|subquest)$/.test(labels.get(row.taskId) ?? '')));
    assert.deepEqual(state,before,'preview never changes saved progress');
  }
});

test('title punctuation, NFC and explicit Vampire spelling alias match without guessing replacement quests', () => {
  assert.equal(normalizeQuestTitle('  Cook’s Assistant…  '),normalizeQuestTitle("Cook's Assistant"));
  assert.equal(normalizeQuestTitle('Élan – Quest'),normalizeQuestTitle('E\u0301lan - Quest'));
  const custom = {challenges:{Quest:{ "~|Cook's Assistant|~ 1":{BaseQuest:"Cook's Assistant"}, "~|Cook's Assistant|~ Complete the quest":{BaseQuest:"Cook's Assistant",QuestPoints:1}, 'Vampyre Slayer':{QuestPoints:3}, 'Stolen Hearts':{QuestPoints:1} }}};
  const mapping=createQuestMapping(custom), state=group(mapping);
  const {preview}=previewRuneMetrics(state,'player1',snapshot(player1Profile,{quests:[{title:'Cook’s Assistant!',status:'COMPLETED'},{title:'Vampire Slayer',status:'COMPLETED'},{title:'Prince Ali Rescue',status:'COMPLETED'},{title:'Doric\u2019s Quest',status:'COMPLETED'},{title:'Stolen Hearts',status:'STARTED'}]}),mapping);
  assert.equal(preview.quests.length,2);
  assert.ok(!preview.quests.some(row=>row.taskId===taskId('Quest',"~|Cook's Assistant|~ 1")));
  assert.deepEqual(preview.unmatched.quests.map(row=>row.title),['Prince Ali Rescue','Doric\u2019s Quest']);
});

test('ambiguous whole titles and absent catalogue identities remain unmatched', () => {
  const mapping=createQuestMapping({challenges:{Quest:{'Quest!':{QuestPoints:1},'Quest':{QuestPoints:1},'Missing':{QuestPoints:1}}}});
  const state=group(mapping); state.tasks=state.tasks.filter(row=>row.label!=='Missing');
  const {preview}=previewRuneMetrics(state,'player1',snapshot(player1Profile,{quests:[{title:'Quest',status:'COMPLETED'},{title:'Missing',status:'COMPLETED'}]}),mapping);
  assert.equal(preview.quests.length,0); assert.equal(preview.unmatched.quests.length,2);
  assert.match(preview.unmatched.quests[0].reason,/Several/); assert.match(preview.unmatched.quests[1].reason,/absent/);
});

test('preview shows level decreases and XP-only changes, skips already-completed additions and leaves planning inputs intact', () => {
  const state=group(), owner=state.members[0];
  const necromancy = player1Profile.skillvalues.find(row=>row.id===28), attack=player1Profile.skillvalues.find(row=>row.id===0);
  const provenance={source:'runemetrics',fetchedAt,runescapeName:owner.runescapeName};
  owner.skillProgress={Necromancy:{level:21,xp:5000,...provenance},Attack:{level:attack.level,xp:0,...provenance}};
  owner.passiveLevels={Necromancy:5}; owner.maxLevels={Necromancy:10};
  const first=previewRuneMetrics(state,'player1',snapshot(),questMapping).preview.quests[0];
  owner.completedTasks.push(first.taskId);
  const {preview,command}=previewRuneMetrics(state,'player1',snapshot(),questMapping);
  assert.deepEqual(preview.skills.find(row=>row.skill==='Necromancy'),{skill:'Necromancy',before:{level:21,xp:5000},after:{level:20,xp:necromancy.xp/10}});
  assert.equal(preview.skills.find(row=>row.skill==='Attack').after.level,attack.level);
  assert.equal(preview.quests.length,11); assert.equal(command.quests.length,12);
  assert.deepEqual(owner.passiveLevels,{Necromancy:5}); assert.deepEqual(owner.maxLevels,{Necromancy:10});
});

test('unknown/missing/invalid skill rows are reported and duplicate observations fail closed', () => {
  const profile={name:player1Profile.name,skillvalues:[{id:27,level:5,xp:100},{id:28,level:0,xp:100},{id:99,level:1,xp:0}]};
  const {preview,command}=previewRuneMetrics(group(),'player1',snapshot(profile),questMapping);
  assert.equal(command.skills.length,1); assert.equal(command.skills[0].skill,'Archaeology');
  assert.ok(preview.unmatched.skills.some(row=>row.id===99)); assert.ok(preview.unmatched.skills.some(row=>row.skill==='Necromancy'&&/Invalid/.test(row.reason)));
  assert.throws(()=>previewRuneMetrics(group(),'player1',snapshot({...profile,skillvalues:[profile.skillvalues[0],profile.skillvalues[0]]}),questMapping),/duplicate/);
});

test('paired requests use saved binding, descriptive User-Agent and short per-member single-flight cache', async () => {
  let now=Date.parse(fetchedAt), calls=[];
  const client=createRuneMetricsClient({clock:()=>now,cacheMs:100,fetchImpl:async(url,options)=>{calls.push({url:String(url),options}); return fetchFixtures(url);}});
  const owner=group().members[0];
  const [first,shared]=await Promise.all([client.snapshot(owner),client.snapshot(owner)]);
  assert.equal(calls.length,2); assert.equal(first.cached,false); assert.equal(shared.cached,true);
  assert.ok(calls.every(call=>/private duo; on-demand/.test(call.options.headers['User-Agent'])));
  assert.ok(calls[0].url.includes('user=exampleGIMab&activities=0'));
  first.profile.skillvalues[0].level=1;
  const cached=await client.snapshot(owner); assert.equal(cached.cached,true); assert.equal(calls.length,2); assert.equal(cached.profile.skillvalues[0].level,77);
  now+=101; assert.equal((await client.snapshot(owner)).cached,false); assert.equal(calls.length,4);
  await client.snapshot(group().members[1]); assert.equal(calls.length,6);
  await client.snapshot({...owner,runescapeName:'twosamplegim'}); assert.equal(calls.length,8);
  client.close();
});

for (const [name,code,status] of [['private','PROFILE_PRIVATE',422],['unknown','UNKNOWN_NAME',404],['rateLimit','RATE_LIMITED',429],['upstream','UPSTREAM_ERROR',502]]) {
  test(`fixture ${name} returns a clear error and never caches a partial snapshot`,async()=>{
    let fail=true,calls=0;
    const client=createRuneMetricsClient({fetchImpl:async url=>{calls++; return fail&&url.pathname.endsWith('/profile') ? json(errors[name].body,errors[name].status) : fetchFixtures(url);}});
    await assert.rejects(client.snapshot(group().members[0]),error=>error.code===code&&error.status===status);
    fail=false; assert.equal((await client.snapshot(group().members[0])).cached,false); assert.equal(calls,4); client.close();
  });
}

test('network failure, malformed response and wrong returned account never become snapshots',async()=>{
  for(const [fetchImpl,code] of [[async()=>{throw new Error('offline');},'NETWORK_FAILURE'],[async()=>new Response('<html>down</html>'),'BAD_RESPONSE'],[async()=>json({}),'BAD_RESPONSE'],[async url=>url.pathname.endsWith('/profile')?json({...player1Profile,name:'Someone'}):fetchFixtures(url),'ACCOUNT_MISMATCH']]){
    const client=createRuneMetricsClient({fetchImpl});
    await assert.rejects(client.snapshot(group().members[0]),error=>error.code===code); client.close();
  }
});

test('invalid title or status anywhere in the quest payload fails before caching or successful review',async()=>{
  for(const row of [{title:'Broken Home',status:'CORRUPT'},{title:'Broken Home'},{status:'NOT_STARTED'},{title:'',status:'STARTED'}]){
    const corrupt={quests:[row]};
    assert.throws(()=>previewRuneMetrics(group(),'player1',snapshot(player1Profile,corrupt),questMapping),error=>error.code==='BAD_RESPONSE');
    let bad=true;
    const client=createRuneMetricsClient({fetchImpl:async url=>url.pathname.endsWith('/quests')&&bad?json(corrupt):fetchFixtures(url)});
    await assert.rejects(client.snapshot(group().members[0]),error=>error.code==='BAD_RESPONSE');
    bad=false; assert.equal((await client.snapshot(group().members[0])).cached,false); client.close();
  }
});

test('duplicate skill or quest observations are rejected before caching and recover on a later request',async()=>{
  for(const endpoint of ['profile','quests']) {
    let bad=true;
    const client=createRuneMetricsClient({fetchImpl:async url=>{
      if(bad&&url.pathname.endsWith(`/${endpoint}`)) return json(endpoint==='profile'?{...player1Profile,skillvalues:[...player1Profile.skillvalues,player1Profile.skillvalues[0]]}:{quests:[...player1Quests.quests,player1Quests.quests[0]]});
      return fetchFixtures(url);
    }});
    await assert.rejects(client.snapshot(group().members[0]),error=>error.code==='BAD_RESPONSE');
    bad=false; assert.equal((await client.snapshot(group().members[0])).cached,false); client.close();
  }
});

test('timeout bounds a hung upstream request and aborts both endpoint signals',async()=>{
  const signals=[];
  const client=createRuneMetricsClient({timeoutMs:20,fetchImpl:async(url,{signal})=>{signals.push(signal); return new Promise(()=>{});}});
  await assert.rejects(client.snapshot(group().members[0]),error=>error.code==='TIMEOUT'&&error.status===504);
  assert.equal(signals.length,2); assert.ok(signals.every(signal=>signal.aborted)); client.close();
});
