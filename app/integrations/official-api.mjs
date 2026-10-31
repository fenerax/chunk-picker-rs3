export const RUNE_METRICS_CLOSED_MESSAGE = 'RuneMetrics has closed; levels and quests come from the game plugin until the new Jagex API is connected';

export function createOfficialApiSource() {
  return { async snapshot() { return { available: false, source: 'official-api', sourceLabel: 'RuneScape API',
    message: RUNE_METRICS_CLOSED_MESSAGE }; } };
}
