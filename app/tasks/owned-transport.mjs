import { createHash } from 'node:crypto';
import { residentBase } from '../core/resident-copy.mjs';
import { ownedCodec } from '../storage/owned-codec.mjs';
import { verifyOwnedBaseBytes } from '../storage/owned-base.mjs';
import { ownedBaseLimits, validateOwnedBaseReference } from '../storage/owned-base-schema.mjs';
import { createStateSnapshotCache } from './retained-data.mjs';
import { serviceMemoryBudget } from '../service-memory-budget.mjs';

const encodings = new WeakMap();
export const OWNED_CALCULATOR_TRANSPORT = 'owned-delta-v1';
const refused = cause => Object.assign(new Error(`Owned calculator base refused; restore the exact pinned base. ${cause.message}`), { code: 'OWNED_CALCULATOR_BASE_REFUSED', cause });

/** Storage supplies its independently verified release pin, never save metadata.
 * One immutable base encoding is shared by all group captures in this isolate. */
export function registerOwnedCalculatorBase(base, pin) {
  if (encodings.has(base)) {
    validateOwnedBaseReference({ datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, encodings.get(base).pin);
    return;
  }
  const bytes = Buffer.from(JSON.stringify(base));
  if (!Object.isFrozen(base) || bytes.length > ownedBaseLimits().bytes
    || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw refused(new Error('Base checksum mismatch.'));
  const shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
  encodings.set(base, Object.freeze({ pin: Object.freeze({ ...pin, dataset: Object.freeze({ ...pin.dataset }) }), bytes: shared }));
}
export function ownedCalculatorInput(state) {
  const base = residentBase(state), installation = encodings.get(base);
  if (!installation) throw refused(new Error('Verified release pin is missing.'));
  return { document: ownedCodec(base, installation.pin).encode(state), installation };
}

/** Each physical worker owns this cache, independently of picker handles. */
export function createOwnedCalculatorReceiver(datasetDigest, { limits: overrides,
  maxBytes = serviceMemoryBudget().stateBytes === null ? null : Math.floor(serviceMemoryBudget().stateBytes / 2),
  maxEntries = serviceMemoryBudget().enforced ? 2 : null, onEvict } = {}) {
  const bases = createStateSnapshotCache({ maxBytes, maxEntries, onEvict }), limits = ownedBaseLimits(overrides);
  const receive = ({ document, installation }) => {
    try {
      const reference = document?.storage?.base;
      if (reference?.datasetDigest !== datasetDigest) throw new Error('Worker dataset pin mismatch.');
      let cached = bases.get(reference.sha256);
      if (installation !== undefined) {
        validateOwnedBaseReference(reference, installation.pin);
        if (!(installation.bytes instanceof SharedArrayBuffer) || !installation.bytes.byteLength
          || installation.bytes.byteLength > limits.bytes) throw new Error('Base byte limit.');
        // Own the bytes before hashing/parsing; a shared writer cannot race verification.
        const bytes = Buffer.from(new Uint8Array(installation.bytes));
        if (cached) {
          if (installation.pin.dataset.id !== cached.pin.dataset.id || installation.pin.dataset.contractVersion !== cached.pin.dataset.contractVersion
            || installation.pin.generatorVersion !== cached.pin.generatorVersion) throw new Error('Base release pin mismatch.');
          if (createHash('sha256').update(bytes).digest('hex') !== cached.pin.sha256) throw new Error('Base checksum mismatch.');
        } else {
          const base = verifyOwnedBaseBytes(bytes, { dataset: installation.pin.dataset, limits,
            manifest: { schemaVersion: 1, bases: { [reference.datasetDigest]: installation.pin } } });
          cached = { base, pin: installation.pin }; bases.set(reference.sha256, cached);
        }
      }
      if (!cached) throw new Error('Pinned digest is not installed in this worker.');
      validateOwnedBaseReference(reference, cached.pin);
      return ownedCodec(cached.base, cached.pin).decode(document, { resident: true }).state;
    } catch (cause) { throw refused(cause); }
  };
  receive.retentionLedger = () => ({ ...bases.retentionLedger(),
    accounting: 'Verified calculator base graph bytes, including dictionary payloads and release pins. Oversized bases decode the current request without retention; private hints require a full installation on reuse.' });
  receive.retentionRoots = bases.retentionRoots;
  Object.defineProperty(receive, 'size', { get: () => bases.size });
  return receive;
}
