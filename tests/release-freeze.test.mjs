import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp,mkdir,writeFile,readFile,rm,utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFrozenSeal,readFrozenSeal,phaseSummary,frozenHash } from '../scripts/private-companion/frozen-release.mjs';
import { prepare,promoteCandidate,releaseCandidate,freezeCandidate } from '../scripts/private-companion/release-v2.mjs';
const put=async(file,value)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freeze-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const kit=path.join(root,'kit'),release=path.join(kit,'releases/next'),tree=path.join(release,'core'),file=path.join(tree,'payload');
  await put(file,'checked bytes');const current=path.join(root,'current.json');await put(current,'old pointer');
  const identityDigest='a'.repeat(64),filename=path.join(release,'frozen-bundle.json');
  const args={filename,kit,release,identityDigest,current};
  const write=overrides=>writeFrozenSeal({...args,trees:[tree],bindings:{currentPointerSha256:undefined},rollback:{release:path.join(kit,'releases/old')},expiresAt:new Date(Date.now()+60000).toISOString(),...overrides});
  const seal=async overrides=>write({...overrides,bindings:{currentPointerSha256:await frozenHash(current)}});
  return {root,kit,release,tree,file,current,args,seal};
}
test('seal refuses a byte change, addition and stale evidence; timestamps cannot hide it',async t=>{
  const f=await fixture(t);await f.seal();await readFrozenSeal({...f.args,verifyBytes:true});
  await writeFile(f.file,'Changed bytes');await utimes(f.file,new Date(0),new Date(0));
  await assert.rejects(readFrozenSeal({...f.args,verifyBytes:true}),/bytes changed/);
  await writeFile(f.file,'checked bytes');await put(path.join(f.tree,'new'),'extra');
  await assert.rejects(readFrozenSeal({...f.args,verifyBytes:true}),/inventory changed/);
  await f.seal();await assert.rejects(readFrozenSeal({...f.args,now:Date.now()+120000}),/stale/);
});
test('unsealed, prepared-only, pending, mismatched identity and advanced pointer refuse',async t=>{
  const f=await fixture(t);await assert.rejects(readFrozenSeal(f.args),/run freeze first/);
  await f.seal({prepared:true});await assert.rejects(readFrozenSeal(f.args),/missing, stale/);
  await f.seal();await assert.rejects(readFrozenSeal({...f.args,identityDigest:'b'.repeat(64)}),/pin changed|mismatched/);
  await writeFile(f.current,'new pointer');await assert.rejects(readFrozenSeal(f.args),/advanced/);
  const pending=path.join(f.release,'pending');await f.seal({forbiddenPaths:[pending]});await put(pending,'pending');await assert.rejects(readFrozenSeal(f.args),/newer gate/);
});
test('promotion and release never run gates or lifecycle when a bundle is unsealed',async t=>{
  const f=await fixture(t);await put(path.join(f.release,'release.json'),{identity:{digest:f.args.identityDigest}});
  for(const action of [promoteCandidate,releaseCandidate])await assert.rejects(action({kit:f.kit,release:f.release,current:f.current}),{code:'FROZEN_BUNDLE_MISSING',message:/run freeze first/});
  await assert.rejects(readFile(path.join(f.release,'release-gate/gates-pending.json')),/ENOENT/);
});
test('prepare checks actual frozen kit drift before assembly or previous-config IO',async t=>{
  const f=await fixture(t),repo=path.join(f.root,'repo');await put(path.join(repo,'app/server.mjs'),'export const value=1;');
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-C',repo,...args],{windowsHide:true,stdio:'pipe'}).toString().trim();
  git('init');git('add','.');git('-c','user.name=fenerax','-c','user.email=fenerax@users.noreply.github.com','commit','-m','fixture');
  const ref=git('rev-parse','HEAD');await put(path.join(f.kit,'checks/private-source/app/server.mjs'),'export const value=2;');
  const input=path.join(f.root,'request.json');await put(input,{releaseId:'drift',changelog:{date:'2026-10-19',title:'Fixture',items:['Fixture']},roadmap:{id:'A1',note:'Fixture'}});
  await assert.rejects(prepare({kit:f.kit,repo,ref,input,'previous-config':path.join(f.root,'does-not-exist')}),error=>error.privateDrift===true||/drift|overwrit/i.test(error.message));
  await assert.rejects(readFile(path.join(f.kit,'releases/drift/release.json')),/ENOENT/);
});
test('phase summaries record total and slowest wall phase',()=>{
  assert.deepEqual(phaseSummary([{stage:'stop',seconds:1},{stage:'start',seconds:3}]),{totalSeconds:4,slowestPhase:'start',slowestSeconds:3});
});
test('freeze checks exact validated file hashes and empty-directory membership',async t=>{
  const f=await fixture(t),expected={path:f.file,sha256:await frozenHash(f.file)};
  await writeFile(f.file,'changed');await assert.rejects(f.seal({expectedFiles:[expected]}),/Checked input changed/);
  await writeFile(f.file,'checked bytes');await mkdir(path.join(f.tree,'new-empty'));
  await assert.rejects(f.seal({expectedDirectories:[{path:f.tree,entries:['payload']}]}),/Checked inventory changed/);
});
test('seal bytes and changed execution environment refuse admission',async t=>{
  const f=await fixture(t);await f.seal();await writeFile(f.args.filename,(await readFile(f.args.filename,'utf8'))+' ');
  await assert.rejects(readFrozenSeal(f.args),/pin changed/);
  await f.seal();const prior=process.env.TZ;process.env.TZ='Etc/GMT+7';
  try{await assert.rejects(readFrozenSeal(f.args),/mismatched/);}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('freeze refuses a relocated legacy rollback before claiming the bundle is ready',async t=>{
  const f=await fixture(t),rollback=path.join(f.kit,'releases/adopted');
  await put(path.join(f.release,'release.json'),{previousRelease:rollback,previousConfig:{path:path.join(f.root,'legacy-config.json')}});
  await put(path.join(rollback,'release.json'),{lane:'adopted'});
  await assert.rejects(freezeCandidate({kit:f.kit,release:f.release,current:f.current}),/Complete legacy migration separately/);
  await assert.rejects(readFile(f.args.filename),/ENOENT/);
});
test('a seal without its pin and the CLI help both send the operator to freeze before activation',async t=>{
  const f=await fixture(t);await f.seal();await rm(f.args.filename+'.pin.json');
  await assert.rejects(readFrozenSeal(f.args),/run freeze first/);
  const help=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/private-companion/release-v2.mjs',import.meta.url)),'--help'],{windowsHide:true,encoding:'utf8'});
  const order=['--gates-only','2. freeze','3. release'].map(step=>help.indexOf(step));
  assert.ok(order.every(index=>index>=0)&&order[0]<order[1]&&order[1]<order[2],help);
});
