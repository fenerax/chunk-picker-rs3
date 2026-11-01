import { serialize, deserialize } from 'node:v8';
import { gzipSync, gunzipSync } from 'node:zlib';

// Internal scratch storage, not a calculator protocol encoding. V8 preserves
// undefined fields used by prepared-result metadata; gzip bounds retained graphs.
export const packValue = value => gzipSync(serialize(value), { level: 1 });
export const unpackValue = bytes => deserialize(gunzipSync(bytes));
