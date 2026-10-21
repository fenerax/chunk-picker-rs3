import { datasetValue } from "../dataset-runtime.mjs";
// Authored overlay for the archival export. Region assignments are geographic
// inferences, not a collision dump; see docs/research/map-data-audit.md.
const walkable = datasetValue("app/data/map-corrections.mjs#walkable");
const mixed = datasetValue("app/data/map-corrections.mjs#mixed");

export const MAP_CORRECTIONS = datasetValue("app/data/map-corrections.mjs#MAP_CORRECTIONS");

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
