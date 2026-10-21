// Synthetic observations only; every source, proof and cleanup root is disposable.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runFileLane, verifyFileLane, planLane } from '../scripts/private-companion/file-test-lane.mjs';
import { planLaneEvidence, lookupLaneEvidence, laneEvidenceFilename, beginLaneAttempt } from '../scripts/private-companion/lane-test-evidence.mjs';
import { gateContract, atomicJSON } from '../scripts/private-companion/release-evidence.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';

const source=fileURLToPath(new URL('../scripts/private-companion/',import.meta.url));
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const put=async(file,value)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
export const json=async file=>JSON.parse(await readFile(file,'utf8'));
export const oneByte=bytes=>{const original=Buffer.from(bytes),changed=Buffer.from(original);assert.ok(changed.length);changed[0]^=1;assert.equal(changed.length,original.length);assert.equal([...changed].filter((byte,index)=>byte!==original[index]).length,1);return changed;};
export async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'whole-lane-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const kit=path.join(root,'kit'),release=path.join(root,'candidate'),directory=path.join(root,'evidence');
  for(const name of ['file-test-evidence.mjs','module-scan.mjs','file-test-lane.mjs','lane-test-evidence.mjs','release-identity.mjs','release-evidence.mjs','companion-check.mjs']){await mkdir(path.join(kit,'tools'),{recursive:true});await cp(path.join(source,name),path.join(kit,'tools',name));}
  const browser=path.join(root,'chrome.exe');await put(browser,'synthetic browser pin');
  await put(path.join(kit,'operator/with-heavy.ps1'),'# synthetic internal heavy wrapper');
  const heavy=path.join(root,'external-heavy.ps1');await put(heavy,'# synthetic external heavy wrapper');
  await put(path.join(kit,'kit.json'),{browser:{path:browser},locks:{heavy:{path:heavy,sha256:hash('# synthetic external heavy wrapper')}}});
  await put(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'),'// synthetic adaptive runner');
  await put(path.join(kit,'checks/private-source/tests/core-overlays.json'),{});
  // A module mock leaves no checkable closure, so these files always run.
  for(const name of ['a','b'])await put(path.join(release,'core/tests',name+'.test.mjs'),"import test,{mock} from 'node:test';mock.module('./opaque.mjs',{});test('opaque fixture',()=>{});");
  await put(path.join(release,'core/scripts/test-selection.mjs'),'// selector bytes');
  await put(path.join(release,'core/scripts/test.mjs'),'// runner bytes');
  await put(path.join(release,'core/unimported-core.txt'),'a');
  await put(path.join(kit,'checks/private-source/unimported-private.txt'),'a');
  const packs=path.join(kit,'packs'),packRoot=path.join(packs,'fixture/1');
  const setPayload=async text=>{
    await put(path.join(packRoot,'payload.txt'),text);
    const manifest={files:[{path:'payload.txt',bytes:Buffer.byteLength(text),sha256:hash(text)}]};
    const bytes=JSON.stringify(manifest);await put(path.join(packRoot,'pack.json'),bytes);
    const pin={id:'fixture',version:'1',sha256:hash(bytes)};
    await put(path.join(packs,'selection.json'),{data:pin,rulesText:pin,art:pin});
  };
  await setPayload('payload one');
  const text=path.join(root,'release-text.json');await put(text,'release text one');
  const companion={packsDir:packs,textOverrides:[{path:'app/data/changelog.json',source:text,sha256:hash('release text one')}]};
  await put(path.join(release,'companion.json'),companion);
  const execution={digest:hash('fixed isolated execution'),schema:'synthetic-execution'};
  const contract=gateContract('private-full',{synthetic:true},execution);
  const manifest={base:'fixture-baseline',revision:'fixture-core'};
  const calls=[],timings=[];
  const execute=async files=>{calls.push(files);return {passed:true,aborted:false,files:files.map(file=>({file,passed:true,bodyMs:1}))};};
  const options={kit,release,directory,execution,contract,manifest,lane:'private-full',execute,timings};
  return {root,kit,release,directory,options,calls,timings,setPayload,text,heavy,browser,companion,plan:()=>planLaneEvidence(options)};
}

