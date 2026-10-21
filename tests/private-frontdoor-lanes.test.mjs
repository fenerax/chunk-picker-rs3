import test from 'node:test';
import assert from 'node:assert/strict';
import { scratchPeerPorts, validateLanes, validateDoorTopology } from '../scripts/private-companion/live-swap/ingress.mjs';
const lanes = [{ name: 'local', host: '127.0.0.1', port: 18901, trust: 'loopback-proxy' },
  { name: 'tail', host: '100.64.0.7', port: 18902, trust: 'direct-peer' }];
test('production lanes are strict, canonical, immutable and distinct', () => {
  const result = validateLanes(lanes); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[0]));
  lanes[0].port = 18903; assert.equal(result[0].port, 18901); lanes[0].port = 18901;
  for (const value of [[], null, {}, [...lanes, lanes[0]], [lanes[0], { ...lanes[1], name: 'local' }],
    [{ ...lanes[0], unknown: true }], [{ ...lanes[0], trust: 'direct-peer' }],
    [{ ...lanes[0], host: '0.0.0.0' }], [{ ...lanes[0], host: 'localhost' }], [{ ...lanes[0], host: '::ffff:127.0.0.1' }],
    [{ ...lanes[0], trust: 'proxy' }], [{ ...lanes[0], port: 0 }], [{ ...lanes[0], port: 65536 }],
    [lanes[0], { ...lanes[1], host: '192.0.2.7' }], [lanes[1]]]) assert.throws(() => validateLanes(value));
  const scratch = [lanes[0], { ...lanes[1], host: '127.0.0.2', port: scratchPeerPorts.first + 2 }];
  assert.throws(() => validateLanes(scratch)); assert.doesNotThrow(() => validateLanes(scratch, { scratch: true }));
  assert.throws(() => validateLanes([lanes[0], { ...scratch[1], port: 18888 }], { scratch: true }));
  assert.doesNotThrow(() => validateLanes([lanes[0], { ...lanes[1], host: 'fd7a:115c:a1e0::7' }]));
});

test('topology rejects unknown fields, mixed listener formats and caller trust overrides', () => {
  const topology = { schemaVersion:2, door:{lanes,contextHost:lanes[1].host} };
  assert.equal(validateDoorTopology(topology).length,2);
  for (const value of [{...topology,unknown:true},{...topology,door:{...topology.door,unknown:true}},
    {...topology,door:{...topology.door,listen:8901}},{...topology,door:{...topology.door,scratchLanes:true}},
    {...topology,door:{...topology.door,contextHost:'192.0.2.1'}}]) assert.throws(()=>validateDoorTopology(value));
  assert.equal(validateDoorTopology({door:{listen:8901}}),null);
});

test('topology lane bytes are covered by the complete topology pin', async t => {
  const { fixture }=await import('./fixtures/frontdoor/helpers.mjs'); const { directory }=await fixture(t);
  const { writeFile }=await import('node:fs/promises'), {createHash}=await import('node:crypto'), {loadTopology}=await import('../scripts/private-companion/live-swap/managed-runtime.mjs');
  const file=directory+'/topology.json',bytes=JSON.stringify({door:{lanes,contextHost:lanes[1].host}}),pin=createHash('sha256').update(bytes).digest('hex');
  await writeFile(file,bytes.replace('18902','18904'));
  await assert.rejects(loadTopology(file,pin),{code:'LIVE_SWAP_PIN_CHANGED'});
});
