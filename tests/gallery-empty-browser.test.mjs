// @test full solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { datasetBrowserPayload } from '../app/dataset-catalogues.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { galleryPreviewHTML } from '../app/gallery-route.mjs';
import { openAcknowledgedChrome, removeScratch } from './helpers/acknowledged-chrome.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

test('empty gallery paints its grid without requesting world artwork, directly and in a frame', async () => {
  const controller=new AbortController(),signal=controller.signal,guard=setTimeout(()=>controller.abort(),300000);
  const scratch=await mkdtemp(path.join(tmpdir(),'gallery-empty-'));
  const app=path.resolve('app'),web=path.join(app,'web');
  let browser,page;
  const requests=[];
  // Match the existing overflow fixture: public runtime values plus the
  // committed synthetic gallery model, with all gallery controls enabled.
  const {values}=await datasetBrowserPayload(selectedDataset);
  const payload={dataset:{id:'synthetic',digest:'gallery-empty-fixture'},capabilities:{},values};
  const shell=galleryPreviewHTML(await readFile(path.join(web,'index.html'),'utf8'));
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://fixture'),route=url.pathname;
      let bytes;
      if(route==='/gallery/preview')bytes=shell;
      else if(route==='/frame')bytes='<iframe src="/gallery/preview?entry=empty"></iframe>';
      else if(route==='/data/dataset-runtime.json')bytes=JSON.stringify(payload);
      else if(route==='/gallery-fixture-data.json')bytes=await readFile(path.join(web,'gallery-fixture-data.json'));
      else {
        const relative=route.replace(/^\//,''),file=path.resolve(web,relative);
        if(!file.startsWith(web+path.sep))throw Error('Outside fixture');
        bytes=await readFile(file).catch(()=>readFile(path.join(app,relative)));
      }
      response.setHeader('Content-Type',route==='/frame'||route==='/gallery/preview'?'text/html':route.endsWith('.json')?'application/json':route.endsWith('.css')?'text/css':route.endsWith('.svg')?'image/svg+xml':'text/javascript');response.end(bytes);
    }catch{response.writeHead(404);response.end();}
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    browser=await openAcknowledgedChrome(await findChrome(),path.join(scratch,'chrome'),{signal});
    page=await browser.page({width:1280,height:800,mobile:false});
    await page.send('Runtime.addBinding',{name:'galleryResult'});
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      let strokes=0;const stroke=CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='map-base')strokes++;return stroke.apply(this,args);};
      const observer=new MutationObserver(()=>{
        const data=document.documentElement?.dataset;
        if(data?.galleryError||data?.galleryReady==='true'){
          observer.disconnect();const stage=document.getElementById('map-stage');
          galleryResult(JSON.stringify({error:data.galleryError,stack:data.galleryErrorStack,strokes,terrain:stage?.dataset.mapTerrain,image:stage?.dataset.mapImage}));
        }
      });observer.observe(document,{subtree:true,attributes:true,childList:true});
    `});
    page.listeners.add(({method,params})=>{if(method==='Network.requestWillBeSent')requests.push(params.request.url);});
    for(const route of ['/gallery/preview?entry=empty','/frame']){
      const ready=new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(error,value)=>{if(settled)return;settled=true;page.listeners.delete(listener);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
        const abort=()=>finish(signal.reason);
        const listener=({method,params})=>{if(method==='Runtime.bindingCalled'&&params.name==='galleryResult')finish(null,JSON.parse(params.payload));};
        page.listeners.add(listener);signal.addEventListener('abort',abort,{once:true});
        browser.exited.then(()=>finish(Error('Owned gallery browser closed')),error=>finish(error));
        if(signal.aborted)abort();
      });
      const [,result]=await Promise.all([page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${route}`}),ready]);
      assert.equal(result.error,undefined,result.stack);assert.equal(result.terrain,'ready');assert.equal(result.image,'unused');
      assert.ok(result.strokes>0,'Empty gallery must draw grid lines');
    }
    assert.equal(requests.filter(url=>new URL(url).pathname==='/assets/world.png').length,0);
  }finally{
    try{await browser?.close();}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await removeScratch(scratch,{signal});clearTimeout(guard);}
  }
});
