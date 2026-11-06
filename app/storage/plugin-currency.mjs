import { applyValidatedCommand } from '../core/state.mjs';

const LIMIT = 1000, HISTORY_INTERVAL = 60000;
export const CURRENCY_CLOCK_SKEW = 30000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = value => /^[a-f0-9-]{36}$/.test(value);
const memberId = value => /^[A-Za-z0-9_-]{1,64}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const amount = value => value === null || integer(value) && value <= 1e12;
const fact = value => exact(value, ['coins', 'source']) && amount(value.coins) && ['manual', 'plugin', 'legacy'].includes(value.source);
const coinsOf = (state, player) => state.members.find(row => row.id === player)?.transportFacts?.currencies?.coins ?? null;
const sameFact = (a, b) => a.coins === b.coins && a.source === b.source;
const empty = () => ({ format: 2, keys: {}, players: {}, facts: {}, origins: [] });

/** Private, bounded metadata. Version 1 client times never become server fences. */
export function loadPluginCurrency(value) {
  if (value === undefined) return empty();
  if (exact(value, ['format', 'keys', 'players']) && value.format === 1 && object(value.keys) && object(value.players)) {
    if (Object.keys(value.keys).length > LIMIT || Object.keys(value.players).length > LIMIT) throw new TypeError('Invalid plugin currency metadata.');
    const next = empty();
    for (const [key, seq] of Object.entries(value.keys)) {
      if (!id(key) || !integer(seq)) throw new TypeError('Invalid plugin currency sequence.');
      next.keys[key] = { highSeq: seq, seq, generation: 0, sentAt: null, receivedAt: null, epoch: null };
    }
    for (const [player, row] of Object.entries(value.players)) {
      if (!memberId(player) || !exact(row, ['keyId', 'seq', 'sentAt', 'coins', 'historyAt', 'historyRevision'])
        || !id(row.keyId) || !Object.hasOwn(next.keys, row.keyId) || !integer(row.seq) || row.seq > value.keys[row.keyId]
        || !time(row.sentAt) || !amount(row.coins) || row.historyAt !== null && !time(row.historyAt)
        || row.historyRevision !== null && !integer(row.historyRevision)) throw new TypeError('Invalid plugin currency observation.');
      next.players[player] = { keyId: row.keyId, receivedAt: null, recoverAfter: null, historyAt: time(row.historyAt) ? row.historyAt : null,
        historyRevision: integer(row.historyRevision) ? row.historyRevision : null };
      if (row.coins !== null) next.facts[player] = { coins: row.coins, source: 'plugin' };
    }
    return loadPluginCurrency(next);
  }
  if (!exact(value, ['format', 'keys', 'players', 'facts', 'origins']) || value.format !== 2
    || ![value.keys, value.players, value.facts].every(rows => object(rows) && Object.keys(rows).length <= LIMIT)
    || !Array.isArray(value.origins) || value.origins.length > LIMIT) throw new TypeError('Invalid plugin currency metadata.');
  for (const [key, row] of Object.entries(value.keys)) if (!id(key) || !exact(row, ['highSeq', 'seq', 'generation', 'sentAt', 'receivedAt', 'epoch'])
    || !integer(row.highSeq) || !integer(row.seq) || row.highSeq < row.seq || !integer(row.generation)
    || row.sentAt !== null && !time(row.sentAt) || row.receivedAt !== null && !time(row.receivedAt)
    || row.epoch !== null && !/^[a-f0-9]{32}$/.test(row.epoch)) throw new TypeError('Invalid plugin currency sequence.');
  for (const [player, row] of Object.entries(value.players)) if (!memberId(player)
    || !exact(row, ['keyId', 'receivedAt', 'recoverAfter', 'historyAt', 'historyRevision']) || !Object.hasOwn(value.keys, row.keyId)
    || [row.receivedAt, row.recoverAfter, row.historyAt].some(at => at !== null && !time(at))
    || row.historyRevision !== null && !integer(row.historyRevision)) throw new TypeError('Invalid plugin currency observation.');
  for (const [player, row] of Object.entries(value.facts)) if (!memberId(player) || !fact(row)) throw new TypeError('Invalid currency provenance.');
  for (const row of value.origins) if (!exact(row, ['revision', 'memberId', 'before', 'after']) || !integer(row.revision)
    || !memberId(row.memberId) || !fact(row.before) || !fact(row.after)) throw new TypeError('Invalid currency Undo provenance.');
  return value;
}

