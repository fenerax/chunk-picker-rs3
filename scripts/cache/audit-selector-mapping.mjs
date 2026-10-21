import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CacheCopy, loadDecoders, fileSha256 } from './cache-reader.mjs';
import { loadSurfaceLayout, sourceToSurface, mapsquareId } from './surface.mjs';
import { applyMapCorrections } from '../../app/data/map-corrections.mjs';
import { placementWitness, decideSelector } from './selector-mapping.mjs';

const workspace = process.argv[2];
if (!workspace) throw new Error('Supply the audited rs3-cache-work directory (copied cache only).');
const auditDir = `${workspace}/outputs/cache-audit-2026-10-07-v4`;
const walkBytes = await fs.readFile(`${auditDir}/walkability.v1.json.gz`);
const walk = JSON.parse(gunzipSync(walkBytes));
const manifest = JSON.parse(await fs.readFile(`${auditDir}/manifest.v1.json`));
const sourceHashes = {};
for (const major of [5, 16, 23]) {
  const name = `js5-${major}.jcache`;
  const hash = await fileSha256(`${workspace}/cache-copy/${name}`);
  if (hash !== manifest.sources.find(s => s.major === major)?.sha256) throw new Error(`Copied ${name} differs from audited source.`);
  sourceHashes[name] = hash;
}
const regions = new Map(walk.regions.map(r => [r.id, r]));
const definitions = applyMapCorrections(JSON.parse(await fs.readFile(new URL('../../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)))).definitions;
const baseline = JSON.parse(await fs.readFile(new URL('../../app/data/cache-component-policy.2026-10-07.v1.json', import.meta.url)));
// Original unresolved cohort remains stable after regeneration.
const cohort = baseline.mapping.filter(r => r.method === 'unresolved' || r.originalMapping?.method === 'unresolved');
const priorities = ['13361-1', '13618-1', '12092-5', '13108-2', '13620-1'];
const review = [...cohort, ...baseline.mapping.filter(r => priorities.includes(r.legacy) && !cohort.some(c => c.legacy === r.legacy))];
const bases = new Set(review.map(r => r.legacy.split('-')[0]));
const decoders = await loadDecoders(`${workspace}/rsmv`, manifest.tool.buildSchema);
for (const [name, hash] of Object.entries(manifest.tool.sourceHashes)) if (decoders.sourceHashes[name] !== hash) throw new Error(`Decoder ${name} differs from audited source.`);
const cache = new CacheCopy(`${workspace}/cache-copy`, decoders);
const layout = loadSurfaceLayout(cache);
const sourceSquares = new Set();
for (const mapping of layout.blocks.values()) {
  const base = String(Math.floor(mapping.destination.x / 64) * 256 + Math.floor(mapping.destination.y / 64));
  if (bases.has(base)) sourceSquares.add(mapsquareId(Math.floor(mapping.source.x / 64), Math.floor(mapping.source.y / 64)));
}
const placements = new Map();
const defs = new Map();
const get = id => { if (!defs.has(id)) defs.set(id, cache.object(16, id, 'loc')); return defs.get(id); };
try {
  for (const minor of [...sourceSquares].sort((a, b) => a - b)) {
    const archive = cache.archive(5, minor);
    if (!archive?.get(0)) continue;
    const locations = cache.decoders.decode('locations', archive.get(0));
    for (const loc of locations.locations) {
      const definition = get(loc.id);
      if (!definition?.name || definition.name === 'null') continue;
      for (const [index, use] of loc.uses.entries()) {
        // Upper-floor locations do not identify a plane-0 component.
        if (use.plane !== 0) continue;
        const sx = (minor % 128) * 64 + use.x, sy = Math.floor(minor / 128) * 64 + use.y;
        let width = definition.width ?? 1, length = definition.length ?? 1;
        if (use.rotation & 1) [width, length] = [length, width];
        for (const point of sourceToSurface(layout, sx, sy, 0)) {
          const base = String(Math.floor(point.x / 64) * 256 + Math.floor(point.y / 64));
          if (!bases.has(base)) continue;
          const placement = { base, name: definition.name, objectId: loc.id, x: point.x, y: point.y, width, length,
            definitionSource: { major: 16, minor: Math.floor(loc.id / 256), subfile: loc.id % 256 },
            source: { major: 5, minor, subfile: 0, index, x: sx, y: sy, plane: 0, type: use.type, rotation: use.rotation },
            conditional: !!(definition.morphs_1 || definition.morphs_1_v2 || definition.morphs_2 || definition.morphs_2_v2) };
          if (!placements.has(base)) placements.set(base, []);
          placements.get(base).push(placement);
        }
      }
    }
  }
} finally { cache.close(); }
const records = [];
for (const row of review) {
  const [base, suffix] = row.legacy.split('-');
  const chunk = definitions.chunks[base];
  const section = suffix === '0' ? chunk : chunk?.Sections?.[suffix] ?? {};
  const names = Object.keys(section?.Object ?? {});
  const siblings = suffix === '0' ? [] : Object.entries(chunk?.Sections ?? {}).filter(([s]) => s !== suffix).map(([, s]) => s);
  const exclusiveNames = names.filter(n => !siblings.some(s => Object.hasOwn(s.Object ?? {}, n)));
  const anchors = (placements.get(base) ?? []).filter(p => exclusiveNames.includes(p.name))
    .map(p => ({ ...p, declaredCount: section.Object[p.name], witness: placementWitness(regions, p) }));
  const result = decideSelector(anchors, regions.get(base)?.status);
  records.push({ legacy: row.legacy, name: chunk?.Nickname ?? null, coverage: regions.get(base)?.status ?? 'missing',
    cohort: cohort.some(c => c.legacy === row.legacy) ? 'original-unresolved' : 'priority-corroboration',
    declarations: Object.fromEntries(['Object', 'NPC', 'Monster', 'Spawn', 'Connect'].map(k => [k, section?.[k] ?? {}])),
    exclusiveNames, foundNames: [...new Set(anchors.map(p => p.name))].sort(), ...result, anchors });
}
const output = { schemaVersion: 1, provenance: { source: 'cache-audit-2026-10-07-v4/walkability.v1.json.gz',
  walkabilitySha256: createHash('sha256').update(walkBytes).digest('hex'), copiedLocationSource: 'cache-copy/js5-5.jcache',
  copiedObjectDefinitions: 'cache-copy/js5-16.jcache', method: 'all-original-unresolved-selectors; exact-name sibling-exclusive object anchors' }, records };
output.provenance.sourceHashes = sourceHashes;
output.provenance.decoderSourceHashes = decoders.sourceHashes;
await fs.writeFile(new URL('../../app/data/cache-selector-evidence.2026-10-07.v1.json', import.meta.url), JSON.stringify(output));
await fs.mkdir(new URL('../../.local/cacheapply/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../../.local/cacheapply/selector-placements.json', import.meta.url), JSON.stringify([...placements]));
const original = records.filter(r => r.cohort === 'original-unresolved');
const counts = Object.fromEntries([...new Set(original.map(r => r.reason))].sort().map(reason => [reason, original.filter(r => r.reason === reason).length]));
console.log(JSON.stringify({ audited: original.length, resolved: original.filter(r => r.components.length).length, counts }, null, 2));
