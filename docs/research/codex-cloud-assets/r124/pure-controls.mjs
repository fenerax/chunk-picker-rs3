import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as original from './oracle-original.mjs';
import * as portable from './oracle-portable.mjs';
original.negativeControls();portable.negativeControls();
const shared={u:undefined,n:NaN,negativeZero:-0,big:42n};Object.defineProperty(shared,'hidden',{value:new Map([[undefined,new Set([1,'a'])]])});
const x={metrics:{elapsedMs:1},array:[shared,shared],nullPrototype:Object.create(null)};x.self=x;
assert.equal(original.fingerprint(x),portable.fingerprint(x));
const different={...x,metrics:{elapsedMs:999}};different.self=different;
assert.equal(original.fingerprint(x,true),portable.fingerprint(different,true));
const d=mkdtempSync(join(tmpdir(),'r124-pure-'));portable.configureOutput(d);
try{const hash=portable.fingerprint(x,true);assert.equal(hash,original.fingerprint(x,true));assert.equal(createHash('sha256').update(readFileSync(join(d,'full-result-00.tokens.ndjson'))).digest('hex'),hash);}finally{rmSync(d,{recursive:true});}
assert.throws(()=>portable.fingerprint({bad:new Date()}),/unsupported prototype at \$.bad/);
assert.throws(()=>portable.fingerprint({get bad(){return 1;}}),/unsupported accessor at \$.bad/);
console.log('R124 PURE PASS: original/portable oracle controls; exact token parity, descriptors, Map/Set, undefined, cycles, root-only elapsed exception, fail-closed shapes');
