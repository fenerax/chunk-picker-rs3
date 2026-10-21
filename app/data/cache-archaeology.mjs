import { datasetJSON, selectedDataset } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/cache-archaeology.2026-10-08.v1.json");
import { applyCacheResources } from './cache-resources.mjs';

/** Archaeology is separately opt-in; its catalogue never creates travel edges. */
export function cacheArchaeologyContentsEnabled() {
  return selectedDataset.capabilities.cacheArchaeology;
}

export function applyCacheArchaeology(world, definitions, {
  enabled = cacheArchaeologyContentsEnabled(), archaeologyCatalogue = catalogue,
} = {}) {
  world.archaeologyContentsMode = enabled && !!world.cacheWalking ? 'game-data' : 'retained';
  if (world.archaeologyContentsMode === 'retained') return world;
  const previousContents = world.resourceContents ?? new Map(Object.entries(definitions.chunks ?? {}));
  // Compose the resource projection first, so the later archaeological
  // projection cannot revive a superseded tree, ore or facility selector.
  const retained = world.cacheResources?.retainedNodes;
  const chunks = Object.fromEntries(Object.entries(definitions.chunks ?? {}).map(([base, original]) => {
    const node = retained?.get(base) ?? original;
    return [base, { ...node, ...(original.Sections ? { Sections: Object.fromEntries(Object.entries(original.Sections)
      .map(([suffix, section]) => [suffix, retained?.get(`${base}-${suffix}`) ?? section])) } : {}) }];
  }));
  const selectors = { mappings: archaeologyCatalogue.mappings ?? [], unmatched: [] };
  const projected = { ...world };
  applyCacheResources(projected, { ...definitions, chunks }, {
    enabled: true, resourceCatalogue: archaeologyCatalogue, resourceSelectors: selectors,
    preserveUnmappedProvenance: true,
  });
  const model = projected.cacheResources;
  const classes = new Map((archaeologyCatalogue.classes ?? []).map(row => [row.key, row]));
  for (const groups of [...model.byComponent.values(), ...model.byChunk.values()]) for (const resource of groups.values()) {
    const definition = classes.get(resource.classKey);
    // The access layer applies this only to component routes. Retained routes
    // retain their original section membership, gates and alternative routes.
    resource.members = typeof definition?.members === 'boolean' ? definition.members : null;
    resource.level = definition?.level ?? null;
    resource.kind = definition?.kind ?? null;
  }
  const contents = new Map(previousContents);
  const merge = (prior, next, location) => {
    const objects = { ...prior?.Object }, provenance = { ...prior?.ObjectProvenance };
    for (const name of model.superseded.get(location) ?? []) { delete objects[name]; delete provenance[name]; }
    Object.assign(objects, next?.Object); Object.assign(provenance, next?.ObjectProvenance);
    const sections = {};
    for (const suffix of new Set([...Object.keys(prior?.Sections ?? {}), ...Object.keys(next?.Sections ?? {})])) {
      sections[suffix] = merge(prior?.Sections?.[suffix], next?.Sections?.[suffix], `${location}-${suffix}`);
    }
    const merged = { ...prior, ...next, ...(Object.keys(objects).length ? { Object: objects, ObjectProvenance: provenance } : {}),
      ...(Object.keys(sections).length ? { Sections: sections } : {}) };
    if (!Object.hasOwn(prior ?? {}, 'ObjectProvenance') && !Object.keys(provenance).length) delete merged.ObjectProvenance;
    return merged;
  };
  for (const [base, next] of projected.resourceContents) contents.set(base, merge(previousContents.get(base), next, base));
  world.resourceContents = contents;
  world.cacheArchaeology = model;
  world.cacheArchaeology.provenance = archaeologyCatalogue.provenance;
  return world;
}

export { catalogue as cacheArchaeologyCatalogue };
