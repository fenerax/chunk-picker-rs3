import { open } from 'node:fs/promises';
import { noLinks } from './files.mjs';

// Project JSON onto its structure before decoding it. Only root property names
// survive; record strings (including hashes, labels and identities) are never
// accumulated or decoded. Keep a bounded read even for a corrupt key file.
export async function pluginKeyCount(file) {
  let handle;
  try {
    await noLinks(file);
    handle = await open(file, 'r');
  } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw Error('Invalid plugin key count input.');
    let skeleton = '', depth = 0, string = false, keep = false, escape = false, unicode = 0, bytes = 0;
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw Error('Invalid plugin key count input.');
      for (const byte of chunk) {
        const char = String.fromCharCode(byte);
        if (string) {
          if (keep) skeleton += char;
          if (unicode) {
            if (!/[a-fA-F0-9]/.test(char)) throw Error('Invalid plugin key count input.');
            unicode--;
          } else if (escape) {
            if (!'"\\/bfnrtu'.includes(char)) throw Error('Invalid plugin key count input.');
            unicode = char === 'u' ? 4 : 0; escape = false;
          } else if (char === '\\') escape = true;
          else if (char === '"') { string = false; if (!keep) skeleton += '"'; }
          else if (byte < 32) throw Error('Invalid plugin key count input.');
        } else if (char === '"') {
          string = true; keep = depth === 1; skeleton += '"';
        } else {
          skeleton += char;
          if (char === '{' || char === '[') depth++;
          if (char === '}' || char === ']') depth--;
          if (depth < 0 || depth > 16) throw Error('Invalid plugin key count input.');
        }
      }
    }
    if (string) throw Error('Invalid plugin key count input.');
    let value;
    try { value = JSON.parse(skeleton); } catch { throw Error('Invalid plugin key count input.'); }
    if (value?.schemaVersion !== 1 || !Array.isArray(value.keys)
      || Object.keys(value).some(key => !['schemaVersion', 'keys'].includes(key))
      || value.keys.some(row => !row || Array.isArray(row) || typeof row !== 'object')) throw Error('Invalid plugin key count input.');
    return value.keys.length;
  } finally { await handle.close(); }
}
