// Optional host-side functional predicate. Reads the wrapper's already public final.
import fs from 'node:fs';
import { focusAccepted } from './focus-core.mjs';
if (process.argv.length !== 3) throw new Error('one public final.json argument required');
const fd = fs.openSync(process.argv[2], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
let result;
try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 1048576) throw new Error('small regular public result required');
  const data = Buffer.alloc(1048577), n = fs.readSync(fd, data, 0, data.length, 0); if (n > 1048576) throw new Error('result cap');
  result = JSON.parse(data.subarray(0, n).toString('utf8'));
} finally { fs.closeSync(fd); }
const focusPassed = focusAccepted(result);
console.log(JSON.stringify({ schema: 'r125-focus-host-decision-v1', focusPassed,
  scope: 'one controlled Alpha Personal case', otherNativeCases: 'OPEN', allSLOs: 'OPEN' }));
process.exitCode = focusPassed ? 0 : 1;
