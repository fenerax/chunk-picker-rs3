/** Exact reviewed physical variants do not enlarge any chunk-wide allowlist. */
export function reviewedServiceVariant(placement, rows = []) {
  for (const row of rows) {
    if (!row || !row.match || !row.service || Object.keys(row.match).length < 4
      || !['id', 'chunkId', 'objectId', 'classKey'].every(key => Object.hasOwn(row.match, key))) {
      throw new TypeError('Invalid reviewed service variant');
    }
    if (placement.id !== row.match.id) continue;
    if (!Object.entries(row.match).every(([key, value]) => JSON.stringify(placement[key]) === JSON.stringify(value))) {
      throw new TypeError('Reviewed service variant drift');
    }
    if (row.service.kind !== 'deposit' || !['all-items', 'fish-only'].includes(row.service.depositCapability)) {
      throw new TypeError('Invalid reviewed deposit capability');
    }
    return structuredClone(row.service);
  }
  return null;
}
