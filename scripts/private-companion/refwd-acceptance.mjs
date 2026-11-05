// Disposable acceptance for the actual Windows managed-release entrypoint.
// No gates, installer, live save, scheduled task, or real release lock is used.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { readFile, writeFile, mkdir, cp, readdir, lstat, access } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const put = async (file, value) => { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, Buffer.isBuffer(value) || typeof value === 'string' ? value : encode(value)); };
const exists = file => access(file).then(()=>true,()=>false);
const pin = async file => ({path:file,sha256:sha(await readFile(file))});
const ps = value => `'${String(value).replaceAll("'", "''")}'`;
const inside = (root, file) => { const r=path.relative(root,file); return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r); };
const binding = d => encode({schemaVersion:1,datasetId:d.datasetId,datasetContractVersion:d.datasetContractVersion,digest:d.digest,requiresPack:true});
const cleanEnvironment = extra => ({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^RS3_|^NODE_OPTIONS$|^NODE_PATH$/i.test(k))),...extra});
const temporaryEnvironment = temporaryRoot => cleanEnvironment({TEMP:temporaryRoot,TMP:temporaryRoot,TMPDIR:temporaryRoot});

async function invoke(exe, args, env, log) {
  const startedAt=new Date().toISOString(),started=performance.now();
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{env:env??cleanEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='';const timer=setTimeout(()=>{
      // This PID was returned by this spawn; /T contains its pack-check probes.
      // Never leave a compatibility child running after its owning helper times out.
      if(process.platform==='win32')try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{env:env??cleanEnvironment(),windowsHide:true,stdio:'ignore',timeout:10000});}catch{}
      else child.kill();
      reject(Error('Acceptance child exceeded 300 seconds; its owned process tree was stopped. Inspect retained fixture locks.'));
    },300000);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',async code=>{clearTimeout(timer);if(log)await put(log,out);resolve({code,output:out,startedAt,completedAt:new Date().toISOString(),wallSeconds:(performance.now()-started)/1000});});
  });
}
async function portIsFree(port) {
  assert.ok(Number.isInteger(port)&&port>=18700&&port<=18799,'Managed fixture port must stay in 18700–18799.');
  return new Promise(ok=>{const socket=net.createServer();socket.once('error',()=>ok(false));socket.listen(port,'127.0.0.1',()=>socket.close(()=>ok(true)));});
}
async function freePort() {
  for(let p=18700;p<=18799;p++) {
    if(await portIsFree(p))return p;
  }
  throw Error('No free fixture listener in 18700–18799.');
}
async function checkedSource(file, records) {
  const bytes=await readFile(file);records.push({path:file,sha256:sha(bytes),readUtc:new Date().toISOString()});return bytes;
}
async function exportCore(source,ref,target,records,env) {
  const revision=execFileSync('git',['-C',source,'rev-parse',ref],{env,windowsHide:true,encoding:'utf8'}).trim();
  assert.ok(revision.startsWith('d2afe6e'),'Acceptance core must be frozen d2afe6e.');
  const archive=execFileSync('git',['-C',source,'archive','--format=tar',revision,'app','scripts','package.json'],{env,windowsHide:true,maxBuffer:128*1024*1024});
  const archivePath=target+'.tar';await put(archivePath,archive);await mkdir(target,{recursive:true});
  records.push({path:`git:${source}@${revision}`,sha256:sha(archive),readUtc:new Date().toISOString(),kind:'git-archive'});
  // Git's tar treats a drive colon in -f as a remote host. Both arguments are
  // siblings beneath the disposable fixture root, so use local relative paths.
  execFileSync('tar.exe',['-xf',path.basename(archivePath),'-C',path.basename(target)],{env,cwd:path.dirname(target),windowsHide:true,stdio:'pipe'});
  const files=execFileSync('git',['-C',source,'ls-tree','-r','--name-only','-z',revision,'app','scripts','package.json'],{env,windowsHide:true,encoding:'utf8'}).split('\0').filter(Boolean);
  return {revision,files};
}
async function copyCore(source,target,files,records,origin) {
  for(const name of files) {
    const file=path.join(source,name);assert.ok((await lstat(file)).isFile());
    const bytes=await checkedSource(file,records);records.at(-1).gitSource=`${origin}:${name}`;await put(path.join(target,name),bytes);
  }
}
async function buildSelection(core,release,count,port,data,records) {
  const {starterValues,starterJSON,starterGameDefaults,starterDefinitions}=await import(pathToFileURL(path.join(core,'app/open-starter-data.mjs')));
  const {DATASET_CONTRACT,DATASET_OVERLAY_ORDER,datasetCapabilities,datasetEnvironment,datasetDigest,datasetRuleContractHash,datasetRuleTextContract,encodeDatasetValue}=await import(pathToFileURL(path.join(core,'app/datasets.mjs')));
  const defs=structuredClone(starterDefinitions);defs.challenges={Extra:{}};
  for(let i=0;i<count;i++)defs.challenges.Extra[`Fixture ${String(i).padStart(5,'0')}`]={PickerId:`rs3:task:fixture:${String(i).padStart(5,'0')}`,Chunks:['100'],Description:'Independently authored synthetic acceptance task.'};
  const inputs=structuredClone(starterJSON);
  // The packed duo contract enables the legacy topology telemetry, while the
  // bundled independent starter normally disables it. Author its empty counts.
  inputs['app/data/cache-walkability.2026-10-07.v1.json'].summary={doors:0,conditionalMorphs:0};
  inputs['app/open-starter-definitions.json']=defs;inputs['app/open-starter-task-map.json']={};
  inputs['app/data/legacy-task-history.json']={};
  const definitionBytes=encode(defs),taskBytes=encode({});
  inputs['app/data/original-data.2026-10-13.v1.json']={schemaVersion:1,version:'fixture-1',definitions:{path:'app/open-starter-definitions.json',sha256:sha(definitionBytes)},taskMap:{path:'app/open-starter-task-map.json',sha256:sha(taskBytes)}};
  const environment=datasetEnvironment({RS3_RESOURCE_CONTENTS:'retained',RS3_ARCHAEOLOGY_CONTENTS:'retained',RS3_CACHE_SHOP_CONTENTS:'0'}),capabilities=datasetCapabilities(environment);
  const values=structuredClone(starterValues),keys=Object.keys(values),textKeys=['app/core/rules.mjs#rulePresentation'],contractKeys=['app/core/rules.mjs#ruleContract'];
  const ruleContractHash=datasetRuleContractHash(values,contractKeys,{'app/data/original-rules-ui.2026-10-08.v1.json':datasetRuleTextContract(inputs['app/data/original-rules-ui.2026-10-08.v1.json'])});
  const packs=path.join(release,'packs'),version='1.0.0';
  const files=Object.entries(inputs).map(([name,value])=>({path:name,bytes:encode(value).length,sha256:sha(encode(value)),kind:'input'}));
  const evidence=Buffer.from('// Independently authored synthetic acceptance evidence.\n');
  files.push({path:'evidence/fixture.mjs',bytes:evidence.length,sha256:sha(evidence),kind:'evidence'});
  const digest=datasetDigest(files,capabilities),choices={};
  for(const [kind,id] of [['data','duo-data'],['rules-text','duo-rules-text']]) {
    const root=path.join(packs,id,version),records=[];
    for(const row of files.filter(row=>(row.path.includes('original-rules-ui.')?'rules-text':'data')===kind)) {await put(path.join(root,row.path),row.kind==='evidence'?evidence:encode(inputs[row.path]));records.push(row);}
    const selectedValues=Object.fromEntries(Object.entries(values).filter(([key])=>textKeys.includes(key)===(kind==='rules-text')));
    for(const [name,value,type] of [['indexes/values.json',{schemaVersion:1,values:encodeDatasetValue(selectedValues)},'generated'],['provenance.json',{schemaVersion:1,source:'independently-authored-fixture'},'provenance']]) {const bytes=encode(value);await put(path.join(root,name),bytes);records.push({path:name,bytes:bytes.length,sha256:sha(bytes),kind:type});}
    const manifest={schemaVersion:1,id,kind,version,requires:DATASET_CONTRACT,distribution:'private-local',ruleContractHash,...(kind==='data'?{datasetDigest:digest,capabilities,overlayOrder:DATASET_OVERLAY_ORDER,environment}:{}),catalogues:{values:'indexes/values.json'},provenance:'provenance.json',files:records};
    await put(path.join(root,'pack.json'),manifest);choices[kind==='data'?'data':'rulesText']={id,version,sha256:sha(encode(manifest))};
  }
  const artManifest={schemaVersion:1,id:'duo-art',kind:'art',version,distribution:'private-local',files:[],components:{}};
  await put(path.join(packs,'duo-art',version,'pack.json'),artManifest);choices.art={id:'duo-art',version,sha256:sha(encode(artManifest))};
  await put(path.join(packs,'selection.json'),{schemaVersion:1,...choices});
  const profile={schemaVersion:1,datasetId:'duo-legacy',datasetDigest:digest,ruleContractHash,catalogue:{inputs:Object.keys(inputs),sourceInputs:['evidence/fixture.mjs'],valueKeys:keys.filter(key=>!textKeys.includes(key)),ruleTextValueKeys:textKeys,ruleContractValueKeys:contractKeys},gameDefaults:{members:starterGameDefaults.members,masterLabel:starterGameDefaults.masterLabel}};
  await put(path.join(release,'profile.json'),profile);
  const addonFiles=[];
  for(const [name,value] of [['changelog.json',{schemaVersion:1,entries:[]}],['roadmap.json',{schemaVersion:1,updated:'2026-01-01',themes:[]}]]) {const bytes=encode(value);await put(path.join(release,'addon/app/data',name),bytes);addonFiles.push({path:`app/data/${name}`,sha256:sha(bytes)});}
  await put(path.join(release,'addon/addon.json'),{schemaVersion:1,features:{projectUpdates:true},files:addonFiles});
  const descriptor={datasetId:'duo-legacy',datasetContractVersion:1,digest};
  const config={schemaVersion:1,coreRoot:core,dataDir:data,nodePath:process.execPath,host:'127.0.0.1',port,loopbackPort:null,publicOriginFile:path.join(path.dirname(data),'public-origin'),packsDir:packs,selection:await pin(path.join(packs,'selection.json')),packs:Object.fromEntries(await Promise.all(Object.keys(choices).map(async kind=>[kind,await pin(path.join(packs,choices[kind].id,version,'pack.json'))]))),profile:await pin(path.join(release,'profile.json')),addons:await pin(path.join(release,'addon/addon.json')),runtimeOptions:{taskWorkerMode:'process',workerIdleMs:180000,backupDays:1,historyEntries:60}};
  await put(path.join(release,'config.json'),config);await put(path.join(release,'companion.json'),{syntheticReceipt:true});
  await put(path.join(release,'pointer.json'),{schemaVersion:2,releaseId:path.basename(release),config:await pin(path.join(release,'config.json'))});
  return {...descriptor,bindingSha256:sha(binding(descriptor))};
}

