// Disposable contract integration. The fixture runners are synthetic, never product suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hashTree, digestValue } from '../scripts/private-companion/release-identity.mjs';
import { bindingBytes } from '../scripts/private-companion/release-pack-check.mjs';
import { prune } from '../scripts/private-companion/release-v2.mjs';
const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
import { stageReleaseKit } from '../scripts/private-companion/stage-release-v2.mjs';
import { pipelineTests, orderedEarly, earlyBudgetMs } from '../scripts/private-companion/release-early.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
const invoke = (file, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
  child.on('error', reject); child.on('close', code => resolve({ code, output }));
});
test('early checks run in order, collect every failure, and stop starting checks once the budget is spent', async () => {
  assert.equal(earlyBudgetMs, 30 * 60000);
  let clock = 0; const ran = [], step = (name, seconds, error) => async remaining => { ran.push([name, remaining]); clock += seconds * 1000; if (error) throw Error(error); };
  const result = await orderedEarly({ gallery: step('gallery', 296), startup: step('startup', 30), pipeline: step('pipeline', 60), previous: step('previous', 10), now: () => clock });
  assert.equal(result.passed, true); assert.deepEqual(ran.map(([name]) => name), ['gallery', 'startup', 'pipeline', 'previous']);
  assert.equal(ran[1][1], earlyBudgetMs - 296000, 'each check gets only what is left');
  clock = 0; ran.length = 0;
  const refused = await orderedEarly({ budgetMs: 300000, gallery: step('gallery', 296), startup: step('startup', 30, 'slow'), pipeline: step('pipeline', 1), previous: step('previous', 1), now: () => clock }).then(() => null, error => error);
  assert.match(refused.message, /^Early release checks failed: copied-synthetic-startup, pipeline-integration, previous-failures$/);
  assert.deepEqual(refused.earlyResult.checks.map(check => check.reason ?? 'passed'), ['passed', 'slow', 'early-budget-exhausted', 'early-budget-exhausted']);
  assert.deepEqual(ran.map(([name]) => name), ['gallery', 'startup'], 'no check starts after the budget is spent');
});

