// Offline game-data helpers. These never open the original Jagex cache.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { CacheCopy, loadDecoders, parseJsonc, RSMV_COMMIT, sha256, fileSha256 } from './cache-reader.mjs';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';

const SCHEMAS = {
  item: 'items.jsonc', items: 'items.jsonc', quest: 'quests.jsonc', quests: 'quests.jsonc',
  achievement: 'achievements.jsonc', achievements: 'achievements.jsonc',
  enum: 'enums.json', enums: 'enums.json', struct: 'structs.jsonc', structs: 'structs.jsonc',
  param: 'params.jsonc', params: 'params.jsonc', interface: 'interfaces.jsonc', interfaces: 'interfaces.jsonc',
  clientscript: 'clientscript.jsonc', clientscriptdata: 'clientscriptdata.jsonc',
  inventory: 'inventories.jsonc', inventories: 'inventories.jsonc',
  dbrow: 'dbrows.jsonc', dbtable: 'dbtables.jsonc',
};

export async function openGameCache({ workspace = 'C:/Users/User/Projects/rs3-cache-work', build = 950 } = {}) {
  workspace = realpathSync(workspace);
  const tool = join(workspace, 'rsmv');
  const commit = execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== RSMV_COMMIT) throw new Error(`Decoder must be pinned at ${RSMV_COMMIT}`);
  if (execFileSync('git', ['-C', tool, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Pinned decoder source has local changes');
  const decoders = await loadDecoders(tool, build), src = join(tool, 'src');
  const constantsSource = readFileSync(join(src, 'constants.ts'), 'utf8');
  const constantsUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(constantsSource, { mode: 'strip' })).toString('base64')}`;
  const opcodeSource = readFileSync(join(src, 'parser/opcode_reader.ts'), 'utf8');
  // The pinned footer reader warns on leftover bytes. Fail closed for these
  // audit exports, and validate the declared footer stays beyond the body scan.
  const opcodeJs = stripTypeScriptTypes(opcodeSource, { mode: 'strip' })
    .replace('"../constants"', JSON.stringify(constantsUrl))
    .replace('let footstart = state.endoffset - len;', 'let footstart = state.endoffset - len; if (!Number.isInteger(len) || len < 0 || footstart < oldscan) throw new Error("Invalid footer bounds");')
    .replace("if (state.scan != state.endoffset) { console.log(`didn't read full footer, ${state.endoffset - state.scan} bytes left`); }",
      'if (state.scan != state.endoffset) throw new Error("Unconsumed footer bytes");');
  const { buildParser } = await import(`data:text/javascript;base64,${Buffer.from(opcodeJs).toString('base64')}`);
  const typedefBytes = readFileSync(join(src, 'opcodes/typedef.jsonc'), 'utf8');
  const typedef = parseJsonc(typedefBytes), parsers = new Map(), schemaHashes = { 'typedef.jsonc': sha256(typedefBytes) };
  for (const file of ['cacheindex.json', 'mapsquare_tiles.jsonc', 'mapsquare_tiles_nxt.jsonc',
    'mapsquare_locations.json', 'locs.jsonc', 'npcs.jsonc', 'maplabels.jsonc', 'maplabellocations.jsonc',
    'mapzones_pastes.json', 'mapzones.json', 'mapsquare_overlays.jsonc', 'mapsquare_underlays.jsonc'])
    schemaHashes[file] = sha256(readFileSync(join(src, 'opcodes', file)));
  const baseDecode = decoders.decode.bind(decoders);
  decoders.decode = (kind, buffer, args = {}) => {
    if (!SCHEMAS[kind]) return baseDecode(kind, buffer, args);
    const file = SCHEMAS[kind];
    if (!parsers.has(file)) {
      const source = readFileSync(join(src, 'opcodes', file), 'utf8');
      schemaHashes[file] = sha256(source);
      parsers.set(file, buildParser(null, parseJsonc(source), typedef));
    }
    const state = { isWrite: false, buffer, stack: [], hiddenstack: [], scan: 0, endoffset: buffer.length,
      args: { buildnr: build, clientVersion: build, ...args } };
    let result;
    try { result = parsers.get(file).read(state); }
    catch (cause) { const error = new Error(`${kind} at byte ${state.scan}/${buffer.length}: ${cause.message}`); error.stack = error.message; throw error; }
    if (state.scan !== state.endoffset || state.endoffset < 0 || state.endoffset > buffer.length)
      throw new Error(`${kind}: ${state.endoffset - state.scan} unconsumed body bytes`);
    return result;
  };
  const cache = new CacheCopy(join(workspace, 'cache-copy'), decoders), archives = new Map();
  const originalFile = cache.file.bind(cache);
  cache.file = (major, minor) => {
    const buffer = originalFile(major, minor);
    const key = `${major}:${minor}`;
    if (buffer && !archives.has(key)) archives.set(key, { major, minor, sha256: sha256(buffer),
      hashScope: 'decompressed archive', version: cache.table(major).entries.get(minor)?.version ?? null,
      subfiles: cache.table(major).entries.get(minor)?.subindices ?? [] });
    return buffer;
  };
  const reference = resolve(import.meta.dirname, '../../rs3-chunkpicker-chunkinfo-export.json');
  const context = { schemaVersion: 1, generatedAt: new Date().toISOString(), workspace: workspace.replaceAll('\\', '/'),
    decoder: { repository: 'https://github.com/skillbert/rsmv', commit, buildSchema: build,
      buildStatus: 'inferred schema version; not independently verified game client build',
      sourceHashes: decoders.sourceHashes, schemaHashes, footerValidation: 'bounds and complete consumption required',
      executableInterpreterSha256: sha256(opcodeJs) },
    reference: { path: reference.replaceAll('\\', '/'), sha256: sha256RepositoryText(readFileSync(reference)) },
    archives, outputs: [], limits: ['Copied snapshot is not guaranteed latest live data.',
      'Client definitions do not certify server scripts, player state, spawns, drops, shop stock or XP rates.'] };
  return { cache, context };
}

