const fallbackInstant = '2026-10-13T12:00:00.000Z';

/** Reuse the latest saved observation without changing the compared save. */
export function parityInstant(document) {
  const state = document?.state ?? document;
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Parity clock requires a save document');
  const snapshots = state.progressSnapshots;
  if (snapshots == null) return fallbackInstant;
  if (!Array.isArray(snapshots.days)) throw new TypeError('Parity clock requires progress snapshot days');
  if (!snapshots.days.length) return fallbackInstant;
  let latest = 0;
  for (const row of snapshots.days) {
    const at = Array.isArray(row) ? row[1] : undefined;
    if (!Number.isSafeInteger(at) || at <= 0 || !Number.isFinite(new Date(at).getTime())) {
      throw new TypeError('Parity clock encountered an invalid progress snapshot timestamp');
    }
    latest = Math.max(latest, at);
  }
  return new Date(latest).toISOString();
}
