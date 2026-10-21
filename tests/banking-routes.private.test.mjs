import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createBankingRoutes as createCoreBankingRoutes, stilesSupports } from '../app/training/banking-routes.mjs';
import { movementForRegions } from '../scripts/training/banking-export.mjs';
import { reviewedBankingService } from '../app/data/training/banking-destinations.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';

const interiorEvidence = JSON.parse(await readFile(new URL('../app/data/banking-interiors.json', import.meta.url), 'utf8'));
const createBankingRoutes = options => createCoreBankingRoutes({ ...options, interiorCandidates: interiorEvidence });

const id = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const wood = { id: 'woodcutting.oak', label: 'Cut oak logs', skill: 'Woodcutting', requirements: [{ kind: 'object', name: 'Oak tree' }] };
const lobster = { id: 'fishing.lobster', label: 'Catch lobsters', skill: 'Fishing', outputs: [{ item: 'Raw lobster' }], fishingCurve: { methodId: 'lobster' } };
function fixture(points, { wallPoints = [], memberLabels = [], freeHex = new Map(), translations = new Map() } = {}) {
  const regions = new Map();
  for (const [x, y, label = 1] of points) {
    const base = id(x, y);
    if (!regions.has(base)) regions.set(base, { id: base, x: Math.floor(x / 64), z: Math.floor(y / 64), labels: new Uint16Array(4096),
      walls: new Uint8Array(4096), translation: translations.get(base) ?? [0, 0, 0] });
    regions.get(base).labels[(x & 63) * 64 + (y & 63)] = label;
  }
  for (const [x, y, mask] of wallPoints) regions.get(id(x, y)).walls[(x & 63) * 64 + (y & 63)] = mask;
  const movement = movementForRegions([...regions.values()]), components = new Map();
  const tileData = { regions: [...regions.values()].map(r => {
    const raw = Buffer.alloc(12288);
    for (let i = 0; i < 4096; i++) {
      raw.writeUInt16LE(r.labels[i], i * 2);
      if (r.labels[i]) components.set(`${r.id}-${1000000 + r.labels[i]}`, { free: !memberLabels.includes(r.labels[i]) });
    }
    raw.set(movement.get(r.id), 8192);
    return [r.id, deflateRawSync(raw).toString('base64'), freeHex.get(r.id) ?? 'ffffffffffffffff'];
  }) };
  const world = { chunks: new Map([...regions.keys()].map(base => [base, { name: `Fixture ${base}` }])), cacheWalking: { components } };
  return { world, tileData, availability: { access: { bases: [...regions.keys()], components: [...components.keys()] }, members: false } };
}
const bank = (x, y, extra = {}) => ({ id: `bank:${x}:${y}`, label: `Bank ${x},${y}`, chunkId: id(x, y), x, y, members: false, kind: 'bank', witnessTiles: [[x, y]], ...extra });
const spot = (x, y) => ({ id: `spot:${x}:${y}`, label: `Spot ${x},${y}`, chunkId: id(x, y), x, y });
const route = (f, x, y, destinations, changes = {}) => createBankingRoutes({ ...f, destinations }).routesForGathering({ method: wood,
  availability: { ...f.availability, ...changes }, spots: [spot(x, y)] })[0];

test('diagonal walking costs one tile step, with the same verified route back', () => {
  const f = fixture([[3200,3200],[3201,3200],[3200,3201],[3201,3201]]);
  const r = route(f, 3200, 3200, [bank(3201,3201)]);
  assert.equal(r.status, 'routed'); assert.equal(r.tileSteps, 1); assert.equal(r.roundTripTileSteps, 2);
  assert.deepEqual(r.interactionTile, { x: 3200, y: 3200 });
  assert.deepEqual(r.returnChunks, [...r.chunks].reverse());
});

test('confirmed lodestones use exact admitted landing tiles and preserve a full bank-to-spot return path', () => {
  const f = fixture(Array.from({ length: 42 }, (_, i) => [2899 + i, 3545]));
  const provider = createBankingRoutes({ ...f, destinations: [bank(2901, 3545)] });
  const query = extra => provider.routesForGathering({ method: wood, availability: { ...f.availability, ...extra }, spots: [spot(2940, 3545)] })[0];
  assert.equal(query({}).teleportOption, undefined);
  const unlocked = { gatheringTravelUnlocks: { confirmations: { 'lodestone-burthorpe-activated': true } } };
  const result = query(unlocked);
  assert.equal(result.teleportOption.lodestone.id, 'lodestone-burthorpe');
  assert.equal(result.teleportOption.outboundTileSteps, 2);
  assert.equal(result.teleportOption.returnTileSteps, 39);
  assert.deepEqual(result.teleportOption.returnRuns, [39]);
  assert.equal(query({ ...unlocked, gatheringLodestones: 'off' }).teleportOption, undefined);
  const blocked = fixture(Array.from({ length: 41 }, (_, i) => [2900 + i, 3545]));
  const fallback = createBankingRoutes({ ...blocked, destinations: [bank(2901, 3545)] }).routesForGathering({ method: wood,
    availability: { ...blocked.availability, ...unlocked }, spots: [spot(2940, 3545)] })[0];
  assert.equal(fallback.status, 'routed'); assert.equal(fallback.teleportOption, undefined);
});

