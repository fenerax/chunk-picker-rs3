import { datasetValue } from "../dataset-runtime.mjs";

export const defaultRuneScapeNames = datasetValue("app/core/game-progress.mjs#defaultRuneScapeNames");
export const observedSkills = Object.freeze([
  'Attack', 'Defence', 'Strength', 'Constitution', 'Ranged', 'Prayer', 'Magic',
  'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting',
  'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming',
  'Runecrafting', 'Hunter', 'Construction', 'Summoning', 'Dungeoneering',
  'Divination', 'Invention', 'Archaeology', 'Necromancy',
]);
const skills = new Set(observedSkills);

export function validateRuneScapeName(name) {
  if (typeof name !== 'string') throw new TypeError('RuneScape name must be a string');
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9 _-]{1,12}$/.test(trimmed)) throw new TypeError('RuneScape name must contain 1 through 12 ASCII letters, numbers, spaces, hyphens or underscores');
  return trimmed;
}

export function sameRuneScapeName(first, second) {
  const canonical = name => name.trim().replace(/_/g, ' ').toLowerCase();
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const name = canonical(first);
  return !!first.trim() && !!second.trim() && name === canonical(second);
}

export function validateRuneMetricsTimestamp(value, source = 'RuneMetrics') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new TypeError(`${source} fetchedAt must be an ISO UTC timestamp`);
  const date = new Date(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw new TypeError(`${source} fetchedAt must be a valid ISO UTC timestamp`);
  return value;
}

function fields(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown ${path} field: ${key}`);
}

export function validateObservedSkill(skill, value) {
  if (!skills.has(skill)) throw new TypeError(`Unknown observed skill: ${skill}`);
  if (!Number.isSafeInteger(value.level) || value.level < 1 || value.level > 120) throw new TypeError('Observed skill level must be an integer from 1 through 120');
  if (typeof value.xp !== 'number' || !Number.isFinite(value.xp) || value.xp < 0) throw new TypeError('Observed skill XP must be finite and nonnegative');
}

export function validateRuneMetricsProvenance(value, keys = ['source', 'fetchedAt', 'runescapeName'], path = 'RuneMetrics provenance') {
  fields(value, keys, path);
  if (value.source !== 'runemetrics') throw new TypeError(`${path} source must be runemetrics`);
  validateRuneMetricsTimestamp(value.fetchedAt);
  if (validateRuneScapeName(value.runescapeName) !== value.runescapeName) throw new TypeError(`${path} RuneScape name must be trimmed`);
}

export function validateGamePluginProvenance(value, memberId, keys = ['source', 'fetchedAt', 'memberId'], path = 'Game plugin provenance') {
  fields(value, keys, path);
  if (value.source !== 'game-plugin') throw new TypeError(`${path} source must be game-plugin`);
  validateRuneMetricsTimestamp(value.fetchedAt, 'Game plugin');
  if (typeof value.memberId !== 'string' || !value.memberId.trim() || value.memberId !== memberId) throw new TypeError(`${path} memberId must match the owning member`);
}

function validateProgressProvenance(value, memberId, keys, path) {
  if (value?.source === 'game-plugin') validateGamePluginProvenance(value, memberId, [...keys, 'source', 'fetchedAt', 'memberId'], path);
  else validateRuneMetricsProvenance(value, [...keys, 'source', 'fetchedAt', 'runescapeName'], path);
}

export function validateSkillProgress(skill, value, memberId) {
  validateProgressProvenance(value, memberId, ['level', 'xp'], 'skill progress');
  validateObservedSkill(skill, value);
}

export function validateQuestProgress(taskId, value, tasks, memberId) {
  validateProgressProvenance(value, memberId, ['title'], 'quest progress');
  if (typeof value.title !== 'string' || !value.title.trim()) throw new TypeError('Quest progress title must be nonempty text');
  if (!tasks.has(taskId)) throw new TypeError(`Quest progress references absent task: ${taskId}`);
  if (String(tasks.get(taskId).category).toLowerCase() !== 'quest') throw new TypeError(`${value.source === 'game-plugin' ? 'Game plugin' : 'RuneMetrics'} quest progress requires a quest task: ${taskId}`);
}

export function validateAchievementProgress(taskId, value, tasks, memberId) {
  validateGamePluginProvenance(value, memberId, ['title', 'achievementId', 'source', 'fetchedAt', 'memberId'], 'achievement progress');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(value.title)) throw new TypeError('Achievement progress title must contain 1 through 120 characters without controls');
  if (!Number.isSafeInteger(value.achievementId) || value.achievementId < 0) throw new TypeError('Achievement progress achievementId must be a nonnegative safe integer');
  if (!tasks.has(taskId)) throw new TypeError(`Achievement progress references absent task: ${taskId}`);
  if (String(tasks.get(taskId).category).toLowerCase() !== 'diary') throw new TypeError(`Game plugin achievement progress requires a Diary task: ${taskId}`);
}

// Item evidence never names where an item came from: only that the game plugin saw it owned or worn.
export function validateItemProgress(taskId, value, tasks, memberId) {
  validateGamePluginProvenance(value, memberId, ['title', 'gameItemId', 'evidence', 'source', 'fetchedAt', 'memberId'], 'item progress');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(value.title)) throw new TypeError('Item progress title must contain 1 through 80 characters without controls');
  if (!Number.isSafeInteger(value.gameItemId) || value.gameItemId < 0) throw new TypeError('Item progress gameItemId must be a nonnegative safe integer');
  if (value.evidence !== 'owned' && value.evidence !== 'worn') throw new TypeError('Item progress evidence must be owned or worn');
  if (!tasks.has(taskId)) throw new TypeError(`Item progress references absent task: ${taskId}`);
}
