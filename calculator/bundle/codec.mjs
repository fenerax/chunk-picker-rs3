// Language-neutral dataset codec. Tags match app/datasets.mjs; no executable
// provider or V8 serialization is needed to consume a bundle.
export function encode(value) {
  if (value === undefined) return { $datasetType: 'Undefined' };
  if (value instanceof Set) return { $datasetType: 'Set', entries: [...value].map(encode) };
  if (value instanceof Map) return { $datasetType: 'Map', entries: [...value].map(([key, row]) => [encode(key), encode(row)]) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.hasOwn(value, '$datasetType')) throw new TypeError('Unsupported bundle value.');
    return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, encode(row)]));
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
    || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Unsupported bundle value.');
  return value;
}
export function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$datasetType')) {
      if (value.$datasetType === 'Undefined' && Object.keys(value).length === 1) return undefined;
      if (Object.keys(value).length === 2 && Array.isArray(value.entries)) {
        if (value.$datasetType === 'Set') return new Set(value.entries.map(decode));
        if (value.$datasetType === 'Map' && value.entries.every(row => Array.isArray(row) && row.length === 2)) return new Map(value.entries.map(row => row.map(decode)));
      }
      throw new TypeError('Invalid bundle value tag.');
    }
    return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, decode(row)]));
  }
  return value;
}