test('upstairs overhead participates in destination selection and no admitted entrance means no route', () => {
  const f = fixture(Array.from({ length: 11 }, (_, i) => [3200 + i, 3200]));
  const upstairs = bank(3201, 3200, { interiorSeconds: 12, interiorEstimate: { assumptions: ['Stairs estimated.'] } });
  assert.equal(route(f, 3200, 3200, [upstairs, bank(3210, 3200)]).destination.id, 'bank:3210:3200');
  const result = route(f, 3200, 3200, [upstairs]);
  assert.equal(result.tileSteps, 1); assert.equal(result.extraTravelSeconds, 24);
  assert.equal(result.exactWithinModel, false); assert(result.limitations.includes('Stairs estimated.'));
  assert.equal(route(f, 3200, 3200, [{ ...upstairs, witnessTiles: [[3250, 3250]] }]).status, 'no-bank');
});

test('teleport may choose a different bank and includes both upstairs legs', () => {
  const points = [...Array.from({ length: 101 }, (_, i) => [2799 + i, 3545]), ...Array.from({ length: 90 }, (_, i) => [2799, 3546 + i])];
  const f = fixture(points), provider = createBankingRoutes({ ...f, destinations: [bank(2799, 3635), bank(2899, 3545, { interiorSeconds: 7.2 })] });
  const result = provider.routesForGathering({ method: wood, spots: [spot(2799, 3545)], availability: { ...f.availability,
    gatheringTravelUnlocks: { confirmations: { 'lodestone-burthorpe-activated': true } } } })[0];
  assert.equal(result.destination.id, 'bank:2799:3635');
  assert.equal(result.teleportOption.destination.id, 'bank:2899:3545');
  assert.equal(result.teleportOption.outboundTileSteps, 0); assert.equal(result.teleportOption.returnTileSteps, 100);
  assert.equal(result.teleportOption.extraTravelSeconds, 14.4);
});

test('blocked corner tiles cannot be cut; a diagonal wall requires a detour', () => {
  const blocked = fixture([[3200,3200],[3201,3201]]);
  assert.equal(route(blocked,3200,3200,[bank(3201,3201)]).status, 'no-bank');
  const wall = fixture([[3200,3200],[3201,3200],[3200,3201],[3201,3201]], { wallPoints: [[3200,3200,32],[3201,3201,128]] });
  assert.equal(route(wall,3200,3200,[bank(3201,3201)]).tileSteps, 2);
});

test('walls and blocking footprints produce a longer walking path than straight line', () => {
  const points = [];
  for (let x=3200; x<=3204; x++) for(let y=3200;y<=3202;y++) if(x!==3202||y===3202) points.push([x,y]);
  const f=fixture(points);
  assert.equal(route(f,3200,3200,[bank(3204,3200)]).tileSteps,6);
  const w=fixture([[3200,3200],[3201,3200]],{wallPoints:[[3200,3200,4],[3201,3200,1]]});
  assert.equal(route(w,3200,3200,[bank(3201,3200)]).status,'no-bank');
});

test('closest usable destination is selected using paths, not Euclidean distance', () => {
  const f=fixture([[3200,3200],[3200,3201],[3200,3202],[3200,3203],[3201,3200]]);
  const r=route(f,3200,3200,[bank(3200,3203),bank(3201,3200)]);
  assert.equal(r.destination.id,'bank:3201:3200'); assert.equal(r.tileSteps,1);
});

test('a locked intermediate chunk is never used and cache invalidates when admission changes', () => {
  const points=Array.from({length:66},(_,i)=>[3263+i,3200]);
  const f=fixture(points), provider=createBankingRoutes({...f,destinations:[bank(3328,3200)]});
  const query=availability=>provider.routesForGathering({method:wood,availability,spots:[spot(3263,3200)]})[0];
  const locked={...f.availability,access:{...f.availability.access,bases:['12850','13362']}};
  assert.equal(query(locked).status,'no-bank');
  const r=query(f.availability);
  assert.equal(r.tileSteps,65); assert.deepEqual(r.chunks,['12850','13106','13362']);
  assert.equal(query(locked).status,'no-bank');
});