test('staging accepts an isolated pack build and hashes every copied payload into kit identity', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'stage-packs-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'), accepted=path.join(root,'accepted'), packs=path.join(root,'rebuilt-packs');
  await put(path.join(source,'scripts/private-companion/release-v2.mjs'),'// synthetic tooling');
  await put(path.join(source,'scripts/private-companion/requests/request.json'),{});
  await put(path.join(accepted,'packs/selection.json'),{version:'old'});
  await put(path.join(accepted,'release-gate/corpus/input.txt'),'synthetic corpus');
  await put(path.join(accepted,'tools/gallery-browser-check.mjs'),'// synthetic checker');
  await put(path.join(packs,'selection.json'),{version:'new'});
  await put(path.join(packs,'data/payload.json'),{correction:true});
  const wrapper=path.join(root,'lock.ps1');await put(wrapper,'# synthetic wrapper, never executed');
  const options={source,accepted,packs,heavyLock:wrapper,lightLock:wrapper,concurrency:1};
  const output=path.join(root,'kit');await stageReleaseKit({...options,output});
  const kit=await json(path.join(output,'kit.json'));
  assert.deepEqual(kit.selection,{version:'new'});
  assert.equal(kit.packsDigest,(await hashTree(packs)).digest);
  assert.equal(kit.packsDigest,(await hashTree(path.join(output,'packs'))).digest);
  assert.equal(kit.sourceTreeDigest,(await hashTree(source)).digest);
  await put(path.join(packs,'unselected-extra.json'),{alsoHashed:true});
  const second=path.join(root,'second-kit');await stageReleaseKit({...options,output:second});
  assert.notEqual((await json(path.join(second,'kit.json'))).packsDigest,kit.packsDigest);
  await assert.rejects(stageReleaseKit({...options,output}),/absent/);
  await assert.rejects(stageReleaseKit({...options,output:path.join(packs,'kit')}),/overlap/);
  const legacy=path.join(root,'legacy-kit');await stageReleaseKit({...options,packs:undefined,output:legacy});
  assert.deepEqual((await json(path.join(legacy,'kit.json'))).selection,{version:'old'});
});
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-pipeline-fixture-')); t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit'), repo = path.join(root, 'repo');
  for (const name of ['tools', 'operator', 'packs', 'release-gate/corpus', 'checks/private-source/scripts/secret-scan', 'releases']) await mkdir(path.join(kit, name), { recursive: true });
  await mkdir(repo);
  for (const name of ['release-v2.mjs', 'frozen-release.mjs', 'release-pack-check.mjs', 'release-identity.mjs', 'release-text.mjs', 'release-legacy-rollback.mjs', 'public-core-gate.mjs', 'release-idle.mjs', 'release-evidence.mjs', 'retry-policy.mjs', 'file-test-evidence.mjs', 'module-scan.mjs', 'file-test-lane.mjs', 'lane-test-evidence.mjs', 'release-lane-status.mjs', 'retry-failed-files.mjs', 'release-early.mjs']) await cp(path.join(scripts, name), path.join(kit, 'tools', name));
  // This lifecycle fixture already supplies synthetic scanner/suite/gallery producers.
  // Preflight's real data contracts have their own independent tests.
  await put(path.join(kit,'tools/release-preflight.mjs'),'export const releasePreflight=async()=>({passed:true,synthetic:true});');
  // Synthetic core/intake contract, as above. Actual prepare-time drift refusal
  // and its ordering are covered independently in release-freeze.test.mjs.
  await put(path.join(kit,'tools/check-private-drift.mjs'),'export const assertPrivateDriftForStaging=async()=>{};');
  await put(path.join(kit, 'kit.json'), { schemaVersion: 2, concurrency: 6, browser: { path: process.execPath } });
  // Only the practice guard boundary is stubbed; its real acceptance checks have
  // separate audit fixtures. The lifecycle test still uses the actual gate orchestrator.
  await put(path.join(kit,'tools/release-practice.mjs'),'export const assertPracticeAcceptance=async()=>{};');
  await put(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'),`export async function runAdaptive({files}){return {passed:true,files:files.map(file=>({file,passed:true,processWallMs:10,fileWallMs:9,bodyMs:2,summary:{}}))};}`);
  await put(path.join(kit,'checks/private-source/tests/fixtures/original-sync/capture.json'),{synthetic:true,records:[{task:'fixture-task',completed:true}]});
  await put(path.join(kit,'checks/private-source/scripts/perf/cdp.mjs'),'export const syntheticBrowserTransport = true;');
  await put(path.join(kit, 'checks/private-source/scripts/secret-scan/scan.mjs'), 'export function scanEntries(entries) { return {status:"clean",files:entries.length,findings:[]}; }\nexport function loadReviewed() { return {hosts:[],placeholders:new Set(),lines:new Set()}; }');
  await put(path.join(kit, 'checks/private-source/scripts/secret-scan/fingerprints.mjs'), 'export async function loadCorpus(){ return {}; }');
  await put(path.join(kit, 'checks/private-source/scripts/secret-scan/reviewed.json'), {});
  const packBytes = JSON.stringify({ schemaVersion: 1, files: [] });
  await put(path.join(kit,'packs/fixture/1.0.0/pack.json'),packBytes);
  const choice = { id: 'fixture', version: '1.0.0', sha256: hash(packBytes) }, selection = { schemaVersion: 1, data: choice, rulesText: choice, art: choice };
  await put(path.join(kit, 'packs/selection.json'), selection);
  const log = { schemaVersion: 1, entries: [{ date: '2026-01-01', title: 'Earlier', items: ['Earlier item'] }] };
  const map = { schemaVersion: 1, updated: '2026-01-01', themes: [{ id: 'a', items: [{ id: 'A1', title: 'A task', note: 'Earlier' }] }] };
  const addon = path.join(root, 'old-addon/addon.json'), files = [];
  for (const [name, data] of [['changelog.json', log], ['roadmap.json', map]]) { const bytes = JSON.stringify(data); await put(path.join(path.dirname(addon), 'app/data', name), bytes); files.push({ path: 'app/data/' + name, sha256: hash(bytes) }); }
  await put(addon, { schemaVersion: 1, features: { projectUpdates: true }, files });
  const previous = path.join(root, 'old-config.json');
  const origin = path.join(root,'origin'); await put(origin,'fixture origin bytes');
  await put(previous, { schemaVersion: 1, coreRoot: repo, nodePath: process.execPath, publicOriginFile:origin, packsDir:path.join(kit,'packs'), addons: { path: addon, sha256: hash(await readFile(addon)) }, packs: { data: choice, rulesText: choice, art: choice } });
  await put(path.join(repo, 'scripts/test.mjs'), '// fixture per-file runner is supplied by the isolated kit');
  await put(path.join(repo,'scripts/test-selection.mjs'),"import {readdir} from 'node:fs/promises';export async function discoverTests(directory){return (await readdir(directory)).filter(name=>name.endsWith('.test.mjs')).sort();}");
  for(const name of [...pipelineTests,'state.test.mjs'])await put(path.join(repo,'tests',name),"import test from 'node:test';test('synthetic lifecycle fixture',()=>{});");
  await put(path.join(repo,'tests/browser-screen-harness.mjs'),'// independent synthetic public fixture');
  await put(path.join(repo, 'app/server.mjs'), `export const marker = "committed core";import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';export async function createServer({dataDir}){await mkdir(dataDir,{recursive:true});let state;try{state=JSON.parse(await readFile(path.join(dataDir,'state.json')));}catch{state={revision:1,members:[],tasks:[]};await writeFile(path.join(dataDir,'state.json'),JSON.stringify(state));}return {store:{getState:()=>state},close:async()=>{}};}`);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: 'pipe' }).toString().trim();
  git('init'); git('config', 'user.email', 'fenerax@users.noreply.github.com'); git('config', 'user.name', 'Fixture'); git('add', '.'); git('commit', '-m', 'Fixture committed core'); const revision = git('rev-parse', 'HEAD');
  await put(path.join(repo, 'app/server.mjs'), 'export const marker = "uncommitted core";');
  await put(path.join(repo, 'untracked-private.txt'), 'must never export');
  await put(path.join(kit, 'tools/companion-check.mjs'), `import {mkdir,writeFile,readFile,cp} from 'node:fs/promises'; import path from 'node:path'; const a=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]])); const out=a['--output']; if(a['--lane']==='addon'){await mkdir(out); await writeFile(path.join(out,'addon.json'),'{}');} else if(a['--lane']==='profile'){await writeFile(out,'{}');} else if(a['--lane']==='prepare'){await cp(a['--core'],out,{recursive:true});await mkdir(path.join(out,'.local/game-data'),{recursive:true});await mkdir(path.join(out,'.local/map-assets'),{recursive:true});} else {process.exitCode=1;}`);
  for (const name of ['verify-install.mjs', 'gallery-browser-check.mjs']) await put(path.join(kit, 'tools', name), 'console.log(JSON.stringify({passed:true}));');
  // Windows Chrome resolves these known folders before enabling scratch CDP.
  await put(path.join(kit, 'tools/gallery-check.mjs'), `import {access} from 'node:fs/promises'; import path from 'node:path'; if(process.platform==='win32')for(const name of ['Local','Roaming'])await access(path.join(process.env.USERPROFILE,'AppData',name)); console.log(JSON.stringify({passed:true}));`);
  const heavy = `param([Parameter(Position=0)][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)\n$ErrorActionPreference='Stop'\n$dir=Join-Path $PSScriptRoot 'fixture-owner'\nNew-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null\n$token=[Guid]::NewGuid().ToString('N')\n@{pid=$PID;token=$token}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $dir 'owner.json')\n$env:RS3_HEAVY_LOCK_PATH=$dir;$env:RS3_HEAVY_LOCK_PID=[string]$PID;$env:RS3_HEAVY_LOCK_TOKEN=$token\ntry { & $Command @Rest; $result=$LASTEXITCODE } finally { Remove-Item -LiteralPath $dir -Recurse -Force }\nexit $result\n`;
  // Fixture owner location is mutable evidence, outside every frozen kit component.
  await put(path.join(kit, 'operator/with-heavy.ps1'), heavy.replace("Join-Path $PSScriptRoot 'fixture-owner'", "Join-Path (Split-Path $PSScriptRoot -Parent) '.local/fixture-owner'"));
  await put(path.join(kit, 'operator/with-light.ps1'), 'param([Parameter(Position=0)][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)\n& $Command @Rest\nexit $LASTEXITCODE');
  const input = path.join(root, 'request.json'); await put(input, { releaseId: 'fixture', changelog: { date: '2026-01-02', title: 'New entry', items: ['New item'] }, roadmap: { id: 'A1', note: 'New note' } });
  return { root, kit, repo, revision, previous, input, cli: path.join(kit, 'tools/release-v2.mjs'), release: path.join(kit, 'releases/fixture') };
}
test('prepare exports exact commit; one inherited owner gates both fixture runners; exact reuse and mutation refusal', { timeout: 240000 }, async t => {
  const f = await fixture(t);
  const { prepare,releaseCandidate,inspectFullLaneReuse,parseArgs } = await import(pathToFileURL(f.cli));
  await prepare({kit:f.kit,repo:f.repo,ref:f.revision,base:f.revision,'previous-config':f.previous,input:f.input});
  assert.equal((await json(path.join(f.release,'companion.json'))).packsDir,path.join(f.release,'packs'));
  assert.equal((await json(path.join(f.release,'config.json'))).packsDir,path.join(f.release,'packs'));
  assert.equal((await hashTree(path.join(f.release,'packs'))).digest,(await hashTree(path.join(f.kit,'packs'))).digest);
  let result;
  assert.match(await readFile(path.join(f.release, 'core/app/server.mjs'), 'utf8'), /committed core/);
  assert.ok(!(await readdir(path.join(f.release, 'core'))).includes('untracked-private.txt'));
  const args = ['release', '--kit', f.kit, '--release', f.release, '--gates-only'];
  // Programmatic callers share the CLI's resolved kit policy; raw execution
  // helpers deliberately require explicit options rather than choosing policy.
  const releaseOptions=await parseArgs(args.slice(1));
  try { await releaseCandidate(releaseOptions); } catch(e) { throw new Error(e.message + await readFile(path.join(f.release,'.local/heavy-worker.log'),'utf8')); }
  assert.equal((await json(path.join(f.release, 'release-gate/gates.json'))).passed, true);
  result = await invoke(f.cli, args); assert.equal(result.code, 0, result.output);
  const timing = (await json(path.join(f.release, 'release-gate/gates.json'))).timings;
  for (const name of ['public-full', 'private-full']) { const row=timing.find(row=>row.stage===name);assert.equal(row.fresh,0);assert.equal(row.reused,pipelineTests.length+1); }
  const inspection=await inspectFullLaneReuse({...releaseOptions,retryOnceInIsolation:releaseOptions['retry-once-in-isolation']});
  for(const lane of ['public-full','private-full']){assert.equal(inspection.lanes[lane].accepted,true);assert.equal(inspection.lanes[lane].fresh,0);}
  // The oldest retained accepted root can outlive its original predecessor.
  // Rollback validates its own exact evidence; forward validation still needs
  // the historical previous configuration, even without --current.
  const manifest = await json(path.join(f.release, 'release.json'));
  await put(path.join(f.release, 'release-gate/accepted.json'), { schemaVersion: 2, inputDigest: manifest.identity.digest, completedAt: new Date().toISOString() });
  // Both CI and the effective child PATH are pinned independently of the launcher.
  const pathKey=Object.keys(process.env).find(key=>key.toUpperCase()==='PATH')??'PATH';
  const changedShell={...process.env,[pathKey]:process.env[pathKey]+path.delimiter+f.root};
  result=await invoke(f.cli,['assert-identity','--kit',f.kit,'--release',f.release,'--rollback'],changedShell);assert.equal(result.code,0,result.output);
  result=await invoke(f.cli,['assert-identity','--kit',f.kit,'--release',f.release],changedShell);assert.equal(result.code,0,'deterministic child PATH ignores harmless launcher PATH additions');
  await rm(f.previous);
  result = await invoke(f.cli, ['assert-identity', '--kit', f.kit, '--release', f.release, '--rollback']); assert.equal(result.code, 0, result.output);
  result = await invoke(f.cli, ['assert-identity', '--kit', f.kit, '--release', f.release]); assert.notEqual(result.code, 0);
  await put(path.join(f.release, 'core/app/server.mjs'), 'changed after gates');
  result = await invoke(f.cli, ['assert-identity', '--kit', f.kit, '--release', f.release]); assert.notEqual(result.code, 0);
  result = await invoke(f.cli, args); assert.notEqual(result.code, 0);
});
test('failed preparation never publishes a releasable manifest', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  await put(path.join(f.kit, 'tools/companion-check.mjs'), 'process.exitCode=1;');
  const result = await invoke(f.cli, ['prepare', '--kit', f.kit, '--repo', f.repo, '--ref', f.revision, '--base', f.revision, '--previous-config', f.previous, '--input', f.input]);
  assert.notEqual(result.code, 0);
  assert.match(result.output,/Release child exited with code 1/,result.output);
  assert.ok(!(await readdir(f.release)).includes('release.json'));
  const failure=await json(path.join(f.release,'.local/prepare-failure.json'));
  assert.match(failure.cause.message,/Release child exited with code 1/);
  assert.match(result.output,/Release child exited with code 1/);
});
test('checked freeze binds retained rollback and runs dry runs once before sealed admission', {timeout:180000},async t=>{
  const f=await fixture(t);
  // Retained releases need actual private text bytes and their addon pins, so
  // the second preparation can prove retention from the first release.
  await put(path.join(f.kit,'tools/companion-check.mjs'),`import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const a=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]])),out=a['--output'];
if(a['--lane']==='addon'){await mkdir(out);const files=[];for(const row of JSON.parse(await readFile(a['--receipt'])).textOverrides){const bytes=await readFile(row.source);await mkdir(path.dirname(path.join(out,row.path)),{recursive:true});await writeFile(path.join(out,row.path),bytes);files.push({path:row.path,sha256:createHash('sha256').update(bytes).digest('hex')});}await writeFile(path.join(out,'addon.json'),JSON.stringify({schemaVersion:1,features:{projectUpdates:true},files}));}
else if(a['--lane']==='profile'){await writeFile(out,'{}');}
else if(a['--lane']==='prepare'){await cp(a['--core'],out,{recursive:true});await mkdir(path.join(out,'.local/game-data'),{recursive:true});await mkdir(path.join(out,'.local/map-assets'),{recursive:true});}
else process.exitCode=1;`);
  // This test exercises freeze orchestration; the actual managed Windows
  // boundary and real picker startup have separate operator/scratch coverage.
  await put(path.join(f.kit,'operator/Managed-ReleaseV2.ps1'),`param([string]$CurrentRelease,[string]$CandidatePointer,[string]$CompanionRoot,[string]$Receipt,[string]$ReleaseRoot,[switch]$DryRun,[switch]$Rollback)\nif(-not $DryRun){throw 'Fixture permits dry runs only'}\nAdd-Content -LiteralPath (Join-Path $CompanionRoot '.local/dry-runs.txt') -Value ([bool]$Rollback)\n`);
  const api=await import(pathToFileURL(f.cli));
  await api.prepare({kit:f.kit,repo:f.repo,ref:f.revision,base:f.revision,'previous-config':f.previous,input:f.input});
  await api.releaseCandidate({kit:f.kit,release:f.release,'gates-only':true});
  const old=await json(path.join(f.release,'release.json'));
  await put(path.join(f.release,'release-gate/accepted.json'),{inputDigest:old.identity.digest,completedAt:new Date().toISOString()});
  const current=path.join(f.root,'current.json');await cp(path.join(f.release,'pointer.json'),current);
  // Advance only the tracked core module, preserving its startup factory and
  // leaving the fixture's untracked private file outside the exported commit.
  const git=(...args)=>execFileSync('git',['-C',f.repo,...args],{windowsHide:true,stdio:'pipe'}).toString().trim();
  await put(path.join(f.repo,'app/server.mjs'),git('show',f.revision+':app/server.mjs').replace('committed core','second committed core'));
  git('add','app/server.mjs');git('commit','-m','Second synthetic core revision');const nextRevision=git('rev-parse','HEAD');
  await put(f.input,{releaseId:'next',changelog:{date:'2026-01-03',title:'Second',items:['Second item']},roadmap:{id:'A1',note:'Second note'}});
  const next=await api.prepare({kit:f.kit,repo:f.repo,ref:nextRevision,current,input:f.input});
  assert.equal((await json(path.join(next,'release.json'))).lane,'full');
  await api.releaseCandidate({kit:f.kit,release:next,current,'gates-only':true});
  const frozen=await api.freezeCandidate({kit:f.kit,release:next,current});
  assert.equal(frozen.seal.prepared,false);assert.equal(frozen.seal.rollback.release,f.release);
  assert.deepEqual((await readFile(path.join(f.kit,'.local/dry-runs.txt'),'utf8')).trim().split(/\r?\n/),['False','True']);
  const {readFrozenSeal}=await import(pathToFileURL(path.join(f.kit,'tools/frozen-release.mjs')));
  await readFrozenSeal({filename:frozen.filename,kit:f.kit,release:next,current,identityDigest:frozen.seal.identityDigest,verifyBytes:true});
  await put(path.join(next,'core/app/server.mjs'),'changed after freeze');
  await assert.rejects(readFrozenSeal({filename:frozen.filename,kit:f.kit,release:next,current,identityDigest:frozen.seal.identityDigest,verifyBytes:true}),/bytes changed/);
});
test('bounded text assembly retains exact private inputs without copying pack payloads', {timeout:120000}, async t=>{
  const f=await fixture(t),checker=path.join(f.kit,'tools/companion-check.mjs');
  await cp(path.join(scripts,'companion-check.mjs'),checker);
  await cp(path.join(scripts,'core-overlay-guard.mjs'),path.join(f.kit,'tools/core-overlay-guard.mjs'));
  const inventory=await hashTree(path.join(f.kit,'checks/private-source'));
  const receipt=path.join(f.kit,'releases/text-receipt.json');
  await put(receipt,{schemaVersion:1,coreRoot:f.repo,privateFiles:inventory.files.map(({path:filename,sha256})=>({path:filename,sha256})),packs:await json(path.join(f.kit,'packs/selection.json'))});
  const output=path.join(f.kit,'.local/text-assembly');
  const result=await invoke(checker,['--core',f.repo,'--receipt',receipt,'--lane','prepare-text','--output',output]);
  assert.equal(result.code,0,result.output);
  assert.equal(await readFile(path.join(output,'scripts/secret-scan/scan.mjs'),'utf8'),await readFile(path.join(f.kit,'checks/private-source/scripts/secret-scan/scan.mjs'),'utf8'));
  assert.ok(!(await readdir(output)).includes('packs'));
  assert.ok(!(await readdir(output)).includes('.local'));
});

