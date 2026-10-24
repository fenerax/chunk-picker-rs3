import assert from 'node:assert/strict';
export function validateCase(rows,text,mode){
 assert.match(text,/ℹ pass 1/);assert.match(text,/ℹ fail 0/);
 assert.equal(text.split('\n').filter(x=>x.startsWith('✔ ')).length,1);
 const fixture=rows.filter(x=>x.phase==='R114-fixture');assert.equal(fixture.length,1);assert.equal(fixture[0].sha256,'e46b59151a55bfaf5101f6f542118c1a8e4b860f5eed6b8dd34ab3ad436a465c');assert.equal(fixture[0].datasetDigest,'f129828c58260ba4894f2cb6ed7287c07c8f5360cb8d0a1716a5f26ddb9dfbc0');
 const constructors=rows.filter(x=>x.phase==='R114-constructor');assert.ok(constructors.length>=4);
 for(const c of constructors){assert.deepEqual(c.inputKeys,[mode==='process'?'definitionV8Bytes':'definitions']);for(const kind of ['R114-decoder','R114-READY'])assert.ok(rows.some(x=>x.phase===kind&&x.generation===c.generation&&x.lifetime===c.lifetime));if(mode==='process')assert.ok(rows.some(x=>x.phase==='R114-process-exit'&&x.generation===c.generation&&x.pid===c.childPid&&x.code===0&&x.signal===null));}
 for(let restart=0;restart<2;restart++){for(const label of ['initial','wake'])assert.equal(rows.filter(x=>x.phase==='R114-native-proof'&&x.restart===restart&&x.label===label).length,1);assert.equal(rows.filter(x=>x.phase==='R114-app-close-awaited'&&x.restart===restart).length,1);const removed=rows.filter(x=>x.phase==='R114-store-removed'&&x.restart===restart);assert.equal(removed.length,1);assert.equal(removed[0].storeAbsent,true);assert.equal(removed[0].bindingAbsent,true);}
 return constructors.length;
}
