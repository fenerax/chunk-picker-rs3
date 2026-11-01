import { createHash } from 'node:crypto';
import { createCompletionEncoder as createEncoder, decodeCompletionDocument as decode } from '../core/completion-codec.mjs';
export { COMPLETION_BACKUP_VERSION } from '../core/completion-codec.mjs';

// The same versioned format serves browser imports and native durable writes.
const native = { hashJSON: json => createHash('sha256').update(json).digest('hex'), byteLength: text => Buffer.byteLength(text) };
export const createCompletionEncoder = () => createEncoder(native);
export const decodeCompletionDocument = document => decode(document, native);
