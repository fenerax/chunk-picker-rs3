/** Catalogue queries are references, never task completion or travel grants. */
export function archaeologyCatalogueView(catalogue, { f2p = false, chunkId, siteRowId } = {}) {
  const hotspots = (catalogue.hotspots ?? []).filter(row => (!f2p || row.members === false)
    && (siteRowId === undefined || row.siteRowIds?.includes(Number(siteRowId))));
  const keys = new Set(hotspots.map(row => `archaeology:resource:${row.rowId}`));
  const placements = (catalogue.placements ?? []).filter(row => keys.has(row.classKey)
    && (chunkId === undefined || row.chunkId === String(chunkId)));
  return { schemaVersion: 1, enabledByDefault: false, f2pSkillCap: catalogue.scope?.f2pSkillCap ?? null,
    sites: (catalogue.sites ?? []).filter(row => !f2p || row.members === false), hotspots, placements,
    materials: catalogue.materials ?? [], artefacts: catalogue.artefacts ?? [], restorations: catalogue.restorations ?? [],
    collections: catalogue.collections ?? [], collectors: catalogue.collectors ?? [], mysteries: catalogue.mysteries ?? [],
    scope: 'Reference catalogue. Item/restoration membership alone does not certify location or facility access.',
    provenance: catalogue.provenance, limits: catalogue.limits ?? [] };
}
