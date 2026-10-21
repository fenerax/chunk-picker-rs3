#!/usr/bin/env node
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import catalogue from '../app/data/cache-interiors.2026-10-08.v2.json' with { type: 'json' };
import { buildInteriorMapIndex, getInteriorArea } from '../app/core/interior-maps.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { readStateCopy } from './preview-resource-contents.mjs';

/** The actual task engine owns personal/capability area gates. The catalogue
 * is joined only after that evaluation and cannot modify it. */
export function buildInteriorPreview(definitions, state, { interiorCatalogue = catalogue, ...options } = {}) {
  const before = JSON.stringify(state), index = buildInteriorMapIndex(interiorCatalogue), engine = createTaskEngine(definitions, { dataset: selectedDataset, ...options });
  const members = state.members.map(member => {
    const evaluated = engine.evaluate(state, member.id);
    const accessibleAreas = [...evaluated.access.areas].sort().map(areaId => {
      const area = getInteriorArea(index, areaId);
      return { areaId, name: area?.name ?? areaId, status: area?.status ?? 'unknown',
        maps: area?.maps.map(m => ({ mapId: m.mapId, plane: m.plane, bounds: m.bounds, tiles: m.tiles.length })) ?? [],
        renderedTiles: area?.maps.reduce((n, m) => n + m.tiles.length, 0) ?? 0,
        unknowns: area?.unknowns ?? ['Accessible area has no reviewed interior mapping.'] };
    });
    return { id: member.id, name: member.name, accessibleAreas,
      counts: { accessibleAreas: accessibleAreas.length, mappedAreas: accessibleAreas.filter(a => a.status === 'mapped').length,
        unknownAreas: accessibleAreas.filter(a => a.status === 'unknown').length, availableTaskRows: evaluated.tasks.filter(t => t.status === 'available').length,
        taskChanges: 0, availabilityGains: 0, availabilityLosses: 0 } };
  });
  if (before !== JSON.stringify(state)) throw new Error('Interior preview mutated input state');
  return { schemaVersion: 1, displayOnly: true, accessEffect: 'none', ownershipUnchanged: true,
    taskCoverage: 'Actual task-engine area/capability gates evaluated once; display catalogue joined afterwards. No definitions, access rules, task or availability changes.', members };
}
export async function main(args = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') flags.json = true;
    else if (['--state', '--definitions'].includes(args[i]) && args[i + 1]) flags[args[i]] = args[++i];
    else throw new Error('Use --state <copy.json> [--definitions <definitions.json>] [--json]');
  }
  const loaded = await readStateCopy(flags['--state']);
  const definitionFile = await realpath(flags['--definitions'] ? resolve(flags['--definitions']) : new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url));
  if (/[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(String(definitionFile))) throw new Error('Use inputs outside .local/duo');
  const bytes = await readFile(definitionFile), report = { ...buildInteriorPreview(JSON.parse(bytes), loaded.state), sourceSha256: loaded.sourceSha256 };
  await loaded.verifyUnchanged();
  if (!bytes.equals(await readFile(definitionFile))) throw new Error('Definitions changed during preview');
  process.stdout.write(flags.json ? JSON.stringify(report, null, 2) + '\n' : report.members.map(m => `${m.name || m.id}: ${m.counts.accessibleAreas} accessible areas; ${m.counts.mappedAreas} mapped, ${m.counts.unknownAreas} unknown; task changes 0, availability changes 0`).join('\n') + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
