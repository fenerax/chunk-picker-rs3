// Small controller helpers; importing this module starts no child or service.
export function deadline(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} deadline (${milliseconds}ms)`)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}

export function fixtureEnvironment(environment, execArgv) {
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE']) {
    if (environment[key]) throw new Error(`${key} requires explicit pre-Node admission; mandatory hooks must not be silently removed`);
  }
  const allowed = arg => arg === '--max-old-space-size=768' || arg === '--test-reporter=spec' || arg.startsWith('--test-name-pattern=');
  if (!execArgv.every(allowed)) throw new Error('unreviewed controller execArgv');
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST_') || ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'].includes(key)) delete env[key];
  }
  // The fixture independently rejects unknown RS3 keys and admits known public
  // selectors before dynamic app imports. Proxy/CA/runtime variables survive.
  return { ...env, R78_NATIVE: '1', RS3_TASK_WORKER_MODE: 'process' };
}

export function watchFixture(child, stderrCap = 131072) {
  const state = { pid: child.pid, error: null, exit: null, close: null, stopped: null, stderrBytes: 0, stderr: '' };
  let readyResolve, readyReject, exitResolve, closeResolve;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Handle rejection before the caller can reach the readiness await.
  ready.catch(() => {});
  const exit = new Promise(resolve => { exitResolve = resolve; });
  const close = new Promise(resolve => { closeResolve = resolve; });
  child.on('error', error => { state.error ??= error; readyReject(error); });
  child.once('exit', (code, signal) => { state.exit = { code, signal }; exitResolve(state.exit); readyReject(new Error('fixture exited before readiness')); });
  child.once('close', (code, signal) => { state.close = { code, signal }; closeResolve(state.close); readyReject(new Error('fixture closed before readiness')); });
  child.on('message', message => {
    if (message?.type === 'ready') {
      if (message.pid !== child.pid || message.mode !== 'process' || message.dataset?.id !== 'duo-legacy'
        || message.dataset?.packed !== false || message.dataset?.version !== 'tracked') readyReject(new Error('fixture ready identity/mode differs'));
      else readyResolve(message);
    }
    if (message?.type === 'stopped') state.stopped = message;
  });
  child.stderr?.on('data', bytes => {
    state.stderrBytes += bytes.length;
    if (state.stderrBytes > stderrCap) { state.error ??= new Error('fixture stderr cap'); readyReject(state.error); return; }
    state.stderr += bytes.toString('utf8').replace(/\/join\/[^\s'"?]+/g, '/join/[redacted]').replace(/Bearer\s+[^\s'"?]+/g, 'Bearer [redacted]');
  });
  return { child, state, ready, exit, close };
}

export async function drainFixture(watch, budgets = { grace: 7500, term: 2000, kill: 2000 }) {
  const { child, state } = watch;
  if (!state.exit && child.connected) {
    try { child.send('stop', error => { if (error) state.error ??= error; }); } catch (error) { state.error ??= error; }
  }
  let forced = false;
  if (!state.close) {
    try { await deadline(watch.close, budgets.grace, 'fixture graceful close'); }
    catch {
      forced = true;
      if (!state.exit) child.kill('SIGTERM');
      try { await deadline(watch.close, budgets.term, 'fixture TERM close'); }
      catch {
        if (!state.exit) child.kill('SIGKILL');
        await deadline(watch.close, budgets.kill, 'fixture KILL close');
      }
    }
  }
  const drained = !!state.exit && !!state.close;
  const graceful = drained && !forced && !state.error && state.exit.code === 0 && state.exit.signal === null
    && state.close.code === 0 && state.close.signal === null && state.stopped?.ok === true && state.stopped.pid === child.pid;
  return { drained, graceful, forced, ...state };
}