function currentFact(state, ledger, player) {
  const coins = coinsOf(state, player), saved = ledger.facts[player];
  // These fixed-size annotations travel with ordinary History, including its
  // archives and portable restores. The old release ignores and preserves them.
  for (const row of [...state.history].reverse()) {
    const origin = row.type === 'undo' ? state.history.find(event => event.revision === row.command?.undoRevision)?.currencyOrigins?.[player]
      : row.currencyOrigins?.[player];
    const restored = row.type === 'undo' ? origin?.before : origin?.after;
    if (restored && fact(restored) && restored.coins === coins) return restored;
    if (row.command?.type === 'set-transport-facts' && row.command.memberId === player) break;
  }
  if (saved?.coins === coins) return saved;
  const portable = portableFacts(state)[player];
  if (portable?.coins === coins) return portable;
  const last = state.history.findLast(row => row.command?.type === 'set-transport-facts' && row.command.memberId === player && row.undoneRevision === undefined);
  return { coins, source: saved || last?.actor || coins === null ? 'manual' : 'legacy' };
}

function portableFacts(state) {
  const rows = state.provenance?.pluginCurrencyFacts;
  if (rows === undefined) return {};
  if (!object(rows) || Object.keys(rows).length > LIMIT
    || Object.entries(rows).some(([player, row]) => !memberId(player) || !fact(row))) throw new TypeError('Invalid portable currency provenance.');
  return rows;
}

function withPortableFact(state, player, after) {
  const rows = portableFacts(state), prior = rows[player];
  if (prior && sameFact(prior, after) || !prior && after.coins === null) return state;
  return { ...state, provenance: { ...state.provenance, pluginCurrencyFacts: { ...rows, [player]: after } } };
}

function withOrigin(ledger, player, before, after, revision, replaced) {
  const origins = ledger.origins.filter(row => !(row.memberId === player && row.revision === replaced));
  origins.push({ revision, memberId: player, before, after });
  return { ...ledger, facts: { ...ledger.facts, [player]: after }, origins: origins.slice(-LIMIT) };
}

function annotateOrigin(state, player, before, after) {
  const index = state.history.length - 1, event = state.history[index];
  state.history[index] = { ...event, currencyOrigins: { ...event.currencyOrigins, [player]: { before, after } } };
  const portable = withPortableFact(state, player, after);
  if (portable !== state) state.provenance = portable.provenance;
}

/** Ownership follows restored facts. Ordering fences are never undone. */
export function currencyAfterCommand(metadata, command, before, after, currencySource) {
  if (!before || !after) return metadata;
  let ledger = loadPluginCurrency(metadata), changed = false;
  const undoRevision = command.type === 'undo' ? after.history.at(-1)?.command?.undoRevision : undefined;
  for (const owner of after.members) {
    const player = owner.id, old = currentFact(before, ledger, player), coins = coinsOf(after, player);
    const inverse = undoRevision === undefined ? null : ledger.origins.find(row => row.revision === undoRevision && row.memberId === player)
      ?? before.history.find(row => row.revision === undoRevision)?.currencyOrigins?.[player];
    const manual = ['set-transport-facts', 'replace-member'].includes(command.type) && command.memberId === player;
    let next = old;
    if (inverse) next = inverse.before.coins === coins ? inverse.before : { coins, source: 'manual' };
    else if (command.type === 'replace-member' && manual && currencySource) {
      const restored = currentFact(currencySource.state, empty(), currencySource.memberId);
      next = restored.coins === coins && restored.source !== 'legacy' ? restored : { coins, source: 'manual' };
    } else if (manual || old.coins !== coins) next = { coins, source: 'manual' };
    if (sameFact(old, next) && !manual) continue;
    changed = true;
    annotateOrigin(after, player, old, next);
    ledger = command.type === 'undo' ? { ...ledger, facts: { ...ledger.facts, [player]: next } }
      : withOrigin(ledger, player, old, next, after.revision);
    if (ledger.players[player]) ledger = { ...ledger, players: { ...ledger.players, [player]: { ...ledger.players[player], historyAt: null, historyRevision: null } } };
  }
  return changed ? loadPluginCurrency(ledger) : metadata;
}

