// Harness-only cap for owned calculator hosts; the HTTP server keeps its own heap.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function calculatorForkOptions(filename, options, appRoot, heapMiB) {
  if (heapMiB === undefined) return options;
  const limit = Number(heapMiB);
  if (!Number.isInteger(limit) || limit < 512 || limit > 4096) throw Error('Invalid calculator heap limit.');
  const resolved = filename instanceof URL ? fileURLToPath(filename) : path.resolve(String(filename));
  if (resolved !== path.join(appRoot, 'app/tasks/process-worker-host.mjs')) return options;
  const execArgv = (options?.execArgv ?? process.execArgv).filter(arg => !/^--max[-_]old[-_]space[-_]size(?:=|$)/.test(arg));
  return { ...options, execArgv: [...execArgv, `--max-old-space-size=${limit}`] };
}

export function installCalculatorHeapPolicy(appRoot, heapMiB) {
  if (heapMiB === undefined) return;
  // Validate before installing a global wrapper. Only this isolated harness child uses it.
  calculatorForkOptions('', {}, appRoot, heapMiB);
  const fork = childProcess.fork;
  childProcess.fork = function (filename, args, options) {
    if (!Array.isArray(args)) { options = args; args = []; }
    return fork.call(this, filename, args, calculatorForkOptions(filename, options, appRoot, heapMiB));
  };
  syncBuiltinESMExports();
}
