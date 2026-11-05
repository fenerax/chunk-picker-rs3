import { inspect } from 'node:util';

// Explicit error transport: V8's Error clone drops custom fields such as code.
// Do this before IPC, then restore Error objects for Node's human reporters.
export function childErrorRecord(error, depth = 0, seen = new Set()) {
  if (error == null) return null;
  if (depth > 8 || seen.has(error)) return { message: '[cause truncated]' };
  if (typeof error !== 'object') return { message: String(error) };
  seen.add(error);
  const record = { message: typeof error.message === 'string' ? error.message : 'Child error without a message' };
  for (const key of ['name', 'code', 'failureType']) if (['string', 'number'].includes(typeof error[key])) record[key] = error[key];
  if (error.cause !== undefined) record.cause = childErrorRecord(error.cause, depth + 1, seen);
  return record;
}

export function restoreChildError(record) {
  if (!record) return record;
  const error = new Error(record.message, Object.hasOwn(record, 'cause') ? { cause: restoreChildError(record.cause) } : {});
  for (const key of ['name', 'code', 'failureType']) if (record[key] !== undefined) error[key] = record[key];
  for (const key of ['stack', 'actual', 'expected', 'operator', 'generatedMessage']) if (record[key] !== undefined) error[key] = record[key];
  return error;
}

// Human reporters keep their original stacks and assertion diffs. The ledger
// separately uses childErrorRecord(), which excludes all of these payloads.
export function transportChildError(error, depth = 0) {
  const record = childErrorRecord(error);
  if (!record || depth > 8 || typeof error !== 'object') return record;
  for (const key of ['stack', 'actual', 'expected', 'operator', 'generatedMessage']) if (error[key] !== undefined) {
    try { record[key] = structuredClone(error[key]); }
    catch { record[key] = inspect(error[key], { depth: 4 }); }
  }
  if (error.cause !== undefined) record.cause = transportChildError(error.cause, depth + 1);
  return record;
}
