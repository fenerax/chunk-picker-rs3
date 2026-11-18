// Unchanged first guard of validate() in app/storage/registry.mjs at c745c607.
// The stage-1 reader runs this before inspecting any record or writing files.
export function stage1RegistryVersionGate(document) {
  if (document?.schemaVersion > 2) throw new Error('Unsupported newer registry version. Use a compatible release.');
}
