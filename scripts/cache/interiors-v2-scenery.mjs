/** Static named maze scenery only. Conditional nameless morphs stay unobserved. */
export function puroWheatFootprints(square, readObject) {
  const rectangles = [], definitions = new Map();
  for (const location of square.locations.locations) {
    if (!definitions.has(location.id)) definitions.set(location.id, readObject(location.id));
    const definition = definitions.get(location.id);
    if (definition?.name !== 'Magical wheat') continue;
    for (const use of location.uses.filter(u => u.plane === 0)) {
      const swapped = use.rotation % 2 === 1;
      const width = (swapped ? definition.length : definition.width) ?? 1;
      const height = (swapped ? definition.width : definition.length) ?? 1;
      rectangles.push({ objectId: location.id, x: square.x * 64 + use.x, y: square.z * 64 + use.y,
        width, height, rotation: use.rotation, type: use.type });
    }
  }
  return rectangles;
}

/** Exact ground footprints, not model artwork or inferred collision/access. */
export function addWheatFootprints(svg, square, rectangles) {
  if (!rectangles.length) return svg;
  // The pinned SVG viewBox is 64x64 game tiles; the PNG is 256x256 pixels.
  const shapes = rectangles.map(r => `<rect x="${r.x - square.x * 64}" y="${64 - (r.y - square.z * 64) - r.height}" width="${r.width}" height="${r.height}" fill="#ccb465" stroke="#88763e" stroke-width="0.15"/>`).join('');
  return svg.replace('</svg>', `<g>${shapes}</g></svg>`);
}
