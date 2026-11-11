import { execFile, fork } from 'node:child_process';

export function command(file, args, options) {
  return new Promise((resolve, reject) => {
    let failure, output;
    const child = execFile(file, args, options, (error, stdout) => { failure = error; output = stdout; });
    child.once('close', () => failure ? reject(failure) : resolve(output));
  });
}

// Drain descendants before the parent removes fixtures. Native fork cancellation
// kills the relay and its calculator thread together, including blocked JS.
export function childProcesses(signal) {
  const closing = new Set();
  return {
    fork(module, args, options) {
      signal.throwIfAborted();
      const child = fork(module, args, { ...options, signal, killSignal: 'SIGKILL' });
      const closed = new Promise(resolve => child.once('close', resolve));
      closing.add(closed);
      void closed.then(() => closing.delete(closed));
      return child;
    },
    close: () => Promise.all(closing),
  };
}

export function runTrial(module, args, options, { signal, onReady } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = fork(module, args, options);
    let failure;
    // Cooperate across IPC instead of killing the trial before it can reap its
    // own children. Its AbortSignal is installed before importing any app code.
    const cancel = () => {
      if (child.connected) child.send({ kind: 'acceptance-abort' }, error => { failure ??= error; });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    child.on('message', message => {
      if (message?.kind !== 'acceptance-ready') return;
      try { onReady?.({ controller: child.pid, children: message.children }); }
      catch (error) { failure = error; cancel(); }
    });
    child.once('error', error => { failure ??= error; });
    child.once('close', (status, killedBy) => {
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else if (killedBy) reject(new Error(`Trial interrupted: ${killedBy}`));
      else resolve(status);
    });
    if (signal?.aborted) cancel();
  });
}
