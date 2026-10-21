// Import only when the selected provider declares this integration. A public
// installation does not contain the private integration module.
const originalSyncModule = './original-sync.mjs';
export async function loadOriginalSyncPanel(dataset,
  load = () => import(originalSyncModule)) {
  if (dataset.capabilities?.features?.originalSync === false) return null;
  return (await load()).createOriginalSync;
}

export function mountOriginalSyncControl(c) {
  if (c.$('original-sync-open')) return;
  const button = c.el('button', 'Sync from original picker');
  button.id = 'original-sync-open';
  c.$('about-heading')?.before(button);
}
