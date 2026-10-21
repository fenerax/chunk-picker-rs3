import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createFrontDoor } from '../scripts/private-companion/live-swap/front-door.mjs';
import { forwardHeaders, createIngressContext, scratchPeerPorts } from '../scripts/private-companion/live-swap/ingress.mjs';
import { fixture, cases, evaluate, requestContext, token, publicOrigin, master } from './fixtures/frontdoor/helpers.mjs';
async function bind(server, host = '127.0.0.1') {
  for (let port = scratchPeerPorts.first + 10; port <= scratchPeerPorts.last - 10; port++) {
    try { await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,host,resolve); }); server.removeAllListeners('error'); return port; }
    catch (error) { server.removeAllListeners('error'); if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw Error('No free scratch port');
}
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
function request(port, host, headers, method = 'POST', url = '/security-probe', localAddress) {
  return new Promise((resolve,reject) => {
    const req = http.request({ host, port, method, path: url, headers, agent: false, localAddress }, response => {
      let text = ''; response.on('data',bytes => text += bytes); response.on('end',() => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }));
    }); req.on('error',reject); req.end();
  });
}
async function setup(t, store, directory, resources) {
  const contextHost = '127.0.0.2', context = createIngressContext({ token, contextHost, requestContext });
  let owned = true, checks = 0, hold = false, release;
  const held = new Promise(resolve => { release = resolve; });

  const backend = version => http.createServer({maxHeaderSize:64*1024}, async (req,res) => {
    if (req.url === '/api/health') { res.end(JSON.stringify({ ready: true, version, standby: false, liveSwapProtocol: 2, actionReceiptFormat: 2 })); return; }
    if (hold) await held;
    const result = evaluate(req, store, context(req, { publicOrigin }));
    res.writeHead(result.status); res.end(JSON.stringify({ ...result, version }));
  });
  const old = backend('old'), next = backend('next'); const oldPort = await bind(old), nextPort = await bind(next);

  const reserve1 = net.createServer(), reserve2 = net.createServer();
  const p1 = await bind(reserve1), p2 = await bind(reserve2, '127.0.0.2'); await close(reserve1); await close(reserve2);
  const lanes = [{ name: 'local', host: '127.0.0.1', port: p1, trust: 'loopback-proxy' }, { name: 'tail', host: '127.0.0.2', port: p2, trust: 'direct-peer' }];
  const door = await createFrontDoor({ lanes, scratchLanes: true, contextHost, stateFile: path.join(directory,'door.json'), token, backendToken: master,
    monitorMs: 60000, assertTargetOwned: async () => { checks++; if (!owned) throw Error('foreign listener'); } });
  resources.push(async () => { release(); await door.close(); await close(old); await close(next); });
  const identities = [{ version: 'old', port: oldPort }, { version: 'next', port: nextPort }];
  return { door, lanes, identities, contextHost, count: () => checks, revoke: () => { owned = false; },
    hold: () => { hold = true; }, release: () => { hold = false; release(); } };
}
test('both HTTP lanes match direct core security decisions and keep ownership checks', async t => {
  const { store,directory,resources } = await fixture(t), f = await setup(t,store,directory,resources);
  for (const lane of f.lanes) assert.equal((await request(lane.port,lane.host,{})).status,503);
  await f.door.route(f.identities[0]); await f.door.resume(f.identities[0]);
  const rows = [];
  for (const c of cases().filter(c => !c.name.includes('peer variant') || c.peer === '127.0.0.9')) {
    const lane = f.lanes.find(lane => lane.name === c.lane.name);
    const headers = Object.fromEntries(Object.entries(c.headers).filter(([,v]) => v !== undefined));
    const localAddress = c.peer === '127.0.0.9' ? c.peer : undefined;
    const direct = { headers, method: 'POST', url: '/security-probe', socket: { remoteAddress: localAddress ?? '127.0.0.1' } };
    const before = evaluate(direct,store,requestContext(direct,{host:f.contextHost,publicOrigin}));
    const count = f.count(), response = await request(lane.port,lane.host,headers,'POST','/security-probe',localAddress);
    assert.equal(response.status,before.status,c.name); assert.equal(response.body.version,'old');
    const { version,...actual } = response.body; assert.deepEqual(actual,before,c.name); assert.ok(f.count() > count);
    rows.push({ name:c.name,mode:'HTTP loopback transport',...before });
  }
  if (process.env.FRONTDOOR_HTTP_EVIDENCE) await writeFile(process.env.FRONTDOOR_HTTP_EVIDENCE,JSON.stringify(rows,null,2));
  f.revoke();
  for (const lane of f.lanes) assert.equal((await request(lane.port,lane.host,{})).status,503);
  assert.equal((await f.door.status()).frozen,true);
});
test('one door swaps during active traffic on both lanes with a shared drain and epoch', async t => {
  const { store,directory,resources } = await fixture(t), f = await setup(t,store,directory,resources);
  await f.door.route(f.identities[0]); await f.door.resume(f.identities[0]); f.hold();
  const headers = { host:'fixture', origin:'http://fixture', authorization:`Bearer ${master}` };
  const pending = f.lanes.map(lane => request(lane.port,lane.host,headers));
  const deadline = Date.now()+2000;
  while ((await f.door.status()).active !== 2 && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,2));
  assert.equal((await f.door.status()).active,2); await f.door.freeze();
  for (const lane of f.lanes) assert.equal((await request(lane.port,lane.host,headers)).status,503);
  f.release(); assert.deepEqual((await Promise.all(pending)).map(r=>r.body.version),['old','old']); await f.door.drain();
  await f.door.route(f.identities[1]); await f.door.resume(f.identities[1]);
  for (let i=0;i<8;i++) for (const lane of f.lanes) assert.equal((await request(lane.port,lane.host,headers)).body.version,'next');
});
test('second bind failure rolls back every listener and is immediately retryable', async t => {
  const { directory } = await fixture(t), blocker = net.createServer(), port = await bind(blocker,'127.0.0.2');
  t.after(() => close(blocker));
  const reserve = net.createServer(), first = await bind(reserve); await close(reserve);
  const config = { lanes:[{name:'local',host:'127.0.0.1',port:first,trust:'loopback-proxy'}, {name:'tail',host:'127.0.0.2',port,trust:'direct-peer'}],
    contextHost:'127.0.0.2',scratchLanes:true,stateFile:path.join(directory,'door.json'),token };
  await assert.rejects(createFrontDoor(config),error=>error.code==='LIVE_SWAP_DOOR_BIND_RETRY' && error.retryable && error.bindCode==='EADDRINUSE');
  const proof = net.createServer(); await new Promise((resolve,reject)=>{proof.once('error',reject);proof.listen(first,'127.0.0.1',resolve);}); await close(proof);
  await close(blocker); const door=await createFrontDoor(config); await door.close();
});
