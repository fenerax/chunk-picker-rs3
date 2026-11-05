import { open, stat } from 'node:fs/promises';
import { headroom } from './files.mjs';

// Check the destination filesystem before allocation and each bounded write.
// Restic uses --no-cache, so staging is the only filesystem allocation sink.
export function stagingBudget(root, reserve, { check = headroom, signal } = {}) {
  const budget = async bytes => { signal?.throwIfAborted(); await check(root, bytes + 1024 ** 2, reserve); };
  const copy = async (source, target) => {
    await budget((await stat(source)).size);
    const input = await open(source, 'r');
    try {
      const output = await open(target, 'wx', 0o600);
      try {
        const buffer = Buffer.alloc(1024 ** 2);
        for (;;) {
          const { bytesRead } = await input.read(buffer);
          if (!bytesRead) break;
          await budget(bytesRead);
          let offset = 0;
          while (offset < bytesRead) offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
        }
        await output.sync();
      } finally { await output.close(); }
    } finally { await input.close(); }
  };
  return { budget, copy };
}
