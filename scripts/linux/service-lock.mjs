import path from 'node:path';
import { hostname } from 'node:os';
import { readFile, rm } from 'node:fs/promises';
import { lockRegistry } from '../../app/storage/registry-lock.mjs';
import { atomic, directory, encode, exists, noLinks } from './files.mjs';

// The existing registry lock supplies a kernel mutex and provably-dead local
// owner recovery. Use a separate control namespace, never a restorable registry.
// The ordinary operation.lock remains the existing systemd start-permit input.
export async function serviceOperation(settings, command, work) {
  const guardRoot = path.join(settings.controlDir, 'service-operation');
  await directory(guardRoot);
  let release;
  try { release = await lockRegistry(guardRoot); }
  catch (error) { if (command === 'health' && error.code === 'REGISTRY_LOCKED') return { skipped: true }; throw error; }
  const file = path.join(settings.controlDir, 'operation.lock');
  let owned;
  try {
    if (await exists(file)) {
      await noLinks(file);
      const previous = JSON.parse(await readFile(file, 'utf8'));
      if (!['restore', 'quarantine-release'].includes(command) || previous.host !== hostname() || !Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error('Unverifiable operator evidence; inspect privately.');
      try { process.kill(previous.pid, 0); throw new Error('Operator evidence still has a live owner.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      await rm(file);
    }
    owned = encode({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() });
    await atomic(file, owned);
    return await work();
  } finally {
    try { if (owned && await readFile(file, 'utf8') === owned) await rm(file); }
    finally { await release(); }
  }
}
