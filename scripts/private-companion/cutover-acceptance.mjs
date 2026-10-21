// Fresh, revocable probes only. No successful gameplay command is submitted.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Keep this leaf independent of the CLI module's top-level await.
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};

export async function verifyAcceptance(context, verifyOwner) {
  const c = context.candidate;
  const token = (await readFile(path.join(c.dataDir,'access-token'),'utf8')).trim();
  check(/^[A-Za-z0-9_-]{43}$/.test(token),'ADMIN_CREDENTIAL');
  const base = `http://${c.host}:${c.port}`, master = {Authorization:`Bearer ${token}`};
  let probeHeaders=master;
  async function request(route,{headers=probeHeaders,body,expected=200,method=body===undefined?'GET':'POST'}={}) {
    check(typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !route.includes('://'),'LOCAL_ROUTE_REQUIRED');
    await verifyOwner();
    // This is a direct local request, not a Funnel request. Cookie mutations
    // must use this transport's origin; hosted-device acceptance is separate.
    const response = await fetch(base+route,{method,redirect:'manual',signal:AbortSignal.timeout(120000),headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if (response.status !== expected) {
      await response.body?.cancel();
      const phase=route.startsWith('/join/')?'JOIN':route.startsWith('/api/invites')?'INVITES':route.startsWith('/api/overlays')||route.startsWith('/overlay/')?'OVERLAY':route==='/api/health'?'HEALTH':route==='/api/state'?'STATE':route.startsWith('/api/tasks')?'TASKS':route==='/api/art-status'?'ART_STATUS':route==='/api/session'?'SESSION':route==='/api/restore'?'RESTORE_DENIAL':route==='/api/command'?'COMMAND_DENIAL':'ART';
      const status=({400:'BAD_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',429:'RATE_LIMIT',500:'SERVER_ERROR'})[response.status]??'UNEXPECTED_STATUS';
      check(false,`ACCEPTANCE_HTTP_${phase}_${status}`);
    }
    return response;
  }
  const json = async (route,options) => (await request(route,options)).json();
  const cancel = async (route,options) => { const response = await request(route,options); await response.body?.cancel(); };
  const summaries = [];
  const invites = [], overlays = [],sessions=new Map();
  let cleanupFailed = false,art;
  try {
  // The retained credential only bootstraps and cleans up temporary access.
  // Every health/gameplay/art/session probe uses fresh scratch credentials.
  const admin = await json('/api/invites',{headers:master,body:{label:'M7 temporary acceptance probe',admin:true},expected:201});
  invites.push(admin.invite.id);
  const adminJoin=await request(new URL(admin.link).pathname,{headers:{},expected:303});
  const adminCookie=adminJoin.headers.get('set-cookie')?.split(';')[0];await adminJoin.body?.cancel();check(adminCookie,'SCRATCH_SESSION_REQUIRED');
  probeHeaders={Cookie:adminCookie};
  sessions.set(admin.invite.id,probeHeaders);
  const health = await json('/api/health'); check(health.ready,'NOT_READY');
  const envelope = await json('/api/state'), state = envelope.state;
  check(state?.members?.length === 2 && envelope.pools,'BOTH_MEMBERS_REQUIRED');
  const snapshot=JSON.parse(await readFile(path.join(context.p.snapshotRoot,'operational','data','state.json'),'utf8'));
  check(state.revision===snapshot.state.revision,'SAVE_CHANGED_AFTER_SNAPSHOT');
  for (const member of state.members) {
    const tasks = await json(`/api/tasks?memberId=${encodeURIComponent(member.id)}`), pool = envelope.pools[member.id];
    check(Array.isArray(tasks.tasks) && tasks.tasks.length && Array.isArray(pool?.eligible) && Array.isArray(pool?.excluded),'TASKS_AND_POOLS_REQUIRED');
    summaries.push({tasks:tasks.tasks.length,eligible:pool.eligible.length,excluded:pool.excluded.length,tasksSha256:digest(JSON.stringify(tasks.tasks)),poolSha256:digest(JSON.stringify(pool))});
  }
  art = await json('/api/art-status'); check(art.pack?.available === true && art.pack.kind === 'art' && art.pack.digest === c.packs.art.sha256 && art.availableRoutes?.length,'INSTALLED_ART_REQUIRED');
  for (const route of art.availableRoutes) {
    const response = await request(route), bytes = await response.arrayBuffer(); check(bytes.byteLength > 0 && response.headers.get('etag'),'ART_REQUIRED');
    const head = await request(route,{method:'HEAD'}); check((await head.arrayBuffer()).byteLength === 0 && head.headers.get('etag')===response.headers.get('etag'),'ART_HEAD');
  }
    for (const role of ['admin','member','viewer']) {
      const properties = role === 'admin' ? {admin:true} : role === 'viewer' ? {viewer:true} : {memberId:state.members[0].id};
      let headers=probeHeaders;
      if(role!=='admin'){
        const created = await json('/api/invites',{body:{label:'M7 temporary acceptance probe',...properties},expected:201});
        invites.push(created.invite.id);
        const joined = await request(new URL(created.link).pathname,{headers:{},expected:303});
        const cookie = joined.headers.get('set-cookie')?.split(';')[0]; await joined.body?.cancel(); check(cookie,'SCRATCH_SESSION_REQUIRED');
        headers={Cookie:cookie};
        sessions.set(created.invite.id,headers);
      }
      const session = await json('/api/session',{headers});
      check(session.admin === (role === 'admin') && session.readOnly === (role === 'viewer'),'SESSION_ROLE');
      await json('/api/state',{headers}); await cancel(art.availableRoutes[0],{headers});
      if (role !== 'admin') await cancel('/api/invites',{headers,expected:403});
      if (role === 'viewer') await cancel('/api/command',{headers,body:{expectedRevision:state.revision,command:{type:'set-note',memberId:state.members[0].id,chunkId:state.members[0].unlocked[0],note:'M7 denied probe'}},expected:403});
      if (role === 'member') await cancel('/api/restore',{headers,body:{expectedRevision:state.revision},expected:403});
    }
    const overlay = await json('/api/overlays',{body:{label:'M7 temporary acceptance probe',widget:'count',player:'duo'},expected:201});
    overlays.push(overlay.overlay.id);
    const key = new URLSearchParams(new URL(overlay.link).hash.slice(1)).get('key'); check(key,'SCRATCH_OVERLAY_REQUIRED');
    const headers = {Authorization:`Bearer ${key}`};
    await json('/overlay/data?widget=count&player=duo&variant=full',{headers});
    await cancel('/api/state',{headers,expected:401});
    await cancel('/overlay/data?widget=goals&player=duo&variant=full',{headers,expected:403});
    await cancel('/api/dataset-runtime',{headers,expected:401});
    await json(`/api/overlays/${overlay.overlay.id}/revoke`,{body:{}}); overlays.pop();
    await cancel('/overlay/data?widget=count&player=duo&variant=full',{headers,expected:401});
    const after = await json('/api/state'); check(digest(JSON.stringify(after.state)) === digest(JSON.stringify(state)),'ACCEPTANCE_CHANGED_GAMEPLAY');
  } finally {
    // IDs and tokens stay in memory. Failure to revoke blocks acceptance.
    for (const id of overlays) try { await json(`/api/overlays/${id}/revoke`,{headers:master,body:{}}); } catch { cleanupFailed=true; }
    for (const id of invites.reverse()) try {
      await json(`/api/invites/${id}/revoke`,{headers:master,body:{}});
      if(sessions.has(id))await cancel('/api/state',{headers:sessions.get(id),expected:401});
    } catch { cleanupFailed=true; }
    check(!cleanupFailed,'SCRATCH_REVOCATION_FAILED');
  }
  return {health:true,members:summaries,artRoutes:art.availableRoutes.length,admin:true,member:true,viewer:true,overlay:true,scratchCredentialsRevoked:true,gameplayUnchanged:true,existingHostedSessions:context.p.mode==='live'?'external gate required':'not established'};
}
