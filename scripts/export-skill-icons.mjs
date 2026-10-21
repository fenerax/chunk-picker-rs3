/** Export native skill sprites from an offline cache copy. Never opens a game client.
 * node scripts/export-skill-icons.mjs --workspace C:/path/to/rs3-cache-work
 *   --output C:/path/to/NEW/icons-skills.2026-10-08.v1 --manifest C:/path/to/NEW/manifest.json
 * Requires Node >=24 and Python 3 (stdlib bz2 for legacy sprite containers).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openGameCache, cliOptions } from './cache/game-data-common.mjs';
import { decompress, sha256, fileSha256, RSMV_COMMIT } from './cache/cache-reader.mjs';
import { decodeSpriteFrames, rgbaPng } from './cache/pins.mjs';

export const VERSION = '2026-10-08.v1';
export const SKILLS = ['Attack','Strength','Ranged','Magic','Defence','Constitution','Prayer','Agility','Herblore','Thieving','Crafting','Runecrafting','Mining','Smithing','Fishing','Cooking','Firemaking','Woodcutting','Fletching','Slayer','Farming','Construction','Hunter','Summoning','Dungeoneering','Divination','Invention','Archaeology','Necromancy'];
const ALIASES = { Constitution: ['Hitpoints','Hit points'], Defence: ['Defense'], Runecrafting: ['Runecraft'] };
const BZIP = 'import bz2,sys; sys.stdout.buffer.write(bz2.decompress(sys.stdin.buffer.read()))';

export function decodeSkillContainer(input, python = 'python') {
  input = Buffer.from(input);
  if (input[0] !== 1) return decompress(input);
  if (input.length < 9) throw new Error('Truncated bzip2 sprite container');
  const compressed = input.readUInt32BE(1), expected = input.readUInt32BE(5);
  const tail = input.length - 9 - compressed;
  if (![0, 2].includes(tail) || expected > 64 * 1024 * 1024) throw new Error('Invalid bzip2 sprite bounds');
  // RuneScape stores the bzip stream without BZhN. Match pinned rsmv's block size 8.
  const output = execFileSync(python, ['-c', BZIP], {
    input: Buffer.concat([Buffer.from('BZh8'), input.subarray(9, 9 + compressed)]), maxBuffer: expected + 1024,
    windowsHide: true,
  });
  if (output.length !== expected) throw new Error('Bzip2 sprite output length mismatch');
  return output;
}

export function verifySkillEnums(names, small, large) {
  const rows = d => new Map(d?.stringArrayValue2?.values ?? d?.intArrayValue2?.values ?? []);
  const n = rows(names), s = rows(small), l = rows(large);
  return SKILLS.map((name, index) => {
    const key = index + 1;
    if (n.get(key) !== name || !Number.isInteger(s.get(key)) || !Number.isInteger(l.get(key)))
      throw new Error(`Copied enum mapping does not match skill ${key}: ${name}`);
    return { name, key, small: s.get(key), large: l.get(key) };
  });
}

export async function exportSkillIcons({ workspace, output, manifest: manifestPath, python = 'python', generatedAt = new Date().toISOString() }) {
  if (!workspace || !output || !manifestPath) throw new Error('Required --workspace, --output and --manifest');
  output = resolve(output); manifestPath = resolve(manifestPath);
  if (existsSync(output) || existsSync(manifestPath)) throw new Error('Refusing to overwrite an existing skill asset directory or manifest');
  if (basename(output) !== `icons-skills.${VERSION}`) throw new Error(`New asset directory must be icons-skills.${VERSION}`);
  const { cache, context } = await openGameCache({ workspace, build: 950 });
  try {
    const enumEvidence = {};
    const enumDefinition = id => {
      const groupId = Math.floor(id / 256), subfileId = id % 256;
      const bytes = cache.archive(17, groupId)?.get(subfileId);
      if (!bytes) throw new Error(`Missing copied enum ${id}`);
      enumEvidence[id] = { archiveId: 17, groupId, subfileId, sha256: sha256(bytes), groupSha256: sha256(cache.file(17, groupId)) };
      return cache.decoders.decode('enum', bytes);
    };
    const mappings = verifySkillEnums(enumDefinition(108), enumDefinition(371), enumDefinition(745));
    const interfaceBytes = cache.file(3, 1213), components = cache.archive(3, 1213);
    if (!components || !interfaceBytes) throw new Error('Missing copied skill selection interface 1213');
    const witnesses = new Map();
    for (const [componentId, bytes] of components) {
      const d = cache.decoders.decode('interface', bytes), trigger = d.scripts?.triggerop;
      if (trigger?.[0] === 5682 && Number.isInteger(trigger[1]) && d.spritedata) {
        witnesses.set(trigger[1], { componentId, spriteId: d.spritedata.spriteid, width: d.basewidth, height: d.baseheight, sha256: sha256(bytes) });
      }
    }
    for (const m of mappings) if (witnesses.get(m.key)?.spriteId !== m.small)
      throw new Error(`Skill interface does not corroborate ${m.name}`);
    mkdirSync(output, { recursive: false });
    const icons = {}, unmatched = [], unavailableLarge = [];
    const exportSprite = (m, groupId, file, enumId) => {
      const row = cache.table(8).statement.get(groupId);
      if (!row) throw new Error('Sprite is absent from copied cache');
      const raw = Buffer.from(row.DATA), group = decodeSkillContainer(raw, python);
      const frames = decodeSpriteFrames(group), frame = frames[0];
      if (frames.length !== 1 || !frame?.width || !frame?.height) throw new Error('Expected one nonempty native skill frame');
      const png = rgbaPng(frame.width, frame.height, frame.rgba);
      writeFileSync(join(output, file), png, { flag: 'wx' });
      return { file, width: frame.width, height: frame.height, bytes: png.length, sha256: sha256(png), source: {
        kind: 'cache-sprite', archiveId: 8, groupId, frameId: 0,
        archiveSha256: sha256(raw), groupSha256: sha256(group), compression: raw[0] === 1 ? 'bzip2' : raw.subarray(0,4).toString('hex') === '5a4c4201' ? 'zlib-sqlite' : `js5-${raw[0]}`,
        enumId, enumKey: m.key, nameEnumId: 108,
        anchor: { x: frame.x, y: frame.y, fullwidth: frame.fullwidth, fullheight: frame.fullheight },
      } };
    };
    for (const m of mappings) {
      const stem = m.name.toLowerCase();
      try {
        icons[m.name] = { ...exportSprite(m, m.small, `${stem}.png`, 371), aliases: ALIASES[m.name] ?? [],
          mappingEvidence: { interfaceId: 1213, ...witnesses.get(m.key), triggerScriptId: 5682, triggerSkillKey: m.key } };
      } catch (error) { unmatched.push({ name: m.name, reason: error.message }); continue; }
      try { icons[m.name].large = exportSprite(m, m.large, `${stem}-large.png`, 745); }
      catch (error) { unavailableLarge.push({ name: m.name, reason: error.message }); }
    }
    const sources = [];
    for (const major of [3, 8, 17]) {
      const table = cache.table(major);
      sources.push({ archiveId: major, file: `js5-${major}.jcache`, bytes: table.size, sha256: await fileSha256(table.path) });
    }
    const result = { schemaVersion: 1, kind: 'skills', version: VERSION, assetDirectory: basename(output), generatedAt,
      source: { cacheBuild: 950, cacheBuildStatus: context.decoder.buildStatus, rsmvCommit: RSMV_COMMIT,
        decoder: context.decoder, copiedFiles: sources, enumEvidence,
        interfaceEvidence: { archiveId: 3, groupId: 1213, groupSha256: sha256(interfaceBytes) },
        hashScopes: { archiveSha256: 'raw stored compressed JS5 container', groupSha256: 'decompressed sprite group bytes' },
        bzip2: { backend: 'Python stdlib bz2', pythonVersion: execFileSync(python, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() },
      }, icons, unmatched, unavailableLarge,
      coverage: { requested: SKILLS.length, mapped: Object.keys(icons).length, bySource: { 'cache-sprite': Object.keys(icons).length } },
      totalBytes: Object.values(icons).reduce((sum, row) => sum + row.bytes + (row.large?.bytes ?? 0), 0),
      limits: ['Copied snapshot may differ from live game data.', 'PNG files preserve native dimensions and alpha; no resampling or recoloring.', 'Skill names and sprite correspondence come from cache enums 108/371/745, corroborated by skill-selection interface 1213.'],
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    writeFileSync(join(output, 'manifest.json'), json, { flag: 'wx' });
    if (manifestPath !== join(output, 'manifest.json')) writeFileSync(manifestPath, json, { flag: 'wx' });
    return result;
  } finally { cache.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = cliOptions();
  const unknown = Object.keys(options).filter(key => !['workspace','output','manifest','python','generatedAt'].includes(key));
  if (unknown.length) throw new Error(`Unknown options: ${unknown.join(', ')}`);
  const result = await exportSkillIcons(options);
  console.log(JSON.stringify({ coverage: result.coverage, totalBytes: result.totalBytes, unavailableLarge: result.unavailableLarge }));
}
