// Isolated browser search benchmark, public/synthetic data only; no game server,
// calculators or private saves. Uses the shipped dialog, loader and map layer.
// node scripts/perf/search-typing.mjs --baseline <git SHA> --scale-dir <scale-dataset output> [--runs 7]
// Compares full ordered rows; outputs their hashes and timings under .local/search-perf/.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChrome } from './cdp.mjs';
const option = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = option('baseline');
if (!/^[a-f0-9]{40}$/.test(baseline ?? '')) throw Error('Pass --baseline <full git SHA>.');
const baselineRoot = path.resolve(option('baseline-root'));
if (execFileSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() !== baseline) throw Error('Baseline worktree does not match --baseline.');
const runs = Number(option('runs', '20'));
if (!Number.isSafeInteger(runs) || runs < 20) throw Error('Use at least twenty fixed AB/BA pairs.');
const output = path.resolve(option('out', '.local/search-perf/typing'));
await mkdir(output, { recursive: true });
const scaleRoot = path.resolve(option('scale-dir', '.local/search-perf/scale400'));
const selection = JSON.parse(await readFile(path.join(scaleRoot, 'selection.json'), 'utf8'));
const definitionsBytes = await readFile(path.join(scaleRoot, 'packs', selection.data.id, selection.data.version, 'app/data/original-definitions.synthetic.v1.json'));
const definitions = JSON.parse(definitionsBytes);
const fixture = JSON.stringify({ chunks: definitions.chunks });
const modes = option('variants', 'before,after').split(',');
if (modes.some(x => !['before', 'after'].includes(x))) throw Error('Invalid variants.');
function instrument(source) {
  const materialize = source.includes('function chunkEntry(') ? 'chunkEntries ? chunkEntry(entry) : entry' : 'entry';
  return source.replace('function paintPage() {', 'function paintPage() { const paintStart = performance.now();')
    .replace("if (!entries.length) rows.append", "globalThis.measure.listMs += performance.now() - paintStart; if (!entries.length) rows.append")
    .replace("if (renderedMode === 'Chunks') await c.ensureChunkSearch();\n        if (!ready()) return;", "if (renderedMode === 'Chunks') await c.ensureChunkSearch();\n        if (!ready()) return; const activeStart = performance.now();")
    .replace('void enrichTaskMatches(request, entries);', 'globalThis.measure.renderMs += performance.now() - activeStart; void enrichTaskMatches(request, entries);')
    .replace('const entry = chunkEntries ? chunkEntry(match) : match;', 'const rowStart = performance.now(); const entry = chunkEntries ? chunkEntry(match) : match; globalThis.measure.rowCopyMs += performance.now() - rowStart;')
    .replace('entries = matchingSearchChunks(', 'const prepareStart = performance.now(); entries = matchingSearchChunks(')
    .replace("} else if (['Tasks', 'Quests'].includes(renderedMode))", "globalThis.measure.prepareMs += performance.now() - prepareStart; } else if (['Tasks', 'Quests'].includes(renderedMode))")
    .replace('// All matching locations,', `globalThis.readSearchRows = () => entries.map(entry => {const {action, task, item, ...row} = ${materialize};return row;}); // All matching locations,`);
}
// Historical source comes from a real worktree. Write instrumented browser
// modules to disk before serving them; requests never patch module source.
const moduleRoot = path.join(output, 'modules');
for (const variant of ['before', 'after']) {
  const directory = path.join(moduleRoot, variant);
  await mkdir(directory, { recursive: true });
  for (const filename of ['screen-search.mjs', 'screen-search-data.mjs', 'map-search-layer.mjs']) {
    let source = await readFile(path.join(variant === 'before' ? baselineRoot : root, 'app/web', filename), 'utf8');
    if (filename === 'screen-search.mjs') source = instrument(source).replace('entries = matchingSearchChunks(', 'entries = globalThis.timedMatch(');
    if (filename === 'map-search-layer.mjs' && source.includes('const paint = () => {')) {
      source = source.replace('const paint = () => {', 'let batchIndex = 0; const paint = () => { const batchStart = performance.now();')
        .replace('context.restore();', 'context.restore(); if(batchIndex++) globalThis.measure.mapMs += performance.now() - batchStart;');
    }
    await writeFile(path.join(directory, filename), source);
  }
}
const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app/web/search.css"><style>.search-results{height:360px;overflow:auto}.search-result{display:flex;justify-content:space-between}canvas{position:fixed;right:0;top:0;width:600px;height:600px;pointer-events:none}</style><div id="dialog"></div><div id="stage"></div>`;
const setup = async variant => {
  const [{createSearchDialog}, {createScreenLoading}, {MapSearchLayer}] = await Promise.all([
    import(`/app/web/screen-search.mjs?variant=${variant}`), import('/app/web/screen-loading.mjs'), import('/app/web/map-search-layer.mjs')]);
  const fixture = await (await fetch('/fixture')).json();
  const chunks = new Map(Object.entries(fixture.chunks).map(([id, record]) => [id, {name: record.Nickname ?? id}]));
  const ids = [...chunks.keys()];
  const cells = new Map(ids.map((id, i) => [id.replace(/-\d+$/, ''), {x: i % 150, y: Math.floor(i / 150)}]));
  const layer = new MapSearchLayer(document.querySelector('#stage'));
  layer.canvas.width = 600; layer.canvas.height = 600;
  const originalMatch = (await import('/app/web/screen-search-data.mjs')).matchingSearchChunks;
  globalThis.timedMatch = (...args) => { const start = performance.now(); const result = originalMatch(...args); measure.matchMs += performance.now() - start; return result; };
  globalThis.measure = {indexMs:0,indexBuilds:0,matchMs:0,prepareMs:0,listMs:0,mapMs:0,rowCopyMs:0,renderMs:0};
  globalThis.longTasks = [];
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({start:e.startTime, duration:e.duration})))); observer.observe({type:'longtask', buffered:true});
  const el = (tag, text, cls) => {const n = document.createElement(tag); if(text !== undefined)n.textContent=text; if(cls)n.className=cls; return n;};
  const members = [0,1].map(i => ({id:`member${i}`,name:`Member ${i}`,unlocked:ids.filter((_,j)=>j%10===i),selected:ids.filter((_,j)=>j%10===i+2),blacklisted:ids.filter((_,j)=>j%10===i+4),notes:Object.fromEntries(ids.filter((_,j)=>j%101===i).map(id=>[id, 'Café synthetic note']))}));
  const c = {definitions:fixture, state:{revision:1,members}, memberId:members[0].id, sandbox:{active:false}, world:{chunks,areas:new Map()},
    pool:{eligible:ids.filter((_,j)=>j%10===7).map(id=>({id}))}, result:{tasks:[]}, plain:x=>String(x), advanced:()=>true, duoEnabled:()=>false,
    member:()=>members.find(m=>m.id===c.memberId), el, input:type=>Object.assign(el('input'),{type}),
    select:(choices,value)=>{const n=el('select'); for(const choice of choices)n.append(Object.assign(el('option',choice),{value:choice}));n.value=value;return n;},
    button:(label,action)=>{const n=el('button',label);n.addEventListener('click',action);return n;},field:(label,n)=>n,
    dialogCurrent:g=>g===c.generation,openDialog:(title,...nodes)=>{dialog.clear();document.querySelector('#dialog').replaceChildren(...nodes);return c.generation=(c.generation??0)+1;},
    map:{setSearchMatches:ids=>{const start=performance.now(); layer.setMatches(ids,cells);layer.draw({width:600,height:600,dpr:1,zoom:.055,offset:{x:0,y:0}});measure.mapMs+=performance.now()-start;}},
  };
  createScreenLoading(c);
  const ensure = c.ensureChunkSearch;
  c.ensureChunkSearch = async () => { const start=performance.now(), build=!c.chunkSearch; const result=await ensure();measure.indexMs+=performance.now()-start;measure.indexBuilds+=Number(build);return result;};
  const dialog=createSearchDialog(c);
  globalThis.runSearch = async (member, group) => {
    dialog.clear(); c.memberId=member; c.duoEnabled=()=>group;
    measure={indexMs:0,indexBuilds:0,matchMs:0,prepareMs:0,listMs:0,mapMs:0,rowCopyMs:0,renderMs:0};
    dialog.open();
    const wait=async()=>{for(let i=0;i<6000;i++){const r=document.querySelector('.search-results');if(r&&r.getAttribute('aria-busy')!=='true'&&r.querySelector('[role=status]'))return;await new Promise(r=>setTimeout(r,5));}throw Error('Search timeout');};
    await wait();
    const opening={...measure};
    const rows=[];
    for(const query of ['a','ab','abc','','é','no-match-zzzz']) {
      measure={indexMs:0,indexBuilds:0,matchMs:0,prepareMs:0,listMs:0,mapMs:0,rowCopyMs:0,renderMs:0};
      const cpuStart=await globalThis.cpuSnapshot();
      const n=document.querySelector('input[type=search]'), start=performance.now();
      n.value=query; n.dispatchEvent(new Event('input',{bubbles:true})); await wait();
      const pageReadyMs = performance.now() - start;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const pagePaintMs = performance.now() - start;
      if (layer.painting) {
        while (layer.painting) await new Promise(r=>requestAnimationFrame(r));
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      }
      const cpuEnd=await globalThis.cpuSnapshot();
      if(!Number.isFinite(cpuEnd)||cpuEnd<cpuStart)throw Error('Renderer CPU counter unavailable: undecided.');
      const timed = {query,...measure,cpuMs:(cpuEnd-cpuStart)*1000,pageReadyMs,pagePaintMs,wallMs:performance.now()-start,longestTaskMs:Math.max(0,...longTasks.filter(t=>t.start>=start).map(t=>t.duration)),
        network:performance.getEntriesByType('resource').filter(e=>e.startTime>=start).map(e=>({name:new URL(e.name).pathname,ms:e.duration})),
        rendered:document.querySelectorAll('.search-result').length};
      const validationStart=performance.now(); const completeRows=globalThis.readSearchRows();
      rows.push({...timed,validationMs:performance.now()-validationStart,rows:completeRows,mapImage:document.querySelector('#stage canvas').toDataURL()});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }
    return {member,group,opening,rows};
  };
};
let variant;
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
    if(url.pathname==='/fixture'){res.setHeader('Content-Type','application/json');res.end(fixture);return;}
    if(url.pathname==='/app/dataset-runtime.mjs'){res.setHeader('Content-Type','text/javascript');res.end('export const selectedDataset={capabilities:{independent:true}};');return;}
    if(url.pathname!=='/app/startup-read.mjs'&&!/^\/app\/(?:web|tasks)\/[a-z0-9-]+\.(mjs|css)$/.test(url.pathname)){res.writeHead(404).end();return;}
    let source;
    if(['screen-search.mjs','screen-search-data.mjs','map-search-layer.mjs'].includes(path.basename(url.pathname)))source=await readFile(path.join(moduleRoot,variant,path.basename(url.pathname)),'utf8');
    else source=await readFile(path.join(root,url.pathname),'utf8');
    res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(source);
  } catch(e) {console.error(e);res.writeHead(500).end(String(e));}
});
await new Promise(r=>server.listen(0,'localhost',r));
const fixtureSha256=createHash('sha256').update(definitionsBytes).digest('hex');
const harnessSha=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const sourceDigests={};
for(const name of ['screen-search.mjs','screen-search-data.mjs','map-search-layer.mjs'])for(const [variant,directory]of [['before',baselineRoot],['after',root]])sourceDigests[variant+':'+name]=createHash('sha256').update(await readFile(path.join(directory,'app/web',name))).digest('hex');
let previous;
try { previous=JSON.parse(await readFile(path.join(output,'results.json'),'utf8')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
if(previous&&(previous.baseline!==baseline||previous.fixtureSha256!==fixtureSha256))throw Error('Resume inputs changed; choose a new output directory.');
if(previous&&(previous.harnessSha!==harnessSha||JSON.stringify(previous.sourceDigests)!==JSON.stringify(sourceDigests)))throw Error('Preserve earlier source fingerprints; choose a new output directory.');
const results=previous?.results??[], ordered=new Map(), batchStarted=Date.now();
const protocol={pairs:runs,order:Array.from({length:runs},(_,pair)=>({pair,order:pair%2?['after','before']:['before','after']})),counter:'Chrome renderer ThreadTime, in milliseconds; row/pixel validation excluded',minimumFasterPairs:18,minimumPairedMedianCpuGainPercent:5,wallTimeIsGate:false};
if(previous?.protocol&&JSON.stringify(previous.protocol)!==JSON.stringify(protocol))throw Error('Preserve earlier CPU protocol; choose a new output directory.');
await writeFile(path.join(output,'results.json'),JSON.stringify({baseline,node:process.version,fixtureSha256,harnessSha,sourceDigests,chunks:Object.keys(definitions.chunks).length,protocol,results,decision:'undecided'},null,2));
for(const result of results)for(const scope of result.scopes)for(const row of scope.rows){
  const key=JSON.stringify([scope.member,scope.group,row.query]);
  ordered.set(key,row.hash);ordered.set(key+':map',row.mapHash);
}
async function rssTree(pid) {
  if (process.platform === 'win32') return 0; // RSS unavailable on this platform; never claim a memory win.
  const output = await new Promise((resolve, reject) => execFile('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const processes = output.trim().split('\n').map(line => {
    const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, parent, rss: rss * 1024 };
  });
  const pids=new Set([pid]);let bytes=0;
  for(let changed=true;changed;){changed=false;for(const p of processes)if(pids.has(p.parent)&&!pids.has(p.pid)){pids.add(p.pid);changed=true;}}
  for(const p of processes)if(pids.has(p.pid))bytes+=p.rss;
  return bytes;
}
try {
  for(let pair=0;pair<runs;pair++){
    if(Date.now()-batchStarted>4*60*1000){console.log('Paused between pairs for the shared-lock limit; rerun to resume.');break;}
    for(const name of pair%2?[...modes].reverse():modes){
    if(results.some(result=>result.pair===pair&&result.variant===name))continue;
    variant=name;
    const profile=await mkdtemp(path.join(output,`chrome-${pair}-${name}-`));
    const browser=await openChrome(option('chrome','/usr/bin/chromium'),profile,{extraArgs:['--no-sandbox','--disable-dev-shm-usage']});
    browser.evaluate = async expression => { const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result?.value; };
    let peakRss=0;
    let sampling;
    const sampleRss = () => sampling ??= rssTree(browser.child.pid).then(rss => { peakRss=Math.max(peakRss,rss); }).finally(() => { sampling=undefined; });
    const sample=setInterval(()=>{void sampleRss().catch(()=>{});},250);
    const cpuListener=message=>{
      if(message.method!=='Runtime.bindingCalled'||message.params.name!=='__cpuSnapshotBinding')return;
      const {id}=JSON.parse(message.params.payload);
      void browser.send('Performance.getMetrics').then(response=>{
        const value=response.metrics.find(metric=>metric.name==='ThreadTime')?.value;
        if(!Number.isFinite(value))throw Error('Renderer CPU counter unavailable');
        return browser.evaluate(`globalThis.resolveCpuSnapshot(${id},${value})`);
      }).catch(()=>{void browser.evaluate(`globalThis.rejectCpuSnapshot(${id})`).catch(()=>{});});
    };
    try{
      await browser.send('Page.navigate',{url:`http://localhost:${server.address().port}/`});
      await browser.evaluate(`new Promise(resolve => { if(document.readyState === 'complete')resolve();else addEventListener('load',resolve,{once:true}); })`);
      await browser.send('Performance.enable',{timeDomain:'threadTicks'});
      const counters=await browser.send('Performance.getMetrics');
      if(!counters.metrics.some(metric=>metric.name==='ThreadTime'&&Number.isFinite(metric.value)))throw Error('Renderer CPU counter unavailable: undecided.');
      browser.listeners.add(cpuListener);
      await browser.send('Runtime.addBinding',{name:'__cpuSnapshotBinding'});
      await browser.evaluate(`{
        let sequence=0;const pending=new Map();
        globalThis.cpuSnapshot=()=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});globalThis.__cpuSnapshotBinding(JSON.stringify({id}));});
        globalThis.resolveCpuSnapshot=(id,value)=>{const entry=pending.get(id);pending.delete(id);entry.resolve(value);};
        globalThis.rejectCpuSnapshot=id=>{const entry=pending.get(id);pending.delete(id);entry.reject(Error('CPU counter unavailable: undecided.'));};
      }`);
      await browser.evaluate(`(${setup.toString()})(${JSON.stringify(name)})`);
      const scopes=[];
      for(const member of ['member0','member1'])for(const group of [false,true]){
        const scope=await browser.evaluate(`runSearch(${JSON.stringify(member)},${group})`);
        for(const row of scope.rows){
          const key=JSON.stringify([member,group,row.query]);const hash=createHash('sha256').update(JSON.stringify(row.rows)).digest('hex');
          if(ordered.has(key)&&ordered.get(key)!==hash)throw Error(`Ordered rows changed: ${key}`);ordered.set(key,hash);
          const mapHash=createHash('sha256').update(row.mapImage).digest('hex');
          if(ordered.has(key+':map')&&ordered.get(key+':map')!==mapHash)throw Error(`Highlight pixels changed: ${key}`);ordered.set(key+':map',mapHash);
          delete row.rows; delete row.mapImage; row.hash=hash; row.mapHash=mapHash;
        }
        scopes.push(scope);
      }
      peakRss=Math.max(peakRss,await rssTree(browser.child.pid));
      const result={pair,variant:name,peakBrowserTreeRssMiB:process.platform==='win32'?null:peakRss/1048576,scopes};results.push(result);
      console.log(JSON.stringify({pair,variant:name,peakBrowserTreeRssMiB:result.peakBrowserTreeRssMiB,opening:scopes[0].opening,keys:scopes[0].rows}));
      await writeFile(path.join(output,'results.json'),JSON.stringify({baseline,node:process.version,fixtureSha256:createHash('sha256').update(definitionsBytes).digest('hex'),harnessSha,sourceDigests,chunks:Object.keys(definitions.chunks).length,protocol,decision:'undecided',method:'Real browser; renderer-thread CPU snapshots bracket the action through final highlights, with complete row/pixel hashes outside the measured interval. Wall time is diagnostic only. Fixed alternating AB/BA pairs.',results},null,2));
    } finally {browser.listeners.delete(cpuListener);clearInterval(sample);await browser.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  }}
} finally {await new Promise(r=>server.close(r));}
