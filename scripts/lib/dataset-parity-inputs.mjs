// Disposable parity processes only. Inherited --import also controls calculator
// processes and isolates. Never load this module in a daily picker.
import { createRequire, syncBuiltinESMExports } from 'node:module';
const crypto = createRequire(import.meta.url)('node:crypto');
const OriginalDate = Date, instant = OriginalDate.parse(process.env.RS3_PARITY_INSTANT ?? '2026-10-13T12:00:00.000Z');
if (!Number.isFinite(instant)) throw new TypeError('Invalid disposable parity instant.');
globalThis.Date = class extends OriginalDate {
  constructor(...arguments_) { super(...(arguments_.length ? arguments_ : [instant])); }
  static now() { return instant; }
};
Math.random = () => 0.375;
let sequence = 0;
// A shadow batch supplies a fresh secret seed shared only by its two children.
// Existing dataset parity retains its reproducible default fixture sequence.
const seed = process.env.RS3_PARITY_RANDOM_SEED ?? 'disposable-dataset-parity';
function bytes(size) {
  const result = Buffer.alloc(size);
  for (let offset = 0; offset < size; offset += 32) {
    const block = crypto.createHash('sha256').update(`${seed}:${sequence++}`).digest();
    block.copy(result, offset, 0, Math.min(block.length, size - offset));
  }
  return result;
}
crypto.randomBytes = (size, callback) => {
  const result = bytes(size);
  if (callback) { queueMicrotask(() => callback(null, result)); return; }
  return result;
};
crypto.randomUUID = () => {
  const result = bytes(16); result[6] = (result[6] & 15) | 64; result[8] = (result[8] & 63) | 128;
  const hex = result.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
syncBuiltinESMExports();
