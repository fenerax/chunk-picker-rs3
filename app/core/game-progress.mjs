import { datasetValue } from "../dataset-runtime.mjs";
import { playerControlSkills } from './player-controls.mjs';

export const defaultRuneScapeNames = datasetValue("app/core/game-progress.mjs#defaultRuneScapeNames");
const skills = new Set(playerControlSkills);

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

export function validateRuneMetricsTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new TypeError('RuneMetrics fetchedAt must be an ISO UTC timestamp');
  const date = new Date(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw new TypeError('RuneMetrics fetchedAt must be a valid ISO UTC timestamp');
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

export function validateSkillProgress(skill, value) {
  validateRuneMetricsProvenance(value, ['level', 'xp', 'source', 'fetchedAt', 'runescapeName'], 'skill progress');
  validateObservedSkill(skill, value);
}

export function validateQuestProgress(taskId, value, tasks) {
  validateRuneMetricsProvenance(value, ['title', 'source', 'fetchedAt', 'runescapeName'], 'quest progress');
  if (typeof value.title !== 'string' || !value.title.trim()) throw new TypeError('Quest progress title must be nonempty text');
  if (!tasks.has(taskId)) throw new TypeError(`Quest progress references absent task: ${taskId}`);
  if (String(tasks.get(taskId).category).toLowerCase() !== 'quest') throw new TypeError(`RuneMetrics quest progress requires a quest task: ${taskId}`);
}
