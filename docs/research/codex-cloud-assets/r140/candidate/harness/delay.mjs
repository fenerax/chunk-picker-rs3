// Explicit unshaped profile: immediate bounded HTTP passthrough, no sleep0.
import http from 'node:http';
export const PROFILE='UNSHAPED_0_ADDED_LATENCY';
export function requestHandler(target,state,requestImpl=http.request){return(req,res)=>{
 if(++state.active>64){state.active--;res.writeHead(503);res.end();return;}state.peak=Math.max(state.peak,state.active);let up;
 res.once('close',()=>{state.active--;up?.destroy();});req.pause();
 // Deliberately no timer/Transform: response chunks and SSE stream as received.
 up=requestImpl(target+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);r.on('error',()=>res.destroy());});
 up.on('error',()=>res.destroy());req.pipe(up);req.resume();
};}
export async function bridge(target,profile){
 if(profile!==PROFILE)throw Error('r140-profile-mismatch');
 const sockets=new Set(),state={active:0,peak:0};const server=http.createServer(requestHandler(target,state));
 server.on('connection',s=>{if(sockets.size>=128){s.destroy();return;}sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return{origin:`http://127.0.0.1:${server.address().port}`,metrics:()=>({active:state.active,peak:state.peak,sockets:sockets.size}),close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
