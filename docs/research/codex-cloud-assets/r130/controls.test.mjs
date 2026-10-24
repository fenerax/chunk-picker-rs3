import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {validateCase} from './result-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('R130 source payload exact hashes and admission-only portability diff',async()=>{const original=await readFile(new URL('./assets/exact-r114-driver.mjs',import.meta.url));assert.equal(hash(original),'f0030bb006397b0078853af20cd326b3819315a3092b35abaddb1757391cce32');const p=await readFile(new URL('./assets/r49-production-v2.patch',import.meta.url));assert.equal(p.length,3734);assert.equal(hash(p),'de1710639fdf88a57d6d7d945c310c89e06dc99635dbbb7898c33e963a572c9a');const s=await readFile(new URL('./assets/portable-driver.mjs',import.meta.url),'utf8');const old=original.toString();assert.equal(s.slice(s.indexOf('const [arm,mode')),old.slice(old.indexOf('const [arm,mode')));});
test('R130 result admission rejects empty, incomplete and false file-only success',()=>{assert.throws(()=>validateCase([],'','process'));assert.throws(()=>validateCase([],'ℹ pass 1\nℹ fail 0\n✔ hidden-file.mjs','process'));assert.throws(()=>validateCase([{phase:'R114-constructor',generation:1}],'ℹ pass 1\nℹ fail 0\n✔ incomplete','thread'));});
import {applyUnifiedPatch} from './strict-patch.mjs';
test('R130 exact patch engine preserves untouched lines and fails context/target/count drift',()=>{
 const patch='diff --git a/app/server.mjs b/app/server.mjs\n--- a/app/server.mjs\n+++ b/app/server.mjs\n@@ -2,2 +2,3 @@\n b\n-c\n+C\n+D\ndiff --git a/app/tasks/worker.mjs b/app/tasks/worker.mjs\n--- a/app/tasks/worker.mjs\n+++ b/app/tasks/worker.mjs\n@@ -1,1 +1,1 @@\n-x\n+X\n';
 const originals=new Map([['app/server.mjs','a\nb\nc\nz\n'],['app/tasks/worker.mjs','x\ny\n']]);
 const out=applyUnifiedPatch(patch,originals);
 assert.equal(out.get('app/server.mjs'),'a\nb\nC\nD\nz\n');assert.equal(out.get('app/tasks/worker.mjs'),'X\ny\n');
 assert.equal(originals.get('app/server.mjs'),'a\nb\nc\nz\n');
 for(const bad of [patch.replace('-c','-wrong'),patch.replace('app/server.mjs','../../escape'),patch.replace('+2,3','+2,4'),patch+'unexpected\n'])assert.throws(()=>applyUnifiedPatch(bad,originals));
});
