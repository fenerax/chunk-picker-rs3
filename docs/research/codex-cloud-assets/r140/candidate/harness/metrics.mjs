// R37 sampler narrowed: approximate owned descendants only; no hostname/cgroup paths.
import {readdir,readFile} from 'node:fs/promises';
export async function processTree(root){
 const entries=await readdir('/proc');if(entries.length>20000)throw Error('process observation cap');const all=[];
 for(const name of entries.filter(x=>/^\d+$/.test(x)))try{const raw=await readFile(`/proc/${name}/stat`,'utf8'),f=raw.slice(raw.lastIndexOf(')')+2).split(' ');all.push({pid:+name,ppid:+f[1],startTicks:f[19],cpuTicks:+f[11]+ +f[12]});}catch{}
 const owned=new Set([root]);let changed;do{changed=false;for(const p of all)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}while(changed);if(owned.size>256)throw Error('owned process cap');
 const rows=[];for(const p of all.filter(p=>owned.has(p.pid))){try{const s=await readFile(`/proc/${p.pid}/status`,'utf8');let pssKiB=null;try{pssKiB=+(/^Pss:\s+(\d+)/m.exec(await readFile(`/proc/${p.pid}/smaps_rollup`,'utf8'))?.[1]??NaN);}catch{}rows.push({...p,affinity:s.match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1],rssKiB:s.match(/^VmRSS:\s*(\d+)/m)?+(s.match(/^VmRSS:\s*(\d+)/m)[1]):null,pssKiB,threadAffinities:{status:'not individually sampled; Docker cgroup affinity is authoritative'}});}catch{rows.push({...p,observation:'unknown'});}}
 return {rows,rssKiB:rows.length&&rows.every(p=>Number.isFinite(p.rssKiB))?rows.reduce((n,p)=>n+p.rssKiB,0):null,rssUnknown:rows.filter(p=>!Number.isFinite(p.rssKiB)).length,pssUnknown:rows.filter(p=>!Number.isFinite(p.pssKiB)).length,pssKiB:rows.length&&rows.every(p=>Number.isFinite(p.pssKiB))?rows.reduce((n,p)=>n+p.pssKiB,0):null,scope:'approximate sampled descendants; Docker container ownership/cgroup memory is authoritative'};
}
