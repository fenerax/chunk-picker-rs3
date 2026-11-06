import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const gunzipAsync = promisify(gunzip);
export function validateStaticFieldReference(key, reference) {
  const match = /^static-([a-f0-9]{64})\.json\.gz$/.exec(reference?.id ?? '');
  if (!match || reference?.sha256 !== match[1] || Object.keys(reference).some(name => !['id', 'sha256'].includes(name))) {
    throw new TypeError(`Invalid static field reference: ${key}`);
  }
}
export async function readStaticFieldBytes(directory, key, reference, { decompress = gunzipAsync } = {}) {
  validateStaticFieldReference(key, reference);
  const staticDir = path.join(directory, 'static');
  let compressed;
  try {
    const base = await realpath(staticDir), file = await realpath(path.join(staticDir, reference.id));
    if (path.dirname(file) !== base) throw new TypeError(`Invalid static field location: ${key}`);
    compressed = await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing static field dependency: ${reference.id}`, { cause: error });
    throw error;
  }
  const bytes = await decompress(compressed);
  if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new TypeError(`Static field checksum mismatch: ${key}`);
  return bytes;
}
