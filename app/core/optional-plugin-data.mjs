// Optional plugin evidence must never veto a gameplay load or publication.
// Keep diagnostics free of save contents and filesystem/account identities.
export function warnOptionalPluginData(operation) {
  console.warn(`Optional plugin evidence unavailable (${operation}); observations may be offered again.`);
}

export function optionalPluginData(operation, work, fallback) {
  try { return work(); }
  catch { warnOptionalPluginData(operation); return fallback; }
}
