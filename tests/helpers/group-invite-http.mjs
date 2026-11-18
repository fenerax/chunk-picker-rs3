import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const origin = 'https://picker.example';
export async function groupHttpFixture(t, { crashPoint, beforeCommit } = {}) {
 const root = await mkdtemp(path.join(tmpdir(), 'group-invite-http-'));
 const secretFile = path.join(root,'secret'); await writeFile(secretFile,'synthetic-secret');
 const old = new Map(['RS3_DISCORD_CLIENT_ID','RS3_DISCORD_CLIENT_SECRET_FILE','RS3_GOOGLE_CLIENT_ID','RS3_GOOGLE_CLIENT_SECRET_FILE'].map(k=>[k,process.env[k]]));
 process.env.RS3_DISCORD_CLIENT_ID='synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE=secretFile;
 delete process.env.RS3_GOOGLE_CLIENT_ID; delete process.env.RS3_GOOGLE_CLIENT_SECRET_FILE;
 const {createServer} = await import('../../app/server.mjs'); const {createGroupState}=await import('../../app/core/state.mjs');
 const grants=new Map(), access=new Map(); let n=0, app;
 const provider={async fetch(url,options){
  if(url.endsWith('/oauth2/token')){const form=new URLSearchParams(options.body), grant=grants.get(form.get('code')); assert.ok(grant); assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),grant.challenge); const token='synthetic-'+form.get('code');access.set(token,grant.subject);return Response.json({access_token:token});}
  assert.equal(url,'https://discord.com/api/users/@me');return Response.json({id:access.get(options.headers.Authorization.slice(7))});
 }};
 const multiPicker={registryDir:path.join(root,'registry'),pickerRoot:path.join(root,'pickers'),tombstoneDir:path.join(root,'ledger'),registrationsGlobal:100,registrationsPerAccount:100,crashPoint};
 async function start(){app=await createServer({dataDir:path.join(root,'legacy'),definitions:{challenges:{},chunks:{'12341':{}},walkableChunks:['12341'],walkableChunksF2P:['12341']},taskMap:{},initialState:createGroupState([{id:'one',name:'Player 1'},{id:'two',name:'Player 2'}]),port:0,loopbackPort:0,loopbackRole:'public',publicOrigin:origin,signIn:'optional',signInProvider:provider,multiPicker,beforeCommit,predictionPrewarm:false,shutdownDeadlineMs:500,rateLimits:{unauthenticated:10000}});await app.listen();}
 await start();
 const send=(route,cookie='',body,extra={})=>new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:JSON.stringify(body); const req=http.request(`http://127.0.0.1:${app.loopbackAddress().port}${route}`,{method:body===undefined?'GET':'POST',agent:false,headers:{Host:'picker.example','X-Forwarded-For':'203.0.113.7','X-Forwarded-Proto':'https',...(cookie?{Cookie:cookie}:{}),...(bytes?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes),Origin:origin}:{}),...extra}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));res.on('error',reject);});req.on('error',reject);req.end(bytes);
 });
 const cookies=(response,previous='')=>{const map=new Map(previous.split('; ').filter(Boolean).map(c=>c.split('=')));for(const cookie of response.headers['set-cookie']??[]){const [key,value]=cookie.split(';')[0].split('=');map.set(key,value);}return [...map].map(([k,v])=>`${k}=${v}`).join('; ');};
 async function login(subject,cookie=''){const begun=await send('/auth/discord',cookie);assert.equal(begun.status,303,begun.text);const auth=new URL(begun.headers.location),code=String(++n);grants.set(code,{subject,challenge:auth.searchParams.get('code_challenge')});cookie=cookies(begun,cookie);const result=await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,cookie);assert.equal(result.status,303,result.text);return {cookie:cookies(result,cookie),response:result};}
 const document=()=>readFile(path.join(multiPicker.registryDir,'registry.json'),'utf8').then(JSON.parse);
 t.after(async()=>{await app.close();await rm(root,{recursive:true});for(const[k,v]of old){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 return {send,cookies,login,document,root,multiPicker,restart:async()=>{await app.close();await start();},app:()=>app};
}
