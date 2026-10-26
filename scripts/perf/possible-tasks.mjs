// Public synthetic Possible Tasks observer. Node 24, Chromium, no npm packages.
// node scripts/perf/possible-tasks.mjs --companion DIR --baseline COMMIT --runs 7 --out REPORT.json
// Generates only disposable synthetic saves. Baseline/candidate run in alternating
// order, fresh production startServer and browser per observation, process workers,
// 3 GiB old-space and two CPUs (launch this script with taskset -c 0,1 on Linux).
// Instrumentation is applied identically to disposable source copies, never app/.
import { fork, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { openChrome, until } from './cdp.mjs';
const here = fileURLToPath(import.meta.url);
const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const root = path.resolve(option('root', '.'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));

async function instrument(tree) {
  async function edit(file, before, after) {
    const full = path.join(tree, file), text = await readFile(full, 'utf8');
    if (!text.includes(before)) throw new Error(`Instrumentation anchor missing: ${file}: ${before}`);
    await writeFile(full, text.replace(before, after));
  }
  await edit('app/tasks/worker.mjs', 'function chunkPlanningFor(snapshot, chunkId) {', 'function chunkPlanningFor(snapshot, chunkId, timingMs) {');
  await edit('app/tasks/worker.mjs', 'snapshot.planningIndex ??= buildChunkPlanningIndex(definitions, snapshot.baseline, workerData.world)', "snapshot.planningIndex ??= timed(timingMs, 'planningIndexMs', () => buildChunkPlanningIndex(definitions, snapshot.baseline, workerData.world))");
  await edit('app/tasks/worker.mjs', "type === 'chunk-planning' ? chunkPlanningFor(snapshot, chunkId)", "type === 'chunk-planning' ? timed(timingMs, 'planningProjectionMs', () => chunkPlanningFor(snapshot, chunkId, timingMs))");
  await edit('app/tasks/scheduler.mjs', 'active = entry; entry.startedAt', "globalThis.__planningProbe?.({ event: 'dispatch', lane: workerFactory.name === 'nativePlanningWorker' ? 'planning' : includeReadyCatalogue ? 'foreground' : duoResults ? 'duo' : shareSnapshots ? 'prediction' : 'death', type: entry.type, memberId: entry.memberId, chunkId: entry.chunkId, warm: !!entry.warm, queueMs: idleClock.now() - entry.queuedAt });\n    active = entry; entry.startedAt");
  await edit('app/tasks/scheduler.mjs', "entry = { key, input, state, stateInput, memberId, type, chunkId, chunkIds, resultView, duoSidebarProjection, revision: state.revision, queuedAt: idleClock.now(), waiters: new Set() };", "globalThis.__planningProbe?.({ event: 'admit', type, memberId, chunkId, activeType: active?.type, activeWarm: active?.warm, activePurpose: active?.purpose, activeMember: active?.memberId, queueDepth: queue.length, warmDepth: warmQueue.length });\n        entry = { key, input, state, stateInput, memberId, type, chunkId, chunkIds, resultView, duoSidebarProjection, revision: state.revision, queuedAt: idleClock.now(), waiters: new Set() };");
  await edit('app/server.mjs', 'return jsonBytes(request, response, status, Buffer.from(JSON.stringify(value)), headers);', "const t = performance.now(), bytes = Buffer.from(JSON.stringify(value));\n  if (value?.format === 'chunk-planning-v1') globalThis.__planningProbe?.({ event: 'serialize', chunkId: value.chunkId, bytes: bytes.length, ms: performance.now() - t });\n  return jsonBytes(request, response, status, bytes, headers);");
  const adapter = await readFile(path.join(tree, 'app/tasks/process-worker.mjs'), 'utf8');
  if (adapter.includes('probeImport, planning });')) await edit('app/tasks/process-worker.mjs',
    "this.#send({ kind: 'init', data, probeImport, planning });",
    "this.#send({ kind: 'init', data, probeImport, planning }); globalThis.__planningProbe?.({ event: 'worker-pid', pid: this.pid, planning });");
  // Bracket the settle await on the uncached planning path.
  await edit('app/web/screen-loading.mjs', "const request = (async () => {\n        await c.ensureForegroundSettled();", "const request = (async () => {\n        const t = performance.now(); await c.ensureForegroundSettled();\n        (globalThis.__planningClient ??= []).push({ event: 'foreground', ms: performance.now() - t });");
  await edit('app/web/screen-loading.mjs', 'return c.api(`/api/chunk-planning?memberId=${encodeURIComponent(requestedMember)}&chunkId=${encodeURIComponent(requestedChunk)}`);', 'const apiStart = performance.now(); const value = await c.api(`/api/chunk-planning?memberId=${encodeURIComponent(requestedMember)}&chunkId=${encodeURIComponent(requestedChunk)}`); (globalThis.__planningClient ??= []).push({ event: \'api\', ms: performance.now() - apiStart, cache: value.cache }); return value;');
  await edit('app/web/chunk-planning.mjs', "const result = await (context.ensurePlanningResult ? context.ensurePlanningResult(snapshot.chunkId) : ensureResult());", "const result = await (context.ensurePlanningResult ? context.ensurePlanningResult(snapshot.chunkId) : ensureResult());\n          const renderStart = performance.now();");
  await edit('app/web/chunk-planning.mjs', "body.replaceChildren(note('Tasks that use something in this chunk.'), build(result, index)); loaded = true;", "body.replaceChildren(note('Tasks that use something in this chunk.'), build(result, index)); loaded = true;\n          (globalThis.__planningClient ??= []).push({ event: 'render', ms: performance.now() - renderStart });");
}

async function child() {
  const companion = path.resolve(option('companion'));
  const receipt = JSON.parse(await readFile(path.join(companion, 'companion.json'), 'utf8'));
  for (const key of ['RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR']) delete process.env[key];
  Object.assign(process.env, { RS3_TASK_WORKER_MODE: 'process', RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(companion, receipt.profile.path), RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(companion, 'packs'), RS3_PACK_SELECTION: path.join(companion, 'selection.json') });
  const events = [];
  globalThis.__planningProbe = value => events.push({ at: performance.now(), ...value });
  const { createGroupState } = await import(pathToFileURL(path.join(root, 'app/core/state.mjs')));
  const { selectedDataset } = await import(pathToFileURL(path.join(root, 'app/dataset-runtime.mjs')));
  const { loadDatasetInputs } = await import(pathToFileURL(path.join(root, 'app/dataset-bootstrap.mjs')));
  let input = await loadDatasetInputs(selectedDataset);
  let definitions = JSON.parse(input.definitionBytes);
  const taskCount = Object.values(definitions.challenges).reduce((n,r)=>n+Object.keys(r).length,0);
  const areaIds = Object.keys(definitions.chunks).filter(id => !/^\d/.test(id)).slice(0, 3);
  const numeric = Object.keys(definitions.chunks).filter(id => /^[1-9]\d*$/.test(id)).sort();
  definitions = null; input = null; // Do not retain an extra catalogue in the server isolate.
  const owned = Math.min(200, Math.floor(numeric.length / 3));
  const offset = Math.floor(owned / 2);
  const state = createGroupState([{ id: 'explorer-1', name: 'Explorer 1', unlocked: numeric.slice(0, owned), selected: numeric.slice(owned * 2, owned * 2 + 2) }, { id: 'explorer-2', name: 'Explorer 2', unlocked: numeric.slice(offset, offset + owned), selected: numeric.slice(owned * 2 + 2, owned * 2 + 4) }]);
  const dir = await mkdtemp(path.join(tmpdir(), 'possible-tasks-save-'));
  const rows = [], responses = {}, clicks = [];
  let app, browser, timer, readDiagnostics;
  const stop = async () => { await browser?.close(); await app?.close(); process.exit(1); };
  process.once('disconnect', stop); process.once('SIGTERM', stop);
  let peakTreeRSS = 0, peakMainRSS = 0, peakPlanningRSS = 0;
  // Track native process workers without replacing their factory or transport.
  // This kernel exposes /proc/PID/status but not task/PID/children.
  const hosts = new Set();
  const childProcess = createRequire(import.meta.url)('node:child_process');
  const nativeFork = childProcess.fork;
  childProcess.fork = function(filename, ...args) {
    const host = nativeFork.call(this, filename, ...args);
    if (String(filename).endsWith('process-worker-host.mjs')) {
      hosts.add(host.pid); host.once('exit', () => hosts.delete(host.pid));
    }
    return host;
  };
  syncBuiltinESMExports();
  function sampleRSS() {
    const main = process.memoryUsage.rss();
    let total = main;
    for (const pid of hosts) {
      try { const rss = Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; total += rss; if (events.some(e => e.event === 'worker-pid' && e.pid === pid && e.planning)) peakPlanningRSS = Math.max(peakPlanningRSS, rss); }
      catch { /* An owned host can retire between reads. */ }
    }
    peakTreeRSS = Math.max(peakTreeRSS, total);
    peakMainRSS = Math.max(peakMainRSS, main);
  }
  try {
    timer = setInterval(sampleRSS, 50);
    const { startServer } = await import(pathToFileURL(path.join(root, 'app/server.mjs')));
    const started = performance.now();
    app = await startServer({ initialState: state, dataDir: path.join(dir, 'game'), host: '127.0.0.1', port: 0, loopbackPort: undefined, publicOrigin: undefined });
    const application = await app.ready; send({type:'progress',stage:'ready'});
    if (option('metadata') === 'only') {
      const parts = application.store.getStateJSONParts();
      const field = name => JSON.parse(parts[parts.indexOf(JSON.stringify(name)) + 2]);
      await send({type:'result',metadata:{definitionTasks:taskCount,installedTasks:field('tasks').length,
        members:field('members').map(member=>({id:member.id,unlocked:member.unlocked.length})),
        fullStateJSONBytes:parts.reduce((sum,part)=>sum+Buffer.byteLength(part),0)}});
      return;
    }
    const readyMs = performance.now() - started, url = new URL(app.inviteUrl);
    const auth = { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
    const api = async route => { const t = performance.now(); const response = await fetch(url.origin + route, { headers: { ...auth, 'Accept-Encoding': 'identity' } }); const text = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status} ${route}: ${text.slice(0, 150)}`); const p = performance.now(); const body = JSON.parse(text); return { body, bytes: Buffer.byteLength(text), totalMs: performance.now() - t, parseMs: performance.now() - p }; };
    readDiagnostics = async () => (await api('/api/diagnostics')).body;
    // Owned Chrome is deliberately outside server-tree RSS, reported separately.
    browser = await openChrome(option('chrome', '/usr/bin/chromium'), path.join(dir, 'chrome'), { extraArgs: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const evaluate = async expression => { const r = await browser.send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `performance.setResourceTimingBufferSize(10000); localStorage.setItem('rs3:task-view', JSON.stringify({groupView:${option('group', 'off') === 'on'}, showAll:false, showBlocked:false})); window.__planningClient=[]; window.__rs3Perf={enabled:true,events:[]};` });
    await browser.send('Page.navigate', { url: app.inviteUrl });
    await until(() => evaluate("!!document.querySelector('#group-view') && !!document.querySelector('#search-open') && !document.querySelector('#search-open').disabled"), 300000);
    const group = option('group', 'off') === 'on';
    await evaluate(`(() => { const n=document.querySelector('#group-view'); if(n.checked!==${group}){n.checked=${group};n.dispatchEvent(new Event('change'));} })()`);
    const settlement = option('settlement', 'settled');
    if (settlement === 'settled') {
      await until(async () => {
        if (await evaluate("window.__rs3Perf.events.some(e => e.name === '" + (group ? 'duo-tasks-shown' : 'tasks-shown') + "')")) return true;
        const diagnostics = await readDiagnostics();
        if (diagnostics.counts.expired || group && diagnostics.duoLane?.counts?.expired) throw new Error('Production foreground/peer calculation deadline expired before the planning click.');
        return false;
      }, 300000);
      // Wait for normal saved task loading; foreground wait is measured at each click.
      await until(async () => { const d=(await api('/api/diagnostics')).body; return !d.queue.active && !d.duoLane?.queue.active && d.counts?.completed > 0; }, 300000);
    } else if (settlement === 'early') {
      await until(() => evaluate("window.__rs3Perf.events.some(e => e.name === 'state-adopted')"), 300000);
    } else throw new Error('Use --settlement settled or early.');
    const cases = [state.members[0].unlocked[0], numeric[owned * 2], state.members[0].unlocked[Math.floor(owned / 2)], numeric.at(-1), ...areaIds];
    const viewedMembers = option('members', 'first') === 'all' ? state.members : state.members.slice(0, 1);
    for (const viewed of viewedMembers) {
      if (viewed !== state.members[0]) {
        await evaluate("document.querySelector('#chunk-content [data-tab=contents]')?.click()");
        await evaluate(`(() => { const n=document.querySelector('#member'); n.value=${JSON.stringify(viewed.id)}; n.dispatchEvent(new Event('change')); })()`);
        await until(() => evaluate(`window.__rs3Perf.events.some(e => e.name === '${group ? 'duo-tasks-shown' : 'tasks-shown'}' && e.memberId === ${JSON.stringify(viewed.id)})`), 300000);
        await until(async () => { const d=await readDiagnostics(); return !d.queue.active && !d.duoLane?.queue.active; }, 300000);
      }
    for (const chunkId of [viewed.unlocked[0], numeric[owned * 2]]) for (let occurrence=1; occurrence<=2; occurrence++) {
      await evaluate("document.querySelector('#chunk-content [data-tab=contents]')?.click()");
      await evaluate("document.querySelector('#search-open').click()");
      await until(() => evaluate("!!document.querySelector('dialog[open] input[type=search]')"), 300000);
      await evaluate(`(() => {const s=document.querySelector('dialog[open] input[type=search]'); s.value=${JSON.stringify(chunkId)};s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(() => evaluate("!!document.querySelector('dialog[open] .search-results:not([aria-busy]) .search-result button')"), 300000);
      await evaluate("document.querySelector('dialog[open] .search-result button').click()");
      await until(() => evaluate("!document.querySelector('dialog[open]')"), 300000);
      await until(() => evaluate("!!document.querySelector('#chunk-content [role=tab]')"), 300000);
      const e = events.length;
      await evaluate(`window.__planningClickResult = null; void (new Promise((resolve,reject)=>{const c=document.querySelector('#chunk-content'), t=performance.now();let last=t,mutations=0,seen=-1,stable=0;const o=new MutationObserver(()=>{last=performance.now();mutations++});o.observe(c,{subtree:true,childList:true,attributes:true,characterData:true});window.__planningClient=[];const tab=[...c.querySelectorAll('[role=tab]')].find(n=>n.textContent==='Tasks');tab.click();const f=()=>{stable=seen===mutations?stable+1:0;seen=mutations;if(c.querySelector('.task-filter-bar')&&stable>=2){o.disconnect();resolve({totalMs:performance.now()-t,mutations,client:window.__planningClient,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/chunk-planning')&&e.startTime>=t).map(e=>({duration:e.duration,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize,transferSize:e.transferSize}))})}else if(performance.now()-t>240000){o.disconnect();reject(Error('Click timeout'))}else requestAnimationFrame(f)};requestAnimationFrame(f)})).then(value => window.__planningClickResult = value, error => window.__planningClickResult = {error:error.message})`);
      await until(() => evaluate('window.__planningClickResult !== null'), 250000);
      const click = await evaluate('window.__planningClickResult');
      if (click.error) throw new Error(click.error);
      clicks.push({memberId:viewed.id,chunkId,occurrence,...click,events:events.slice(e)}); send({type:'progress',stage:`click ${chunkId}/${occurrence} ${Math.round(click.totalMs)} ms`});
    }
    }
    // HTTP measurements include both members, unlocked, locked and interior area IDs.
    for (const member of state.members) for (const chunkId of cases) for (let occurrence=1; occurrence<=2; occurrence++) {
      const e = events.length, before = (await api('/api/diagnostics')).body;
      const value = await api(`/api/chunk-planning?memberId=${member.id}&chunkId=${encodeURIComponent(chunkId)}`);
      const { cache, ...body } = value.body;
      responses[`${member.id}/${chunkId}/${occurrence}`] = hash(body);
      rows.push({ memberId: member.id, chunkId, unlocked: member.unlocked.includes(chunkId), occurrence, ...value, body: undefined, cache, events: events.slice(e), laneBefore: { prediction: before.predictionLane, foreground: { worker: before.worker, queue: before.queue } } });
    }
    sampleRSS();
    const finalDiagnostics = await readDiagnostics();
    await send({ type: 'result', readyMs, group, settlement, node:process.version, dataset:{ tasks:taskCount, members:state.members.length, unlocked:state.members.map(m=>m.unlocked.length), chunks:numeric.length, stateBytes:Buffer.byteLength(JSON.stringify(state)) }, rows, clicks, responses, peakTreeRSS, peakMainRSS, peakPlanningRSS, planningBaselines: finalDiagnostics.planningBaselines, baselineEncoding: finalDiagnostics.timingMs?.stages?.planningBaselineMs, maxMainRSS:process.resourceUsage().maxRSS*1024 });
  } catch(error) { await send({type:'partial',error:error.message,rows,clicks,events,peakTreeRSS,peakMainRSS,diagnostics:await readDiagnostics?.().catch(()=>undefined)}); if(browser) console.error((await browser.send('Runtime.evaluate',{expression:'document.querySelector("#chunk-content")?.outerHTML',returnByValue:true})).result?.value?.slice(0,5000)); throw error; } finally { clearInterval(timer); await browser?.close(); await app?.close(); await rm(dir, {recursive:true,force:true}); }
}

async function run(tree, group, companion) {
  return new Promise((resolve,reject)=>{
    const child = fork(here, ['--child','yes','--root',tree,'--group',group,'--companion',companion,'--settlement',option('settlement','settled'),'--chrome',option('chrome','/usr/bin/chromium'),'--metadata',option('metadata','no'),'--members',option('members','first')], { execArgv:['--max-old-space-size=3072'], stdio:['ignore','pipe','pipe','ipc'], env:{...process.env, NODE_OPTIONS:''} });
    let result, partial, stderr=''; child.stderr.on('data',c=>{stderr=(stderr+c).slice(-8000)}); child.stdout.resume();
    child.on('message',m=>{if(m.type==='result')result=m;else if(m.type==='partial')partial=m;else if(m.type==='progress')process.stdout.write(`${m.stage}\n`)});child.on('error',reject);child.on('exit',code=>code===0&&result?resolve(result):reject(Object.assign(Error(`Observer exited ${code}: ${stderr}`), {partial})));
  });
}
async function main() {
  if (!option('companion')) throw new Error('Pass --companion <public scale-dataset output>.');
  const companion=path.resolve(option('companion')), baseline=option('baseline','HEAD'), runs=Number(option('runs','7')), output=path.resolve(option('out','.local/possible-tasks/report.json'));
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 50) throw new Error('Use --runs 1 through 50.');
  await mkdir(path.join(root, '.local'), {recursive:true});
  const scratch=await mkdtemp(path.join(root,'.local/possible-tasks-trees-'));
  const trees={before:path.join(scratch,'before'),after:path.join(scratch,'after')};
  const receipt = JSON.parse(await readFile(path.join(companion, 'companion.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(path.join(companion, 'packs', receipt.packs.data.id, receipt.packs.data.version, 'provenance.json'), 'utf8'));
  if (provenance.synthetic !== true || provenance.generator !== 'scripts/perf/scale-dataset.mjs') throw new Error('Use a public synthetic scale-dataset companion.');
  const receiptFingerprint = hash(receipt);
  let report={schemaVersion:1,baseline,receiptFingerprint,settlement:option('settlement','settled'),method:'Alternating paired fresh production servers, process workers, 3 GiB heap; 50 ms sampled server process-tree RSS excludes Chrome; HTTP identity encoding; native Chromium click stable after two frames; identical temporary instrumentation.',runs:[], summaries:{}};
  if (option('resume') === 'yes') {
    const previous = JSON.parse(await readFile(output, 'utf8'));
    if (previous.baseline !== baseline || (previous.settlement ?? 'settled') !== option('settlement','settled') || previous.receiptFingerprint && previous.receiptFingerprint !== receiptFingerprint) throw new Error('Resume baseline or companion differs.');
    previous.excludedObserverFailures = [...previous.excludedObserverFailures ?? [], ...previous.failures ?? []];
    delete previous.failures; previous.receiptFingerprint = receiptFingerprint; report = previous;
  }
  try {
    for(const [label,tree] of Object.entries(trees)){
      await mkdir(tree,{recursive:true});
      if(label==='before') { await new Promise((resolve,reject)=>{const a=spawn('git',['archive',baseline,'app','scripts/lib','package.json'],{cwd:root});const b=spawn('tar',['-x','-C',tree]);a.stdout.pipe(b.stdin);a.on('error',reject);b.on('error',reject);b.on('exit',code=>code?reject(Error('Archive extraction failed')):resolve());}); }
      else { await cp(path.join(root,'app'),path.join(tree,'app'),{recursive:true});await cp(path.join(root,'scripts/lib'),path.join(tree,'scripts/lib'),{recursive:true});await cp(path.join(root,'package.json'),path.join(tree,'package.json')); }
      await instrument(tree);
    }
    if (option('metadata') === 'only') {
      const result = await run(trees.after, 'off', companion);
      report.metadata = result.metadata;
      report.method = 'Normal production startup and save migration metadata only; no browser or latency observation.';
      await mkdir(path.dirname(output), {recursive:true});
      await writeFile(output, JSON.stringify(report,null,2)+'\n'); return;
    }
    for(let pair=0;pair<runs;pair++) for(const group of ['off','on']) for(const label of pair%2?['after','before']:['before','after']) {
      if (report.runs.some(run => run.pair === pair && run.group === (group === 'on') && run.label === label)) continue;
      process.stdout.write(`pair ${pair+1}/${runs} group ${group} ${label}\n`);
      let result;
      try { result=await run(trees[label],group,companion); } catch(error) { report.failures ??= []; report.failures.push({pair,group,label,...error.partial}); await writeFile(output,JSON.stringify(report,null,2)+'\n'); throw error; }
      report.runs.push({pair,group,label,...result});
      await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
      const mate=report.runs.find(r=>r.pair===pair&&r.group===(group === 'on')&&r.label!==label);
      if(mate && JSON.stringify(mate.responses)!==JSON.stringify(result.responses))throw Error('Full planning response parity failed (cache metadata excluded)');
    }
  } finally { await rm(scratch,{recursive:true,force:true}); }
}
if (process.argv.includes('--help')) {
  console.log('node scripts/perf/possible-tasks.mjs --companion DIR --baseline START_SHA [--runs 7] [--out REPORT.json] [--settlement settled|early] [--resume yes] [--chrome PATH] [--metadata only] [--members first|all]');
} else if(option('child')) { await child(); process.exit(0); } else await main();
