// Frozen stage-2 first reader guard. Older releases must not interpret v4 roles.
export function stage2RegistryVersionGate(document) {
  if (document?.schemaVersion > 3) throw new Error('Unsupported newer registry version. Use a compatible release.');
}