export async function prepare(options) {
  const root=path.resolve(options['work-root']);assert.ok(path.isAbsolute(options['work-root']));
  assert.ok(!/\.local[\\/]duo(?:[\\/]|$)/i.test(root));assert.ok(!await exists(root),'Use an absent disposable work root.');
  await mkdir(root,{recursive:true});const temporaryRoot=path.join(root,'tmp');await mkdir(temporaryRoot);
  const childEnvironment=temporaryEnvironment(temporaryRoot);
  const records=[],kit=path.join(root,'kit'),operator=path.join(kit,'operator'),tools=path.join(kit,'tools'),overrideTools=path.join(root,'override-tools'),data=path.join(root,'local/data');
  try {
  await mkdir(data,{recursive:true});await mkdir(operator,{recursive:true});await mkdir(tools,{recursive:true});
  const port=await freePort(),old=path.join(kit,'releases/A'),next=path.join(kit,'releases/B');
  const sourceCore=path.join(root,'source-core'),sourceRoot=path.resolve(options['core-root']);
  const {revision,files}=await exportCore(sourceRoot,options['core-ref']??'d2afe6e',sourceCore,records,childEnvironment);
  for(const release of [old,next])await copyCore(sourceCore,path.join(release,'core'),files,records,`${sourceRoot}@${revision}`);
  for(const name of ['Operator-Common.ps1','Managed-ReleaseV2.ps1','ReleaseV2-Common.ps1','Start-Core.ps1','Stop-Core.ps1']) {
    let source=path.join(options['operator-dir'],name);
    if(!await exists(source)&&options['support-dir'])source=path.join(options['support-dir'],name);
    await put(path.join(operator,name),await checkedSource(source,records));
  }
  for(const name of ['release-pack-check.mjs','release-identity.mjs']) {
    let source=path.join(options['checker-dir'],name);
    if(name==='release-identity.mjs'&&!await exists(source)&&options['support-dir'])source=path.join(options['support-dir'],name);
    await put(path.join(overrideTools,name),await checkedSource(source,records));
    assert.ok(options['support-dir'],'Provide canonical original checker support directory.');
    await put(path.join(tools,name),await checkedSource(path.join(options['support-dir'],name),records));
  }
  const stub=`import {appendFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');await appendFile(path.join(root,'fixture-stubs.jsonl'),JSON.stringify({synthetic:true,tool:path.basename(process.argv[1]),args:process.argv.slice(2),at:new Date().toISOString()})+'\\n');\n`;
  await put(path.join(tools,'release-v2.mjs'),stub+`if(process.argv[2]!=='assert-identity')throw Error('Fixture must never launch gates');\n`);
  await put(path.join(tools,'verify-install.mjs'),stub);
  await put(path.join(root,'local/public-origin'),'https://fixture.invalid');
  const count=Number(options.rows??20000);assert.ok(Number.isInteger(count)&&count>=20000&&count<=30000);
  const a=await buildSelection(path.join(old,'core'),old,count,port,data,records),b=await buildSelection(path.join(next,'core'),next,count+9,port,data,records);
  const additions=Array.from({length:9},(_,j)=>{const n=String(count+j).padStart(5,'0'),target=`rs3:task:fixture:${n}`;return [{key:target,target},{key:`rs3:Extra:Fixture%20${n}`,target}];}).flat();
  const transition={schemaVersion:2,old:a,new:b,oldConfig:await pin(path.join(old,'config.json')),newConfig:await pin(path.join(next,'config.json')),oldBindingBase64:binding(a).toString('base64'),newBindingBase64:binding(b).toString('base64'),savedIdentityAdditions:additions};
  await put(path.join(next,'pack-transition.json'),transition);await put(path.join(root,'current.json'),await readFile(path.join(old,'pointer.json')));await put(data+'.dataset.json',binding(a));
  await put(path.join(data,'access-token'),randomBytes(32).toString('base64url'));
  const fixture={schemaVersion:1,synthetic:true,root,temporaryRoot,kit,old,next,data,operator,tools,overrideTools,port,revision,rows:count,historyCommands:280,declaredAdditions:18,actual:['Managed-ReleaseV2.ps1 entrypoint','Operator-Common.ps1 config/pins/locks/owned processes/readiness','ReleaseV2-Common.ps1 handover/journal/binding/pointer','original checker negative control and SHA-pinned detached fixed release-pack-check.mjs','frozen d2afe6e core/server/store/identity/task worker'],stubs:['release-v2.mjs assert-identity only (no gates)','verify-install.mjs install receipt verification only'],dataset:'Independently authored bundled starter catalogues with synthetic Extra definitions; no live save input.'};
  await put(path.join(root,'fixture.json'),fixture);
  return fixture;
  } finally { await put(path.join(root,'acceptance-sources.json'),records); }
}

