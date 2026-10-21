#!/usr/bin/env node
/** Exhaustive static layout research from copied JS5 archives only. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CacheCopy, loadDecoders, RSMV_COMMIT, fileSha256 } from './cache-reader.mjs';
import { loadSurfaceLayout } from './surface.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { proposeCoordinateMappings } from './interiors-v2-priority.mjs';

const repo = resolve(import.meta.dirname, '../..');
const defaults = {
  'cache-copy': 'C:/Users/User/Projects/rs3-cache-work/cache-copy',
  tool: 'C:/Users/User/Projects/rs3-cache-work/rsmv',
  places: 'C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/places.2026-10-08.v3.copy.json',
  travel: 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/travel.v1.json',
  catalogue: resolve(repo, 'app/data/cache-interiors.2026-10-08.v1.json'),
  output: resolve(repo, '.local/interiors-v2-research/all-layout-coordinate-proposals.json'),
};
const json = path => JSON.parse(readFileSync(path));

export async function buildAllLayoutCoordinateProposals(options = {}) {
  const args = { ...defaults, ...options }, output = resolve(args.output), tool = realpathSync(args.tool);
  if (existsSync(output)) throw new Error('Use a NEW output report path');
  if (!output.replaceAll('\\', '/').startsWith(resolve(repo, '.local/interiors-v2-research').replaceAll('\\', '/') + '/')) throw new Error('Report must stay inside this worktree .local/interiors-v2-research');
  const commit = execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== RSMV_COMMIT) throw new Error('Unpinned decoder checkout');
  execFileSync('git', ['-C', tool, 'diff', '--quiet', 'HEAD', '--', 'src/constants.ts', 'src/parser/opcode_reader.ts', 'src/opcodes']);
  const decoders = await loadDecoders(tool, 950), cache = new CacheCopy(args['cache-copy'], decoders);
  const manifest = { maps: [] }, skipped = [], layouts = [], sourceArchives = [];
  try {
    const zones = cache.archive(23, 0), pastes = cache.archive(23, 1);
    for (const mapId of [...zones.keys()].sort((a, b) => a - b)) {
      if (!pastes?.has(mapId)) { skipped.push({ mapId, reason: 'missing-static-paste-archive' }); continue; }
      sourceArchives.push({ mapId, zoneSha256: sha256(zones.get(mapId)), pasteSha256: sha256(pastes.get(mapId)) });
      let mapBlocks = 0;
      for (let plane = 0; plane < 4; plane++) {
        let layout;
        try { layout = loadSurfaceLayout(cache, { mapId, plane }); }
        catch (error) { skipped.push({ mapId, plane, reason: /Ambiguous/.test(error.message) ? 'ambiguous-overlapping-layout' : 'layout-decode-failure', message: error.message.split('\n')[0] }); continue; }
        if (!layout.blocks.size) { skipped.push({ mapId, plane, reason: 'zero-active-blocks', disabledPastes: layout.disabled.length }); continue; }
        const all = [...layout.blocks.values()], blocks = all.filter(block => Number.isInteger(block.source.plane) && block.source.plane >= 0 && block.source.plane <= 3);
        const invalid = all.length - blocks.length;
        if (invalid) skipped.push({ mapId, plane, reason: 'invalid-source-plane-blocks', count: invalid });
        if (!blocks.length) continue;
        mapBlocks += blocks.length;
        manifest.maps.push({ mapId, name: layout.name, plane, tiles: [{ provenance: { blocks } }] });
        layouts.push({ mapId, name: layout.name, plane, blocks: blocks.length, sourcePlanes: [...new Set(blocks.map(block => block.source.plane))].sort() });
      }
      if (!mapBlocks) skipped.push({ mapId, reason: 'dormant-or-unusable-layout-no-active-blocks' });
    }
    const report = proposeCoordinateMappings({ catalogue: json(args.catalogue), places: json(args.places), travel: json(args.travel), manifest });
    report.methodology = 'Every copied JS5-23 zone with a static paste archive, independently decoded display planes 0-3, exact active 8x8 source/destination blocks. Source planes outside0-3 rejected, overlapping layouts skipped, zero-block dormant layouts skipped. Candidate conflicts across map templates remain unresolved unless one explicit equal-name coordinate witness singles out a map. Projected labels/typed coordinates retained separately; no zone-centre or bounds-only proposals.';
    report.inputs = ['catalogue', 'places', 'travel'].map(kind => ({ kind, file: resolve(args[kind]),
      sha256: (kind === 'catalogue' ? sha256RepositoryText : sha256)(readFileSync(args[kind])), hashKind: kind === 'catalogue' ? 'repository-lf' : 'exact-bytes' }));
    report.generatorSourceHashes = Object.fromEntries(['scripts/cache/interiors-v2-layout-proposals.mjs', 'scripts/cache/interiors-v2-priority.mjs', 'scripts/cache/cache-reader.mjs', 'scripts/cache/surface.mjs', 'scripts/lib/provenance-hash.mjs'].map(file => [file, sha256RepositoryText(readFileSync(resolve(repo, file)))]));
    const table = cache.table(23);
    report.cacheSource = { path: table.path, bytes: table.size, sha256: await fileSha256(table.path), access: 'CacheCopy readOnly:true + PRAGMA query_only=ON', rendererCommit: commit, inferredDecoderBuild: 950, decoderHashes: decoders.sourceHashes, sourceArchives };
    report.layoutSummary = { zoneRecords: zones.size, pasteArchives: pastes.size, activeMaps: new Set(layouts.map(row => row.mapId)).size, activeMapPlanes: layouts.length, exactBlocks: layouts.reduce((sum, row) => sum + row.blocks, 0), skipped: skipped.length, ambiguousMapPlanes: skipped.filter(row => row.reason === 'ambiguous-overlapping-layout').length };
    report.layouts = layouts; report.skippedLayouts = skipped;
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, ...report.summary, layoutSummary: report.layoutSummary }));
    return report;
  } finally { cache.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const option = process.argv[i]?.slice(2); if (!(option in defaults) || !process.argv[i + 1]) throw new Error(`Invalid option ${process.argv[i]}`);
    options[option] = process.argv[i + 1];
  }
  buildAllLayoutCoordinateProposals(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
