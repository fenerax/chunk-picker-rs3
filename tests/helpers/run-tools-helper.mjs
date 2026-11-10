import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the test thread responsive and retain progress while root work runs.
// No operation deadline: the owning file/runner supplies its single hang guard.
export function runToolsHelper(script, { signal, report = () => {} } = {}, { spawn: launch = spawn } = {}) {
  signal?.throwIfAborted();
  const host = fileURLToPath(new URL('./tools-install-host.py', import.meta.url));
  const root = process.getuid?.() === 0;
  const args = [host, process.execPath, script];
  const child = launch(root ? '/usr/bin/python3' : 'sudo', root ? args : ['-n', '--', '/usr/bin/python3', ...args],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', failure;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32768); report(chunk.toString()); });
    child.stdin.on('error', () => {});
    const abort = () => child.stdin.end();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', error => { failure = error; });
    child.once('close', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      child.stdin.end();
      if (failure) reject(failure);
      else if (signal?.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(`Tools helper failed (exit ${code}, signal ${exitSignal}).\n${stderr}`));
      else resolve(stdout);
    });
  });
}
