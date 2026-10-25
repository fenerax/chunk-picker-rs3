import { datasetJSON, selectedDataset } from "../dataset-runtime.mjs";
const baseCatalogue = await datasetJSON("app/data/cache-resources.2026-10-08.v1.json");
const baseSelectors = await datasetJSON("app/data/cache-resource-selectors.2026-10-08.v1.json");
const divination = await datasetJSON("app/data/cache-divination.2026-10-13.v1.json");

const catalogue = { ...baseCatalogue, classes: [...baseCatalogue.classes, ...divination.classes],
  coverage: [...new Set([...baseCatalogue.coverage, ...divination.coverage])],
  placements: [...baseCatalogue.placements, ...divination.placements],
  provenance: { ...baseCatalogue.provenance, divination: divination.provenance } };
const selectors = { ...baseSelectors, mappings: [...baseSelectors.mappings, ...divination.mappings] };

/** One server-side rollback switch; browser callers receive the chosen mode. */
export function cacheResourceContentsEnabled() {
  return selectedDataset.capabilities.cacheResources;
}

// Reviewed placements the game never lets a player use, adapted from RuneScape
// Wiki contributors (CC BY-NC-SA 3.0). Mami Rimba's bloodwood tree north of
// Edgeville Monastery has a "Chop down" option in the cache but cannot be cut;
// the Wiki's bloodwood tree locations omit it, and a player confirmed it in game.
// The original picker lists it separately as "Bloodwood tree (Mami)".
export const unusablePlacements = new Map([
  ['object-59cb89f84994493e389d4770@28:0:3059:3517', 'https://runescape.wiki/w/Bloodwood_tree'],
]);

const entries = value => Object.entries(value ?? {});
const unpack = (columns, row) => Array.isArray(row) ? Object.fromEntries(columns.map((key, index) => [key, row[index]])) : row;
const classesOf = row => row.classKeys ?? (row.classKey ? [row.classKey] : []);

