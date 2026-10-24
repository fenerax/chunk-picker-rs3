// Own IPC fd3 is newly allocated by fork; entry's raw stage fd is not inherited.
delete process.env.PERF_STAGE_FD;
import assert from 'node:assert/strict';
assert.equal(typeof process.send,'function');
const log=console.log.bind(console);
console.log=(...args)=>{log(...args);if(typeof args[0]==='string'&&args[0].startsWith('{')){let row;try{row=JSON.parse(args[0]);}catch{return;}if(row.phase==='R114-READY')process.send({stage:process.env.R130_CELL==='1'?'reference-ready':'measured-ready'});}};
await import('./portable-driver.mjs');
