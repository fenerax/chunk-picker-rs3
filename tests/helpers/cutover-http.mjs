// Synthetic HTTP boundary for operator verification tests. Never opens a socket.
import {requestContext,checkRequestOrigin} from '../../app/security/request.mjs';
export function mockAcceptanceHTTP(token,{origin,artDigest}={}) {
  const original=globalThis.fetch,identities=new Map();
  const state={revision:1,members:[{id:'one',unlocked:['1']},{id:'two',unlocked:['2']}]},pool={eligible:[{id:'1'}],excluded:[]};
  const counts={masterProbes:0,overlayRevoked:false,originChecks:0};let sequence=0;
  globalThis.fetch=async(url,options)=>{
    const route=new URL(url).pathname,headers=options.headers,body=options.body?JSON.parse(options.body):null;
    const master=headers.Authorization===`Bearer ${token}`,identity=identities.get(headers.Cookie);
    const response=(status,value={},extra={})=>new Response(JSON.stringify(value),{status,headers:extra});
    if(body){
      const request={headers:Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value])),socket:{remoteAddress:'127.0.0.1'}};
      request.headers.host=new URL(url).host;
      try{checkRequestOrigin(request,requestContext(request,{host:'127.0.0.1',publicOrigin:origin}));counts.originChecks++;}catch(error){return response(error.status);}
    }
    if(master&&!route.startsWith('/api/invites'))counts.masterProbes++;
    if(route==='/api/invites'&&body){
      const role=body.admin?'admin':body.viewer?'viewer':'member',id=String(++sequence),key='probe-'+id;
      identities.set(key,{role,id,revoked:false});return response(201,{invite:{id},link:'https://scratch.invalid/join/'+id});
    }
    if(route.startsWith('/join/')){const item=[...identities.entries()].find(([,v])=>v.id===route.slice(6));return response(303,{}, {'set-cookie':item[0]+'; HttpOnly'});}
    if(/\/api\/invites\/\d+\/revoke/.test(route)){const id=route.split('/')[3];for(const v of identities.values())if(v.id===id)v.revoked=true;return response(200);}
    const overlay=Boolean(headers.Authorization&&!master);
    if(route==='/api/overlays'&&body)return response(201,{overlay:{id:'overlay'},link:'https://scratch.invalid/overlay#key='+'q'.repeat(43)});
    if(route==='/api/overlays/overlay/revoke'){counts.overlayRevoked=true;return response(200);}
    if(route==='/overlay/data')return response(counts.overlayRevoked?401:new URL(url).searchParams.get('widget')==='goals'?403:200);
    if(overlay||identity?.revoked)return response(401);
    if(route==='/api/health')return response(200,{ready:true});
    if(route==='/api/state')return response(200,{state,pools:{one:pool,two:pool}});
    if(route==='/api/tasks')return response(200,{tasks:[{id:'synthetic'}]});
    if(route==='/api/art-status')return response(200,{pack:{available:true,kind:'art',digest:artDigest},availableRoutes:['/art/probe.png']});
    if(route==='/art/probe.png')return new Response(options.method==='HEAD'?null:'pixels',{headers:{etag:'"synthetic"'}});
    if(route==='/api/session')return response(200,{admin:identity.role==='admin',readOnly:identity.role==='viewer'});
    if(route==='/api/invites'||route==='/api/restore'||route==='/api/command')return response(403);
    return response(404);
  };
  return {counts,identities,restore:()=>{globalThis.fetch=original;}};
}
