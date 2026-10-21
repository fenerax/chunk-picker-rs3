/** A source region is a retained coordinate reference, never an access grant. */
export function regionLayout(layout, region) {
  const blocks = new Map([...layout.blocks].filter(([, row]) => row.source.x >= region.minX && row.source.x < region.maxX
    && row.source.y >= region.minY && row.source.y < region.maxY));
  return { ...layout, blocks };
}

/** Unzoned instance templates retain source coordinates and an explicit identity. */
export function directSourceLayout(mapId, plane, squares, evidence) {
  const blocks = new Map();
  for (const square of squares) for (let x = square.x * 64; x < square.x * 64 + 64; x += 8) {
    for (let y = square.y * 64; y < square.y * 64 + 64; y += 8) {
      const source = { x, y, plane };
      blocks.set(`${plane}:${x / 8}:${y / 8}`, { mapId, source, destination: { ...source },
        translation: { x: 0, y: 0, plane: 0 }, paste: { kind: 'reviewed-direct-source-template', evidence } });
    }
  }
  return { mapId, plane, blocks };
}

/** Prefer a witnessed source block, rather than an unrelated whole-map centre. */
export function layoutAnchor(layout, evidence) {
  const first = layout.blocks.values().next().value;
  if (!first) return null;
  return { x: first.destination.x + 4, y: first.destination.y + 4, plane: layout.plane, mapId: layout.mapId,
    precision: 'source-region-anchor', coordinateEvidence: { kind: 'retained-source-region-paste',
      source: { x: first.source.x + 4, y: first.source.y + 4, plane: first.source.plane },
      translation: first.translation, paste: first.paste, evidence,
      scope: 'Exact source/display association, not an entrance or player arrival.' } };
}

export function applyInteriorResolution(area, { mapIds, layers, evidence, displayAnchor = null, entrances = [] }) {
  area.status = 'mapped'; area.mapIds = [...mapIds]; area.layers = layers;
  area.bounds = null; area.boundsKind = 'map-layout-coverage-available-per-layer; semantic-area-enclosure-unknown';
  area.resolvedIn = '2026-10-08.v2'; area.displayAnchor = displayAnchor;
  area.evidence = [...new Map([...area.evidence, ...evidence].map(e => [JSON.stringify(e), e])).values()];
  area.entrances = [...new Map([...area.entrances, ...entrances].map(e => [e.id, e])).values()];
  area.unknowns = ['Static copied-cache correspondence; current player instance and live entry are not observed.',
    'Rendered coverage is not a semantic enclosure or proof of area access.',
    ...(!area.entrances.length ? ['No reviewed exact entrance route; retained declarations remain approximate or unresolved.'] : [])];
  area.candidateMapIds = [];
}

/** Historical numeric aliases and named areas share identity only when unanimous. */
export function resolveNamedAliases(areas) {
  let changed = 0;
  for (const area of areas.filter(a => a.status === 'unknown' && !/^\d+$/.test(a.areaId))) {
    const numeric = areas.filter(a => /^\d+$/.test(a.areaId) && a.name === area.name && a.status === 'mapped');
    if (!numeric.length) continue;
    // Multiple maps can be different tutorial/quest instances. Do not merge them.
    const identities = new Set(numeric.map(a => JSON.stringify([...a.mapIds].sort((a, b) => a - b))));
    if (identities.size !== 1) continue;
    const grouped = new Map();
    for (const layer of numeric.flatMap(a => a.layers)) {
      const key = `${layer.mapId}:${layer.plane}`, previous = grouped.get(key);
      if (!previous) grouped.set(key, structuredClone(layer));
      else previous.bounds = { minX: Math.min(previous.bounds.minX, layer.bounds.minX), minY: Math.min(previous.bounds.minY, layer.bounds.minY),
        maxX: Math.max(previous.bounds.maxX, layer.bounds.maxX), maxY: Math.max(previous.bounds.maxY, layer.bounds.maxY) };
    }
    const layers = [...grouped.values()];
    applyInteriorResolution(area, { mapIds: numeric[0].mapIds, layers,
      evidence: [{ kind: 'unanimous-reviewed-numeric-alias', areaIds: numeric.map(a => a.areaId),
        scope: 'Named alias of reviewed retained source references; not current instance/access certainty.' }],
      displayAnchor: numeric[0].displayAnchor, entrances: numeric.flatMap(a => a.entrances) });
    area.aliasAreaIds = numeric.map(a => a.areaId); changed++;
  }
  return changed;
}
