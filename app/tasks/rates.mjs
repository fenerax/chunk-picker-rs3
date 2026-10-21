import { taskRuleCutoff, taskRuleCutoffDefaults } from '../data/settings.mjs';

const numeric = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** A known nonnegative rate, or null for an opaque/malformed label. */
export function parseDropRate(raw) {
  if (typeof raw !== 'string') return null;
  const rate = raw.trim().replaceAll('~', '').replaceAll(',', '').replace(/\*$/, '').trim();
  if (/^always$/i.test(rate)) return 1;
  const parts = rate.split('/').map(part => part.trim());
  if (parts.length < 2 || !numeric.test(parts[0])) return null;
  const numerator = Number(parts[0]);
  if (!Number.isFinite(numerator)) return null;
  let probability = numerator;
  for (const part of parts.slice(1)) {
    const number = Number(part), denominator = /^Infinity$/i.test(part) ? Infinity : numeric.test(part) && Number.isFinite(number) ? number : NaN;
    if (!(denominator > 0)) return null;
    probability /= denominator;
  }
  return Number.isFinite(probability) ? probability : null;
}

/** Unknown components keep an entire path unknown, including zero × unknown. */
export const composeDropRates = (parent, child) => Number.isFinite(parent) && Number.isFinite(child) ? parent * child : null;
export const rateEvidence = (rawRate, probability) => probability === null ? { unknownRate: true, rawRate: String(rawRate ?? '') } : {};

export function cutoffProbability(value, fallback = '1/1000') {
  const rate = taskRuleCutoff(value) ?? taskRuleCutoff(fallback);
  // Amounts below one intentionally produce a threshold greater than one.
  return rate === '1/0' ? 0 : parseDropRate(rate);
}

/** All threshold consumers use the same conversion, sentinel and equality rule. */
export function passesRateCutoff(probability, rules, kind = 'rare') {
  if (!Number.isFinite(probability)) return kind === 'rare';
  const primary = kind === 'primary';
  const ids = primary ? ['secondaryPrimaryNum', 'Secondary Primary Amount'] : ['rareDropNum', 'Rare Drop Amount', 'rareDropThreshold'];
  const id = ids.find(id => Object.hasOwn(rules, id)), value = id === undefined ? taskRuleCutoffDefaults[ids[0]] : rules[id];
  const rate = taskRuleCutoff(value) ?? taskRuleCutoff(primary ? taskRuleCutoffDefaults.secondaryPrimaryNum : taskRuleCutoffDefaults.rareDropNum);
  if (rate === '1/0') return true;
  const threshold = parseDropRate(rate), inclusive = rules[primary ? 'Secondary Primary Inclusive' : 'Rare Drop Inclusive'];
  // Products such as 1/10 × 1/10 can round just above 1/100. Treat only a
  // four-ULP relative neighborhood as equality, consistently in every consumer.
  const equal = Math.abs(probability - threshold) <= Number.EPSILON * Math.max(Math.abs(probability), Math.abs(threshold)) * 4;
  return (typeof inclusive === 'boolean' ? inclusive : primary) ? equal || probability > threshold : !equal && probability > threshold;
}

export const primaryEquipmentSource = (source, rules) => source.kind === 'drop' ? passesRateCutoff(source.probability, rules, 'primary')
  : Object.hasOwn(source, 'probability') ? source.primary === true && passesRateCutoff(source.probability, rules, 'primary')
    : source.primary || /shop/.test(source.kind ?? '') || source.kind === 'spawn' && ![false, 'false', 0].includes(rules['Primary Spawns']);

/** Shared source text for task details, Activity Info and equipment evidence. */
export const sourceRateText = source => source.unknownRate ? `Rate unknown (${source.rawRate || 'blank'})` : source.rate ? `Rate: ${source.rate}` : '';
