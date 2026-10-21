import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createFrontDoor } from '../../../scripts/private-companion/live-swap/front-door.mjs';
import { createIngressContext } from '../../../scripts/private-companion/live-swap/ingress.mjs';
import { fixture, cases, evaluate, master, token, publicOrigin } from './helpers.mjs';
if (!process.env.FRONTDOOR_CORE_ROOT) throw Error('Set FRONTDOOR_CORE_ROOT to a disposable patched bridge core export.');
const load = file => import(pathToFileURL(path.join(process.env.FRONTDOOR_CORE_ROOT,file)));
const { createServer,frontDoorIngressProtocol } = await load('app/server.mjs');
const { requestContext } = await load('app/security/request.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const { selectedDataset } = await load('app/dataset-runtime.mjs');
const send = (port,host,headers) => new Promise((resolve,reject)=>{
  const req=http.request({host,port,path:'/api/action-session',method:'POST',agent:false,headers:{...headers,'content-type':'application/json'}},res=>{
    res.resume();res.on('end',()=>resolve(res.statusCode));
  });req.on('error',reject);req.end(JSON.stringify({clientId:randomUUID()}));
});
test('full patched core router matches direct requests on both door lanes',async t=>{
  assert.equal(frontDoorIngressProtocol,1);
  const { store,directory,resources }=await fixture(t),contextHost='127.0.0.2';
  const { bindDatasetStorage } = await load('app/dataset-binding.mjs');
  await bindDatasetStorage(directory,selectedDataset);
  resources.push(async()=>{ const {rm}=await import('node:fs/promises');await rm(directory+'.dataset.json',{force:true}); });
  await writeFile(path.join(directory,'access-token'),master);
  let observed;
  const ingress=createIngressContext({token,contextHost,requestContext});
  const app=await createServer({dataset:selectedDataset,dataDir:directory,host:'127.0.0.1',port:8986,loopbackPort:undefined,
    definitions:{chunks:{'12341':{}},walkableChunks:['12341'],walkableChunksF2P:['12341']},taskMap:{},
    initialState:createGroupState([{id:'one',name:'One',unlocked:['12341']}]),predictionPrewarm:false,retention:false,shutdownDeadlineMs:250,
    mapAssetsDir:path.join(directory,'absent-map'),gameDataDir:path.join(directory,'absent-game'),publicOrigin,
    liveSwap:{version:'integration'},requestContextFor:(request,options)=>{observed=ingress(request,options);return observed;} });
  resources.push(async()=>{await app.close();});await app.listen();
  const lanes=[{name:'local',host:'127.0.0.1',port:8984,trust:'loopback-proxy'},{name:'tail',host:'127.0.0.2',port:8985,trust:'direct-peer'}];
  const door=await createFrontDoor({lanes,scratchLanes:true,contextHost,stateFile:path.join(directory,'door.json'),token,backendToken:master,monitorMs:60000});
  resources.push(()=>door.close());await door.route({port:8986,version:'integration'});await door.resume({port:8986,version:'integration'});
  let rows=0;
  for(const c of cases().filter(c=>!c.name.includes('peer variant'))){
    const lane=lanes.find(l=>l.name===c.lane.name),headers=Object.fromEntries(Object.entries(c.headers).filter(([,v])=>v!==undefined));
    const original={headers,method:'POST',url:'/api/action-session',socket:{remoteAddress:'127.0.0.1'}};
    const expected=evaluate(original,store,requestContext(original,{host:contextHost,publicOrigin}));
    const direct=await send(8986,'127.0.0.1',headers),before={...observed};
    const actual=await send(lane.port,lane.host,headers);
    assert.equal(direct,expected.status,c.name);assert.equal(actual,direct,c.name);assert.deepEqual(observed,before,c.name);rows++;
  }
  assert.equal(rows,45);
  for(const lane of lanes){
    const headers={host:'fixture',origin:'http://fixture',authorization:'Bearer '+master,'x-forwarded-unused':'x'.repeat(13000)};
    assert.equal(await send(lane.port,lane.host,headers),200,'ordinary accepted headers survive envelope expansion');
    assert.equal(await send(lane.port,lane.host,{...headers,'x-forwarded-unused':'x'.repeat(18000)}),431,'door keeps original core parser budget');
  }
});
