import { datasetValue } from "../dataset-runtime.mjs";
// Authored overlay for the archival export. Region assignments are geographic
// inferences, not a collision dump; see docs/research/map-data-audit.md.
const walkable = datasetValue("app/data/map-corrections.mjs#walkable");
const mixed = datasetValue("app/data/map-corrections.mjs#mixed");

const retainedMapCorrections = datasetValue("app/data/map-corrections.mjs#MAP_CORRECTIONS");
// Keep authored fixes effective with released providers as well as tracked data.
// The existing sectionF2p path settles mixed cache masks via a certified legacy
// correspondence; it applies to every player, not just a setup-start command.
export const MAP_CORRECTIONS = Object.freeze([...retainedMapCorrections,
  ...(retainedMapCorrections.some(row => row.chunk === '13361' && row.section === '1' && row.field === 'sectionF2p') ? [] : [Object.freeze({
    chunk: '13361', section: '1', field: 'sectionF2p', oldValue: null, newValue: true,
    evidenceUrl: 'https://runescape.wiki/w/Bank_chest?oldid=37215299',
    confidence: 'medium-high', date: '2026-11-01',
    rationale: 'Kharid-et exterior surface bank chest 115427 at (3356,3198), plane 0, is mem=No (orchestrator Wiki check). Certified selector 13361-1 maps only component 1: 2209 free tiles and one coarse-mask members tile (3351,3159), the northeast corner of the 8x8 block (3344..3351,3152..3159). Its only walking exits go north/east to free tiles. The separate members pit remains component 2 and receives no override. Preserve raw counts; this is an authored geographic section policy, not a resource or start-only membership exception.',
  })]),
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Copy only authored map inputs; never mutate the archival export or fixtures. */
export function applyMapCorrections(input) {
  const definitions = { ...input, chunks: { ...input.chunks }, sections: { ...(input.sections ?? {}) } };
  for (const key of ['walkableChunks', 'walkableChunksF2P']) {
    if (Array.isArray(input[key])) definitions[key] = [...input[key]];
  }
  const sectionMembership = new Map(), sectionRoutes = new Map(), mapCorrections = [];
  for (const entry of MAP_CORRECTIONS) {
    const { chunk, section, field, oldValue, newValue } = entry;
    if (field === 'record') {
      // Do not add RS3 geography to an unrelated/synthetic definitions fixture.
      if (definitions.chunks[chunk] || !Array.isArray(definitions.walkableChunks) || !definitions.walkableChunks.includes(chunk)
        || !Array.isArray(definitions.walkableChunksF2P) || !definitions.walkableChunksF2P.includes(chunk)
        || !same(definitions.sections[chunk]?.['0'], ['13882-2', '13627'])
        || !input.chunks['13882'] || !input.chunks['13627']) continue;
      definitions.chunks[chunk] = { ...newValue };
    } else if (field === 'walkable' || field === 'f2p') {
      const key = field === 'walkable' ? 'walkableChunks' : 'walkableChunksF2P';
      const list = definitions[key];
      if (!Array.isArray(list) || (chunk !== '9722' && !definitions.chunks[chunk])) continue;
      if (chunk === '9722' && (definitions.chunks[chunk] || !definitions.chunks['9772'])) continue;
      if (list.some(id => typeof id === 'string' && id.trim() === chunk) !== oldValue) continue;
      definitions[key] = newValue ? [...list, chunk] : list.filter(id => typeof id !== 'string' || id.trim() !== chunk);
    } else if (field === 'connections') {
      if (!definitions.chunks[chunk] || !same(definitions.sections[chunk]?.[section], oldValue)) continue;
      definitions.sections[chunk] = { ...definitions.sections[chunk], [section]: [...newValue] };
    } else if (field === 'sectionF2p') {
      if (!definitions.chunks[chunk] || !Array.isArray(definitions.sections[chunk]?.[section])) continue;
      if (!sectionMembership.has(chunk)) sectionMembership.set(chunk, new Map());
      sectionMembership.get(chunk).set(section, newValue);
    } else if (field === 'routeKind') {
      if (!Array.isArray(input.sections?.[chunk]?.[section]) || !input.sections[chunk][section].includes(entry.edge)) continue;
      const id = `${chunk}-${section}`;
      if (!sectionRoutes.has(id)) sectionRoutes.set(id, new Map());
      sectionRoutes.get(id).set(entry.edge, newValue);
    }
    mapCorrections.push(entry);
  }
  return { definitions, sectionMembership, sectionRoutes, mapCorrections };
}
