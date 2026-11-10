import { createReadStream } from 'node:fs';

// Inspect only the envelope's storage.schemaVersion. Never retain state text,
// strings or arrays: format-1 capture/verifiers must keep their bounded heap.
// This is an admission hint, not a JSON/schema validator. Owned documents still
// pass the full loader; opaque legacy bytes keep their existing treatment.
export async function hasOwnedStorage(file) {
  let depth = 0, storage = false, owned = false, string = false, escaped = false;
  let text = '', collect = false, pending, key, version = false;
  const finish = () => {
    if (version) owned = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) && Number(text) === 2;
    version = false; text = '';
  };
  try {
    for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
      for (const character of chunk) {
        if (string) {
          if (collect) { text += character; if (text.length > 128) { text = ''; collect = false; } }
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') {
            string = false; pending = undefined;
            if (collect) { try { pending = JSON.parse(text); } catch {} }
            text = '';
          }
          continue;
        }
        if (version && !/[\s,}\]]/.test(character)) {
          if (text.length < 128) text += character;
          continue;
        }
        if (version) finish();
        if (/\s/.test(character)) continue;
        if (character === '"') {
          string = true; collect = depth === 1 || storage && depth === 2; text = collect ? '"' : '';
        } else if (character === ':') {
          if (depth === 1 || storage && depth === 2) key = pending;
          if (depth === 1 && key === 'storage') owned = false;
          pending = undefined;
        } else if (character === '{' || character === '[') {
          if (depth === 1) storage = key === 'storage' && character === '{';
          depth++; pending = undefined; key = undefined;
        } else if (character === '}' || character === ']') {
          if (depth === 2) storage = false;
          depth--; pending = undefined; key = undefined;
        } else if (character === ',') { pending = undefined; key = undefined; }
        else if (storage && depth === 2 && key === 'schemaVersion') { version = true; text = character; }
      }
    }
    finish();
    return owned;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
