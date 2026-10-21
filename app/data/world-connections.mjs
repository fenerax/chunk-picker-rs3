// Keep resolvers outside the world object: rule hooks inspect every own key of
// their defensive snapshots, including nonenumerable keys.
const resolvers = new WeakMap();

export function registerWorldConnectionResolver(world, resolver) {
  resolvers.set(world, resolver);
}

export function worldPartnerConnections(world, state, memberId, pool) {
  if (pool?.partnerConnections?.byChunk) return pool.partnerConnections;
  const resolver = resolvers.get(world);
  if (!resolver) throw new TypeError('Map model needs authoritative partner connections.');
  return resolver(state, memberId);
}
