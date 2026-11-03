import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

// Pause real calculator/publisher threads after writing their reserved temp
// bytes. The one-shot preload leaves calculation code and input data intact.
export async function runWarmWriterProbe(directory, partition, source) {
  const preload = path.join(directory, 'pause-writer.mjs'), script = path.join(directory, 'probe.mjs'), armed = path.join(directory, 'pause-armed');
  await writeFile(armed, 'synthetic gate');
  await writeFile(preload, `
    import fs from 'node:fs';
    import path from 'node:path';
    import { parentPort, isMainThread } from 'node:worker_threads';
    import { syncBuiltinESMExports } from 'node:module';
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      const result = write(file, ...args);
      if (!isMainThread && path.dirname(file) === ${JSON.stringify(path.join(directory, partition))}
        && file.endsWith('.tmp') && fs.existsSync(${JSON.stringify(armed)})) {
        fs.unlinkSync(${JSON.stringify(armed)});
        parentPort.postMessage({ type: 'test-warm-lock-held', file });
        if (Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000) === 'timed-out') throw Error('Synthetic writer gate timed out');
      }
      return result;
    };
    syncBuiltinESMExports();
  `);
  // Start with the preload in execArgv so native workers inherit it without
  // adding a test hook to the scheduler or publisher's production API.
  await writeFile(script, `
    import assert from 'node:assert/strict';
    import { readdir, readFile, utimes } from 'node:fs/promises';
    import path from 'node:path';
    import { Worker } from 'node:worker_threads';
    const directory = ${JSON.stringify(directory)};
    let resolveHeld;
    const heldMessage = new Promise(resolve => { resolveHeld = resolve; });
    const emit = Worker.prototype.emit;
    Worker.prototype.emit = function(event, ...args) {
      if (event === 'message' && args[0]?.type === 'test-warm-lock-held') resolveHeld({ worker: this, file: args[0].file });
      return emit.call(this, event, ...args);
    };
    async function held() {
      let timer;
      try {
        return await Promise.race([heldMessage, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Writer never held its lock')), 10000);
        })]);
      } finally { clearTimeout(timer); }
    }
    ${source}
  `);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, script], {
    env: { ...process.env, RS3_TASK_WORKER_MODE: 'thread' }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 15000);
  try { assert.equal((await once(child, 'close'))[0], 0, stderr); }
  finally { clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL'); }
}
