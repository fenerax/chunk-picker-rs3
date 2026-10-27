import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer, frontDoorIngressProtocol } from '../app/server.mjs';
import { requestContext } from '../app/security/request.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
async function fixture(t, requestContextFor) {
  const root = process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(),'rs3-live-swap-tests');
  await mkdir(root,{recursive:true});
  const dataDir = await mkdtemp(path.join(root,'core-ingress-'));
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir,{recursive:true,force:true}); await rm(dataDir+'.dataset.json',{force:true}); });
  app = await createServer({ dataset:selectedDataset,dataDir,host:'127.0.0.1',port:0,loopbackPort:undefined,
    definitions:{ chunks:{'12341':{}},walkableChunks:['12341'],walkableChunksF2P:['12341'] },taskMap:{},
    initialState:createGroupState([{id:'one',name:'One',unlocked:['12341']}]),
    predictionPrewarm:false,retention:false,shutdownDeadlineMs:250,requestContextFor,
    mapAssetsDir:path.join(dataDir,'absent-map'),gameDataDir:path.join(dataDir,'absent-game') });
  await app.listen();
  const { port } = app.address();
  return headers => fetch(`http://127.0.0.1:${port}/api/session`,{ headers:{Authorization:`Bearer ${app.store.getAccessToken()}`,...headers} });
}
test('default core request context keeps existing authentication',async t=>{
  assert.equal(frontDoorIngressProtocol,1); const get=await fixture(t); const response=await get({}); assert.equal(response.status,200); await response.arrayBuffer();
  const oversized=await get({'x-forwarded-unused':'x'.repeat(18000)});assert.equal(oversized.status,431);await oversized.arrayBuffer();
});
test('operator context adapter controls authentication before route handling',async t=>{
  let calls=0; const get=await fixture(t,(request,options)=>{calls++;return {...requestContext(request,options),masterAllowed:false};});
  const response=await get({}); assert.equal(response.status,403);await response.arrayBuffer(); assert.equal(calls,1);
});
test('invalid provenance refusal cannot fall back to loopback master',async t=>{
  const get=await fixture(t,()=>{throw Object.assign(Error('Invalid ingress provenance.'),{status:403});});
  const response=await get({});assert.equal(response.status,403);await response.arrayBuffer();
});
