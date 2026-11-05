import test, { beforeEach } from 'node:test';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGroupState } from '../app/core/state.mjs';
import { createPlatformApiClient } from '../app/integrations/platform-api.mjs';
import { platformProfile, platformQuests, platformResponse } from './helpers/platform-api-fixtures.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { RUNE_METRICS_SKILLS, createQuestMapping, normalizeQuestTitle, previewRuneMetrics, createRuneMetricsClient as createClient } from '../app/integrations/runemetrics.mjs';

const createRuneMetricsClient = options => createClient({ clock: () => Date.parse('2026-10-27T12:00:00Z'), ...options });
beforeEach(t => blockUnmockedFetch(t));
const fixture = name => readFile(new URL(`./fixtures/runemetrics/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
// Invented compatibility fixtures; no real account data.
const [player1Profile, player2Profile, player1Quests, player2Quests] = await Promise.all([
  fixture('examplegimab-profile'), fixture('twosamplegim-profile'),
  fixture('examplegimab-quests'), fixture('twosamplegim-quests'),
]);
const [errors, definitions] = await Promise.all([fixture('errors'),
  readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8').then(JSON.parse)]);
const questMapping = createQuestMapping(definitions), fetchedAt = '2001-02-03T00:00:03.000Z';
function group(mapping = questMapping) {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  state.members[0].runescapeName = player1Profile.name;
  state.members[1].runescapeName = player2Profile.name;
  state.tasks = [...mapping.values()].flat().map(({taskId: id,label}) => ({id,label,category:'Quest'}));
  return state;
}
const snapshot = (profile = player1Profile, quests = player1Quests) => ({profile,quests,fetchedAt,cached:false});
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function fetchFixtures(url) {
  const name = url.searchParams.get('user').toLowerCase();
  return Promise.resolve(json(url.pathname.endsWith('/quests') ? name === 'twosamplegim' ? player2Quests : player1Quests : name === 'twosamplegim' ? player2Profile : player1Profile));
}

test('synthetic legacy skill IDs cover all 29 skills including Archaeology 27 and Necromancy 28, with XP in tenths', () => {
  assert.deepEqual(RUNE_METRICS_SKILLS, ['Attack','Defence','Strength','Constitution','Ranged','Prayer','Magic','Cooking','Woodcutting','Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer','Farming','Runecrafting','Hunter','Construction','Summoning','Dungeoneering','Divination','Invention','Archaeology','Necromancy']);
  for (const [id, profile, quests] of [['player1',player1Profile,player1Quests],['player2',player2Profile,player2Quests]]) {
    const {preview,command} = previewRuneMetrics(group(), id, snapshot(profile,quests), questMapping);
    assert.equal(preview.skills.length, 29); assert.deepEqual(preview.unmatched.skills, []);
    for (const row of profile.skillvalues) assert.deepEqual(command.skills.find(value => value.skill === RUNE_METRICS_SKILLS[row.id]), {skill:RUNE_METRICS_SKILLS[row.id],level:row.level,xp:row.xp/10});
    assert.equal(command.skills.find(row => row.skill === 'Necromancy').level, player1Profile.skillvalues[28].level);
    assert.equal(command.skills.find(row => row.skill === 'Necromancy').xp, player1Profile.skillvalues[28].xp / 10);
  }
});

test('synthetic completed quests map only whole completion tasks', () => {
  for (const [id,profile,quests,matched] of [['player1',player1Profile,player1Quests,2],['player2',player2Profile,player2Quests,3]]) {
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

test('synthetic quest list: renamed quests match the picker and the rest are known gaps', () => {
  const renamed = ['Garden of Tranquillity', 'Curse of the Empty Lord (miniquest)', 'Father and Son', 'Helping Laniakea',
    'Foreshadowing', 'Flashback', 'Fortunes', 'Finale', 'My One and Only Lute', 'Skelly By Everlight', 'Flesh and Bone', 'Hermy and Bass'];
  const titles = [...renamed, 'A Christmas Reunion', 'Cold Front', 'Corporate Egg-spionage', 'Field of Screams',
    'Great Egg-spectations', 'Guys and Dolls', 'Heralds of Crimson', "It's Snow Bother", 'Nadir (saga)', 'Recipe for Disaster',
    "Thok It To 'Em (saga)", 'Thok Your Block Off (saga)', "Three's Company (saga)", 'Unstable Foundations', 'Vengeance (saga)'];
  const {preview} = previewRuneMetrics(group(), 'player1', snapshot(player1Profile, {quests: titles.map(title => ({title, status: 'COMPLETED'}))}), questMapping);
  for (const title of renamed) assert.ok(preview.quests.some(row => row.title === title), title);
  // Tutorial, seasonal, sagas, the Recipe for Disaster parent and Heralds of Crimson (deliberately unmatched).
  assert.deepEqual(preview.unmatched.quests.map(row => row.title).sort(), ['A Christmas Reunion', 'Cold Front', 'Corporate Egg-spionage',
    'Field of Screams', 'Great Egg-spectations', 'Guys and Dolls', 'Heralds of Crimson', "It's Snow Bother", 'Nadir (saga)', 'Recipe for Disaster',
    "Thok It To 'Em (saga)", 'Thok Your Block Off (saga)', "Three's Company (saga)", 'Unstable Foundations', 'Vengeance (saga)']);
  assert.match(preview.unmatched.quests.find(row => row.title === 'Unstable Foundations').reason, /^Tutorial quest/);
  assert.match(preview.unmatched.quests.find(row => row.title === 'Cold Front').reason, /^No whole-quest/);
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
  assert.deepEqual(preview.skills.find(row=>row.skill==='Necromancy'),{skill:'Necromancy',before:{level:21,xp:5000},after:{level:necromancy.level,xp:necromancy.xp/10}});
  assert.equal(preview.skills.find(row=>row.skill==='Attack').after.level,attack.level);
  assert.equal(preview.quests.length,1); assert.equal(command.quests.length,2);
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
  const cached=await client.snapshot(owner); assert.equal(cached.cached,true); assert.equal(calls.length,2); assert.equal(cached.profile.skillvalues[0].level,3);
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

test('Platform API uses one-based skills, whole XP and authoritative quest totals independent of row order', async () => {
  const profile = platformProfile();
  profile.skills.push({ id: 4, name: 'Hitpoints', rank: -1, level: 50, xp: 101333 }, { id: 21, name: 'Runecraft', rank: -1, level: 1, xp: 0 });
  profile.skills.reverse();
  const client = createPlatformApiClient({ fetchImpl: async url => url.pathname.includes('/playerQuests/') ? json(platformQuests()) : json(profile) });
  const data = await client.snapshot(group().members[0]);
  const { preview, command } = previewRuneMetrics(group(), 'player1', data, questMapping);
  assert.equal(data.source, 'platform-api');
  assert.equal(data.quests.find(row => row.title === 'Broken Home').id, 11);
  assert.deepEqual(command.skills.find(row => row.skill === 'Attack'), { skill: 'Attack', level: 7, xp: 700 });
  assert.deepEqual(command.skills.find(row => row.skill === 'Necromancy'), { skill: 'Necromancy', level: 11, xp: 1400 });
  assert.equal(command.skills.length, 6); assert.ok(!command.skills.some(row => row.skill === 'Overall'));
  assert.deepEqual(command.skills.find(row => row.skill === 'Constitution'), { skill: 'Constitution', level: 50, xp: 101333 });
  assert.deepEqual(command.skills.find(row => row.skill === 'Runecrafting'), { skill: 'Runecrafting', level: 1, xp: 0 });
  assert.equal(command.source, 'platform-api'); assert.deepEqual(command.questPoints, { current: 17, max: 450 });
  assert.deepEqual(preview.questPoints, { before: null, after: { current: 17, max: 450 } });
  const state = group(); state.provenance = { questPointProgress: { player1: { current: 9, max: 475, source: 'platform-api', runescapeName: 'Someone' } } };
  state.members[0].skillProgress = { Attack: { level: 99, xp: 13034431, source: 'runemetrics', runescapeName: 'Someone' } };
  const renamed = previewRuneMetrics(state, 'player1', data, questMapping).preview;
  assert.equal(renamed.questPoints.before, null);
  assert.equal(renamed.skills.find(row => row.skill === 'Attack').before, null);
  client.close();
});

test('Hiscores unranked valid rows sync while unavailable, new and missing skills preserve saved observations', async () => {
  const profile = platformProfile();
  profile.skills.push({ id: 3, name: 'Strength', rank: -1, level: -1, xp: -1 }, { id: 99, name: 'Future skill', rank: -1, level: 5, xp: 400 });
  const client = createPlatformApiClient({ fetchImpl: async url => url.pathname.includes('/playerQuests/') ? json(platformQuests()) : json(profile) });
  const { preview, command } = previewRuneMetrics(group(), 'player1', await client.snapshot(group().members[0]), questMapping);
  assert.ok(command.skills.some(row => row.skill === 'Attack'), 'rank -1 does not discard valid XP');
  assert.ok(!command.skills.some(row => row.skill === 'Strength'));
  assert.ok(preview.unmatched.skills.some(row => row.skill === 'Strength'));
  assert.ok(preview.unmatched.skills.some(row => row.name === 'Future skill'));
  assert.ok(preview.unmatched.skills.some(row => row.skill === 'Mining'));
  client.close();
});

test('invalid quest totals, skill identity disagreement and either returned account mismatch fail without caching', async () => {
  for (const change of [
    { quests: { ...platformQuests(), qp: -1 } },
    { quests: { ...platformQuests(), qp: 500 } },
    { quests: { ...platformQuests(), qp_max: undefined } },
    { quests: platformQuests('Someone'), code: 'ACCOUNT_MISMATCH' },
    { profile: platformProfile('Someone'), code: 'ACCOUNT_MISMATCH' },
    { profile: { ...platformProfile(), skills: [{ id: 1, name: 'Defence', level: 50, xp: 100000 }] } },
  ]) {
    let bad = true, calls = 0;
    const client = createPlatformApiClient({ fetchImpl: async url => {
      calls++; const kind = url.pathname.includes('/playerQuests/') ? 'quests' : 'profile';
      return bad && change[kind] ? json(change[kind]) : Promise.resolve(platformResponse(url));
    } });
    await assert.rejects(client.snapshot(group().members[0]), error => error.code === (change.code ?? 'BAD_RESPONSE'));
    bad = false; assert.equal((await client.snapshot(group().members[0])).cached, false); assert.equal(calls, 4);
    client.close();
  }
});

test('official Adventurer errors and non-JSON Hiscores errors retain actionable failure codes', async () => {
  for (const [response, code, status] of [
    [() => json({ error: 'PLAYER_NOT_FOUND' }, 404), 'UNKNOWN_NAME', 404],
    [() => json({ error: 'PLAYER_NOT_MEMBER' }, 422), 'MEMBERS_REQUIRED', 422],
    [() => json({ error: 'INTERNAL_ERROR' }, 500), 'UPSTREAM_ERROR', 502],
    [() => new Response('Not found', { status: 404 }), 'UNKNOWN_NAME', 404],
    [() => new Response('Unavailable', { status: 503 }), 'UPSTREAM_ERROR', 502],
  ]) {
    const client = createPlatformApiClient({ fetchImpl: async () => response() });
    await assert.rejects(client.snapshot(group().members[0]), error => error.code === code && error.status === status);
    client.close();
  }
});


test('Platform paired requests use saved bindings, single-flight cache and bounded failures', async () => {
  let now = Date.parse(fetchedAt), calls = [];
  const client = createPlatformApiClient({ clock: () => now, cacheMs: 100, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options }); return platformResponse(url);
  } });
  try {
    const owner = group().members[0];
    const [first, shared] = await Promise.all([client.snapshot(owner), client.snapshot(owner)]);
    assert.equal(calls.length, 2); assert.equal(first.cached, false); assert.equal(shared.cached, true);
    assert.ok(calls[0].url.endsWith('index_lite.json?player=exampleGIMab'));
    assert.ok(calls[1].url.endsWith('/playerQuests/exampleGIMab'));
    assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.headers.Accept === 'application/json'));
    first.skills[0].level = 120;
    assert.equal((await client.snapshot(owner)).skills[0].level, 7);
    now += 101; assert.equal((await client.snapshot(owner)).cached, false); assert.equal(calls.length, 4);
    await client.snapshot(group().members[1]); assert.equal(calls.length, 6);
  } finally { client.close(); }
  for (const [fetchImpl, code] of [
    [async () => { throw new Error('offline'); }, 'NETWORK_FAILURE'],
    [async () => new Response('<html>down</html>'), 'BAD_RESPONSE'],
    [async () => new Response('limited', { status: 429 }), 'RATE_LIMITED'],
    [async () => new Response('private', { status: 403 }), 'PROFILE_PRIVATE'],
  ]) {
    const failing = createPlatformApiClient({ fetchImpl });
    try { await assert.rejects(failing.snapshot(group().members[0]), error => error.code === code); }
    finally { failing.close(); }
  }
  const signals = [];
  const hung = createPlatformApiClient({ timeoutMs: 20, fetchImpl: async (url, { signal }) => { signals.push(signal); return new Promise(() => {}); } });
  try { await assert.rejects(hung.snapshot(group().members[0]), error => error.code === 'TIMEOUT'); assert.ok(signals.every(signal => signal.aborted)); }
  finally { hung.close(); }
});

test('malformed Platform pairs are never cached and recover on the next request', async () => {
  for (const kind of ['profile', 'quests']) {
    let bad = true, calls = 0;
    const client = createPlatformApiClient({ fetchImpl: async url => {
      calls++;
      const actual = url.pathname.includes('/playerQuests/') ? 'quests' : 'profile';
      if (bad && actual === kind) return json(kind === 'profile'
        ? { ...platformProfile(), skills: [...platformProfile().skills, platformProfile().skills[1]] }
        : { ...platformQuests(), quests: { ...platformQuests().quests, '99': { title: 'Broken Home', status: 'COMPLETED' } } });
      return platformResponse(url);
    } });
    try {
      await assert.rejects(client.snapshot(group().members[0]), error => error.code === 'BAD_RESPONSE');
      bad = false; assert.equal((await client.snapshot(group().members[0])).cached, false); assert.equal(calls, 4);
    } finally { client.close(); }
  }
});
