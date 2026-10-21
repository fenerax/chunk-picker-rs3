// Metadata-only admission, with argument handling that also works in PowerShell 5.1.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
try {
  const [mode, modulePath, savePath, ...extra] = process.argv.slice(2);
  if (!['assert', 'observe'].includes(mode) || !path.isAbsolute(modulePath ?? '') || !path.isAbsolute(savePath ?? '') || extra.length) {
    throw Object.assign(Error(), { code: 'RS3_IDLE_ARGUMENTS' });
  }
  const { assertIdle, readIdleState } = await import(pathToFileURL(modulePath));
  const result = await (mode === 'assert' ? assertIdle : readIdleState)(savePath);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('Idle admission refused: ' + (/^RS3_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'RS3_IDLE_UNAVAILABLE'));
  process.exitCode = 1;
}
