import { readFile, readdir } from 'node:fs/promises';
export function requireNode() { const [a,b] = process.versions.node.split('.').map(Number); if (a < 24 || a === 24 && b < 20) throw Error('Node 24.20+ required'); }
export const summary = values => { const a = values.filter(Number.isFinite).sort((x,y)=>x-y), q = p => a.length ? a[Math.ceil(a.length*p)-1] : null; return { n:a.length, p50:q(.5), p95:q(.95), p99:q(.99), min:a[0]??null, max:a.at(-1)??null }; };
export async function processes() {
  return (await Promise.all((await readdir('/proc')).filter(x=>/^\d+$/.test(x)).map(async id=>{
    try { const [s,c] = await Promise.all([readFile(`/proc/${id}/stat`,'utf8'),readFile(`/proc/${id}/cmdline`,'utf8')]), f=s.slice(s.lastIndexOf(')')+2).split(' ');
      return { pid:+id, ppid:+f[1], state:f[0], key:`${id}:${f[19]}`, ticks:+f[11]+ +f[12], rss:+f[21]*4096, calculator:c.split('\0').some(x=>x.endsWith('/app/tasks/process-worker-host.mjs')) };
    } catch(e) { if(!['ENOENT','ESRCH'].includes(e.code))throw e; }
  }))).filter(Boolean);
}
export function tree(all,pid) { const ids=new Set([pid]); let changed=true; while(changed){changed=false;for(const p of all)if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}return all.filter(p=>ids.has(p.pid)); }
