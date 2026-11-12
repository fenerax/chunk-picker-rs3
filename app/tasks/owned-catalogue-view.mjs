/** Validate active catalogue provenance without repairing historical input.
 * Format-1 storage does not opt into this metadata contract. */
export function validateOwnedCatalogueMetadata(state) {
  if (!Object.hasOwn(state?.provenance ?? {}, 'ownedCatalogue')) return;
  const metadata = state.provenance.ownedCatalogue;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const refuse = field => { throw Object.assign(new TypeError(`Invalid provenance.ownedCatalogue${field}; owned catalogue metadata must contain only retiredIds (unique nonempty strings) and names (ID-to-string labels).`), { status: 422, code: 'OWNED_CATALOGUE_INVALID' }); };
  if (!record(metadata)) refuse('');
  for (const key of Object.keys(metadata)) if (!['retiredIds', 'names'].includes(key)) refuse(`.${key}`);
  if (Object.hasOwn(metadata, 'retiredIds') && (!Array.isArray(metadata.retiredIds)
    || metadata.retiredIds.some(id => typeof id !== 'string' || !id)
    || new Set(metadata.retiredIds).size !== metadata.retiredIds.length)) refuse('.retiredIds');
  if (Object.hasOwn(metadata, 'names') && (!record(metadata.names)
    || Object.entries(metadata.names).some(([id, label]) => !id || typeof label !== 'string'))) refuse('.names');
}

/** Display/obligation consumers only. Saved rows, identity aliases, History and
 * Undo preimages remain byte-for-byte historical records. */
export function ownedCatalogueRow(row, metadata) {
  const label = metadata?.names?.[row.id];
  const retired = metadata?.retiredIds?.includes(row.id);
  return label !== undefined || retired ? { ...row, ...(typeof label === 'string' ? { label } : {}),
    ...(retired ? { obligation: false, hidden: true,
      hiddenReasons: [...new Set([...(row.hiddenReasons ?? []), 'Retired catalogue task.'])] } : {}) } : row;
}
export function applyOwnedCatalogueRows(rows, state) {
  const metadata = state.provenance?.ownedCatalogue;
  return metadata ? rows.map(row => ownedCatalogueRow(row, metadata)) : rows;
}
