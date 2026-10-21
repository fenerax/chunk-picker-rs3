import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { runFileLane, verifyFileLane, planLane } from '../scripts/private-companion/file-test-lane.mjs';
import { fixture, oneByte, put, json, hash } from './lane-test-fixture.mjs';

test('exact complete passes bypass the static planner for full, forced early and verification paths; byte changes restore it',async t=>{
  const f=await fixture(t);let planned=0;
  const planFiles=async options=>{planned++;return planLane(options);};
  await runFileLane({...f.options,runId:'cold',planFiles});
  assert.equal(planned,2,'cold execution retains both static plan observations');
  const forbidden=()=>{throw Error('Static planner must not run for an exact complete pass.');};
  const warm=await runFileLane({...f.options,runId:'warm',planFiles:forbidden});
  assert.equal(warm.summary.fresh,0);assert.equal(warm.summary.reused,2);
  await verifyFileLane({...f.options,item:warm,planFiles:forbidden});
  await verifyFileLane({...f.options,item:warm,retained:true,planFiles:forbidden});
  const early=await runFileLane({...f.options,runId:'early',only:['tests/a.test.mjs'],force:true,phase:'previous',planFiles:forbidden});
  assert.equal(early.summary.fresh,0);assert.equal(f.calls.length,1);
  const input=path.join(f.release,'core/unimported-core.txt');
  await writeFile(input,oneByte(await readFile(input)));
  const changed=await runFileLane({...f.options,runId:'changed',planFiles});
  assert.equal(planned,4,'changed whole inputs use the original pre/post static planning path');
  assert.equal(changed.summary.fresh,2);assert.equal(f.calls.length,2);
});

test('a pack-provided test missing from the quick source inventory retains the static planning fallback',async t=>{
  const f=await fixture(t),packs=f.companion.packsDir,packRoot=path.join(packs,'fixture/1');
  const payload=await readFile(path.join(packRoot,'payload.txt'));
  const packedTest="import test from 'node:test';test('pack-provided fixture',()=>{Date.now();});";
  await put(path.join(packRoot,'tests/from-pack.test.mjs'),packedTest);
  const bytes=JSON.stringify({files:[{path:'payload.txt',bytes:payload.length,sha256:hash(payload)},{path:'tests/from-pack.test.mjs',bytes:Buffer.byteLength(packedTest),sha256:hash(packedTest)}]});
  await put(path.join(packRoot,'pack.json'),bytes);
  const selection=await json(path.join(packs,'selection.json'));
  for(const kind of ['data','rulesText','art'])selection[kind].sha256=hash(bytes);
  await put(path.join(packs,'selection.json'),selection);
  let planned=0;const planFiles=async options=>{planned++;return planLane(options);};
  const cold=await runFileLane({...f.options,runId:'packed-cold',planFiles});
  assert.equal(cold.summary.fresh,3);assert.equal(planned,2);
  const warm=await runFileLane({...f.options,runId:'packed-warm',planFiles});
  assert.equal(warm.summary.fresh,0);assert.equal(warm.summary.reused,3);
  assert.equal(planned,4,'unmatched quick inventory cannot bypass static planning');
  assert.equal(f.calls.length,1);
});
