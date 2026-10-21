// Authored validation and graph assembly. Route selections and facts are in the
// separately licensed, revision-pinned Wiki batch; geometry creates no edges.
const cellId = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const coordinatePairs = text => [
  ...[...text.matchAll(/\bx:(\d+),\s*y:(\d+)/g)].map(m => [+m[1], +m[2]]),
  ...[...text.matchAll(/\bx\s*=\s*(\d+)\s*\|\s*y\s*=\s*(\d+)/gi)].map(m => [+m[1], +m[2]]),
  ...[...text.matchAll(/\|\s*(\d{4}),\s*(\d{4})(?=\s*\||\s*\}\})/g)].map(m => [+m[1], +m[2]])
];

export function buildWalking({ spec, pages, addCell, anchors }) {
  const walking = spec.walking;
  if (!walking) return [];
  const evidence = row => {
    const page = pages.get(row.page);
    if (!page || typeof row.needle !== 'string' || !row.needle || !page.text.includes(row.needle))
      throw new Error(`Walking evidence changed: ${row.page}.`);
    return page.provenance;
  };
  for (const row of walking.anchors) {
    const provenance = evidence({ page: row.page, needle: row.needle });
    if (!Number.isSafeInteger(row.x) || !Number.isSafeInteger(row.y)
      || !coordinatePairs(row.needle).some(([x, y]) => x === row.x && y === row.y)
      || /\b(?:plane\s*=\s*[1-9]|mapID\s*=\s*(?!28\b)\d+)/i.test(row.needle)
      || row.x < spec.bounds.minX || row.x > spec.bounds.maxX || row.y < spec.bounds.minY || row.y > spec.bounds.maxY)
      throw new Error(`Walking anchor has no reviewed surface coordinate: ${row.name}.`);
    const membership = evidence(row.membership);
    if (!/\|\s*(?:members\d*|mem)\s*=\s*no\b/i.test(row.membership.needle))
      throw new Error(`Walking anchor has no explicit free evidence: ${row.name}.`);
    if (anchors.has(row.name)) throw new Error(`Duplicate walking anchor: ${row.name}.`);
    const point = { x: row.x, y: row.y };
    const id = addCell(point, row.name, provenance);
    addCell(point, row.name, membership);
    if (id !== cellId(row.x, row.y)) throw new Error(`Walking cell arithmetic mismatch: ${row.name}.`);
    anchors.set(row.name, { ...point, id, provenance, membershipProvenance: membership });
  }
  const pairs = new Set();
  // The original batch connections are emitted by the owning generator.
  for (const row of spec.connections ?? []) {
    const a = anchors.get(row.from), b = anchors.get(row.to);
    if (a && b) pairs.add([a.id, b.id].sort().join(':'));
  }
  const result = [];
  for (const row of walking.edges) {
    const from = anchors.get(row.from), to = anchors.get(row.to);
    if (!from || !to || Math.abs(Math.floor(from.x / 64) - Math.floor(to.x / 64))
      + Math.abs(Math.floor(from.y / 64) - Math.floor(to.y / 64)) !== 1)
      throw new Error(`Walking endpoints must be adjacent reviewed cells: ${row.from} to ${row.to}.`);
    if (!Array.isArray(row.evidence) || !row.evidence.length) throw new Error('Walking route evidence missing.');
    const routeProvenance = row.evidence.map(evidence);
    const key = [from.id, to.id].sort().join(':');
    if (pairs.has(key)) continue;
    pairs.add(key);
    const provenance = [...new Map([from.provenance, to.provenance, from.membershipProvenance,
      to.membershipProvenance, ...routeProvenance].filter(Boolean).map(p => [p.page, p])).values()];
    result.push({ id: `rs3:open-f2p:connection:${key}`, from: from.id, to: to.id, reason: row.reason, provenance });
  }
  return result;
}
