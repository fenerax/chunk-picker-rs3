import { sustainedPhase } from './sustained.mjs';

const workloadPhases = new Set(['cold-open', 'before-restart', 'restart-recovery', 'after-recovery']);

export function contextOpenPhase(row) {
  // Older artifacts had one receipt per factory, with no phase or a workload
  // phase. Keep those readable without treating future context phases as opens.
  return row.phase == null || workloadPhases.has(row.phase) ? 'factory' : row.phase;
}

export const factoryReceipts = rows => (rows ?? []).filter(row => contextOpenPhase(row) === 'factory');

export function contextOpenReceipt(row, { profile, generation, receivedAt, elapsedMs }) {
  return { ...row, phase: contextOpenPhase(row), workloadPhase: sustainedPhase(profile, elapsedMs),
    memoryProfile: profile.memoryProfile, residency: profile.residency, generation, receivedAt, elapsedMs };
}
