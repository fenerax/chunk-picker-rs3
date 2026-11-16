// Private, disposable evaluation scratch. No functions or live result graphs
// cross an evaluation boundary; retained entries are charged serialized bytes.
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';

export function createDependencyMemo(seed = []) {
  const entries = new Map(seed), roots = new Map(), descriptors = new Map();
  let signatures = new WeakMap();
  const signature = value => {
    if (value === null || typeof value !== 'object') return value;
    let result = signatures.get(value);
    if (result === undefined) {
      result = createHash('sha256').update(serialize(value)).digest('hex');
      signatures.set(value, result);
    }
    return result;
  };
  let reads, hits = 0, misses = 0;
  const valueAt = ([root, field, operation, key]) => {
    if (operation === 'predicate') return roots.get(root)(...key);
    let value = roots.get(root)();
    if (field !== null) value = value?.[field];
    if (operation === 'has') return value?.has(key) ?? false;
    if (operation === 'get') return signature(value?.get(key));
    if (operation === 'size') return value?.size;
    if (operation === 'keys') return signature(Object.keys(value ?? {}));
    return signature(value);
  };
  const observe = (descriptor, value) => {
    if (reads) {
      const key = JSON.stringify(descriptor);
      if (!descriptors.has(key)) descriptors.set(key, descriptor);
      reads.set(key, [descriptors.get(key), value]);
    }
    return value;
  };
  function collection(root, field, value) {
    return new Proxy(value, { get(target, property) {
      if (property === 'has') return key => reads ? observe([root, field, 'has', key], target.has(key)) : target.has(key);
      if (property === 'get') return key => {
        const result = target.get(key);
        if (reads) observe([root, field, 'get', key], signature(result));
        return result;
      };
      if (property === 'size') return reads ? observe([root, field, 'size'], target.size) : target.size;
      if (['add', 'set', 'delete', 'clear'].includes(property)) return (...args) => {
        signatures.delete(target); return target[property](...args);
      };
      // Iteration reads the complete ordered collection, including absence.
      if (reads) observe([root, field, 'value'], signature(target));
      const result = Reflect.get(target, property, target);
      return typeof result === 'function' ? result.bind(target) : result;
    } });
  }
  return {
    root(name, getter) { roots.set(name, getter); },
    predicate(name, key, operation) {
      const previous = reads;
      reads = undefined;
      let value;
      try { value = operation(); } finally { reads = previous; }
      return observe([name, null, 'predicate', key], value);
    },
    invalidate(value) { signatures.delete(value); },
    nextPass() { signatures = new WeakMap(); },
    depend(name) { observe([name, null, 'value'], signature(roots.get(name)())); },
    wrap(name, value) {
      if (value instanceof Set || value instanceof Map) return collection(name, null, value);
      return new Proxy(value, {
        ownKeys(target) { if (reads) observe([name, null, 'keys'], signature(Object.keys(target))); return Reflect.ownKeys(target); },
        get(target, property) {
          const result = Reflect.get(target, property);
          if (!reads || typeof property === 'symbol') return result;
          if (result instanceof Set || result instanceof Map) return collection(name, property, result);
          observe([name, property, 'value'], signature(result));
          return result;
        },
      });
    },
    check(key, operation, counters) {
      const candidates = entries.get(key) ?? [];
      for (const entry of candidates) if (entry.reads.every(([descriptor, value]) => Object.is(valueAt(descriptor), value))) {
        hits++; counters.dependencyChecks += entry.dependencies;
        return key.endsWith(':true') ? structuredClone(entry.value) : entry.value;
      }
      misses++;
      const previous = reads, captured = new Map(), before = counters.dependencyChecks;
      reads = captured;
      try {
        const value = operation();
        candidates.unshift({ reads: [...captured.values()], dependencies: counters.dependencyChecks - before,
          value: key.endsWith(':true') ? structuredClone(value) : value });
        // Different fixed-point stages can have different predicate values.
        // Bound their count as well as the retained byte admission below.
        candidates.length = Math.min(candidates.length, 4);
        entries.set(key, candidates);
        return value;
      } finally { reads = previous; }
    },
    get active() { return !!reads; },
    export() { return [...entries]; },
    get hits() { return hits; },
    get misses() { return misses; },
  };
}
