import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

// Shared by runtime writers and the stopped-store start gate. Kernel ownership
// disappears on process death without creating or recovering a file in the store.
export async function acquireProcessGuard(directory) {
  const canonical = await realpath(directory);
  const digest = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const listener = createServer(socket => socket.destroy());
  const address = process.platform === 'win32' ? { path: `\\\\.\\pipe\\rs3-picker-store-${digest}`, exclusive: true }
    : process.platform === 'linux' ? { path: `\0rs3-picker-store-${digest}`, exclusive: true }
      : { host: '127.0.0.1', port: 30_000 + parseInt(digest.slice(0, 8), 16) % 20_000, exclusive: true };
  try {
    await new Promise((resolve, reject) => {
      const failure = error => { listener.removeListener('listening', ready); reject(error); };
      const ready = () => { listener.removeListener('error', failure); resolve(); };
      listener.once('error', failure); listener.once('listening', ready);
      listener.listen(address);
    });
  } catch (error) {
    if (['EADDRINUSE', 'EACCES'].includes(error.code)) throw new Error('Another server already holds or is recovering this data-directory lock.', { cause: error });
    throw error;
  }
  listener.on('error', () => {});
  return () => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
}
