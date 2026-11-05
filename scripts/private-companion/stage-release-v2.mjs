// Build an absent, frozen private kit. Never writes into the installed companion.
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashTree } from './release-identity.mjs';
import { releasePreflight } from './release-preflight.mjs';
import { gatePolicyDigest } from './release-evidence.mjs';
import { checkRequest } from './release-v2.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => { const relative = path.relative(root, target); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
export async function stageReleaseKit({ source, privateRepo, privateCommit, coreRepo, coreRef, base, expectedGatePolicySha256, accepted, packs = path.join(accepted, 'packs'), output, heavyLock, lightLock, concurrency = 6, memoryAdmission = false, request, current, practiceSourceReceipt }) {
  let exported=null,exportParent=null,coreRevision=null;
  if(!path.isAbsolute(output??''))throw Error('Absolute staging output required.');
  if(expectedGatePolicySha256&&expectedGatePolicySha256!==gatePolicyDigest)throw Error('Gate policy differs from paired input.');
  for(const root of [source,privateRepo,accepted,packs].filter(Boolean)){
    if(!path.isAbsolute(root))throw Error('Absolute staging inputs required.');
    for(const target of [output]){
      const a=path.relative(root,target),b=path.relative(target,root);
      if(!a||a==='..'||!a.startsWith('..'+path.sep)||!b.startsWith('..'+path.sep))throw Error('Staging output overlaps an input.');
    }
  }
  for(let current=path.dirname(output);;current=path.dirname(current)){
    const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Staging ancestor refused.');if(path.dirname(current)===current)break;
  }
  try{await lstat(output);throw Error('Staging output must be absent.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if (request) await checkRequest({ kit: accepted, input: request, current });
  else if (current) throw Error('--current requires --request.');
  await (await import('./check-private-drift.mjs')).assertPrivateDriftForStaging({ source, privateRepo, privateCommit, coreRepo, coreRef });
  try {
  if(privateRepo||privateCommit){
    if(source||!path.isAbsolute(privateRepo??'')||!/^[a-f0-9]{40}$/.test(privateCommit??''))throw Error('Choose exact private Git pair or directory fallback.');
    if(!path.isAbsolute(output??''))throw Error('Absolute output required.');
    // The kit may live under companion/releases. Export outside that protected
    // tree instead of beside the kit; the exporter's overlap guard stays intact.
    // A legacy private-source commit names its canonical copy; one-repository commits have none.
    let capture=null;
    try{capture=JSON.parse(execFileSync('git',['--no-optional-locks','-C',privateRepo,'show',`${privateCommit}:.private-source/capture.json`],{windowsHide:true,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}));}catch{}
    if(capture&&(!path.isAbsolute(capture.source??'')||!/[\\/]checks[\\/]private-source$/i.test(capture.source)))throw Error('Canonical private-source metadata required.');
    const canonical=capture&&path.resolve(capture.source),companion=canonical&&path.resolve(canonical,'../..');
    if(canonical&&(inside(canonical,output)||inside(output,canonical)))throw Error('Staging output overlaps canonical private-source.');
    const scratchRoot=path.resolve(os.tmpdir());
    for(const protectedRoot of [companion,privateRepo,accepted,packs,output].filter(Boolean))if(inside(protectedRoot,scratchRoot))throw Error('Export scratch overlaps protected input or output.');
    for(let current=scratchRoot;;current=path.dirname(current)){
      const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Export scratch ancestor refused.');if(path.dirname(current)===current)break;
    }
    const parent=await mkdtemp(path.join(scratchRoot,'rs3-stage-private-')); exportParent=parent;
    const {exportSource}=await import('./export-repo-source.mjs');
    source=path.join(parent,'source');
    exported=await exportSource({repo:privateRepo,commit:privateCommit,out:source});
    const receipt=JSON.parse(await readFile(path.join(parent,'export.json'),'utf8'));
    if(receipt.schema!=='rs3-private-export-v1'||receipt.commit!==privateCommit||receipt.treeHash!==(await hashTree(source)).digest||receipt.output!==source)throw Error('Private export receipt differs.');
    exported=receipt;
  }
  if(expectedGatePolicySha256&&expectedGatePolicySha256!==gatePolicyDigest)throw Error('Gate policy differs from paired input.');
  for (const value of [source, accepted, packs, output]) if (!path.isAbsolute(value ?? '')) throw new Error('Absolute paths required.');
  for (const root of [source, accepted, packs]) if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Regular source directories required.');
  try { await lstat(output); throw new Error('Staging output must be absent.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const root of [source, accepted, packs]) { const rel = path.relative(root, output), reverse = path.relative(output, root); if (!rel || !rel.startsWith('..' + path.sep) || !reverse.startsWith('..' + path.sep)) throw new Error('Output overlaps source.'); }
  try{await lstat(path.join(source,'.git'));throw Error('Private source must be a metadata-free export.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(coreRepo||coreRef||base){
    if(!path.isAbsolute(coreRepo??'')||!coreRef||!base)throw Error('Complete core identity required for intake.');
    const result=await releasePreflight({objectOnly:true,core:coreRepo,ref:coreRef,base,source,packs,acceptedKit:accepted,heavyLock,lightLock,memoryAdmission});
    if(!result.passed){console.log(JSON.stringify(result));throw Error('Pre-stage preflight failed.');}
    coreRevision=result.revision;
  }else if(exported)throw Error('Paired staging requires core repo/ref/base preflight.');
  // Capture before copying so linked/hardlinked provenance cannot be normalized away.
  const sourceIdentity = await hashTree(source);
  let practiceSource;
  if (practiceSourceReceipt !== undefined) {
    if (!path.isAbsolute(practiceSourceReceipt)) throw Error('Absolute practice source receipt required.');
    const { practiceInventoryCapability } = await import('./practice-inventory.mjs');
    practiceSource = JSON.parse(await readFile(practiceSourceReceipt, 'utf8'));
    if (practiceSource.schema !== 'rs3-practice-source-v1' || practiceSource.outputDigest !== sourceIdentity.digest) throw Error('Practice source receipt differs.');
    await practiceInventoryCapability(practiceSource.toolingInputs);
  }
  const packsIdentity = await hashTree(packs);
  for (let current = path.dirname(output); ; current = path.dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Staging parent link refused.');
    if (path.dirname(current) === current) break;
  }
  const copy = async (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false, filter: async file => { if ((await lstat(file)).isSymbolicLink()) throw new Error('Source link refused.'); return true; } });
  await mkdir(output, { recursive: false });
  if (practiceSource) await writeFile(path.join(output, 'practice-source.json'), JSON.stringify(practiceSource, null, 2) + '\n', { flag: 'wx' });
  await mkdir(path.join(output, 'checks'));
  await copy(source, path.join(output, 'checks/private-source'));
  await mkdir(path.join(output, 'tools')); await mkdir(path.join(output, 'operator'));
  const scripts = path.join(source, 'scripts/private-companion');
  for (const name of (await readdir(scripts)).sort()) {
    if (name.endsWith('.mjs') || ['approved-workflows.json', 'approved-neutral-workflow.json'].includes(name)) await copy(path.join(scripts, name), path.join(output, 'tools', name));
    if (name.endsWith('.ps1') || name === 'RELEASING.md') await copy(path.join(scripts, name), path.join(output, 'operator', name));
  }
  await copy(packs, path.join(output, 'packs'));
  await mkdir(path.join(output, 'release-gate'));
  await copy(path.join(accepted, 'release-gate/corpus'), path.join(output, 'release-gate/corpus'));
  const browser = path.join(accepted, 'tools/gallery-browser-check.mjs');
  await copy(browser, path.join(output, 'tools/gallery-browser-check.mjs'));
  await mkdir(path.join(output, 'releases'));
  await copy(path.join(scripts,'requests'),path.join(output,'requests'));
  if ((await hashTree(path.join(output, 'checks/private-source'))).digest !== sourceIdentity.digest || (await hashTree(source)).digest !== sourceIdentity.digest || (await hashTree(path.join(output, 'packs'))).digest !== packsIdentity.digest || (await hashTree(packs)).digest !== packsIdentity.digest) throw new Error('Staged source changed during copy.');
  const selection = JSON.parse(await readFile(path.join(output, 'packs/selection.json')));
  if (![1,2,3,4,5,6].includes(Number(concurrency))) throw new Error('Concurrency refused.');
  const locks = {};
  for (const [lane, filename] of [['heavy',memoryAdmission ? path.join(output,'operator/with-heavy.ps1') : heavyLock],['light',memoryAdmission ? path.join(output,'operator/with-light.ps1') : lightLock]]) {
    if (!path.isAbsolute(filename ?? '') || (await lstat(filename)).isSymbolicLink()) throw new Error('Explicit lock wrappers required.');
    locks[lane] = { path:filename,sha256:hash(await readFile(filename)) };
  }
  await writeFile(path.join(output, 'kit.json'), JSON.stringify({ schemaVersion: 2, coreRevision, privateCommit:exported?.commit??null, privateExportHash:exported?.treeHash??null, privateExport:exported, gatePolicy:gatePolicyDigest, operatorFiles: (await hashTree(path.join(output,'operator'))).files.filter(f => f.path.endsWith('.ps1')).map(f => ({name:f.path,sha256:f.sha256})), selection, locks, concurrency:Number(concurrency), memoryAdmission, sourceTreeDigest:sourceIdentity.digest, packsDigest:packsIdentity.digest, sourceDigest: hash(await readFile(path.join(scripts, 'release-v2.mjs'))), createdAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  return { staged: true, kit:output };
  } finally {
    if(exportParent){
      const resolved=path.resolve(exportParent);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('rs3-stage-private-')||(await lstat(resolved)).isSymbolicLink())throw Error('Export cleanup containment refused.');
      await rm(resolved,{recursive:true,force:true});
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if(process.argv[2]==='--help'){console.log('Usage: stage-release-v2.mjs --private-repo PATH --private-commit SHA --core-repo PATH --core-ref SHA --base SHA --accepted PATH --output PATH --heavy-lock PATH --light-lock PATH [--packs PATH] [--request REQUEST --current POINTER]; legacy: --private-source-dir PATH (alias --source)');process.exit(0);}
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if(process.argv[i]==='--memory-admission') { options.memoryAdmission=true;i--;continue; }
      const name = { '--practice-source-receipt':'practiceSourceReceipt','--request':'request','--current':'current','--private-source-dir':'source','--private-repo':'privateRepo','--private-commit':'privateCommit','--core-repo':'coreRepo','--core-ref':'coreRef','--base':'base','--expected-gate-policy':'expectedGatePolicySha256','--source': 'source', '--accepted': 'accepted', '--packs':'packs', '--output': 'output', '--heavy-lock':'heavyLock','--light-lock':'lightLock','--concurrency':'concurrency' }[process.argv[i]];
      if (!name || !process.argv[i + 1] || options[name]) throw new Error('Arguments refused.'); options[name] = process.argv[i + 1];
    }
    console.log(JSON.stringify(await stageReleaseKit(options)));
  } catch (error) { console.error(error.releaseTextRule || error.privateDrift ? error.message : 'Release kit staging refused.'); process.exitCode = 1; }
}
