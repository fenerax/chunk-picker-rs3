// Missing flags retain the established interface for older data packs.
export function supportsDatasetFeature(dataset, feature) {
  return dataset?.capabilities?.features?.[feature] !== false;
}

export const datasetFeatureControls = Object.freeze({
  originalSync: ['original-sync-open'], runeMetrics: ['runemetrics-open'],
  training: ['helper-open', 'area-check-toggle'], bis: ['bis-open'],
  equipment: ['partner-supply-open'],
  rsCatalogues: ['profile-open', 'finish-line-open', 'activity-open', 'teleports-open', 'members-start-open', 'membership-overlay'],
  mapMetadata: ['map-pins-open'],
  gallery: ['gallery-open'], projectUpdates: ['whats-new-open', 'roadmap-open'],
});

export function applyDatasetFeatureControls(dataset, lookup) {
  for (const [feature, ids] of Object.entries(datasetFeatureControls)) {
    if (supportsDatasetFeature(dataset, feature)) continue;
    for (const id of ids) { const node = lookup(id); if (node) node.hidden = node.disabled = true; }
  }
}

export function datasetLaunchCopy(dataset) {
  if (dataset?.capabilities?.independent !== true) return null;
  const display = dataset.status?.() ?? dataset;
  return {
    title: display.title || display.displayName || display.label || 'Grid challenge',
    label: display.displayName || display.label || 'Independent dataset',
    description: display.description || 'Explore a coordinate grid, complete goals and share your progress.',
    heading: 'Start your grid challenge',
    instructions: 'Choose a starting chunk, unlock neighbours and complete their goals. Add your own tasks and notes, or restore a backup.',
  };
}

export function applyDatasetLaunchCopy(dataset, document) {
  const copy = datasetLaunchCopy(dataset); if (!copy) return;
  document.documentElement.dataset.independent = 'true';
  document.title = copy.title;
  const description = document.querySelector('meta[name="description"]'); if (description) description.content = copy.description;
  const brand = document.getElementById('dataset-brand'); if (brand) brand.textContent = copy.title;
  const tag = document.getElementById('dataset-brand-tag'); if (tag) tag.textContent = copy.label;
  const heading = document.getElementById('empty-map-title'); if (heading) heading.textContent = copy.heading;
  const instructions = document.getElementById('empty-map-instructions'); if (instructions) instructions.textContent = copy.instructions;
  const restore = document.getElementById('empty-import'); if (restore) restore.textContent = 'Restore backup';
}
