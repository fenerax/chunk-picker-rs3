// Pure exact-context unified patch reader. No shell, Git, Python or patch binary.
import assert from 'node:assert/strict';
export function applyUnifiedPatch(text, sources) {
 const lines=text.split('\n'), outputs=new Map();let i=0;
 while(i<lines.length && lines[i]) {
  const header=/^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[i++]);
  assert.ok(header && header[1]===header[2], 'patch-header');
  const name=header[1];assert.ok(['app/tasks/scheduler.mjs','app/tasks/worker.mjs'].includes(name),'patch-target');
  assert.ok(!outputs.has(name),'duplicate-patch-target');
  assert.equal(lines[i++],'--- a/'+name);assert.equal(lines[i++],'+++ b/'+name);
  const original=sources.get(name);assert.equal(typeof original,'string');assert.ok(original.endsWith('\n'));
  const input=original.slice(0,-1).split('\n'), output=[];let cursor=0,hunks=0;
  while(i<lines.length && lines[i].startsWith('@@')) {
   const h=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[i++]);assert.ok(h,'hunk-header');hunks++;
   const start=Number(h[1])-1, oldCount=Number(h[2]), newStart=Number(h[3])-1,newCount=Number(h[4]);
   assert.ok(start>=cursor&&start<=input.length,'hunk-order');output.push(...input.slice(cursor,start));cursor=start;
   assert.equal(output.length,newStart,'new-hunk-offset');let removed=0,added=0;
   while(i<lines.length && /^[ +\-]/.test(lines[i])) {
    const line=lines[i++],tag=line[0],value=line.slice(1);
    if(tag===' '||tag==='-'){assert.equal(input[cursor++],value,'exact-hunk-context');removed++;}
    if(tag===' '||tag==='+'){output.push(value);added++;}
   }
   assert.equal(removed,oldCount,'old-hunk-count');assert.equal(added,newCount,'new-hunk-count');
  }
  assert.ok(hunks>0);output.push(...input.slice(cursor));outputs.set(name,output.join('\n')+'\n');
 }
 assert.equal(i,lines.length-1,'patch-trailing-content');assert.equal(outputs.size,2,'patch-target-count');return outputs;
}
