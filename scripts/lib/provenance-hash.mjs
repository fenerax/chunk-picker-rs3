import { createHash } from 'node:crypto';

/** Exact bytes for binary artifacts, external exports and logical JSON values. */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Repository text uses Git's LF bytes, even in a CRLF working copy.
 * Only CRLF pairs are changed; lone CRs, BOMs and every other byte are retained.
 * Callers choose this explicitly: external .local files and binaries stay raw.
 */
export function sha256RepositoryText(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!bytes.includes('\r\n')) return sha256(bytes);
  const normalized = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    normalized[length++] = bytes[index];
  }
  return sha256(normalized.subarray(0, length));
}
