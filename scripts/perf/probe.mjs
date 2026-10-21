// Document-start probes are active only in the isolated benchmark browser.
export const probeSource = `(() => {
  window.__rs3Perf = { enabled: true, events: [] };
  window.__perfProbe = {longTasks: [], saved: [], taskStatuses: [], terrain: [], taskResponses: []};
  const p = window.__perfProbe;
  // Observe the application's one JSON parse, retaining scalar timing/cache
  // metadata only. No second request or retained task/state tree is needed.
  const responseJSON = Response.prototype.json;
  Response.prototype.json = async function(...args) {
    const started = performance.now(), value = await responseJSON.apply(this,args);
    if (new URL(this.url,location.href).pathname === '/api/tasks') {
      const cache = value?.cache ?? {}, numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      p.taskResponses.push({startMs:started,endMs:performance.now(),revision:numeric(value?.stateRevision),
        memberId:['player1','player2'].includes(value?.memberId)?value.memberId:null,
        cache:{hit:typeof cache.hit==='boolean'?cache.hit:null,
          unlockPredictionHit:typeof cache.unlockPredictionHit==='boolean'?cache.unlockPredictionHit:null,
          evaluationMs:numeric(cache.evaluationMs),requestMs:numeric(cache.requestMs),
          timingMs:Object.fromEntries(['engineMs','collectionMs','equipmentMs','presentationMs','currentBiSMs','activityMs','predictionMs','deathMs','totalMs'].map(key=>[key,numeric(cache.timingMs?.[key])]))}});
    }
    return value;
  };
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) p.longTasks.push({startMs:e.startTime,durationMs:e.duration}); }).observe({type:'longtask',buffered:true}); } catch {}
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(...args) {
    const result = drawImage.apply(this,args);
    if (this.canvas.id === 'map-base') p.terrain.push(performance.now());
    return result;
  };
  let lastSave='', lastTask='';
  new MutationObserver(() => {
    const save=document.getElementById('save-status');
    const text=save?.textContent+'|'+save?.title;
    if (save && text!==lastSave) {lastSave=text;p.saved.push({time:performance.now(),text:save.textContent,revision:Number(save.title.match(/revision (\\d+)/)?.[1])||null});}
    const task=document.getElementById('task-engine-status')?.textContent;
    if (task && task!==lastTask) {lastTask=task;p.taskStatuses.push({time:performance.now(),ready:/[0-9,]+ possible tasks/.test(task)});}
  }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title']});
})();`;

export const snapshotExpression = `(() => ({
  now:performance.now(), timeOrigin:performance.timeOrigin, events:window.__rs3Perf?.events??[], probe:window.__perfProbe,
  terrainViewport:(()=>{const v=window.__rs3Perf?.terrainViewport;if(!v)return null;
    const numeric=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
    const paths=a=>Array.isArray(a)?a.filter(p=>typeof p==='string'&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.includes('..')).slice(0,10000):[];
    return {bounds:Object.fromEntries(['left','top','right','bottom'].map(k=>[k,numeric(v.bounds?.[k])])),zoom:numeric(v.zoom),visibleRegions:numeric(v.visibleRegions),nativePaths:paths(v.nativePaths),selectedNativePaths:paths(v.selectedNativePaths),overviewPaths:paths(v.overviewPaths)};})(),
  paint:performance.getEntriesByType('paint').map(e=>({name:e.name,time:e.startTime})),
  navigation:performance.getEntriesByType('navigation').map(e=>({domContentLoadedMs:e.domContentLoadedEventEnd,loadMs:e.loadEventEnd})),
  member:document.getElementById('member')?.value,
  savedRevision:Number(document.getElementById('save-status')?.title.match(/revision (\\d+)/)?.[1])||null,
  tasksReady:/[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent??''),
  taskError:/failed|unavailable|restart required/i.test(document.getElementById('task-engine-status')?.textContent??''),
  resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,startMs:e.startTime,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize}))
}))()`;
