import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node resolves a loaded module's URL but retains the invoked symlink in argv.
// Eval imports are never CLI entrypoints, even when eval has positional args.
export function isMain(url) {
  if (!process.argv[1] || process.execArgv.some(arg => /^(?:-[a-zA-Z]*[ep]|--(?:eval|print)(?:=|$))/.test(arg))) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url)); }
  catch { throw Object.assign(Error('Entrypoint identity unavailable.'), { code: 'ENTRYPOINT_IDENTITY' }); }
}