// This fixture performs several complete input captures for two deployments.
// The observed busy-PC run took 119 seconds alone (131 s on 2026-10-20) and over
// 180 s inside the sequential tooling contracts; keep headroom for those captures.
test('a new kit prepares a changed-pack release with its own packs, bidirectional evidence and fresh full/gallery keys', {timeout:360000}, async t=>{
  const old=await fixture(t),next=await fixture(t);
  // This scenario deliberately installs its own HTTP save/endpoint adapter below.
  // Keep that adapter unchanged and substitute only the unrelated startup CLI
  // boundary; the factory and independent audit fixtures cover real copied startup.
  for(const f of [old,next]){const file=path.join(f.kit,'tools/release-early.mjs'),source=await readFile(file,'utf8');assert.match(source,/await syntheticStartup\(options\)/);await put(file,source.replace('await syntheticStartup(options)','{passed:true,syntheticFixtureBoundary:true}'));}
  const dataDir=path.join(old.root,'synthetic-save');await put(path.join(dataDir,'state.json'),{revision:9});
  const stateBefore=await readFile(path.join(dataDir,'state.json'));
  const git=(...args)=>execFileSync('git',['-C',old.repo,...args],{windowsHide:true,stdio:'pipe'}).toString().trim();
  await put(path.join(old.repo,'app/dataset-bootstrap.mjs'),'export const loadDatasetInputs=async()=>({definitionBytes:Buffer.from(JSON.stringify({challenges:{}}))});');
  await put(path.join(old.repo,'app/dataset-pipeline.mjs'),'export const prepareTaskDefinitions=x=>x;');
  await put(path.join(old.repo,'app/server.mjs'),`import http from 'node:http';import {readFile} from 'node:fs/promises'; export async function createServer({dataDir,port}){const state=JSON.parse(await readFile(dataDir+'/state.json'));if(state.revision!==9)throw Error('wrong save');const server=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({tasks:[{id:'rs3:task:1'}]}));});return {dataset:{},store:{getState:()=>({members:[{id:'one',completedTasks:[],taskStatus:{}}],tasks:[{id:'rs3:task:1'}]}),backup:async()=>({})},listen:()=>new Promise(ok=>server.listen(port,'127.0.0.1',ok)),get inviteUrl(){return 'http://127.0.0.1:'+port+'/join/synthetic';},close:()=>new Promise(ok=>server.close(ok))};}`);
  await put(path.join(old.repo,'app/tasks/identity.mjs'),`export const authoredIdentityRegistry=()=>({entries:{'rs3:task:1':{}},aliases:{}});export const resolveIdentity=id=>({status:'resolved',id});`);
  git('add','app');git('commit','-m','Synthetic packed startup contract');const revision=git('rev-parse','HEAD');
  const checker=`import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';const a=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));const out=a['--output'],kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),r=JSON.parse(await readFile(a['--receipt']));if(a['--lane']==='addon'){await mkdir(out);const files=[];for(const row of r.textOverrides){const b=await readFile(row.source);await mkdir(path.dirname(path.join(out,row.path)),{recursive:true});await writeFile(path.join(out,row.path),b);files.push({path:row.path,sha256:createHash('sha256').update(b).digest('hex')});}await writeFile(path.join(out,'addon.json'),JSON.stringify({schemaVersion:1,features:{projectUpdates:true},files}));}else if(a['--lane']==='profile'){const sel=JSON.parse(await readFile(kit+'/packs/selection.json'));const m=JSON.parse(await readFile(path.join(kit,'packs',sel.data.id,sel.data.version,'pack.json')));await writeFile(out,JSON.stringify({datasetId:m.requires.datasetId,datasetDigest:m.datasetDigest,ruleContractHash:m.ruleContractHash}));}else if(a['--lane']==='prepare'){await cp(a['--core'],out,{recursive:true});await mkdir(out+'/.local/game-data',{recursive:true});await mkdir(out+'/.local/map-assets',{recursive:true});}else process.exit(1);`;
  const descriptors=[];
  for(const [f,version,digit] of [[old,'1.0.0','1'],[next,'1.0.1','2']]) {
    await put(path.join(f.kit,'tools/companion-check.mjs'),checker);
    const descriptor={datasetId:'duo-legacy',datasetContractVersion:1,digest:digit.repeat(64)};
    descriptors.push({...descriptor,bindingSha256:hash(bindingBytes(descriptor))});
    const packs={}; const selection={schemaVersion:1};
    for(const [kind,id] of [['data','duo-data'],['rulesText','duo-rules-text'],['art','duo-art']]) {
      const file=path.join(f.kit,'packs',id,version,'pack.json');
      await put(file,{requires:{datasetId:descriptor.datasetId,datasetContractVersion:1},datasetDigest:descriptor.digest,ruleContractHash:'a'.repeat(64),files:[]});
      packs[kind]={path:file,sha256:hash(await readFile(file))};selection[kind]={id,version,sha256:packs[kind].sha256};
    }
    await put(path.join(f.kit,'packs/selection.json'),selection);
    if(f===old){const config=await json(f.previous);await put(f.previous,{...config,dataDir,packs,selection:{path:path.join(f.kit,'packs/selection.json'),sha256:hash(await readFile(path.join(f.kit,'packs/selection.json')))}});}
  }
  await put(dataDir+'.dataset.json',bindingBytes(descriptors[0]));
  const shared = path.join(old.root,'shared'); await mkdir(shared);
  const locks={};
  for (const lane of ['heavy','light']) {
    const wrapper=path.join(shared,lane+'.ps1');
    await cp(path.join(old.kit,'operator/with-'+lane+'.ps1'),wrapper);
    locks[lane]={path:wrapper,sha256:hash(await readFile(wrapper))};
  }
  await put(path.join(old.kit,'kit.json'),{schemaVersion:2,locks,concurrency:6,browser:{path:process.execPath}});
  const oldApi=await import(pathToFileURL(old.cli));
  await oldApi.prepare({kit:old.kit,repo:old.repo,ref:revision,base:revision,'previous-config':old.previous,input:old.input});
  const oldOptions=await oldApi.parseArgs(['--kit',old.kit,'--release',old.release,'--gates-only']);
  await oldApi.releaseCandidate(oldOptions);
  const baseline=await json(path.join(old.release,'release.json'));
  await put(path.join(old.release,'release-gate/accepted.json'),{accepted:true,inputDigest:baseline.identity.digest,completedAt:new Date().toISOString(),synthetic:true});
  // The new release still requires today's exact shared wrapper bytes.
  await writeFile(locks.heavy.path,'\n# later shared backoff policy\n',{flag:'a'});
  await assert.rejects(oldApi.releaseCandidate(oldOptions),/wrapper changed/);
  let retained=await invoke(next.cli,['assert-identity','--kit',next.kit,'--release',old.release,'--rollback']);
  assert.equal(retained.code,0,retained.output);
  const oldGates=await json(path.join(old.release,'release-gate/gates.json'));
  const receiptFile=oldGates.suites.private.filename, receiptBytes=await readFile(receiptFile);
  const tampered=JSON.parse(receiptBytes);tampered.inputDigest='f'.repeat(64);await put(receiptFile,tampered);
  retained=await invoke(next.cli,['assert-identity','--release',old.release,'--rollback']);assert.notEqual(retained.code,0,'tampered retained receipt refused');
  await writeFile(receiptFile,receiptBytes);
  const timestampTamper=JSON.parse(receiptBytes);timestampTamper.startedAt=new Date(Date.parse(timestampTamper.startedAt)-1000).toISOString();await put(receiptFile,timestampTamper);
  retained=await invoke(next.cli,['assert-identity','--release',old.release,'--rollback']);assert.notEqual(retained.code,0,'tampered receipt timing refused');
  await writeFile(receiptFile,receiptBytes);
  const oldPackDigest=(await hashTree(path.join(old.release,'packs'))).digest;
  const current=path.join(old.root,'current.json');await put(current,await readFile(path.join(old.release,'pointer.json'),'utf8'));
  const request=await json(next.input);request.releaseId='upgrade';request.changelog={date:'2026-01-03',title:'Upgrade packs',items:['New pack selection']};request.roadmap.note='Pack upgrade checked';request.packTransition={old:descriptors[0],new:descriptors[1]};await put(next.input,request);
  const api=await import(pathToFileURL(next.cli));
  const release=await api.prepare({kit:next.kit,repo:old.repo,ref:revision,current,input:next.input});
  const manifest=await json(path.join(release,'release.json')),transition=await json(path.join(release,'pack-transition.json'));
  assert.equal(manifest.packUpgrade,true);assert.equal(manifest.lane,'full');assert.equal(manifest.previousRelease,old.release);
  assert.equal(transition.compatibility.bothDirections,true);
  assert.equal((await json(path.join(release,'config.json'))).packsDir,path.join(release,'packs'));
  await api.releaseCandidate(await api.parseArgs(['--kit',next.kit,'--release',release,'--current',current,'--gates-only']));
  const gates=await json(path.join(release,'release-gate/gates.json')),prior=await json(path.join(old.release,'release-gate/gates.json'));
  // Relnext public authority is keyed to the core, independently of private packs.
  assert.equal(gates.suites.public.record.key,prior.suites.public.record.key);
  assert.notEqual(gates.suites.private.record.key,prior.suites.private.record.key);
  for(const lane of ['public','private']) assert.notEqual(gates.suites[lane].reused,true); // separate evidence roots each earn their own proof
  assert.notEqual(gates.gallery.record.key,prior.gallery.record.key);
  assert.equal((await hashTree(path.join(old.release,'packs'))).digest,oldPackDigest);
  assert.deepEqual(await readFile(path.join(dataDir,'state.json')),stateBefore);
});