export async function seed(f) {
  const config=await json(path.join(f.old,'config.json'));
  const script=path.join(f.root,'seed.mjs');
  await put(script,`import {writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';const {createGroupState,applyValidatedCommand,validateState,exportBackup,importBackup}=await import(pathToFileURL(${JSON.stringify(path.join(config.coreRoot,'app/core/state.mjs'))}));let s=createGroupState([{id:'explorer-1',name:'Explorer 1',unlocked:['100']},{id:'explorer-2',name:'Explorer 2',unlocked:['116']}]);for(let i=0;i<280;i++)s=applyValidatedCommand(s,{type:'set-note',memberId:'explorer-1',chunkId:'100',note:'Synthetic progress '+i},{expectedRevision:s.revision,world:{chunks:new Map([['100',{}],['116',{}]])},now:'2026-01-01T00:00:00.000Z'});s.tasks=Array.from({length:${f.rows}},(_,i)=>({id:'rs3:task:fixture:'+String(i).padStart(5,'0'),category:'Extra',label:'Fixture '+String(i).padStart(5,'0')}));s=validateState(s);await writeFile(${JSON.stringify(path.join(f.data,'state.json'))},JSON.stringify(exportBackup(s)));const checked=importBackup(JSON.stringify(exportBackup(s)));if(checked.tasks.length!==s.tasks.length||checked.history.length!==280)throw Error('Synthetic seed backup roundtrip failed');console.log(JSON.stringify({passed:true,rows:checked.tasks.length,history:checked.history.length,format:'rs3-chunk-picker'}));\n`);
  const temporaryRoot=path.join(f.root,'tmp');await mkdir(temporaryRoot,{recursive:true});
  const env={...temporaryEnvironment(temporaryRoot),RS3_DATASET:'duo-legacy',RS3_PACKS_DIR:config.packsDir,RS3_PACK_SELECTION:config.selection.path,RS3_DATASET_PROFILE:config.profile.path,RS3_DATASET_PROFILE_SHA256:config.profile.sha256};
  const result=await invoke(process.execPath,['--max-old-space-size=512',script],env,path.join(f.root,'seed.log'));assert.equal(result.code,0,result.output);
}
export async function verifyTemporaryEnvironment(f) {
  const temporaryRoot=path.join(f.root,'tmp');await mkdir(temporaryRoot,{recursive:true});
  const identity=await pin(path.join(f.overrideTools??f.tools,'release-identity.mjs'));
  const script=path.join(f.root,'temporary-environment-check.mjs'),wrapper=path.join(f.root,'temporary-environment-check.ps1');
  await put(script,`import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';const expected=path.resolve(process.argv[2]);const same=value=>typeof value==='string'&&path.resolve(value)===expected;const inherited=[os.tmpdir(),process.env.TEMP,process.env.TMP,process.env.TMPDIR].every(same);const {sanitizeExecutionEnvironment}=await import(pathToFileURL(process.argv[3]));const env=sanitizeExecutionEnvironment(process.env);const sanitized=[env.TEMP,env.TMP,env.TMPDIR].every(same);const probe=spawnSync(process.execPath,['--input-type=module','-e',"import os from 'node:os';import path from 'node:path';console.log(JSON.stringify({contained:[os.tmpdir(),process.env.TEMP,process.env.TMP,process.env.TMPDIR].every(p=>typeof p==='string'&&path.resolve(p)===path.resolve(process.argv[1]))}));",expected],{env,windowsHide:true,encoding:'utf8'});const descendant=probe.status===0&&JSON.parse(probe.stdout).contained;const report={powershellNativeChildContained:inherited,sanitizedEnvironmentContained:sanitized,probeDescendantContained:descendant};console.log(JSON.stringify(report));if(!Object.values(report).every(Boolean))process.exitCode=1;\n`);
  await put(wrapper,`$ErrorActionPreference='Stop'\n& ${ps(process.execPath)} ${ps(script)} ${ps(temporaryRoot)} ${ps(identity.path)}\nexit $LASTEXITCODE\n`);
  const result=await invoke('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper],temporaryEnvironment(temporaryRoot),path.join(f.root,'temporary-environment.log'));
  assert.equal(result.code,0,'Scoped PowerShell/Node/checker temporary-environment validation failed');
  const evidence=JSON.parse(result.output);assert.ok(Object.values(evidence).every(value=>value===true));
  await put(path.join(f.root,'temporary-environment-sources.json'),[{...identity,readUtc:new Date().toISOString()}]);return evidence;
}
async function api(f,route) {
  const token=(await readFile(path.join(f.data,'access-token'),'utf8')).trim();
  const r=await fetch(`http://127.0.0.1:${f.port}${route}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,route);return r.json();
}
async function ready(f,id) {
  assert.equal((await json(path.join(f.root,'current.json'))).releaseId,id);
  assert.equal(sha(await readFile(f.data+'.dataset.json')),(await json(path.join(f.next,'pack-transition.json')))[id==='A'?'old':'new'].bindingSha256);
  assert.ok(!await exists(path.join(f.root,'local/picker-paused')),'Readiness must clear pause');
  assert.equal((await api(f,'/api/health')).ready,true);
  const state=(await api(f,'/api/backup')).state;assert.ok(state.tasks.length>=f.rows);assert.ok(state.history.length>=280);
  const tasks=await api(f,'/api/tasks?view=play-v1&memberId=explorer-1');assert.ok(Array.isArray(tasks.tasks));
  return state;
}
function preservation(a,b) {
  assert.deepEqual(b.members,a.members,'Saved member progress changed');assert.deepEqual(b.rules,a.rules,'Rules changed');
  assert.deepEqual(b.history.slice(0,a.history.length),a.history,'History prefix changed');
  assert.ok(b.history.slice(a.history.length).every(e=>e.type==='catalogue-refresh'));
  const ids=new Set(b.tasks.map(t=>t.id));assert.ok(a.tasks.every(t=>ids.has(t.id)),'A saved task was dropped');
}
export async function run(f,{smoke=false}={}) {
  assert.equal(process.platform,'win32');
  const temporaryRoot=path.join(f.root,'tmp');await mkdir(temporaryRoot,{recursive:true});
  const childEnvironment=temporaryEnvironment(temporaryRoot);
  assert.ok(await portIsFree(f.port),'Prepared fixture port was claimed; no child was started.');
  const harness=await pin(fileURLToPath(import.meta.url));
  await put(path.join(f.root,'acceptance-run-sources.json'),[{...harness,readUtc:new Date().toISOString()}]);
  const temporaryEvidence=await verifyTemporaryEnvironment(f);
  await seed(f);
  const powershell='powershell.exe',managed=path.join(f.operator,'Managed-ReleaseV2.ps1');
  const call=async(name,args)=>{const r=await invoke(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',...args],childEnvironment,path.join(f.root,name+'.log'));return r;};
  const checker=await pin(path.join(f.overrideTools??f.tools,'release-pack-check.mjs')),identity=await pin(path.join(f.overrideTools??f.tools,'release-identity.mjs'));
  const originalChecker=await pin(path.join(f.tools,'release-pack-check.mjs'));
  const handover=(target,rollback=false,override=true)=>[managed,'-CurrentRelease',path.join(f.root,'current.json'),'-CandidatePointer',path.join(target,'pointer.json'),'-CompanionRoot',f.kit,'-Receipt',path.join(target,'companion.json'),'-ReleaseRoot',target,'-TimeoutSeconds','60',...(rollback?['-Rollback']:[]),...(override?['-PackCheckTool',checker.path,'-PackCheckSha256',checker.sha256,'-PackCheckIdentitySha256',identity.sha256]:[])];
  const results=[];let started=false,report;
  try {
    assert.ok(await portIsFree(f.port),'Fixture port was claimed during seeding; no server was started.');
    const start=await call('start-A',[path.join(f.operator,'Start-Core.ps1'),'-Config',path.join(f.old,'config.json'),'-TimeoutSeconds','60']);started=true;assert.equal(start.code,0,start.output);
    let state=await ready(f,'A'),baseline=state;
    if(smoke)results.push({operation:'smoke-start-A',exitCode:start.code,startedAt:start.startedAt,completedAt:start.completedAt,wallSeconds:start.wallSeconds,authenticatedReadiness:true,taskRows:state.tasks.length,historyEvents:state.history.length});
    if(!smoke) {
    const transitionFile=path.join(f.next,'pack-transition.json'),original=await readFile(transitionFile),bad=await json(transitionFile);bad.savedIdentityAdditions.pop();await put(transitionFile,bad);
    const refusal=await call('refused-forward',handover(f.next));assert.notEqual(refusal.code,0,'Deliberate incompatibility must refuse');
    assert.match(refusal.output,/Managed release refused, previous release restored/);
    const refusalResults=await Promise.all((await readdir(path.join(f.kit,'.local'))).filter(n=>n.endsWith('.result.json')).map(n=>json(path.join(f.kit,'.local',n))));
    assert.equal(refusalResults.length,1);assert.equal(refusalResults[0].storageChangesStarted,false);assert.equal(refusalResults[0].previousReleaseRestored,true);assert.equal(refusalResults[0].refused,true);assert.equal(refusalResults[0].phase,'pack-check');
    const afterRefusal=await ready(f,'A');preservation(state,afterRefusal);results.push({operation:'refused-forward',exitCode:refusal.code,startedAt:refusal.startedAt,completedAt:refusal.completedAt,wallSeconds:refusal.wallSeconds,...refusalResults[0],authenticatedReadiness:true,pauseCleared:true});
    await put(transitionFile,original);
    for(const [name,target,id,rollback] of [['forward',f.next,'B',false],['rollback',f.old,'A',true],['patched-reforward',f.next,'B',false]]) {
      if(name==='patched-reforward') {
        const before=new Set((await readdir(path.join(f.kit,'.local'))).filter(n=>n.endsWith('.result.json')));
        const negative=await call('baseline-reforward-refusal',handover(f.next,false,false));
        assert.notEqual(negative.code,0,'Original checker must reproduce real managed re-forward refusal');assert.match(negative.output,/Managed release refused, previous release restored/);
        const added=(await readdir(path.join(f.kit,'.local'))).filter(n=>n.endsWith('.result.json')&&!before.has(n));assert.equal(added.length,1);
        const phase=await json(path.join(f.kit,'.local',added[0]));assert.equal(phase.phase,'pack-check');assert.equal(phase.storageChangesStarted,false);assert.equal(phase.previousReleaseRestored,true);
        const after=await ready(f,'A');preservation(state,after);state=after;
        results.push({operation:'baseline-reforward-refusal',exitCode:negative.code,startedAt:negative.startedAt,completedAt:negative.completedAt,wallSeconds:negative.wallSeconds,...phase,authenticatedReadiness:true,pauseCleared:true});
      }
      const r=await call(name,handover(target,rollback));assert.equal(r.code,0,r.output);
      const after=await ready(f,id);preservation(state,after);state=after;
      assert.equal((await json(path.join(f.root,'local/release-pack-transition.json'))).state,'ready');
      results.push({operation:name,exitCode:r.code,releaseId:id,startedAt:r.startedAt,completedAt:r.completedAt,wallSeconds:r.wallSeconds,authenticatedReadiness:true,pauseCleared:true,taskRows:state.tasks.length,historyEvents:state.history.length});
    }
    preservation(baseline,state);
    }
    assert.deepEqual(await pin(originalChecker.path),originalChecker,'Original kit checker changed');
    report={schemaVersion:1,passed:true,synthetic:true,mode:smoke?'startup-smoke':'managed-cycle',harness,temporaryRoot,temporaryEvidence,actual:smoke?['Start-Core.ps1 / Operator-Common.ps1 ownership and authenticated readiness','frozen d2afe6e core/server/store/task worker','Stop-Core.ps1 graceful owned cleanup']:f.actual,stubs:smoke?[]:f.stubs,originalKitChecker:originalChecker,externalFixedChecker:checker,externalIdentity:identity,rows:f.rows,declaredAdditions:f.declaredAdditions,results,completedAt:new Date().toISOString()};
  } finally {
    if(started) {
      const current=await json(path.join(f.root,'current.json'));
      const stop=await call('cleanup-stop',[path.join(f.operator,'Stop-Core.ps1'),'-Config',current.config.path,'-TimeoutSeconds','30']);
      await put(path.join(f.root,'cleanup.json'),{passed:stop.code===0,exitCode:stop.code,runtimeRemoved:!await exists(path.join(f.root,'local/server-runtime.json')),storeLockRemoved:!await exists(path.join(f.data,'store.lock'))});
      assert.equal(stop.code,0,'Fixture cleanup failed; inspect cleanup-stop.log');
      assert.ok(!await exists(path.join(f.root,'local/server-runtime.json')),'Fixture runtime record remains');
      assert.ok(!await exists(path.join(f.data,'store.lock')),'Fixture store lock remains');
      const inspect=path.join(f.root,'inspect-owned-processes.ps1');
      await put(inspect,`$ErrorActionPreference='Stop'\n$root=${ps(f.root)}\n$found=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0 })\nWrite-Output $found.Count\n`);
      const remaining=await call('cleanup-processes',[inspect]);assert.equal(remaining.code,0,remaining.output);assert.equal(Number(remaining.output.trim()),0,'A fixture node descendant remains');
    }
  }
  await put(path.join(f.root,'acceptance-result.json'),report);return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const o={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--run')o.run=true;else if(key==='--smoke'){o.smoke=true;o.run=true;}else if(key.startsWith('--')&&process.argv[i+1])o[key.slice(2)]=process.argv[++i];else throw Error('Invalid acceptance arguments');}
  try {const f=o.resume?await json(path.join(o.resume,'fixture.json')):await prepare(o);const result=o.run?await run(f,{smoke:o.smoke}):{prepared:true,root:f.root};console.log(JSON.stringify(result));}
  catch(e){console.error(e.stack);process.exitCode=1;}
}
