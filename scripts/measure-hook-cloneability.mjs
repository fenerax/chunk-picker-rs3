// Synthetic-only codec experiment. Run under the shared heavy lock.
// node scripts/measure-hook-cloneability.mjs
import { encodeImportBytes, decodeImportBytes } from '../app/import-bytes.mjs';
const source = Object.fromEntries(Array.from({length:1_000_000},(_,i)=>[`entry-${i}`,i%10]));
async function measure(work) {
  let last=performance.now(),gap=0;
  const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;},5);
  const start=performance.now();
  try { const result=await work();await new Promise(r=>setTimeout(r,5));return {result,ms:performance.now()-start,gap:Math.max(gap,performance.now()-last)}; }
  finally {clearInterval(timer);}
}
for (const indexed of [true,false]) {
  const decoded=await decodeImportBytes(await encodeImportBytes(source),{indexDictionaries:indexed});
  let cloneable;
  try {structuredClone(decoded);cloneable=true;} catch(error) {if(error.name!=='DataCloneError')throw error;cloneable=false;}
  delete decoded['entry-0'];decoded.added='Synthetic';Object.defineProperty(decoded,'defined',{value:42,enumerable:true});
  const encoded=await measure(()=>encodeImportBytes(decoded));
  const result=await decodeImportBytes(encoded.result);
  if(Object.hasOwn(result,'entry-0')||result.added!=='Synthetic'||result.defined!==42)throw new Error('Lost hook edit');
  console.log(JSON.stringify({indexed,cloneable,encodeMs:encoded.ms,gapMs:encoded.gap}));
}
