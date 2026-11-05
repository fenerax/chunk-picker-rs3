// One atomic, fsynced document per operation, updated before/after each phase.
// Incomplete phases survive a kill. No save content, credentials or error text.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomic, directory, encode, exists, json } from './files.mjs';

export async function phaseReceipt(controlDir, operation, { now = () => performance.now(), wall = () => new Date().toISOString(), file } = {}) {
  const root = path.join(controlDir, 'phase-receipts'); await directory(root);
  let toolsIdentity = null;
  const manifest = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'tools-manifest.json');
  if (await exists(manifest)) toolsIdentity = (await json(manifest)).toolsIdentity;
  file ??= path.join(root, operation + '-' + randomUUID() + '.json');
  const document = { format: 'picker-phases-v1', operation, toolsIdentity, startedAt: wall(), result: 'running', phases: [], events: {} };
  const marks = new Map();
  const save = () => atomic(file, encode(document));
  await save();
  return { file, document,
    async run(name, action) {
      const began = now(), row = { name, startedAt: wall(), result: 'running' };
      document.phases.push(row); await save();
      try { const result = await action(); row.result = 'success'; return result; }
      catch (error) { row.result = 'failed'; throw error; }
      finally { row.completedAt = wall(); row.durationMs = Math.max(0, now() - began); await save(); }
    },
    async mark(name) {
      marks.set(name, now()); document.events[name] = wall();
      if (name === 'ready' && marks.has('stopped')) document.stoppedToReadyMs = Math.max(0, now() - marks.get('stopped'));
      await save();
    },
    async finish(result) { document.result = result; document.completedAt = wall(); await save(); },
  };
}
export const inPhase = (receipt, name, work) => receipt ? receipt.run(name, work) : work();
