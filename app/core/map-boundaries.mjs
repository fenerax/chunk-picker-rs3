/** Membership of a qualifying component, falling back to unsplit base policy. */
export function sectionIsFree(world, base, section) {
  if (world.componentMembership?.get(base)?.has(section)) return world.componentMembership.get(base).get(section);
  const membership = world.sectionMembership?.get(base);
  return membership ? membership.get(section) === true : world.f2p.has(base);
}

/** Internal components may connect; between surface bases require a real side. */
export function isWalkingSectionEdge(world, base, section, edge) {
  if (world.cacheWalking?.components.has(`${base}-${section}`)) return world.cacheWalking.topology.get(base)?.get(section)?.includes(edge) === true;
  const kind = world.sectionRoutes?.get(`${base}-${section}`)?.get(edge);
  if (kind && kind !== 'walking') return false;
  const source = edge.split('-')[0];
  if (source === base) return true;
  // Abstract test/custom worlds may omit the surface geometry entirely.
  if (!world.surface) return true;
  return (world.neighbors.get(base) ?? []).includes(source)
    || (world.neighbors.get(source) ?? []).includes(base);
}

/** Frontier remains geometric, but mixed terrain needs a boundary component. */
export function frontierDestinationSections(world, base, destination, overrides) {
  if (!world.sectionMembership?.has(destination) && !world.componentMembership?.has(destination)) return [undefined];
  const sections = [...((world.cacheWalking?.topology ?? world.sectionTopology)?.get(destination) ?? [])]
    .filter(([section, edges]) => overrides[`${destination}-${section}`] !== false
      && edges.some(edge => edge.split('-')[0] === base && isWalkingSectionEdge(world, destination, section, edge)))
    .map(([section]) => section);
  return sections.length ? sections : [undefined];
}

/** Generated mixed-chunk offers need evidence of a free landing component. */
export function freeDestinationBlocker(world, candidateId, reasons) {
  if (!world.f2p.has(candidateId)) return 'Outside the free-to-play chunk set.';
  if (!world.sectionMembership?.has(candidateId) && !world.componentMembership?.has(candidateId)) return null;
  if (reasons.some(reason => reason.destinationSection !== undefined
    && sectionIsFree(world, candidateId, reason.destinationSection))) return null;
  return 'No qualifying free-to-play destination section.';
}
