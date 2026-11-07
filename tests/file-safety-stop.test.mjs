import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('file safety stop covers a blocked main thread and reports its file and active tests', async () => {
  const source = (await readFile(new URL('./helpers/file-safety-stop.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(import.meta.url));
  let callback, milliseconds, receive;
  const writes = [], signals = [];
  // Evaluate the actual worker branch with a controlled timer and process. No
  // real worker has to hang, and no process has to die, to verify the stop.
  new Function('Worker', 'isMainThread', 'parentPort', 'workerData', 'writeSync', 'process', 'setTimeout', source)(
    class {}, false, { on(event, action) { assert.equal(event, 'message'); receive = action; } },
    { fileSafetyStop: true, file: 'tests/synthetic.test.mjs' },
    (fd, message) => writes.push({ fd, message }),
    { pid: 123, kill: (...args) => signals.push(args) },
    (action, delay) => { callback = action; milliseconds = delay; },
  );
  assert.equal(milliseconds, 30 * 60_000);
  assert.deepEqual(signals, []);
  receive(['synthetic blocked test']); callback();
  assert.deepEqual(signals, [[123, 'SIGTERM']]);
  assert.equal(writes.length, 1); assert.equal(writes[0].fd, 2);
  assert.match(writes[0].message, /tests\/synthetic.test.mjs/);
  assert.match(writes[0].message, /PID 123; active tests: synthetic blocked test/);
  assert.match(writes[0].message, /pending events, controlled clocks, child exits/);
});
