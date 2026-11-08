import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let ticks;
const cpuSeen=new Map();
export async function processTree(pid,{platform=process.platform,read=readFile,ticksPerSecond}={}) {
  if(platform!=='linux') return {supported:false,availability:'unavailable',rssBytes:null,cpuSeconds:null,readBytes:null,writeBytes:null};
  const clockTicks=ticksPerSecond??(ticks??=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim()));
  const seen=new Set(), rows=[];let complete=true;
  async function visit(id) {
    if(seen.has(id)) return; seen.add(id);
    try {
      const [stat,status,io]=await Promise.all([
        read(`/proc/${id}/stat`,'utf8'),read(`/proc/${id}/status`,'utf8'),read(`/proc/${id}/io`,'utf8')]);
      const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
      const number=(text,key)=>Number(new RegExp(`^${key}:\\s+(\\d+)`,'m').exec(text)?.[1]??0);
      const cpuSeconds=(Number(fields[11])+Number(fields[12]))/clockTicks;
      cpuSeen.set(`${pid}:${id}:${fields[19]}`,cpuSeconds);
      let pssBytes=null;try{pssBytes=number(await read(`/proc/${id}/smaps_rollup`,'utf8'),'Pss')*1024;}catch{}
      rows.push({pid:id,rssBytes:number(status,'VmRSS')*1024,cpuSeconds,pssBytes,
        readBytes:number(io,'read_bytes'),writeBytes:number(io,'write_bytes'),swapBytes:number(status,'VmSwap')*1024});
    } catch(error) {
      // An exited descendant can disappear between discovery and its stat read.
      if(id===pid||error.code!=='ENOENT')complete=false;
      return;
    }
    // Discovery failure must not discard the readings collected above.
    try {
      const children=await read(`/proc/${id}/task/${id}/children`,'utf8');
      await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(n=>visit(Number(n))));
    } catch {complete=false;}
  }
  await visit(pid);
  const cgroup={};
  for(const name of ['memory.current','memory.peak','memory.max','cpu.max'])try{cgroup[name]=String(await read(`/sys/fs/cgroup/${name}`,'utf8')).trim();}catch{}
  return {supported:true,availability:complete?'available':'unavailable',processes:complete?rows.length:null,
    root:rows.find(row=>row.pid===pid)??null,observedProcesses:rows.length,cgroup,
    ...Object.fromEntries(['rssBytes','readBytes','writeBytes','swapBytes'].map(k=>[k,complete?rows.reduce((n,r)=>n+r[k],0):null])),
    pssBytes:complete&&rows.every(row=>row.pssBytes!==null)?rows.reduce((n,r)=>n+r.pssBytes,0):null,
    cpuSeconds:complete?[...cpuSeen].filter(([key])=>key.startsWith(`${pid}:`)).reduce((n,[,value])=>n+value,0):null};
}
export async function diskBytes(directory) {
  let bytes=0,files=0;
  async function walk(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const target=path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw new Error('Scratch telemetry refuses symlinks.');
      if(entry.isDirectory()) await walk(target);
      else { try { bytes+=(await lstat(target)).size; files++; } catch(error) { if(error.code!=='ENOENT') throw error; } }
    }
  }
  await walk(directory); return {bytes,files};
}
