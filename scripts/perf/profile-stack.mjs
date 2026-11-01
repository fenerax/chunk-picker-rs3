#!/usr/bin/env node
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChrome, stopChild } from './cdp.mjs';
import { browserProbe, settle, perform, scenarios } from './profile-stack/browser.mjs';
import { harness, attributeHarness } from './profile-stack/harness.mjs';
import { rendererSpans } from './profile-stack/renderer.mjs';
import { workerStartupSpans } from './profile-stack/worker-startup.mjs';
import { sampleMemoryTree } from './profile-stack/memory.mjs';
import { reconcile, interactionWindows, summarize, topFunctions, html } from './profile-stack/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const now = () => Number(process.hrtime.bigint()) / 1e6;
export function parse(args) {
  const options = { runs: 5, scenario: 'all', out: path.resolve('.local/profile-stack'), profile: true, cpu: false, trace: false, root: ROOT, chrome: process.env.CHROME_PATH ?? '/usr/bin/chromium' };
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (key === '--help') return null;
    if (key === '--cpu') { options.cpu = true; continue; }
    if (key === '--trace') { options.trace = true; continue; }
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--runs') options.runs = Number(value);
    else if (key === '--scenario') options.scenario = value;
    else if (key === '--out') options.out = path.resolve(value);
    else if (key === '--chrome') options.chrome = path.resolve(value);
    else if (key === '--profile' && ['on','off'].includes(value)) options.profile = value === 'on';
    else if (key === '--server-root') options.root = path.resolve(value);
    else if (key === '--private-state') throw new Error('Private-state mode is not supported; no private save is opened.');
    else throw new Error(`Unknown option ${key}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) throw new Error('Runs must be 1–100');
  if (options.scenario !== 'all' && !scenarios.includes(options.scenario)) throw new Error('Unknown scenario');
  return options;
}
export function syntheticEnvironment(source, scratch, root, enabled, cpu = false) {
  // Deny by default: no inherited RS3_ setting reaches the synthetic server, so private
  // datasets, add-ons, game defaults, live storage, ingress and operator logs stay out.
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^RS3_/i.test(key)));
  Object.assign(env, { RS3_DATASET: 'open-f2p', RS3_STACK_SCRATCH: scratch, RS3_STACK_ROOT: root, RS3_TASK_WORKER_MODE: source.RS3_TASK_WORKER_MODE === 'thread' ? 'thread' : 'process' });
  if (enabled) { env.RS3_PROFILE = '1'; if (cpu) env.RS3_PROFILE_CPU = '1'; env.RS3_PROFILE_RELAY = '1'; env.RS3_PROFILE_DIR = path.join(scratch, 'trace'); }
  return env;
}
export async function startServer(options, scratch) {
  const child = fork(new URL('./profile-stack/server.mjs', import.meta.url), [], { cwd: options.root, env: syntheticEnvironment(process.env,scratch,options.root,options.profile,options.cpu), execArgv: options.profile ? ['--import', new URL('./profile-stack/bootstrap.mjs', import.meta.url).href, '--import', new URL('./profile-stack/relay.mjs', import.meta.url).href] : [], stdio: ['ignore','ignore','ignore','ipc'] });
  let sequence = 0; const waiting = new Map();
  const ready = new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Synthetic server startup timeout')),120000);
    child.once('error',reject); child.once('exit',()=>{clearTimeout(timer);reject(new Error('Synthetic server exited'));});
    child.on('message', m=>{
      if(m.type==='ready'){clearTimeout(timer);resolve(m);}
      if(m.type==='error'){clearTimeout(timer);reject(new Error(`Synthetic server startup: ${m.message}`));}
      const item=waiting.get(m.reply);if(item){clearTimeout(item.timer);waiting.delete(m.reply);m.error?item.reject(new Error(m.error)):item.resolve(m);}
    });
  });
  const rpc=(action,scenario)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(new Error('Server profile control timeout'));},60000);waiting.set(id,{resolve,reject,timer});child.send({id,action,scenario});});
  try { return {child,...await ready,rpc}; } catch(error){await stopChild(child);throw error;}
}
async function traceStop(browser) {
  const complete = new Promise(resolve => { const on = m => { if(m.method==='Tracing.tracingComplete'){browser.listeners.delete(on);resolve(m.params.stream);} }; browser.listeners.add(on); });
  await browser.send('Tracing.end'); const handle=await complete;let data='';
  try { for(;;){const row=await browser.send('IO.read',{handle});data+=row.base64Encoded?Buffer.from(row.data,'base64').toString():row.data;if(row.eof)break;} } finally {await browser.send('IO.close',{handle});}
  return JSON.parse(data).traceEvents;
}
async function authenticate(browser,server) {
  const response=await fetch(server.inviteUrl,{redirect:'manual'}), cookie=response.headers.get('set-cookie');
  if(response.status!==303||!cookie)throw new Error('Synthetic authentication failed');
  const pair=cookie.split(';')[0], split=pair.indexOf('=');
  await browser.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:new URL(server.inviteUrl).origin,httpOnly:true,sameSite:'Strict'});
}
async function repetition(options, run) {
  const scratch=await mkdtemp(path.join(tmpdir(),'rs3-stack-'));let server,browser;
  const clicks=[],clocks=[];
  try {
    server=await startServer(options,scratch);
    const t0=now(), clock=await server.rpc('clock'),t1=now();
    clocks.push({kind:'server',offsetMs:clock.clock-(t0+t1)/2,uncertaintyMs:(t1-t0)/2});
    browser=await openChrome(options.chrome,path.join(scratch,'chrome'),{extraArgs:process.getuid?.()===0?['--no-sandbox']:[]});
    await browser.send('Performance.enable'); await authenticate(browser,server);
    const origin=new URL(server.inviteUrl).origin;
    let installed;
    const selected=options.scenario==='all'?scenarios:[options.scenario];
    // An action-only selection has an explicitly unmeasured cold preparation.
    const sequence=selected[0]==='cold'?selected:['cold',...selected];
    for(const scenario of sequence){
      console.log(`Scenario ${scenario}`);
      const profileId=`r${run}.${scenario}`;
      const beforeRevision=(await server.rpc('revision')).revision;
      if(installed)await browser.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:installed});
      installed=(await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${browserProbe.toString()})(${options.profile},${JSON.stringify(profileId)})`})).identifier;
      await browser.evaluate(`globalThis.__rs3Stack?.begin(${JSON.stringify(profileId)})`);
      await browser.send('Network.setExtraHTTPHeaders',{headers:options.profile?{'x-rs3-profile':profileId}:{}});
      if(options.profile)await server.rpc('start',profileId);
      if(options.profile&&options.cpu){await browser.send('Profiler.enable');await browser.send('Profiler.setSamplingInterval',{interval:1000});await browser.send('Profiler.start');}
      if(options.profile&&options.trace)await browser.send('Tracing.start',{categories:'toplevel,devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
      const p0=now(), metric=await browser.send('Performance.getMetrics'),p1=now();
      const cdp=metric.metrics.find(x=>x.name==='Timestamp').value*1000,cdpOffset=(p0+p1)/2-cdp;
      clocks.push({kind:'cdp',scenario,offsetMs:cdpOffset,uncertaintyMs:(p1-p0)/2});
      const memory=[]; let sampling=false;
      const sample=async()=>{if(sampling)return;sampling=true;try{memory.push(await sampleMemoryTree(server.child.pid));}finally{sampling=false;}};
      await sample(); const memoryTimer=setInterval(()=>void sample(),50);
      const driver=harness(browser,profileId);
      const start=now();
      try { await perform(scenario,driver.browser,origin); } finally { clearInterval(memoryTimer); }
      const end=now(); await sample();
      const afterRevision=(await server.rpc('revision')).revision;
      const expectedMutations={roll:2,complete:1,settings:1}[scenario]??0;
      if(afterRevision-beforeRevision<expectedMutations)throw new Error(`Scenario ${scenario} did not commit its expected gameplay change`);
      let events=[],rendererCPU;
      if(options.profile&&options.trace)events=await traceStop(browser);
      if(options.profile&&options.cpu)rendererCPU=(await browser.send('Profiler.stop')).profile;
      if(options.profile)await server.rpc('stop',profileId);
      const b0=now(),snapshot=await browser.evaluate(`({time:performance.now(),records:globalThis.__rs3Stack.records})`),b1=now();
      const offset=(b0+b1)/2-snapshot.time;
      clocks.push({kind:'browser',scenario,offsetMs:offset,uncertaintyMs:(b1-b0)/2});
      const spans=options.profile?snapshot.records.filter(r=>(r.profileId===profileId||r.profileId.startsWith(profileId+'.'))).map(r=>({...r,id:`${r.profileId}:${r.id}`,start:r.start+offset,end:r.end+offset})):[];
      spans.push(...attributeHarness(driver.spans,spans.filter(s=>s.name==='input.click'),profileId));
      const renderer=rendererSpans(events,{start,end,offset:cdpOffset,profileId,inputs:spans.filter(s=>s.name==='input.click')});
      spans.push(...renderer.spans);
      const cpu=rendererCPU?[{processId:'renderer',layer:'browser',scenario:profileId,start:rendererCPU.startTime/1000+cdpOffset,end:rendererCPU.endTime/1000+cdpOffset,clockOffsetMs:cdpOffset,profile:rendererCPU}]:[];
      clicks.push({run,scenario,profileId,start,end,spans,cpu,traceEvents:events,rendererStatus:renderer.status,revisions:{before:beforeRevision,after:afterRevision},memory:{peakRssBytes:Math.max(0,...memory.map(m=>m.rssBytes)),samples:memory.length,complete:memory.every(m=>m.complete),maxProcesses:Math.max(0,...memory.map(m=>m.processes))}});
      // Read complete per-isolate records only after inspector stop acknowledgments.
    }
    let records=[];
    if(options.profile)for(const file of await readdir(path.join(scratch,'trace')))if(file.endsWith('.jsonl'))records.push(...(await readFile(path.join(scratch,'trace',file),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
    clocks.push(...records.filter(r=>r.kind==='clock'));
    for(const click of clicks){
      click.spans.push(...records.filter(r=>r.kind==='span'&&(r.profileId===click.profileId||r.profileId.startsWith(click.profileId+'.'))));
      click.spans=workerStartupSpans(click.spans,records);
      // Link request roots to the scenario; transmitted parent IDs link workers.
      for(const span of click.spans)if(!span.parentId)span.parentId=span.profileId;
      click.cpu.push(...records.filter(r=>r.kind==='cpu'&&r.scenario===click.profileId));
      click.cpu=click.cpu.map(c=>({...c,windowStart:click.start,windowEnd:click.end})).map(c=>({...c,top:topFunctions(c,click.spans)}));
      click.interactions=interactionWindows(click);
      click.summary=reconcile(click.start,click.end,click.spans);
    }
    return {clicks:clicks.filter(c=>selected.includes(c.scenario)),clocks,startupEvents:records.filter(r=>r.kind==='startup'||r.kind==='worker-start')};
  } finally {
    if(browser)await browser.close();
    if(server){try{await server.rpc('stop-server');}catch{}await stopChild(server.child);}
    await rm(scratch,{recursive:true,force:true});
  }
}
export async function main(args=process.argv.slice(2)) {
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<24||major===24&&minor<20)throw new Error('Node 24.20+ required');
  const options=parse(args);
  if(!options){console.log('node scripts/perf/profile-stack.mjs --scenario all --runs 5 --out DIR [--chrome PATH] [--cpu] [--trace] [--profile on|off] [--server-root PATH]\nSynthetic open-f2p only. No private save or external server accepted.');return;}
  await access(options.chrome); await mkdir(options.out,{recursive:true});
  await writeFile(path.join(options.out,'report.html'),'<!doctype html><meta charset="utf-8"><title>Incomplete picker profile</title><p>Run in progress or incomplete. See profile.json for completed evidence.</p>');
  const report={schemaVersion:2,startupEvents:[],complete:false,node:process.version,synthetic:true,profile:options.profile,cpu:options.cpu,trace:options.trace,runDurationsMs:[],workerMode:process.env.RS3_TASK_WORKER_MODE??'process',clicks:[],clocks:[],limits:[
    'Monotonic Node clocks share the local OS clock; offset handshakes report RTT/2 bounds and are not subtracted. Chrome clocks use independent midpoint handshakes; uncertainty does not include subsequent drift.',
    'Input starts immediately before the scenario CDP command. Each DOM click gets a child profile id; roll and map contain several inputs under one scenario id. Background work retains its originating request, not the later waiter that joins it.',
    'Settlement requires task controls, 120ms fetch-header quiet, and two animation frames. Long-lived SSE is excluded. Every polling sleep, frame wait and measured driver RPC has a harness span; application work has priority where it overlaps these awaits.',
    'Server-tree RSS is sampled every 50ms on Linux, excludes Chrome and the runner, and counts shared pages per process. Non-Linux samples are unavailable. Transient peaks may be missed.',
    'V8 sampling is statistical (1ms target). CPU samples map to the smallest containing span in the same isolate; unattributed is explicit. Inspector start/stop slack is reported.',
    'Process-worker relay hosts and their calculator threads have separate inspector profiles; native libuv/compressor threads have no JavaScript profiles. Relay CPU samples without spans are explicitly unattributed. FileHandle writes/fsync are observed; rename/directory fsync and other filesystem APIs are not individually observed.',
    'Compression-or-cache spans include cache lookup and asynchronous encoding. Shared response helpers and stream compression can fall outside that boundary. Store command spans include journal orchestration; measured I/O is nested.',
    'Tracing is opt-in: observed renderer-main top-level tasks are partitioned into script/function or URL, style, layout, paint, GC, observed idle and other tasks. Trace gaps are never inferred idle. Spans-only has no renderer trace coverage. Headless synthetic maps use no external art.',
    'Why normally reads a cached full result and creates its proof in the browser. How engine replay has a separate worker stage. Private engine profiling is unsupported and was skipped.'
  ]};
  try { for(let run=1;run<=options.runs;run++){
    console.log(`Synthetic stack repetition ${run}/${options.runs}`);
    const runStarted=now(); const result=await repetition(options,run); report.runDurationsMs.push(now()-runStarted);report.clicks.push(...result.clicks);report.clocks.push(...result.clocks.map(clock=>({...clock,run})));
    report.startupEvents.push(...result.startupEvents.map(event=>({...event,run})));
    report.summary=summarize(report.clicks); report.complete=run===options.runs;
    await writeFile(path.join(options.out,'profile.json'),JSON.stringify(report));
    const view={...report,clicks:report.clicks.map(c=>({...c,cpu:c.cpu.map(v=>v.top),traceEvents:undefined}))};
    await writeFile(path.join(options.out,'report.html'),html(view));
  }
  } catch(error) {
    report.complete=false;report.failure={completedScenarios:report.clicks.length,error:error.name};
    await writeFile(path.join(options.out,'profile.json'),JSON.stringify(report));
    throw error;
  }
  console.log(JSON.stringify(report.summary));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
