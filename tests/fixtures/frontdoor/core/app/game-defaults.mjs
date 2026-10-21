// Public launchers select a bundled provider before loading application code.
// The private profile's defaults remain optional and are never a public fallback.
export async function loadGameDefaults(datasetId = process.env.RS3_DATASET) {
  if (datasetId === 'open-f2p') return (await import('./open-f2p.mjs')).resolveOpenF2P().gameDefaults;
  if (datasetId === 'open-starter') return (await import('./open-starter.mjs')).resolveOpenStarter().gameDefaults;
  if (datasetId !== undefined && datasetId !== '' && datasetId !== 'duo-legacy') throw new TypeError('Unknown dataset selection.');
  const installed = await (await import('./dataset-profile.mjs')).loadDatasetProfile();
  if (installed) return installed.profile.gameDefaults;
  return (await import('./legacy-game-defaults.mjs')).legacyGameDefaults;
}
