import { applyMetadataCorrections } from './data/metadata-corrections.mjs';
import { permanentTaskId } from './tasks/identity.mjs';
import { stripTaskMarkup } from './tasks/migration.mjs';
export { buildProgressModel } from './core/progress-timeline.mjs';

/** Pinned whole-quest points. Steps and mystery rewards never award quest
 * points; the marker and whole-completion gate mirror RuneMetrics mapping. */
export function createProgressQuestPoints(definitions) {
  const points = new Map();
  for (const [rawLabel, record] of Object.entries(applyMetadataCorrections(definitions).challenges?.Quest ?? {})) {
    if (!Object.hasOwn(record, 'QuestPoints')) continue;
    const label = stripTaskMarkup(rawLabel), whole = / Complete the (?:quest|miniquest|subquest)$/i.test(label);
    if (!whole && (record.BaseQuest || /~\||Archaeology Mystery:/i.test(rawLabel))) continue;
    const value = Number(record.QuestPoints);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    points.set(permanentTaskId('Quest', rawLabel, record), value);
  }
  return points;
}
