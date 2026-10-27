const projections = new WeakMap();

/** Migration evidence belongs to durable saves and import details, not display state. */
function browserProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') return provenance;
  if (projections.has(provenance)) return projections.get(provenance);
  const incoming = provenance.restore?.incomingProvenance;
  const projectedIncoming = browserProvenance(incoming);
  const changed = Object.hasOwn(provenance, 'taskIdentityMigration') || incoming !== projectedIncoming;
  let display = provenance;
  if (changed) {
    const { taskIdentityMigration, ...retained } = provenance;
    display = retained;
    if (incoming !== projectedIncoming) display.restore = { ...provenance.restore, incomingProvenance: projectedIncoming };
  }
  projections.set(provenance, display);
  return display;
}

export function projectBrowserState(state) {
  const provenance = browserProvenance(state?.provenance);
  return provenance === state?.provenance ? state : { ...state, provenance };
}