test('diagonal crossing cannot pass between two chunks while either side chunk is locked', () => {
  const f=fixture([[3263,3263],[3264,3263],[3263,3264],[3264,3264]]);
  const limited={...f.availability,access:{...f.availability.access,bases:['12850','13107']}};
  assert.equal(route(f,3263,3263,[bank(3264,3264)],limited).status,'no-bank');
  assert.equal(route(f,3263,3263,[bank(3264,3264)]).tileSteps,1);
});

test('F2P excludes member services and member components; members can traverse them', () => {
  const f=fixture([[3200,3200],[3201,3200,2],[3202,3200]],{memberLabels:[2]});
  assert.equal(route(f,3200,3200,[bank(3202,3200)]).status,'no-bank');
  assert.equal(route(f,3200,3200,[bank(3202,3200)],{members:true}).tileSteps,2);
  const g=fixture([[3200,3200],[3201,3200],[3202,3200]]);
  assert.equal(route(g,3200,3200,[bank(3201,3200,{members:true}),bank(3202,3200)]).tileSteps,2);
  assert.equal(route(g,3200,3200,[bank(3201,3200,{members:true}),bank(3202,3200)],{members:true}).tileSteps,1);
});

test('F2P geographic mask remains a restriction even inside a broadly free component', () => {
  const f=fixture([[3206,3200],[3207,3200],[3208,3200]],{freeHex:new Map([['12850','0100000000000000']])});
  assert.equal(route(f,3206,3200,[bank(3208,3200)]).status,'no-bank');
  assert.equal(route(f,3206,3200,[bank(3208,3200)],{members:true}).tileSteps,2);
});

test('decoded lack of a bank and unknown tile coverage remain different outcomes', () => {
  const f=fixture([[3200,3200]]);
  assert.equal(route(f,3200,3200,[]).status,'no-bank');
  const access={...f.availability.access,bases:[...f.availability.access.bases,'99999']};
  const r=route(f,3200,3200,[],{access});
  assert.equal(r.status,'unknown'); assert.deepEqual(r.missingCoverage,['99999']);
  assert.equal(route(f,3201,3200,[]).status,'unknown');
});

test('pasted noncontiguous source seams cannot become walking edges', () => {
  const f=fixture([[3263,3200],[3264,3200]],{translations:new Map([['13106',[64,0,0]]])});
  assert.equal(route(f,3263,3200,[bank(3264,3200)]).status,'no-bank');
});

test('an admitted unreviewed service reports unknown rather than claiming no bank exists', () => {
  const f=fixture([[3040,3200],[3041,3200]]);
  const p={id:'unreviewed-bank',chunkId:'12082',classKey:'facility:bank-chest',objectId:999,x:3041,y:3200,witnessTiles:[[3041,3200]]};
  f.world.cacheResources={byChunk:new Map([['12082',new Map([['facility:bank-chest',{placements:[p]}]])]])};
  const r=createBankingRoutes(f).routesForGathering({method:wood,availability:f.availability,spots:[spot(3040,3200)]})[0];
  assert.equal(r.status,'unknown');assert.deepEqual(r.unreviewedServices,['unreviewed-bank']);
});

test('quest gated bank requires personal completion independently of chunk ownership', () => {
  const f=fixture([[3200,3200],[3201,3200]]), destination=bank(3201,3200,{quest:'Visions of Havenhythe'});
  assert.equal(route(f,3200,3200,[destination]).status,'no-bank');
  assert.equal(route(f,3200,3200,[destination],{completedQuests:['Visions of Havenhythe']}).status,'routed');
});

test('source placements retain source gates and cannot route a resource-only alias as walking', () => {
  const f=fixture([[3200,3200],[3201,3200]]), p={id:'tree:oak',chunkId:'12850',x:3200,y:3200,witnessTiles:[[3200,3200,'12850:1']]};
  f.world.cacheResources={byChunk:new Map([['12850',new Map([['tree:oak',{classKey:'tree:oak',name:'Oak tree',names:['Oak tree'],placements:[p],retainedSources:[{location:'12850',name:'Oak tree'}]}]])]])};
  const provider=createBankingRoutes({...f,destinations:[bank(3201,3200)]});
  const query=locations=>provider.routesForGathering({method:wood,availability:{...f.availability,access:{...f.availability.access,locations}}})[0];
  assert.match(query({}).reason,/No reviewed physical/);
  assert.equal(query({'Object:Oak tree':['12850-1000001']}).tileSteps,1);
  assert.equal(query({'Object:Oak tree':['12850']}).status,'unknown');
});

