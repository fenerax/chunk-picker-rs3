import { taskId, plainLabel } from '../tasks/engine.mjs';
import { applyMetadataCorrections } from '../data/metadata-corrections.mjs';

// Only spelling/title changes, never replacement quests or quest steps. The game
// and RuneMetrics drop the Wiki's "(miniquest)" and series prefixes.
export const QUEST_TITLE_ALIASES = Object.freeze({ 'vampire slayer': 'vampyre slayer',
  'garden of tranquillity': 'garden of tranquility',
  'curse of the empty lord miniquest': 'the curse of the empty lord miniquest',
  'father and son': 'father and son miniquest', 'helping laniakea': 'helping laniakea miniquest',
  ...Object.fromEntries(['foreshadowing', 'flashback', 'fortunes', 'finale'].map(part => [part, `once upon a time in gielinor ${part}`])),
  ...Object.fromEntries(['my one and only lute', 'skelly by everlight', 'flesh and bone', 'hermy and bass'].map(part => [part, `that old black magic ${part}`])) });
// Quests left out of the picker on purpose, keyed by canonical title. The review
// list shows why instead of calling them unknown.
const TUTORIAL = 'Tutorial quest. It runs off the chunk map and every account finishes it, so the picker has no task for it.';
export const UNMAPPED_QUEST_REASONS = Object.freeze({ 'learning the ropes': TUTORIAL, 'unstable foundations': TUTORIAL });
export function normalizeQuestTitle(title) {
  return title.normalize('NFKC').toLowerCase().replace(/&amp;/g, '&')
    .replace(/[‘’`´]/g, "'").replace(/[‐‑‒–—−]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export const canonicalTitle = title => {
  const normalized = normalizeQuestTitle(title);
  return QUEST_TITLE_ALIASES[normalized] ?? normalized;
};

export function createQuestMapping(definitions) {
  definitions = applyMetadataCorrections(definitions);
  const titles = new Map();
  for (const [rawLabel, record] of Object.entries(definitions.challenges?.Quest ?? {})) {
    if (!Object.hasOwn(record, 'QuestPoints')) continue;
    const label = plainLabel(rawLabel);
    const whole = / Complete the (?:quest|miniquest|subquest)$/i.test(label)
      || typeof record.PickerId === 'string' && typeof record.BaseQuest === 'string' && label === `Finish ${record.BaseQuest}`;
    // Bare title records are used by small/custom catalogues. Mystery, step and
    // reward rows in the retained catalogue must not become quest evidence.
    if (!whole && (record.BaseQuest || /~\||Archaeology Mystery:/i.test(rawLabel))) continue;
    const title = record.BaseQuest ?? (whole ? label.replace(/ Complete the (?:quest|miniquest|subquest)$/i, '') : label);
    const key = canonicalTitle(title), candidates = titles.get(key) ?? [];
    candidates.push({ taskId: taskId('Quest', rawLabel, record), title, label });
    titles.set(key, candidates);
  }
  return titles;
}
