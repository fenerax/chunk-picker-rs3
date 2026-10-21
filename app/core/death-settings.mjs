import { datasetValue, datasetRuleDefinitions } from "../dataset-runtime.mjs";
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const emptyOverrides = Object.freeze({});

export const deathSettingDefinitions = datasetRuleDefinitions("app/core/death-settings.mjs#deathSettingDefinitions");
const definitions = new Map(deathSettingDefinitions.map(definition => [definition.id, definition]));

function positiveNumber(value, definition) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= definition.min || value > definition.max) {
    throw new TypeError(`${definition.label} must be a finite number greater than ${definition.min} and at most ${definition.max}.`);
  }
}

/** Validate a saved override without coercion, rounding, clamping or mutation. */
export function validateDeathSetting(id, value) {
  const definition = definitions.get(id);
  if (!definition) throw new TypeError(`Unknown death-chunk setting: ${id}`);
  if (definition.type === 'number') positiveNumber(value, definition);
  else if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`${definition.label} must be boolean.`);
  } else {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) {
      throw new TypeError('Per-monster kill times must be a plain object.');
    }
    const properties = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(properties).length > 5000) throw new TypeError('At most 5000 per-monster kill times may be saved.');
    for (const [name, property] of Object.entries(properties)) {
      if (unsafeKeys.has(name) || !name.trim() || name !== name.trim() || name.length > 200 || !property.enumerable || !Object.hasOwn(property, 'value')) {
        throw new TypeError('Per-monster kill times need exact, nonempty, safe monster names.');
      }
      positiveNumber(property.value, definitions.get('defaultSecondsPerKill'));
    }
  }
  return value;
}

/** Defaults are effective fallbacks; resolving does not write them into a member. */
export function resolveDeathSettings(member) {
  const preferences = member?.preferences ?? {};
  const result = {};
  for (const definition of deathSettingDefinitions) {
    const value = Object.hasOwn(preferences, definition.id) ? validateDeathSetting(definition.id, preferences[definition.id]) : definition.default;
    result[definition.id] = definition.type === 'object' ? { ...value } : value;
  }
  return result;
}
