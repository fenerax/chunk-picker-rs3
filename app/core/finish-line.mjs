import { playerControlSkills } from './player-controls.mjs';
import { helperTrialCaps } from './f2p-skill-caps.mjs';

export const MAX_FINISH_LINE_ITEMS = 1024;
export const MAX_FINISH_LINE_CUSTOM_ITEMS = 100;
export const MAX_FINISH_LINE_TEXT = 500;
export const finishLineCommandTypes = Object.freeze(['set-finish-line-item', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom']);
const skills = new Set(playerControlSkills);
const styles = new Set(['melee', 'ranged', 'magic', 'necromancy']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new TypeError(message); };
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}
function keys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown ${path} field: ${key}`);
}
export function validateFinishLineItemId(id, { custom = false } = {}) {
  if (typeof id !== 'string' || id.length > 200 || id.split(':').some(part => unsafe.has(part))) fail('Invalid finish line item ID');
  if (custom) {
    if (!/^finish:[A-Za-z0-9_-]{1,96}$/.test(id)) fail('Custom finish line item ID must be finish:<safe identifier>');
  } else {
    const valid = id.startsWith('skill:') && skills.has(id.slice(6))
      || id.startsWith('gear:') && styles.has(id.slice(5))
      || /^(?:quest|achievement):rs3:task:[A-Za-z0-9_-]{1,96}$/.test(id);
    if (!valid) fail('Unknown finish line item ID');
  }
}
export function validateFinishLineOverride(value, id) {
  validateFinishLineItemId(id, { custom: typeof id === 'string' && id.startsWith('finish:') });
  object(value, 'finish line item'); keys(value, ['enabled', 'target'], 'finish line item');
  if (!Object.keys(value).length) fail('Finish line item needs enabled or target');
  if (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean') fail('Finish line enabled must be boolean');
  if (Object.hasOwn(value, 'target')) {
    const maximum = helperTrialCaps[id.slice(6)] ?? 120;
    if (!id.startsWith('skill:') || !Number.isSafeInteger(value.target) || value.target < 1 || value.target > maximum) fail(`Finish line target must be a skill level integer from 1 through ${maximum}`);
  }
}
export function validateFinishLineText(text) {
  if (typeof text !== 'string' || !text.trim() || text !== text.trim() || text.length > MAX_FINISH_LINE_TEXT || /[\u0000-\u001f\u007f-\u009f]/.test(text)) fail(`Finish line text must be trimmed printable text of 1 through ${MAX_FINISH_LINE_TEXT} characters`);
}
export function validateFinishLine(value, memberIds) {
  object(value, 'finishLine'); keys(value, ['items', 'customItems'], 'finishLine');
  object(value.items, 'finishLine.items');
  if (Object.keys(value.items).length > MAX_FINISH_LINE_ITEMS) fail('Too many finish line item overrides');
  for (const [id, override] of Object.entries(value.items)) validateFinishLineOverride(override, id);
  if (!Array.isArray(value.customItems) || value.customItems.length > MAX_FINISH_LINE_CUSTOM_ITEMS) fail(`Finish line customItems must be an array of at most ${MAX_FINISH_LINE_CUSTOM_ITEMS} rows`);
  const ids = new Set();
  for (const item of value.customItems) {
    object(item, 'finish line custom item'); keys(item, ['id', 'text', 'completedBy'], 'finish line custom item');
    validateFinishLineItemId(item.id, { custom: true }); validateFinishLineText(item.text);
    if (ids.has(item.id)) fail('Duplicate finish line custom item ID'); ids.add(item.id);
    if (!Array.isArray(item.completedBy) || new Set(item.completedBy).size !== item.completedBy.length) fail('Finish line completedBy must contain unique member IDs');
    for (const memberId of item.completedBy) if (!memberIds.has(memberId)) fail('Finish line completion references absent member');
  }
  for (const id of Object.keys(value.items)) if (id.startsWith('finish:') && !ids.has(id)) fail('Finish line override references absent custom item');
}
// One bounded shared snapshot carries both sides. Undo guards against unrelated
// newer changes instead of restoring another player's altered checklist.
export function validateFinishLineChange(change, memberIds) {
  object(change, 'undo finish line change'); keys(change, ['before', 'after'], 'undo finish line change');
  for (const side of [change.before, change.after]) {
    object(side, 'undo finish line presence');
    if (typeof side.exists !== 'boolean') fail('Undo finish line presence needs exists');
    keys(side, side.exists ? ['exists', 'value'] : ['exists'], 'undo finish line presence');
    if (side.exists) validateFinishLine(side.value, memberIds);
  }
}
export function restoreFinishLineChange(state, change) {
  const current = Object.hasOwn(state, 'finishLine') ? { exists: true, value: state.finishLine } : { exists: false };
  if (JSON.stringify(current) !== JSON.stringify(change.after)) fail('Stale undo: finish line has changed');
  if (change.before.exists) state.finishLine = structuredClone(change.before.value);
  else delete state.finishLine;
}