/** Config tables use a single minor and subfile IDs. Grouped majors use minor*groupSize+subid. */
export function loadTable(cache, { major, kind, groupSize = 256, minor = null }) {
  const definitions = new Map(), errors = [], archives = [];
  for (const archiveId of minor === null ? cache.table(major).entries.keys() : [minor]) {
    let archive;
    try { archive = cache.archive(major, archiveId); }
    catch (error) { errors.push({ major, minor: archiveId, message: error.message }); continue; }
    if (!archive) { errors.push({ major, minor: archiveId, message: 'Declared archive missing from copied snapshot' }); continue; }
    archives.push({ major, minor: archiveId, subfiles: archive.size });
    for (const [subid, bytes] of archive) {
      const id = minor === null ? archiveId * groupSize + subid : subid;
      try { definitions.set(id, cache.decoders.decode(kind, bytes)); }
      catch (error) { errors.push({ major, minor: archiveId, subid, id, message: error.message }); }
    }
  }
  return { definitions, errors, archives };
}

export function writeDataset(output, name, data) {
  const path = resolve(output, name);
  const rel = relative(resolve(output), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Dataset name must stay inside its output directory');
  mkdirSync(resolve(path, '..'), { recursive: true });
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path: path.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) };
}

export async function finishManifest(cache, context, output, { name = 'manifest.v1.json', ...extra } = {}) {
  const sources = [];
  for (const [major, table] of cache.tables) sources.push({ major, file: `js5-${major}.jcache`, bytes: table.size,
    sha256: await fileSha256(table.path), indexTimestamp: table.index.timestamp,
    declaredArchives: table.entries.size, presentArchives: table.db.prepare('SELECT COUNT(*) AS n FROM cache').get().n });
  const manifest = { ...context, ...extra, sources, archives: [...context.archives.values()].sort((a, b) => a.major - b.major || a.minor - b.minor) };
  return { manifest, file: writeDataset(output, name, manifest) };
}

export function cliOptions(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Options require --name value');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  return options;
}
