// THROWAWAY representation prototypes. Never import from app/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha = value => createHash('sha256').update(value).digest('hex');
export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function stats(values) {
  assert(values.length && values.every(Number.isFinite));
  const ordered = [...values].sort((a, b) => a - b);
  const at = p => ordered[Math.ceil(p * ordered.length) - 1];
  return { count: values.length, p50: at(.5), p95: at(.95), max: ordered.at(-1) };
}
export function slope(values) {
  const xMean = (values.length - 1) / 2, yMean = values.reduce((a, b) => a + b) / values.length;
  let numerator = 0, denominator = 0;
  values.forEach((y, x) => { numerator += (x - xMean) * (y - yMean); denominator += (x - xMean) ** 2; });
  return numerator / denominator;
}
export function makeBase(count = 24000, aliasCount = 100000) {
  const tasks = [], entries = {}, aliases = {};
  for (let i = 0; i < count; i++) {
    const id = `rs3:task:memory-spike-${i}`;
    const task = { id, label: `Synthetic objective ${i}: gather a fictional resource in a synthetic world`, category: 'Synthetic' };
    tasks.push(task);
    entries[id] = { ...task, kind: 'task', aliases: [] };
  }
  for (let i = 0; i < aliasCount; i++) {
    const alias = `synthetic-alias-${i}`, id = tasks[i % count].id;
    aliases[alias] = id;
    entries[id].aliases.push(alias);
  }
  return freeze({ tasks, identityRegistry: { schemaVersion: 1, entries, aliases, unresolved: [] } });
}

// C only: an enumerable, layered identity dictionary. Core commands can read it,
// but structuredClone cannot. This is a CatalogueView prototype, not flat JSON.
// Own-key enumeration is deliberately complete, not a validation shortcut.
function dictionary(base, baseKeys, edits = {}) {
  return new Proxy(edits, {
    get: (target, key) => Object.hasOwn(target, key) ? target[key] : base[key],
    has: (target, key) => Object.hasOwn(target, key) || Object.hasOwn(base, key),
    ownKeys: target => baseKeys.concat(Object.keys(target).filter(key => !Object.hasOwn(base, key))),
    getOwnPropertyDescriptor(target, key) {
      return Object.getOwnPropertyDescriptor(target, key) ?? (Object.hasOwn(base, key)
        ? { value: base[key], enumerable: true, configurable: true, writable: false } : undefined);
    },
  });
}

export function representation(base, mode) {
  const rows = new Map(base.tasks.map(row => [row.id, row]));
  const rowJSON = new Map(base.tasks.map(row => [row.id, JSON.stringify(row)]));
  const entryKeys = Object.keys(base.identityRegistry.entries), aliasKeys = Object.keys(base.identityRegistry.aliases);
  const metadata = new WeakMap();
  function registry(mode, previous) {
    const edits = previous ? metadata.get(previous) : { entries: {}, aliases: {} };
    assert(edits, 'Only benchmark-owned registries can enter the prototype');
    const nextEdits = { entries: { ...edits.entries }, aliases: { ...edits.aliases } };
    let result;
    if (mode === 'B') {
      // Optimistic flat lower bound: private dictionaries allocated ONCE at open.
      // Generated registration copies entry/alias values, never 124k-key maps.
      // These owner-only containers are mutable; concurrent old snapshots are
      // outside this spike. A production immutable solution cannot cost less.
      result = previous ? { ...previous } : { schemaVersion: 1,
        entries: { ...base.identityRegistry.entries }, aliases: { ...base.identityRegistry.aliases }, unresolved: [] };
    } else {
      result = { schemaVersion: 1,
        entries: dictionary(base.identityRegistry.entries, entryKeys, nextEdits.entries),
        aliases: dictionary(base.identityRegistry.aliases, aliasKeys, nextEdits.aliases), unresolved: [] };
    }
    metadata.set(result, nextEdits);
    return result;
  }
  return {
    base,
    hydrate(state) {
      assert.equal(state.identityRegistry, base.identityRegistry);
      return { ...state, tasks: state.tasks.map(row => rowJSON.get(row.id) === JSON.stringify(row) ? rows.get(row.id) : row),
        identityRegistry: registry(mode) };
    },
    writableRegistry(previous) { return registry(mode, previous); },
    changed(registry, id, entry, aliases) {
      const edits = metadata.get(registry);
      assert(edits);
      edits.entries[id] = entry;
      Object.assign(edits.aliases, aliases);
    },
    slim(state, ledger, currency) {
      if (!state.identityRegistry) return JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state }) + '\n';
      const { tasks, identityRegistry, ...group } = state;
      const edits = metadata.get(identityRegistry);
      assert(edits);
      const deltaRows = tasks.filter(row => rows.get(row.id) !== row);
      return JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state: group,
        storage: { schemaVersion: 2, prototype: true, base: 'synthetic-only',
          delta: { tasks: deltaRows, ...edits } },
        ...(ledger ? { actionReceipts: ledger } : {}), ...(currency ? { pluginCurrency: currency } : {}) }) + '\n';
    },
    assertShared(state) {
      assert.equal(state.tasks[2], base.tasks[2]);
      assert.equal(state.identityRegistry.entries[base.tasks[2].id], base.identityRegistry.entries[base.tasks[2].id]);
      assert.equal(state.identityRegistry.aliases[aliasKeys[0]], base.identityRegistry.aliases[aliasKeys[0]]);
      assert(Object.isFrozen(state.tasks[2]));
    },
  };
}