export function currencyAfterRestore(metadata, state) {
  const ledger = loadPluginCurrency(metadata);
  const incoming = { ...state, history: state.provenance?.restore?.incomingHistory ?? state.history,
    provenance: state.provenance?.restore?.incomingProvenance ?? state.provenance };
  const facts = Object.fromEntries(state.members.map(row => {
    const restored = currentFact(incoming, { ...ledger, facts: {} }, row.id);
    // Old portable backups have no ownership annotation. A deliberate import
    // establishes manual ownership unless preserved provenance says otherwise.
    const next = restored.source === 'legacy' ? { ...restored, source: 'manual' } : restored;
    annotateOrigin(state, row.id, next, next);
    return [row.id, next];
  }));
  return loadPluginCurrency({ ...ledger, origins: [],
    facts,
    players: Object.fromEntries(Object.entries(ledger.players).map(([player, row]) => [player, { ...row, historyAt: null, historyRevision: null }])) });
}

function order(ledger, report, now, epoch) {
  const { memberId: player, keyId, seq, sentAt } = report, prior = ledger.keys[keyId], last = ledger.players[player];
  const receivedAt = new Date(now).toISOString(), at = Date.parse(sentAt);
  const ambiguous = () => {
    // Never retain unsupported funds or let client time establish a fence.
    // Server-time quarantine expires; rejected traffic cannot extend it.
    const key = prior ?? { highSeq: 0, seq: 0, generation: 0, sentAt: null, receivedAt: null, epoch: null };
    const row = last ?? { keyId, receivedAt: null, historyAt: null, historyRevision: null };
    return { ledger: loadPluginCurrency({ ...ledger, keys: { ...ledger.keys, [keyId]: key }, players: { ...ledger.players,
      [player]: { ...row, recoverAfter: row.recoverAfter ?? new Date(now + 2 * CURRENCY_CLOCK_SKEW).toISOString() } } }), trusted: false };
  };
  // Even a plausible future clock is not proof that a report is newer.
  if (at > now || now - at > CURRENCY_CLOCK_SKEW) return ambiguous();
  const lower = prior && seq <= prior.seq, newerTime = !prior?.sentAt || at > Date.parse(prior.sentAt);
  const reset = prior && lower && seq < prior.seq && newerTime;
  if (prior && (lower && !reset || prior.sentAt && at < Date.parse(prior.sentAt))) return ambiguous();
  const boundary = prior && prior.epoch !== epoch, switched = last && last.keyId !== keyId;
  let recovery = last?.recoverAfter ? Date.parse(last.recoverAfter) : -Infinity;
  if (reset || switched) recovery = now + 2 * CURRENCY_CLOCK_SKEW;
  const generation = (prior?.generation ?? 0) + (reset || boundary ? 1 : 0);
  if (!integer(generation)) return ambiguous();
  const keys = { ...ledger.keys, [keyId]: { highSeq: Math.max(prior?.highSeq ?? 0, seq), seq, generation, sentAt, receivedAt, epoch } };
  const players = { ...ledger.players, [player]: { keyId, receivedAt, recoverAfter: Number.isFinite(recovery) ? new Date(recovery).toISOString() : null,
    historyAt: last?.historyAt ?? null, historyRevision: last?.historyRevision ?? null } };
  return { ledger: loadPluginCurrency({ ...ledger, keys, players }), trusted: now >= recovery };
}

