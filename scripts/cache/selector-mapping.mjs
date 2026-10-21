/** Spatial identity only: these witnesses do not certify interaction or transit. */
export function tileComponent(regions, x, y, sourcePlane = null) {
  const base = String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
  const region = regions.get(base);
  if (!region?.masks?.components) return null;
  if (sourcePlane !== null && region.masks.planes && Buffer.from(region.masks.planes, 'base64')[(x % 64) * 64 + y % 64] !== sourcePlane) return null;
  const bytes = Buffer.from(region.masks.components, 'base64');
  const label = bytes.readUInt16LE(((x % 64) * 64 + y % 64) * 2);
  return label ? `${base}:${label}` : null;
}

export function placementWitness(regions, placement) {
  const { x, y, width = 1, length = 1, base } = placement;
  const plane = placement.plane ?? 0;
  const direct = tileComponent(regions, x, y, plane);
  if (direct?.startsWith(`${base}:`)) return { method: 'exact-placement-tile', components: [direct], tiles: [[x, y, direct]] };
  // The complete cardinal perimeter of the decoded rectangle is geometric
  // evidence. It is never expanded by a radius or ranked by distance/size.
  const tiles = [];
  for (let dx = 0; dx < width; dx++) for (const z of [y - 1, y + length]) tiles.push([x + dx, z]);
  for (let dz = 0; dz < length; dz++) for (const xx of [x - 1, x + width]) tiles.push([xx, y + dz]);
  const witnessed = tiles.map(([xx, z]) => [xx, z, tileComponent(regions, xx, z, plane)])
    .filter(([, , component]) => component?.startsWith(`${base}:`));
  return { method: 'decoded-footprint-perimeter', components: [...new Set(witnessed.map(row => row[2]))].sort(), tiles: witnessed };
}

export function decideSelector(anchors, coverage) {
  if (coverage !== 'decoded') return { components: [], reason: 'missing-plane-0-coverage' };
  if (!anchors.length) return { components: [], reason: 'no-exclusive-coordinate-anchor' };
  const usable = anchors.filter(a => !a.conditional && a.witness.components.length);
  if (!usable.length) return { components: [], reason: 'anchors-have-no-unconditional-walkable-witness' };
  // A component must witness every usable anchor. A second spatial anchor can
  // disambiguate a complete perimeter; counting votes or fragment size cannot.
  const components = usable.reduce((common, a) => common.filter(c => a.witness.components.includes(c)), usable[0].witness.components);
  if (components.length > 1) return { components: [], reason: 'footprint-touches-several-components' };
  if (!components.length) return { components: [], reason: 'exclusive-anchors-disagree' };
  return { components, reason: 'exclusive-declared-object-spatial-agreement' };
}

export function applySelectorEvidence(mapping, cacheRegions, evidence) {
  const byLegacy = new Map();
  for (const row of evidence.records) {
    if (byLegacy.has(row.legacy)) throw new Error(`Duplicate selector evidence: ${row.legacy}`);
    byLegacy.set(row.legacy, row);
  }
  const labels = new Map(cacheRegions.map(row => [row[0], new Set(row[3].map(c => c[0]))]));
  for (const record of mapping) {
    const review = byLegacy.get(record.legacy);
    if (!review) continue;
    record.spatialReview = { evidence: record.legacy, reason: review.reason, cohort: review.cohort,
      components: review.components, foundNames: review.foundNames };
    if (record.components.length || !review.components.length) continue;
    const [base] = record.legacy.split('-');
    const accepted = review.components.map(component => {
      const [region, suffix] = component.split(':');
      const label = Number(suffix);
      if (region !== base || !labels.get(base)?.has(label)) throw new Error(`Invalid spatial component for ${record.legacy}: ${component}`);
      return label;
    });
    if (review.reason !== 'exclusive-declared-object-spatial-agreement') throw new Error(`Uncertified selector evidence: ${record.legacy}`);
    record.originalMapping = { components: [...record.components], candidates: [...record.candidates], method: record.method, signature: [...record.signature] };
    record.components = accepted;
    record.method = 'declared-object-spatial-agreement';
    record.evidence = { record: record.legacy, anchors: review.anchors.filter(a => !a.conditional && a.witness.components.length)
      .map(a => ({ name: a.name, objectId: a.objectId, x: a.x, y: a.y, footprint: [a.width, a.length],
        source: a.source, definitionSource: a.definitionSource, witness: a.witness })) };
  }
  return mapping;
}

/** Location requirements locate no particular action without task coordinates. */
export function collectTaskLocationDeclarations(definitions, mapping, taskIdentity) {
  const bySelector = new Map(mapping.map(row => [row.legacy, []]));
  const aliases = definitions.codeItems?.chunksPlus ?? {};
  const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
  function expand(token, seen = new Set()) {
    const clean = String(token).replaceAll('*', '');
    const match = /^(.*\[\+\])(?:x\d+)?$/.exec(clean);
    if (!match) return [clean];
    const keys = Object.keys(aliases).filter(key => key.toLowerCase() === match[1].toLowerCase());
    const key = Object.hasOwn(aliases, match[1]) ? match[1] : keys.length === 1 ? keys[0] : null;
    if (!key || seen.has(key)) return [];
    return array(aliases[key]).flatMap(value => expand(value, new Set([...seen, key])));
  }
  for (const [category, tasks] of Object.entries(definitions.challenges ?? {})) {
    for (const [rawLabel, task] of Object.entries(tasks)) {
      for (const field of ['Chunks', 'CHunks', 'Sections']) for (const rawToken of array(task[field])) {
        for (const location of [...new Set(expand(rawToken))]) {
          const selectors = bySelector.has(location) ? [location] : /^[1-9]\d*$/.test(location)
            ? mapping.filter(row => row.legacy.startsWith(`${location}-`)).map(row => row.legacy) : [];
          for (const selector of selectors) bySelector.get(selector).push({ taskId: taskIdentity(category, rawLabel, task),
            category, rawLabel, field, rawToken, expandedLocation: location });
        }
      }
    }
  }
  return bySelector;
}