// Exact source anchors fail closed when the implementation changes. Only child
// processes with this hook see the prototype; files under app/ stay untouched.
export function transform(source, name, mode) {
  source = source.replace(/\r\n/g, '\n');
  function once(before, after) {
    assert.equal(source.split(before).length, 2, `Stale ${name}/${mode} anchor: ${before.slice(0, 90)}`);
    source = source.replace(before, after);
  }
  if (name === 'store') {
    once('    getState: cloneCurrent,', '    _spikeState: () => current,\n    _spikeLogical: async () => (await hydrateHistory(current)).state,\n    getState: cloneCurrent,');
    // All three measure durable commit/ack, excluding response construction.
    once(': cloneCurrent();\n  }\n  const commandReceipt', ': ({ revision: current.revision });\n  }\n  const commandReceipt');
    if (mode !== 'A') {
      once('    validateStaticFieldReference(key, reference);\n    const cacheKey',
        `    validateStaticFieldReference(key, reference);
    if (key === 'identityRegistry') return { value: __spike.base.identityRegistry, bytes: 0 };
    const cacheKey`);
      once('      current = await importStoredBackup(document, true);',
        '      current = __spike.hydrate(await importStoredBackup(document, true));');
      // Archive hydration owns mutable group data/events, retaining immutable
      // catalogue trees. Keep the full validation, including sparse Undo replay.
      once(`    const complete = { ...state,
      history: importReader || validationCache ? structuredClone(history) : history };`,
        `    const { tasks, identityRegistry, ...owned } = state;
    const complete = { ...structuredClone(owned), tasks,
      ...(identityRegistry ? { identityRegistry } : {}), history: structuredClone(history) };`);
      once('    const validated = importReader || validationCache ? validateOwnedState(complete, registry, validationCache) : validateState(complete, registry);',
        '    const validated = validateOwnedState(complete, registry, validationCache);');
      once('    for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {',
        `    for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
      if (key === 'tasks' || key === 'identityRegistry') continue;`);
      once('  async function serializedDiskState(state, ledger = receipts, currency = pluginCurrency) {',
        `  async function serializedDiskState(state, ledger = receipts, currency = pluginCurrency) {
    return __spike.slim(state, ledger, currency);
    /* Unreachable production serializer follows, retained for source anchors. */`);
    }
  } else if (mode !== 'A') {
    once('      state.identityRegistry = { ...state.identityRegistry, entries: { ...state.identityRegistry.entries }, aliases: { ...state.identityRegistry.aliases } };',
      '      state.identityRegistry = __spike.writableRegistry(state.identityRegistry);');
    once('    Object.assign(state.identityRegistry.aliases, addedAliases);',
      '    Object.assign(state.identityRegistry.aliases, addedAliases);\n    __spike.changed(state.identityRegistry, id, entry, addedAliases);');
  }
  return `const __spike = globalThis[Symbol.for('format2-memory-spike')];\n${source}`;
}