test('reviewed service identity excludes May and Cooks Guild while accepting Port Sarim and Taverley', () => {
  assert.equal(reviewedBankingService({chunkId:'12852',classKey:'facility:bank-chest',objectId:112405}),null);
  assert.equal(reviewedBankingService({chunkId:'12597',classKey:'facility:bank-booth',objectId:19230}),null);
  assert.equal(reviewedBankingService({chunkId:'12597',classKey:'facility:bank-booth',objectId:782}).members,false);
  assert.equal(reviewedBankingService({chunkId:'12082',classKey:'facility:deposit-box',objectId:36788}).kind,'deposit');
  assert.equal(reviewedBankingService({chunkId:'11317',classKey:'facility:bank-other:counter',objectId:66665}).members,false);
});

test('Stiles only accepts tuna, lobster and swordfish; mixed supported fish can all be noted', () => {
  assert.equal(stilesSupports(lobster),true);
  assert.equal(stilesSupports({...lobster,outputs:[{item:'Raw tuna'},{item:'Raw swordfish'}]}),true);
  assert.equal(stilesSupports({...lobster,outputs:[{item:'Raw tuna'},{item:'Raw herring'}]}),false);
  assert.equal(stilesSupports({...lobster,skill:'Woodcutting'}),false);
});

test('portable masks have correct framing and reciprocal tile movement, including seams', async () => {
  const data=JSON.parse(await readFile(new URL('../app/data/training/banking-masks.v1.json',import.meta.url)));
  assert.equal(data.regions.length,1211);
  const decoded=new Map(data.regions.map(([base,packed])=>[base,inflateRawSync(Buffer.from(packed,'base64'))]));
  const delta=[[-1,0],[0,1],[1,0],[0,-1],[-1,1],[1,1],[1,-1],[-1,-1]],reverse=[2,3,0,1,6,7,4,5];
  for(const [base,raw] of decoded){
    assert.equal(raw.length,12288);
    const ox=(Number(base)>>8)*64,oy=(Number(base)&255)*64;
    for(let i=0;i<4096;i++)for(let d=0;d<8;d++)if(raw[8192+i]&(1<<d)){
      const x=ox+(i>>6)+delta[d][0],y=oy+(i&63)+delta[d][1],to=decoded.get(id(x,y)),j=(x&63)*64+(y&63);
      assert.ok(raw.readUInt16LE(i*2));assert.ok(to?.readUInt16LE(j*2));assert.ok(to[8192+j]&(1<<reverse[d]));
    }
  }
});

test('real F2P Musa Point fish routes to Stiles and loses the route when his chunk locks', async () => {
  const definitions=JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url)));
  const index=buildAccessIndex(definitions, { dataset: selectedDataset }), provider=createBankingRoutes({world:index.world});
  const state=bases=>({rules:{'content.f2p':true},members:[{id:'m',unlocked:bases,selected:[],pendingRoll:[],blacklisted:[],teleports:[]}]});
  const all=['11313','11314','11569','11570'];
  const access=calculateAccess(index,state(all),'m');
  const before=[...access.components];
  const rows=provider.routesForGathering({method:lobster,availability:{access,members:false}});
  assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='routed'&&r.destination.id==='npc:stiles'&&r.destination.kind==='stiles'));
  assert.ok(rows.every(r=>r.tileSteps>=70&&r.tileSteps<=85&&r.roundTripTileSteps===r.tileSteps*2));
  assert.ok(rows.every(r=>r.chunks.every(base=>all.includes(base))));
  assert.deepEqual([...access.components],before);
  const gatedMethod={...lobster,requirements:[{kind:'object',name:'Fishing spot (cage, harpoon)'}]};
  assert.ok(provider.routesForGathering({method:gatedMethod,availability:{access,members:false}}).every(r=>r.status==='routed'));
  const backlogged={...access,locations:new Map(access.locations)};backlogged.locations.delete('Object:Fishing spot (cage, harpoon)');
  assert.equal(provider.routesForGathering({method:gatedMethod,availability:{access:backlogged,members:false}})[0].status,'unknown');
  const locked=calculateAccess(index,state(all.filter(base=>base!=='11313')),'m');
  assert.ok(provider.routesForGathering({method:lobster,availability:{access:locked,members:false}}).every(r=>r.status!=='routed'));
});
