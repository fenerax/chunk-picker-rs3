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
