// Test-only bounded HTTP delay bridge: 20 ms request + 20 ms each response chunk.
import http from 'node:http';import {Transform} from 'node:stream';
export async function bridge(target){
 const sockets=new Set();let active=0,peak=0;const server=http.createServer((req,res)=>{
  if(++active>64){active--;res.writeHead(503);res.end();return;}peak=Math.max(peak,active);let up,timer;
  res.once('close',()=>{active--;clearTimeout(timer);up?.destroy();});req.pause();
  timer=setTimeout(()=>{if(res.destroyed)return;up=http.request(target+req.url,{method:req.method,headers:req.headers},r=>{
   res.writeHead(r.statusCode,r.headers);const delayed=new Transform({highWaterMark:65536,transform(chunk,enc,cb){setTimeout(()=>cb(null,chunk),20);}});r.pipe(delayed).pipe(res);r.on('error',()=>res.destroy());
  });up.on('error',()=>res.destroy());req.pipe(up);req.resume();},20);
 });server.on('connection',s=>{if(sockets.size>=128){s.destroy();return;}sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return{origin:`http://127.0.0.1:${server.address().port}`,metrics:()=>({active,peak,sockets:sockets.size}),close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
