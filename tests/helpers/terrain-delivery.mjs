import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { openAcknowledgedChrome, removeScratch } from './acknowledged-chrome.mjs';
import { findChrome } from '../../scripts/ci/gallery-support.mjs';

export function solidTerrainPng(rgb) {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), check = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); check.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, check]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(256 * (256 * 3 + 1));
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 3; c++) pixels[y * 769 + 1 + x * 3 + c] = rgb[c];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

// All image requests and decodes are acknowledged. Only the caller's one outer
// file guard can abort; network delivery, idle callbacks and frames have no timer.
export async function openTerrainDelivery({ signal, appRoot = path.resolve('app'), payload, manifest, grid,
  imageBytes = route => solidTerrainPng(route.includes('/overview/') ? [17,187,85] : [221,51,34]) }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'terrain-delivery-'));
  const server = createServer(async (request, response) => {
    try {
      const route = new URL(request.url, 'http://127.0.0.1').pathname;
      if (route === '/data/dataset-runtime.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload)); }
      else if (route.startsWith('/app/')) {
        const file = path.resolve(appRoot, route.slice(5));
        if (!file.startsWith(appRoot + path.sep)) throw Error('Invalid fixture path');
        response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
      } else if (route.startsWith('/assets/')) { response.writeHead(500); response.end(); }
      else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><style>body{margin:0}#stage{position:relative;width:512px;height:256px}canvas{position:absolute;inset:0}</style><div id="stage"><canvas id="base"></canvas><canvas id="state"></canvas><canvas id="pins"></canvas><canvas id="hover"></canvas></div><div id="tooltip"></div>'); }
    } catch { response.writeHead(404); response.end(); }
  });
  let browser, page;
  const requests = [], events = [], waiters = new Set(), errors = [];
  const emit = event => { events.push(event); for (const listener of [...waiters]) listener(event); };
  const event = matches => {
    const found = events.find(matches); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const abort = () => { waiters.delete(listener); reject(Error('Outer terrain browser guard')); };
      const listener = row => { if (matches(row)) { waiters.delete(listener); signal.removeEventListener('abort', abort); resolve(row); } };
      waiters.add(listener); signal.addEventListener('abort', abort, { once: true });
    });
  };
  const evaluate = async expression => {
    const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const close = async () => {
    try { if (page && !signal.aborted) await page.close(); await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await removeScratch(directory, { signal }); }
  };
  try {
    // Deterministically try only the authorized local-picker range.
    for (let port = 8960; ; port++) {
      if (port > 8999) throw Error('No free terrain fixture port');
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); break; }
      catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    }
    browser = await openAcknowledgedChrome(await findChrome(), path.join(directory, 'chrome'), { signal });
    page = await browser.page({ width: 512, height: 256, mobile: false });
    page.listeners.add(({ method, params }) => {
      if (method === 'Fetch.requestPaused') { const row = { type: 'request', url: params.request.url, requestId: params.requestId }; requests.push(row); emit(row); }
      if (method === 'Runtime.bindingCalled' && params.name === 'terrainEvent') emit(JSON.parse(params.payload));
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Network.clearBrowserCache');
    await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await page.send('Runtime.addBinding', { name: 'terrainEvent' });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/assets/*', requestStage: 'Request' }] });
    const loaded = new Promise(resolve => { const listener = ({ method }) => { if (method === 'Page.loadEventFired') { page.listeners.delete(listener); resolve(); } }; page.listeners.add(listener); });
    await page.send('Page.navigate', { url: origin }); await loaded;
    await evaluate(`(async () => {
      let clock=0, sequence=0; const frames=new Map(), idle=new Map(), decodes=new Map();
      window.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence;}; window.cancelAnimationFrame=id=>frames.delete(id);
      window.requestIdleCallback=callback=>{idle.set(++sequence,callback);return sequence;}; window.cancelIdleCallback=id=>idle.delete(id);
      Object.defineProperty(performance,'now',{value:()=>clock});
      const NativeImage=window.Image;
      window.Image=function(){const image=new NativeImage(), decode=image.decode.bind(image);
        image.addEventListener('error',()=>window.terrainEvent(JSON.stringify({type:'image-error',url:image.src})));
        image.decode=()=>decode().then(()=>new Promise(resolve=>{const id=++sequence;decodes.set(id,resolve);window.terrainEvent(JSON.stringify({type:'decoded',url:image.src,id}));}));return image;};
      const {ChunkMap}=await import('/app/web/map.mjs');
      const grid=${JSON.stringify(grid)}, manifest=${JSON.stringify(manifest)};
      const minX=Math.floor(grid.startId/grid.stride),maxY=grid.startId%grid.stride;
      const map=new ChunkMap({stage:document.getElementById('stage'),baseCanvas:document.getElementById('base'),stateCanvas:document.getElementById('state'),pinCanvas:document.getElementById('pins'),hoverCanvas:document.getElementById('hover'),tooltip:document.getElementById('tooltip'),deferFallback:true});map.observer.disconnect();
      const chunks=manifest.cacheTerrain.tiles.map(tile=>{const id=String(tile.x*grid.stride+tile.y);return [id,{id,name:'Fixture'}];});
      map.setModel({world:{chunks:new Map(chunks),surface:new Set(chunks.map(([id])=>id))},state:{revision:0,members:[{id:'one',name:'Player 1',unlocked:chunks.map(([id])=>id),selected:[],pendingRoll:[]}]},memberId:'one',preferences:{ids:false,highvis:true},pool:{eligible:[],partnerConnections:{byChunk:{}}}});
      map.setMapAssets(manifest,{pins:[]});
      const drain=()=>{let count=0;while(frames.size){if(++count>1000)throw Error('Unbounded terrain frames');const [id,cb]=frames.entries().next().value;frames.delete(id);cb(clock);}return count;};
      const snap=()=>{const t=map.terrain, images=new Set([...t.images.values(),...t.pending.values(),...t.overviewPending.values(),...t.chunkImages.values()]);
        const canvases=new Set([...t.previews.values(),...t.lockedImages.values(),...[...t.levels.values(),...t.pages.values(),...t.stagedPages.values(),...t.stagedPreviews.values()].flatMap(p=>[p.colour,p.gray])]);
        return {clock,visible:[...t.visibleKeys],committed:[...t.committedKeys],nativeImages:t.images.size,nativePages:t.pages.size,pageLimit:t.pageLimit,cacheLimit:t.cacheLimit,
          pending:[...t.pending].map(([key,image])=>({key,url:image.src,background:t.backgroundImages?.has(image)??false})).concat([...t.overviewPending].map(([key,image])=>({key,url:image.src,background:t.backgroundImages?.has(image)??false}))),
          ready:t.viewLoaded()&&!t.pageQueue.size&&!t.previewQueue.size&&!t.pageWorkScheduled,background:t.backgroundImages?.size??0,idle:idle.size,
          bytes:t.backgroundBytes??{},rgbaImageBytes:[...images].reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight*4,0),canvasBytes:[...canvases].reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0)};};
      window.terrainControl={snap,drain(){drain();return snap();},view(col,row,zoom){map.zoom=zoom;map.offset={x:-col*128*zoom,y:-row*128*zoom};map.invalidate(true,true,true);drain();return snap();},
        idle(){const first=idle.entries().next().value;if(first){const [id,callback]=first;idle.delete(id);callback({timeRemaining:()=>10});}drain();return snap();},
        release(id){const resolve=decodes.get(id);if(!resolve)throw Error('Missing decode');decodes.delete(id);resolve();},
        time(value){clock=value;},pixel(col,row){const x=Math.floor((map.offset.x+(col+.4)*128*map.zoom)*map.dpr),y=Math.floor((map.offset.y+(row+.4)*128*map.zoom)*map.dpr);return [...document.getElementById('state').getContext('2d').getImageData(x,y,1,1).data];},dispose(){map.dispose();}};
    })()`);
    let deliveredBytes = 0, peakImageBytes = 0, peakCanvasBytes = 0;
    const sample = snapshot => { peakImageBytes = Math.max(peakImageBytes, snapshot.rgbaImageBytes); peakCanvasBytes = Math.max(peakCanvasBytes, snapshot.canvasBytes); return snapshot; };
    const snapshot = async () => sample(await evaluate('terrainControl.drain()'));
    const deliver = async pending => {
      const request = await event(row => row.type === 'request' && row.url === pending.url && !row.used); request.used = true;
      const bytes = await imageBytes(new URL(pending.url).pathname);
      try { await page.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: bytes[0] === 137 ? 'image/png' : 'image/webp' }, { name: 'Cache-Control', value: 'no-store' }], body: bytes.toString('base64') }); }
      catch (error) { if (!error.message.includes('Invalid InterceptionId')) throw error; return deliver(pending); }
      deliveredBytes += bytes.length;
      const decoded = await event(row => ['decoded','image-error'].includes(row.type) && row.url === pending.url && !row.used); decoded.used = true;
      sample(await evaluate('terrainControl.snap()'));
      if (decoded.type === 'decoded') await evaluate(`terrainControl.release(${decoded.id})`);
      return snapshot();
    };
    return { evaluate, snapshot, deliver, requests, errors, close,
      async finishVisible() { for (let count=0;count<4000;count++) { const s=await snapshot();const pending=s.pending.find(p=>!p.background);if(!pending){if(!s.ready)throw Error('Visible terrain stalled');return s;}await deliver(pending);}throw Error('Unbounded visible requests'); },
      async idleStep() { return sample(await evaluate('terrainControl.idle()')); },
      metrics: () => ({ deliveredBytes, peakImageBytes, peakCanvasBytes }) };
  } catch (error) { await close(); throw error; }
}

export function terrainFixture(grid) {
  const minX=Math.floor(grid.startId/grid.stride),maxY=grid.startId%grid.stride;
  const columns=Math.min(12,grid.columns),rows=Math.min(8,grid.rows),tiles=[];
  const directory='terrain.optimized-fixture-0123456789ab',cache='terrain.cache-fixture/28/2';
  const nativeBytes=solidTerrainPng([221,51,34]).length,overviewBytes=solidTerrainPng([17,187,85]).length;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)tiles.push({x:minX+x,y:maxY-y,width:256,height:256,status:'rendered',bytes:nativeBytes,path:cache+'/0_'+(minX+x)+'_'+(maxY-y)+'.png'});
  return {schemaVersion:1,categories:[],terrain:{mapId:28,plane:0,zoom:2,tiles:[]},cacheTerrain:{mapId:28,plane:0,zoom:2,iconFree:true,layoutComplete:true,transparentWater:true,oceanColour:[96,118,154],directory:cache,tiles},
    optimizedTerrain:{schemaVersion:1,mapId:28,plane:0,tileSize:256,directory,tiles:tiles.map(t=>({...t,path:directory+'/native/0_'+t.x+'_'+t.y+'.webp'})),
      pages:Array.from({length:Math.ceil(rows/4)},(_,y)=>Array.from({length:Math.ceil(columns/4)},(_,x)=>({x,y,left:x*512,top:y*512,width:512,height:512,pixelWidth:256,pixelHeight:256,bytes:overviewBytes,path:directory+'/overview/'+x+'_'+y+'.webp',regions:tiles.filter(t=>Math.floor((t.x-minX)/4)===x&&Math.floor((maxY-t.y)/4)===y).map(({x,y})=>({x,y}))}))).flat()}};
}
