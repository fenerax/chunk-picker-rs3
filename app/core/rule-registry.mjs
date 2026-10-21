// Metadata-only registry: browser settings do not need the gameplay rule graph.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function validateValue(definition, value) {
  const { id, type, options } = definition;
  if (type === 'enum') {
    if (!options.includes(value)) throw new TypeError(`Rule ${id} must be one of: ${options.join(', ')}.`);
  } else if (typeof value !== type || (type === 'number' && !Number.isFinite(value))) {
    throw new TypeError(`Rule ${id} must be a ${type}.`);
  }
  return value;
}

/** Return an immutable registry with definitions, defaults, get(id), resolve(settings). */
export function createRuleRegistryFromDefinitions(allDefinitions = [], { onNormalize } = {}) {
  if (!Array.isArray(allDefinitions)) throw new TypeError('Rule definitions must be an array.');
  const seen = new Set();
  const definitions = allDefinitions.map(definition => {
    if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) throw new TypeError('A rule needs a nonempty ID.');
    if (seen.has(definition.id)) throw new TypeError(`Duplicate rule ID: ${definition.id}.`);
    seen.add(definition.id);
    if (!['boolean', 'enum', 'string', 'number'].includes(definition.type)) throw new TypeError(`Unsupported rule type: ${definition.id}.`);
    if (definition.type === 'enum' && (!Array.isArray(definition.options) || !definition.options.length || definition.options.some(value => typeof value !== 'string') || new Set(definition.options).size !== definition.options.length)) {
      throw new TypeError(`Rule ${definition.id} needs unique string enum options.`);
    }
    for (const hook of ['candidates', 'exclude']) {
      if (definition[hook] !== undefined && typeof definition[hook] !== 'function') throw new TypeError(`Rule ${definition.id} ${hook} must be a function.`);
    }
    const priority = definition.priority ?? 100;
    if (!Number.isFinite(priority)) throw new TypeError(`Rule ${definition.id} priority must be finite.`);
    const normalized = Object.freeze({ ...definition, priority, ...(definition.options ? { options: Object.freeze([...definition.options]) } : {}) });
    onNormalize?.(definition, normalized);
    validateValue(normalized, normalized.default);
    return normalized;
  }).sort((a, b) => a.priority - b.priority || compare(a.id, b.id));
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const defaults = Object.freeze(Object.fromEntries(definitions.map(definition => [definition.id, definition.default])));
  return Object.freeze({
    definitions: Object.freeze(definitions),
    defaults,
    get: id => byId.get(id),
    resolve(settings = {}) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Rule settings must be an object.');
      const resolved = { ...defaults };
      for (const id of Object.keys(settings)) {
        if (!byId.has(id)) throw new TypeError(`Unknown rule setting: ${id}.`);
        resolved[id] = validateValue(byId.get(id), settings[id]);
      }
      return Object.freeze(resolved);
    },
  });
}

