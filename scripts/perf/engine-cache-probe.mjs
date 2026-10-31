// Diagnostic-only loader: observes cache operations without editing application
// files or changing the production calculator protocol. Fail closed on drift.
import { registerHooks } from 'node:module';
import { parentPort, isMainThread } from 'node:worker_threads';
import { serialize } from 'node:v8';

if (!isMainThread) {
  const stats = new Map();
  const factory = Symbol.for('rs3.engineCacheProbe');
  const sizes = process.env.RS3_CACHE_PROFILE_SIZES === '1';
  const bytes = value => {
    if (typeof value === 'function') return null;
    try {
      if (value?.baseline) value = [value.baseline, value.state, value.estimates, value.planningIndex, value.playResult, value.sandboxDelta];
      return serialize(value).byteLength;
    } catch {
      // A size-only diagnostic omits executable slots and preserves aliasing.
      // This is a serialized payload size, never a claimed V8 heap size.
      const seen = new WeakMap();
      const clean = x => {
        if (typeof x === 'function' || typeof x === 'symbol') return undefined;
        if (!x || typeof x !== 'object') return x;
        if (seen.has(x)) return seen.get(x);
        const out = x instanceof Map ? new Map() : x instanceof Set ? new Set() : Array.isArray(x) ? [] : {};
        seen.set(x, out);
        if (x instanceof Map) for (const [k,v] of x) out.set(clean(k), clean(v));
        else if (x instanceof Set) for (const v of x) out.add(clean(v));
        else for (const [k,v] of Object.entries(x)) out[k] = clean(v);
        return out;
      };
      try { return serialize(clean(value)).byteLength; } catch { return null; }
    }
  };
  globalThis[factory] = (name, map) => {
    if (!stats.has(name)) stats.set(name, { hits: 0, misses: 0, sets: 0, maxEntries: 0, entryBytes: [] });
    const row = stats.get(name);
    if (sizes && !row.samples) Object.defineProperty(row, 'samples', { value: { entries: [], slots: new WeakMap(), next: 0 } });
    for (const method of ['get', 'has']) {
      const original = map[method].bind(map), has = map.has.bind(map);
      Object.defineProperty(map, method, { value(key) {
        row[has(key) ? 'hits' : 'misses']++;
        return original(key);
      } });
    }
    const set = map.set.bind(map);
    Object.defineProperty(map, 'set', { value(key, value) {
      row.sets++;
      if (sizes && row.entryBytes.length < 32) {
        const payload = value?.baseline ? [value.baseline, value.state, value.estimates, value.planningIndex, value.playResult, value.sandboxDelta]
          : value instanceof Map && Object.keys(value).length ? [value, Object.fromEntries(Object.entries(value))] : value;
        // Include primitive keys; object keys are already-owned identity roots.
        const n = typeof value === 'function' ? null : bytes([key && typeof key === 'object' ? undefined : key, payload]);
        if (n !== null) row.entryBytes.push(n);
        if (Buffer.isBuffer(value)) (row.backingEntryBytes ??= []).push(value.buffer.byteLength);
      }
      if (sizes && value && typeof value === 'object') {
        const samples = row.samples;
        let slot = samples.slots.get(value);
        if (slot === undefined || samples.entries[slot]?.ref.deref() !== value) {
          slot = samples.next++ % 32;
          samples.slots.set(value, slot);
        }
        samples.entries[slot] = { key: key && typeof key === 'object' ? undefined : key, ref: new WeakRef(value) };
      }
      const result = set(key, value);
      row.maxEntries = Math.max(row.maxEntries, map.size ?? 0);
      return result;
    } });
    return map;
  };
  const rules = {
    '/tasks/worker.mjs': ['snapshots', 'sandboxSnapshots', 'stateSnapshots', 'mapLocationResults', 'sandboxTaskIndexes', 'viewContexts', 'serializedStateSizes'],
    '/tasks/engine.mjs': ['variants'],
    '/tasks/eligibility-cache.mjs': ['entries'],
    '/tasks/obligation-cache.mjs': ['entries', 'masks'],
    '/tasks/access.mjs': ['itemCache', 'accessDetails', 'diagnosticKeys'],
    '/tasks/presentation.mjs': ['equipmentCatalogues'],
    '/tasks/boss-gates.mjs': ['gearCatalogues'],
    '/tasks/chunk-planning-index.mjs': ['definitionIndexes'],
    '/tasks/fact-projection.mjs': ['catalogueAliasIndexes'],
    '/tasks/unlock-reuse.mjs': ['staticDigests'],
    '/core/automatic-transport.mjs': ['configurations', 'engines', 'baselines', 'derived'],
    '/core/teleport-return-cache.mjs': ['worlds'],
    '/core/rules.mjs': ['preparedRollPools', 'entries'],
  };
  if (sizes) {
    rules['/tasks/fact-projection.mjs'].push('index', 'resolutions');
    rules['/tasks/engine.mjs'].push('memberItems', 'memberSources', 'accessSources', 'itemMembership', 'membershipOutputRoots');
    rules['/tasks/presentation.mjs'].push('names', 'tokens', 'legacyFields', 'legacyCategories');
    rules['/tasks/access.mjs'].push('parsedRates', 'cutoffCache');
    rules['/tasks/time-estimates.mjs'] = ['skillCache'];
    rules['/tasks/collection.mjs'] = ['satisfaction'];
    rules['/tasks/identity.mjs'] = ['materialized', 'mappedLabels'];
    rules['/core/transport-access.mjs'] = [];
    rules['/tasks/migration.mjs'] = ['projections'];
    rules['/data/item-membership.mjs'] = ['lookups', 'entityIndexes'];
    rules['/data/item-membership-aliases.mjs'] = ['indexes'];
    rules['/data/item-membership-review.mjs'] = ['indexes'];
    rules['/dataset-runtime.mjs'] = ['recorded'];
    rules['/datasets.mjs'] = ['parsed'];
  }
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    const match = Object.keys(rules).find(suffix => url.endsWith(suffix));
    if (!match) return result;
    let source = String(result.source);
    for (const name of rules[match]) {
      const anchor = `${name} = new `;
      const expression = new RegExp(`\\b${name} = new (WeakMap|Map)\\(\\)`, 'g');
      let found = 0;
      source = source.replace(expression, (_, type) => {
        found++; return `${name} = globalThis[Symbol.for('rs3.engineCacheProbe')](${JSON.stringify(match + ':' + name)}, new ${type}())`;
      });
      if (!found) throw new Error('Cache probe anchor changed: ' + match + ':' + anchor);
    }
    if (match === '/tasks/worker.mjs') source = source.replace(/(const snapshotBudget = [^\n]+\n)/, '$1globalThis[Symbol.for("rs3.cacheBudgetProbe")] = snapshotBudget;\n');
    const nested = match === '/core/automatic-transport.mjs' ? [['entries = new Map()', 'baseline-signatures'], ['byMember: new Map()', 'baseline-members']]
      : match === '/core/teleport-return-cache.mjs' ? [['entries = new Map()', 'return-decisions']]
      : match === '/tasks/worker.mjs' ? [['estimates: new Map()', 'death-estimates']] : [];
    for (const [anchor, name] of nested) {
      if (!source.includes(anchor)) throw new Error('Nested cache probe anchor changed.');
      source = source.replaceAll(anchor, anchor.replace('new Map()', `globalThis[Symbol.for('rs3.engineCacheProbe')](${JSON.stringify(match + ':' + name)}, new Map())`));
    }
    if (sizes && match === '/core/transport-access.mjs') source = source.replace('entries = new Map()', `entries = globalThis[Symbol.for('rs3.engineCacheProbe')]('/core/transport-access.mjs:routes-and-graphs', new Map())`);
    if (sizes && match === '/tasks/engine.mjs') {
      for (const name of ['rawAccess','surfaceEligibility','spatialFailures','base','baseOwnership','expansions']) {
        const regex = new RegExp(`\\b${name}: new (WeakMap|Map)\\(\\)`, 'g');
        source = source.replace(regex, (_, type) => `${name}: globalThis[Symbol.for('rs3.engineCacheProbe')](${JSON.stringify(match + ':replay.' + name)}, new ${type}())`);
      }
      source = source.replace('replay.outputCache ??= new Map()', `replay.outputCache ??= globalThis[Symbol.for('rs3.engineCacheProbe')]('/tasks/engine.mjs:replay.outputCache', new Map())`);
      source = source.replace('rare: new Map(), primary: new Map()', `rare: globalThis[Symbol.for('rs3.engineCacheProbe')]('/tasks/engine.mjs:rare-cutoff', new Map()), primary: globalThis[Symbol.for('rs3.engineCacheProbe')]('/tasks/engine.mjs:primary-cutoff', new Map())`);
    }
    return { ...result, source };
  } });
  const post = parentPort.postMessage.bind(parentPort);
  // A benchmark-only control uses an ordinary cancel envelope, which the
  // production handler ignores. It never changes a server request or reply.
  if (sizes) parentPort.on('message', message => {
    if (!message.__engineCacheSizes) return;
    void (async () => {
      const { Session } = await import('node:inspector');
      const session = new Session(); session.connect();
      try { await new Promise((resolve, reject) => session.post('HeapProfiler.collectGarbage', {}, error => error ? reject(error) : resolve())); }
      finally { session.disconnect(); }
      for (const row of stats.values()) {
        row.liveEntryBytes = []; row.liveBackingBytes = [];
        for (const sample of row.samples?.entries ?? []) {
          const value = sample.ref.deref();
          if (!value) continue;
          if (Buffer.isBuffer(value)) row.liveBackingBytes.push(value.buffer.byteLength);
          const payload = value.baseline ? [value.baseline, value.state, value.estimates, value.planningIndex, value.playResult, value.sandboxDelta]
            : value instanceof Map && Object.keys(value).length ? [value, Object.fromEntries(Object.entries(value))] : value;
          const n = bytes([sample.key, payload]);
          if (n !== null) row.liveEntryBytes.push(n);
        }
      }
      post({ id: message.id, __cacheProbe: Object.fromEntries([...stats].map(([name, row]) => [name, { ...row }])) });
    })().catch(() => post({ id: message.id, error: { name: 'SizeProbeError' } }));
  });
  parentPort.postMessage = (message, ...rest) => {
    if (message.id !== undefined && !['progress', 'prediction-prepared'].includes(message.type)) {
      const counters = Object.fromEntries([...stats].map(([key, row]) => [key, { ...row, entryBytes: sizes ? [...row.entryBytes] : undefined }]));
      const budget = globalThis[Symbol.for('rs3.cacheBudgetProbe')];
      message = { ...message, __cacheProbe: counters, ...(budget ? { __cacheBudget: { bytes: budget.bytes, entries: budget.size, byteLimit: budget.byteLimit } } : {}) };
      for (const row of stats.values()) { row.hits = 0; row.misses = 0; row.sets = 0; }
    }
    return post(message, ...rest);
  };
}
