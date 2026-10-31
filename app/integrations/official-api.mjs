import { RUNE_METRICS_CLOSED_MESSAGE } from './progress-source-policy.mjs';

// Implement this adapter when Jagex publishes its replacement API contract.
// Return normalized skills (actual XP) and quests; never write saved progress.
export function createOfficialApiSource() {
  return { async snapshot() { return { available: false, source: 'official-api', sourceLabel: 'RuneScape API',
    message: RUNE_METRICS_CLOSED_MESSAGE }; } };
}