test('pruning retains both endpoints and evidence of an unaccepted upgrade after later code releases', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pack-retention-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const kit=path.join(root,'kit'),releases=path.join(kit,'releases');
  const old=path.join(releases,'old'),failed=path.join(releases,'failed-upgrade');
  for(const [i,name] of ['old','obsolete','previous','current'].entries()){
    const directory=path.join(releases,name);await put(path.join(directory,'config.json'),{name});
    await put(path.join(directory,'release-gate/accepted.json'),{completedAt:`2026-01-0${i+1}`});
  }
  await put(path.join(failed,'config.json'),{name:'unaccepted'});
  const transitionFile=path.join(failed,'pack-transition.json');
  const oldPath=path.join(old,'config.json');
  const retainedPath=process.platform==='win32'?oldPath.replaceAll('\\','/').toUpperCase():oldPath;
  await put(transitionFile,{oldConfig:{path:retainedPath},newConfig:{path:path.join(failed,'config.json')}});
  const evidence=await readFile(transitionFile);
  const current=path.join(root,'current.json'),config=path.join(releases,'current/config.json');
  await put(current,{schemaVersion:2,releaseId:'current',config:{path:config,sha256:hash(await readFile(config))}});
  await put(path.join(releases,'current/release.json'),{previousRelease:path.join(releases,'previous')});
  await prune(kit,current);
  assert.deepEqual(await readFile(transitionFile),evidence);
  assert.equal((await json(path.join(old,'config.json'))).name,'old');
  assert.equal((await json(path.join(failed,'config.json'))).name,'unaccepted');
  assert.ok(!(await readdir(releases)).includes('obsolete'));
});


test('release lanes pin a modest heap after environment sanitization', async () => {
  const {laneEnvironment} = await import('../scripts/private-companion/release-evidence.mjs');
  const env = await laneEnvironment(path.dirname(scripts),process.execPath,{NODE_OPTIONS:'--inspect'});
  assert.equal(env.NODE_OPTIONS,'--max-old-space-size=1536');
  if (process.platform === 'win32') {
    const pwsh = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7');
    assert.equal(env.PATH.split(path.delimiter).includes(pwsh), existsSync(path.join(pwsh, 'pwsh.exe')), 'pwsh resolves exactly when PowerShell 7 is installed');
    assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0], ['1', 'core.longpaths', 'true'], 'deep lane temp paths stay usable by git');
  }
});
