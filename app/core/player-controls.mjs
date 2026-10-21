import { datasetValue } from "../dataset-runtime.mjs";
// Personal declarations from the retained primary-method, passive-level and
// Slayer-lock controls. These describe training access, not account hiscores.
export const playerControlSkills = datasetValue("app/core/player-controls.mjs#playerControlSkills");
const skills = new Set(playerControlSkills);

export function validateControlSkill(skill) {
  if (!skills.has(skill)) throw new TypeError(`Unknown player-control skill: ${skill}`);
}
export function validateControlLevel(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 120) throw new TypeError('Declared skill level must be an integer from 1 through 120');
}
export function validateSlayerLock(lock) {
  if (lock === null) return;
  if (typeof lock !== 'object' || Array.isArray(lock)) throw new TypeError('Slayer lock must be an object or null');
  for (const key of Object.keys(lock)) if (!['level', 'monster', 'boss'].includes(key)) throw new TypeError(`Unknown Slayer lock field: ${key}`);
  validateControlLevel(lock.level);
  for (const field of ['monster', 'boss']) if (Object.hasOwn(lock, field) && (typeof lock[field] !== 'string' || !lock[field].trim())) throw new TypeError(`Slayer lock ${field} must be nonempty text`);
}

export function resolvePlayerControls(state, member) {
  const map = state.legacy?.maps?.[member.sourceMapId] ?? {}, legacy = map.chunkinfo ?? {};
  function merged(legacyValues, authored, check) {
    const values = {};
    for (const [skill, value] of Object.entries(legacyValues ?? {})) {
      if (!skills.has(skill)) continue;
      const normalized = check === 'boolean' ? value : Number(value);
      if (check === 'boolean' ? typeof normalized === 'boolean' : Number.isSafeInteger(normalized) && normalized >= 1 && normalized <= 120) values[skill] = normalized;
    }
    return { ...values, ...authored };
  }
  let legacyLock = null;
  if (legacy.slayerLocked && typeof legacy.slayerLocked === 'object') {
    const candidate = { level: Number(legacy.slayerLocked.level), ...Object.fromEntries(['monster', 'boss'].filter(field => typeof legacy.slayerLocked[field] === 'string' && legacy.slayerLocked[field].trim()).map(field => [field, decodeLegacyText(legacy.slayerLocked[field])])) };
    try { validateSlayerLock(candidate); legacyLock = candidate; } catch { /* Invalid preserved records do not become active declarations. */ }
  }
  return {
    primaryOverrides: merged({ ...map.manualPrimary, ...legacy.manualPrimary }, member.primaryOverrides, 'boolean'),
    passiveLevels: merged(legacy.passiveSkill, member.passiveLevels, 'level'),
    maxLevels: merged(legacy.maxSkill, member.maxLevels, 'level'),
    slayerLock: Object.hasOwn(member, 'slayerLock') ? member.slayerLock === null ? null : { ...member.slayerLock } : legacyLock,
  };
}
import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
