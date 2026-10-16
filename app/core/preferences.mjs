import { settingDefinitions, authoredSettingDefinitions } from '../data/settings.mjs';
import { deathSettingDefinitions, validateDeathSetting } from './death-settings.mjs';
import { miningSettingDefinitions } from './mining-settings.mjs';
import { woodcuttingSettingDefinitions } from './woodcutting-settings.mjs';
import { gatheringSettingDefinitions, calculatorBankingSettingDefinitions as bankingSettingDefinitions } from './gathering-settings.mjs';

// Neighbor selection changes the shared roll pool and is owned by group rules.
// Defaults belong to presentation fallback, never to a member's saved overrides.
export const preferenceDefinitions = Object.freeze([...settingDefinitions.filter(definition => definition.type !== 'object'), ...deathSettingDefinitions, ...miningSettingDefinitions, ...woodcuttingSettingDefinitions, ...bankingSettingDefinitions, ...gatheringSettingDefinitions, ...authoredSettingDefinitions]);
const definitions = new Map(preferenceDefinitions.map(definition => [definition.id, definition]));
const deathIds = new Set(deathSettingDefinitions.map(definition => definition.id));
const unsafeIds = new Set(['__proto__', 'prototype', 'constructor']);

export function validatePreference(id, value) {
  if (typeof id !== 'string' || unsafeIds.has(id) || !definitions.has(id)) throw new TypeError(`Unknown setting: ${id}`);
  if (deathIds.has(id)) return validateDeathSetting(id, value);
  const definition = definitions.get(id);
  const valid = definition.type === 'boolean' ? typeof value === 'boolean'
    : definition.type === 'enum' ? definition.options.includes(value)
    : definition.type === 'color' ? typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    : definition.type === 'string' && typeof value === 'string' && (id !== 'startingChunk' || value === '' || /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)));
  if (!valid) {
    const expected = definition.type === 'boolean' ? 'must be on or off'
      : definition.type === 'enum' ? `must be one of: ${definition.options.join(', ')}`
      : definition.type === 'color' ? 'needs a six-digit colour such as #FF0000'
      : id === 'startingChunk' ? 'needs a valid chunk number or an empty value' : 'must be text';
    throw new TypeError(`${definition.label} ${expected}.`);
  }
  return value;
}
