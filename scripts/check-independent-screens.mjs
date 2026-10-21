import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { createIndependentCandidate, cleanupIndependentCandidate, independentFreePort } from './check-independent-game.mjs';
import { openChrome, until, sleep, stopChild } from './perf/cdp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), datasetArgument = args.indexOf('--dataset');
const datasetId = datasetArgument < 0 ? 'open-starter' : args[datasetArgument + 1];
if (!['open-starter', 'open-f2p'].includes(datasetId)) throw new TypeError('Choose open-starter or open-f2p.');
const output = path.join(root, '.local', 'screens', datasetId);
const scratchBase = path.join(root, '.local', 'independent-game');
let server, browser, scratch, candidate;
let expectedViewerProbes = false;
let expectedTitle;
const report = { passed: false, dataset: datasetId, viewports: [], requests: [], lazySurfaces: [], errors: [], outsideRequests: [] };
const redact = route => route.replace(/\/join\/[^/?#]+/g, '/join/[redacted]');
async function closeDialogs() {
  await browser.evaluate(`document.querySelectorAll('dialog[open]').forEach(d => { const b=d.querySelector('.dialog-header .close-button'); b ? b.click() : d.close(); }); document.querySelectorAll('details[open]').forEach(d=>d.open=false); if(matchMedia('(max-width:720px)').matches)document.getElementById('phone-tab-map')?.click();`);
}
async function waitPage() {
  await until(() => browser.evaluate(`document.readyState==='complete' && !!document.getElementById('dataset-brand') && document.getElementById('dataset-brand').textContent===${JSON.stringify(expectedTitle)} && !document.getElementById('startup-error')?.offsetHeight && /possible tasks/.test(document.getElementById('task-engine-status')?.textContent||'') && !document.body.innerText.includes('Updating duo tasks')`), 45000);
  await browser.evaluate('document.fonts.ready'); await sleep(250);
}
try {
  const ownerFile = 'C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/locks/light.lock/owner';
  const owner = (await readFile(ownerFile, 'utf8')).replace(/^\uFEFF/, ''); assert.match(owner, /^light pid=\d+ /); process.kill(Number(owner.match(/pid=(\d+)/)[1]), 0);
  await mkdir(output, { recursive: true }); await mkdir(scratchBase, { recursive: true });
  scratch = await mkdtemp(path.join(scratchBase, 'screens-')); candidate = path.join(scratch, 'candidate');
  report.isolation = await createIndependentCandidate(candidate);
  const port = await independentFreePort(), origin = `http://127.0.0.1:${port}`;
  const entry = path.join(candidate, '.scratch', 'screen-server.mjs');
  await writeFile(entry, `import path from 'node:path';
import {createServer} from '../app/server.mjs';
let app; const stop=async()=>{await app?.close();process.exit(0)};
try {app=await createServer({dataDir:path.join(process.env.RS3_INDEPENDENT_ROOT,'.scratch',process.env.RS3_DATASET),host:'127.0.0.1',port:Number(process.env.RS3_INDEPENDENT_PORT),predictionPrewarm:false,loopbackPort:undefined,publicOrigin:undefined});await app.listen();process.send({ready:true,link:app.inviteUrl});process.on('message',m=>{if(m?.stop)void stop()});process.once('disconnect',()=>void stop());}catch(e){process.send({ready:false,message:e.message});await app?.close();process.exit(1)}\n`);
  server = fork(entry, [], { cwd: candidate, windowsHide: true, execArgv: ['--import', pathToFileURL(path.join(candidate, 'scripts/lib/independent-guard.mjs')).href],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_OPTIONS: '', RS3_DATASET: datasetId, RS3_TASK_WORKER_MODE: 'process',
      RS3_INDEPENDENT_ROOT: candidate, RS3_INDEPENDENT_ORIGIN: origin, RS3_INDEPENDENT_PORT: String(port), RS3_LOOPBACK_PORT: '', RS3_PUBLIC_ORIGIN: '',
      RS3_PACKS_DIR: path.join(candidate, '.scratch', 'packs'), RS3_PACK_SELECTION: path.join(candidate, '.scratch', 'packs', 'none.json'),
      RS3_MAP_ASSETS_DIR: path.join(candidate, '.scratch', 'no-art'), RS3_GAME_DATA_DIR: path.join(candidate, '.scratch', 'no-game-data') } });
  const ready = await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('Screen server startup timed out.')),60000);
    server.once('message',value=>{clearTimeout(timer);value.ready?resolve(value):reject(new Error('Screen server failed: '+value.message));});server.once('error',reject);server.once('exit',code=>{if(code)reject(new Error('Screen server exited.'));}); });
  let response = await fetch(ready.link, { redirect: 'manual' }); assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const api = async (route, body) => {
    const result = await fetch(origin+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(result.ok,`Screen preparation ${route} failed.`);return result.json();
  };
  const runtime = await api('/data/dataset-runtime.json');
  expectedTitle = runtime.dataset.title ?? runtime.gameDefaults.title ?? 'Grid challenge';
  assert.equal(runtime.dataset.id, datasetId);
  const definitions = await api('/api/definitions');
  const equipmentTaskIds = datasetId === 'open-f2p'
    ? Object.values(definitions.challenges).flatMap(category => Object.values(category))
      .map(row => row.PickerId).filter(id => id?.includes(':activity:obtain')) : [];
  const cells = Object.keys(definitions.chunks);
  const ownedCell = String(runtime.gameDefaults.startingCell ?? runtime.values['app/data/surface-grid.mjs#SURFACE_GRID'].startId);
  const selectedCell = Object.values(definitions.sections?.[ownedCell] ?? {}).flat().map(String)
    .find(id => cells.includes(id) && id !== ownedCell && Object.values(definitions.sections?.[id] ?? {}).flat().map(String).includes(ownedCell));
  assert.ok(cells.includes(ownedCell) && selectedCell, 'Provider start and reciprocal neighbour exist.');
  let state=(await api('/api/state')).state; const memberId=state.members[0].id;
  for (const command of [{type:'set-chunk',memberId,chunkId:ownedCell,status:'unlocked'},{type:'set-chunk',memberId,chunkId:selectedCell,status:'unlocked'},
    {type:'set-note',memberId,chunkId:ownedCell,note:'Our journey starts here.'}]) {
    state=(await api('/api/command',{expectedRevision:state.revision,command})).state;
  }
  const taskPrefix = datasetId === 'open-starter' ? 'rs3:task:open-starter:' : `${runtime.dataset.identityNamespace ?? 'rs3:open-f2p'}:activity:`;
  const task = (await api(`/api/tasks?memberId=${memberId}`)).tasks.find(row => row.id.startsWith(taskPrefix)
    && row.status === 'available' && !equipmentTaskIds.includes(row.id));
  assert.ok(task, 'An available dataset activity is rendered in this scenario.');
  state = (await api('/api/command',{expectedRevision:state.revision,command:{type:'complete-task',memberId,taskId:task.id,completed:true}})).state;
  report.scenario = { ownedCell, selectedCell, taskId: task.id };
  const viewer=await api('/api/invites',{label:'Independent viewer',viewer:true});
  browser=await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe',path.join(scratch,'chrome'));
  browser.listeners.add(message=>{
    if(message.method==='Fetch.requestPaused') {
      const request=message.params;const url=new URL(request.request.url);
      if(url.origin!==origin) {report.outsideRequests.push(url.origin);void browser.send('Fetch.failRequest',{requestId:request.requestId,errorReason:'BlockedByClient'});} else void browser.send('Fetch.continueRequest',{requestId:request.requestId});
    }
    if(message.method==='Network.responseReceived') {const value=message.params.response;if(value.url.startsWith(origin)){const route=redact(new URL(value.url).pathname);report.requests.push({route,status:value.status,...(expectedViewerProbes&&value.status===403&&['/api/command','/api/restore','/api/invites'].includes(route)?{expectedViewerRefusal:true}:{})});}}
    if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails.text);
    if(message.method==='Log.entryAdded'&&message.params.entry.level==='error'&&!(expectedViewerProbes&&message.params.entry.text.includes('403')))report.errors.push(redact(message.params.entry.text));
  });
  await browser.send('Log.enable'); await browser.send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]});
  await browser.send('Page.navigate',{url:ready.link});await waitPage();
  assert.equal(await browser.evaluate(`${JSON.stringify(runtime.gameDefaults.tasks.map(row => row.label))}.every(label => document.body.innerText.includes(label))`),true,'Seeded manual goals must be visible in ordinary play');
  for (const viewport of [{name:'desktop',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true}]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1});await closeDialogs();await sleep(350);
    const layout=await browser.evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,heading:document.title,privateNames:/Player 1|Player 2/.test(document.body.innerText),mapWidth:document.getElementById('map-stage').getBoundingClientRect().width,mapHeight:document.getElementById('map-stage').getBoundingClientRect().height})`);
    assert.equal(layout.overflow,false,'Horizontal overflow');assert.equal(layout.privateNames,false,'Private names in independent UI');
    assert.ok(layout.mapHeight>300,'The grid map must remain visible');
    const name=`${datasetId}-${viewport.name}-${viewport.width}.png`,capture=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(output,name),Buffer.from(capture.data,'base64'));await cp(path.join(output,name),path.join(root,'docs/research',name));
    report.viewports.push({...viewport,...layout,file:`docs/research/${name}`});
    if (datasetId === 'open-f2p') {
      assert.ok(equipmentTaskIds.length, 'The provider declares independently sourced equipment tasks.');
      const equipmentIds = equipmentTaskIds;
      await browser.evaluate(`(()=>{document.getElementById('phone-tab-tasks')?.click();const filter=document.getElementById('task-filter');filter.value='Bronze hatchet';filter.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(() => browser.evaluate(`Array.from(document.querySelectorAll('#active-tasks .task-row')).some(row=>${JSON.stringify(equipmentIds)}.includes(row.dataset.taskId)&&/Bronze hatchet/i.test(row.innerText))`), 10000);
      await browser.evaluate(`(()=>{const row=Array.from(document.querySelectorAll('#active-tasks .task-row')).find(row=>${JSON.stringify(equipmentIds)}.includes(row.dataset.taskId)&&/Bronze hatchet/i.test(row.innerText));row.scrollIntoView({block:'center'});})()`);
      await sleep(250);
      const equipmentLayout = await browser.evaluate(`(()=>{const row=Array.from(document.querySelectorAll('#active-tasks .task-row')).find(row=>${JSON.stringify(equipmentIds)}.includes(row.dataset.taskId)&&/Bronze hatchet/i.test(row.innerText));const box=row.getBoundingClientRect();return {taskId:row.dataset.taskId,label:row.querySelector('.task-label-button')?.textContent,visible:box.top>=0&&box.bottom<=innerHeight&&box.width>0,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
      assert.equal(equipmentLayout.visible,true,'Equipment acquisition row is visible in the screenshot viewport');
      assert.equal(equipmentLayout.overflow,false,'Equipment task list has no horizontal overflow');
      const equipmentName=`${datasetId}-equipment-${viewport.name}-${viewport.width}.png`;
      const equipmentCapture=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(path.join(output,equipmentName),Buffer.from(equipmentCapture.data,'base64'));
      report.viewports.push({...viewport,...equipmentLayout,surface:'equipment',file:`.local/screens/${datasetId}/${equipmentName}`});
      await browser.evaluate(`(()=>{const filter=document.getElementById('task-filter');filter.value='';filter.dispatchEvent(new Event('input',{bubbles:true}));scrollTo(0,0);})()`);
    }
  }
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(const id of ['search-open','completed-open','custom-task-open','journal-open','history-open','settings-open','backup-open','invites-open','map-sources-open']) {
    await closeDialogs();const exists=await browser.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e||e.hidden||e.disabled)return false;e.click();return true})()`);
    if(!exists)continue; await sleep(400);await browser.evaluate('document.fonts.ready');report.lazySurfaces.push(id);
    if (id === 'settings-open' && runtime.dataset.coverage) {
      await browser.evaluate(`(()=>{const e=document.querySelector('input[aria-label="Advanced"]');if(e&&!e.checked)e.click()})()`);
      await until(() => browser.evaluate(`Array.from(document.querySelectorAll('.settings-navigation .art-status')).some(e => !e.hidden && e.textContent.includes('Coverage:') && e.textContent.includes('Omitted:'))`), 10000);
      report.advancedCoverageVisible = true;
    }
  }
  await closeDialogs();await browser.send('Page.navigate',{url:viewer.link});await waitPage();
  const viewerControls=await browser.evaluate(`(async()=>({readOnly:(await(await fetch('/api/session')).json()).readOnly,visibleWrites:['custom-task-open','backup-open','invites-open','undo','roll-one','roll-two','pick-for-me'].filter(id=>{const e=document.getElementById(id);return e&&!e.hidden&&!e.disabled&&e.getClientRects().length>0}),enabledGoalWrites:[...document.querySelectorAll('.task-row input[type=checkbox]')].filter(e=>!e.disabled&&e.getClientRects().length>0).length}))()`);
  assert.equal(viewerControls.readOnly,true);
  assert.equal(viewerControls.enabledGoalWrites,0);
  assert.deepEqual(viewerControls.visibleWrites,[]);report.viewer=viewerControls;
  expectedViewerProbes=true;
  report.viewerWriteStatuses=await browser.evaluate(`(async()=>{const state=(await(await fetch('/api/state')).json()).state;const statuses=[];for(const route of ['/api/command','/api/restore','/api/invites']){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:state.revision,command:{type:'set-note',memberId:state.members[0].id,chunkId:${JSON.stringify(ownedCell)},note:'Forbidden'}})});statuses.push(r.status)}return statuses})()`);
  assert.deepEqual(report.viewerWriteStatuses,[403,403,403]);
  await sleep(250);
  assert.deepEqual(report.outsideRequests,[]);assert.deepEqual(report.requests.filter(r=>r.status>=400&&!r.expectedViewerRefusal),[]);assert.deepEqual(report.errors,[]);
  const audit=(await readFile(path.join(candidate,'.scratch/audit.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(audit.filter(r=>r.kind==='denied'),[]);report.guardInstallations=audit.filter(r=>r.kind==='guard-installed').length;
  report.passed=true;
} catch(error) {report.failure=redact(error.message);process.exitCode=1;}
finally {
  try {
    await browser?.close();
    if(server?.connected){server.send({stop:true});await Promise.race([new Promise(resolve=>server.once('exit',resolve)),sleep(10000)]);}
    await stopChild(server);if(candidate)await cleanupIndependentCandidate(candidate);
    if(scratch) {
      const resolved=path.resolve(scratch);
      if(path.dirname(resolved)!==path.resolve(scratchBase))throw new Error('Screen scratch cleanup containment failed.');
      await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:250});
    }
    report.disposableCopyDeleted=true;
  } catch(error) {
    report.cleanupFailure=redact(error.message);report.passed=false;process.exitCode=1;
  }
  await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:report.passed,failure:report.failure,screens:report.viewports.map(v=>v.file),requests:report.requests.length,lazySurfaces:report.lazySurfaces,viewerWriteStatuses:report.viewerWriteStatuses})+'\n');
}
