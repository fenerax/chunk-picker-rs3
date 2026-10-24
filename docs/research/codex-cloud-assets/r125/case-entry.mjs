// Wrapper-compatible .mjs entry. Wrapper FD3 is a JSONL pipe, never IPC.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { ensure, STAGES, publicResult, ancestors, waitDrained } from './focus-core.mjs';
const started = performance.now(), ownAncestors = ancestors();
let child, state, received, protocolError = false, forced = false, stopTimer, killTimer;
const emit = stage => { ensure(STAGES.has(stage), 'unadmitted-stage'); fs.writeSync(3, JSON.stringify({ stage }) + '\n'); };
function stop() {
  forced = true;
  if (child && !state?.exited && child.connected) try { child.send({ type: 'stop' }, () => {}); } catch {}
  stopTimer ??= setTimeout(() => { if (child && !state?.exited) child.kill('SIGTERM'); }, 2000);
  killTimer ??= setTimeout(() => { if (child && !state?.exited) child.kill('SIGKILL'); }, 4000);
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const watchdog = setTimeout(stop, 184000);
let result = { passed: false, status: 'failed', cleanupPassed: false };
try {
  ensure(process.argv.length === 2 && process.version === 'v24.19.0' && process.env.PERF_STAGE_FD === '3', 'entry-contract');
  const stageHandle = fs.fstatSync(3);
  ensure(!process.send && (stageHandle.isFIFO() || stageHandle.isSocket()), 'raw-wrapper-stage-fd');
  emit('start');
  child = fork(new URL('./focus-controller.mjs', import.meta.url), [], {
    execArgv: ['--max-old-space-size=768'], env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  state = { exited: false, bytes: 0, error: null }; let stageBytes = 0;
  const closed = new Promise((resolve, reject) => {
    child.once('error', error => { state.error = error; });
    child.once('exit', (code, signal) => { state.exited = true; state.exit = { code, signal }; });
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.on('message', message => {
      try {
        stageBytes += Buffer.byteLength(JSON.stringify(message)); ensure(stageBytes <= 1048576, 'controller-ipc-cap');
        if (message?.schema === 'r125-focus-stage-v1') emit(message.stage);
        else { ensure(message?.schema === 'r125-focus-result-v1' && !received, 'controller-result-cardinality'); received = message.result; }
      } catch { protocolError = true; stop(); }
    });
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { state.bytes += bytes.length; if (state.bytes > 1048576) { protocolError = true; stop(); } });
  const hard = setTimeout(() => { stop(); child.stdout.destroy(); child.stderr.destroy(); }, 189000);
  let outcome;
  try { outcome = await closed; } finally { clearTimeout(hard); }
  ensure(!state.error && !protocolError && !forced && outcome.signal === null && state.exit?.signal === null
    && received && (outcome.code === 0 || outcome.code === 1 && received.status === 'failed'), 'controller-exit-protocol');
  await waitDrained(ownAncestors, 2000);
  result = { ...received, controllerDrainPassed: true };
} catch { result.passed = false; result.status = 'failed'; result.cleanupPassed = false; result.code = 'r125-entry-failed'; try { emit('error'); } catch {} }
finally {
  clearTimeout(watchdog); clearTimeout(stopTimer); clearTimeout(killTimer);
  result = publicResult(result);
  const bytes = JSON.stringify(result) + '\n';
  try { ensure(Buffer.byteLength(bytes) <= 32768, 'result-cap'); fs.writeFileSync('/scratch/case-result.json', bytes, { flag: 'wx', mode: 0o600 }); emit('result'); }
  catch { result.passed = false; }
  process.exitCode = result.passed ? 0 : 1;
  try { fs.closeSync(3); } catch {}
}
