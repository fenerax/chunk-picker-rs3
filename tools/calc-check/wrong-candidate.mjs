// Calibration candidate used by the CI test: exactly one result field is wrong.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frames, writer, packParts, unpackParts } from '../../calculator/reference/codec.mjs';
const child = spawn(process.execPath, [fileURLToPath(new URL('../../calculator/reference/main.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
child.on('error', () => { process.exitCode = 1; process.stdin.destroy(); });
process.stdin.pipe(child.stdin);
const send = writer(process.stdout);
let changed = false;
try {
  for await (const { header, body } of frames(child.stdout)) {
    if (header.type === 'result' && !changed) {
      const parts = unpackParts(header, body);
      if (parts.play?.metrics) {
        parts.play.metrics.availableCount += 1; changed = true;
        const packed = packParts(parts);
        await send({ ...header, parts: packed.parts }, packed.body); continue;
      }
    }
    await send(header, body);
  }
} catch { process.exitCode = 1; child.kill(); }