/** Static placements never create walking edges or promote retained aliases. */
export function applyCacheResources(world, definitions, {
  enabled = cacheResourceContentsEnabled(), resourceCatalogue = catalogue, resourceSelectors = selectors,
  preserveUnmappedProvenance = false,
} = {}) {
  world.resourceContents = new Map(entries(definitions.chunks));
  world.resourceContentsMode = enabled && !!world.cacheWalking ? 'game-data' : 'retained';
  if (world.resourceContentsMode === 'retained') return world;
  const coverage = new Set(resourceCatalogue.coverage.filter(row => {
    const value = Array.isArray(row) ? { chunkId: row[0], status: row[1] } : row;
    return ['decoded', 'decoded-layout-source'].includes(value.status);
  }).map(row => Array.isArray(row) ? row[0] : row.chunkId));
  const mappings = new Map(resourceSelectors.mappings.map(row => [row.name, row]));
  const classRecords = new Map((resourceCatalogue.classes ?? []).map(row => [row.key ?? row.classKey, row]));
  const namesByClass = new Map();
  for (const mapping of mappings.values()) if (!mapping.name.includes('[+]') && !mapping.unmatchedChildren?.length) for (const key of classesOf(mapping)) {
    if (!namesByClass.has(key)) namesByClass.set(key, []);
    namesByClass.get(key).push(mapping.name);
  }
  const columns = resourceCatalogue.placementColumns ?? resourceCatalogue.schema?.placementColumns ?? resourceCatalogue.columns?.placements ?? [];
  const byComponent = new Map(), byChunk = new Map(), retainedNodes = new Map(), superseded = new Map(), attachedIds = new Set();
  const generatedProvenance = new Set();
  const summary = { coveredChunks: coverage.size, affectedChunks: 0, addedDeclarations: 0, supersededDeclarations: 0,
    retainedOnlyDeclarations: 0, attachedPlacements: 0 };
  for (const packed of resourceCatalogue.placements) {
    const p = unpack(columns, packed), base = String(p.chunkId);
    if (!coverage.has(base) || !world.chunks.has(base) || unusablePlacements.has(p.id)) continue;
    const components = (p.components ?? []).map(id => id.includes(':')
      ? `${id.split(':')[0]}-${1000000 + Number(id.split(':')[1])}` : id)
      .filter(id => world.cacheWalking.components.has(id));
    if (!components.length) continue;
    attachedIds.add(p.id);
    for (const key of classesOf(p)) {
      const classRecord = classRecords.get(key), names = namesByClass.get(key) ?? [];
      const untyped = /^(?:tree|ore):unknown(?:$|:)/.test(key);
      const rawName = classRecord?.name ?? names[0] ?? key;
      const displayName = untyped && !rawName.includes('(untyped)') ? `${rawName} (untyped)` : rawName;
      // Display labels describe catalogue contents. Only reviewed mappings
      // certify task selectors; an ambiguous label must not revive itself.
      const selectorsForClass = untyped ? [] : [...new Set(names)];
      if (!byChunk.has(base)) byChunk.set(base, new Map());
      const chunkGroups = byChunk.get(base), whole = chunkGroups.get(key)
        ?? { classKey: key, name: displayName, names: selectorsForClass, count: 0, placements: [], components: new Set(), retainedSources: [],
          ...(typeof classRecord?.members === 'boolean' ? { members: classRecord.members } : {}) };
      if (!whole.placements.some(placement => placement.id === p.id)) {
        whole.count += p.multiplicity ?? 1; whole.placements.push(p);
      }
      components.forEach(component => whole.components.add(component));
      chunkGroups.set(key, whole);
      for (const component of components) {
        if (!byComponent.has(component)) byComponent.set(component, new Map());
        const group = byComponent.get(component), previous = group.get(key)
          ?? { classKey: key, name: displayName, names: selectorsForClass, count: 0, placements: [], gateLocations: [], retainedSources: whole.retainedSources,
            ...(typeof classRecord?.members === 'boolean' ? { members: classRecord.members } : {}) };
        previous.count += p.multiplicity ?? 1; previous.placements.push(p);
        group.set(key, previous);
      }
    }
  }
  summary.attachedPlacements = attachedIds.size;
  // A same-class placement confirms the resource and its cache quantity, even
  // when a closed door or uncertain section correspondence separates it from
  // the retained access location. Preserve that location as a resource route;
  // it never becomes a walking edge or a seed for another resource.
  for (const base of coverage) {
    const record = definitions.chunks[base] ?? (world.chunks.has(base) ? { Nickname: world.chunks.get(base).name } : null);
    if (!record) continue;
    const project = (node, location) => {
      const ObjectContents = { ...node.Object }, ObjectProvenance = {};
      for (const [name, count] of entries(node.Object)) {
        const mapping = mappings.get(name), keys = classesOf(mapping ?? {});
        // A composing catalogue owns only its reviewed selectors. Keep the
        // complete prior provenance (or its absence) for unrelated rows.
        if (preserveUnmappedProvenance && !mapping) {
          if (Object.hasOwn(node.ObjectProvenance ?? {}, name)) ObjectProvenance[name] = node.ObjectProvenance[name];
          continue;
        }
        const matches = keys.map(key => byChunk.get(base)?.get(key)).filter(Boolean);
        const confirmed = count !== false && matches.length > 0 && !mapping.unmatchedChildren?.length && !name.includes('[+]');
        if (confirmed) {
          delete ObjectContents[name];
          if (!superseded.has(location)) superseded.set(location, new Set());
          superseded.get(location).add(name); summary.supersededDeclarations++;
          for (const resource of matches) {
            if (!resource.retainedSources.some(source => source.location === location && source.name === name))
              resource.retainedSources.push({ location, name });
            for (const component of resource.components) {
              const attached = byComponent.get(component)?.get(resource.classKey);
              if (!attached.gateLocations.includes(location)) attached.gateLocations.push(location);
            }
          }
        } else {
          ObjectProvenance[name] = { source: 'retained-only', ...(keys.length === 1 ? { classKey: keys[0] } : {}),
            reason: keys.length ? 'No witnessed static placement of the reviewed class in this chunk.' : 'No reviewed static-resource selector mapping.' };
          summary.retainedOnlyDeclarations++;
        }
      }
      const projected = { ...node, ...(node.Object ? { Object: ObjectContents, ObjectProvenance } : {}) };
      if (preserveUnmappedProvenance && !Object.hasOwn(node, 'ObjectProvenance') && !Object.keys(ObjectProvenance).length)
        delete projected.ObjectProvenance;
      retainedNodes.set(location, projected);
      return projected;
    };
    // Display aggregation must not put cache-only rows into retained nodes:
    // those nodes are collected through their original access locations.
    const projected = { ...project(record, base) };
    if (record.Sections) projected.Sections = Object.fromEntries(entries(record.Sections).map(([suffix, node]) => [suffix, project(node, `${base}-${suffix}`)]));
    const ObjectContents = { ...projected.Object }, ObjectProvenance = { ...projected.ObjectProvenance };
    for (const resource of byChunk.get(base)?.values() ?? []) {
        // Component indexes retain exact access witnesses. Chunk info shows
        // each physical placement once, including shared-border witnesses.
        const name = Object.hasOwn(ObjectContents, resource.name) && ObjectProvenance[resource.name]?.source !== 'game-data'
          ? `${resource.name} (game data)` : resource.name;
        const prior = ObjectProvenance[name], priorIds = new Set(prior?.placements ?? []);
        const uniquePlacements = resource.placements.filter(p => !priorIds.has(p.id));
        ObjectContents[name] = (ObjectContents[name] ?? 0) + uniquePlacements.reduce((sum, p) => sum + (p.multiplicity ?? 1), 0);
        ObjectProvenance[name] = { source: 'game-data', classKey: prior?.classKey ?? resource.classKey,
          classKeys: [...new Set([...(prior?.classKeys ?? []), resource.classKey])].sort(),
          objectIds: [...new Set([...(prior?.objectIds ?? []), ...resource.placements.map(p => p.objectId)])].sort((a, b) => a - b),
          placements: [...new Set([...(prior?.placements ?? []), ...resource.placements.map(p => p.id)])],
          components: [...new Set([...(prior?.components ?? []), ...resource.components])].sort(),
          retainedLocations: [...new Set([...(prior?.retainedLocations ?? []), ...resource.retainedSources.map(source => source.location)])].sort(),
          cacheOnly: !resource.retainedSources.length && (prior?.cacheOnly ?? true), evidence: resourceCatalogue.provenance };
        generatedProvenance.add(ObjectProvenance[name]);
        if (!entries(record.Object).some(([name]) => classesOf(mappings.get(name) ?? {}).includes(resource.classKey))
          && !entries(record.Sections).some(([, node]) => entries(node.Object).some(([name]) => classesOf(mappings.get(name) ?? {}).includes(resource.classKey)))) summary.addedDeclarations++;
    }
    if (Object.keys(ObjectContents).length) {
      projected.Object = ObjectContents;
      if (!preserveUnmappedProvenance || Object.keys(ObjectProvenance).length) projected.ObjectProvenance = ObjectProvenance;
    }
    world.resourceContents.set(base, projected);
    if (byChunk.get(base)?.size || (superseded.get(base)?.size ?? 0)
      || entries(record.Sections).some(([suffix]) => superseded.has(`${base}-${suffix}`))) summary.affectedChunks++;
  }
  // Gated retained sources can be absent from Object declarations. Preserve
  // their requirements for a new placement anywhere in the same base; when
  // the old section geometry is unresolved, all its gates remain applicable.
  for (const [id, groups] of byComponent) for (const resource of groups.values()) {
    const base = id.split('-')[0];
    for (const name of resource.names) for (const [location] of entries(definitions.taskUnlocks?.Objects?.[name])) {
      if (location.split('-')[0] !== base) continue;
      const matched = world.cacheWalking.legacyToComponents.get(location);
      const correspondence = world.cacheWalking.mapping?.find(row => row.legacy === location);
      if (!location.includes('-') || !matched?.length || correspondence?.resourceUnresolved || correspondence?.project === false || matched.includes(id)) {
        if (!resource.gateLocations.includes(location)) resource.gateLocations.push(location);
      }
    }
  }
  const replacedGateSources = new Set();
  for (const [name, locations] of entries(definitions.taskUnlocks?.Objects)) {
    const mapping = mappings.get(name);
    if (!mapping || name.includes('[+]') || mapping.unmatchedChildren?.length) continue;
    for (const [location] of entries(locations)) {
      const base = location.split('-')[0], matching = classesOf(mapping).map(key => byChunk.get(base)?.get(key)).filter(Boolean);
      if (matching.length) {
        replacedGateSources.add(`${location}\u0000${name}`);
        for (const resource of matching) if (!resource.retainedSources.some(source => source.location === location && source.name === name))
          resource.retainedSources.push({ location, name });
      }
    }
  }
  // Task-unlock source declarations can add a retained route after display
  // aggregation, so finalize provenance from the complete source list.
  for (const [base, groups] of byChunk) {
    const provenance = world.resourceContents.get(base)?.ObjectProvenance;
    for (const row of Object.values(provenance ?? {})) if (generatedProvenance.has(row)) {
      const sources = (row.classKeys ?? [row.classKey]).flatMap(key => groups.get(key)?.retainedSources ?? []);
      row.retainedLocations = [...new Set(sources.map(source => source.location))].sort();
      row.cacheOnly = sources.length === 0;
    }
  }
  world.cacheResources = { coverage, byComponent, byChunk, retainedNodes, superseded, mappings, summary,
    replacedGateSources,
    provenance: resourceCatalogue.provenance, review: resourceCatalogue.review ?? resourceCatalogue.reviewItems ?? [] };
  return world;
}