/** One atomic transaction publishes facts, provenance and server-side stream fences. */
export function observePluginCurrency(state, metadata, report, options = {}) {
  const { memberId: player, keyId, seq, sentAt } = report;
  if (!memberId(player) || !id(keyId) || !integer(seq) || !time(sentAt) || !amount(report.coins)) throw new TypeError('Invalid plugin currency report.');
  const receivedAt = (options.now ?? (() => new Date().toISOString()))(), now = Date.parse(receivedAt);
  const ordered = order(loadPluginCurrency(metadata), report, now, options.epoch ?? '0'.repeat(32));
  let ledger = ordered.ledger, prior = ledger.players[player], origin = currentFact(state, ledger, player);
  const coins = ordered.trusted ? report.coins : null;
  const owner = state.members.find(row => row.id === player);
  if (!owner) throw new TypeError('Unknown plugin currency member.');
  const facts = structuredClone(owner.transportFacts ?? {});
  if (coins !== null) facts.currencies = { ...facts.currencies, coins };
  else if (origin.source !== 'manual' && origin.coins !== null) {
    delete facts.currencies.coins;
    if (!Object.keys(facts.currencies).length) delete facts.currencies;
  }
  let next = state, after = origin, historyAt = prior?.historyAt ?? null, historyRevision = prior?.historyRevision ?? null;
  if (JSON.stringify(facts) !== JSON.stringify(owner.transportFacts ?? {})) {
    let base = state, before = origin, replaced;
    const last = state.history.at(-1);
    if (last?.undo && last.revision === historyRevision && last.type === 'set-transport-facts' && last.undoneRevision === undefined
      && last.command.memberId === player && now - Date.parse(historyAt) < HISTORY_INTERVAL) {
      try {
        const undone = applyValidatedCommand(state, { type: 'undo', undoRevision: historyRevision }, options);
        const inverse = ledger.origins.find(row => row.revision === historyRevision && row.memberId === player);
        if (inverse) {
          base = { ...undone, revision: state.revision, history: state.history.slice(0, -1) };
          before = inverse.before; replaced = historyRevision;
        }
      } catch { /* Coalescing is optional; start a new ordinary group instead. */ }
    }
    if (base === state) historyAt = receivedAt;
    try {
      next = applyValidatedCommand(base, { type: 'set-transport-facts', memberId: player, facts }, options);
    } catch (error) {
      if (base === state) throw error;
      // A failed optional reconstruction must never block the ordinary update.
      next = applyValidatedCommand(state, { type: 'set-transport-facts', memberId: player, facts }, options);
      before = origin; replaced = undefined; historyAt = receivedAt;
    }
    after = { coins: coinsOf(next, player), source: 'plugin' };
    annotateOrigin(next, player, before, after);
    ledger = withOrigin(ledger, player, before, after, next.revision, replaced);
    historyRevision = next.revision;
  } else if (ordered.trusted && coins !== null && origin.source === 'legacy') {
    after = { coins, source: 'plugin' };
  }
  // Portable ownership must also survive an unchanged legacy adoption. This
  // metadata-only snapshot changes neither gameplay revision nor History.
  next = withPortableFact(next, player, after);
  ledger = { ...ledger, facts: { ...ledger.facts, [player]: after } };
  if (prior) ledger = { ...ledger, players: { ...ledger.players, [player]: { ...prior, historyAt, historyRevision } } };
  return { state: next, metadata: loadPluginCurrency(ledger), retry: !ordered.trusted };
}
