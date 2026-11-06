import { writeSync } from 'node:fs';

// Telemetry failures never participate in admission, verdicts or retry policy.
// Do not interpolate the error: even its name/code/message may contain secrets.
let warned = false;
export function warnTelemetry() {
  if (warned) return;
  warned = true;
  try { writeSync(2, 'Test telemetry unavailable; test execution continues.\n'); } catch {}
}

export function telemetryAttempt(action) {
  try { return action(); } catch { warnTelemetry(); }
}

export const datasetIdentity = value => {
  const id = value?.datasetId ?? value?.id, digest = value?.datasetDigest ?? value?.digest;
  return { datasetId: ['duo-legacy', 'open-f2p', 'open-starter'].includes(id) ? id : null,
    datasetDigest: typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) ? digest : null };
};
