import { taskRuleDefinitions } from '../data/settings.mjs';

export const MAX_RULE_REVIEW_NOTE_LENGTH = 500;
const taskRuleIds = new Set(taskRuleDefinitions.map(row => row.id));
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new TypeError(message); };
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown ${label} property: ${key}`);
}
export function validateRuleReviewId(id, registry) {
  if (typeof id !== 'string' || unsafe.has(id) || !(taskRuleIds.has(id) || registry?.get(id))) fail(`Unknown review rule: ${id}`);
}
export function normalizeRuleReviewNote(note) {
  if (typeof note !== 'string') fail('Rule review note must be a string');
  if (note.length > MAX_RULE_REVIEW_NOTE_LENGTH) fail(`Rule review note must be at most ${MAX_RULE_REVIEW_NOTE_LENGTH} characters`);
  return note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
export function validateRuleReviews(reviews, registry) {
  object(reviews, 'Rule reviews');
  for (const [id, review] of Object.entries(reviews)) {
    validateRuleReviewId(id, registry);
    object(review, 'Rule review'); keys(review, ['reviewed', 'note'], 'rule review');
    if (typeof review.reviewed !== 'boolean') fail('Rule review reviewed must be boolean');
    if (normalizeRuleReviewNote(review.note) !== review.note) fail('Rule review note must be normalized plain text');
  }
}
export function ruleReviewChange(before, after) {
  if (JSON.stringify(before.ruleReviews) === JSON.stringify(after.ruleReviews)) return undefined;
  return { before: before.ruleReviews === undefined ? { exists: false } : { exists: true, value: before.ruleReviews },
    after: after.ruleReviews === undefined ? { exists: false } : { exists: true, value: after.ruleReviews } };
}
export function validateRuleReviewChange(change, registry) {
  object(change, 'Undo rule review change'); keys(change, ['before', 'after'], 'undo rule review change');
  for (const side of [change.before, change.after]) {
    object(side, 'Undo rule review presence');
    if (typeof side.exists !== 'boolean') fail('Undo rule review presence needs exists');
    keys(side, side.exists ? ['exists', 'value'] : ['exists'], 'undo rule review presence');
    if (side.exists) validateRuleReviews(side.value, registry);
  }
}
export function restoreRuleReviewChange(state, change) {
  const current = state.ruleReviews === undefined ? { exists: false } : { exists: true, value: state.ruleReviews };
  if (JSON.stringify(current) !== JSON.stringify(change.after)) fail('Stale undo: rule reviews have changed');
  if (change.before.exists) state.ruleReviews = structuredClone(change.before.value);
  else delete state.ruleReviews;
}
