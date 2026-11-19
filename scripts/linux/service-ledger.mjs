import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { noLinks, sha } from './files.mjs';
export const serviceLedgerError = message => Object.assign(Error(message), { code: 'SERVICE_RECOVERY_LEDGER' });

// The registry owns ledger schemas and validation. Transport treats the whole
// versioned document as opaque, including fields introduced by later runtimes.
export async function readServiceLedger(file) {
  await noLinks(file);
  const bytes = await readFile(file), document = JSON.parse(bytes);
  if (!document || !Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 1) throw serviceLedgerError('Versioned service ledger required.');
  return { bytes, document, pin: { schemaVersion: document.schemaVersion, sha256: sha(bytes) } };
}
export async function verifyServiceLedger(backup, pin) {
  if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw serviceLedgerError('Service ledger pin missing.');
  let ledger;
  try { ledger = await readServiceLedger(path.join(backup, 'ledger.json')); }
  catch { throw serviceLedgerError('Service capture ledger is missing or invalid. Preserve the capture and recover a verified complete copy.'); }
  if (pin.sha256 !== ledger.pin.sha256 || pin.schemaVersion !== ledger.pin.schemaVersion) throw serviceLedgerError('Service ledger version/digest mismatch.');
  return ledger;
}

// Conservative structural inclusion, without knowing record fields or versions.
// Additions are safe; a changed record/version requires operator review rather
// than guessing at its lifecycle order. Never merge or replace a live ledger.
function includesDocument(current, captured) {
  if (Array.isArray(captured)) {
    if (!Array.isArray(current)) return false;
    const scalars = new Set(current.filter(row => row === null || typeof row !== 'object'));
    return captured.every(row => row === null || typeof row !== 'object' ? scalars.has(row) : current.some(value => includesDocument(value, row)));
  }
  if (captured && typeof captured === 'object') return current && typeof current === 'object' && !Array.isArray(current)
    && Object.entries(captured).every(([key, value]) => Object.hasOwn(current, key) && includesDocument(current[key], value));
  return current === captured;
}
export async function assertServiceLedgerCoverage(file, captured) {
  let current;
  try { current = await readServiceLedger(file); }
  catch { throw serviceLedgerError('Target ledger is missing or invalid. Preserve it and recover a verified covering replica before retrying.'); }
  if (current.pin.sha256 === captured.pin.sha256) return;
  if (!includesDocument(current.document, captured.document)) throw serviceLedgerError('Target ledger is stale or mismatched with this capture. Preserve both ledgers; recover a verified covering replica before retrying.');
}
