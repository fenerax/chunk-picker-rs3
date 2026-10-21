import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, statSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { inflateSync, gunzipSync } from 'node:zlib';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

export const RSMV_COMMIT = 'a92b8920b9b9842adde78822646ecad1a6f4fc15';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Remove JSONC comments without treating URL slashes inside strings as comments.
export function parseJsonc(source) {
  let out = '', quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (quoted) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; out += c; }
    else if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      out += ' ';
    } else out += c;
  }
  // These schemas use no trailing commas in string contents; remove only tokens.
  let clean = '', inString = false, escape = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inString) {
      clean += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
    } else {
      if (c === '"') inString = true;
      if (c === ',' && /^[\s]*[}\]]/.test(out.slice(i + 1))) continue;
      clean += c;
    }
  }
  return JSON.parse(clean);
}

/** Only the external, pinned opcode interpreter and constants execute. No CLI,
 * downloader, SQLite backend, Electron, dependencies or install scripts run. */
export async function loadDecoders(toolDirectory, build = 950) {
  const src = join(realpathSync(toolDirectory), 'src');
  const constantsSource = readFileSync(join(src, 'constants.ts'), 'utf8');
  const opcodeSource = readFileSync(join(src, 'parser', 'opcode_reader.ts'), 'utf8');
  const constantsJs = stripTypeScriptTypes(constantsSource, { mode: 'strip' });
  const constantsUrl = `data:text/javascript;base64,${Buffer.from(constantsJs).toString('base64')}`;
  const opcodeJs = stripTypeScriptTypes(opcodeSource, { mode: 'strip' })
    .replace('"../constants"', JSON.stringify(constantsUrl));
  const { buildParser } = await import(`data:text/javascript;base64,${Buffer.from(opcodeJs).toString('base64')}`);
  const typedef = parseJsonc(readFileSync(join(src, 'opcodes', 'typedef.jsonc'), 'utf8'));
  const parsers = new Map();
  const files = {
    index: 'cacheindex.json', tiles: 'mapsquare_tiles.jsonc', nxt: 'mapsquare_tiles_nxt.jsonc',
    locations: 'mapsquare_locations.json', loc: 'locs.jsonc', npc: 'npcs.jsonc',
    labels: 'maplabels.jsonc', labelLocations: 'maplabellocations.jsonc',
    pastes: 'mapzones_pastes.json', zones: 'mapzones.json',
    overlay: 'mapsquare_overlays.jsonc', underlay: 'mapsquare_underlays.jsonc',
  };
  return { build, sourceHashes: { constants: sha256(constantsSource), opcode: sha256(opcodeSource) },
    decode(kind, buffer, args = {}) {
      if (!files[kind]) throw new Error(`Unknown decoder ${kind}`);
      if (!parsers.has(kind)) parsers.set(kind, buildParser(null,
        parseJsonc(readFileSync(join(src, 'opcodes', files[kind]), 'utf8')), typedef));
      const state = { isWrite: false, buffer, stack: [], hiddenstack: [], scan: 0,
        endoffset: buffer.length, args: { buildnr: build, clientVersion: build, ...args } };
      let result;
      try { result = parsers.get(kind).read(state); }
      catch (cause) {
        // data-URL module stack traces contain the entire interpreter source.
        const error = new Error(`${kind} at byte ${state.scan}/${buffer.length}: ${cause.message}`);
        error.stack = error.message;
        throw error;
      }
      if (state.scan !== buffer.length) throw new Error(`${kind}: ${buffer.length - state.scan} unconsumed bytes`);
      return result;
    },
  };
}

export function decompress(bytes) {
  const input = Buffer.from(bytes);
  let output, expected;
  if (input.subarray(0, 4).toString('hex') === '5a4c4201') {
    expected = input.readUInt32BE(4);
    output = inflateSync(input.subarray(8));
  } else if (input[0] === 0) {
    expected = input.readUInt32BE(1);
    output = input.subarray(5, 5 + expected);
  } else if (input[0] === 2) {
    expected = input.readUInt32BE(5);
    output = gunzipSync(input.subarray(9, 9 + input.readUInt32BE(1)));
  } else throw new Error(`Unsupported compression ${input[0]}; do not silently skip`);
  if (output.length !== expected) throw new Error(`Decompressed length ${output.length} != ${expected}`);
  return output;
}

export function unpackArchive(buffer, subids) {
  if (subids.length === 1) return new Map([[subids[0], buffer]]);
  if (buffer.length < 5 + subids.length * 4) throw new Error('Truncated archive header');
  let offset = buffer.readUInt32BE(1);
  if (offset !== 5 + subids.length * 4) throw new Error('Unexpected archive offset table');
  const result = new Map();
  subids.forEach((id, i) => {
    const end = buffer.readUInt32BE(5 + i * 4);
    if (end < offset || end > buffer.length) throw new Error('Invalid archive range');
    result.set(id, buffer.subarray(offset, end));
    offset = end;
  });
  if (offset !== buffer.length) throw new Error('Trailing archive bytes');
  return result;
}

export class CacheCopy {
  constructor(directory, decoders) {
    this.directory = realpathSync(directory);
    if (/[/\\]ProgramData[/\\]Jagex[/\\]RuneScape(?:[/\\]|$)/i.test(this.directory))
      throw new Error('Refusing original game cache. Make a file copy first.');
    this.decoders = decoders;
    this.tables = new Map();
  }
  table(major) {
    if (!this.tables.has(major)) {
      const path = resolve(this.directory, `js5-${major}.jcache`);
      if (realpathSync(path) !== path) throw new Error('Cache copies must be regular files, not redirected paths');
      const db = new DatabaseSync(path, { readOnly: true });
      db.exec('PRAGMA query_only=ON');
      const raw = db.prepare('SELECT DATA FROM cache_index').get();
      const index = this.decoders.decode('index', decompress(raw.DATA));
      const entries = new Map(index.indices.map(row => [row.minor, row]));
      this.tables.set(major, { db, index, entries, path, size: statSync(path).size,
        statement: db.prepare('SELECT DATA, CRC FROM cache WHERE KEY=?') });
    }
    return this.tables.get(major);
  }
  file(major, minor) {
    const table = this.table(major), row = table.statement.get(minor);
    return row ? decompress(row.DATA) : null;
  }
  archive(major, minor) {
    const entry = this.table(major).entries.get(minor);
    const buffer = this.file(major, minor);
    return buffer && entry ? unpackArchive(buffer, entry.subindices) : null;
  }
  object(major, id, kind, groupSize = 256) {
    const buffer = this.archive(major, Math.floor(id / groupSize))?.get(id % groupSize);
    return buffer ? this.decoders.decode(kind, buffer) : null;
  }
  close() { for (const table of this.tables.values()) table.db.close(); }
}
