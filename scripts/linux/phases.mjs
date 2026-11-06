// One atomic, fsynced document per operation, updated before/after each phase.
// Incomplete phases survive a kill. No save content, credentials or error text.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomic, directory, encode, exists, json } from './files.mjs';

export async function phaseReceipt(controlDir, operation, { now = () => performance.now(), wall = () => new Date().toISOString(), file, write = atomic } = {}) {
  const unavailable = () => Object.assign(Error('Timing receipts unavailable before writer stop.'), { code: 'PHASE_RECEIPT_UNWRITABLE' });
  const root = path.join(controlDir, 'phase-receipts');
  let toolsIdentity = null;
  const manifest = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'tools-manifest.json');
  try {
    await directory(root);
    if (await exists(manifest)) toolsIdentity = (await json(manifest)).toolsIdentity;
  } catch { throw unavailable(); }
  file ??= path.join(root, operation + '-' + randomUUID() + '.json');
  const document = { format: 'picker-phases-v1', operation, toolsIdentity, startedAt: wall(), result: 'running', phases: [], events: {} };
  const marks = new Map();
  const save = () => write(file, encode(document));
  const preflight = async () => {
    try { await save(); }
    catch { throw unavailable(); }
  };
  // Timing is observability, never a start/rollback/cleanup gate. The initial
  // write and explicit preflight still fail before any writer is stopped.
  const record = async () => {
    try { await save(); }
    catch { document.writeFailures = (document.writeFailures ?? 0) + 1; }
  };
  await preflight();
  return { file, document,
    preflight,
    async run(name, action) {
      const began = now(), row = { name, startedAt: wall(), result: 'running' };
      document.phases.push(row); await record();
      try { const result = await action(); row.result = 'success'; return result; }
      catch (error) { row.result = 'failed'; throw error; }
      finally { row.completedAt = wall(); row.durationMs = Math.max(0, now() - began); await record(); }
    },
    async mark(name) {
      marks.set(name, now()); document.events[name] = wall();
      if (name === 'ready' && marks.has('stopped')) document.stoppedToReadyMs = Math.max(0, now() - marks.get('stopped'));
      await record();
    },
    async finish(result) { document.result = result; document.completedAt = wall(); await record(); },
  };
}
export const inPhase = (receipt, name, work) => receipt ? receipt.run(name, work) : work();
